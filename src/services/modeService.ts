import { t } from "../utils/i18n";

/**
 * Available execution modes
 * fast: Fast response mode (for simple tasks)
 * plan: Planning mode (execute complex tasks step by step)
 */
export const AVAILABLE_MODES = ['fast', 'plan'] as const;

/** Mode display name mapping */
export const MODE_DISPLAY_NAMES: Record<string, string> = {
    fast: '⚡ Fast',
    plan: '📋 Plan',
};

/** Mode description mapping */
export const MODE_DESCRIPTIONS: Record<string, string> = {
    fast: t('Fast Mode — for simple tasks'),
    plan: t('Plan Mode — for complex step-by-step tasks'),
};

/** Antigravity UI display name mapping (internal name -> UI display name) */
export const MODE_UI_NAMES: Record<string, string> = {
    fast: 'Fast',
    plan: 'Planning',
};

/** Reverse mapping from UI display name -> internal name */
export const MODE_UI_NAME_REVERSE: Record<string, string> = Object.fromEntries(
    Object.entries(MODE_UI_NAMES).map(([k, v]) => [v.toLowerCase(), k])
);

/** Default execution mode */
export const DEFAULT_MODE: Mode = 'fast';

/** Mode type definition */
export type Mode = typeof AVAILABLE_MODES[number];

/** Mode set result type definition */
export interface ModeSetResult {
    success: boolean;
    mode?: Mode;
    error?: string;
}

/**
 * Service class for managing execution modes.
 * Handles mode switching via the /mode command.
 */
export class ModeService {
    private currentMode: Mode = DEFAULT_MODE;

    /**
     * Get the current execution mode
     */
    public getCurrentMode(): Mode {
        return this.currentMode;
    }

    /**
     * Switch execution mode
     * @param modeName Mode name to set (case-insensitive)
     */
    public setMode(modeName: string): ModeSetResult {
        if (!modeName || modeName.trim() === '') {
            return {
                success: false,
                error: t('⚠️ Mode name not specified. Available modes: ') + AVAILABLE_MODES.join(', '),
            };
        }

        const normalized = modeName.trim().toLowerCase() as Mode;

        if (!AVAILABLE_MODES.includes(normalized)) {
            return {
                success: false,
                error: t(`⚠️ Invalid mode "${modeName}". Available modes: ${AVAILABLE_MODES.join(', ')}`),
            };
        }

        this.currentMode = normalized;
        return {
            success: true,
            mode: this.currentMode,
        };
    }

    /**
     * Get the list of available modes
     */
    public getAvailableModes(): readonly string[] {
        return AVAILABLE_MODES;
    }
}
