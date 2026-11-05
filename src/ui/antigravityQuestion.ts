/** Locate the active prompt without measuring option coordinates on each poll. */
const MODERN_QUESTION_ROOT_HELPERS_SCRIPT = `
    const visible = el => {
        if (!(el instanceof HTMLElement) || el.closest('[hidden], [aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden'
            && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
    };
    const findModernQuestionRoot = () => {
        const headers = Array.from(document.querySelectorAll('[data-testid="ask-question-header-text"]')).reverse();
        for (const header of headers) {
            if (!visible(header)) continue;
            let root = header.parentElement;
            while (root && root !== document.body && root.getAttribute('data-testid') !== 'conversation-view') {
                const submit = root.querySelector('[data-testid="interaction-continue-button"]');
                const options = Array.from(root.querySelectorAll('[data-testid="ask-question-option"]')).filter(visible);
                if (submit && !submit.disabled && visible(submit) && options.length) {
                    return { root, header, submit, options };
                }
                root = root.parentElement;
            }
        }
        return null;
    };
`;

/** Cheap presence check for the response monitor; never reads unrelated history. */
export const MODERN_QUESTION_PENDING_SCRIPT = `(() => {
    ${MODERN_QUESTION_ROOT_HELPERS_SCRIPT}
    return findModernQuestionRoot() !== null;
})()`;

/** Find the active 2.6 question without confusing its write-in input with chat. */
export const MODERN_QUESTION_HELPERS_SCRIPT = `
    ${MODERN_QUESTION_ROOT_HELPERS_SCRIPT}
    const findModernQuestion = () => {
        const found = findModernQuestionRoot();
        if (!found) return null;
        const { root, header, submit, options } = found;
        const writeIn = root.querySelector('[data-testid="ask-question-writein"]');
        const writeInLabel = writeIn?.closest('label');
        const labelText = writeInLabel?.cloneNode(true);
        labelText?.querySelectorAll('textarea, input, [data-testid*="shortcut-badge"]').forEach(el => el.remove());
        const writeInText = (labelText?.textContent || '').trim();
        // Permission prompts provide a "No" choice with an optional explanation.
        if (writeInLabel && visible(writeInLabel) && /^no$/i.test(writeInText)) options.push(writeInLabel);
        let prompt = header;
        while (prompt.parentElement && prompt.parentElement !== root) prompt = prompt.parentElement;
        const title = (header.innerText || header.textContent || '').trim();
        const promptText = (prompt.innerText || prompt.textContent || '').trim();
        const description = promptText.startsWith(title) ? promptText.slice(title.length).trim() : promptText;
        const choices = options.map(option => {
            const label = option.querySelector('[data-testid="ask-question-option-text"]');
            const rect = option.getBoundingClientRect();
            return {
                text: label ? (label.innerText || label.textContent || '').trim() : writeInText,
                x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2),
            };
        });
        return { root, submit, options, title, description, choices,
            signature: JSON.stringify([title, description, choices.map(choice => choice.text)]) };
    };
`;

/** Read-only state; detecting a question never submits or approves anything. */
export const MODERN_QUESTION_SNAPSHOT_SCRIPT = `(() => {
    ${MODERN_QUESTION_HELPERS_SCRIPT}
    const question = findModernQuestion();
    if (!question) return null;
    return { detected: true, title: question.title, description: question.description,
        options: question.choices, signature: question.signature };
})()`;

/** Apply only the explicit choice from the matching Discord question. */
export function modernQuestionActionScript(action: 'select' | 'skip', index: number, signature: string | null): string {
    return `(async () => {
        ${MODERN_QUESTION_HELPERS_SCRIPT}
        const expected = ${JSON.stringify(signature)};
        const question = findModernQuestion();
        if (!question) return expected ? { found: false } : null;
        if (expected && expected !== question.signature) return { found: false };
        if (${JSON.stringify(action)} === 'skip') {
            const skip = question.root.querySelector('[data-testid="interaction-skip-button"]');
            if (!skip || skip.disabled) return { found: false };
            skip.click();
        } else {
            const option = question.options[${JSON.stringify(index)}];
            if (!option) return { found: false };
            option.click();
            await new Promise(resolve => setTimeout(resolve, 50));
            if (question.submit.disabled || !question.submit.isConnected) return { found: false };
            question.submit.click();
        }
        return { found: true };
    })()`;
}
