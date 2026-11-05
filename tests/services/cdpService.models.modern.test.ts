/** @jest-environment jsdom */
import { CdpService } from '../../src/services/cdpService';

describe('Antigravity 2.6 model picker', () => {
    let cdp: CdpService;
    let trigger: HTMLButtonElement;
    let unrelated: jest.Mock;
    let groupClick: jest.Mock;
    let select: jest.Mock;
    let confirmSelection: boolean;
    const bases = ['Gemini 4 Argon', 'Claude Opus 5.5'];

    beforeEach(() => {
        document.body.innerHTML = `
            <div role="dialog" id="conversation-sidebar"><button aria-selected="true">Claude Sonnet 5.5</button></div>
            <section><div data-testid="ask-question-header-text">Allow read access to this path?</div>
                <button id="permission-submit">Submit</button></section>
            <button data-testid="model-selector-trigger" id="model-trigger"
                aria-label="Select model, current: Gemini 4 Argon Medium" aria-expanded="false">
                Gemini 4 Argon<span> Medium</span></button>`;
        trigger = document.querySelector('[data-testid="model-selector-trigger"]')!;
        unrelated = jest.fn();
        groupClick = jest.fn();
        select = jest.fn();
        confirmSelection = true;
        document.querySelector('#conversation-sidebar')!.addEventListener('click', unrelated);
        document.querySelector('#permission-submit')!.addEventListener('click', unrelated);
        jest.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        trigger.addEventListener('click', openPicker);
        cdp = new CdpService();
        (cdp as any).isConnectedFlag = true;
        (cdp as any).ws = {};
        (cdp as any).contexts = [
            { id: -3, name: '', url: 'http://127.0.0.1:5000/?extensionView=true' },
            { id: 1, name: '', url: 'vscode-file://workbench.html' },
        ];
        jest.spyOn(cdp, 'call').mockImplementation(async (_method, params) => ({
            result: { value: await window.eval(params.expression) },
        }));
    });

    afterEach(() => { jest.restoreAllMocks(); document.body.innerHTML = ''; });

    function closePicker() {
        document.getElementById('models')?.remove();
        trigger.setAttribute('aria-expanded', 'false');
    }

    /** Simulate a model selection that may or may not update the IDE's verification trigger. */
    function choose(label: string) {
        select(label);
        if (confirmSelection) trigger.setAttribute('aria-label', 'Select model, current: ' + label);
        closePicker();
    }

    /** Mount a Radix-style model menu with keyboard-driven effort submenus and unrelated controls. */
    function openPicker() {
        if (document.getElementById('models')) return;
        const menu = document.createElement('div');
        menu.id = 'models';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-labelledby', trigger.id);
        menu.innerHTML = `<div data-testid="model-selector-panel">${bases.map((base, index) => `
            <div role="menuitem" tabindex="-1" id="group-${index}" aria-haspopup="menu">
                <span><span data-testid="model-selector-effort-group" data-model-base="${base}">${base}</span>
                    <span>Medium</span><span>New</span></span></div>`).join('')}
            <div role="menuitem" data-testid="model-selector-item" data-model-label="GPT-OSS 120B (Medium)">
                <span>GPT-OSS 120B (Medium)</span><span>Notice</span></div></div>`;
        menu.addEventListener('keydown', event => { if (event.key === 'Escape') closePicker(); });
        bases.forEach((base, index) => {
            const item = menu.querySelector<HTMLElement>('#group-' + index)!;
            item.addEventListener('click', groupClick);
            item.addEventListener('keydown', event => {
                if (event.key !== 'ArrowRight') return;
                const submenu = document.createElement('div');
                submenu.id = 'efforts-' + index;
                submenu.setAttribute('role', 'menu');
                submenu.setAttribute('aria-labelledby', item.id);
                item.setAttribute('aria-controls', submenu.id);
                submenu.innerHTML = ['Low', 'Medium', 'High'].map(effort => `
                    <div role="menuitemradio" aria-checked="${effort === 'Medium'}">
                        <span data-testid="model-selector-effort-option" data-effort="${effort.toLowerCase()}">${effort}</span>
                    </div>`).join('');
                submenu.addEventListener('keydown', keyEvent => { if (keyEvent.key === 'ArrowLeft') submenu.remove(); });
                submenu.querySelectorAll('[role="menuitemradio"]').forEach(option => option.addEventListener('click', () =>
                    choose(base + ' ' + option.textContent!.trim())));
                menu.querySelector('[data-testid="model-selector-panel"]')!.append(submenu);
            });
        });
        menu.querySelector('[data-testid="model-selector-item"]')!.addEventListener('click', () => choose('GPT-OSS 120B (Medium)'));
        document.body.append(menu);
        trigger.setAttribute('aria-expanded', 'true');
        trigger.setAttribute('aria-controls', menu.id);
    }

    it('lists exact models and effort variants without trigger, badge, or sidebar duplicates', async () => {
        expect(await cdp.getUiModels()).toEqual([
            'Gemini 4 Argon Low', 'Gemini 4 Argon Medium', 'Gemini 4 Argon High',
            'Claude Opus 5.5 Low', 'Claude Opus 5.5 Medium', 'Claude Opus 5.5 High',
            'GPT-OSS 120B (Medium)',
        ]);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(groupClick).not.toHaveBeenCalled();
        expect(select).not.toHaveBeenCalled();
        expect(unrelated).not.toHaveBeenCalled();
        expect(document.getElementById('conversation-sidebar')).not.toBeNull();
    });

    it('reads the current model from the trigger despite another selected model in the sidebar', async () => {
        expect(await cdp.getCurrentModel()).toBe('Gemini 4 Argon Medium');
        expect(document.getElementById('models')).toBeNull();
    });

    it('selects the exact effort in its owning submenu and verifies the trigger', async () => {
        expect(await cdp.setUiModel('Claude Opus 5.5 High')).toMatchObject({ ok: true, model: 'Claude Opus 5.5 High', verified: true });
        expect(select).toHaveBeenCalledWith('Claude Opus 5.5 High');
        expect(groupClick).not.toHaveBeenCalled();
        expect(unrelated).not.toHaveBeenCalled();
    });

    it('supports a direct model with a Notice badge using its model label attribute', async () => {
        expect(await cdp.setUiModel('GPT-OSS 120B (Medium)')).toMatchObject({ ok: true, model: 'GPT-OSS 120B (Medium)', verified: true });
        expect(select).toHaveBeenCalledWith('GPT-OSS 120B (Medium)');
    });

    it('does not click or open the picker when the exact model is already selected', async () => {
        expect(await cdp.setUiModel('Gemini 4 Argon Medium')).toMatchObject({ ok: true, alreadySelected: true, verified: true });
        expect(select).not.toHaveBeenCalled();
        expect(document.getElementById('models')).toBeNull();
    });

    it('rejects old merged labels and preserves the relevant error instead of scanning other contexts', async () => {
        const result = await cdp.setUiModel('Gemini 4 ArgonMedium');
        expect(result.ok).toBe(false);
        expect(result.error).toContain('Run /model again');
        expect(cdp.call).toHaveBeenCalledTimes(1);
        expect(select).not.toHaveBeenCalled();
    });

    it('requires a changed trigger even when the submenu marks an effort as checked', async () => {
        confirmSelection = false;
        const result = await cdp.setUiModel('Claude Opus 5.5 Medium');
        expect(result.ok).toBe(false);
        expect(result.error).toContain('did not confirm');
        expect(await cdp.getCurrentModel()).toBe('Gemini 4 Argon Medium');
    });

    it('preserves a picker that was already open', async () => {
        trigger.click();
        await cdp.getUiModels();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(select).not.toHaveBeenCalled();
    });

    it('serializes simultaneous model actions', async () => {
        let active = 0;
        let maximumActive = 0;
        (cdp.call as jest.Mock).mockImplementation(async (_method, params) => {
            active++;
            maximumActive = Math.max(maximumActive, active);
            const value = await window.eval(params.expression);
            active--;
            return { result: { value } };
        });
        const [models, result] = await Promise.all([cdp.getUiModels(), cdp.setUiModel('Claude Opus 5.5 High')]);
        expect(models).toHaveLength(7);
        expect(result.ok).toBe(true);
        expect(maximumActive).toBe(1);
    });
});
