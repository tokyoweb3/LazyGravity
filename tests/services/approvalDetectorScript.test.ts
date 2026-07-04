/**
 * @jest-environment jsdom
 */
import { DETECT_APPROVAL_SCRIPT } from '../../src/services/approvalDetector';

describe('ApprovalDetector DOM Script', () => {
    
    beforeEach(() => {
        document.body.innerHTML = '';
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
            get() { return document.body; },
            configurable: true
        });
    });

    const runScript = () => {
        // Evaluate the script in the current JSDOM context
        return eval(DETECT_APPROVAL_SCRIPT);
    };

    it('should ignore approvals if isGenerating is true (Stop Generating button exists)', () => {
        document.body.innerHTML = `
            <div>
                <button>Accept all</button>
                <button>Reject all</button>
                <button data-tooltip-id="input-send-button-cancel-tooltip">Stop</button>
            </div>
        `;
        
        const result = runScript();
        expect(result).toBeNull();
    });

    it('should fall back to safe description if text is too long or contains weird IDE menus', () => {
        document.body.innerHTML = `
            <div role="dialog">
                <button>Accept all</button>
                <button>Reject all</button>
                <div>
                    F ile
                    E dit
                    S election
                    Some other weird stuff
                </div>
            </div>
        `;
        
        const result = runScript();
        expect(result).not.toBeNull();
        expect(result.description).toBe('Code changes require your approval.');
    });

    it('should extract normal description successfully, ignoring sidebars and menus', () => {
        document.body.innerHTML = `
            <div role="dialog">
                <nav role="menubar">File Edit View</nav>
                <div class="sidebar">Explorer</div>
                <div style="display: block;">
                    Real description text here!
                </div>
                <button>Accept all</button>
                <button>Reject all</button>
            </div>
        `;
        
        const result = runScript();
        expect(result).not.toBeNull();
        expect(result.description).toBe('Real description text here!');
    });

    it('should prioritize global bottom-bar buttons over inline code lens buttons due to reverse DOM order', () => {
        document.body.innerHTML = `
            <div class="editor-container">
                <!-- Inline code lens buttons (appear earlier in DOM) -->
                <button><span class="label">Accept</span><span class="shortcut">Alt+Enter</span></button>
                <button><span class="label">Reject</span><span class="shortcut">Shift+Alt+Backspace</span></button>
            </div>
            
            <div class="bottom-bar">
                <!-- Global buttons (appear later in DOM) -->
                <button>Accept all</button>
                <button>Reject all</button>
            </div>
        `;
        
        const result = runScript();
        expect(result).not.toBeNull();
        // It should match the bottom-bar buttons because the script searches in reverse
        expect(result.approveText).toBe('Accept all');
        expect(result.denyText).toBe('Reject all');
    });

    it('should use innerText to avoid hidden screen reader spans in button text', () => {
        document.body.innerHTML = `
            <div class="bottom-bar">
                <!-- Jest JSDOM doesn't perfectly mock innerText vs textContent rendering, 
                     but we can simulate the DOM structure -->
                <button id="accept-btn">
                    <span>Accept all</span>
                    <span style="display: none;" class="shortcut">Alt+Enter</span>
                </button>
                <button id="reject-btn">Reject all</button>
            </div>
        `;
        
        // JSDOM does not implement innerText, so we mock it for the test
        const btn = document.getElementById('accept-btn') as HTMLElement;
        Object.defineProperty(btn, 'innerText', { value: 'Accept all' });
        
        const result = runScript();
        expect(result).not.toBeNull();
        expect(result.approveText).toBe('Accept all');
    });
});
