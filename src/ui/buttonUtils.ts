import { ActionRowBuilder, ButtonBuilder } from 'discord.js';

/**
 * Disable all buttons in the given message component rows.
 * Returns new ActionRows with every button set to disabled.
 */
export function disableAllButtons(
    components: readonly any[],
): ActionRowBuilder<ButtonBuilder>[] {
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
                .filter((btn: ButtonBuilder | null): btn is ButtonBuilder => btn !== null);
            if (disabledButtons.length === 0) return null;
            nextRow.addComponents(...disabledButtons);
            return nextRow;
        })
        .filter((row): row is ActionRowBuilder<ButtonBuilder> => row !== null);
}
