import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WorkspaceBindingRepository } from '../../src/database/workspaceBindingRepository';
import { ChatSessionRepository } from '../../src/database/chatSessionRepository';
import { WorkspaceService } from '../../src/services/workspaceService';
import { ChannelManager } from '../../src/services/channelManager';
import {
    WorkspaceCommandHandler,
    WORKSPACE_SELECT_ID,
} from '../../src/commands/workspaceCommandHandler';
import { ITEMS_PER_PAGE, PROJECT_SELECT_ID } from '../../src/ui/projectListUi';
import { DiscordAPIError } from 'discord.js';

describe('WorkspaceCommandHandler', () => {
    let db: Database.Database;
    let bindingRepo: WorkspaceBindingRepository;
    let chatSessionRepo: ChatSessionRepository;
    let tmpDir: string;
    let service: WorkspaceService;
    let channelManager: ChannelManager;
    let handler: WorkspaceCommandHandler;

    beforeEach(() => {
        db = new Database(':memory:');
        bindingRepo = new WorkspaceBindingRepository(db);
        chatSessionRepo = new ChatSessionRepository(db);
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cmd-test-'));
        service = new WorkspaceService(tmpDir);
        channelManager = new ChannelManager();
        handler = new WorkspaceCommandHandler(bindingRepo, chatSessionRepo, service, channelManager);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const mockInteraction = (overrides: Partial<{
        channelId: string;
        guildId: string;
    }> = {}) => ({
        channelId: overrides.channelId ?? 'ch-1',
        guildId: overrides.guildId ?? 'guild-1',
        editReply: jest.fn().mockResolvedValue(undefined),
    });

    describe('handleShow', () => {
        it('displays workspace list in a select menu', async () => {
            fs.mkdirSync(path.join(tmpDir, 'project-a'));
            const interaction = mockInteraction();

            await handler.handleShow(interaction as any);

            expect(interaction.editReply).toHaveBeenCalledTimes(1);
            const call = interaction.editReply.mock.calls[0][0];
            expect(call.embeds).toHaveLength(1);
            expect(call.components).toHaveLength(1);
        });

        it('displays without components when there are no workspaces', async () => {
            const interaction = mockInteraction();

            await handler.handleShow(interaction as any);

            const call = interaction.editReply.mock.calls[0][0];
            expect(call.components).toHaveLength(0);
        });
    });

    describe('handleSelectMenu', () => {
        it('creates a category and session-1 for the selected workspace and binds them', async () => {
            fs.mkdirSync(path.join(tmpDir, 'selected-project'));
            const onSessionChannelCreated = jest.fn().mockResolvedValue(undefined);
            handler = new WorkspaceCommandHandler(bindingRepo, chatSessionRepo, service, channelManager, onSessionChannelCreated);

            const mockGuild = {
                id: 'guild-1',
                channels: {
                    cache: {
                        find: jest.fn().mockReturnValue(undefined),
                    },
                    fetch: jest.fn().mockResolvedValue({
                        find: jest.fn().mockReturnValue(undefined),
                    }),
                    create: jest.fn()
                        .mockResolvedValueOnce({ id: 'cat-1', name: '🗂️-selected-project' })
                        .mockResolvedValueOnce({ id: 'new-ch-1', name: 'session-1' }),
                },
            };

            const interaction = {
                values: ['selected-project'],
                channelId: 'ch-1',
                guildId: 'guild-1',
                user: { id: 'user-1' },
                update: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleSelectMenu(interaction as any, mockGuild as any);

            expect(interaction.update).toHaveBeenCalledTimes(1);

            // The session-1 channel should be bound
            expect(bindingRepo.findByChannelId('new-ch-1')?.workspacePath).toBe('selected-project');

            // A chat session should be registered
            const session = chatSessionRepo.findByChannelId('new-ch-1');
            expect(session).toBeDefined();
            expect(session?.categoryId).toBe('cat-1');
            expect(session?.sessionNumber).toBe(1);
            expect(session?.workspacePath).toBe('selected-project');
            expect(onSessionChannelCreated).toHaveBeenCalledWith('selected-project', 'new-ch-1', 'ch-1', 'user-1');
        });

        it('displays an error for a non-existent workspace', async () => {
            const mockGuild = { id: 'guild-1' };
            const interaction = {
                values: ['nonexistent'],
                channelId: 'ch-1',
                guildId: 'guild-1',
                update: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleSelectMenu(interaction as any, mockGuild as any);

            const call = interaction.update.mock.calls[0][0];
            expect(call.content).toContain('not found');
        });

        it('cleans up stale binding when the Discord channel no longer exists', async () => {
            fs.mkdirSync(path.join(tmpDir, 'stale-project'));

            // Insert a stale binding manually
            bindingRepo.create({
                channelId: 'deleted-ch-1',
                workspacePath: 'stale-project',
                guildId: 'guild-1',
            });
            chatSessionRepo.create({
                channelId: 'deleted-ch-1',
                categoryId: 'old-cat',
                workspacePath: 'stale-project',
                sessionNumber: 1,
                guildId: 'guild-1',
            });

            // Mock guild where fetch rejects for the old channel
            const mockGuild = {
                id: 'guild-1',
                channels: {
                    cache: {
                        find: jest.fn().mockReturnValue(undefined),
                    },
                    fetch: jest.fn().mockImplementation((id) => {
                        if (id === 'deleted-ch-1') {
                            const err = new Error('Unknown Channel') as any;
                            err.code = 10003;
                            // Add DiscordAPIError prototype dynamically for instanceof check
                            Object.setPrototypeOf(err, DiscordAPIError.prototype);
                            return Promise.reject(err);
                        }
                        return Promise.resolve({
                            find: jest.fn().mockReturnValue(undefined),
                        });
                    }),
                    create: jest.fn()
                        .mockResolvedValueOnce({ id: 'cat-new', name: '🗂️-stale-project' })
                        .mockResolvedValueOnce({ id: 'new-ch-var', name: 'session-2' }),
                },
            };

            const interaction = {
                values: ['stale-project'],
                channelId: 'ch-1',
                guildId: 'guild-1',
                update: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handleSelectMenu(interaction as any, mockGuild as any);

            // Stale binding should be removed
            expect(bindingRepo.findByChannelId('deleted-ch-1')).toBeUndefined();

            // New binding should be created
            expect(bindingRepo.findByChannelId('new-ch-var')?.workspacePath).toBe('stale-project');
            expect(interaction.update).toHaveBeenCalledTimes(1);
        });
    });

    describe('handleShow pagination', () => {
        it('shows pagination buttons when >25 projects exist', async () => {
            for (let i = 0; i < 30; i++) {
                fs.mkdirSync(path.join(tmpDir, `proj-${String(i).padStart(3, '0')}`));
            }
            const interaction = mockInteraction();

            await handler.handleShow(interaction as any);

            const call = interaction.editReply.mock.calls[0][0];
            // 2 rows: select menu + button row
            expect(call.components).toHaveLength(2);

            const selectRow = call.components[0].toJSON();
            expect(selectRow.components[0].options).toHaveLength(ITEMS_PER_PAGE);

            const buttonRow = call.components[1].toJSON();
            expect(buttonRow.components).toHaveLength(2);
        });
    });

    describe('handlePageButton', () => {
        it('renders the requested page of workspaces', async () => {
            for (let i = 0; i < 30; i++) {
                fs.mkdirSync(path.join(tmpDir, `proj-${String(i).padStart(3, '0')}`));
            }

            const interaction = {
                deferUpdate: jest.fn().mockResolvedValue(undefined),
                editReply: jest.fn().mockResolvedValue(undefined),
            };

            await handler.handlePageButton(interaction as any, 1);

            expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
            expect(interaction.editReply).toHaveBeenCalledTimes(1);

            const call = interaction.editReply.mock.calls[0][0];
            const selectRow = call.components[0].toJSON();
            // Page 1 should have the remaining 5 projects
            expect(selectRow.components[0].options).toHaveLength(5);
        });
    });

    describe('getWorkspaceForChannel', () => {
        it('returns the workspace path for a bound channel', () => {
            bindingRepo.create({ channelId: 'ch-1', workspacePath: 'my-proj', guildId: 'guild-1' });
            const result = handler.getWorkspaceForChannel('ch-1');
            expect(result).toBe(path.join(tmpDir, 'my-proj'));
        });

        it('falls back to the chat session workspace when the channel binding is missing', () => {
            chatSessionRepo.create({
                channelId: 'ch-session-1',
                categoryId: 'cat-1',
                workspacePath: 'session-proj',
                sessionNumber: 1,
                guildId: 'guild-1',
            });

            const result = handler.getWorkspaceForChannel('ch-session-1');
            expect(result).toBe(path.join(tmpDir, 'session-proj'));
        });

        it('returns undefined when the channel is not bound', () => {
            const result = handler.getWorkspaceForChannel('ch-1');
            expect(result).toBeUndefined();
        });
    });
});
