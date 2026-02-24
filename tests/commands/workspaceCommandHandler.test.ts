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
    });

    describe('getWorkspaceForChannel', () => {
        it('returns the workspace path for a bound channel', () => {
            bindingRepo.create({ channelId: 'ch-1', workspacePath: 'my-proj', guildId: 'guild-1' });
            const result = handler.getWorkspaceForChannel('ch-1');
            expect(result).toBe(path.join(tmpDir, 'my-proj'));
        });

        it('returns undefined when the channel is not bound', () => {
            const result = handler.getWorkspaceForChannel('ch-1');
            expect(result).toBeUndefined();
        });
    });
});
