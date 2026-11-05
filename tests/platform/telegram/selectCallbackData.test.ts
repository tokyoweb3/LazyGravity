import { encodeSelectCallback, decodeSelectCallback, SELECT_CALLBACK_SEP } from '../../../src/platform/telegram/selectCallbackData';

describe('Telegram select callback data', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it.each(['a'.repeat(61), '專'.repeat(20) + 'a'])('preserves an exactly 64-byte callback (%s)', customId => {
        const callback = encodeSelectCallback(customId, 'ok');
        expect(Buffer.byteLength(callback, 'utf8')).toBe(64);
        expect(callback).toBe(`${customId}${SELECT_CALLBACK_SEP}ok`);
        expect(decodeSelectCallback(callback)).toEqual({ customId, value: 'ok' });
    });

    it.each(['a'.repeat(62), '專'.repeat(21)])('tokenizes oversized callbacks without truncating their state (%s)', customId => {
        const value = 'exact model and effort';
        const callback = encodeSelectCallback(customId, value);
        expect(Buffer.byteLength(callback, 'utf8')).toBeLessThanOrEqual(64);
        expect(decodeSelectCallback(callback)).toEqual({ customId, value });
    });

    it('expires tokens and never decodes missing tokens as another action', () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(0);
        const callback = encodeSelectCallback('menu'.repeat(30), '0');
        now.mockReturnValue(24 * 60 * 60 * 1000);
        expect(decodeSelectCallback(callback)).toBe('expired');
        expect(decodeSelectCallback('lgsel:missing-after-restart')).toBe('expired');
        expect(decodeSelectCallback('ordinary_button:project:channel')).toBeNull();
    });

    it('bounds retained callback state and rejects evicted tokens', () => {
        const id = 'menu'.repeat(30);
        const oldest = encodeSelectCallback(id, 'first');
        let latest = '';
        for (let index = 0; index < 10000; index++) latest = encodeSelectCallback(id, String(index));
        expect(decodeSelectCallback(oldest)).toBe('expired');
        expect(decodeSelectCallback(latest)).toEqual({ customId: id, value: '9999' });
    });
});
