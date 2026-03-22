import {
    createPlatformMessageHandler,
    type MessageHandlerDeps,
} from '../../src/handlers/messageHandler';
import type {
    PlatformMessage,
    PlatformUser,
    PlatformChannel,
    PlatformSentMessage,
} from '../../src/platform/types';
import { logger } from '../../src/utils/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSentMessage(
    overrides: Partial<PlatformSentMessage> = {},
): PlatformSentMessage {
    return {
        id: 'sent-1',
        platform: 'discord',
        channelId: 'ch-1',
        edit: jest.fn(),
        delete: jest.fn(),
        ...overrides,
    };
}

function makeChannel(
    overrides: Partial<PlatformChannel> = {},
): PlatformChannel {
    return {
        id: 'ch-1',
        platform: 'discord',
        name: 'test-channel',
        send: jest.fn().mockResolvedValue(makeSentMessage()),
        ...overrides,
    };
}

function makeUser(overrides: Partial<PlatformUser> = {}): PlatformUser {
    return {
        id: 'user-1',
        platform: 'discord',
        username: 'testuser',
        isBot: false,
        ...overrides,
    };
}

function makeMessage(
    overrides: Partial<PlatformMessage> = {},
): PlatformMessage {
    return {
        id: 'msg-1',
        platform: 'discord',
        content: 'Hello world',
        author: makeUser(),
        channel: makeChannel(),
        attachments: [],
        createdAt: new Date(),
        react: jest.fn(),
        reply: jest.fn().mockResolvedValue(makeSentMessage()),
        ...overrides,
    };
}

function makeDeps(
    overrides: Partial<MessageHandlerDeps> = {},
): MessageHandlerDeps {
    return {
        getWorkspaceForChannel: jest.fn().mockReturnValue('/workspace/path'),
        sendPrompt: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPlatformMessageHandler', () => {
    it('skips bot messages', async () => {
        const deps = makeDeps();
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage({
            author: makeUser({ isBot: true }),
        });

        await handler(message);

        expect(deps.sendPrompt).not.toHaveBeenCalled();
        expect(message.reply).not.toHaveBeenCalled();
    });

    it('skips empty messages with no attachments', async () => {
        const deps = makeDeps();
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage({ content: '   ', attachments: [] });

        await handler(message);

        expect(deps.sendPrompt).not.toHaveBeenCalled();
        expect(message.reply).not.toHaveBeenCalled();
    });

    it('dispatches text commands starting with ! to handleTextCommand', async () => {
        const handleTextCommand = jest.fn().mockResolvedValue(true);
        const deps = makeDeps({ handleTextCommand });
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage({ content: '!screenshot full' });

        await handler(message);

        expect(handleTextCommand).toHaveBeenCalledWith(
            message,
            'screenshot',
            ['full'],
        );
        expect(deps.sendPrompt).not.toHaveBeenCalled();
    });

    it('falls through to sendPrompt if handleTextCommand returns false', async () => {
        const handleTextCommand = jest.fn().mockResolvedValue(false);
        const deps = makeDeps({ handleTextCommand });
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage({ content: '!unknown' });

        await handler(message);

        expect(deps.sendPrompt).toHaveBeenCalled();
    });

    it('falls through to sendPrompt if handleTextCommand is not provided', async () => {
        const deps = makeDeps({ handleTextCommand: undefined });
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage({ content: '!screenshot' });

        await handler(message);

        expect(deps.sendPrompt).toHaveBeenCalledWith(
            message,
            '/workspace/path',
            '!screenshot',
        );
    });

    it('catches handleTextCommand errors and reports generic message to user', async () => {
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation();
        const handleTextCommand = jest
            .fn()
            .mockRejectedValue(new Error('DB connection lost'));
        const deps = makeDeps({ handleTextCommand });
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage({ content: '!screenshot full' });

        await handler(message);

        expect(errorSpy).toHaveBeenCalledWith(
            '[MessageHandler] Text command error:',
            'DB connection lost',
        );
        expect(message.reply).toHaveBeenCalledWith({
            text: 'An error occurred while processing the command.',
        });
        expect(deps.sendPrompt).not.toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('does not throw when handleTextCommand error reply itself fails', async () => {
        jest.spyOn(logger, 'error').mockImplementation();
        const handleTextCommand = jest
            .fn()
            .mockRejectedValue(new Error('DB connection lost'));
        const deps = makeDeps({ handleTextCommand });
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage({
            content: '!screenshot full',
            reply: jest.fn().mockRejectedValue(new Error('Reply failed')),
        });

        await expect(handler(message)).resolves.toBeUndefined();
        jest.restoreAllMocks();
    });

    it('routes messages with content to sendPrompt with correct workspace', async () => {
        const deps = makeDeps({
            getWorkspaceForChannel: jest
                .fn()
                .mockReturnValue('/my/workspace'),
        });
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage({ content: 'Build the feature' });

        await handler(message);

        expect(deps.sendPrompt).toHaveBeenCalledWith(
            message,
            '/my/workspace',
            'Build the feature',
        );
    });

    it('sends fallback prompt text when content is empty but attachments exist', async () => {
        const deps = makeDeps();
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage({
            content: '',
            attachments: [
                {
                    name: 'image.png',
                    contentType: 'image/png',
                    url: 'https://example.com/image.png',
                    size: 1024,
                },
            ],
        });

        await handler(message);

        expect(deps.sendPrompt).toHaveBeenCalledWith(
            message,
            '/workspace/path',
            'Please review the attached images and respond accordingly.',
        );
    });

    it('replies with "no project" message when no workspace is configured', async () => {
        const deps = makeDeps({
            getWorkspaceForChannel: jest.fn().mockReturnValue(undefined),
        });
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage();

        await handler(message);

        expect(message.reply).toHaveBeenCalledWith({
            text: 'No project is configured for this channel. Use `/project` to bind one, or `/project reopen` if this is a previously used session.',
        });
        expect(deps.sendPrompt).not.toHaveBeenCalled();
    });

    it('catches sendPrompt errors and reports to user', async () => {
        const deps = makeDeps({
            sendPrompt: jest
                .fn()
                .mockRejectedValue(new Error('CDP connection lost')),
        });
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage();

        await handler(message);

        expect(message.reply).toHaveBeenCalledWith({
            text: 'An error occurred while processing your message.',
        });
    });

    it('does not throw when error reply itself fails', async () => {
        const deps = makeDeps({
            sendPrompt: jest
                .fn()
                .mockRejectedValue(new Error('CDP connection lost')),
        });
        const handler = createPlatformMessageHandler(deps);
        const message = makeMessage({
            reply: jest.fn().mockRejectedValue(new Error('Reply failed')),
        });

        // Should not throw
        await expect(handler(message)).resolves.toBeUndefined();
    });
});
