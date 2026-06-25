import fs from 'fs';
import path from 'path';

describe('CdpService injection recovery', () => {
    it('supports the current Antigravity message input combobox', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '../../src/services/cdpService.ts'),
            'utf8',
        );

        expect(source).toContain(
            'div[role="combobox"][contenteditable="true"][aria-label="Message input"]',
        );
    });

    it('opens the chat panel before retrying a transient injection failure', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '../../src/services/cdpService.ts'),
            'utf8',
        );
        const retryStart = source.indexOf('private async retryInjectOnce');
        const retryEnd = source.indexOf('private async clearInputField', retryStart);
        const retrySource = source.slice(retryStart, retryEnd);

        expect(retrySource).toContain('this.isTransientInjectError(firstError)');
        expect(retrySource).toContain('await this.findWorkbenchTarget()');
        expect(retrySource).toContain('await this.openChatPanelViaKeyboard(target.webSocketDebuggerUrl)');
    });
});
