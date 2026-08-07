import { createInteractionCreateHandler } from '../../src/events/interactionCreateHandler';
import { QUESTION_SELECT_ACTION_PREFIX, QUESTION_SKIP_ACTION_PREFIX } from '../../src/services/notificationSender';
import path from 'path';
import fs from 'fs';

jest.mock('../../src/handlers/questionSelectAction', () => ({
    createQuestionSelectAction: jest.fn(),
}));

jest.mock('../../src/handlers/questionSkipAction', () => ({
    createQuestionSkipAction: jest.fn(),
}));

jest.mock('child_process', () => ({
    execFile: jest.fn(),
}));

describe('interactionCreateHandler - question select and skip', () => {
    function createBaseDeps(overrides: Record<string, any> = {}) {
        return {
            config: { allowedUserIds: ['allowed'] },
            bridge: {
                selectedAccountByChannel: new Map<string, string>(),
                pool: {
                    getConnected: jest.fn(),
                },
            } as any,
            cleanupHandler: {} as any,
            modeService: {} as any,
            modelService: {} as any,
            slashCommandHandler: {} as any,
            wsHandler: {} as any,
            chatHandler: {} as any,
            client: {} as any,
            sendModeUI: jest.fn(),
            sendModelsUI: jest.fn(),
            sendAutoAcceptUI: jest.fn(),
            getCurrentCdp: jest.fn(),
            parseApprovalCustomId: jest.fn().mockReturnValue(null),
            parseErrorPopupCustomId: jest.fn().mockReturnValue(null),
            parsePlanningCustomId: jest.fn().mockReturnValue(null),
            parseFileChangeCustomId: jest.fn().mockReturnValue(null),
            parseRunCommandCustomId: jest.fn().mockReturnValue(null),
            handleSlashInteraction: jest.fn(),
            promptDispatcher: {
                resume: jest.fn().mockResolvedValue(undefined),
            } as any,
            chatSessionService: {} as any,
            chatSessionRepo: {
                findByChannelId: jest.fn().mockReturnValue({ channelId: 'channel-a', activeAccountName: 'default' }),
            } as any,
            channelManager: {} as any,
            titleGenerator: {} as any,
            userPrefRepo: {} as any,
            channelPrefRepo: {
                getAccountName: jest.fn().mockReturnValue(null),
            } as any,
            accountPrefRepo: {
                getAccountName: jest.fn().mockReturnValue(null),
            } as any,
            antigravityAccounts: [
                { name: 'default', cdpPort: 9222 },
            ],
            artifactService: {} as any,
            ...overrides,
        };
    }

    it('resumes prompt dispatcher when question select action executes successfully', async () => {
        const { createQuestionSelectAction } = require('../../src/handlers/questionSelectAction');
        const mockExecute = jest.fn().mockResolvedValue(true);
        createQuestionSelectAction.mockReturnValue({
            execute: mockExecute,
        });

        const mockCdp = {
            getPrimaryContextId: jest.fn().mockReturnValue(1),
        };
        const getConnected = jest.fn().mockReturnValue(mockCdp);

        const deps = createBaseDeps({
            bridge: {
                selectedAccountByChannel: new Map<string, string>(),
                pool: {
                    getConnected,
                },
            } as any,
        });

        const handler = createInteractionCreateHandler(deps);

        const interaction = {
            isAutocomplete: () => false,
            isButton: () => false,
            isStringSelectMenu: () => true,
            user: { id: 'allowed' },
            customId: `${QUESTION_SELECT_ACTION_PREFIX}:test:channel-a`,
            channelId: 'channel-a',
            message: { id: 'msg-1' },
            values: ['0'],
            reply: jest.fn().mockResolvedValue(undefined),
            deferUpdate: jest.fn().mockResolvedValue(undefined),
            editReply: jest.fn().mockResolvedValue(undefined),
            followUp: jest.fn().mockResolvedValue(undefined),
        } as any;

        await handler(interaction);

        expect(mockExecute).toHaveBeenCalled();
        expect(getConnected).toHaveBeenCalled();
        expect(deps.promptDispatcher.resume).toHaveBeenCalledWith(
            expect.objectContaining({
                message: interaction.message,
                cdp: mockCdp,
            })
        );
    });

    it('resumes prompt dispatcher when question skip action executes successfully', async () => {
        const { createQuestionSkipAction } = require('../../src/handlers/questionSkipAction');
        const mockExecute = jest.fn().mockResolvedValue(true);
        createQuestionSkipAction.mockReturnValue({
            execute: mockExecute,
        });

        const mockCdp = {
            getPrimaryContextId: jest.fn().mockReturnValue(1),
        };
        const getConnected = jest.fn().mockReturnValue(mockCdp);

        const deps = createBaseDeps({
            bridge: {
                selectedAccountByChannel: new Map<string, string>(),
                pool: {
                    getConnected,
                },
            } as any,
        });

        const handler = createInteractionCreateHandler(deps);

        const interaction = {
            isAutocomplete: () => false,
            isButton: () => true,
            isStringSelectMenu: () => false,
            user: { id: 'allowed' },
            customId: `${QUESTION_SKIP_ACTION_PREFIX}:test:channel-a`,
            channelId: 'channel-a',
            message: { id: 'msg-1' },
            reply: jest.fn().mockResolvedValue(undefined),
            deferUpdate: jest.fn().mockResolvedValue(undefined),
            editReply: jest.fn().mockResolvedValue(undefined),
            followUp: jest.fn().mockResolvedValue(undefined),
        } as any;

        await handler(interaction);

        expect(mockExecute).toHaveBeenCalled();
        expect(getConnected).toHaveBeenCalled();
        expect(deps.promptDispatcher.resume).toHaveBeenCalledWith(
            expect.objectContaining({
                message: interaction.message,
                cdp: mockCdp,
            })
        );
    });

    it('resolves relative file open path without cache and reads file content', async () => {
        const workspacePath = path.resolve('tmp/my-project');
        const relativePath = 'src/index.ts';
        const absolutePath = path.join(workspacePath, relativePath);
        
        const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue('console.log("hello");');
        const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true);

        const deps = createBaseDeps({
            wsHandler: {
                getWorkspaceForChannel: jest.fn().mockReturnValue(workspacePath),
            } as any,
        });

        const handler = createInteractionCreateHandler(deps);

        const interaction = {
            isAutocomplete: () => false,
            isButton: () => true,
            isStringSelectMenu: () => false,
            user: { id: 'allowed' },
            customId: `file_open:rel:${relativePath}`,
            channelId: 'channel-a',
            message: { id: 'msg-1' },
            reply: jest.fn().mockResolvedValue(undefined),
            deferUpdate: jest.fn().mockResolvedValue(undefined),
            editReply: jest.fn().mockResolvedValue(undefined),
            followUp: jest.fn().mockResolvedValue(undefined),
            component: { type: 2, label: 'Open index.ts' },
        } as any;

        await handler(interaction);

        expect(mockReadFileSync).toHaveBeenCalledWith(path.resolve(absolutePath), 'utf8');
        mockReadFileSync.mockRestore();
        mockExistsSync.mockRestore();
    });

    it('resolves artifact file open path without cache, bypassing workspace requirement', async () => {
        const workspaceBaseDir = path.resolve('tmp');
        const brainDir = path.join(workspaceBaseDir, '.gemini', 'antigravity', 'brain');
        const convId = 'uuid-123';
        const filename = 'walkthrough.md';
        const expectedPath = path.join(brainDir, convId, filename);

        const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue('# Walkthrough');

        const deps = createBaseDeps({
            config: { allowedUserIds: ['allowed'], workspaceBaseDir },
            wsHandler: {
                getWorkspaceForChannel: jest.fn().mockReturnValue(null), // no workspace
            } as any,
            artifactService: {
                listArtifacts: jest.fn().mockReturnValue([
                    { filename, absolutePath: expectedPath }
                ])
            } as any,
        });

        const handler = createInteractionCreateHandler(deps);

        const interaction = {
            isAutocomplete: () => false,
            isButton: () => true,
            isStringSelectMenu: () => false,
            user: { id: 'allowed' },
            customId: `file_open:art:${convId}:${filename}`,
            channelId: 'channel-a',
            message: { id: 'msg-1' },
            reply: jest.fn().mockResolvedValue(undefined),
            deferUpdate: jest.fn().mockResolvedValue(undefined),
            editReply: jest.fn().mockResolvedValue(undefined),
            followUp: jest.fn().mockResolvedValue(undefined),
            component: { type: 2, label: 'Review walkthrough.md' },
        } as any;

        await handler(interaction);

        expect(mockReadFileSync).toHaveBeenCalledWith(path.resolve(expectedPath), 'utf8');
        mockReadFileSync.mockRestore();
    });
});
