import { AutoAcceptService } from '../../src/services/autoAcceptService';

describe('AutoAcceptService', () => {
    it('initial state matches the constructor argument', () => {
        expect(new AutoAcceptService().isEnabled()).toBe(false);
        expect(new AutoAcceptService(true).isEnabled()).toBe(true);
    });

    it('enables the service with "on"', () => {
        const service = new AutoAcceptService(false);
        const result = service.handle('on');

        expect(result.success).toBe(true);
        expect(result.enabled).toBe(true);
        expect(result.changed).toBe(true);
        expect(service.isEnabled()).toBe(true);
    });

    it('disables the service with "off"', () => {
        const service = new AutoAcceptService(true);
        const result = service.handle('off');

        expect(result.success).toBe(true);
        expect(result.enabled).toBe(false);
        expect(result.changed).toBe(true);
        expect(service.isEnabled()).toBe(false);
    });

    it('does not change state with "status"', () => {
        const service = new AutoAcceptService(true);
        const result = service.handle('status');

        expect(result.success).toBe(true);
        expect(result.enabled).toBe(true);
        expect(result.changed).toBe(false);
        expect(service.isEnabled()).toBe(true);
    });

    it('returns an error for invalid arguments without changing state', () => {
        const service = new AutoAcceptService(false);
        const result = service.handle('invalid');

        expect(result.success).toBe(false);
        expect(result.enabled).toBe(false);
        expect(result.changed).toBe(false);
        expect(service.isEnabled()).toBe(false);
        expect(result.message).toContain('on/off/status');
    });
});
