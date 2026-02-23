import { t } from "../utils/i18n";
import { logger } from '../utils/logger';
import {
    Client, GatewayIntentBits, Events, Message,
    ChatInputCommandInteraction, Interaction,
    AttachmentBuilder, ButtonBuilder, ButtonStyle,
    ActionRowBuilder, EmbedBuilder,
    StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import Database from 'better-sqlite3';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { loadConfig } from '../utils/config';
import { parseMessageContent } from '../commands/messageParser';
import { SlashCommandHandler } from '../commands/slashCommandHandler';
import { registerSlashCommands } from '../commands/registerSlashCommands';

import { ModeService, AVAILABLE_MODES, MODE_DISPLAY_NAMES, MODE_DESCRIPTIONS, MODE_UI_NAMES } from '../services/modeService';
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
import {
    CleanupCommandHandler,
    CLEANUP_ARCHIVE_BTN,
    CLEANUP_DELETE_BTN,
    CLEANUP_CANCEL_BTN,
} from '../commands/cleanupCommandHandler';
import { ChannelManager } from '../services/channelManager';
import { TitleGeneratorService } from '../services/titleGeneratorService';

// CDP連携サービス
import { CdpService, ExtractedResponseImage } from '../services/cdpService';
import { CdpConnectionPool } from '../services/cdpConnectionPool';
import { ChatSessionService } from '../services/chatSessionService';
import { ResponseMonitor, RESPONSE_SELECTORS } from '../services/responseMonitor';
import { ScreenshotService } from '../services/screenshotService';
import { ApprovalDetector, ApprovalInfo } from '../services/approvalDetector';
import { QuotaService } from '../services/quotaService';
import { ensureAntigravityRunning } from '../services/antigravityLauncher';
import { AutoAcceptService } from '../services/autoAcceptService';
import { buildModeModelLines, splitForEmbedDescription } from '../utils/streamMessageFormatter';

// =============================================================================
// CDP ブリッジ: Discord ↔ Antigravity の結線
// =============================================================================

/** CDP接続の状態管理 */
interface CdpBridge {
    pool: CdpConnectionPool;
    quota: QuotaService;
    autoAccept: AutoAcceptService;
    /** 最後にメッセージを送信したワークスペースのディレクトリ名 */
    lastActiveWorkspace: string | null;
    /** 最後にメッセージを送信したチャンネル（承認通知の送信先） */
    lastActiveChannel: Message['channel'] | null;
}

const APPROVE_ACTION_PREFIX = 'approve_action';
const ALWAYS_ALLOW_ACTION_PREFIX = 'always_allow_action';
const DENY_ACTION_PREFIX = 'deny_action';

function buildApprovalCustomId(action: 'approve' | 'always_allow' | 'deny', workspaceDirName: string): string {
    const prefix = action === 'approve'
        ? APPROVE_ACTION_PREFIX
        : action === 'always_allow'
            ? ALWAYS_ALLOW_ACTION_PREFIX
            : DENY_ACTION_PREFIX;
    return `${prefix}:${workspaceDirName}`;
}

function parseApprovalCustomId(customId: string): { action: 'approve' | 'always_allow' | 'deny'; workspaceDirName: string | null } | null {
    if (customId === APPROVE_ACTION_PREFIX) {
        return { action: 'approve', workspaceDirName: null };
    }
    if (customId === ALWAYS_ALLOW_ACTION_PREFIX) {
        return { action: 'always_allow', workspaceDirName: null };
    }
    if (customId === DENY_ACTION_PREFIX) {
        return { action: 'deny', workspaceDirName: null };
    }
    if (customId.startsWith(`${APPROVE_ACTION_PREFIX}:`)) {
        return { action: 'approve', workspaceDirName: customId.substring(`${APPROVE_ACTION_PREFIX}:`.length) || null };
    }
    if (customId.startsWith(`${ALWAYS_ALLOW_ACTION_PREFIX}:`)) {
        return { action: 'always_allow', workspaceDirName: customId.substring(`${ALWAYS_ALLOW_ACTION_PREFIX}:`.length) || null };
    }
    if (customId.startsWith(`${DENY_ACTION_PREFIX}:`)) {
        return { action: 'deny', workspaceDirName: customId.substring(`${DENY_ACTION_PREFIX}:`.length) || null };
    }
    return null;
}

/** CDPブリッジを初期化する（遅延接続: プール作成のみ） */
function initCdpBridge(autoApproveDefault: boolean): CdpBridge {
    const pool = new CdpConnectionPool({
        cdpCallTimeout: 15000,
        maxReconnectAttempts: 5,
        reconnectDelayMs: 3000,
    });

    const quota = new QuotaService();
    const autoAccept = new AutoAcceptService(autoApproveDefault);

    return {
        pool,
        quota,
        autoAccept,
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
            logger.info(`[ApprovalDetector:${workspaceDirName}] 承認ボタン検出 (allow="${info.approveText}", deny="${info.denyText}")`);

            if (bridge.autoAccept.isEnabled()) {
                const accepted = await detector.alwaysAllowButton() || await detector.approveButton();

                const targetChannel = bridge.lastActiveChannel;
                if (targetChannel && 'send' in targetChannel) {
                    const autoEmbed = new EmbedBuilder()
                        .setTitle(accepted ? t('Auto-approved') : t('Auto-approve failed'))
                        .setDescription(info.description || t('Antigravity is requesting approval for an action'))
                        .setColor(accepted ? 0x2ECC71 : 0xF39C12)
                        .addFields(
                            { name: t('Auto-approve mode'), value: t('ON'), inline: true },
                            { name: t('Workspace'), value: workspaceDirName, inline: true },
                            { name: t('Result'), value: accepted ? t('Executed Always Allow/Allow') : t('Manual approval required'), inline: true },
                        )
                        .setTimestamp();
                    await (targetChannel as any).send({ embeds: [autoEmbed] }).catch(logger.error);
                }

                if (accepted) {
                    return;
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(t('Approval Required'))
                .setDescription(info.description || t('Antigravity is requesting approval for an action'))
                .setColor(0xFFA500)
                .addFields(
                    { name: t('Allow button'), value: info.approveText, inline: true },
                    { name: t('Allow Chat button'), value: info.alwaysAllowText || t('In Dropdown'), inline: true },
                    { name: t('Deny button'), value: info.denyText || t('(None)'), inline: true },
                    { name: t('Workspace'), value: workspaceDirName, inline: true },
                )
                .setTimestamp();

            const approveBtn = new ButtonBuilder()
                .setCustomId(buildApprovalCustomId('approve', workspaceDirName))
                .setLabel(t('Allow'))
                .setStyle(ButtonStyle.Success);

            const alwaysAllowBtn = new ButtonBuilder()
                .setCustomId(buildApprovalCustomId('always_allow', workspaceDirName))
                .setLabel(t('Allow Chat'))
                .setStyle(ButtonStyle.Primary);

            const denyBtn = new ButtonBuilder()
                .setCustomId(buildApprovalCustomId('deny', workspaceDirName))
                .setLabel(t('Deny'))
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, alwaysAllowBtn, denyBtn);

            const targetChannel = bridge.lastActiveChannel;
            if (targetChannel && 'send' in targetChannel) {
                (targetChannel as any).send({
                    embeds: [embed],
                    components: [row],
                }).catch(logger.error);
            } else {
                logger.warn(`[ApprovalDetector:${workspaceDirName}] 送信先チャンネル未確定のため承認通知をスキップしました`);
            }
        },
    });

    detector.start();
    bridge.pool.registerApprovalDetector(workspaceDirName, detector);
    logger.info(`[ApprovalDetector:${workspaceDirName}] 承認ボタン検出を開始しました`);
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

const MAX_INBOUND_IMAGE_ATTACHMENTS = 4;
const MAX_OUTBOUND_GENERATED_IMAGES = 4;
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|webp|gif|bmp)$/i;
const TEMP_IMAGE_DIR = path.join(os.tmpdir(), 'lazy-gravity-images');
const RESPONSE_DELIVERY_MODE = (
    process.env.LAZYGRAVITY_RESPONSE_DELIVERY ||
    process.env.LAZYGRAVITY_RESPONSE_MODE ||
    'final-only'
).trim().toLowerCase();
const USE_FINAL_ONLY_RESPONSE = RESPONSE_DELIVERY_MODE !== 'stream';
const FINAL_ONLY_POLL_INTERVAL_MS = Math.max(
    400,
    Number(process.env.LAZYGRAVITY_FINAL_ONLY_POLL_MS || process.env.LAZYGRAVITY_ONE_SHOT_POLL_MS || 1000),
);
const FINAL_ONLY_MAX_WAIT_MS = Math.max(
    15000,
    Number(process.env.LAZYGRAVITY_FINAL_ONLY_MAX_WAIT_MS || process.env.LAZYGRAVITY_ONE_SHOT_MAX_WAIT_MS || 180000),
);
const FINAL_ONLY_STOP_STABLE_MS = Math.max(
    1000,
    Number(process.env.LAZYGRAVITY_FINAL_ONLY_STOP_STABLE_MS || process.env.LAZYGRAVITY_ONE_SHOT_STOP_STABLE_MS || 2500),
);
const FINAL_ONLY_TEXT_STABLE_MS = Math.max(
    2000,
    Number(process.env.LAZYGRAVITY_FINAL_ONLY_TEXT_STABLE_MS || process.env.LAZYGRAVITY_ONE_SHOT_TEXT_STABLE_MS || 10000),
);

interface InboundImageAttachment {
    localPath: string;
    url: string;
    name: string;
    mimeType: string;
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

function isImageAttachment(contentType: string | null | undefined, fileName: string | null | undefined): boolean {
    if ((contentType || '').toLowerCase().startsWith('image/')) return true;
    return IMAGE_EXT_PATTERN.test(fileName || '');
}

function mimeTypeToExtension(mimeType: string): string {
    const normalized = (mimeType || '').toLowerCase();
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('gif')) return 'gif';
    if (normalized.includes('bmp')) return 'bmp';
    return 'png';
}

function sanitizeFileName(fileName: string): string {
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    return sanitized || `image-${Date.now()}.png`;
}

function buildPromptWithAttachmentUrls(prompt: string, attachments: InboundImageAttachment[]): string {
    const base = prompt.trim() || '添付画像を確認して対応してください。';
    if (attachments.length === 0) return base;

    const lines = attachments.map((image, index) =>
        `${index + 1}. ${image.name}\nURL: ${image.url}`,
    );

    return `${base}\n\n[Discord添付画像]\n${lines.join('\n\n')}\n\n上記の添付画像を参照して回答してください。`;
}

async function downloadInboundImageAttachments(message: Message): Promise<InboundImageAttachment[]> {
    const allAttachments = Array.from(message.attachments.values());
    const imageAttachments = allAttachments
        .filter((attachment) => isImageAttachment(attachment.contentType, attachment.name))
        .slice(0, MAX_INBOUND_IMAGE_ATTACHMENTS);

    if (imageAttachments.length === 0) return [];

    await fs.mkdir(TEMP_IMAGE_DIR, { recursive: true });

    const downloaded: InboundImageAttachment[] = [];
    let index = 0;
    for (const attachment of imageAttachments) {
        try {
            const response = await fetch(attachment.url);
            if (!response.ok) {
                logger.warn(`[ImageBridge] 添付画像ダウンロード失敗 (id=${attachment.id || 'unknown'}, status=${response.status})`);
                continue;
            }

            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length === 0) continue;

            const mimeType = attachment.contentType || 'image/png';
            const hasExt = IMAGE_EXT_PATTERN.test(attachment.name || '');
            const ext = mimeTypeToExtension(mimeType);
            const originalName = sanitizeFileName(attachment.name || `discord-image-${index + 1}.${ext}`);
            const name = hasExt ? originalName : `${originalName}.${ext}`;
            const localPath = path.join(
                TEMP_IMAGE_DIR,
                `${Date.now()}-${message.id}-${index}-${name}`,
            );

            await fs.writeFile(localPath, bytes);
            downloaded.push({
                localPath,
                url: attachment.url,
                name,
                mimeType,
            });
            index += 1;
        } catch (error: any) {
            logger.warn(`[ImageBridge] 添付画像処理失敗 (id=${attachment.id || 'unknown'})`, error?.message || error);
        }
    }

    return downloaded;
}

async function cleanupInboundImageAttachments(attachments: InboundImageAttachment[]): Promise<void> {
    for (const image of attachments) {
        await fs.unlink(image.localPath).catch(() => { });
    }
}

async function toDiscordAttachment(image: ExtractedResponseImage, index: number): Promise<AttachmentBuilder | null> {
    let buffer: Buffer | null = null;
    let mimeType = image.mimeType || 'image/png';

    if (image.base64Data) {
        try {
            buffer = Buffer.from(image.base64Data, 'base64');
        } catch {
            buffer = null;
        }
    } else if (image.url && /^https?:\/\//i.test(image.url)) {
        try {
            const response = await fetch(image.url);
            if (response.ok) {
                buffer = Buffer.from(await response.arrayBuffer());
                mimeType = response.headers.get('content-type') || mimeType;
            }
        } catch {
            buffer = null;
        }
    }

    if (!buffer || buffer.length === 0) return null;

    const fallbackExt = mimeTypeToExtension(mimeType);
    const baseName = sanitizeFileName(image.name || `generated-image-${index + 1}.${fallbackExt}`);
    const finalName = IMAGE_EXT_PATTERN.test(baseName) ? baseName : `${baseName}.${fallbackExt}`;
    return new AttachmentBuilder(buffer, { name: finalName });
}

/**
 * Discordのメッセージ（プロンプト）をAntigravityに送信し、応答を待ってDiscordに返す
 *
 * メッセージ戦略:
 *   - 編集ではなく工程ごとに新規メッセージを送信して履歴を残す
 *   - 計画/分析/実行確認/実装内容の流れをログとして可視化する
 */
async function sendPromptToAntigravity(
    bridge: CdpBridge,
    message: Message,
    prompt: string,
    cdp: CdpService,
    modeService: ModeService,
    modelService: ModelService,
    inboundImages: InboundImageAttachment[] = [],
    options?: {
        chatSessionService: ChatSessionService;
        chatSessionRepo: ChatSessionRepository;
        channelManager: ChannelManager;
        titleGenerator: TitleGeneratorService;
    }
): Promise<void> {
    // コマンド受付のリアクションを追加
    await message.react('👀').catch(() => { });

    const channel = (message.channel && 'send' in message.channel) ? message.channel as any : null;
    const monitorTraceId = `${message.channelId}:${message.id}`;
    const enqueueSend = (() => {
        let queue: Promise<void> = Promise.resolve();
        let queueDepth = 0;
        let taskSeq = 0;

        return (task: () => Promise<void>, label: string = 'queue-task') => {
            taskSeq += 1;
            const seq = taskSeq;
            const enqueuedAt = Date.now();
            queueDepth += 1;
            logger.debug(`[sendQueue:${monitorTraceId}] enqueued #${seq} label=${label} depth=${queueDepth}`);

            queue = queue.then(async () => {
                const waitMs = Date.now() - enqueuedAt;
                logger.debug(`[sendQueue:${monitorTraceId}] start #${seq} label=${label} wait=${waitMs}ms depth=${queueDepth}`);
                try {
                    await task();
                    logger.debug(`[sendQueue:${monitorTraceId}] done #${seq} label=${label}`);
                } catch (err: any) {
                    logger.error(`[sendQueue:${monitorTraceId}] error #${seq} label=${label}:`, err?.message || err);
                } finally {
                    queueDepth = Math.max(0, queueDepth - 1);
                    logger.debug(`[sendQueue:${monitorTraceId}] settle #${seq} label=${label} depth=${queueDepth}`);
                }
            });

            return queue;
        };
    })();

    const sendEmbed = (
        title: string,
        description: string,
        color: number,
        fields?: { name: string; value: string; inline?: boolean }[],
        footerText?: string,
    ): Promise<void> => enqueueSend(async () => {
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();
        if (fields && fields.length > 0) {
            embed.addFields(...fields);
        }
        if (footerText) {
            embed.setFooter({ text: footerText });
        }
        await channel.send({ embeds: [embed] }).catch(() => { });
    }, 'send-embed');

    const shouldTryGeneratedImages = (inputPrompt: string, responseText: string): boolean => {
        const prompt = (inputPrompt || '').toLowerCase();
        const response = (responseText || '').toLowerCase();
        const imageIntentPattern = /(image|images|png|jpg|jpeg|gif|webp|illustration|diagram|render|画像|イメージ|図|描いて|生成して)/i;
        const imageUrlPattern = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)/i;

        if (imageIntentPattern.test(prompt)) return true;
        if (response.includes('![') || imageUrlPattern.test(response)) return true;
        return false;
    };

    const sendGeneratedImages = async (responseText: string): Promise<void> => {
        if (!channel) return;
        if (!shouldTryGeneratedImages(prompt, responseText)) return;

        const extracted = await cdp.extractLatestResponseImages(MAX_OUTBOUND_GENERATED_IMAGES);
        if (extracted.length === 0) return;

        const files: AttachmentBuilder[] = [];
        for (let i = 0; i < extracted.length; i++) {
            const attachment = await toDiscordAttachment(extracted[i], i);
            if (attachment) files.push(attachment);
        }
        if (files.length === 0) return;

        await enqueueSend(async () => {
            await channel.send({
                content: t(`🖼️ Detected generated images (${files.length})`),
                files,
            }).catch(() => { });
        }, 'send-generated-images');
    };

    const tryEmergencyExtractText = async (): Promise<string> => {
        try {
            const contextId = cdp.getPrimaryContextId();
            const expression = `(() => {
                const panel = document.querySelector('.antigravity-agent-side-panel');
                const scope = panel || document;

                const candidateSelectors = [
                    '.rendered-markdown',
                    '.leading-relaxed.select-text',
                    '.flex.flex-col.gap-y-3',
                    '[data-message-author-role="assistant"]',
                    '[data-message-role="assistant"]',
                    '[class*="assistant-message"]',
                    '[class*="message-content"]',
                    '[class*="markdown-body"]',
                    '.prose',
                ];

                const looksLikeActivity = (text) => {
                    const normalized = (text || '').trim().toLowerCase();
                    if (!normalized) return true;
                    const activityPattern = /^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|analyzed|read|wrote|ran|処理中|実行中|生成中|思考中|分析中|解析中|読み込み中|書き込み中|待機中)/i;
                    return activityPattern.test(normalized) && normalized.length <= 220;
                };

                const clean = (text) => (text || '').replace(/\\r/g, '').replace(/\\n{3,}/g, '\\n\\n').trim();

                const candidates = [];
                const seen = new Set();
                for (const selector of candidateSelectors) {
                    const nodes = scope.querySelectorAll(selector);
                    for (const node of nodes) {
                        if (!node || seen.has(node)) continue;
                        seen.add(node);
                        candidates.push(node);
                    }
                }

                for (let i = candidates.length - 1; i >= 0; i--) {
                    const node = candidates[i];
                    const text = clean(node.innerText || node.textContent || '');
                    if (!text || text.length < 20) continue;
                    if (looksLikeActivity(text)) continue;
                    if (/^(good|bad)$/i.test(text)) continue;
                    return text;
                }

                return '';
            })()`;

            const callParams: Record<string, unknown> = {
                expression,
                returnByValue: true,
                awaitPromise: true,
            };
            if (contextId !== null) callParams.contextId = contextId;
            const res = await cdp.call('Runtime.evaluate', callParams);
            const value = res?.result?.value;
            return typeof value === 'string' ? value.trim() : '';
        } catch {
            return '';
        }
    };

    const clearWatchingReaction = async (): Promise<void> => {
        const botId = message.client.user?.id;
        if (botId) {
            await message.reactions.resolve('👀')?.users.remove(botId).catch(() => { });
        }
    };

    if (!cdp.isConnected()) {
        await sendEmbed(
            `${PHASE_ICONS.error} 接続エラー`,
            'Antigravityに接続されていません。\n`open -a Antigravity --args --remote-debugging-port=9223` で起動後、メッセージを送信すると自動接続されます。',
            PHASE_COLORS.error,
        );
        await clearWatchingReaction();
        await message.react('❌').catch(() => { });
        return;
    }

    const localMode = modeService.getCurrentMode();
    const modeName = MODE_UI_NAMES[localMode] || localMode;
    const currentModel = (await cdp.getCurrentModel()) || modelService.getCurrentModel();
    const fastModel = currentModel;
    const planModel = currentModel;

    await sendEmbed(
        `${PHASE_ICONS.sending} [${modeName} - ${currentModel}${localMode === 'plan' ? ' (Thinking)' : ''}] 伝達中...`,
        buildModeModelLines(modeName, fastModel, planModel).join('\n'),
        PHASE_COLORS.sending,
    );

    let isFinalized = false;
    let lastProgressText = '';
    let lastActivityLogText = '';
    const LIVE_RESPONSE_MAX_LEN = 3800;
    const LIVE_ACTIVITY_MAX_LEN = 3800;
    const liveResponseMessages: any[] = [];
    const liveActivityMessages: any[] = [];
    let lastLiveResponseKey = '';
    let lastLiveActivityKey = '';
    let liveResponseUpdateVersion = 0;
    let liveActivityUpdateVersion = 0;

    const PROCESS_LINE_PATTERN = /^(?:\[[A-Z]+\]|\[(?:ResponseMonitor|CdpService|ApprovalDetector|AntigravityLauncher)[^\]]*\]|(?:analy[sz]ing|analy[sz]ed|reading|writing|running|searching|searched|planning|thinking|processing|loading|executing|executed|testing|debugging|thought for|looked|opened|closed|connected|sent|received|parsed|scanned|validated|compared|computed|evaluated|launched|fetched|downloaded|uploaded|committed|pushed|pulled|merged|created|deleted|updated|modified|refactored)\b|(?:処理中|実行中|生成中|思考中|分析中|解析中|読み込み中|書き込み中|待機中))/i;
    const PROCESS_KEYWORD_PATTERN = /\b(?:run|running|read|reading|write|writing|search|searching|analy[sz]e?|plan(?:ning)?|debug|test|compile|execute|retrieval|directory|commencing|initiating|checking)\b/i;
    const PROCESS_PARAGRAPH_PATTERN = /(?:thought for\s*<?\d+s|initiating step[- ]by[- ]step action|advancing toward a goal|i[' ]?m now focused|i am now focused|i[' ]?m now zeroing in|i am now zeroing in|carefully considering|analyzing the data|refining my approach|planned execution|next milestone|subsequent stage|plan is forming|progressing steadily|actions to take|aim is to make definitive steps|commencing information retrieval|checking global skills directory|initiating task execution|思考中|これから実行|次の手順|方針を検討)/i;
    const FIRST_PERSON_PATTERN = /\b(?:i|i'm|i’ve|i'll|i am|my|we|we're|our)\b|(?:私|僕|わたし|我々)/i;
    const ABSTRACT_PROGRESS_PATTERN = /\b(?:focus|focusing|plan|planning|progress|goal|milestone|subsequent|approach|action|execution|execute|next step|aim|zeroing in|steadily)\b|(?:方針|手順|進捗|目標|計画|実行方針|次の段階)/i;
    const TOOL_TRACE_LINE_PATTERN = /^(?:mcp tool\b|show details\b|thought for\s*<?\d+s|initiating task execution\b|commencing information retrieval\b|checking global skills directory\b|tool call:|tool result:|calling tool\b|tool response\b|running mcp\b|\[mcp\]|mcp server\b)/i;
    const ACTIVITY_PLACEHOLDER = t('Collecting process logs...');

    const splitOutputAndLogs = (rawText: string): { output: string; logs: string } => {
        const normalized = (rawText || '').replace(/\r/g, '');
        if (!normalized.trim()) {
            return { output: '', logs: '' };
        }

        const outputLines: string[] = [];
        const logLines: string[] = [];
        let inCodeBlock = false;

        const lines = normalized.split('\n');
        for (const originalLine of lines) {
            const line = originalLine ?? '';
            const trimmed = line.trim();

            if (trimmed.startsWith('```')) {
                inCodeBlock = !inCodeBlock;
                outputLines.push(line);
                continue;
            }

            if (inCodeBlock) {
                outputLines.push(line);
                continue;
            }

            if (!trimmed) {
                outputLines.push(line);
                continue;
            }

            const looksProcess =
                PROCESS_LINE_PATTERN.test(trimmed) ||
                PROCESS_PARAGRAPH_PATTERN.test(trimmed) ||
                TOOL_TRACE_LINE_PATTERN.test(trimmed) ||
                (/^\[[^\]]+\]/.test(trimmed) && trimmed.length <= 280) ||
                (/^(?:\d+\.\s*)?(?:tool|step|action|task)\b/i.test(trimmed) && trimmed.length <= 280) ||
                (/^(?:ran|read|wrote|executed|searching|searched|planning|thinking|processing|thought for|looked|opened|closed|connected|sent|received|parsed|fetched|created|deleted|updated|scanned|launched)\b/i.test(trimmed) && trimmed.length <= 280) ||
                (trimmed.length <= 120 && PROCESS_KEYWORD_PATTERN.test(trimmed) && /[:`\-\[]/.test(trimmed));

            if (looksProcess) {
                logLines.push(trimmed);
            } else {
                outputLines.push(line);
            }
        }

        const normalizeText = (text: string): string =>
            text
                .replace(/\n{3,}/g, '\n\n')
                .trim();

        // 第2段階: 行分類後の本文を段落単位で再評価し、抽象的な思考文をログへ移動
        const outputText = normalizeText(outputLines.join('\n'));
        const movedLogBlocks: string[] = [];
        const keptOutputBlocks: string[] = [];
        const outputBlocks = outputText ? outputText.split(/\n{2,}/) : [];
        for (const block of outputBlocks) {
            const trimmed = (block || '').trim();
            if (!trimmed) continue;

            const lower = trimmed.toLowerCase();
            const looksAbstractProcess =
                PROCESS_PARAGRAPH_PATTERN.test(trimmed) ||
                TOOL_TRACE_LINE_PATTERN.test(trimmed) ||
                (
                    FIRST_PERSON_PATTERN.test(trimmed) &&
                    ABSTRACT_PROGRESS_PATTERN.test(trimmed) &&
                    trimmed.length >= 40 &&
                    !/```|`[^`]+`/.test(trimmed)
                ) ||
                (/^advancing toward /i.test(trimmed) && trimmed.length <= 120) ||
                (/^initiating /i.test(trimmed) && trimmed.length <= 120);

            if (looksAbstractProcess) {
                movedLogBlocks.push(trimmed);
                continue;
            }
            keptOutputBlocks.push(trimmed);
        }

        const dedupedLogs = Array.from(
            new Set(
                [...logLines, ...movedLogBlocks]
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0),
            ),
        );

        return {
            output: normalizeText(keptOutputBlocks.join('\n\n')),
            logs: normalizeText(dedupedLogs.join('\n')),
        };
    };

    const sanitizeActivityLines = (raw: string): string => {
        const lines = (raw || '')
            .replace(/\r/g, '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        const kept = lines.filter((line) => {
            if (TOOL_TRACE_LINE_PATTERN.test(line)) return false;
            if (/^mcp\b/i.test(line) && line.length > 120) return false;
            if (FIRST_PERSON_PATTERN.test(line) && ABSTRACT_PROGRESS_PATTERN.test(line) && line.length >= 60) {
                return false;
            }
            return true;
        });

        return Array.from(new Set(kept)).join('\n');
    };

    const buildLiveResponseDescriptions = (text: string): string[] => {
        const normalized = (text || '').trim();
        if (!normalized) {
            return [t('Waiting for output...')];
        }
        return splitForEmbedDescription(formatForDiscord(normalized), LIVE_RESPONSE_MAX_LEN);
    };

    const buildLiveActivityDescriptions = (text: string): string[] => {
        const normalized = (text || '').trim();
        if (!normalized) return [ACTIVITY_PLACEHOLDER];
        return splitForEmbedDescription(formatForDiscord(normalized), LIVE_ACTIVITY_MAX_LEN);
    };

    const upsertLiveResponseEmbeds = (
        title: string,
        rawText: string,
        color: number,
        footerText: string,
        opts?: {
            source?: string;
            expectedVersion?: number;
            skipWhenFinalized?: boolean;
        },
    ): Promise<void> => enqueueSend(async () => {
        if (opts?.skipWhenFinalized && isFinalized) {
            logger.debug(`[sendPromptToAntigravity:${monitorTraceId}] skip response render after finalized source=${opts?.source ?? 'unknown'}`);
            return;
        }
        if (opts?.expectedVersion !== undefined && opts.expectedVersion !== liveResponseUpdateVersion) {
            logger.debug(
                `[sendPromptToAntigravity:${monitorTraceId}] skip stale response render ` +
                `source=${opts?.source ?? 'unknown'} expected=${opts.expectedVersion} current=${liveResponseUpdateVersion}`,
            );
            return;
        }
        if (!channel) return;
        const descriptions = buildLiveResponseDescriptions(rawText);
        const renderKey = `${title}|${color}|${footerText}|${descriptions.join('\n<<<PAGE_BREAK>>>\n')}`;
        if (renderKey === lastLiveResponseKey && liveResponseMessages.length > 0) {
            return;
        }
        lastLiveResponseKey = renderKey;

        for (let i = 0; i < descriptions.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle(descriptions.length > 1 ? `${title} (${i + 1}/${descriptions.length})` : title)
                .setDescription(descriptions[i])
                .setColor(color)
                .setFooter({ text: footerText })
                .setTimestamp();

            if (!liveResponseMessages[i]) {
                liveResponseMessages[i] = await channel.send({ embeds: [embed] }).catch(() => null);
                continue;
            }

            await liveResponseMessages[i].edit({ embeds: [embed] }).catch(async () => {
                liveResponseMessages[i] = await channel.send({ embeds: [embed] }).catch(() => null);
            });
        }

        // 以前よりページ数が減った場合は余剰メッセージを削除
        while (liveResponseMessages.length > descriptions.length) {
            const extra = liveResponseMessages.pop();
            if (!extra) continue;
            await extra.delete().catch(() => { });
        }
    }, `upsert-response:${opts?.source ?? 'unknown'}`);

    const upsertLiveActivityEmbeds = (
        title: string,
        rawText: string,
        color: number,
        footerText: string,
        opts?: {
            source?: string;
            expectedVersion?: number;
            skipWhenFinalized?: boolean;
        },
    ): Promise<void> => enqueueSend(async () => {
        if (opts?.skipWhenFinalized && isFinalized) {
            logger.debug(`[sendPromptToAntigravity:${monitorTraceId}] skip activity render after finalized source=${opts?.source ?? 'unknown'}`);
            return;
        }
        if (opts?.expectedVersion !== undefined && opts.expectedVersion !== liveActivityUpdateVersion) {
            logger.debug(
                `[sendPromptToAntigravity:${monitorTraceId}] skip stale activity render ` +
                `source=${opts?.source ?? 'unknown'} expected=${opts.expectedVersion} current=${liveActivityUpdateVersion}`,
            );
            return;
        }
        if (!channel) return;

        const descriptions = buildLiveActivityDescriptions(rawText);
        const renderKey = `${title}|${color}|${footerText}|${descriptions.join('\n<<<PAGE_BREAK>>>\n')}`;
        if (renderKey === lastLiveActivityKey && liveActivityMessages.length > 0) {
            return;
        }
        lastLiveActivityKey = renderKey;

        for (let i = 0; i < descriptions.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle(descriptions.length > 1 ? `${title} (${i + 1}/${descriptions.length})` : title)
                .setDescription(descriptions[i])
                .setColor(color)
                .setFooter({ text: footerText })
                .setTimestamp();

            if (!liveActivityMessages[i]) {
                liveActivityMessages[i] = await channel.send({ embeds: [embed] }).catch(() => null);
                continue;
            }

            await liveActivityMessages[i].edit({ embeds: [embed] }).catch(async () => {
                liveActivityMessages[i] = await channel.send({ embeds: [embed] }).catch(() => null);
            });
        }

        while (liveActivityMessages.length > descriptions.length) {
            const extra = liveActivityMessages.pop();
            if (!extra) continue;
            await extra.delete().catch(() => { });
        }
    }, `upsert-activity:${opts?.source ?? 'unknown'}`);

    const evaluateInContext = async <T>(expression: string, fallbackValue: T, contextId: number | null): Promise<T> => {
        try {
            const callParams: Record<string, unknown> = {
                expression,
                returnByValue: true,
                awaitPromise: true,
            };
            if (contextId !== null) callParams.contextId = contextId;
            const res = await cdp.call('Runtime.evaluate', callParams);
            const value = res?.result?.value;
            return (value ?? fallbackValue) as T;
        } catch {
            return fallbackValue;
        }
    };

    const evaluateInPrimaryContext = async <T>(expression: string, fallbackValue: T): Promise<T> => {
        return evaluateInContext(expression, fallbackValue, cdp.getPrimaryContextId());
    };

    const getEvaluationContextIds = (): Array<number | null> => {
        const contexts = cdp.getContexts();
        const cascade = contexts
            .filter((ctx) => (ctx.url || '').includes('cascade-panel'))
            .map((ctx) => ctx.id);
        const others = contexts
            .filter((ctx) => !(ctx.url || '').includes('cascade-panel'))
            .map((ctx) => ctx.id);
        const primary = cdp.getPrimaryContextId();
        const ids = [primary, ...cascade, ...others];
        const seen = new Set<number | null>();
        const deduped: Array<number | null> = [];
        for (const id of ids) {
            if (seen.has(id)) continue;
            seen.add(id);
            deduped.push(id);
        }
        return deduped;
    };

    const evaluateBooleanAnyContext = async (expression: string): Promise<boolean> => {
        for (const contextId of getEvaluationContextIds()) {
            const value = await evaluateInContext<boolean>(expression, false, contextId);
            if (value === true) return true;
        }
        return false;
    };

    const evaluateStringAnyContext = async (expression: string): Promise<string> => {
        for (const contextId of getEvaluationContextIds()) {
            const value = await evaluateInContext<string | null>(expression, null, contextId);
            const text = (value || '').trim();
            if (text) return text;
        }
        return '';
    };

    const evaluateStringArrayAnyContext = async (expression: string): Promise<string[]> => {
        const merged: string[] = [];
        const seen = new Set<string>();
        for (const contextId of getEvaluationContextIds()) {
            const values = await evaluateInContext<string[]>(expression, [], contextId);
            for (const value of values || []) {
                const line = (value || '').trim();
                if (!line || seen.has(line)) continue;
                seen.add(line);
                merged.push(line);
            }
        }
        return merged;
    };

    const STRICT_PANEL_RESPONSE_TAIL = `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        if (!panel) return null;
        const selectors = [
            '.rendered-markdown',
            '.leading-relaxed.select-text',
            '.flex.flex-col.gap-y-3',
            '[data-message-author-role="assistant"]',
            '[data-message-role="assistant"]',
            '[class*="assistant-message"]',
            '[class*="message-content"]',
            '[class*="markdown-body"]',
            '.prose',
        ];
        // 思考・推論コンテナ内の要素を除外するセレクタ
        const thinkingContainerSelector = '[class*="thinking"], [class*="reasoning"], [class*="thought"], [class*="tool-call"], [class*="tool_call"]';
        const isInsideOpenDetails = (el) => {
            let p = el;
            while (p) {
                if (p.tagName && p.tagName.toLowerCase() === 'details' && p.open) return true;
                p = p.parentElement;
            }
            return false;
        };
        const isNoise = (text) => {
            const t = (text || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            if (!t) return true;
            if (t === 'good bad' || t === 'good' || t === 'bad') return true;
            // アクティビティ・ステータスパターン
            if (/^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|処理中|実行中|生成中|思考中)/i.test(t)) return true;
            // 一人称の思考文パターン（短いテキストのみ — 実際の応答は通常もっと長い）
            if (t.length <= 250 && /^(?:i'(?:ll|m|ve)|i (?:am|will|need|should|can)|let me|let's|we (?:need|should|can)|my |our |私は|僕は|これから|まず|次に)/i.test(t)) return true;
            // MCP/ツールトレースパターン
            if (/^(?:mcp tool[ :]|mcp tool$|tool call:|tool result:|calling tool|running mcp|show details|thought for )/i.test(t)) return true;
            return false;
        };
        const nodes = [];
        const seen = new Set();
        for (const selector of selectors) {
            for (const node of panel.querySelectorAll(selector)) {
                if (!node || seen.has(node)) continue;
                // 思考コンテナ内の要素は除外
                if (node.closest(thinkingContainerSelector) || isInsideOpenDetails(node)) continue;
                seen.add(node);
                nodes.push(node);
            }
        }
        for (let i = nodes.length - 1; i >= 0; i--) {
            const text = (nodes[i].innerText || nodes[i].textContent || '').replace(/\\r/g, '').trim();
            if (!text || text.length < 8) continue;
            if (isNoise(text)) continue;
            return text;
        }
        return null;
    })()`;

    const STRICT_PANEL_RESPONSE_START = `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel');
        if (!panel) return null;
        const selectors = [
            '.rendered-markdown',
            '.leading-relaxed.select-text',
            '.flex.flex-col.gap-y-3',
            '[data-message-author-role="assistant"]',
            '[data-message-role="assistant"]',
            '[class*="assistant-message"]',
            '[class*="message-content"]',
            '[class*="markdown-body"]',
            '.prose',
        ];
        const thinkingContainerSelector = '[class*="thinking"], [class*="reasoning"], [class*="thought"], [class*="tool-call"], [class*="tool_call"]';
        const isInsideOpenDetails = (el) => {
            let p = el;
            while (p) {
                if (p.tagName && p.tagName.toLowerCase() === 'details' && p.open) return true;
                p = p.parentElement;
            }
            return false;
        };
        const isNoise = (text) => {
            const t = (text || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            if (!t) return true;
            if (t === 'good bad' || t === 'good' || t === 'bad') return true;
            if (/^(?:analy[sz]ing|reading|writing|running|searching|planning|thinking|processing|loading|executing|testing|debugging|処理中|実行中|生成中|思考中)/i.test(t)) return true;
            if (t.length <= 250 && /^(?:i'(?:ll|m|ve)|i (?:am|will|need|should|can)|let me|let's|we (?:need|should|can)|my |our |私は|僕は|これから|まず|次に)/i.test(t)) return true;
            if (/^(?:mcp tool[ :]|mcp tool$|tool call:|tool result:|calling tool|running mcp|show details|thought for )/i.test(t)) return true;
            return false;
        };
        const nodes = [];
        const seen = new Set();
        for (const selector of selectors) {
            for (const node of panel.querySelectorAll(selector)) {
                if (!node || seen.has(node)) continue;
                if (node.closest(thinkingContainerSelector) || isInsideOpenDetails(node)) continue;
                seen.add(node);
                nodes.push(node);
            }
        }
        for (let i = 0; i < nodes.length; i++) {
            const text = (nodes[i].innerText || nodes[i].textContent || '').replace(/\\r/g, '').trim();
            if (!text || text.length < 8) continue;
            if (isNoise(text)) continue;
            return text;
        }
        return null;
    })()`;

    const stripToolTraceLines = (raw: string): { text: string; dropped: number } => {
        const lines = (raw || '').replace(/\r/g, '').split('\n');
        const kept: string[] = [];
        let inCodeBlock = false;
        let dropped = 0;

        for (const line of lines) {
            const trimmed = (line || '').trim();
            if (trimmed.startsWith('```')) {
                inCodeBlock = !inCodeBlock;
                kept.push(line);
                continue;
            }
            if (!inCodeBlock && TOOL_TRACE_LINE_PATTERN.test(trimmed)) {
                dropped += 1;
                continue;
            }
            kept.push(line);
        }

        return {
            text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
            dropped,
        };
    };

    const isProcessOnlyText = (raw: string): boolean => {
        const lines = (raw || '')
            .replace(/\r/g, '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (lines.length === 0) return true;

        let processCount = 0;
        for (const line of lines) {
            if (
                TOOL_TRACE_LINE_PATTERN.test(line) ||
                PROCESS_LINE_PATTERN.test(line) ||
                PROCESS_PARAGRAPH_PATTERN.test(line) ||
                (line.length <= 120 && PROCESS_KEYWORD_PATTERN.test(line)) ||
                (line.length <= 250 && FIRST_PERSON_PATTERN.test(line) && ABSTRACT_PROGRESS_PATTERN.test(line))
            ) {
                processCount += 1;
            }
        }
        return processCount === lines.length;
    };

    const extractLatestResponseForFinalOnly = async (): Promise<{
        text: string;
        logs: string;
        source: 'tail' | 'start' | 'none';
        droppedToolLines: number;
    }> => {
        const tailText = await evaluateStringAnyContext(STRICT_PANEL_RESPONSE_TAIL);
        const startText = await evaluateStringAnyContext(STRICT_PANEL_RESPONSE_START);
        const candidates: Array<{ source: 'tail' | 'start'; raw: string }> = [];
        if (tailText && tailText.trim().length > 0) candidates.push({ source: 'tail', raw: tailText });
        if (startText && startText.trim().length > 0 && startText !== tailText) candidates.push({ source: 'start', raw: startText });

        let fallbackText = '';
        let fallbackLogs = '';
        let fallbackDropped = 0;
        let fallbackSource: 'tail' | 'start' | 'none' = 'none';

        for (const candidate of candidates) {
            const separated = splitOutputAndLogs(candidate.raw);
            const candidateOutput = (separated.output || candidate.raw || '').trim();
            const stripped = stripToolTraceLines(candidateOutput);
            const sanitizedLogs = sanitizeActivityLines(separated.logs || '');
            if (!fallbackText && stripped.text) {
                fallbackText = stripped.text;
                fallbackLogs = sanitizedLogs;
                fallbackDropped = stripped.dropped;
                fallbackSource = candidate.source;
            }
            if (!stripped.text) continue;
            if (isProcessOnlyText(stripped.text)) continue;
            return {
                text: stripped.text,
                logs: sanitizedLogs,
                source: candidate.source,
                droppedToolLines: stripped.dropped,
            };
        }

        return {
            text: fallbackText,
            logs: fallbackLogs,
            source: fallbackSource,
            droppedToolLines: fallbackDropped,
        };
    };

    const waitForFinalOnlyCompletion = async (baselineText: string): Promise<{
        finalText: string;
        finalLogs: string;
        reason: string;
        timedOut: boolean;
        droppedToolLines: number;
    }> => {
        const startedAt = Date.now();
        let lastText = '';
        let lastLogs = '';
        let lastActivitySnapshot = '';
        let lastTextChangeAt = startedAt;
        let lastActivityChangeAt = startedAt;  // アクティビティが最後に変化した時刻
        let stopSignalSeen = false;
        let activitySignalSeen = false;
        let activityActiveOnPoll = false;      // 現在のポーリングでアクティビティが返されたか
        let stopGoneSince = 0;
        let pollCount = 0;
        let droppedToolLines = 0;
        // テキストストリーミング検出: テキストが連続して増加している場合（実際の応答生成中）
        let textGrowthCount = 0;       // 連続でテキストが増加したポーリング回数
        let textStreamingSeen = false;  // 3回以上連続で増加 → ストリーミングと判定
        let prevTextLen = 0;
        const baselineSnapshot = (baselineText || '').trim();
        const hasBaselineSnapshot = baselineSnapshot.length > 0;

        logger.info(
            `[sendPromptToAntigravity:${monitorTraceId}] final-only wait start ` +
            `poll=${FINAL_ONLY_POLL_INTERVAL_MS}ms maxWait=${FINAL_ONLY_MAX_WAIT_MS}ms stopStable=${FINAL_ONLY_STOP_STABLE_MS}ms textStable=${FINAL_ONLY_TEXT_STABLE_MS}ms`,
        );

        while (Date.now() - startedAt < FINAL_ONLY_MAX_WAIT_MS) {
            pollCount += 1;
            const isGenerating = await evaluateBooleanAnyContext(RESPONSE_SELECTORS.STOP_BUTTON);
            const activities = await evaluateStringArrayAnyContext(RESPONSE_SELECTORS.ACTIVITY_STATUS);
            const activityText = sanitizeActivityLines((activities || []).join('\n'));
            activityActiveOnPoll = !!activityText;
            if (activityText) {
                if (activityText !== lastActivitySnapshot) {
                    lastActivitySnapshot = activityText;
                    lastActivityChangeAt = Date.now();
                    lastLogs = sanitizeActivityLines([lastLogs, activityText].filter(Boolean).join('\n'));
                }
                activitySignalSeen = true;
            }

            const extracted = await extractLatestResponseForFinalOnly();
            droppedToolLines += extracted.droppedToolLines;

            let currentText = extracted.text;
            if (currentText && hasBaselineSnapshot && currentText.trim() === baselineSnapshot) {
                currentText = '';
            }

            if (currentText && currentText !== lastText) {
                const currentLen = currentText.length;

                // テキストが大幅に短くなった場合 = 新しいソースに切り替わった（応答開始の可能性大）
                // → 前のフェーズで蓄積したログをリセット
                if (lastText && currentLen < prevTextLen * 0.5) {
                    logger.info(
                        `[sendPromptToAntigravity:${monitorTraceId}] text source shift detected ` +
                        `(${prevTextLen}→${currentLen}), resetting accumulated logs`,
                    );
                    lastLogs = '';
                    lastActivitySnapshot = '';  // アクティビティの重複チェックもリセット（再取得を許可）
                    textGrowthCount = 0;
                }

                // テキスト増加トラッキング
                if (currentLen > prevTextLen) {
                    textGrowthCount += 1;
                    if (textGrowthCount >= 3) {
                        textStreamingSeen = true;
                    }
                } else {
                    textGrowthCount = 0;
                }
                prevTextLen = currentLen;

                lastText = currentText;
                lastTextChangeAt = Date.now();
            }
            if (extracted.logs) {
                lastLogs = sanitizeActivityLines([lastLogs, extracted.logs].filter(Boolean).join('\n'));
            }

            if (isGenerating) {
                stopSignalSeen = true;
                stopGoneSince = 0;
            } else if (stopSignalSeen) {
                // ストップボタンが一度出現してから消えた場合のみタイマーを開始
                // ストップボタン未出現時にテキストがあるだけでは開始しない（思考中テキストの誤検出防止）
                if (!stopGoneSince) stopGoneSince = Date.now();
            }

            const now = Date.now();
            const textStalledFor = now - lastTextChangeAt;
            const activityStalledFor = now - lastActivityChangeAt;
            const stopGoneFor = stopGoneSince ? (now - stopGoneSince) : 0;
            const generationSignalSeen = stopSignalSeen || activitySignalSeen || !!lastText;
            // アクティビティがまだ変化し続けている = モデルがまだ処理中
            const activityStillActive = activityActiveOnPoll && activityStalledFor < 8000;

            if (pollCount % 3 === 0 || (currentText && currentText === lastText)) {
                logger.debug(
                    `[sendPromptToAntigravity:${monitorTraceId}] final-only poll#${pollCount} ` +
                    `stop=${isGenerating} stopSeen=${stopSignalSeen} activitySeen=${activitySignalSeen} textLen=${lastText.length} ` +
                    `stalled=${textStalledFor}ms actStalled=${activityStalledFor}ms stopGoneFor=${stopGoneFor}ms ` +
                    `streaming=${textStreamingSeen} actActive=${activityStillActive} source=${extracted.source}`,
                );
            }

            // ── 完了判定パス 1: ストップボタン消失 ──
            if (lastText && generationSignalSeen && !isGenerating && stopGoneFor >= FINAL_ONLY_STOP_STABLE_MS && textStalledFor >= 1200) {
                return {
                    finalText: lastText,
                    finalLogs: lastLogs,
                    reason: 'stop-stable',
                    timedOut: false,
                    droppedToolLines,
                };
            }

            // ── 完了判定パス 2: テキスト安定 ──
            // ストップボタン検出済み → FINAL_ONLY_TEXT_STABLE_MS (デフォルト10s)
            // ストリーミング検出済み → 3s（応答生成が終わった直後）
            // それ以外（思考テキストの可能性）→ アクティビティも停止するまで待機
            const STREAMING_STABLE_MS = 3000;
            const ACTIVITY_QUIET_MS = 5000; // アクティビティ停止後この時間で完了判定を許可

            if (lastText && generationSignalSeen && !isGenerating) {
                if (stopSignalSeen && textStalledFor >= FINAL_ONLY_TEXT_STABLE_MS) {
                    return {
                        finalText: lastText,
                        finalLogs: lastLogs,
                        reason: 'text-stable',
                        timedOut: false,
                        droppedToolLines,
                    };
                }

                if (textStreamingSeen && textStalledFor >= STREAMING_STABLE_MS) {
                    return {
                        finalText: lastText,
                        finalLogs: lastLogs,
                        reason: 'text-stable-post-stream',
                        timedOut: false,
                        droppedToolLines,
                    };
                }

                // ストップボタンもストリーミングも未検出:
                // アクティビティがまだ変化中 → 完了しない（モデルがまだ処理中）
                // アクティビティが停止 → テキスト安定後に完了
                if (!activityStillActive && textStalledFor >= ACTIVITY_QUIET_MS) {
                    return {
                        finalText: lastText,
                        finalLogs: lastLogs,
                        reason: 'text-stable-activity-quiet',
                        timedOut: false,
                        droppedToolLines,
                    };
                }
            }

            // ── 完了判定パス 3: 絶対フォールバック (60s) ──
            // アクティビティが継続していても、60sを超えたら強制完了
            if (lastText && generationSignalSeen && textStalledFor >= 60000) {
                return {
                    finalText: lastText,
                    finalLogs: lastLogs,
                    reason: 'text-stable-fallback',
                    timedOut: false,
                    droppedToolLines,
                };
            }

            if (!generationSignalSeen && (now - startedAt) >= 30000) {
                return {
                    finalText: '',
                    finalLogs: lastLogs,
                    reason: 'no-generation-signal-timeout',
                    timedOut: true,
                    droppedToolLines,
                };
            }

            await new Promise((resolve) => setTimeout(resolve, FINAL_ONLY_POLL_INTERVAL_MS));
        }

        return {
            finalText: lastText,
            finalLogs: lastLogs,
            reason: 'final-only-timeout',
            timedOut: true,
            droppedToolLines,
        };
    };

    try {
        let finalOnlyBaselineText = '';
        if (USE_FINAL_ONLY_RESPONSE) {
            const baselineProbe = await extractLatestResponseForFinalOnly();
            finalOnlyBaselineText = baselineProbe.text || '';
            logger.info(
                `[sendPromptToAntigravity:${monitorTraceId}] response mode=final-only baselineLen=${finalOnlyBaselineText.length} source=${baselineProbe.source}`,
            );
        } else {
            logger.info(`[sendPromptToAntigravity:${monitorTraceId}] response mode=stream`);
        }

        let injectResult;
        if (inboundImages.length > 0) {
            injectResult = await cdp.injectMessageWithImageFiles(
                prompt,
                inboundImages.map((image) => image.localPath),
            );

            if (!injectResult.ok) {
                await sendEmbed(
                    t('🖼️ Attached image fallback'),
                    t('Failed to attach image directly, resending via URL reference.'),
                    PHASE_COLORS.thinking,
                );
                injectResult = await cdp.injectMessage(buildPromptWithAttachmentUrls(prompt, inboundImages));
            }
        } else {
            injectResult = await cdp.injectMessage(prompt);
        }

        if (!injectResult.ok) {
            isFinalized = true;
            await sendEmbed(
                `${PHASE_ICONS.error} メッセージ注入失敗`,
                `メッセージの送信に失敗しました: ${injectResult.error}`,
                PHASE_COLORS.error,
            );
            await clearWatchingReaction();
            await message.react('❌').catch(() => { });
            return;
        }

        const startTime = Date.now();
        logger.info(`[sendPromptToAntigravity:${monitorTraceId}] monitor start`);
        await upsertLiveActivityEmbeds(
            `${PHASE_ICONS.thinking} 生成プロセスログ`,
            '',
            PHASE_COLORS.thinking,
            t('⏱️ Elapsed: 0s | Process log'),
            { source: 'initial' },
        );
        await upsertLiveResponseEmbeds(
            `${PHASE_ICONS.generating} 生成中アウトプット`,
            '',
            PHASE_COLORS.generating,
            t('⏱️ Elapsed: 0s | Waiting to start'),
            { source: 'initial' },
        );

        if (USE_FINAL_ONLY_RESPONSE) {
            const finalOnlyResult = await waitForFinalOnlyCompletion(finalOnlyBaselineText);
            isFinalized = true;

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const baseText = (finalOnlyResult.finalText && finalOnlyResult.finalText.trim().length > 0)
                ? finalOnlyResult.finalText
                : await tryEmergencyExtractText();
            const separated = splitOutputAndLogs(baseText || '');
            const finalOutputText = (separated.output || baseText || '').trim();
            const finalLogText = sanitizeActivityLines([
                separated.logs || '',
                finalOnlyResult.finalLogs || '',
            ].filter(Boolean).join('\n'));

            logger.info(
                `[sendPromptToAntigravity:${monitorTraceId}] finalize payload source=final-only ` +
                `reason=${finalOnlyResult.reason} timeout=${finalOnlyResult.timedOut} ` +
                `outputLen=${finalOutputText.length} logLen=${finalLogText.length} droppedToolLines=${finalOnlyResult.droppedToolLines}`,
            );

            let quotaReached = false;
            try {
                quotaReached = await evaluateInPrimaryContext<boolean>(RESPONSE_SELECTORS.QUOTA_ERROR, false);
            } catch {
                // quota check failure is non-critical
            }

            const activitySummary = [
                finalLogText || '',
                ...(quotaReached ? ['⚠️ quota error detected'] : []),
            ].filter(Boolean).join('\n') || t('配信方式: 最終のみ');
            liveActivityUpdateVersion += 1;
            await upsertLiveActivityEmbeds(
                `${PHASE_ICONS.thinking} プロセスログ`,
                activitySummary,
                PHASE_COLORS.thinking,
                t(`⏱️ Time: ${elapsed}s | Process log`),
                { source: 'complete', expectedVersion: liveActivityUpdateVersion },
            );

            liveResponseUpdateVersion += 1;
            if (finalOutputText && finalOutputText.length > 0) {
                await upsertLiveResponseEmbeds(
                    `${PHASE_ICONS.complete} 最終アウトプット`,
                    finalOutputText,
                    PHASE_COLORS.complete,
                    t(`⏱️ Time: ${elapsed}s | Complete`),
                    { source: 'complete', expectedVersion: liveResponseUpdateVersion },
                );
                await sendGeneratedImages(finalOutputText);
                if (quotaReached) {
                    await sendEmbed(
                        '⚠️ モデルクォータ上限到達',
                        'モデルのクォータ上限に達しました。しばらく待つか、`/model` で別のモデルに切り替えてください。',
                        0xFF6B6B,
                        undefined,
                        'Quota Reached — モデル変更を推奨',
                    );
                }
                await clearWatchingReaction();
                await message.react(quotaReached ? '⚠️' : '✅').catch(() => { });
                return;
            }

            // No valid output text — show quota embed if that was the cause, otherwise timeout/failure
            if (quotaReached) {
                await upsertLiveResponseEmbeds(
                    '⚠️ モデルクォータ上限到達',
                    'モデルのクォータ上限に達しました。しばらく待つか、`/model` で別のモデルに切り替えてください。',
                    0xFF6B6B,
                    'Quota Reached — モデル変更を推奨',
                    { source: 'complete', expectedVersion: liveResponseUpdateVersion },
                );
                await clearWatchingReaction();
                await message.react('⚠️').catch(() => { });
                return;
            }

            const timeoutMessage = finalOnlyResult.timedOut
                ? t('Final-only mode timeout. Could not extract final response.')
                : t('Failed to extract response. Use `/screenshot` to verify.');
            await upsertLiveResponseEmbeds(
                finalOnlyResult.timedOut ? `${PHASE_ICONS.timeout} タイムアウト` : `${PHASE_ICONS.complete} 完了`,
                timeoutMessage,
                finalOnlyResult.timedOut ? PHASE_COLORS.timeout : PHASE_COLORS.complete,
                t(`⏱️ Time: ${elapsed}s | ${finalOnlyResult.timedOut ? 'Timeout' : 'Complete'}`),
                { source: 'complete', expectedVersion: liveResponseUpdateVersion },
            );
            await clearWatchingReaction();
            await message.react('⚠️').catch(() => { });
            return;
        }

        const monitor = new ResponseMonitor({
            cdpService: cdp,
            pollIntervalMs: 1000,
            maxDurationMs: 300000, // 5分タイムアウト
            stopButtonGoneConfirmCount: 1, // Stop消失を1回確認で完了判定へ
            completionStabilityMs: 10000, // GitHub版に合わせて10秒安定で完了
            noUpdateTimeoutMs: 30000, // 30秒更新停止でフォールバック完了
            noTextCompletionDelayMs: 8000, // 本文未取得時の待機（抽出失敗時の体感遅延を抑制）
            textStabilityCompleteMs: 15000, // テキスト安定15秒で完了（ストップボタン非依存）
            networkCompleteDelayMs: 3000, // ネットワーク完了後3秒安定で完了

            onPhaseChange: (phase, text) => {
                logger.info(
                    `[sendPromptToAntigravity:${monitorTraceId}] phase=${phase} ` +
                    `textLen=${text?.length ?? 0}`,
                );
            },

            onProgress: (text) => {
                if (isFinalized) return;
                const separated = splitOutputAndLogs(text);
                const sanitizedLogs = sanitizeActivityLines(separated.logs || '');
                if (separated.output && separated.output.trim().length > 0) {
                    lastProgressText = separated.output;
                }
                if (sanitizedLogs && sanitizedLogs.trim().length > 0) {
                    lastActivityLogText = sanitizedLogs;
                }
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                liveResponseUpdateVersion += 1;
                const responseVersion = liveResponseUpdateVersion;
                upsertLiveResponseEmbeds(
                    `${PHASE_ICONS.generating} 生成中アウトプット`,
                    separated.output || lastProgressText || '',
                    PHASE_COLORS.generating,
                    t(`⏱️ Elapsed: ${elapsed}s | Generating`),
                    {
                        source: 'progress',
                        expectedVersion: responseVersion,
                        skipWhenFinalized: true,
                    },
                ).catch(() => { });

                liveActivityUpdateVersion += 1;
                const activityVersion = liveActivityUpdateVersion;
                upsertLiveActivityEmbeds(
                    `${PHASE_ICONS.thinking} 生成プロセスログ`,
                    sanitizedLogs || lastActivityLogText || ACTIVITY_PLACEHOLDER,
                    PHASE_COLORS.thinking,
                    t(`⏱️ Elapsed: ${elapsed}s | Process log`),
                    {
                        source: 'progress',
                        expectedVersion: activityVersion,
                        skipWhenFinalized: true,
                    },
                ).catch(() => { });
            },

            onActivity: (activities) => {
                if (isFinalized) return;
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                const activityText = sanitizeActivityLines(activities
                    .map((line) => (line || '').trim())
                    .filter((line) => line.length > 0)
                    .join('\n'));
                if (!activityText) return;
                lastActivityLogText = activityText;
                liveActivityUpdateVersion += 1;
                const activityVersion = liveActivityUpdateVersion;
                upsertLiveActivityEmbeds(
                    `${PHASE_ICONS.thinking} 生成プロセスログ`,
                    activityText,
                    PHASE_COLORS.thinking,
                    t(`⏱️ Elapsed: ${elapsed}s | Process log`),
                    {
                        source: 'activity',
                        expectedVersion: activityVersion,
                        skipWhenFinalized: true,
                    },
                ).catch(() => { });
            },

            onComplete: async (finalText) => {
                isFinalized = true;
                logger.info(
                    `[sendPromptToAntigravity:${monitorTraceId}] onComplete start ` +
                    `phase=${monitor.getPhase()} finalTextLen=${finalText?.length ?? 0} lastProgressLen=${lastProgressText.length}`,
                );

                try {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    const responseText = (finalText && finalText.trim().length > 0)
                        ? finalText
                        : lastProgressText;
                    const emergencyText = (!responseText || responseText.trim().length === 0)
                        ? await tryEmergencyExtractText()
                        : '';
                    const finalResponseText = responseText && responseText.trim().length > 0
                        ? responseText
                        : emergencyText;
                    const separated = splitOutputAndLogs(finalResponseText);
                    const finalOutputText = separated.output || finalResponseText;
                    const finalLogText = sanitizeActivityLines(
                        [separated.logs || '', lastActivityLogText].filter(Boolean).join('\n'),
                    );
                    logger.info(
                        `[sendPromptToAntigravity:${monitorTraceId}] finalize payload ` +
                        `outputLen=${finalOutputText?.length ?? 0} logLen=${finalLogText?.length ?? 0}`,
                    );

                    liveActivityUpdateVersion += 1;
                    const activityVersion = liveActivityUpdateVersion;
                    await upsertLiveActivityEmbeds(
                        `${PHASE_ICONS.thinking} プロセスログ`,
                        finalLogText || ACTIVITY_PLACEHOLDER,
                        PHASE_COLORS.thinking,
                        t(`⏱️ Time: ${elapsed}s | Process log`),
                        {
                            source: 'complete',
                            expectedVersion: activityVersion,
                        },
                    );

                    liveResponseUpdateVersion += 1;
                    const responseVersion = liveResponseUpdateVersion;
                    if (finalOutputText && finalOutputText.trim().length > 0) {
                        await upsertLiveResponseEmbeds(
                            `${PHASE_ICONS.complete} 最終アウトプット`,
                            finalOutputText,
                            PHASE_COLORS.complete,
                            t(`⏱️ Time: ${elapsed}s | Complete`),
                            {
                                source: 'complete',
                                expectedVersion: responseVersion,
                            },
                        );
                    } else {
                        await upsertLiveResponseEmbeds(
                            `${PHASE_ICONS.complete} 完了`,
                            t('Failed to extract response. Use `/screenshot` to verify.'),
                            PHASE_COLORS.complete,
                            t(`⏱️ Time: ${elapsed}s | Complete`),
                            {
                                source: 'complete',
                                expectedVersion: responseVersion,
                            },
                        );
                    }

                    if (options && message.guild) {
                        try {
                            const sessionInfo = await options.chatSessionService.getCurrentSessionInfo(cdp);
                            if (sessionInfo && sessionInfo.hasActiveChat && sessionInfo.title && sessionInfo.title !== t('(Untitled)')) {
                                const newName = options.titleGenerator.sanitizeForChannelName(sessionInfo.title);
                                const session = options.chatSessionRepo.findByChannelId(message.channelId);
                                if (session && session.displayName !== sessionInfo.title) {
                                    const formattedName = `${session.sessionNumber}-${newName}`;
                                    await options.channelManager.renameChannel(message.guild, message.channelId, formattedName);
                                    options.chatSessionRepo.updateDisplayName(message.channelId, sessionInfo.title);
                                }
                            }
                        } catch (e) {
                            logger.error('[Rename] Antigravityからのタイトル取得とリネームに失敗:', e);
                        }
                    }

                    if (monitor.getPhase() === 'quotaReached' || monitor.getQuotaDetected()) {
                        await sendEmbed(
                            '⚠️ モデルクォータ上限到達',
                            'モデルのクォータ上限に達しました。しばらく待つか、`/model` で別のモデルに切り替えてください。',
                            0xFF6B6B,
                            undefined,
                            'Quota Reached — モデル変更を推奨',
                        );
                        await clearWatchingReaction();
                        await message.react('⚠️').catch(() => { });
                        return;
                    }

                    await sendGeneratedImages(finalOutputText || '');
                    await clearWatchingReaction();
                    await message.react(finalOutputText && finalOutputText.trim().length > 0 ? '✅' : '⚠️').catch(() => { });
                } catch (error) {
                    logger.error(`[sendPromptToAntigravity:${monitorTraceId}] onComplete failed:`, error);
                } finally {
                    logger.info(`[sendPromptToAntigravity:${monitorTraceId}] onComplete end`);
                }
            },

            onTimeout: async (lastText) => {
                isFinalized = true;
                logger.info(
                    `[sendPromptToAntigravity:${monitorTraceId}] onTimeout start ` +
                    `lastTextLen=${lastText?.length ?? 0} lastProgressLen=${lastProgressText.length}`,
                );
                try {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);

                    const timeoutText = (lastText && lastText.trim().length > 0)
                        ? lastText
                        : lastProgressText;
                    const separated = splitOutputAndLogs(timeoutText || '');
                    const sanitizedTimeoutLogs = sanitizeActivityLines(
                        [separated.logs || '', lastActivityLogText].filter(Boolean).join('\n'),
                    );
                    const payload = separated.output && separated.output.trim().length > 0
                        ? t(`${separated.output}\n\n[Monitor Ended] Timeout after 5 minutes.`)
                        : '5分経過により監視を終了しました。テキストは取得できませんでした。';

                    liveResponseUpdateVersion += 1;
                    const responseVersion = liveResponseUpdateVersion;
                    await upsertLiveResponseEmbeds(
                        `${PHASE_ICONS.timeout} タイムアウト`,
                        payload,
                        PHASE_COLORS.timeout,
                        `⏱️ 所要時間: ${elapsed}秒 | タイムアウト`,
                        {
                            source: 'timeout',
                            expectedVersion: responseVersion,
                        },
                    );

                    liveActivityUpdateVersion += 1;
                    const activityVersion = liveActivityUpdateVersion;
                    await upsertLiveActivityEmbeds(
                        `${PHASE_ICONS.thinking} プロセスログ`,
                        sanitizedTimeoutLogs || ACTIVITY_PLACEHOLDER,
                        PHASE_COLORS.thinking,
                        t(`⏱️ Time: ${elapsed}s | Process log`),
                        {
                            source: 'timeout',
                            expectedVersion: activityVersion,
                        },
                    );
                    await clearWatchingReaction();
                    await message.react('⚠️').catch(() => { });
                } catch (error) {
                    logger.error(`[sendPromptToAntigravity:${monitorTraceId}] onTimeout failed:`, error);
                } finally {
                    logger.info(`[sendPromptToAntigravity:${monitorTraceId}] onTimeout end`);
                }
            },
        });

        await monitor.start();

    } catch (e: any) {
        isFinalized = true;
        await sendEmbed(
            `${PHASE_ICONS.error} エラー`,
            t(`Error occurred during processing: ${e.message}`),
            PHASE_COLORS.error,
        );
        await clearWatchingReaction();
        await message.react('❌').catch(() => { });
    }
}

// =============================================================================
// Bot メインエントリー
// =============================================================================

export const startBot = async () => {
    const config = loadConfig();

    const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'antigravity.db';
    const db = new Database(dbPath);
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
    const bridge = initCdpBridge(config.autoApproveFileEdits);

    // CDP依存サービスの初期化（コンストラクタCDP依存を除去済み）
    const chatSessionService = new ChatSessionService();
    const titleGenerator = new TitleGeneratorService();

    // コマンドハンドラーの初期化
    const wsHandler = new WorkspaceCommandHandler(workspaceBindingRepo, chatSessionRepo, workspaceService, channelManager);
    const chatHandler = new ChatCommandHandler(chatSessionService, chatSessionRepo, workspaceBindingRepo, channelManager, workspaceService, bridge.pool);
    const cleanupHandler = new CleanupCommandHandler(chatSessionRepo, workspaceBindingRepo);

    const slashCommandHandler = new SlashCommandHandler(modeService, modelService, templateRepo);

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ]
    });

    client.once(Events.ClientReady, async (readyClient) => {
        logger.info(`Ready! Logged in as ${readyClient.user.tag}`);

        try {
            await registerSlashCommands(config.discordToken, config.clientId, config.guildId);
        } catch (error) {
            logger.warn('スラッシュコマンドの登録に失敗しましたが、テキストコマンドは引き続き利用可能です。');
        }
    });

    // 【Discord Interactions API】スラッシュコマンドインタラクション処理
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        if (interaction.isButton()) {
            if (!config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: t('You do not have permission.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            try {
                const approvalAction = parseApprovalCustomId(interaction.customId);
                if (approvalAction) {
                    const workspaceDirName = approvalAction.workspaceDirName ?? bridge.lastActiveWorkspace;
                    const detector = workspaceDirName
                        ? bridge.pool.getApprovalDetector(workspaceDirName)
                        : undefined;

                    if (!detector) {
                        try {
                            await interaction.reply({ content: t('Approval detector not found.'), flags: MessageFlags.Ephemeral });
                        } catch { /* ignore */ }
                        return;
                    }

                    let success = false;
                    let actionLabel = '';
                    if (approvalAction.action === 'approve') {
                        success = await detector.approveButton();
                        actionLabel = t('Allow');
                    } else if (approvalAction.action === 'always_allow') {
                        success = await detector.alwaysAllowButton();
                        actionLabel = t('Allow Chat');
                    } else {
                        success = await detector.denyButton();
                        actionLabel = t('Deny');
                    }

                    try {
                        if (success) {
                            const originalEmbed = interaction.message.embeds[0];
                            const updatedEmbed = originalEmbed
                                ? EmbedBuilder.from(originalEmbed)
                                : new EmbedBuilder().setTitle('承認リクエスト');

                            const historyText = `${actionLabel} by <@${interaction.user.id}> (${new Date().toLocaleString('ja-JP')})`;
                            updatedEmbed
                                .setColor(approvalAction.action === 'deny' ? 0xE74C3C : 0x2ECC71)
                                .addFields({ name: '処理履歴', value: historyText, inline: false })
                                .setTimestamp();

                            const disabledRows = interaction.message.components
                                .map((row) => {
                                    const rowAny = row as any;
                                    if (!Array.isArray(rowAny.components)) return null;

                                    const nextRow = new ActionRowBuilder<ButtonBuilder>();
                                    const disabledButtons = rowAny.components
                                        .map((component: any) => {
                                            const componentType = component?.type ?? component?.data?.type;
                                            if (componentType !== 2) return null;
                                            const payload = typeof component?.toJSON === 'function'
                                                ? component.toJSON()
                                                : component;
                                            return ButtonBuilder.from(payload).setDisabled(true);
                                        })
                                        .filter((button: ButtonBuilder | null): button is ButtonBuilder => button !== null);
                                    if (disabledButtons.length === 0) return null;
                                    nextRow.addComponents(...disabledButtons);
                                    return nextRow;
                                })
                                .filter((row): row is ActionRowBuilder<ButtonBuilder> => row !== null);

                            await interaction.update({
                                embeds: [updatedEmbed],
                                components: disabledRows,
                            });
                        } else {
                            await interaction.reply({ content: '承認ボタンが見つかりませんでした。', flags: MessageFlags.Ephemeral });
                        }
                    } catch (interactionError: any) {
                        if (interactionError?.code === 10062 || interactionError?.code === 40060) {
                            logger.warn('[Approval] interaction期限切れ。チャンネルに直接応答します。');
                            if (interaction.channel && 'send' in interaction.channel) {
                                const fallbackMessage = success
                                    ? `${actionLabel}しました。`
                                    : '承認ボタンが見つかりませんでした。';
                                await (interaction.channel as any).send(fallbackMessage).catch(logger.error);
                            }
                        } else {
                            throw interactionError;
                        }
                    }
                    return;
                }

                // Cleanup ボタン処理
                if (interaction.customId === CLEANUP_ARCHIVE_BTN) {
                    await cleanupHandler.handleArchive(interaction);
                    return;
                }
                if (interaction.customId === CLEANUP_DELETE_BTN) {
                    await cleanupHandler.handleDelete(interaction);
                    return;
                }
                if (interaction.customId === CLEANUP_CANCEL_BTN) {
                    await cleanupHandler.handleCancel(interaction);
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
                        await interaction.followUp({ content: 'CDPに未接続です。', flags: MessageFlags.Ephemeral });
                        return;
                    }

                    const res = await cdp.setUiModel(modelName);

                    if (!res.ok) {
                        await interaction.followUp({ content: res.error || 'モデルの変更に失敗しました。', flags: MessageFlags.Ephemeral });
                    } else {
                        await sendModelsUI({ editReply: async (data: any) => await interaction.editReply(data) }, bridge);
                        await interaction.followUp({ content: `モデルを **${res.model}** に変更しました！`, flags: MessageFlags.Ephemeral });
                    }
                    return;
                }
            } catch (error) {
                logger.error('ボタンインタラクションの処理中にエラーが発生:', error);

                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'ボタン操作の処理中にエラーが発生しました。', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.followUp({ content: 'ボタン操作の処理中にエラーが発生しました。', flags: MessageFlags.Ephemeral }).catch(logger.error);
                    }
                } catch (e) {
                    logger.error('エラーメッセージの送信にも失敗しました:', e);
                }
            }
        }

        // モードDropdown選択処理
        if (interaction.isStringSelectMenu() && interaction.customId === 'mode_select') {
            if (!config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: t('You do not have permission.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            try {
                await interaction.deferUpdate();
            } catch (deferError: any) {
                // 10062: Unknown interaction — インタラクション期限切れ（重複プロセスなど）
                if (deferError?.code === 10062 || deferError?.code === 40060) {
                    logger.warn('[Mode] deferUpdate期限切れ。スキップします。');
                    return;
                }
                logger.error('[Mode] deferUpdate失敗:', deferError);
                return;
            }

            try {
                const selectedMode = interaction.values[0];

                modeService.setMode(selectedMode);

                const cdp = getCurrentCdp(bridge);
                if (cdp) {
                    const res = await cdp.setUiMode(selectedMode);
                    if (!res.ok) {
                        logger.warn(`[Mode] UIモード切替失敗: ${res.error}`);
                    }
                }

                await sendModeUI({ editReply: async (data: any) => await interaction.editReply(data) }, modeService);
                await interaction.followUp({ content: `モードを **${MODE_DISPLAY_NAMES[selectedMode] || selectedMode}** に変更しました！`, flags: MessageFlags.Ephemeral });
            } catch (error: any) {
                logger.error('モードDropdown処理中にエラー:', error);
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({ content: 'モード変更中にエラーが発生しました。', flags: MessageFlags.Ephemeral }).catch(logger.error);
                    }
                } catch (e) {
                    logger.error('エラーメッセージの送信にも失敗:', e);
                }
            }
            return;
        }

        // ワークスペースセレクトメニュー処理
        if (interaction.isStringSelectMenu() && (interaction.customId === PROJECT_SELECT_ID || interaction.customId === WORKSPACE_SELECT_ID)) {
            if (!config.allowedUserIds.includes(interaction.user.id)) {
                await interaction.reply({ content: t('You do not have permission.'), flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            if (!interaction.guild) {
                await interaction.reply({ content: 'サーバー内でのみ使用できます。', flags: MessageFlags.Ephemeral }).catch(logger.error);
                return;
            }

            try {
                await wsHandler.handleSelectMenu(interaction, interaction.guild);
            } catch (error) {
                logger.error('ワークスペース選択エラー:', error);
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const commandInteraction = interaction as ChatInputCommandInteraction;

        if (!config.allowedUserIds.includes(interaction.user.id)) {
            await commandInteraction.reply({
                content: 'このコマンドを使用する権限がありません。',
                flags: MessageFlags.Ephemeral,
            }).catch(logger.error);
            return;
        }

        try {
            await commandInteraction.deferReply();
        } catch (deferError: any) {
            // 10062: Unknown interaction — インタラクションの期限切れ（3秒超過）
            if (deferError?.code === 10062) {
                logger.warn('[SlashCommand] インタラクション期限切れ（deferReply失敗）。スキップします。');
                return;
            }
            throw deferError;
        }

        try {
            await handleSlashInteraction(commandInteraction, slashCommandHandler, bridge, wsHandler, chatHandler, cleanupHandler, modeService, modelService, bridge.autoAccept, client);
        } catch (error) {
            logger.error('スラッシュコマンドの処理でエラーが発生:', error);
            try {
                await commandInteraction.editReply({ content: 'コマンドの処理中にエラーが発生しました。' });
            } catch (replyError) {
                logger.error('エラー応答の送信にも失敗:', replyError);
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
            if (parsed.commandName === 'autoaccept') {
                const result = bridge.autoAccept.handle(parsed.args?.[0]);
                await message.reply({ content: result.message }).catch(logger.error);
                return;
            }

            if (parsed.commandName === 'screenshot') {
                await handleScreenshot(message, bridge);
                await message.reply({ content: '💡 スラッシュコマンド `/screenshot` でも同じ操作ができます。' }).catch(() => { });
                return;
            }

            if (parsed.commandName === 'status') {
                const activeNames = bridge.pool.getActiveWorkspaceNames();
                const currentMode = modeService.getCurrentMode();

                const embed = new EmbedBuilder()
                    .setTitle('🔧 Bot ステータス')
                    .setColor(activeNames.length > 0 ? 0x00CC88 : 0x888888)
                    .addFields(
                        { name: 'CDP接続', value: activeNames.length > 0 ? `🟢 ${activeNames.length} プロジェクト接続中` : '⚪ 未接続', inline: true },
                        { name: 'モード', value: MODE_DISPLAY_NAMES[currentMode] || currentMode, inline: true },
                        { name: '自動承認', value: bridge.autoAccept.isEnabled() ? '🟢 ON' : '⚪ OFF', inline: true },
                    )
                    .setFooter({ text: '💡 スラッシュコマンド /status でより詳しい情報が見られます' })
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

                await message.reply({ embeds: [embed] });
                return;
            }

            // スラッシュコマンド専用コマンドはテキスト経由では処理しない
            const slashOnlyCommands = ['help', 'stop', 'model', 'mode', 'project', 'chat', 'new', 'cleanup'];
            if (slashOnlyCommands.includes(parsed.commandName)) {
                await message.reply({
                    content: `💡 \`/${parsed.commandName}\` はスラッシュコマンドとして使用してください。\nDiscordの入力欄で \`/${parsed.commandName}\` と入力すると候補が表示されます。`,
                }).catch(logger.error);
                return;
            }

            const result = await slashCommandHandler.handleCommand(parsed.commandName, parsed.args || []);

            await message.reply({
                content: result.message
            }).catch(logger.error);

            if (result.prompt) {
                const cdp = getCurrentCdp(bridge);
                if (cdp) {
                    await sendPromptToAntigravity(bridge, message, result.prompt, cdp, modeService, modelService, [], {
                        chatSessionService,
                        chatSessionRepo,
                        channelManager,
                        titleGenerator
                    });
                } else {
                    await message.reply('CDPに未接続です。先にメッセージを送信してプロジェクトに接続してください。');
                }
            }
            return;
        }

        // 平文メッセージ or 画像添付 → Antigravityに送信
        const hasImageAttachments = Array.from(message.attachments.values())
            .some((attachment) => isImageAttachment(attachment.contentType, attachment.name));
        if (message.content.trim() || hasImageAttachments) {
            const promptText = message.content.trim() || '添付画像を確認して対応してください。';
            const inboundImages = await downloadInboundImageAttachments(message);

            if (hasImageAttachments && inboundImages.length === 0) {
                await message.reply('添付画像の取得に失敗しました。時間をおいて再送してください。').catch(() => { });
                return;
            }

            const workspacePath = wsHandler.getWorkspaceForChannel(message.channelId);

            try {
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
                                    logger.warn('[MessageCreate] Antigravityでの新規チャット開始に失敗:', chatResult.error);
                                    (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => { });
                                }
                            } catch (err) {
                                logger.error('[MessageCreate] startNewChat エラー:', err);
                                (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => { });
                            }
                        }

                        await autoRenameChannel(message, chatSessionRepo, titleGenerator, channelManager, cdp);

                        await sendPromptToAntigravity(bridge, message, promptText, cdp, modeService, modelService, inboundImages, {
                            chatSessionService,
                            chatSessionRepo,
                            channelManager,
                            titleGenerator
                        });
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
                                    logger.warn('[MessageCreate|Fallback] Antigravityでの新規チャット開始に失敗:', chatResult.error);
                                    (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => { });
                                }
                            } catch (err) {
                                logger.error('[MessageCreate|Fallback] startNewChat エラー:', err);
                                (message.channel as any).send(`⚠️ Antigravityで新規チャットを開けませんでした。既存チャットに送信します。`).catch(() => { });
                            }
                        }

                        await autoRenameChannel(message, chatSessionRepo, titleGenerator, channelManager, cdp);
                        await sendPromptToAntigravity(bridge, message, promptText, cdp, modeService, modelService, inboundImages, {
                            chatSessionService,
                            chatSessionRepo,
                            channelManager,
                            titleGenerator
                        });
                    } else {
                        await message.reply('プロジェクトが設定されていません。`/project` でプロジェクトを作成してください。');
                    }
                }
            } finally {
                await cleanupInboundImageAttachments(inboundImages);
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
        logger.error('[AutoRename] リネーム失敗:', err);
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

        const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '');
        const nName = normalize(mName);
        const q = quotaData.find(q => {
            const nLabel = normalize(q.label);
            const nModel = normalize(q.model || '');
            return nLabel === nName || nModel === nName
                || nName.includes(nLabel) || nLabel.includes(nName)
                || (nModel && (nName.includes(nModel) || nModel.includes(nName)));
        });
        if (!q || !q.quotaInfo) return `${current ? '[x]' : '[ ]'} ${mName}`;

        const rem = q.quotaInfo.remainingFraction;
        const resetTime = q.quotaInfo.resetTime ? new Date(q.quotaInfo.resetTime) : null;
        const diffMs = resetTime ? resetTime.getTime() - Date.now() : 0;
        let timeStr = 'Ready';
        if (diffMs > 0) {
            const mins = Math.ceil(diffMs / 60000);
            if (mins < 60) timeStr = `${mins}m`;
            else timeStr = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }

        if (rem !== undefined && rem !== null) {
            const percent = Math.round(rem * 100);
            let icon = '🟢';
            if (percent <= 20) icon = '🔴';
            else if (percent <= 50) icon = '🟡';
            return `${current ? '[x]' : '[ ]'} ${mName} ${icon} ${percent}% (⏱️ ${timeStr})`;
        }

        return `${current ? '[x]' : '[ ]'} ${mName} (⏱️ ${timeStr})`;
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
    cleanupHandler: CleanupCommandHandler,
    modeService: ModeService,
    modelService: ModelService,
    autoAcceptService: AutoAcceptService,
    _client: Client,
): Promise<void> {
    const commandName = interaction.commandName;

    switch (commandName) {
        case 'help': {
            const embed = new EmbedBuilder()
                .setTitle('📖 LazyGravity コマンド一覧')
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
                            '`/autoaccept [on|off|status]` — 承認の自動許可モードを切替',
                            '`/cleanup [days]` — 未使用チャンネル/カテゴリのクリーンアップ',
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
                        await sendPromptToAntigravity(bridge, followUp, result.prompt, cdp, modeService, modelService, [], {
                            chatSessionService: (chatHandler as any).chatSessionService,
                            chatSessionRepo: (chatHandler as any).chatSessionRepo,
                            channelManager: (chatHandler as any).channelManager,
                            titleGenerator: new TitleGeneratorService()
                        });
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
                    { name: '自動承認', value: autoAcceptService.isEnabled() ? '🟢 ON' : '⚪ OFF', inline: true },
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

        case 'autoaccept': {
            const requestedMode = interaction.options.getString('mode') ?? 'status';
            const result = autoAcceptService.handle(requestedMode);
            await interaction.editReply({ content: result.message });
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
                        .setTitle('⏹️ 生成を中断しました')
                        .setDescription('AIの回答生成を安全に停止しました。')
                        .setColor(0xE74C3C)
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

        case 'cleanup': {
            await cleanupHandler.handleCleanup(interaction);
            break;
        }

        default:
            await interaction.editReply({
                content: `未知のコマンドです: /${commandName}`,
            });
    }
}
