import { sendAccountUI, ACCOUNT_SELECT_ID } from '../../src/ui/accountUi';

describe('accountUi', () => {
    it('passes account selector UI to editReply', async () => {
        const target = { editReply: jest.fn().mockResolvedValue(undefined) };

        await sendAccountUI(target, 'work1', ['default', 'work1']);

        expect(target.editReply).toHaveBeenCalledTimes(1);
        const payload = target.editReply.mock.calls[0][0];
        expect(payload.embeds?.length).toBeGreaterThan(0);
        expect(payload.components?.length).toBeGreaterThan(0);

        const select = payload.components[0]?.components?.[0];
        expect(select?.data?.custom_id).toBe(ACCOUNT_SELECT_ID);
    });
});
