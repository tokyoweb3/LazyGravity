import {
    buildSessionPickerUI,
    isSessionSelectId,
    SESSION_SELECT_ID,
} from '../../src/ui/sessionPickerUi';
import { SessionListItem } from '../../src/services/chatSessionService';

describe('sessionPickerUi', () => {
    describe('isSessionSelectId', () => {
        it('matches session_select custom ID', () => {
            expect(isSessionSelectId(SESSION_SELECT_ID)).toBe(true);
        });

        it('does not match unrelated custom IDs', () => {
            expect(isSessionSelectId('project_select')).toBe(false);
            expect(isSessionSelectId('mode_select')).toBe(false);
            expect(isSessionSelectId('')).toBe(false);
        });
    });

    describe('buildSessionPickerUI', () => {
        it('returns embed and select menu for multiple sessions', () => {
            const sessions: SessionListItem[] = [
                { title: 'Fix login bug', isActive: true },
                { title: 'Refactor auth', isActive: false },
                { title: 'Add tests', isActive: false },
            ];

            const { embeds, components } = buildSessionPickerUI(sessions);

            expect(embeds).toHaveLength(1);
            expect(components).toHaveLength(1);
            // Verify embed contains session count
            const embedData = embeds[0].toJSON();
            expect(embedData.description).toContain('3');
        });

        it('returns empty components for zero sessions', () => {
            const { embeds, components } = buildSessionPickerUI([]);

            expect(embeds).toHaveLength(1);
            expect(components).toHaveLength(0);
            const embedData = embeds[0].toJSON();
            expect(embedData.description).toContain('No sessions');
        });

        it('marks active session in the select menu options', () => {
            const sessions: SessionListItem[] = [
                { title: 'Active Session', isActive: true },
                { title: 'Other Session', isActive: false },
            ];

            const { components } = buildSessionPickerUI(sessions);

            expect(components).toHaveLength(1);
            const selectData = components[0].toJSON();
            const options = selectData.components[0].options;
            expect(options[0].label).toContain('Active Session');
            expect(options[0].description).toContain('Current');
        });

        it('truncates sessions to Discord 25-item limit', () => {
            const sessions: SessionListItem[] = Array.from({ length: 30 }, (_, i) => ({
                title: `Session ${i + 1}`,
                isActive: i === 0,
            }));

            const { components } = buildSessionPickerUI(sessions);

            expect(components).toHaveLength(1);
            const selectData = components[0].toJSON();
            expect(selectData.components[0].options).toHaveLength(25);
        });
    });
});
