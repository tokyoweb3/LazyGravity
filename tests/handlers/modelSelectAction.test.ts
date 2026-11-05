import { createModelSelectAction } from '../../src/handlers/modelSelectAction';
import { MODEL_SELECT_ID, MODEL_ACTIONS_SELECT_ID } from '../../src/ui/modelsUi';
import { wrapDiscordSelect } from '../../src/platform/discord/wrappers';

describe('model select menus', () => {
    const selectedModel = 'Gemini 3.8 Flash Low';
    function setup(customId: string) {
        const cdp = {
            setUiModel: jest.fn().mockResolvedValue({ ok: true, model: selectedModel, verified: true }),
            getUiModels: jest.fn().mockResolvedValue(['Gemini 4 Argon Medium', selectedModel]),
            getCurrentModel: jest.fn().mockResolvedValue(selectedModel),
        };
        const interaction = { customId, channel: { id: 'channel' }, user: { id: 'user' },
            deferUpdate: jest.fn().mockResolvedValue(undefined), update: jest.fn().mockResolvedValue(undefined),
            editReply: jest.fn().mockResolvedValue(undefined),
            followUp: jest.fn().mockResolvedValue(undefined),
        } as any;
        const deps = { bridge: {}, fetchQuota: async () => [], resolveCdp: jest.fn().mockResolvedValue(cdp),
            modelService: { getDefaultModel: () => null, setDefaultModel: jest.fn() },
            userPrefRepo: { setDefaultModel: jest.fn() },
        } as any;
        return { cdp, interaction, deps, action: createModelSelectAction(deps) };
    }

    it('switches to the exact dropdown value using the channel connection and refreshes both menus', async () => {
        const { action, cdp, deps, interaction } = setup(MODEL_SELECT_ID);
        await action.execute(interaction, [selectedModel]);
        expect(deps.resolveCdp).toHaveBeenCalledWith('channel', 'user');
        expect(cdp.setUiModel).toHaveBeenCalledWith(selectedModel);
        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.components.flatMap((row: any) => row.components).every((component: any) => component.type === 'selectMenu')).toBe(true);
        expect(interaction.followUp).toHaveBeenCalledWith({ text: `Model changed to ${selectedModel}.` });
    });

    it('routes refresh and default model actions without changing the active model', async () => {
        const { action, cdp, deps, interaction } = setup(MODEL_ACTIONS_SELECT_ID);
        await action.execute(interaction, ['refresh']);
        expect(cdp.setUiModel).not.toHaveBeenCalled();
        await action.execute(interaction, ['set_default']);
        expect(deps.modelService.setDefaultModel).toHaveBeenCalledWith(selectedModel);
        expect(deps.userPrefRepo.setDefaultModel).toHaveBeenCalledWith('user', selectedModel);
        await action.execute(interaction, ['clear_default']);
        expect(deps.modelService.setDefaultModel).toHaveBeenLastCalledWith(null);
        expect(await action.execute(interaction, ['unknown'])).toBe(false);
    });

    it.each([[MODEL_SELECT_ID, selectedModel], [MODEL_ACTIONS_SELECT_ID, 'refresh']])(
        'edits the original Discord menu after deferring %s', async (customId, value) => {
            const { action } = setup(customId);
            let acknowledged = false;
            const native = { customId, channelId: 'channel', user: { id: 'user' },
                message: { id: 'models' }, values: [value],
                deferUpdate: jest.fn(async () => {
                    if (acknowledged) throw new Error('InteractionAlreadyReplied');
                    acknowledged = true;
                }),
                update: jest.fn(async () => {
                    if (acknowledged) throw new Error('InteractionAlreadyReplied');
                    acknowledged = true;
                }),
                editReply: jest.fn(async () => {
                    if (!acknowledged) throw new Error('InteractionNotReplied');
                }),
                followUp: jest.fn().mockResolvedValue({ id: 'confirmation', channelId: 'channel' }),
            } as any;
            await action.execute(wrapDiscordSelect(native), [value]);
            expect(native.deferUpdate).toHaveBeenCalledTimes(1);
            expect(native.update).not.toHaveBeenCalled();
            expect(native.editReply).toHaveBeenCalledTimes(1);
            const payload = native.editReply.mock.calls[0][0];
            expect(payload.components).toHaveLength(2);
            expect(payload.components[0].toJSON().components[0].type).toBe(3);
        },
    );
});
