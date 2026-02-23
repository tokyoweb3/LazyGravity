import { t } from "../utils/i18n";

export type AutoAcceptAction = 'on' | 'off' | 'status';

export interface AutoAcceptCommandResult {
    success: boolean;
    enabled: boolean;
    changed: boolean;
    message: string;
}

export class AutoAcceptService {
    private enabled: boolean;

    constructor(initialEnabled: boolean = false) {
        this.enabled = initialEnabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    handle(rawAction?: string): AutoAcceptCommandResult {
        const action = this.normalizeAction(rawAction);
        if (!action) {
            return {
                success: false,
                enabled: this.enabled,
                changed: false,
                message: t('⚠️ Invalid argument. Usage: `/autoaccept [on/off/status]`'),
            };
        }

        if (action === 'status') {
            return {
                success: true,
                enabled: this.enabled,
                changed: false,
                message: t(`⚙️ Auto-accept mode: **${this.enabled ? 'ON' : 'OFF'}**`),
            };
        }

        if (action === 'on') {
            if (this.enabled) {
                return {
                    success: true,
                    enabled: true,
                    changed: false,
                    message: t('ℹ️ Auto-accept mode is already **ON**.'),
                };
            }
            this.enabled = true;
            return {
                success: true,
                enabled: true,
                changed: true,
                message: t('✅ Auto-accept mode turned **ON**. Future dialogs will be auto-allowed.'),
            };
        }

        if (!this.enabled) {
            return {
                success: true,
                enabled: false,
                changed: false,
                message: t('ℹ️ Auto-accept mode is already **OFF**.'),
            };
        }

        this.enabled = false;
        return {
            success: true,
            enabled: false,
            changed: true,
            message: t('✅ Auto-accept mode turned **OFF**. Returned to manual approval.'),
        };
    }

    private normalizeAction(rawAction?: string): AutoAcceptAction | null {
        if (!rawAction || rawAction.trim().length === 0) return 'status';

        const normalized = rawAction.trim().toLowerCase();
        if (['on', 'enable', 'enabled', 'true', '1', 'オン'].includes(normalized)) {
            return 'on';
        }
        if (['off', 'disable', 'disabled', 'false', '0', 'オフ'].includes(normalized)) {
            return 'off';
        }
        if (['status', 'state', 'show', '状態'].includes(normalized)) {
            return 'status';
        }
        return null;
    }
}
