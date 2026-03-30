import { selectTelegramStartupChatId } from '../../src/bot/telegramStartupTarget';

describe('selectTelegramStartupChatId', () => {
    it('prefers a group chat named general', async () => {
        const getChat = jest.fn(async (chatId: string) => {
            if (chatId === '-1001') return { id: -1001, type: 'private', first_name: 'CY' };
            if (chatId === '-2002') return { id: -2002, type: 'supergroup', title: 'general' };
            return { id: chatId, type: 'private' };
        });

        const chatId = await selectTelegramStartupChatId(
            { getChat } as any,
            [
                { id: 1, chatId: '-1001', workspacePath: 'A' },
                { id: 2, chatId: '-2002_76', workspacePath: 'B' },
                { id: 3, chatId: '-2002_126', workspacePath: 'C' },
            ],
        );

        expect(chatId).toBe('-2002');
        expect(getChat).toHaveBeenCalledTimes(2);
    });

    it('falls back to the first private chat when no general group exists', async () => {
        const getChat = jest.fn(async (chatId: string) => {
            if (chatId === '-1001') return { id: -1001, type: 'private', first_name: 'CY' };
            if (chatId === '-2002') return { id: -2002, type: 'supergroup', title: 'Project Room' };
            return { id: chatId, type: 'private' };
        });

        const chatId = await selectTelegramStartupChatId(
            { getChat } as any,
            [
                { id: 1, chatId: '-1001', workspacePath: 'A' },
                { id: 2, chatId: '-2002_76', workspacePath: 'B' },
            ],
        );

        expect(chatId).toBe('-1001');
    });

    it('prefers a directly bound group chat before private chat', async () => {
        const getChat = jest.fn(async (chatId: string) => {
            if (chatId === '-1001') return { id: -1001, type: 'private', first_name: 'CY' };
            if (chatId === '-2002') return { id: -2002, type: 'supergroup', title: 'Team Forum' };
            return { id: chatId, type: 'private' };
        });

        const chatId = await selectTelegramStartupChatId(
            { getChat } as any,
            [
                { id: 1, chatId: '-1001', workspacePath: 'A' },
                { id: 2, chatId: '-2002', workspacePath: 'B' },
                { id: 3, chatId: '-2002_76', workspacePath: 'C' },
            ],
        );

        expect(chatId).toBe('-2002');
    });

    it('falls back to the first directly bound group chat when no private chat exists', async () => {
        const getChat = jest.fn(async (chatId: string) => {
            if (chatId === '-2002') return { id: -2002, type: 'supergroup', title: 'Project Room' };
            if (chatId === '-3003') return { id: -3003, type: 'group', title: 'Ops' };
            return { id: chatId, type: 'group' };
        });

        const chatId = await selectTelegramStartupChatId(
            { getChat } as any,
            [
                { id: 1, chatId: '-2002_76', workspacePath: 'A' },
                { id: 2, chatId: '-3003', workspacePath: 'B' },
            ],
        );

        expect(chatId).toBe('-3003');
    });
});
