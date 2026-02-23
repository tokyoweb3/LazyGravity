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

describe('ResponseMonitor stop selector robustness', () => {
    it('fixed配置でoffsetParentがnullでもストップボタンを検出できること', () => {
        const button: MockButton = {
            // fixed配置要素はoffsetParentがnullになることがある
            offsetParent: null,
            click: jest.fn(),
            getAttribute: (name: string) => (name === 'aria-label' ? 'Stop generating' : null),
            querySelector: () => null,
            getBoundingClientRect: () => ({ top: 420, left: 300, width: 120, height: 32 }),
        };

        const panel = createScope(button);
        const isStopVisible = runSelectorScript(RESPONSE_SELECTORS.STOP_BUTTON, panel);

        expect(isStopVisible).toBe(true);
    });

    it('fixed配置でoffsetParentがnullでもストップボタンをクリックできること', () => {
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

    it('role=buttonが無い赤い四角アイコンでも停止操作できること', () => {
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

    it('赤い四角アイコンのみの汎用ボタンは生成中判定に使わないこと', () => {
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
        const isStopVisible = runSelectorScript(RESPONSE_SELECTORS.STOP_BUTTON, panel);

        expect(isStopVisible).toBe(false);
    });

    it('入力欄右下の四角アイコンボタンは生成中判定に使うこと', () => {
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
        const isStopVisible = runSelectorScript(RESPONSE_SELECTORS.STOP_BUTTON, panel);

        expect(isStopVisible).toBe(true);
    });

    it('入力欄右下の矢印アイコンボタンは非生成中と判定すること', () => {
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
        const isStopVisible = runSelectorScript(RESPONSE_SELECTORS.STOP_BUTTON, panel);

        expect(isStopVisible).toBe(false);
    });

    it('マイクボタン（path+rect SVG）をストップボタンと誤判定しないこと', () => {
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
        const isStopVisible = runSelectorScript(RESPONSE_SELECTORS.STOP_BUTTON, panel);

        expect(isStopVisible).toBe(false);
    });

    it('マイクボタン（path+rect SVG）をクリックしないこと', () => {
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

    it('rect のみの SVG（pathなし）は引き続きストップボタンと判定すること', () => {
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
        const isStopVisible = runSelectorScript(RESPONSE_SELECTORS.STOP_BUTTON, panel);

        expect(isStopVisible).toBe(true);
    });
});
