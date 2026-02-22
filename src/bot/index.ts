import {
    Client, GatewayIntentBits, Events, Message,
    ChatInputCommandInteraction, Interaction,
    AttachmentBuilder, ButtonBuilder, ButtonStyle,
    ActionRowBuilder, EmbedBuilder,
} from 'discord.js';
import Database from 'better-sqlite3';

import { loadConfig } from '../utils/config';
import { parseMessageContent } from '../commands/messageParser';
import { SlashCommandHandler } from '../commands/slashCommandHandler';
import { registerSlashCommands } from '../commands/registerSlashCommands';

import { ModeService } from '../services/modeService';
import { ModelService } from '../services/modelService';
import { TemplateRepository } from '../database/templateRepository';
import { WorkspaceBindingRepository } from '../database/workspaceBindingRepository';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { WorkspaceService } from '../services/workspaceService';
import {
    WorkspaceCommandHandler,
    WORKSPACE_SELECT_ID,
} from '../commands/workspaceCommandHandler';
import { ChatCommandHandler } from '../commands/chatCommandHandler';
import { ChannelManager } from '../services/channelManager';
import { TitleGeneratorService } from '../services/titleGeneratorService';

// CDP連携サービス
import { CdpService } from '../services/cdpService';
import { ChatSessionService } from '../services/chatSessionService';
import { ResponseMonitor } from '../services/responseMonitor';
import { ScreenshotService } from '../services/screenshotService';
import { ApprovalDetector, ApprovalInfo } from '../services/approvalDetector';
import { QuotaService } from '../services/quotaService';

// =============================================================================
// CDP ブリッジ: Discord ↔ Antigravity の結線
// =============================================================================

/** CDP接続の状態管理 */
interface CdpBridge {
    cdp: CdpService;
    screenshot: ScreenshotService;
    approval: ApprovalDetector | null;
    quota: QuotaService;
    isReady: boolean;
}

/** CDPブリッジを初期化し、Antigravityに接続する */
async function initCdpBridge(notifyChannel?: Message['channel']): Promise<CdpBridge> {
    const cdp = new CdpService({
        cdpCallTimeout: 15000,
        maxReconnectAttempts: 5,
        reconnectDelayMs: 3000,
    });

    const screenshot = new ScreenshotService({ cdpService: cdp });
    const quota = new QuotaService();

    const bridge: CdpBridge = {
        cdp,
        screenshot,
        approval: null,
        quota,
        isReady: false,
    };

    // 切断/再接続イベント
    cdp.on('disconnected', () => {
        console.log('⚠️ CDP切断を検出。再接続を試みています...');
        bridge.isReady = false;
    });

    cdp.on('reconnected', () => {
        console.log('✅ CDP再接続成功');
        bridge.isReady = true;
    });

    cdp.on('reconnectFailed', (err: Error) => {
        console.error('❌ CDP再接続失敗:', err.message);
        bridge.isReady = false;
    });

    // 初回接続を試みる
    try {
        await cdp.connect();
        bridge.isReady = true;
        console.log('✅ Antigravity CDP接続成功（コンテキスト数:', cdp.getContexts().length, '）');
    } catch (e: any) {
        console.warn('⚠️ Antigravity CDP接続失敗（後でリトライ可能）:', e.message);
        console.warn('   → Antigravityを --remote-debugging-port=9223 で起動してください');
    }

    return bridge;
}

/**
 * Discordのメッセージ（プロンプト）をAntigravityに送信し、応答を待ってDiscordに返す
 */
async function sendPromptToAntigravity(
    bridge: CdpBridge,
    message: Message,
    prompt: string,
): Promise<void> {
    // CDP未接続の場合
    if (!bridge.isReady) {
        await message.reply('⚠️ Antigravityに接続されていません。\n`open -a Antigravity --args --remote-debugging-port=9223` で起動後、`/cdp connect` で接続してください。');
        return;
    }

    // 「処理中...」メッセージを先に送る
    const statusMsg = await message.reply('⏳ プロンプトをAntigravityに送信中...');

    try {
        // メッセージ注入
        const injectResult = await bridge.cdp.injectMessage(prompt);
        if (!injectResult.ok) {
            await statusMsg.edit(`❌ メッセージ注入に失敗しました: ${injectResult.error}`);
            return;
        }

        await statusMsg.edit('🤖 Antigravityが処理中... レスポンスを監視しています');

        // レスポンス監視を開始
        const monitor = new ResponseMonitor({
            cdpService: bridge.cdp,
            pollIntervalMs: 2000,
            maxDurationMs: 300000, // 5分タイムアウト

            onProgress: (text) => {
                // プログレス: DiscordメッセージをEdit更新（3秒に1回程度）
                const truncated = text.length > 1900
                    ? text.substring(text.length - 1900) + '\n... (省略)'
                    : text;
                statusMsg.edit(`🤖 **生成中...**\n\`\`\`\n${truncated}\n\`\`\``).catch(() => { });
            },

            onComplete: async (finalText) => {
                // 完了: 最終テキストを送信
                if (!finalText || finalText.trim().length === 0) {
                    await statusMsg.edit('✅ 処理完了（レスポンスの抽出に失敗しました。`/screenshot` で確認してください）');
                    return;
                }

                // Discordのメッセージ上限は2000文字
                if (finalText.length <= 1900) {
                    await statusMsg.edit(`✅ **完了**\n\`\`\`\n${finalText}\n\`\`\``);
                } else {
                    // 長いレスポンスはファイルとして添付
                    await statusMsg.edit('✅ **完了** — レスポンスが長いためファイルで送信します');
                    const attachment = new AttachmentBuilder(
                        Buffer.from(finalText, 'utf-8'),
                        { name: 'response.md' }
                    );
                    await message.reply({ files: [attachment] });
                }
            },

            onTimeout: async (lastText) => {
                const truncated = lastText.length > 1000
                    ? lastText.substring(0, 1000) + '\n... (タイムアウトにより省略)'
                    : lastText;
                await statusMsg.edit(`⏰ **タイムアウト** (5分経過)\n最後の取得テキスト:\n\`\`\`\n${truncated || '(なし)'}\n\`\`\``);
            },
        });

        monitor.start();

    } catch (e: any) {
        await statusMsg.edit(`❌ エラーが発生しました: ${e.message}`);
    }
}

// =============================================================================
// Bot メインエントリー
// =============================================================================

export const startBot = async () => {
    const config = loadConfig();

    // 依存関係（ローカルDBやサービス）の初期化
    const db = new Database('antigravity.db');
    const modeService = new ModeService();
    const modelService = new ModelService();
    const templateRepo = new TemplateRepository(db);
    const workspaceBindingRepo = new WorkspaceBindingRepository(db);
    const chatSessionRepo = new ChatSessionRepository(db);
    const workspaceService = new WorkspaceService(config.workspaceBaseDir);
    const channelManager = new ChannelManager();

    // CDPブリッジの初期化
    const bridge = await initCdpBridge();

    // CDP依存サービスの初期化
    const chatSessionService = new ChatSessionService({ cdpService: bridge.cdp });
    const titleGenerator = new TitleGeneratorService(bridge.cdp);

    // コマンドハンドラーの初期化
    const wsHandler = new WorkspaceCommandHandler(workspaceBindingRepo, chatSessionRepo, workspaceService, channelManager);
    const chatHandler = new ChatCommandHandler(chatSessionService, chatSessionRepo, workspaceBindingRepo, channelManager);

    // スラッシュコマンド用のハンドラー
    const slashCommandHandler = new SlashCommandHandler(modeService, modelService, templateRepo);

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ]
    });

    client.once(Events.ClientReady, async (readyClient) => {
        console.log(`✅ Ready! Logged in as ${readyClient.user.tag}`);

        // スラッシュコマンドをDiscordに登録
        try {
            await registerSlashCommands(config.discordToken, config.clientId, config.guildId);
        } catch (error) {
            console.error('⚠️ スラッシュコマンドの登録に失敗しましたが、テキストコマンドは引き続き利用可能です。');
        }
    });

    // 【Discord Interactions API】スラッシュコマンドインタラクション処理
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        // ボタンインタラクション処理（承認/拒否ボタン）
        if (interaction.isButton()) {
            if (!config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true }).catch(console.error);
                return;
            }

            try {
                if (interaction.customId === 'approve_action' && bridge.approval) {
                    await interaction.deferUpdate();
                    const success = await bridge.approval.approveButton();
                    await interaction.followUp({
                        content: success ? '✅ 承認しました！' : '❌ ボタンが見つかりませんでした',
                        ephemeral: true,
                    });
                    return;
                }

                if (interaction.customId === 'deny_action' && bridge.approval) {
                    await interaction.deferUpdate();
                    const success = await bridge.approval.denyButton();
                    await interaction.followUp({
                        content: success ? '🚫 拒否しました' : '❌ ボタンが見つかりませんでした',
                        ephemeral: true,
                    });
                    return;
                }

                // モデルUIの更新ボタン
                if (interaction.customId === 'model_refresh_btn') {
                    await interaction.deferUpdate();
                    await sendModelsUI({ editReply: async (data: any) => await interaction.editReply(data) }, bridge);
                    return;
                }

                // モデル切り替えボタン
                if (interaction.customId.startsWith('model_btn_')) {
                    console.log(`[Button] model_btn clicked. customId=${interaction.customId}`);
                    await interaction.deferUpdate();

                    const modelName = interaction.customId.replace('model_btn_', '');
                    console.log(`[Button] Target model: ${modelName}`);

                    if (!bridge.isReady) {
                        console.log(`[Button] CDP not ready`);
                        await interaction.followUp({ content: '⚠️ CDPに未接続です。', ephemeral: true });
                        return;
                    }

                    console.log(`[Button] Calling cdp.setUiModel...`);
                    const res = await bridge.cdp.setUiModel(modelName);
                    console.log(`[Button] cdp.setUiModel result:`, res);

                    if (!res.ok) {
                        await interaction.followUp({ content: res.error || '⚠️ モデルの変更に失敗しました。', ephemeral: true });
                    } else {
                        console.log(`[Button] Calling sendModelsUI after successful setUiModel...`);
                        await sendModelsUI({ editReply: async (data: any) => await interaction.editReply(data) }, bridge);
                        await interaction.followUp({ content: `✅ モデルを **${res.model}** に変更しました！`, ephemeral: true });
                        console.log(`[Button] sendModelsUI complete.`);
                    }
                    return;
                }
            } catch (error) {
                console.error('ボタンインタラクションの処理中にエラーが発生:', error);

                // 既にdeferUpdate等で応答済み/期限切れの場合を考慮し、フォールバックとして送信を試みる
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ ボタン操作の処理中にエラーが発生しました。', ephemeral: true });
                    } else {
                        await interaction.followUp({ content: '❌ ボタン操作の処理中にエラーが発生しました。', ephemeral: true }).catch(console.error);
                    }
                } catch (e) {
                    console.error('エラーメッセージの送信にも失敗しました:', e);
                }
            }
        }

        // ワークスペースセレクトメニュー処理
        if (interaction.isStringSelectMenu() && interaction.customId === WORKSPACE_SELECT_ID) {
            if (!config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true }).catch(console.error);
                return;
            }

            if (!interaction.guild) {
                await interaction.reply({ content: '⚠️ サーバー内でのみ使用できます。', ephemeral: true }).catch(console.error);
                return;
            }

            try {
                await wsHandler.handleSelectMenu(interaction, interaction.guild);
            } catch (error) {
                console.error('ワークスペース選択エラー:', error);
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const commandInteraction = interaction as ChatInputCommandInteraction;

        // 認証チェック
        if (!config.allowedUserIds.includes(interaction.user.id)) {
            await commandInteraction.reply({
                content: '⛔ このコマンドを使用する権限がありません。',
                ephemeral: true,
            }).catch(console.error);
            return;
        }

        try {
            // まず応答を遅延させる（3秒制限を回避）
            await commandInteraction.deferReply();
            await handleSlashInteraction(commandInteraction, slashCommandHandler, bridge, wsHandler, chatHandler);
        } catch (error) {
            console.error('スラッシュコマンドの処理でエラーが発生:', error);
            try {
                if (commandInteraction.deferred) {
                    await commandInteraction.editReply({ content: '❌ コマンドの処理中にエラーが発生しました。' });
                } else if (!commandInteraction.replied) {
                    await commandInteraction.reply({ content: '❌ コマンドの処理中にエラーが発生しました。', ephemeral: true });
                }
            } catch (replyError) {
                console.error('エラー応答の送信にも失敗:', replyError);
            }
        }
    });

    // 【テキストメッセージ処理】
    client.on(Events.MessageCreate, async (message: Message) => {
        // Bot自身のメッセージは無視
        if (message.author.bot) return;

        // 認証チェック
        if (!config.allowedUserIds.includes(message.author.id)) {
            return;
        }

        // メッセージの内容をパース
        const parsed = parseMessageContent(message.content);

        // スラッシュコマンドの場合（テキスト方式の後方互換）
        if (parsed.isCommand && parsed.commandName) {
            // /cdp コマンド（CDP接続管理）
            if (parsed.commandName === 'cdp') {
                const subCmd = parsed.args?.[0];
                if (subCmd === 'connect') {
                    try {
                        await bridge.cdp.connect();
                        bridge.isReady = true;
                        await message.reply('✅ CDP接続成功！');
                    } catch (e: any) {
                        await message.reply(`❌ CDP接続失敗: ${e.message}\n→ \`open -a Antigravity --args --remote-debugging-port=9223\` で起動してください`);
                    }
                } else if (subCmd === 'status') {
                    const status = bridge.isReady ? '✅ 接続中' : '❌ 未接続';
                    const contexts = bridge.isReady ? bridge.cdp.getContexts().length : 0;
                    await message.reply(`📡 CDP状態: ${status}\nコンテキスト数: ${contexts}`);
                } else {
                    await message.reply('使い方: `/cdp connect` | `/cdp status`');
                }
                return;
            }

            // /screenshot コマンド（テキスト方式）
            if (parsed.commandName === 'screenshot') {
                await handleScreenshot(message, bridge);
                return;
            }

            const result = await slashCommandHandler.handleCommand(parsed.commandName, parsed.args || []);

            await message.reply({
                content: result.message
            }).catch(console.error);

            // templates use で取得したプロンプトをAntigravityに送信
            if (result.prompt) {
                await sendPromptToAntigravity(bridge, message, result.prompt);
            }
            return;
        }

        // 🎯 平文メッセージ → Antigravityにプロンプトとして送信
        if (message.content.trim()) {
            // 自動リネーム: 初回メッセージ送信時にチャンネル名をタイトルにリネーム
            await autoRenameChannel(message, chatSessionRepo, titleGenerator, channelManager);

            const workspacePath = wsHandler.getWorkspaceForChannel(message.channelId);
            const prompt = workspacePath
                ? `[ワークスペース: ${workspacePath}]\n${message.content}`
                : message.content;
            await sendPromptToAntigravity(bridge, message, prompt);
        }
    });

    // 承認ボタン検出の開始（CDP接続済みの場合）
    if (bridge.isReady) {
        startApprovalDetector(bridge, client);
    }
    // 再接続時にも承認検出を開始
    bridge.cdp.on('reconnected', () => {
        startApprovalDetector(bridge, client);
    });

    await client.login(config.discordToken);
};

/**
 * 初回メッセージ送信時にチャンネル名を自動リネームする
 */
async function autoRenameChannel(
    message: Message,
    chatSessionRepo: ChatSessionRepository,
    titleGenerator: TitleGeneratorService,
    channelManager: ChannelManager,
): Promise<void> {
    const session = chatSessionRepo.findByChannelId(message.channelId);
    if (!session || session.isRenamed) return;

    const guild = message.guild;
    if (!guild) return;

    try {
        const title = await titleGenerator.generateTitle(message.content);
        const newName = `${session.sessionNumber}-${title}`;
        await channelManager.renameChannel(guild, message.channelId, newName);
        chatSessionRepo.updateDisplayName(message.channelId, title);
    } catch (err) {
        console.error('[AutoRename] リネーム失敗:', err);
        // リネーム失敗はプロンプト送信をブロックしない
    }
}

/**
 * 承認ボタン検出を開始する
 */
function startApprovalDetector(bridge: CdpBridge, client: Client) {
    if (bridge.approval?.isActive()) return; // 既に実行中なら何もしない

    // 承認検出チャンネル（最初のテキストチャンネルを使用）
    bridge.approval = new ApprovalDetector({
        cdpService: bridge.cdp,
        pollIntervalMs: 2000,
        onApprovalRequired: async (info: ApprovalInfo) => {
            console.log('🔔 承認ボタン検出:', info.approveText, '/', info.denyText, '-', info.description);

            // Discord通知用のEmbed + ボタンを構築
            const embed = new EmbedBuilder()
                .setTitle('🔔 承認が必要です')
                .setDescription(info.description || 'Antigravityがアクションの承認を求めています')
                .setColor(0xFFA500)
                .addFields(
                    { name: '許可ボタン', value: info.approveText, inline: true },
                    { name: '拒否ボタン', value: info.denyText || '(なし)', inline: true },
                )
                .setTimestamp();

            const approveBtn = new ButtonBuilder()
                .setCustomId('approve_action')
                .setLabel('✅ 許可')
                .setStyle(ButtonStyle.Success);

            const denyBtn = new ButtonBuilder()
                .setCustomId('deny_action')
                .setLabel('🚫 拒否')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, denyBtn);

            // 全ギルドの最初のテキストチャンネルに通知（シンプルな実装）
            for (const guild of client.guilds.cache.values()) {
                const channel = guild.channels.cache.find(
                    ch => ch.isTextBased() && !ch.isDMBased()
                );
                if (channel && channel.isTextBased() && 'send' in channel) {
                    (channel as any).send({
                        embeds: [embed],
                        components: [row],
                    }).catch(console.error);
                    break;
                }
            }
        },
    });

    bridge.approval.start();
    console.log('🔍 承認ボタン検出を開始しました');
}

/**
 * /models コマンドのインタラクティブなUIを組み立てて送信する
 */
async function sendModelsUI(target: { editReply: (opts: any) => Promise<any> }, bridge: CdpBridge) {
    if (!bridge.isReady) {
        await target.editReply({ content: '⚠️ CDPに未接続です。' });
        return;
    }
    const models = await bridge.cdp.getUiModels();
    const currentModel = await bridge.cdp.getCurrentModel();
    const quotaData = await bridge.quota.fetchQuota();

    if (models.length === 0) {
        await target.editReply({ content: '⚠️ Antigravityのモデル一覧の取得に失敗しました。' });
        return;
    }

    function formatQuota(mName: string, current: boolean) {
        if (!mName) return `${current ? '✅' : '🟩'} 不明`;

        // Match by prefix or full name
        const q = quotaData.find(q => q.label === mName || mName.includes(q.label) || q.label.includes(mName));
        if (!q || q.quotaInfo?.remainingFraction === undefined) return `${current ? '✅' : '🟩'} ${mName}`;

        const rem = q.quotaInfo.remainingFraction;
        const percent = Math.round(rem * 100);
        let icon = '🟢';
        if (percent <= 20) icon = '🔴';
        else if (percent <= 50) icon = '🟡';

        const resetTime = new Date(q.quotaInfo.resetTime);
        const diffMs = resetTime.getTime() - Date.now();
        let timeStr = 'Ready';
        if (diffMs > 0) {
            const mins = Math.ceil(diffMs / 60000);
            if (mins < 60) timeStr = `${mins}m`;
            else timeStr = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }

        return `${current ? '✅' : '🟩'} ${mName} ${icon} ${percent}% ⏳ ${timeStr}`;
    }

    const currentModelFormatted = currentModel ? formatQuota(currentModel, true) : '不明';

    const embed = new EmbedBuilder()
        .setTitle('🤖 モデル管理')
        .setColor(0x5865F2)
        .setDescription(`**現在のモデル:**\n${currentModelFormatted}\n\n` +
            `📋 **利用可能なモデル (${models.length}件)**\n` +
            models.map(m => formatQuota(m, m === currentModel)).join('\n')
        )
        .setFooter({ text: '※ 最新のQuota情報を取得しました' })
        .setTimestamp();

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    // Add buttons
    for (const mName of models.slice(0, 24)) { // leave 1 spot for refresh max
        if (currentRow.components.length === 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder<ButtonBuilder>();
        }
        const safeName = mName.length > 80 ? mName.substring(0, 77) + '...' : mName;
        currentRow.addComponents(new ButtonBuilder()
            .setCustomId(`model_btn_${mName}`)
            .setLabel(safeName)
            .setStyle(mName === currentModel ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
    }

    // Append Refresh btn
    if (currentRow.components.length < 5) {
        currentRow.addComponents(new ButtonBuilder()
            .setCustomId('model_refresh_btn')
            .setLabel('🔄 更新')
            .setStyle(ButtonStyle.Primary)
        );
        rows.push(currentRow);
    } else {
        rows.push(currentRow);
        if (rows.length < 5) {
            const refreshRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('model_refresh_btn')
                    .setLabel('🔄 更新')
                    .setStyle(ButtonStyle.Primary)
            );
            rows.push(refreshRow);
        }
    }

    await target.editReply({ content: '', embeds: [embed], components: rows });
}

/**
 * スクリーンショットを撮ってDiscordに送信する
 */
async function handleScreenshot(target: Message | ChatInputCommandInteraction, bridge: CdpBridge): Promise<void> {
    if (!bridge.isReady) {
        const content = '⚠️ Antigravityに接続されていません。';
        if (target instanceof Message) {
            await target.reply(content);
        } else {
            await target.editReply({ content });
        }
        return;
    }

    try {
        const result = await bridge.screenshot.capture({ format: 'png' });
        if (result.success && result.buffer) {
            const attachment = new AttachmentBuilder(result.buffer, { name: 'screenshot.png' });
            if (target instanceof Message) {
                await target.reply({ files: [attachment] });
            } else {
                await target.editReply({ files: [attachment] });
            }
        } else {
            const content = `❌ スクリーンショット失敗: ${result.error}`;
            if (target instanceof Message) {
                await target.reply(content);
            } else {
                await target.editReply({ content });
            }
        }
    } catch (e: any) {
        const content = `❌ スクリーンショットエラー: ${e.message}`;
        if (target instanceof Message) {
            await target.reply(content);
        } else {
            await target.editReply({ content });
        }
    }
}

/**
 * Discord Interactions API のスラッシュコマンドを処理する
 * 注意: この関数が呼ばれる前に deferReply() が呼ばれているため、editReply() を使用する
 */
async function handleSlashInteraction(
    interaction: ChatInputCommandInteraction,
    handler: SlashCommandHandler,
    bridge: CdpBridge,
    wsHandler: WorkspaceCommandHandler,
    chatHandler: ChatCommandHandler,
): Promise<void> {
    const commandName = interaction.commandName;

    switch (commandName) {
        case 'mode': {
            const modeName = interaction.options.getString('name');
            const args = modeName ? [modeName] : [];
            const result = await handler.handleCommand('mode', args);
            await interaction.editReply({ content: result.message });
            break;
        }

        case 'models': {
            const modelName = interaction.options.getString('name');
            if (!modelName) {
                await sendModelsUI(interaction, bridge);
            } else {
                if (!bridge.isReady) {
                    await interaction.editReply({ content: '⚠️ CDPに未接続です。' });
                    break;
                }
                const res = await bridge.cdp.setUiModel(modelName);
                if (res.ok) {
                    await interaction.editReply({ content: `✅ モデルを **${res.model}** に変更しました。` });
                } else {
                    await interaction.editReply({ content: res.error || '⚠️ モデルの変更に失敗しました。' });
                }
            }
            break;
        }

        case 'templates': {
            const subcommand = interaction.options.getSubcommand();
            let args: string[];

            switch (subcommand) {
                case 'list':
                    args = [];
                    break;
                case 'use': {
                    const name = interaction.options.getString('name', true);
                    args = [name];
                    break;
                }
                case 'add': {
                    const name = interaction.options.getString('name', true);
                    const prompt = interaction.options.getString('prompt', true);
                    args = ['add', name, prompt];
                    break;
                }
                case 'delete': {
                    const name = interaction.options.getString('name', true);
                    args = ['delete', name];
                    break;
                }
                default:
                    args = [];
            }

            const result = await handler.handleCommand('templates', args);
            await interaction.editReply({ content: result.message });

            // templates use の場合、プロンプトをAntigravityに送信
            if (result.prompt && interaction.channel) {
                // InteractionからMessageを取得してsendPromptToAntigravityに渡す
                const followUp = await interaction.followUp({
                    content: '⏳ テンプレートのプロンプトをAntigravityに送信中...',
                });
                if (followUp instanceof Message) {
                    await sendPromptToAntigravity(bridge, followUp, result.prompt);
                }
            }
            break;
        }

        case 'screenshot': {
            await handleScreenshot(interaction, bridge);
            break;
        }

        case 'workspace': {
            await wsHandler.handleShow(interaction);
            break;
        }

        case 'chat': {
            const subcommand = interaction.options.getSubcommand();
            switch (subcommand) {
                case 'new':
                    await chatHandler.handleNew(interaction);
                    break;
                case 'status':
                    await chatHandler.handleStatus(interaction);
                    break;
                case 'list':
                    await chatHandler.handleList(interaction);
                    break;
                default:
                    await interaction.editReply({ content: `⚠️ 未知のサブコマンドです: ${subcommand}` });
            }
            break;
        }

        default:
            await interaction.editReply({
                content: `⚠️ 未知のコマンドです: /${commandName}`,
            });
    }
}
