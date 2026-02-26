import { ActionRowBuilder, ButtonBuilder } from 'discord.js';

/**
 * Disable all buttons in message component rows.
 * Shared utility used by interaction handlers and detector callbacks.
 */
export function disableAllButtons(components: readonly any[]): ActionRowBuilder<ButtonBuilder>[] {
    return components
        .map((row) => {
            const rowAny = row as any;
            if (!Array.isArray(rowAny.components)) return null;

            const nextRow = new ActionRowBuilder<ButtonBuilder>();
            const disabledButtons = rowAny.components
                .map((component: any) => {
                    const componentType = component?.type ?? component?.data?.type;
                    if (componentType !== 2) return null;
                    const payload = typeof component?.toJSON === 'function'
                        ? component.toJSON()
                        : component;
                    return ButtonBuilder.from(payload).setDisabled(true);
                })
                .filter((button: ButtonBuilder | null): button is ButtonBuilder => button !== null);
            if (disabledButtons.length === 0) return null;
            nextRow.addComponents(...disabledButtons);
            return nextRow;
        })
        .filter((row): row is ActionRowBuilder<ButtonBuilder> => row !== null);
}
