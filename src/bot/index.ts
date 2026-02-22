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

// CDP連携サービス
import { CdpService } from '../services/cdpService';
import { ResponseMonitor } from '../services/responseMonitor';
import { ScreenshotService } from '../services/screenshotService';
import { ApprovalDetector, ApprovalInfo } from '../services/approvalDetector';

// =============================================================================
// CDP ブリッジ: Discord ↔ Antigravity の結線
// =============================================================================

/** CDP接続の状態管理 */
interface CdpBridge {
    cdp: CdpService;
    screenshot: ScreenshotService;
    approval: ApprovalDetector | null;
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

    const bridge: CdpBridge = {
        cdp,
        screenshot,
        approval: null,
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

    // スラッシュコマンド用のハンドラー
    const slashCommandHandler = new SlashCommandHandler(modeService, modelService, templateRepo);

    // CDPブリッジの初期化
    const bridge = await initCdpBridge();

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
            await handleSlashInteraction(commandInteraction, slashCommandHandler, bridge);
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
            await sendPromptToAntigravity(bridge, message, message.content);
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
 * 承認ボタン検出を開始する
 */
function startApprovalDetector(bridge: CdpBridge, client: Client) {
    if (bridge.approval?.isActive()) return; // 既に実行中なら何もしない

    // 承認検出チャンネル（最初のテキストチャンネルを使用）
    bridge.approval = new ApprovalDetector({
        cdpService: bridge.cdp,
        pollIntervalMs: 2000,
        onApprovalRequired: async (info: ApprovalInfo) => {
            console.log('🔔 承認ボタン検出:', info.buttonText, '-', info.description);

            // Discord通知用のEmbed + ボタンを構築
            const embed = new EmbedBuilder()
                .setTitle('🔔 承認が必要です')
                .setDescription(info.description || 'Antigravityがアクションの承認を求めています')
                .setColor(0xFFA500)
                .addFields({ name: 'ボタン', value: info.buttonText })
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
            const args = modelName ? [modelName] : [];
            const result = await handler.handleCommand('models', args);
            await interaction.editReply({ content: result.message });
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

        default:
            await interaction.editReply({
                content: `⚠️ 未知のコマンドです: /${commandName}`,
            });
    }
}
