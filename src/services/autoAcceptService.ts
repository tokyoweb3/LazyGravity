/**
 * Service to manage auto-accept configuration and operations.
 */

import { t } from "../utils/i18n";

/**
 * Normalized command action options.
 */
export type AutoAcceptAction = 'on' | 'off' | 'status';

/**
 * Return result mapping for executed commands.
 */
export interface AutoAcceptCommandResult {
    /** True if command execution was valid. */
    success: boolean;
    /** Current status flag state. */
    enabled: boolean;
    /** True if state transitioned. */
    changed: boolean;
    /** User status feedback message. */
    message: string;
}

/**
 * Service that manages auto-accept switches for prompts and dialogs.
 */
export class AutoAcceptService {
    /** Current state value. */
    private enabled: boolean;

    /**
     * Initializes the AutoAcceptService.
     * @param initialEnabled Initial state (default: false).
     */
    constructor(initialEnabled: boolean = false) {
        this.enabled = initialEnabled;
    }

    /**
     * Checks if auto-accept is active.
     * @returns True if enabled, false otherwise.
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Processes state requests to toggle or query status.
     * @param rawAction Command arguments.
     * @returns AutoAcceptCommandResult object.
     */
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

    /**
     * Normalizes a raw input command string to a recognized AutoAcceptAction.
     * @param rawAction Raw input string.
     * @returns Mapped action, or null if invalid.
     */
    private normalizeAction(rawAction?: string): AutoAcceptAction | null {
        if (!rawAction || rawAction.trim().length === 0) return 'status';

        const normalized = rawAction.trim().toLowerCase();
        if (['on', 'enable', 'enabled', 'true', '1'].includes(normalized)) {
            return 'on';
        }
        if (['off', 'disable', 'disabled', 'false', '0'].includes(normalized)) {
            return 'off';
        }
        if (['status', 'state', 'show'].includes(normalized)) {
            return 'status';
        }
        return null;
    }
}
