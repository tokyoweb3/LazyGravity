/** @jest-environment jsdom */
import { CdpService } from '../../src/services/cdpService';

describe('modern agent input focus', () => {
    afterEach(() => { jest.restoreAllMocks(); document.body.innerHTML = ''; });

    it('evaluates the real focus selector and injects into the visible primary-frame editor', async () => {
        document.body.innerHTML = `
            <div role="textbox" contenteditable="true" tabindex="0" class="xterm-helper-textarea"></div>
            <div id="agent-editor" role="combobox" contenteditable="true" tabindex="0" aria-label="Message input"></div>
            <div role="combobox" contenteditable="true" tabindex="0" aria-label="Message input" hidden></div>`;
        jest.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
            return this.hidden ? null : document.body;
        });
        const cdp = new CdpService();
        (cdp as any).isConnectedFlag = true;
        (cdp as any).ws = {};
        (cdp as any).contexts = [
            { id: 1, name: '', url: 'vscode-file://workbench.html' },
            { id: -3, name: '', url: 'http://127.0.0.1:5000/?extensionView=true' },
        ];
        const editor = document.getElementById('agent-editor')!;
        const call = jest.spyOn(cdp, 'call').mockImplementation(async (method, params) => {
            if (method === 'Runtime.evaluate') {
                expect(params.contextId).toBe(-3);
                return { result: { value: window.eval(params.expression) } };
            }
            if (method === 'Input.insertText') {
                expect(document.activeElement).toBe(editor);
                document.activeElement!.textContent = params.text;
            }
            return {};
        });
        jest.spyOn(cdp as any, 'clearInputField').mockResolvedValue(undefined);
        const send = jest.spyOn(cdp as any, 'pressEnterToSend').mockImplementation(async () => {
            expect(document.activeElement).toBe(editor);
            expect(editor.textContent).toBe('test prompt');
        });
        expect(await cdp.injectMessage('test prompt')).toEqual({ ok: true, method: 'enter', contextId: -3 });
        expect(document.activeElement).toBe(editor);
        expect(call).toHaveBeenCalledWith('Input.insertText', { text: 'test prompt' });
        expect(send).toHaveBeenCalledTimes(1);
    });
});
