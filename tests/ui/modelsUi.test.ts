import { sendModelsUI } from '../../src/ui/modelsUi';

describe('modelsUi', () => {
    it('未接続時は接続エラーメッセージを返す', async () => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };
        await sendModelsUI(target, {
            getCurrentCdp: () => null,
            fetchQuota: async () => [],
        });

        expect(target.editReply).toHaveBeenCalledWith({ content: 'CDPに未接続です。' });
    });

    it('モデル一覧がある場合はEmbedを返す', async () => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Model A', 'Model B']),
            getCurrentModel: jest.fn().mockResolvedValue('Model A'),
        };

        await sendModelsUI(target, {
            getCurrentCdp: () => cdp as any,
            fetchQuota: async () => [],
        });

        const payload = target.editReply.mock.calls[0][0];
        expect(payload.embeds?.length).toBeGreaterThan(0);
        expect(payload.components?.length).toBeGreaterThan(0);
    });
});
