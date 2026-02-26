import { disableAllButtons } from '../../src/utils/discordButtonUtils';

describe('disableAllButtons', () => {
    it('returns empty array for empty components', () => {
        expect(disableAllButtons([])).toEqual([]);
    });

    it('disables all button components in rows', () => {
        const mockComponents = [
            {
                components: [
                    {
                        type: 2, // Button type
                        toJSON: () => ({
                            type: 2,
                            custom_id: 'btn_1',
                            label: 'Click me',
                            style: 1,
                            disabled: false,
                        }),
                    },
                    {
                        type: 2,
                        toJSON: () => ({
                            type: 2,
                            custom_id: 'btn_2',
                            label: 'Another',
                            style: 2,
                            disabled: false,
                        }),
                    },
                ],
            },
        ];

        const result = disableAllButtons(mockComponents);
        expect(result).toHaveLength(1);
        const buttons = result[0].components;
        expect(buttons).toHaveLength(2);
        // Verify buttons are disabled via toJSON
        for (const btn of buttons) {
            const json = (btn as any).toJSON();
            expect(json.disabled).toBe(true);
        }
    });

    it('skips non-button components (type !== 2)', () => {
        const mockComponents = [
            {
                components: [
                    { type: 3, data: { type: 3 } }, // Select menu
                ],
            },
        ];

        const result = disableAllButtons(mockComponents);
        expect(result).toEqual([]);
    });

    it('skips rows without components array', () => {
        const mockComponents = [{ noComponents: true }];
        const result = disableAllButtons(mockComponents);
        expect(result).toEqual([]);
    });

    it('handles data.type fallback for component type detection', () => {
        const mockComponents = [
            {
                components: [
                    {
                        data: { type: 2 },
                        toJSON: () => ({
                            type: 2,
                            custom_id: 'btn_data',
                            label: 'Data fallback',
                            style: 1,
                            disabled: false,
                        }),
                    },
                ],
            },
        ];

        const result = disableAllButtons(mockComponents);
        expect(result).toHaveLength(1);
        expect(result[0].components).toHaveLength(1);
    });
});
