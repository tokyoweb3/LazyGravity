import { ModeService, AVAILABLE_MODES, DEFAULT_MODE } from '../../src/services/modeService';

describe('ModeService', () => {
    let modeService: ModeService;

    beforeEach(() => {
        modeService = new ModeService();
    });

    describe('getCurrentMode - 現在のモードの取得', () => {
        it('初期状態ではデフォルトモード("fast")を返すこと', () => {
            expect(modeService.getCurrentMode()).toBe(DEFAULT_MODE);
        });
    });

    describe('setMode - モードの切り替え', () => {
        it('有効なモード名を指定した場合、モードが切り替わること', () => {
            const result = modeService.setMode('plan');
            expect(result.success).toBe(true);
            expect(result.mode).toBe('plan');
            expect(modeService.getCurrentMode()).toBe('plan');
        });

        it('複数回切り替えても最後に設定したモードが保持されること', () => {
            modeService.setMode('plan');
            modeService.setMode('fast');
            expect(modeService.getCurrentMode()).toBe('fast');
        });

        it('無効なモード名を指定した場合、エラーを返しモードは変更されないこと', () => {
            const result = modeService.setMode('invalid_mode');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(modeService.getCurrentMode()).toBe(DEFAULT_MODE);
        });

        it('大文字小文字を区別せずにモードを設定できること', () => {
            const result = modeService.setMode('FAST');
            expect(result.success).toBe(true);
            expect(result.mode).toBe('fast');
        });

        it('空文字列を指定した場合、エラーを返すこと', () => {
            const result = modeService.setMode('');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('getAvailableModes - 利用可能なモード一覧の取得', () => {
        it('利用可能なモードの一覧を返すこと', () => {
            const modes = modeService.getAvailableModes();
            expect(modes).toEqual(AVAILABLE_MODES);
            expect(modes.length).toBe(2);
        });
    });
});
