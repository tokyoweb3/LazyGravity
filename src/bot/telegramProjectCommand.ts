import { logger } from '../utils/logger';
import type { PlatformMessage, PlatformSelectInteraction, SelectMenuDef } from '../platform/types';
import type { TelegramBindingRepository } from '../database/telegramBindingRepository';
import type { WorkspaceService } from '../services/workspaceService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TG_PROJECT_SELECT_ID = 'tg_project_select';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export type TelegramProjectSubcommand = 'list' | 'unbind';

/**
 * Command arguments container for the telegram project settings command.
 */
export interface ParsedProjectCommand {
    /** Target subcommand (e.g. list, unbind). */
    readonly subcommand: TelegramProjectSubcommand;
}

/**
 * Parse a Telegram message text for the /project command.
 * Returns null if the text is not a /project command.
 *
 * Accepted formats:
 *   /project
 *   /project list
 *   /project unbind
 *   /project@BotName
 *   /project@BotName list
 * @param text Raw command text.
 * @returns Parsed command results or null.
 */
export function parseTelegramProjectCommand(text: string): ParsedProjectCommand | null {
    const trimmed = text.trim();

    // Match /project optionally followed by @BotName and an optional subcommand
    const match = trimmed.match(/^\/project(?:@\S+)?(?:\s+(\S+))?$/i);
    if (!match) return null;

    const sub = match[1]?.toLowerCase();
    if (sub === 'unbind') {
        return { subcommand: 'unbind' };
    }

    // Default (no subcommand or "list") → show workspace list
    return { subcommand: 'list' };
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

import type { CdpBridge } from '../services/cdpBridgeManager';
import { escapeHtml } from '../platform/telegram/telegramFormatter';

/**
 * Dependencies injected into telegram project command handlers.
 */
export interface TelegramProjectCommandDeps {
    /** Low-level bot API. */
    readonly botApi?: any;
    /** Active CDP bridge manager reference. */
    readonly bridge?: CdpBridge;
    /** Scan workspaces path helper. */
    readonly workspaceService: WorkspaceService;
    /** Telegram bindings database store repository. */
    readonly telegramBindingRepo: TelegramBindingRepository;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Handle a /project command from Telegram.
 * @param deps Injected dependencies.
 * @param message Platform trigger message.
 * @param parsed Parsed subcommand arguments.
 */
export async function handleTelegramProjectCommand(
    deps: TelegramProjectCommandDeps,
    message: PlatformMessage,
    parsed: ParsedProjectCommand,
): Promise<void> {
    const chatId = message.channel.id;

    if (parsed.subcommand === 'unbind') {
        const deleted = deps.telegramBindingRepo.deleteByChatId(chatId);
        if (deleted) {
            await message.reply({ text: 'Workspace binding removed.' }).catch(logger.error);
        } else {
            await message.reply({ text: 'No workspace is bound to this chat.' }).catch(logger.error);
        }
        return;
    }

    // subcommand === 'list'
    const workspaces = deps.workspaceService.scanWorkspaces();
    if (workspaces.length === 0) {
        await message.reply({
            text: 'No workspaces found. Create a workspace directory first.',
        }).catch(logger.error);
        return;
    }

    const currentBinding = deps.telegramBindingRepo.findByChatId(chatId);
    const currentPath = currentBinding?.workspacePath;

    const selectMenu: SelectMenuDef = {
        type: 'selectMenu',
        customId: TG_PROJECT_SELECT_ID,
        placeholder: 'Select a workspace',
        options: workspaces.map((name) => ({
            label: name === currentPath ? `${name} (current)` : name,
            value: name,
        })),
    };

    const header = currentPath
        ? `Current workspace: <b>${currentPath}</b>\nSelect a workspace to switch:`
        : 'Select a workspace to bind to this chat:';

    await message.reply({
        text: header,
        components: [{ components: [selectMenu] }],
    }).catch(logger.error);
}

// ---------------------------------------------------------------------------
// Select interaction handler
// ---------------------------------------------------------------------------

/**
 * Attempts to automatically create a dedicated Telegram topic for the workspace and bind it.
 * @param botApi Low-level telegram bot API.
 * @param originalChannelId Original base group chat ID.
 * @param workspacePath Workspace directory path.
 * @param telegramBindingRepo Database repository store.
 * @param pool CdpConnectionPool manager.
 * @returns Resolved channel/topic ID string.
 */
export async function tryCreateTopicAndBind(
    botApi: any,
    originalChannelId: string,
    workspacePath: string,
    telegramBindingRepo: any,
    pool: any
): Promise<string> {
    const baseChatId = originalChannelId.split('_')[0];
    const isExistingTopic = originalChannelId.includes('_');

    if (isExistingTopic) {
        telegramBindingRepo.upsert({
            chatId: originalChannelId,
            workspacePath,
        });
        return originalChannelId;
    }

    try {
        const chat = await botApi.getChat(baseChatId);
        logger.debug(`[Telegram] getChat(${baseChatId}) returned:`, chat);
        if (chat?.is_forum) {
            const projectName = pool.extractProjectName(workspacePath) || 'Project';
            const topicName = `[Session] ${projectName}`.substring(0, 128);
            const topic = await botApi.createForumTopic(baseChatId, topicName);
            const threadId = topic.message_thread_id;
            const newChannelId = `${baseChatId}_${threadId}`;

            telegramBindingRepo.upsert({
                chatId: newChannelId,
                workspacePath,
            });

            await botApi.sendMessage(baseChatId, `✅ <b>${escapeHtml(projectName)}</b> session started in this topic.`, {
                message_thread_id: threadId,
                parse_mode: 'HTML'
            }).catch((e: any) => logger.warn('Failed to send welcome message to new topic', e));

            return newChannelId;
        }
    } catch (error: any) {
        logger.debug(`[Telegram] Could not create forum topic for chat ${baseChatId}`, error);
        
        // If the error is specifically a permissions error for creating topics
        const errStr = String(error);
        if (errStr.includes('not enough rights') || errStr.includes('400')) {
            await botApi.sendMessage(
                baseChatId,
                '⚠️ <b>Permission Error:</b> I do not have permission to create a Topic (Forum) in this group.\n\n' +
                'Please follow these steps to fix:\n' +
                '1. Go to Group Info -> Edit -> Administrators\n' +
                '2. Select this bot (<code>@' + (botApi.me?.username || 'bot') + '</code>)\n' +
                '3. Enable the <b>"Manage Topics"</b> (or "Change Group Info") permission\n' +
                '4. Try binding the project or using /new again.',
                { parse_mode: 'HTML' }
            ).catch((e: any) => logger.warn('Failed to send permission error message', e));
        }
    }

    telegramBindingRepo.upsert({
        chatId: originalChannelId,
        workspacePath,
    });
    return originalChannelId;
}

/**
 * Handle a workspace selection callback from inline keyboard.
 * @param deps Injected dependencies.
 * @param interaction Select menu interaction.
 */
export async function handleTelegramProjectSelect(
    deps: TelegramProjectCommandDeps,
    interaction: PlatformSelectInteraction,
): Promise<void> {
    const selectedWorkspace = interaction.values[0];
    if (!selectedWorkspace) return;

    const chatId = interaction.channel.id;

    // Validate workspace exists
    const workspaces = deps.workspaceService.scanWorkspaces();
    if (!workspaces.includes(selectedWorkspace)) {
        await interaction.reply({
            text: `Workspace "${selectedWorkspace}" not found.`,
        }).catch(logger.error);
        return;
    }

    let finalChannelId = chatId;
    if (deps.botApi && deps.bridge) {
        finalChannelId = await tryCreateTopicAndBind(
            deps.botApi,
            chatId,
            selectedWorkspace,
            deps.telegramBindingRepo,
            deps.bridge.pool
        );
    } else {
        deps.telegramBindingRepo.upsert({
            chatId,
            workspacePath: selectedWorkspace,
        });
    }

    if (finalChannelId !== chatId) {
        await interaction.update({
            text: `✅ Workspace bound to new topic: <b>${escapeHtml(selectedWorkspace)}</b>`,
        }).catch(logger.error);
    } else {
        await interaction.update({
            text: `Workspace bound: <b>${escapeHtml(selectedWorkspace)}</b>\nSend a message to start chatting with Antigravity.`,
        }).catch(logger.error);
    }

    logger.info(`[TelegramProject] Chat ${chatId} bound to workspace: ${selectedWorkspace}`);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a select interaction handler that routes by customId.
 * Returns a function suitable for EventRouter's onSelectInteraction.
 * @param deps Injected dependencies.
 * @returns Event selection handler function.
 */
export function createTelegramSelectHandler(
    deps: TelegramProjectCommandDeps,
): (interaction: PlatformSelectInteraction) => Promise<void> {
    return async (interaction: PlatformSelectInteraction): Promise<void> => {
        if (interaction.customId === TG_PROJECT_SELECT_ID) {
            await handleTelegramProjectSelect(deps, interaction);
            return;
        }

        // Unknown select interaction — ignore
        logger.debug(`[TelegramSelect] Unhandled customId: ${interaction.customId}`);
    };
}
