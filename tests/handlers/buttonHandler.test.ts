import {
    createPlatformButtonHandler,
    type ButtonAction,
    type ButtonHandlerDeps,
} from '../../src/handlers/buttonHandler';
import type {
    PlatformButtonInteraction,
    PlatformUser,
    PlatformChannel,
    PlatformSentMessage,
} from '../../src/platform/types';
import { logger } from '../../src/utils/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChannel(
    overrides: Partial<PlatformChannel> = {},
): PlatformChannel {
    return {
        id: 'ch-1',
        platform: 'discord',
        name: 'test-channel',
        send: jest.fn(),
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

function makeButtonInteraction(
    overrides: Partial<PlatformButtonInteraction> = {},
): PlatformButtonInteraction {
    return {
        id: 'int-1',
        platform: 'discord',
        customId: 'btn_approve_42',
        user: makeUser(),
        channel: makeChannel(),
        messageId: 'msg-1',
        deferUpdate: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue({
            id: 'sent-1',
            platform: 'discord',
            channelId: 'ch-1',
            edit: jest.fn(),
            delete: jest.fn(),
        } as PlatformSentMessage),
        showModal: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPlatformButtonHandler', () => {
    it('executes the matching action', async () => {
        const executeFn = jest.fn().mockResolvedValue(undefined);
        const action: ButtonAction = {
            match: (id) =>
                id.startsWith('btn_approve_')
                    ? { taskId: id.split('_')[2] }
                    : null,
            execute: executeFn,
        };
        const handler = createPlatformButtonHandler({ actions: [action] });
        const interaction = makeButtonInteraction({
            customId: 'btn_approve_99',
        });

        await handler(interaction);

        expect(executeFn).toHaveBeenCalledWith(interaction, { taskId: '99' });
    });

    it('logs a warning when no action matches', async () => {
        const warnSpy = jest.spyOn(logger, 'warn').mockImplementation();
        const handler = createPlatformButtonHandler({ actions: [] });
        const interaction = makeButtonInteraction({
            customId: 'unknown_btn',
        });

        await handler(interaction);

        expect(warnSpy).toHaveBeenCalledWith(
            '[ButtonHandler] No handler for customId: unknown_btn',
        );
        warnSpy.mockRestore();
    });

    it('catches action errors and reports to user', async () => {
        const action: ButtonAction = {
            match: () => ({}),
            execute: jest
                .fn()
                .mockRejectedValue(new Error('Database timeout')),
        };
        const handler = createPlatformButtonHandler({ actions: [action] });
        const interaction = makeButtonInteraction();

        await handler(interaction);

        expect(interaction.reply).toHaveBeenCalledWith({
            text: 'An error occurred while processing the button action.',
            ephemeral: true,
        });
    });

    it('does not throw when error reply itself fails', async () => {
        const action: ButtonAction = {
            match: () => ({}),
            execute: jest
                .fn()
                .mockRejectedValue(new Error('Database timeout')),
        };
        const handler = createPlatformButtonHandler({ actions: [action] });
        const interaction = makeButtonInteraction({
            reply: jest.fn().mockRejectedValue(new Error('Reply failed')),
        });

        await expect(handler(interaction)).resolves.toBeUndefined();
    });

    it('catches match() errors and reports to user', async () => {
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation();
        const action: ButtonAction = {
            match: () => {
                throw new Error('Regex compilation failed');
            },
            execute: jest.fn(),
        };
        const handler = createPlatformButtonHandler({ actions: [action] });
        const interaction = makeButtonInteraction();

        await handler(interaction);

        expect(errorSpy).toHaveBeenCalledWith(
            '[ButtonHandler] Match error:',
            'Regex compilation failed',
        );
        expect(interaction.reply).toHaveBeenCalledWith({
            text: 'An error occurred while processing the button action.',
            ephemeral: true,
        });
        expect(action.execute).not.toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('does not throw when match error reply itself fails', async () => {
        jest.spyOn(logger, 'error').mockImplementation();
        const action: ButtonAction = {
            match: () => {
                throw new Error('Regex compilation failed');
            },
            execute: jest.fn(),
        };
        const handler = createPlatformButtonHandler({ actions: [action] });
        const interaction = makeButtonInteraction({
            reply: jest.fn().mockRejectedValue(new Error('Reply failed')),
        });

        await expect(handler(interaction)).resolves.toBeUndefined();
        jest.restoreAllMocks();
    });

    it('first matching action wins (order matters)', async () => {
        const firstExecute = jest.fn().mockResolvedValue(undefined);
        const secondExecute = jest.fn().mockResolvedValue(undefined);
        const actions: ButtonAction[] = [
            {
                match: (id) => (id === 'shared_id' ? { source: 'first' } : null),
                execute: firstExecute,
            },
            {
                match: (id) => (id === 'shared_id' ? { source: 'second' } : null),
                execute: secondExecute,
            },
        ];
        const handler = createPlatformButtonHandler({ actions });
        const interaction = makeButtonInteraction({ customId: 'shared_id' });

        await handler(interaction);

        expect(firstExecute).toHaveBeenCalledWith(interaction, {
            source: 'first',
        });
        expect(secondExecute).not.toHaveBeenCalled();
    });
});
