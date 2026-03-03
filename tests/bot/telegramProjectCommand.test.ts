import {
    parseTelegramProjectCommand,
    handleTelegramProjectCommand,
    handleTelegramProjectSelect,
    createTelegramSelectHandler,
    TG_PROJECT_SELECT_ID,
} from '../../src/bot/telegramProjectCommand';
import type { PlatformMessage, PlatformSelectInteraction } from '../../src/platform/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockMessage(content = '/project', chatId = 'chat-100'): PlatformMessage {
    return {
        id: 'msg-1',
        platform: 'telegram',
        content,
        author: {
            id: 'user-1',
            platform: 'telegram',
            username: 'testuser',
            displayName: 'Test User',
            isBot: false,
        },
        channel: {
            id: chatId,
            platform: 'telegram',
            send: jest.fn().mockResolvedValue({
                id: '2',
                platform: 'telegram',
                channelId: chatId,
                edit: jest.fn(),
                delete: jest.fn(),
            }),
        },
        attachments: [],
        createdAt: new Date(),
        react: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue({
            id: '2',
            platform: 'telegram',
            channelId: chatId,
            edit: jest.fn(),
            delete: jest.fn(),
        }),
    } as any;
}

function createMockSelectInteraction(
    customId: string,
    values: string[],
    chatId = 'chat-100',
): PlatformSelectInteraction {
    return {
        id: 'interaction-1',
        platform: 'telegram',
        customId,
        user: {
            id: 'user-1',
            platform: 'telegram',
            username: 'testuser',
            displayName: 'Test User',
            isBot: false,
        },
        channel: {
            id: chatId,
            platform: 'telegram',
            send: jest.fn(),
        },
        values,
        messageId: 'msg-1',
        deferUpdate: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue({
            id: '3',
            platform: 'telegram',
            channelId: chatId,
            edit: jest.fn(),
            delete: jest.fn(),
        }),
    } as any;
}

function createMockWorkspaceService(workspaces: string[] = []) {
    return {
        scanWorkspaces: jest.fn().mockReturnValue(workspaces),
    } as any;
}

function createMockBindingRepo(binding?: { chatId: string; workspacePath: string }) {
    return {
        findByChatId: jest.fn().mockReturnValue(binding),
        deleteByChatId: jest.fn().mockReturnValue(!!binding),
        upsert: jest.fn().mockImplementation((input: any) => ({
            id: 1,
            chatId: input.chatId,
            workspacePath: input.workspacePath,
        })),
    } as any;
}

// ---------------------------------------------------------------------------
// Tests: parseTelegramProjectCommand
// ---------------------------------------------------------------------------

describe('parseTelegramProjectCommand', () => {
    it('parses bare /project as list', () => {
        const result = parseTelegramProjectCommand('/project');
        expect(result).toEqual({ subcommand: 'list' });
    });

    it('parses /project list', () => {
        const result = parseTelegramProjectCommand('/project list');
        expect(result).toEqual({ subcommand: 'list' });
    });

    it('parses /project unbind', () => {
        const result = parseTelegramProjectCommand('/project unbind');
        expect(result).toEqual({ subcommand: 'unbind' });
    });

    it('parses /project@BotName', () => {
        const result = parseTelegramProjectCommand('/project@MyBot');
        expect(result).toEqual({ subcommand: 'list' });
    });

    it('parses /project@BotName list', () => {
        const result = parseTelegramProjectCommand('/project@MyBot list');
        expect(result).toEqual({ subcommand: 'list' });
    });

    it('parses /project@BotName unbind', () => {
        const result = parseTelegramProjectCommand('/project@MyBot unbind');
        expect(result).toEqual({ subcommand: 'unbind' });
    });

    it('is case-insensitive for subcommand', () => {
        expect(parseTelegramProjectCommand('/project UNBIND')).toEqual({ subcommand: 'unbind' });
        expect(parseTelegramProjectCommand('/project LIST')).toEqual({ subcommand: 'list' });
    });

    it('returns null for non-project messages', () => {
        expect(parseTelegramProjectCommand('hello')).toBeNull();
        expect(parseTelegramProjectCommand('/other')).toBeNull();
        expect(parseTelegramProjectCommand('/projects')).toBeNull();
        expect(parseTelegramProjectCommand('some /project in middle')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseTelegramProjectCommand('')).toBeNull();
    });

    it('treats unknown subcommand as list', () => {
        // Only "unbind" is special; anything else defaults to list
        const result = parseTelegramProjectCommand('/project unknown');
        expect(result).toEqual({ subcommand: 'list' });
    });
});

// ---------------------------------------------------------------------------
// Tests: handleTelegramProjectCommand — list
// ---------------------------------------------------------------------------

describe('handleTelegramProjectCommand — list', () => {
    beforeEach(() => jest.clearAllMocks());

    it('replies with error when no workspaces exist', async () => {
        const message = createMockMessage();
        const deps = {
            workspaceService: createMockWorkspaceService([]),
            telegramBindingRepo: createMockBindingRepo(),
        };

        await handleTelegramProjectCommand(deps, message, { subcommand: 'list' });

        expect(message.reply).toHaveBeenCalledWith({
            text: 'No workspaces found. Create a workspace directory first.',
        });
    });

    it('shows workspace list with select menu', async () => {
        const message = createMockMessage();
        const deps = {
            workspaceService: createMockWorkspaceService(['proj-a', 'proj-b']),
            telegramBindingRepo: createMockBindingRepo(),
        };

        await handleTelegramProjectCommand(deps, message, { subcommand: 'list' });

        expect(message.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                text: expect.stringContaining('Select a workspace'),
                components: expect.arrayContaining([
                    expect.objectContaining({
                        components: expect.arrayContaining([
                            expect.objectContaining({
                                type: 'selectMenu',
                                customId: TG_PROJECT_SELECT_ID,
                                options: [
                                    { label: 'proj-a', value: 'proj-a' },
                                    { label: 'proj-b', value: 'proj-b' },
                                ],
                            }),
                        ]),
                    }),
                ]),
            }),
        );
    });

    it('marks current workspace in list', async () => {
        const message = createMockMessage();
        const deps = {
            workspaceService: createMockWorkspaceService(['proj-a', 'proj-b']),
            telegramBindingRepo: createMockBindingRepo({
                chatId: 'chat-100',
                workspacePath: 'proj-a',
            }),
        };

        await handleTelegramProjectCommand(deps, message, { subcommand: 'list' });

        const replyCall = (message.reply as jest.Mock).mock.calls[0][0];
        const selectMenu = replyCall.components[0].components[0];
        expect(selectMenu.options[0].label).toBe('proj-a (current)');
        expect(selectMenu.options[1].label).toBe('proj-b');
    });

    it('shows "Current workspace" header when binding exists', async () => {
        const message = createMockMessage();
        const deps = {
            workspaceService: createMockWorkspaceService(['proj-a']),
            telegramBindingRepo: createMockBindingRepo({
                chatId: 'chat-100',
                workspacePath: 'proj-a',
            }),
        };

        await handleTelegramProjectCommand(deps, message, { subcommand: 'list' });

        const replyCall = (message.reply as jest.Mock).mock.calls[0][0];
        expect(replyCall.text).toContain('Current workspace');
        expect(replyCall.text).toContain('proj-a');
    });
});

// ---------------------------------------------------------------------------
// Tests: handleTelegramProjectCommand — unbind
// ---------------------------------------------------------------------------

describe('handleTelegramProjectCommand — unbind', () => {
    beforeEach(() => jest.clearAllMocks());

    it('removes binding and confirms', async () => {
        const message = createMockMessage();
        const deps = {
            workspaceService: createMockWorkspaceService(),
            telegramBindingRepo: createMockBindingRepo({
                chatId: 'chat-100',
                workspacePath: 'proj-a',
            }),
        };

        await handleTelegramProjectCommand(deps, message, { subcommand: 'unbind' });

        expect(deps.telegramBindingRepo.deleteByChatId).toHaveBeenCalledWith('chat-100');
        expect(message.reply).toHaveBeenCalledWith({
            text: 'Workspace binding removed.',
        });
    });

    it('replies with message when no binding exists', async () => {
        const message = createMockMessage();
        const repo = createMockBindingRepo();
        repo.deleteByChatId.mockReturnValue(false);
        const deps = {
            workspaceService: createMockWorkspaceService(),
            telegramBindingRepo: repo,
        };

        await handleTelegramProjectCommand(deps, message, { subcommand: 'unbind' });

        expect(message.reply).toHaveBeenCalledWith({
            text: 'No workspace is bound to this chat.',
        });
    });
});

// ---------------------------------------------------------------------------
// Tests: handleTelegramProjectSelect
// ---------------------------------------------------------------------------

describe('handleTelegramProjectSelect', () => {
    beforeEach(() => jest.clearAllMocks());

    it('binds selected workspace and updates message', async () => {
        const interaction = createMockSelectInteraction(TG_PROJECT_SELECT_ID, ['proj-a']);
        const deps = {
            workspaceService: createMockWorkspaceService(['proj-a', 'proj-b']),
            telegramBindingRepo: createMockBindingRepo(),
        };

        await handleTelegramProjectSelect(deps, interaction);

        expect(deps.telegramBindingRepo.upsert).toHaveBeenCalledWith({
            chatId: 'chat-100',
            workspacePath: 'proj-a',
        });
        expect(interaction.update).toHaveBeenCalledWith(
            expect.objectContaining({
                text: expect.stringContaining('proj-a'),
            }),
        );
    });

    it('replies with error for invalid workspace', async () => {
        const interaction = createMockSelectInteraction(TG_PROJECT_SELECT_ID, ['nonexistent']);
        const deps = {
            workspaceService: createMockWorkspaceService(['proj-a']),
            telegramBindingRepo: createMockBindingRepo(),
        };

        await handleTelegramProjectSelect(deps, interaction);

        expect(deps.telegramBindingRepo.upsert).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith({
            text: 'Workspace "nonexistent" not found.',
        });
    });

    it('does nothing when values is empty', async () => {
        const interaction = createMockSelectInteraction(TG_PROJECT_SELECT_ID, []);
        const deps = {
            workspaceService: createMockWorkspaceService(['proj-a']),
            telegramBindingRepo: createMockBindingRepo(),
        };

        await handleTelegramProjectSelect(deps, interaction);

        expect(deps.telegramBindingRepo.upsert).not.toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Tests: createTelegramSelectHandler
// ---------------------------------------------------------------------------

describe('createTelegramSelectHandler', () => {
    beforeEach(() => jest.clearAllMocks());

    it('routes tg_project_select to handleTelegramProjectSelect', async () => {
        const interaction = createMockSelectInteraction(TG_PROJECT_SELECT_ID, ['proj-a']);
        const deps = {
            workspaceService: createMockWorkspaceService(['proj-a']),
            telegramBindingRepo: createMockBindingRepo(),
        };

        const handler = createTelegramSelectHandler(deps);
        await handler(interaction);

        expect(deps.telegramBindingRepo.upsert).toHaveBeenCalled();
    });

    it('ignores unrelated customId', async () => {
        const interaction = createMockSelectInteraction('some_other_select', ['value']);
        const deps = {
            workspaceService: createMockWorkspaceService(),
            telegramBindingRepo: createMockBindingRepo(),
        };

        const handler = createTelegramSelectHandler(deps);
        await handler(interaction);

        expect(deps.telegramBindingRepo.upsert).not.toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
    });
});
