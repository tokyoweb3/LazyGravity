import { AutoAcceptService } from '../../src/services/autoAcceptService';

describe('AutoAcceptService', () => {
    it('初期状態はコンストラクタ引数どおりであること', () => {
        expect(new AutoAcceptService().isEnabled()).toBe(false);
        expect(new AutoAcceptService(true).isEnabled()).toBe(true);
    });

    it('on で有効化されること', () => {
        const service = new AutoAcceptService(false);
        const result = service.handle('on');

        expect(result.success).toBe(true);
        expect(result.enabled).toBe(true);
        expect(result.changed).toBe(true);
        expect(service.isEnabled()).toBe(true);
    });

    it('off で無効化されること', () => {
        const service = new AutoAcceptService(true);
        const result = service.handle('off');

        expect(result.success).toBe(true);
        expect(result.enabled).toBe(false);
        expect(result.changed).toBe(true);
        expect(service.isEnabled()).toBe(false);
    });

    it('status では状態変更しないこと', () => {
        const service = new AutoAcceptService(true);
        const result = service.handle('status');

        expect(result.success).toBe(true);
        expect(result.enabled).toBe(true);
        expect(result.changed).toBe(false);
        expect(service.isEnabled()).toBe(true);
    });

    it('無効な引数ではエラーを返し状態変更しないこと', () => {
        const service = new AutoAcceptService(false);
        const result = service.handle('invalid');

        expect(result.success).toBe(false);
        expect(result.enabled).toBe(false);
        expect(result.changed).toBe(false);
        expect(service.isEnabled()).toBe(false);
        expect(result.message).toContain('on/off/status');
    });
});
