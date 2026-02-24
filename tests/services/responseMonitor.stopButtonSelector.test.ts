import * as vm from 'vm';
import { RESPONSE_SELECTORS } from '../../src/services/responseMonitor';

type MockButton = {
    tagName?: string;
    textContent?: string;
    offsetParent: unknown;
    click: jest.Mock<void, []>;
    getAttribute: (name: string) => string | null;
    querySelector: (selector: string) => unknown;
    querySelectorAll?: (selector: string) => unknown[];
    getBoundingClientRect: () => { top?: number; left?: number; width: number; height: number };
};

type MockInput = {
    offsetParent: unknown;
    parentElement: any;
    getBoundingClientRect: () => { top?: number; left?: number; width: number; height: number };
};

function createInput(top: number = 400, left: number = 20): MockInput {
    const container = {
        parentElement: null,
        querySelectorAll: () => [],
    };
    return {
        offsetParent: {},
        parentElement: container,
        getBoundingClientRect: () => ({ top, left, width: 320, height: 120 }),
    };
}

function createScope(button: MockButton, extraControls: MockButton[] = [], inputs: MockInput[] = []) {
    const controls = [button, ...extraControls];
    return {
        querySelector: (selector: string) => {
            if (selector.includes('input-send-button-cancel-tooltip')) {
                return controls.find((control) => (control.getAttribute('data-tooltip-id') || '') === 'input-send-button-cancel-tooltip') || null;
            }
            if (selector.includes('Stop generating')) {
                return controls.find((control) => (control.getAttribute('aria-label') || '') === 'Stop generating') || null;
            }
            return null;
        },
        querySelectorAll: (selector: string) => {
            if (
                selector === 'button' ||
                selector === 'button, [role="button"]' ||
                selector === 'button, [role="button"], [class*="cursor-pointer"], [tabindex]'
            ) {
                return controls;
            }
            if (selector === 'div[role="textbox"]:not(.xterm-helper-textarea), textarea, [contenteditable="true"]') {
                return inputs;
            }
            return [];
        },
    };
}

function runSelectorScript(script: string, panel: ReturnType<typeof createScope>): unknown {
    const document = {
        querySelector: (selector: string) => {
            if (selector === '.antigravity-agent-side-panel') return panel;
            return null;
        },
        querySelectorAll: () => [],
    };

    const window = {
        getComputedStyle: () => ({
            display: 'block',
            visibility: 'visible',
            opacity: '1',
        }),
    };

    return vm.runInNewContext(script, { document, window, Array, Math, Set, Number });
}

function runStopSelector(panel: ReturnType<typeof createScope>): boolean {
    const value = runSelectorScript(RESPONSE_SELECTORS.STOP_BUTTON, panel);
    if (typeof value === 'boolean') return value;
    if (value && typeof value === 'object' && typeof (value as { isGenerating?: unknown }).isGenerating === 'boolean') {
        return Boolean((value as { isGenerating: boolean }).isGenerating);
    }
    return false;
}

describe('ResponseMonitor stop selector robustness', () => {
    it('detects the stop button even when offsetParent is null for fixed-position elements', () => {
        const button: MockButton = {
            // Fixed-position elements can have null offsetParent
            offsetParent: null,
            click: jest.fn(),
            getAttribute: (name: string) => (name === 'aria-label' ? 'Stop generating' : null),
            querySelector: () => null,
            getBoundingClientRect: () => ({ top: 420, left: 300, width: 120, height: 32 }),
        };

        const panel = createScope(button);
        const isStopVisible = runStopSelector(panel);

        expect(isStopVisible).toBe(true);
    });

    it('clicks the stop button even when offsetParent is null for fixed-position elements', () => {
        const button: MockButton = {
            offsetParent: null,
            click: jest.fn(),
            getAttribute: (name: string) => (name === 'aria-label' ? 'Stop generating' : null),
            querySelector: () => null,
            getBoundingClientRect: () => ({ top: 420, left: 300, width: 120, height: 32 }),
        };

        const panel = createScope(button);
        const result = runSelectorScript(RESPONSE_SELECTORS.CLICK_STOP_BUTTON, panel) as {
            ok?: boolean;
        };

        expect(result.ok).toBe(true);
        expect(button.click).toHaveBeenCalledTimes(1);
    });

    it('detects the cancel button by data-tooltip-id as generating', () => {
        const button: MockButton = {
            offsetParent: null,
            click: jest.fn(),
            getAttribute: (name: string) => (name === 'data-tooltip-id' ? 'input-send-button-cancel-tooltip' : null),
            querySelector: () => null,
            getBoundingClientRect: () => ({ top: 420, left: 300, width: 120, height: 32 }),
        };

        const panel = createScope(button);
        const isStopVisible = runStopSelector(panel);

        expect(isStopVisible).toBe(true);
    });

    it('can perform stop operation even for a red square icon without role=button', () => {
        const genericControl: MockButton = {
            offsetParent: null,
            click: jest.fn(),
            getAttribute: (name: string) => {
                if (name === 'class') return 'cursor-pointer text-red-500';
                return null;
            },
            querySelector: (selector: string) => {
                if (selector === 'svg') return { getAttribute: () => '' };
                if (selector === 'svg rect') return { nodeName: 'rect' };
                return null;
            },
            querySelectorAll: () => [],
            getBoundingClientRect: () => ({ top: 420, left: 300, width: 36, height: 36 }),
        };

        const unrelatedButton: MockButton = {
            offsetParent: {},
            click: jest.fn(),
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            getBoundingClientRect: () => ({ top: 40, left: 40, width: 80, height: 28 }),
        };

        const panel = createScope(unrelatedButton, [genericControl]);
        const result = runSelectorScript(RESPONSE_SELECTORS.CLICK_STOP_BUTTON, panel) as {
            ok?: boolean;
        };

        expect(result.ok).toBe(true);
        expect(genericControl.click).toHaveBeenCalledTimes(1);
    });

    it('does not use a generic red square icon button for generating detection', () => {
        const genericControl: MockButton = {
            offsetParent: null,
            click: jest.fn(),
            getAttribute: (name: string) => {
                if (name === 'class') return 'cursor-pointer text-red-500';
                return null;
            },
            querySelector: (selector: string) => {
                if (selector === 'svg') return { getAttribute: () => '' };
                if (selector === 'svg rect') return { nodeName: 'rect' };
                return null;
            },
            querySelectorAll: () => [],
            getBoundingClientRect: () => ({ top: 420, left: 300, width: 36, height: 36 }),
        };

        const neutralButton: MockButton = {
            offsetParent: {},
            click: jest.fn(),
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            getBoundingClientRect: () => ({ top: 40, left: 40, width: 80, height: 28 }),
        };

        const panel = createScope(neutralButton, [genericControl]);
        const isStopVisible = runStopSelector(panel);

        expect(isStopVisible).toBe(false);
    });

    it('uses a square icon button near the input area for generating detection', () => {
        const input = createInput();
        const squareButton: MockButton = {
            tagName: 'BUTTON',
            offsetParent: null,
            click: jest.fn(),
            getAttribute: () => null,
            querySelector: (selector: string) => {
                if (selector === 'svg') return { getAttribute: () => '' };
                if (selector === 'svg rect') return { nodeName: 'rect' };
                return null;
            },
            querySelectorAll: () => [],
            getBoundingClientRect: () => ({ top: 430, left: 330, width: 36, height: 36 }),
        };

        const panel = createScope(squareButton, [], [input]);
        const isStopVisible = runStopSelector(panel);

        expect(isStopVisible).toBe(true);
    });

    it('does not detect an arrow icon button near the input area as generating', () => {
        const input = createInput();
        const sendButton: MockButton = {
            tagName: 'BUTTON',
            offsetParent: null,
            click: jest.fn(),
            getAttribute: () => null,
            querySelector: (selector: string) => {
                if (selector === 'svg') return { getAttribute: () => '' };
                if (selector === 'svg rect') return null;
                if (selector === 'svg path, svg polyline, svg line') return { nodeName: 'path' };
                return null;
            },
            querySelectorAll: () => [],
            getBoundingClientRect: () => ({ top: 430, left: 330, width: 36, height: 36 }),
        };

        const panel = createScope(sendButton, [], [input]);
        const isStopVisible = runStopSelector(panel);

        expect(isStopVisible).toBe(false);
    });

    it('does not misidentify a microphone button (path+rect SVG) as a stop button', () => {
        const input = createInput();
        const micButton: MockButton = {
            tagName: 'BUTTON',
            offsetParent: null,
            click: jest.fn(),
            getAttribute: () => null,
            querySelector: (selector: string) => {
                if (selector === 'svg') return { getAttribute: () => '' };
                if (selector === 'svg > rect') return { nodeName: 'rect' };
                if (selector === 'svg rect') return { nodeName: 'rect' };
                if (selector === 'svg path') return { nodeName: 'path' };
                if (selector === 'svg path, svg polyline, svg line') return { nodeName: 'path' };
                return null;
            },
            querySelectorAll: () => [],
            getBoundingClientRect: () => ({ top: 430, left: 330, width: 36, height: 36 }),
        };

        const panel = createScope(micButton, [], [input]);
        const isStopVisible = runStopSelector(panel);

        expect(isStopVisible).toBe(false);
    });

    it('does not click a microphone button (path+rect SVG)', () => {
        const input = createInput();
        const micButton: MockButton = {
            tagName: 'BUTTON',
            offsetParent: null,
            click: jest.fn(),
            getAttribute: () => null,
            querySelector: (selector: string) => {
                if (selector === 'svg') return { getAttribute: () => '' };
                if (selector === 'svg > rect') return { nodeName: 'rect' };
                if (selector === 'svg rect') return { nodeName: 'rect' };
                if (selector === 'svg path') return { nodeName: 'path' };
                if (selector === 'svg path, svg polyline, svg line') return { nodeName: 'path' };
                return null;
            },
            querySelectorAll: () => [],
            getBoundingClientRect: () => ({ top: 430, left: 330, width: 36, height: 36 }),
        };

        const panel = createScope(micButton, [], [input]);
        const result = runSelectorScript(RESPONSE_SELECTORS.CLICK_STOP_BUTTON, panel) as {
            ok?: boolean;
        };

        expect(result.ok).toBe(false);
        expect(micButton.click).not.toHaveBeenCalled();
    });

    it('still detects a rect-only SVG (no path) as a stop button', () => {
        const input = createInput();
        const stopButton: MockButton = {
            tagName: 'BUTTON',
            offsetParent: null,
            click: jest.fn(),
            getAttribute: () => null,
            querySelector: (selector: string) => {
                if (selector === 'svg') return { getAttribute: () => '' };
                if (selector === 'svg > rect') return { nodeName: 'rect' };
                if (selector === 'svg rect') return { nodeName: 'rect' };
                if (selector === 'svg path') return null;
                if (selector === 'svg path, svg polyline, svg line') return null;
                return null;
            },
            querySelectorAll: () => [],
            getBoundingClientRect: () => ({ top: 430, left: 330, width: 36, height: 36 }),
        };

        const panel = createScope(stopButton, [], [input]);
        const isStopVisible = runStopSelector(panel);

        expect(isStopVisible).toBe(true);
    });
});
