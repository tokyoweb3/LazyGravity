import {
    Client, GatewayIntentBits, Events, Message,
    ChatInputCommandInteraction, Interaction,
    AttachmentBuilder, ButtonBuilder, ButtonStyle,
    ActionRowBuilder, EmbedBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import Database from 'better-sqlite3';

import { loadConfig } from '../utils/config';
import { parseMessageContent } from '../commands/messageParser';
import { SlashCommandHandler } from '../commands/slashCommandHandler';
import { registerSlashCommands } from '../commands/registerSlashCommands';

import { ModeService, AVAILABLE_MODES, MODE_DISPLAY_NAMES, MODE_DESCRIPTIONS } from '../services/modeService';
import { ModelService } from '../services/modelService';
import { TemplateRepository } from '../database/templateRepository';
import { WorkspaceBindingRepository } from '../database/workspaceBindingRepository';
import { ChatSessionRepository } from '../database/chatSessionRepository';
import { WorkspaceService } from '../services/workspaceService';
import {
    WorkspaceCommandHandler,
    PROJECT_SELECT_ID,
    WORKSPACE_SELECT_ID,
} from '../commands/workspaceCommandHandler';
import { ChatCommandHandler } from '../commands/chatCommandHandler';
import { ChannelManager } from '../services/channelManager';
import { TitleGeneratorService } from '../services/titleGeneratorService';

// CDP連携サービス
import { CdpService } from '../services/cdpService';
import { CdpConnectionPool } from '../services/cdpConnectionPool';
import { ChatSessionService } from '../services/chatSessionService';
import { ResponseMonitor, RESPONSE_SELECTORS } from '../services/responseMonitor';
import { ScreenshotService } from '../services/screenshotService';
import { ApprovalDetector, ApprovalInfo } from '../services/approvalDetector';
import { QuotaService } from '../services/quotaService';
import { ensureAntigravityRunning } from '../services/antigravityLauncher';

// =============================================================================
// CDP ブリッジ: Discord ↔ Antigravity の結線
// =============================================================================

/** CDP接続の状態管理 */
interface CdpBridge {
    pool: CdpConnectionPool;
    quota: QuotaService;
    /** 最後にメッセージを送信したワークスペースのディレクトリ名 */
    lastActiveWorkspace: string | null;
    /** 最後にメッセージを送信したチャンネル（承認通知の送信先） */
    lastActiveChannel: Message['channel'] | null;
}

/** CDPブリッジを初期化する（遅延接続: プール作成のみ） */
function initCdpBridge(): CdpBridge {
    const pool = new CdpConnectionPool({
        cdpCallTimeout: 15000,
        maxReconnectAttempts: 5,
        reconnectDelayMs: 3000,
    });

    const quota = new QuotaService();

    return {
        pool,
        quota,
        lastActiveWorkspace: null,
        lastActiveChannel: null,
    };
}

/**
 * lastActiveWorkspace から現在アクティブな CdpService を取得するヘルパー。
 * ボタン操作やモデル/モード切替など、ワークスペースパスが明示されない場面で使用。
 */
function getCurrentCdp(bridge: CdpBridge): CdpService | null {
    if (!bridge.lastActiveWorkspace) return null;
    return bridge.pool.getConnected(bridge.lastActiveWorkspace);
}

/**
 * ワークスペースごとに承認検出器を起動するヘルパー。
 * 既に同名ワークスペースの検出器が動いていれば何もしない。
 */
function ensureApprovalDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    workspaceDirName: string,
    client: Client,
): void {
    const existing = bridge.pool.getApprovalDetector(workspaceDirName);
    if (existing && existing.isActive()) return;

    const detector = new ApprovalDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onApprovalRequired: async (info: ApprovalInfo) => {
            console.error(`[ApprovalDetector:${workspaceDirName}] 承認ボタン検出:`, info.approveText, '/', info.denyText, '-', info.description);

            const embed = new EmbedBuilder()
                .setTitle('承認が必要です')
                .setDescription(info.description || 'Antigravityがアクションの承認を求めています')
                .setColor(0xFFA500)
                .addFields(
                    { name: '許可ボタン', value: info.approveText, inline: true },
                    { name: '拒否ボタン', value: info.denyText || '(なし)', inline: true },
                    { name: 'ワークスペース', value: workspaceDirName, inline: true },
                )
                .setTimestamp();

            const approveBtn = new ButtonBuilder()
                .setCustomId('approve_action')
                .setLabel('許可')
                .setStyle(ButtonStyle.Success);

            const denyBtn = new ButtonBuilder()
                .setCustomId('deny_action')
                .setLabel('拒否')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, denyBtn);

            const targetChannel = bridge.lastActiveChannel;
            if (targetChannel && 'send' in targetChannel) {
                (targetChannel as any).send({
                    embeds: [embed],
                    components: [row],
                }).catch(console.error);
            } else {
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
            }
        },
    });

    detector.start();
    bridge.pool.registerApprovalDetector(workspaceDirName, detector);
    console.error(`[ApprovalDetector:${workspaceDirName}] 承認ボタン検出を開始しました`);
}

// =============================================================================
// Embed カラーパレット（フェーズごとの色分け）
// =============================================================================
const PHASE_COLORS = {
    sending: 0x5865F2,     // ブルー
    thinking: 0x9B59B6,    // パープル
    generating: 0xF39C12,  // ゴールド
    complete: 0x2ECC71,    // グリーン
    timeout: 0xE74C3C,     // レッド
    error: 0xC0392B,       // ダークレッド
} as const;

const PHASE_ICONS = {
    sending: '📡',
    thinking: '🧠',
    generating: '✍️',
    complete: '✅',
    timeout: '⏰',
    error: '❌',
} as const;

/** テキストをEmbed用にトランケート（末尾を残す） */
function truncateForEmbed(text: string, maxLen: number = 4000): string {
    if (text.length <= maxLen) return text;
    return '… (先頭を省略)\n' + text.substring(text.length - maxLen + 30);
}

/**
 * Discord Embed用にテキストをフォーマットする。
 *
 * Discord Embedはmarkdownテーブル（`| ... |`）やツリー構造（`├──`等）を
 * そのまま表示できないため、これらを自動検出してコードブロックで囲む。
 */
function formatForDiscord(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let inSpecialBlock = false; // テーブルまたはツリーのコードブロック中

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // テーブル行の判定: `| ... |` 形式、または区切り行 `|---|---|`
        const isTableLine =
            (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) ||
            /^\|[\s\-:]+\|/.test(trimmed);

        // ツリー構造の判定: ├ └ │ ┌ ┐ や ASCII ツリー記号
        const isTreeLine = /[├└│┌┐┘┤┬┴┼]/.test(line) ||
            /^\s*[│├└]\s*──/.test(line) ||
            /^\s*\|.*──/.test(line);

        const isSpecialLine = isTableLine || isTreeLine;

        if (isSpecialLine && !inSpecialBlock) {
            // コードブロック開始
            result.push('```');
            inSpecialBlock = true;
            result.push(line);
        } else if (isSpecialLine && inSpecialBlock) {
            // コードブロック続行
            result.push(line);
        } else if (!isSpecialLine && inSpecialBlock) {
            // コードブロック終了
            result.push('```');
            inSpecialBlock = false;
            result.push(line);
        } else {
            result.push(line);
        }
    }

    // 未閉じのコードブロックをクローズ
    if (inSpecialBlock) {
        result.push('```');
    }

    return result.join('\n');
}

/**
 * Discordのメッセージ（プロンプト）をAntigravityに送信し、応答を待ってDiscordに返す
 *
 * メッセージ戦略:
 *   - statusMsg: 現在のフェーズを表示（常に最新状態に編集）
 *   - thinkingLogMsg: 思考フェーズのログ（生成開始時に別メッセージとして確定）
 *   - 完了時に最終レスポンスをstatusMsg上に表示
 */
async function sendPromptToAntigravity(
    bridge: CdpBridge,
    message: Message,
    prompt: string,
    cdp: CdpService,
): Promise<void> {
    // コマンド受付のリアクションを追加
    await message.react('👀').catch(() => { });

    if (!cdp.isConnected()) {
        const errorEmbed = new EmbedBuilder()
            .setTitle(`${PHASE_ICONS.error} 接続エラー`)
            .setDescription('Antigravityに接続されていません。\n`open -a Antigravity --args --remote-debugging-port=9223` で起動後、メッセージを送信すると自動接続されます。')
            .setColor(PHASE_COLORS.error)
            .setTimestamp();
        await message.reply({ embeds: [errorEmbed] });

        const botId = message.client.user?.id;
        if (botId) {
            await message.reactions.resolve('👀')?.users.remove(botId).catch(() => { });
        }
        await message.react('❌').catch(() => { });
        return;
    }

    // フェーズ1: 送信中 Embed
    const sendingEmbed = new EmbedBuilder()
        .setTitle(`${PHASE_ICONS.sending} プロンプト送信中...`)
        .setDescription('Antigravityにメッセージを送信しています')
        .setColor(PHASE_COLORS.sending)
        .addFields({ name: '📝 プロンプト', value: prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt })
        .setTimestamp();

    const statusMsg = await message.reply({ embeds: [sendingEmbed] });

    // 完了フラグ: trueになったらそれ以降statusMsgの編集を行わない
    let isFinalized = false;
    let lastEditTime = 0;
    const MIN_EDIT_INTERVAL_MS = 3000;
    let pendingEditTimer: NodeJS.Timeout | null = null;
    // アクティビティ
    let currentActivities: string[] = [];
    // アクティビティ全履歴（ログ保持用）
    const activityHistory: string[] = [];
    // 思考フェーズのログを確定済みか
    let thinkingLogSent = false;

    /** statusMsgを安全にEmbed更新 */
    async function safeEditEmbed(embed: EmbedBuilder, immediate = false): Promise<void> {
        if (isFinalized) return;

        if (pendingEditTimer) {
            clearTimeout(pendingEditTimer);
            pendingEditTimer = null;
        }

        const now = Date.now();
        const elapsed = now - lastEditTime;

        if (immediate || elapsed >= MIN_EDIT_INTERVAL_MS) {
            lastEditTime = Date.now();
            await statusMsg.edit({ content: '', embeds: [embed] }).catch((err: Error) => {
                console.error('[sendPromptToAntigravity] Embed更新失敗:', err.message);
            });
        } else {
            const delay = MIN_EDIT_INTERVAL_MS - elapsed;
            pendingEditTimer = setTimeout(async () => {
                pendingEditTimer = null;
                if (isFinalized) return;
                lastEditTime = Date.now();
                await statusMsg.edit({ content: '', embeds: [embed] }).catch((err: Error) => {
                    console.error('[sendPromptToAntigravity] 遅延Embed更新失敗:', err.message);
                });
            }, delay);
        }
    }

    /** 思考フェーズのログを別メッセージとして確定送信する */
    async function sendThinkingLog(elapsed: number): Promise<void> {
        if (thinkingLogSent) return;
        thinkingLogSent = true;

        const logEmbed = new EmbedBuilder()
            .setTitle(`${PHASE_ICONS.thinking} 思考ログ`)
            .setColor(PHASE_COLORS.thinking)
            .setFooter({ text: `⏱️ 思考時間: ${elapsed}秒` })
            .setTimestamp();

        if (activityHistory.length > 0) {
            const actText = activityHistory.slice(-15).join('\n');
            logEmbed.setDescription(actText.length > 4000 ? actText.substring(actText.length - 4000) : actText);
        } else {
            logEmbed.setDescription('AIが応答を生成中...');
        }

        const ch = message.channel;
        if (ch && 'send' in ch) {
            await (ch as any).send({ embeds: [logEmbed] }).catch(() => { });
        }
    }

    try {
        const injectResult = await cdp.injectMessage(prompt);
        if (!injectResult.ok) {
            isFinalized = true;
            const errorEmbed = new EmbedBuilder()
                .setTitle(`${PHASE_ICONS.error} メッセージ注入失敗`)
                .setDescription(`メッセージの送信に失敗しました: ${injectResult.error}`)
                .setColor(PHASE_COLORS.error)
                .setTimestamp();
            await statusMsg.edit({ content: '', embeds: [errorEmbed] });

            const botId = message.client.user?.id;
            if (botId) {
                await message.reactions.resolve('👀')?.users.remove(botId).catch(() => { });
            }
            await message.react('❌').catch(() => { });
            return;
        }

        // フェーズ2: 伝達完了
        const waitingEmbed = new EmbedBuilder()
            .setTitle(`${PHASE_ICONS.sending} 伝達完了。応答を待っています...`)
            .setDescription('Antigravityがリクエストを処理しています')
            .setColor(PHASE_COLORS.sending)
            .setFooter({ text: '⏱️ レスポンスを監視中...' })
            .setTimestamp();
        await safeEditEmbed(waitingEmbed, true);

        const startTime = Date.now();

        const monitor = new ResponseMonitor({
            cdpService: cdp,
            pollIntervalMs: 2000,
            maxDurationMs: 300000, // 5分タイムアウト
            stopButtonGoneConfirmCount: 3, // 連続3回ストップボタン消失で完了

            onPhaseChange: (phase, text) => {
                if (isFinalized) return;
                const elapsed = Math.round((Date.now() - startTime) / 1000);

                switch (phase) {
                    case 'thinking': {
                        const thinkEmbed = new EmbedBuilder()
                            .setTitle(`${PHASE_ICONS.thinking} Thinking...`)
                            .setDescription('AIが思考中です。応答の生成を準備しています。')
                            .setColor(PHASE_COLORS.thinking)
                            .setFooter({ text: `⏱️ 経過時間: ${elapsed}秒` })
                            .setTimestamp();
                        if (currentActivities.length > 0) {
                            thinkEmbed.addFields({ name: '🔧 アクティビティ', value: currentActivities.join('\n') });
                        }
                        safeEditEmbed(thinkEmbed, true);
                        break;
                    }
                    case 'generating': {
                        // 思考→生成に移行: 思考ログを別メッセージとして確定
                        sendThinkingLog(elapsed).catch(() => { });
                        break;
                    }
                }
            },

            onActivity: (activities) => {
                if (isFinalized) return;
                currentActivities = activities;
                const elapsed = Math.round((Date.now() - startTime) / 1000);

                // アクティビティ履歴に追加（重複回避）
                for (const act of activities) {
                    if (!activityHistory.includes(act)) {
                        activityHistory.push(act);
                    }
                }

                // まだ思考フェーズのstatusMsg上でアクティビティEmbedを表示
                if (!thinkingLogSent) {
                    const actEmbed = new EmbedBuilder()
                        .setTitle(`${PHASE_ICONS.thinking} 処理中...`)
                        .setColor(PHASE_COLORS.thinking)
                        .setFooter({ text: `⏱️ 経過時間: ${elapsed}秒` })
                        .setTimestamp();

                    const actText = activityHistory.slice(-10).join('\n');
                    actEmbed.addFields({ name: '🔧 アクティビティ', value: actText || '...' });
                    safeEditEmbed(actEmbed);
                }
            },

            onProgress: (text) => {
                if (isFinalized) return;
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                const formatted = formatForDiscord(text);
                const truncated = truncateForEmbed(formatted, 3800);

                const progressEmbed = new EmbedBuilder()
                    .setTitle(`${PHASE_ICONS.generating} 生成中...`)
                    .setDescription(truncated)
                    .setColor(PHASE_COLORS.generating)
                    .setFooter({ text: `⏱️ 経過時間: ${elapsed}秒 | 📊 ${text.length}文字` })
                    .setTimestamp();

                safeEditEmbed(progressEmbed);
            },

            onComplete: async (finalText) => {
                isFinalized = true;
                if (pendingEditTimer) {
                    clearTimeout(pendingEditTimer);
                    pendingEditTimer = null;
                }

                const elapsed = Math.round((Date.now() - startTime) / 1000);

                // まだ思考ログを送信していなければここで送る
                if (!thinkingLogSent && activityHistory.length > 0) {
                    await sendThinkingLog(elapsed);
                }

                if (!finalText || finalText.trim().length === 0) {
                    const emptyEmbed = new EmbedBuilder()
                        .setTitle(`${PHASE_ICONS.complete} 処理完了`)
                        .setDescription('レスポンスの抽出に失敗しました。`/screenshot` で確認してください。')
                        .setColor(PHASE_COLORS.complete)
                        .setFooter({ text: `⏱️ 所要時間: ${elapsed}秒` })
                        .setTimestamp();
                    await statusMsg.edit({ content: '', embeds: [emptyEmbed] }).catch(() => { });

                    const botId = message.client.user?.id;
                    if (botId) {
                        await message.reactions.resolve('👀')?.users.remove(botId).catch(() => { });
                    }
                    await message.react('⚠️').catch(() => { });
                    return;
                }

                const formatted = formatForDiscord(finalText);

                // Embedのdescription上限は4096文字
                if (formatted.length <= 3800) {
                    const completeEmbed = new EmbedBuilder()
                        .setTitle(`${PHASE_ICONS.complete} 完了`)
                        .setDescription(formatted)
                        .setColor(PHASE_COLORS.complete)
                        .setFooter({ text: `⏱️ 所要時間: ${elapsed}秒 | 📊 ${finalText.length}文字` })
                        .setTimestamp();
                    await statusMsg.edit({ content: '', embeds: [completeEmbed] }).catch(() => { });
                } else {
                    // 長いレスポンスはファイルとして添付
                    const previewFormatted = formatForDiscord(finalText.substring(0, 500));
                    const summaryEmbed = new EmbedBuilder()
                        .setTitle(`${PHASE_ICONS.complete} 完了`)
                        .setDescription(`レスポンスが長いためファイルで送信します。\n\n**プレビュー:**\n${previewFormatted}...`)
                        .setColor(PHASE_COLORS.complete)
                        .setFooter({ text: `⏱️ 所要時間: ${elapsed}秒 | 📊 ${finalText.length}文字` })
                        .setTimestamp();
                    await statusMsg.edit({ content: '', embeds: [summaryEmbed] }).catch(() => { });

                    const attachment = new AttachmentBuilder(
                        Buffer.from(finalText, 'utf-8'),
                        { name: 'response.md' }
                    );
                    await message.reply({ files: [attachment] }).catch(() => { });
                }

                const botId = message.client.user?.id;
                if (botId) {
                    await message.reactions.resolve('👀')?.users.remove(botId).catch(() => { });
                }
                await message.react('✅').catch(() => { });
            },

            onTimeout: async (lastText) => {
                isFinalized = true;
                if (pendingEditTimer) {
                    clearTimeout(pendingEditTimer);
                    pendingEditTimer = null;
                }

                const elapsed = Math.round((Date.now() - startTime) / 1000);

                // 思考ログが未送信なら送る
                if (!thinkingLogSent && activityHistory.length > 0) {
                    await sendThinkingLog(elapsed);
                }

                const formatted = lastText ? formatForDiscord(truncateForEmbed(lastText, 3000)) : '(テキスト取得なし)';

                const timeoutEmbed = new EmbedBuilder()
                    .setTitle(`${PHASE_ICONS.timeout} タイムアウト`)
                    .setDescription(`5分経過により監視を終了しました。\n\n**最後の取得テキスト:**\n${formatted}`)
                    .setColor(PHASE_COLORS.timeout)
                    .setFooter({ text: `⏱️ 所要時間: ${elapsed}秒` })
                    .setTimestamp();
                await statusMsg.edit({ content: '', embeds: [timeoutEmbed] }).catch(() => { });

                const botId = message.client.user?.id;
                if (botId) {
                    await message.reactions.resolve('👀')?.users.remove(botId).catch(() => { });
                }
                await message.react('⚠️').catch(() => { });
            },
        });

        monitor.start();

    } catch (e: any) {
        isFinalized = true;
        if (pendingEditTimer) {
            clearTimeout(pendingEditTimer);
            pendingEditTimer = null;
        }

        const errorEmbed = new EmbedBuilder()
            .setTitle(`${PHASE_ICONS.error} エラー`)
            .setDescription(`処理中にエラーが発生しました: ${e.message}`)
            .setColor(PHASE_COLORS.error)
            .setTimestamp();
        await statusMsg.edit({ content: '', embeds: [errorEmbed] }).catch(() => { });

        const botId = message.client.user?.id;
        if (botId) {
            await message.reactions.resolve('👀')?.users.remove(botId).catch(() => { });
        }
        await message.react('❌').catch(() => { });
    }
}

// =============================================================================
// Bot メインエントリー
// =============================================================================

export const startBot = async () => {
    const config = loadConfig();

    const db = new Database('antigravity.db');
    const modeService = new ModeService();
    const modelService = new ModelService();
    const templateRepo = new TemplateRepository(db);
    const workspaceBindingRepo = new WorkspaceBindingRepository(db);
    const chatSessionRepo = new ChatSessionRepository(db);
    const workspaceService = new WorkspaceService(config.workspaceBaseDir);
    const channelManager = new ChannelManager();

    // Antigravityが起動していなければCDPポート付きで自動起動
    await ensureAntigravityRunning();

    // CDPブリッジの初期化（遅延接続: プール作成のみ）
    const bridge = initCdpBridge();

    // CDP依存サービスの初期化（コンストラクタCDP依存を除去済み）
    const chatSessionService = new ChatSessionService();
    const titleGenerator = new TitleGeneratorService();

    // コマンドハンドラーの初期化
    const wsHandler = new WorkspaceCommandHandler(workspaceBindingRepo, chatSessionRepo, workspaceService, channelManager);
    const chatHandler = new ChatCommandHandler(chatSessionService, chatSessionRepo, workspaceBindingRepo, channelManager, workspaceService, bridge.pool);

    const slashCommandHandler = new SlashCommandHandler(modeService, modelService, templateRepo);

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ]
    });

    client.once(Events.ClientReady, async (readyClient) => {
        console.error(`Ready! Logged in as ${readyClient.user.tag}`);

        try {
            await registerSlashCommands(config.discordToken, config.clientId, config.guildId);
        } catch (error) {
            console.error('スラッシュコマンドの登録に失敗しましたが、テキストコマンドは引き続き利用可能です。');
        }
    });

    // 【Discord Interactions API】スラッシュコマンドインタラクション処理
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        if (interaction.isButton()) {
            if (!config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: '権限がありません。', ephemeral: true }).catch(console.error);
                return;
            }

            try {
                if (interaction.customId === 'approve_action' || interaction.customId === 'deny_action') {
                    const detector = bridge.lastActiveWorkspace
                        ? bridge.pool.getApprovalDetector(bridge.lastActiveWorkspace)
                        : undefined;

                    if (!detector) {
                        try {
                            await interaction.reply({ content: '承認検出器が見つかりません。', ephemeral: true });
                        } catch { /* ignore */ }
                        return;
                    }

                    const isApprove = interaction.customId === 'approve_action';
                    const success = isApprove
                        ? await detector.approveButton()
                        : await detector.denyButton();

                    const content = isApprove
                        ? (success ? '承認しました！' : 'ボタンが見つかりませんでした')
                        : (success ? '拒否しました' : 'ボタンが見つかりませんでした');

                    try {
                        await interaction.deferUpdate();
                        await interaction.followUp({ content, ephemeral: true });
                    } catch (interactionError: any) {
                        if (interactionError?.code === 10062 || interactionError?.code === 40060) {
                            console.warn('[Approval] interaction期限切れ。チャンネルに直接応答します。');
                            if (interaction.channel && 'send' in interaction.channel) {
                                await (interaction.channel as any).send(content).catch(console.error);
                            }
                        } else {
                            throw interactionError;
                        }
                    }
                    return;
                }

                if (interaction.customId === 'model_refresh_btn') {
                    await interaction.deferUpdate();
                    await sendModelsUI({ editReply: async (data: any) => await interaction.editReply(data) }, bridge);
                    return;
                }

                if (interaction.customId.startsWith('model_btn_')) {
                    await interaction.deferUpdate();

                    const modelName = interaction.customId.replace('model_btn_', '');
                    const cdp = getCurrentCdp(bridge);

                    if (!cdp) {
                        await interaction.followUp({ content: 'CDPに未接続です。', ephemeral: true });
                        return;
                    }

                    const res = await cdp.setUiModel(modelName);

                    if (!res.ok) {
                        await interaction.followUp({ content: res.error || 'モデルの変更に失敗しました。', ephemeral: true });
                    } else {
                        await sendModelsUI({ editReply: async (data: any) => await interaction.editReply(data) }, bridge);
                        await interaction.followUp({ content: `モデルを **${res.model}** に変更しました！`, ephemeral: true });
                    }
                    return;
                }
            } catch (error) {
                console.error('ボタンインタラクションの処理中にエラーが発生:', error);

                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'ボタン操作の処理中にエラーが発生しました。', ephemeral: true });
                    } else {
                        await interaction.followUp({ content: 'ボタン操作の処理中にエラーが発生しました。', ephemeral: true }).catch(console.error);
                    }
                } catch (e) {
                    console.error('エラーメッセージの送信にも失敗しました:', e);
                }
            }
        }

        // モードDropdown選択処理
        if (interaction.isStringSelectMenu() && interaction.customId === 'mode_select') {
            if (!config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: '権限がありません。', ephemeral: true }).catch(console.error);
                return;
            }

            try {
                await interaction.deferUpdate();
            } catch (deferError: any) {
                // 10062: Unknown interaction — インタラクション期限切れ（重複プロセスなど）
                if (deferError?.code === 10062 || deferError?.code === 40060) {
                    console.warn('[Mode] deferUpdate期限切れ。スキップします。');
                    return;
                }
                console.error('[Mode] deferUpdate失敗:', deferError);
                return;
            }

            try {
                const selectedMode = interaction.values[0];

                modeService.setMode(selectedMode);

                const cdp = getCurrentCdp(bridge);
                if (cdp) {
                    const res = await cdp.setUiMode(selectedMode);
                    if (!res.ok) {
                        console.warn(`[Mode] UIモード切替失敗: ${res.error}`);
                    }
                }

                await sendModeUI({ editReply: async (data: any) => await interaction.editReply(data) }, modeService);
                await interaction.followUp({ content: `モードを **${MODE_DISPLAY_NAMES[selectedMode] || selectedMode}** に変更しました！`, ephemeral: true });
            } catch (error: any) {
                console.error('モードDropdown処理中にエラー:', error);
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({ content: 'モード変更中にエラーが発生しました。', ephemeral: true }).catch(console.error);
                    }
                } catch (e) {
                    console.error('エラーメッセージの送信にも失敗:', e);
                }
            }
            return;
        }

        // ワークスペースセレクトメニュー処理
        if (interaction.isStringSelectMenu() && (interaction.customId === PROJECT_SELECT_ID || interaction.customId === WORKSPACE_SELECT_ID)) {
            if (!config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: '権限がありません。', ephemeral: true }).catch(console.error);
                return;
            }

            if (!interaction.guild) {
                await interaction.reply({ content: 'サーバー内でのみ使用できます。', ephemeral: true }).catch(console.error);
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

        if (!config.allowedUserIds.includes(interaction.user.id)) {
            await commandInteraction.reply({
                content: 'このコマンドを使用する権限がありません。',
                ephemeral: true,
            }).catch(console.error);
            return;
        }

        try {
            await commandInteraction.deferReply();
        } catch (deferError: any) {
            // 10062: Unknown interaction — インタラクションの期限切れ（3秒超過）
            if (deferError?.code === 10062) {
                console.warn('[SlashCommand] インタラクション期限切れ（deferReply失敗）。スキップします。');
                return;
            }
            throw deferError;
        }

        try {
            await handleSlashInteraction(commandInteraction, slashCommandHandler, bridge, wsHandler, chatHandler, modeService, client);
        } catch (error) {
            console.error('スラッシュコマンドの処理でエラーが発生:', error);
            try {
                await commandInteraction.editReply({ content: 'コマンドの処理中にエラーが発生しました。' });
            } catch (replyError) {
                console.error('エラー応答の送信にも失敗:', replyError);
            }
        }
    });

    // 【テキストメッセージ処理】
    client.on(Events.MessageCreate, async (message: Message) => {
        if (message.author.bot) return;

        if (!config.allowedUserIds.includes(message.author.id)) {
            return;
        }

        const parsed = parseMessageContent(message.content);

        if (parsed.isCommand && parsed.commandName) {
            if (parsed.commandName === 'screenshot') {
                await handleScreenshot(message, bridge);
                return;
            }

            if (parsed.commandName === 'status') {
                const activeNames = bridge.pool.getActiveWorkspaceNames();
                if (activeNames.length === 0) {
                    await message.reply('ステータス: アクティブな接続なし');
                } else {
                    const lines = activeNames.map((name) => {
                        const cdp = bridge.pool.getConnected(name);
                        const contexts = cdp ? cdp.getContexts().length : 0;
                        const detectorActive = bridge.pool.getApprovalDetector(name)?.isActive() ? ' [検出中]' : '';
                        return `  - **${name}** — コンテキスト: ${contexts}${detectorActive}`;
                    });
                    await message.reply(`接続ステータス:\n${lines.join('\n')}`);
                }
                return;
            }

            // スラッシュコマンド専用コマンドはテキスト経由では処理しない
            const slashOnlyCommands = ['help', 'stop', 'model', 'mode', 'project', 'chat', 'new'];
            if (slashOnlyCommands.includes(parsed.commandName)) {
                await message.reply({
                    content: `💡 \`/${parsed.commandName}\` はスラッシュコマンドとして使用してください。\nDiscordの入力欄で \`/${parsed.commandName}\` と入力すると候補が表示されます。`,
                }).catch(console.error);
                return;
            }

            const result = await slashCommandHandler.handleCommand(parsed.commandName, parsed.args || []);

            await message.reply({
                content: result.message
            }).catch(console.error);

            if (result.prompt) {
                const cdp = getCurrentCdp(bridge);
                if (cdp) {
                    await sendPromptToAntigravity(bridge, message, result.prompt, cdp);
                } else {
                    await message.reply('CDPに未接続です。先にメッセージを送信してプロジェクトに接続してください。');
                }
            }
            return;
        }

        // 平文メッセージ → Antigravityにプロンプトとして送信
        if (message.content.trim()) {
            const workspacePath = wsHandler.getWorkspaceForChannel(message.channelId);

            if (workspacePath) {
                try {
                    const cdp = await bridge.pool.getOrConnect(workspacePath);
                    const dirName = bridge.pool.extractDirName(workspacePath);

                    bridge.lastActiveWorkspace = dirName;
                    bridge.lastActiveChannel = message.channel;

                    ensureApprovalDetector(bridge, cdp, dirName, client);

                    const session = chatSessionRepo.findByChannelId(message.channelId);
                    if (session && !session.isRenamed) {
                        try {
                            const chatResult = await chatSessionService.startNewChat(cdp);
                            if (!chatResult.ok) {
                                console.warn('[MessageCreate] Antigravityでの新規チャット開始に失敗:', chatResult.error);
                                (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => {});
                            }
                        } catch (err) {
                            console.error('[MessageCreate] startNewChat エラー:', err);
                            (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => {});
                        }
                    }

                    await autoRenameChannel(message, chatSessionRepo, titleGenerator, channelManager, cdp);

                    await sendPromptToAntigravity(bridge, message, message.content, cdp);
                } catch (e: any) {
                    await message.reply(`ワークスペース接続に失敗しました: ${e.message}`);
                    return;
                }
            } else {
                const cdp = getCurrentCdp(bridge);
                if (cdp) {
                    bridge.lastActiveChannel = message.channel;

                    const session = chatSessionRepo.findByChannelId(message.channelId);
                    if (session && !session.isRenamed) {
                        try {
                            const chatResult = await chatSessionService.startNewChat(cdp);
                            if (!chatResult.ok) {
                                console.warn('[MessageCreate|Fallback] Antigravityでの新規チャット開始に失敗:', chatResult.error);
                                (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => {});
                            }
                        } catch (err) {
                            console.error('[MessageCreate|Fallback] startNewChat エラー:', err);
                            (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => {});
                        }
                    }

                    await autoRenameChannel(message, chatSessionRepo, titleGenerator, channelManager, cdp);
                    await sendPromptToAntigravity(bridge, message, message.content, cdp);
                } else {
                    await message.reply('プロジェクトが設定されていません。`/project` でプロジェクトを作成してください。');
                }
            }
        }
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
    cdp?: CdpService,
): Promise<void> {
    const session = chatSessionRepo.findByChannelId(message.channelId);
    if (!session || session.isRenamed) return;

    const guild = message.guild;
    if (!guild) return;

    try {
        const title = await titleGenerator.generateTitle(message.content, cdp);
        const newName = `${session.sessionNumber}-${title}`;
        await channelManager.renameChannel(guild, message.channelId, newName);
        chatSessionRepo.updateDisplayName(message.channelId, title);
    } catch (err) {
        console.error('[AutoRename] リネーム失敗:', err);
    }
}

/**
 * /mode コマンドのインタラクティブなUIを組み立てて送信する（Dropdown方式）
 */
async function sendModeUI(
    target: { editReply: (opts: any) => Promise<any> },
    modeService: ModeService,
) {
    const currentMode = modeService.getCurrentMode();

    const embed = new EmbedBuilder()
        .setTitle('モード管理')
        .setColor(0x57F287)
        .setDescription(
            `**現在のモード:** ${MODE_DISPLAY_NAMES[currentMode] || currentMode}\n` +
            `${MODE_DESCRIPTIONS[currentMode] || ''}\n\n` +
            `**利用可能なモード (${AVAILABLE_MODES.length}件)**\n` +
            AVAILABLE_MODES.map(m => {
                const icon = m === currentMode ? '[x]' : '[ ]';
                return `${icon} **${MODE_DISPLAY_NAMES[m] || m}** — ${MODE_DESCRIPTIONS[m] || ''}`;
            }).join('\n')
        )
        .setFooter({ text: '下のドロップダウンからモードを選択してください' })
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('mode_select')
        .setPlaceholder('モードを選択...')
        .addOptions(
            AVAILABLE_MODES.map(m => ({
                label: MODE_DISPLAY_NAMES[m] || m,
                description: MODE_DESCRIPTIONS[m] || '',
                value: m,
                default: m === currentMode,
            }))
        );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await target.editReply({ content: '', embeds: [embed], components: [row] });
}

/**
 * /models コマンドのインタラクティブなUIを組み立てて送信する
 */
async function sendModelsUI(target: { editReply: (opts: any) => Promise<any> }, bridge: CdpBridge) {
    const cdp = getCurrentCdp(bridge);
    if (!cdp) {
        await target.editReply({ content: 'CDPに未接続です。' });
        return;
    }
    const models = await cdp.getUiModels();
    const currentModel = await cdp.getCurrentModel();
    const quotaData = await bridge.quota.fetchQuota();

    if (models.length === 0) {
        await target.editReply({ content: 'Antigravityのモデル一覧の取得に失敗しました。' });
        return;
    }

    function formatQuota(mName: string, current: boolean) {
        if (!mName) return `${current ? '[x]' : '[ ]'} 不明`;

        const q = quotaData.find(q => q.label === mName || mName.includes(q.label) || q.label.includes(mName));
        if (!q || q.quotaInfo?.remainingFraction === undefined) return `${current ? '[x]' : '[ ]'} ${mName}`;

        const rem = q.quotaInfo.remainingFraction;
        const percent = Math.round(rem * 100);
        let icon = 'OK';
        if (percent <= 20) icon = 'LOW';
        else if (percent <= 50) icon = 'MID';

        const resetTime = new Date(q.quotaInfo.resetTime);
        const diffMs = resetTime.getTime() - Date.now();
        let timeStr = 'Ready';
        if (diffMs > 0) {
            const mins = Math.ceil(diffMs / 60000);
            if (mins < 60) timeStr = `${mins}m`;
            else timeStr = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }

        return `${current ? '[x]' : '[ ]'} ${mName} [${icon}] ${percent}% (${timeStr})`;
    }

    const currentModelFormatted = currentModel ? formatQuota(currentModel, true) : '不明';

    const embed = new EmbedBuilder()
        .setTitle('モデル管理')
        .setColor(0x5865F2)
        .setDescription(`**現在のモデル:**\n${currentModelFormatted}\n\n` +
            `**利用可能なモデル (${models.length}件)**\n` +
            models.map(m => formatQuota(m, m === currentModel)).join('\n')
        )
        .setFooter({ text: '最新のQuota情報を取得しました' })
        .setTimestamp();

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    for (const mName of models.slice(0, 24)) {
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

    if (currentRow.components.length < 5) {
        currentRow.addComponents(new ButtonBuilder()
            .setCustomId('model_refresh_btn')
            .setLabel('更新')
            .setStyle(ButtonStyle.Primary)
        );
        rows.push(currentRow);
    } else {
        rows.push(currentRow);
        if (rows.length < 5) {
            const refreshRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('model_refresh_btn')
                    .setLabel('更新')
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
    const cdp = getCurrentCdp(bridge);
    if (!cdp) {
        const content = 'Antigravityに接続されていません。';
        if (target instanceof Message) {
            await target.reply(content);
        } else {
            await target.editReply({ content });
        }
        return;
    }

    try {
        const screenshot = new ScreenshotService({ cdpService: cdp });
        const result = await screenshot.capture({ format: 'png' });
        if (result.success && result.buffer) {
            const attachment = new AttachmentBuilder(result.buffer, { name: 'screenshot.png' });
            if (target instanceof Message) {
                await target.reply({ files: [attachment] });
            } else {
                await target.editReply({ files: [attachment] });
            }
        } else {
            const content = `スクリーンショット失敗: ${result.error}`;
            if (target instanceof Message) {
                await target.reply(content);
            } else {
                await target.editReply({ content });
            }
        }
    } catch (e: any) {
        const content = `スクリーンショットエラー: ${e.message}`;
        if (target instanceof Message) {
            await target.reply(content);
        } else {
            await target.editReply({ content });
        }
    }
}

/**
 * Discord Interactions API のスラッシュコマンドを処理する
 */
async function handleSlashInteraction(
    interaction: ChatInputCommandInteraction,
    handler: SlashCommandHandler,
    bridge: CdpBridge,
    wsHandler: WorkspaceCommandHandler,
    chatHandler: ChatCommandHandler,
    modeService: ModeService,
    _client: Client,
): Promise<void> {
    const commandName = interaction.commandName;

    switch (commandName) {
        case 'help': {
            const embed = new EmbedBuilder()
                .setTitle('📖 AntigravityClaw コマンド一覧')
                .setColor(0x5865F2)
                .setDescription('Antigravity を Discord から操作するためのコマンドです。')
                .addFields(
                    {
                        name: '💬 チャット', value: [
                            '`/new` — 新しいチャットセッションを開始',
                            '`/chat` — 現在のセッション情報 + 一覧を表示',
                        ].join('\n')
                    },
                    {
                        name: '⏹️ 制御', value: [
                            '`/stop` — 動作中のLLM生成を中断',
                            '`/screenshot` — Antigravityの画面をキャプチャ',
                        ].join('\n')
                    },
                    {
                        name: '⚙️ 設定', value: [
                            '`/mode` — 実行モードを表示・変更',
                            '`/model [name]` — LLMモデルを表示・変更',
                        ].join('\n')
                    },
                    {
                        name: '📁 プロジェクト', value: [
                            '`/project` — プロジェクト一覧を表示',
                            '`/project create <name>` — 新規プロジェクトを作成',
                        ].join('\n')
                    },
                    {
                        name: '📝 テンプレート', value: [
                            '`/template list` — テンプレート一覧を表示',
                            '`/template use <name>` — テンプレートを実行',
                            '`/template add <name> <prompt>` — テンプレートを登録',
                            '`/template delete <name>` — テンプレートを削除',
                        ].join('\n')
                    },
                    {
                        name: '🔧 システム', value: [
                            '`/status` — Bot全体のステータスを表示',
                            '`/help` — このヘルプを表示',
                        ].join('\n')
                    },
                )
                .setFooter({ text: 'テキストメッセージはそのままAntigravityに送信されます' })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
            break;
        }

        case 'mode': {
            await sendModeUI(interaction, modeService);
            break;
        }

        case 'model': {
            const modelName = interaction.options.getString('name');
            if (!modelName) {
                await sendModelsUI(interaction, bridge);
            } else {
                const cdp = getCurrentCdp(bridge);
                if (!cdp) {
                    await interaction.editReply({ content: 'CDPに未接続です。' });
                    break;
                }
                const res = await cdp.setUiModel(modelName);
                if (res.ok) {
                    await interaction.editReply({ content: `モデルを **${res.model}** に変更しました。` });
                } else {
                    await interaction.editReply({ content: res.error || 'モデルの変更に失敗しました。' });
                }
            }
            break;
        }

        case 'template': {
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

            const result = await handler.handleCommand('template', args);
            await interaction.editReply({ content: result.message });

            if (result.prompt && interaction.channel) {
                const followUp = await interaction.followUp({
                    content: 'テンプレートのプロンプトをAntigravityに送信中...',
                });
                if (followUp instanceof Message) {
                    const cdp = getCurrentCdp(bridge);
                    if (cdp) {
                        await sendPromptToAntigravity(bridge, followUp, result.prompt, cdp);
                    }
                }
            }
            break;
        }

        case 'status': {
            const activeNames = bridge.pool.getActiveWorkspaceNames();
            const currentModel = (() => {
                const cdp = getCurrentCdp(bridge);
                return cdp ? 'CDP接続中' : '未接続';
            })();
            const currentMode = modeService.getCurrentMode();

            const embed = new EmbedBuilder()
                .setTitle('🔧 Bot ステータス')
                .setColor(activeNames.length > 0 ? 0x00CC88 : 0x888888)
                .addFields(
                    { name: 'CDP接続', value: activeNames.length > 0 ? `🟢 ${activeNames.length} プロジェクト接続中` : '⚪ 未接続', inline: true },
                    { name: 'モード', value: MODE_DISPLAY_NAMES[currentMode] || currentMode, inline: true },
                )
                .setTimestamp();

            if (activeNames.length > 0) {
                const lines = activeNames.map((name) => {
                    const cdp = bridge.pool.getConnected(name);
                    const contexts = cdp ? cdp.getContexts().length : 0;
                    const detectorActive = bridge.pool.getApprovalDetector(name)?.isActive() ? ' [検出中]' : '';
                    return `• **${name}** — コンテキスト: ${contexts}${detectorActive}`;
                });
                embed.setDescription(`**接続中のプロジェクト:**\n${lines.join('\n')}`);
            } else {
                embed.setDescription('メッセージを送信すると自動的にプロジェクトに接続します。');
            }

            await interaction.editReply({ embeds: [embed] });
            break;
        }

        case 'screenshot': {
            await handleScreenshot(interaction, bridge);
            break;
        }

        case 'stop': {
            const cdp = getCurrentCdp(bridge);
            if (!cdp) {
                await interaction.editReply({ content: '⚠️ CDPに未接続です。先にプロジェクトに接続してください。' });
                break;
            }

            try {
                const contextId = cdp.getPrimaryContextId();
                const callParams: Record<string, unknown> = {
                    expression: RESPONSE_SELECTORS.CLICK_STOP_BUTTON,
                    returnByValue: true,
                    awaitPromise: false,
                };
                if (contextId !== null) {
                    callParams.contextId = contextId;
                }

                const result = await cdp.call('Runtime.evaluate', callParams);
                const value = result?.result?.value;

                if (value?.ok) {
                    const embed = new EmbedBuilder()
                        .setTitle('⏹️ LLM生成を中断しました')
                        .setDescription('ストップボタンをクリックしました。生成が中断されます。')
                        .setColor(0xE74C3C)
                        .addFields({ name: '方法', value: value.method || 'click', inline: true })
                        .setTimestamp();
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('⚠️ 停止できませんでした')
                        .setDescription(value?.error || 'ストップボタンが見つかりません。LLMが動作中でない可能性があります。')
                        .setColor(0xF39C12)
                        .setTimestamp();
                    await interaction.editReply({ embeds: [embed] });
                }
            } catch (e: any) {
                await interaction.editReply({ content: `❌ 停止処理中にエラーが発生しました: ${e.message}` });
            }
            break;
        }

        case 'project': {
            const wsSub = interaction.options.getSubcommand(false);
            if (wsSub === 'create') {
                if (!interaction.guild) {
                    await interaction.editReply({ content: 'サーバー内でのみ使用できます。' });
                    break;
                }
                await wsHandler.handleCreate(interaction, interaction.guild);
            } else {
                // /project list or /project (デフォルト)
                await wsHandler.handleShow(interaction);
            }
            break;
        }

        case 'new': {
            await chatHandler.handleNew(interaction);
            break;
        }

        case 'chat': {
            await chatHandler.handleChat(interaction);
            break;
        }

        default:
            await interaction.editReply({
                content: `未知のコマンドです: /${commandName}`,
            });
    }
}
