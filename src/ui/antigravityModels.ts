/** Operate only the Antigravity 2.6 model picker, including its effort submenus. */
export function modernModelsScript(action: 'list' | 'current' | 'select', modelName = ''): string {
    return `(async () => {
        const action = ${JSON.stringify(action)};
        const target = ${JSON.stringify(modelName)};
        ${MODERN_MODEL_HELPERS_SCRIPT}
        const trigger = document.querySelector('[data-testid="model-selector-trigger"]');
        if (!trigger) return null;
        const currentModel = () => {
            const label = trigger.getAttribute('aria-label') || '';
            const match = label.match(/^Select model,\\s*current:\\s*(.+)$/i);
            return normalize(match ? match[1] : trigger.textContent);
        };
        if (action === 'current') return { modern: true, model: currentModel() || null };
        if (action === 'select' && same(currentModel(), target)) {
            return { modern: true, ok: true, model: currentModel(), verified: true, alreadySelected: true };
        }
        const originalFocus = document.activeElement;
        let menu = ownedMenu(trigger);
        const openedHere = !menu;
        try {
            if (!menu) {
                trigger.click();
                menu = await waitFor(() => ownedMenu(trigger));
            }
            const panel = menu?.querySelector('[data-testid="model-selector-panel"]');
            if (!panel) return { modern: true, ok: false, models: [], error: 'The model picker did not open. Try /model again.' };
            const direct = Array.from(panel.querySelectorAll('[data-testid="model-selector-item"][data-model-label]'))
                .filter(enabled).map(el => ({ el, label: normalize(el.getAttribute('data-model-label')) }));
            const groups = Array.from(panel.querySelectorAll('[data-testid="model-selector-effort-group"][data-model-base]'))
                .map(el => ({ base: normalize(el.getAttribute('data-model-base')), item: el.closest('[role="menuitem"]') }))
                .filter(group => group.base && enabled(group.item));
            if (action === 'list') {
                const models = [];
                for (const group of groups) {
                    const submenu = await openEfforts(group.item);
                    if (!submenu) continue;
                    for (const option of effortOptions(submenu)) models.push(group.base + ' ' + normalize(option.textContent));
                    await closeEfforts(submenu);
                }
                models.push(...direct.map(entry => entry.label));
                return { modern: true, models: Array.from(new Set(models)) };
            }
            let choice = direct.find(entry => same(entry.label, target));
            if (!choice) {
                const group = groups.find(entry => normalize(target).toLowerCase().startsWith(entry.base.toLowerCase() + ' '));
                if (group) {
                    const submenu = await openEfforts(group.item);
                    const option = submenu && effortOptions(submenu).find(el => same(group.base + ' ' + normalize(el.textContent), target));
                    if (option) choice = { el: option.closest('[role="menuitemradio"], [role="menuitem"]') || option,
                        label: group.base + ' ' + normalize(option.textContent) };
                    else if (submenu) await closeEfforts(submenu);
                }
            }
            if (!choice) return { modern: true, ok: false, error: 'This model option is unavailable. Run /model again to refresh the buttons.' };
            choice.el.click();
            const verified = await waitFor(() => same(currentModel(), choice.label));
            return verified
                ? { modern: true, ok: true, model: currentModel(), verified: true }
                : { modern: true, ok: false, error: 'The IDE did not confirm the selected model. Run /model to check the current selection.' };
        } finally {
            // Escape is sent only to the picker opened by this operation.
            if (openedHere && menu?.isConnected && trigger.getAttribute('aria-expanded') === 'true') {
                menu.dispatchEvent(key('Escape'));
                await waitFor(() => trigger.getAttribute('aria-expanded') !== 'true');
            }
            if (originalFocus instanceof HTMLElement && originalFocus.isConnected && originalFocus !== document.body) {
                originalFocus.focus({ preventScroll: true });
            }
        }
    })()`;
}

const MODERN_MODEL_HELPERS_SCRIPT = String.raw`
    const normalize = text => (text || '').replace(/\s+/g, ' ').trim();
    const same = (a, b) => normalize(a).toLowerCase() === normalize(b).toLowerCase();
    const visible = el => {
        if (!(el instanceof HTMLElement) || el.closest('[hidden], [aria-hidden="true"]')) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    const enabled = el => visible(el) && !el.matches(':disabled, [aria-disabled="true"], [data-disabled]');
    const key = name => new KeyboardEvent('keydown', { key: name, code: name, bubbles: true, cancelable: true });
    const waitFor = async predicate => {
        for (let attempt = 0; attempt < 16; attempt++) {
            const result = predicate();
            if (result) return result;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return null;
    };
    const ownedMenu = owner => {
        const controlled = document.getElementById(owner.getAttribute('aria-controls') || '');
        if (visible(controlled) && controlled.getAttribute('role') === 'menu') return controlled;
        return Array.from(document.querySelectorAll('[role="menu"]')).find(el =>
            owner.id && el.getAttribute('aria-labelledby') === owner.id && visible(el)) || null;
    };
    const effortOptions = menu => Array.from(menu.querySelectorAll('[data-testid="model-selector-effort-option"][data-effort]'))
        .filter(el => enabled(el.closest('[role="menuitemradio"], [role="menuitem"]') || el));
    const openEfforts = async item => {
        let menu = ownedMenu(item);
        if (!menu) {
            // Clicking a group selects its remembered effort and closes the picker.
            item.focus({ preventScroll: true });
            item.dispatchEvent(key('ArrowRight'));
            menu = await waitFor(() => ownedMenu(item));
        }
        return menu;
    };
    const closeEfforts = async menu => {
        menu.dispatchEvent(key('ArrowLeft'));
        await waitFor(() => !visible(menu) || !menu.isConnected);
    };
`;
