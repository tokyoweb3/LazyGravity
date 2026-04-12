import { createAccountSelectAction } from '../../src/handlers/accountSelectAction';
import { ACCOUNT_SELECT_ID } from '../../src/ui/accountUi';

jest.mock('../../src/ui/accountUi', () => ({
    ACCOUNT_SELECT_ID: 'account_select',
    buildAccountPayload: jest.fn().mockImplementation((current: string, names: string[]) => ({
        text: `Current: ${current}; Available: ${names.join(', ')}`,
        components: [],
    })),
}));

jest.mock('../../src/utils/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function createMockInteraction() {
    return {
        id: 'int-1',
        platform: 'telegram' as const,
        customId: ACCOUNT_SELECT_ID,
        user: { id: 'user-1', platform: 'telegram' as const, username: 'test', isBot: false },
        channel: { id: 'ch-1', platform: 'telegram' as const, send: jest.fn() },
        values: ['work'],
        messageId: 'msg-1',
        deferUpdate: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue({ id: '2', platform: 'telegram', channelId: 'ch-1', edit: jest.fn(), delete: jest.fn() }),
    };
}

describe('createAccountSelectAction', () => {
    let bridge: any;
    let accountPrefRepo: any;
    let channelPrefRepo: any;
    let chatSessionRepo: any;

    beforeEach(() => {
        jest.clearAllMocks();
        bridge = {
            selectedAccountByChannel: new Map<string, string>(),
        };
        accountPrefRepo = {
            setAccountName: jest.fn(),
        };
        channelPrefRepo = {
            setAccountName: jest.fn(),
        };
        chatSessionRepo = {
            findByChannelId: jest.fn().mockReturnValue(null),
            setActiveAccountName: jest.fn(),
        };
    });

    it('matches the account select custom id', () => {
        const action = createAccountSelectAction({
            bridge,
            accountPrefRepo,
            channelPrefRepo,
            chatSessionRepo,
            antigravityAccounts: [{ name: 'default', cdpPort: 9222 }],
        });

        expect(action.match(ACCOUNT_SELECT_ID)).toBe(true);
        expect(action.match('other_select')).toBe(false);
    });

    it('stores account preferences when no chat session exists', async () => {
        const action = createAccountSelectAction({
            bridge,
            accountPrefRepo,
            channelPrefRepo,
            chatSessionRepo,
            getWorkspacePathForChannel: jest.fn().mockReturnValue('/tmp/project'),
            antigravityAccounts: [
                { name: 'default', cdpPort: 9222 },
                { name: 'work', cdpPort: 9333 },
            ],
        });
        const interaction = createMockInteraction();

        await action.execute(interaction as any, ['work']);

        expect(interaction.deferUpdate).toHaveBeenCalled();
        expect(bridge.selectedAccountByChannel.get('ch-1')).toBe('work');
        expect(accountPrefRepo.setAccountName).toHaveBeenCalledWith('user-1', 'work');
        expect(channelPrefRepo.setAccountName).toHaveBeenCalledWith('ch-1', 'work');
        expect(chatSessionRepo.setActiveAccountName).not.toHaveBeenCalled();
        expect(interaction.update).toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith(
            expect.objectContaining({ text: '✅ Switched session account to **work**.' }),
        );
    });

    it('updates the active session when the channel is already bound', async () => {
        chatSessionRepo.findByChannelId.mockReturnValue({ channelId: 'ch-1' });
        const action = createAccountSelectAction({
            bridge,
            accountPrefRepo,
            channelPrefRepo,
            chatSessionRepo,
            antigravityAccounts: [
                { name: 'default', cdpPort: 9222 },
                { name: 'work', cdpPort: 9333 },
            ],
        });
        const interaction = createMockInteraction();

        await action.execute(interaction as any, ['work']);

        expect(chatSessionRepo.setActiveAccountName).toHaveBeenCalledWith('ch-1', 'work');
        expect(accountPrefRepo.setAccountName).not.toHaveBeenCalled();
        expect(channelPrefRepo.setAccountName).not.toHaveBeenCalled();
    });

    it('rejects unknown accounts', async () => {
        const action = createAccountSelectAction({
            bridge,
            accountPrefRepo,
            channelPrefRepo,
            chatSessionRepo,
            antigravityAccounts: [{ name: 'default', cdpPort: 9222 }],
        });
        const interaction = createMockInteraction();

        await action.execute(interaction as any, ['missing']);

        expect(interaction.deferUpdate).not.toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith(
            expect.objectContaining({ text: '⚠️ Unknown account: **missing**' }),
        );
    });
});
