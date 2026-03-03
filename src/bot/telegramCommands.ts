/**
 * Telegram command parser and handlers.
 *
 * Handles built-in bot commands that can be answered immediately
 * without routing through CDP/Antigravity:
 *   /start      — Welcome message
 *   /help       — List available commands
 *   /status     — Show bot connection status
 *   /stop       — Interrupt active LLM generation
 *   /ping       — Latency check
 *   /mode       — Switch execution mode
 *   /model      — Switch LLM model
 *   /screenshot — Capture Antigravity screenshot
 *   /autoaccept — Toggle auto-accept for approval dialogs
 *   /template   — List and execute prompt templates
 *   /logs       — Show recent log entries
 */

import fs from 'fs';
import type { PlatformMessage, MessagePayload } from '../platform/types';
import type { CdpBridge } from '../services/cdpBridgeManager';
import type { WorkspaceService } from '../services/workspaceService';
import { getCurrentCdp } from '../services/cdpBridgeManager';
import type { ResponseMonitor } from '../services/responseMonitor';
import type { ModeService } from '../services/modeService';
import type { ModelService } from '../services/modelService';
import type { TelegramBindingRepository } from '../database/telegramBindingRepository';
import type { TemplateRepository } from '../database/templateRepository';
import { buildModePayload } from '../ui/modeUi';
import { buildModelsPayload } from '../ui/modelsUi';
import { buildAutoAcceptPayload } from '../ui/autoAcceptUi';
import { buildTemplatePayload } from '../ui/templateUi';
import { buildScreenshotPayload } from '../ui/screenshotUi';
import { logBuffer } from '../utils/logBuffer';
import { escapeHtml } from '../platform/telegram/telegramFormatter';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Known commands (used by both parser and /help output)
// ---------------------------------------------------------------------------

const KNOWN_COMMANDS = ['start', 'help', 'status', 'stop', 'ping', 'mode', 'model', 'screenshot', 'autoaccept', 'template', 'template_add', 'template_delete', 'project_create', 'logs'] as const;
type KnownCommand = typeof KNOWN_COMMANDS[number];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface ParsedTelegramCommand {
    readonly command: string;
    readonly args: string;
}

/**
 * Parse a Telegram command from message text.
 *
 * Accepted formats:
 *   /command
 *   /command args text
 *   /command@BotName
 *   /command@BotName args text
 *
 * Returns null if the text is not a known command (unknown commands
 * are forwarded to Antigravity as normal messages).
 */
export function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
    const trimmed = text.trim();
    const match = trimmed.match(/^\/(\w+)(?:@\S+)?(?:\s+(.*))?$/);
    if (!match) return null;

    const command = match[1].toLowerCase();
    if (!(KNOWN_COMMANDS as readonly string[]).includes(command)) return null;

    return {
        command,
        args: (match[2] ?? '').trim(),
    };
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface TelegramCommandDeps {
    readonly bridge: CdpBridge;
    readonly modeService?: ModeService;
    readonly modelService?: ModelService;
    readonly telegramBindingRepo?: TelegramBindingRepository;
    readonly templateRepo?: TemplateRepository;
    readonly workspaceService?: WorkspaceService;
    readonly fetchQuota?: () => Promise<any[]>;
    /** Shared map of active ResponseMonitors keyed by project name.
     *  Used by /stop to halt monitoring and prevent stale re-sends. */
    readonly activeMonitors?: Map<string, ResponseMonitor>;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle a parsed Telegram command.
 * Routes to the appropriate sub-handler based on command name.
 */
export async function handleTelegramCommand(
    deps: TelegramCommandDeps,
    message: PlatformMessage,
    parsed: ParsedTelegramCommand,
): Promise<void> {
    const argsDisplay = parsed.args ? ` ${parsed.args}` : '';
    logger.info(`[TelegramCommand] /${parsed.command}${argsDisplay} (chat=${message.channel.id})`);

    switch (parsed.command as KnownCommand) {
        case 'start':
            await handleStart(message);
            break;
        case 'help':
            await handleHelp(message);
            break;
        case 'status':
            await handleStatus(deps, message);
            break;
        case 'stop':
            await handleStop(deps, message);
            break;
        case 'ping':
            await handlePing(message);
            break;
        case 'mode':
            await handleMode(deps, message);
            break;
        case 'model':
            await handleModel(deps, message);
            break;
        case 'screenshot':
            await handleScreenshot(deps, message);
            break;
        case 'autoaccept':
            await handleAutoAccept(deps, message, parsed.args);
            break;
        case 'template':
            await handleTemplate(deps, message);
            break;
        case 'template_add':
            await handleTemplateAdd(deps, message, parsed.args);
            break;
        case 'template_delete':
            await handleTemplateDelete(deps, message, parsed.args);
            break;
        case 'project_create':
            await handleProjectCreate(deps, message, parsed.args);
            break;
        case 'logs':
            await handleLogs(message, parsed.args);
            break;
        default:
            // Should not happen — parser filters unknowns
            break;
    }
}

// ---------------------------------------------------------------------------
// Sub-handlers
// ---------------------------------------------------------------------------

async function handleStart(message: PlatformMessage): Promise<void> {
    const text = [
        '<b>Welcome to LazyGravity!</b>',
        '',
        'This bot connects you to Antigravity AI workspaces.',
        '',
        'Get started:',
        '1. Use /project to bind this chat to a workspace',
        '2. Send any message to start chatting with Antigravity',
        '',
        'Type /help for a list of available commands.',
    ].join('\n');

    await message.reply({ text }).catch(logger.error);
}

async function handleHelp(message: PlatformMessage): Promise<void> {
    const text = [
        '<b>Available Commands</b>',
        '',
        '/project — Manage workspace bindings',
        '/status — Show bot status and connections',
        '/mode — Switch execution mode',
        '/model — Switch LLM model',
        '/screenshot — Capture Antigravity screenshot',
        '/autoaccept — Toggle auto-accept mode',
        '/template — List prompt templates',
        '/template_add — Add a prompt template',
        '/template_delete — Delete a prompt template',
        '/project_create — Create a new workspace',
        '/logs — Show recent log entries',
        '/stop — Interrupt active LLM generation',
        '/ping — Check bot latency',
        '/help — Show this help message',
        '',
        'Any other message is forwarded to Antigravity.',
    ].join('\n');

    await message.reply({ text }).catch(logger.error);
}

async function handleStatus(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    const chatId = message.channel.id;

    // Current chat binding
    const binding = deps.telegramBindingRepo?.findByChatId(chatId);
    const boundProject = binding?.workspacePath ?? '(none)';

    // CDP connection status for this chat's project
    const activeWorkspaces = deps.bridge.pool.getActiveWorkspaceNames();
    const projectConnected = binding
        ? activeWorkspaces.some((name) => binding.workspacePath.includes(name) || name.includes(binding.workspacePath))
        : false;

    const mode = deps.modeService
        ? deps.modeService.getCurrentMode()
        : 'unknown';

    const lines = [
        '<b>Bot Status</b>',
        '',
        `<b>This chat:</b>`,
        `  Project: ${escapeHtml(boundProject)}`,
        `  CDP: ${projectConnected ? 'Connected' : 'Not connected'}`,
        '',
        `Mode: ${escapeHtml(mode)}`,
        `Active connections: ${activeWorkspaces.length > 0 ? activeWorkspaces.map(escapeHtml).join(', ') : 'none'}`,
    ];

    await message.reply({ text: lines.join('\n') }).catch(logger.error);
}

async function handleStop(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    const workspace = deps.bridge.lastActiveWorkspace;

    // Try to use the active ResponseMonitor first (it stops monitoring + clicks stop)
    if (workspace && deps.activeMonitors) {
        const monitor = deps.activeMonitors.get(workspace);
        if (monitor && monitor.isActive()) {
            logger.info(`[TelegramCommand:stop] Stopping active monitor for ${workspace}...`);
            const result = await monitor.clickStopButton();
            if (result.ok) {
                logger.done(`[TelegramCommand:stop] Stopped via monitor (method=${result.method})`);
                await message.reply({ text: 'Generation stopped.' }).catch(logger.error);
                return;
            }
            logger.warn(`[TelegramCommand:stop] Monitor clickStopButton failed: ${result.error}`);
        }
    }

    // Fallback: try direct CDP call (no active monitor, or monitor click failed)
    const cdp = getCurrentCdp(deps.bridge);
    if (!cdp) {
        logger.warn('[TelegramCommand:stop] No CDP — lastActiveWorkspace:', workspace ?? '(null)');
        await message.reply({ text: 'No active workspace connection.' }).catch(logger.error);
        return;
    }

    try {
        logger.info('[TelegramCommand:stop] Clicking stop button via direct CDP...');
        const { RESPONSE_SELECTORS } = await import('../services/responseMonitor');
        const result = await cdp.call(
            'Runtime.evaluate',
            { expression: RESPONSE_SELECTORS.CLICK_STOP_BUTTON, returnByValue: true },
        );
        const value = result?.result?.value;
        if (value && typeof value === 'object' && value.ok) {
            logger.done(`[TelegramCommand:stop] Stop button clicked (method=${value.method})`);
            await message.reply({ text: 'Generation stopped.' }).catch(logger.error);
        } else {
            logger.warn('[TelegramCommand:stop] Stop button not found — value:', JSON.stringify(value));
            await message.reply({ text: 'Stop button not found (generation may have already finished).' }).catch(logger.error);
        }
    } catch (err: any) {
        logger.error('[TelegramCommand:stop]', err?.message || err);
        await message.reply({ text: 'Failed to click stop button.' }).catch(logger.error);
    }
}

async function handlePing(message: PlatformMessage): Promise<void> {
    await message.reply({ text: 'Pong!' }).catch(logger.error);
}

async function handleMode(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    if (!deps.modeService) {
        await message.reply({ text: 'Mode service not available.' }).catch(logger.error);
        return;
    }

    const isPending = deps.modeService.isPendingSync();
    const payload = buildModePayload(deps.modeService.getCurrentMode(), isPending);
    await message.reply(payload).catch(logger.error);
}

async function handleModel(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    const cdp = getCurrentCdp(deps.bridge);
    if (!cdp) {
        await message.reply({ text: 'Not connected to Antigravity.' }).catch(logger.error);
        return;
    }

    const models = await cdp.getUiModels();
    const currentModel = await cdp.getCurrentModel();
    const quotaData = deps.fetchQuota ? await deps.fetchQuota() : [];
    const defaultModel = deps.modelService?.getDefaultModel() ?? null;

    const payload = buildModelsPayload(models, currentModel, quotaData, defaultModel);
    if (!payload) {
        await message.reply({ text: 'No models available.' }).catch(logger.error);
        return;
    }

    await message.reply(payload).catch(logger.error);
}

async function handleScreenshot(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    const cdp = getCurrentCdp(deps.bridge);
    const payload = await buildScreenshotPayload(cdp);

    // If the payload contains files, send them as text (base64) since
    // Telegram file sending requires special API calls handled by the adapter.
    if (payload.files && payload.files.length > 0) {
        await sendFilePayload(message, payload);
    } else {
        await message.reply(payload).catch(logger.error);
    }
}

async function handleAutoAccept(deps: TelegramCommandDeps, message: PlatformMessage, args: string): Promise<void> {
    // If args are provided (e.g. /autoaccept on), handle directly
    if (args) {
        const result = deps.bridge.autoAccept.handle(args);
        await message.reply({ text: result.message }).catch(logger.error);
        return;
    }

    // No args — show interactive UI with buttons
    const payload = buildAutoAcceptPayload(deps.bridge.autoAccept.isEnabled());
    await message.reply(payload).catch(logger.error);
}

async function handleTemplate(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    if (!deps.templateRepo) {
        await message.reply({ text: 'Template service not available.' }).catch(logger.error);
        return;
    }

    const templates = deps.templateRepo.findAll();
    const payload = buildTemplatePayload(templates);
    await message.reply(payload).catch(logger.error);
}

async function handleTemplateAdd(deps: TelegramCommandDeps, message: PlatformMessage, args: string): Promise<void> {
    if (!deps.templateRepo) {
        await message.reply({ text: 'Template service not available.' }).catch(logger.error);
        return;
    }

    // Split args into name (first word) and prompt (rest)
    const spaceIndex = args.indexOf(' ');
    if (!args || spaceIndex === -1) {
        await message.reply({
            text: 'Usage: /template_add &lt;name&gt; &lt;prompt&gt;\nExample: /template_add daily-report Write a daily standup report',
        }).catch(logger.error);
        return;
    }

    const name = args.slice(0, spaceIndex);
    const prompt = args.slice(spaceIndex + 1).trim();

    try {
        deps.templateRepo.create({ name, prompt });
        await message.reply({ text: `Template '${escapeHtml(name)}' created.` }).catch(logger.error);
    } catch (err: any) {
        if (err?.message?.includes('UNIQUE constraint')) {
            await message.reply({ text: `Template '${escapeHtml(name)}' already exists.` }).catch(logger.error);
        } else {
            logger.error('[TelegramCommand:template_add]', err?.message || err);
            await message.reply({ text: 'Failed to create template.' }).catch(logger.error);
        }
    }
}

async function handleTemplateDelete(deps: TelegramCommandDeps, message: PlatformMessage, args: string): Promise<void> {
    if (!deps.templateRepo) {
        await message.reply({ text: 'Template service not available.' }).catch(logger.error);
        return;
    }

    const name = args.trim();
    if (!name) {
        await message.reply({
            text: 'Usage: /template_delete &lt;name&gt;\nExample: /template_delete daily-report',
        }).catch(logger.error);
        return;
    }

    const deleted = deps.templateRepo.deleteByName(name);
    if (deleted) {
        await message.reply({ text: `Template '${escapeHtml(name)}' deleted.` }).catch(logger.error);
    } else {
        await message.reply({ text: `Template '${escapeHtml(name)}' not found.` }).catch(logger.error);
    }
}

async function handleProjectCreate(deps: TelegramCommandDeps, message: PlatformMessage, args: string): Promise<void> {
    if (!deps.workspaceService) {
        await message.reply({ text: 'Workspace service not available.' }).catch(logger.error);
        return;
    }

    const name = args.trim();
    if (!name) {
        await message.reply({
            text: 'Usage: /project_create &lt;name&gt;\nExample: /project_create NewProject',
        }).catch(logger.error);
        return;
    }

    try {
        const safePath = deps.workspaceService.validatePath(name);

        if (deps.workspaceService.exists(name)) {
            await message.reply({ text: `Workspace '${escapeHtml(name)}' already exists.` }).catch(logger.error);
            return;
        }

        fs.mkdirSync(safePath, { recursive: true });
        await message.reply({ text: `Workspace '${escapeHtml(name)}' created.` }).catch(logger.error);
    } catch (err: any) {
        logger.error('[TelegramCommand:project_create]', err?.message || err);
        await message.reply({ text: `Failed to create workspace: ${escapeHtml(err?.message || 'unknown error')}` }).catch(logger.error);
    }
}

async function handleLogs(message: PlatformMessage, args: string): Promise<void> {
    const countArg = args ? parseInt(args, 10) : 20;
    const count = isNaN(countArg) ? 20 : Math.min(Math.max(countArg, 1), 50);

    const entries = logBuffer.getRecent(count);
    if (entries.length === 0) {
        await message.reply({ text: 'No log entries.' }).catch(logger.error);
        return;
    }

    const lines = entries.map(
        (e) => `<code>${e.timestamp.slice(11, 19)}</code> [${e.level.toUpperCase()}] ${escapeHtml(e.message)}`,
    );

    const text = `<b>Recent Logs (${entries.length})</b>\n\n${lines.join('\n')}`;

    // Telegram message limit is 4096 chars
    const truncated = text.length > 4096 ? text.slice(0, 4090) + '\n...' : text;
    await message.reply({ text: truncated }).catch(logger.error);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send a MessagePayload that contains file attachments.
 * Falls back to a text reply if file sending is not supported.
 */
async function sendFilePayload(message: PlatformMessage, payload: MessagePayload): Promise<void> {
    // Try sending with files — the Telegram adapter supports this if sendPhoto is available
    try {
        await message.reply(payload);
    } catch (err: unknown) {
        logger.warn('[TelegramCommand:screenshot] File sending failed:', err instanceof Error ? err.message : err);
        await message.reply({ text: 'Screenshot captured but file sending failed.' }).catch(logger.error);
    }
}
