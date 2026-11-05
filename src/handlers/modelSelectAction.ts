import type { SelectAction } from './selectHandler';
import { createModelButtonAction, ModelButtonActionDeps } from './modelButtonAction';
import { MODEL_SELECT_ID, MODEL_ACTIONS_SELECT_ID } from '../ui/modelsUi';

/** Model choices and management actions use select menus while sharing existing validation. */
export function createModelSelectAction(deps: ModelButtonActionDeps): SelectAction {
    const action = createModelButtonAction(deps);
    return {
        match: customId => customId === MODEL_SELECT_ID || customId === MODEL_ACTIONS_SELECT_ID,
        /** Map dropdown values to the shared model executor, rejecting unknown management actions. */
        async execute(interaction, values) {
            const value = values[0];
            if (!value) return false;
            const params: Record<string, string> | null = interaction.customId === MODEL_SELECT_ID
                ? { action: 'select', modelName: value }
                : ['refresh', 'set_default', 'clear_default'].includes(value) ? { action: value } : null;
            if (!params) return false;
            return action.execute(interaction, params);
        },
    };
}
