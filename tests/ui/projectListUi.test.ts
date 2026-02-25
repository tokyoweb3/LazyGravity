import {
    buildProjectListUI,
    isProjectSelectId,
    parseProjectPageId,
    PROJECT_PAGE_PREFIX,
    PROJECT_SELECT_ID,
    WORKSPACE_SELECT_ID,
    ITEMS_PER_PAGE,
} from '../../src/ui/projectListUi';

describe('projectListUi', () => {
    describe('parseProjectPageId', () => {
        it('parses a valid page button customId', () => {
            expect(parseProjectPageId('project_page:0')).toBe(0);
            expect(parseProjectPageId('project_page:3')).toBe(3);
            expect(parseProjectPageId('project_page:99')).toBe(99);
        });

        it('returns NaN for non-matching customId', () => {
            expect(parseProjectPageId('other_id')).toBeNaN();
            expect(parseProjectPageId('project_page')).toBeNaN();
            expect(parseProjectPageId('')).toBeNaN();
        });

        it('returns NaN for malformed page number', () => {
            expect(parseProjectPageId('project_page:abc')).toBeNaN();
        });
    });

    describe('isProjectSelectId', () => {
        it('matches legacy project_select', () => {
            expect(isProjectSelectId(PROJECT_SELECT_ID)).toBe(true);
        });

        it('matches legacy workspace_select', () => {
            expect(isProjectSelectId(WORKSPACE_SELECT_ID)).toBe(true);
        });

        it('matches paginated project_select:<page>', () => {
            expect(isProjectSelectId('project_select:0')).toBe(true);
            expect(isProjectSelectId('project_select:5')).toBe(true);
        });

        it('does not match unrelated customIds', () => {
            expect(isProjectSelectId('mode_select')).toBe(false);
            expect(isProjectSelectId('project_page:0')).toBe(false);
            expect(isProjectSelectId('')).toBe(false);
        });
    });

    describe('buildProjectListUI', () => {
        const makeWorkspaces = (count: number): string[] =>
            Array.from({ length: count }, (_, i) => `project-${String(i + 1).padStart(3, '0')}`);

        it('returns empty components for zero workspaces', () => {
            const { embeds, components } = buildProjectListUI([], 0);

            expect(embeds).toHaveLength(1);
            expect(components).toHaveLength(0);
        });

        it('shows a single select menu for <=25 workspaces (no pagination buttons)', () => {
            const workspaces = makeWorkspaces(10);
            const { embeds, components } = buildProjectListUI(workspaces, 0);

            expect(embeds).toHaveLength(1);
            // 1 row: select menu only (no Prev/Next buttons)
            expect(components).toHaveLength(1);

            const selectRow = components[0].toJSON();
            expect(selectRow.components).toHaveLength(1);
            expect(selectRow.components[0].type).toBe(3); // StringSelect
            expect(selectRow.components[0].options).toHaveLength(10);
        });

        it('does not add a footer for single-page results', () => {
            const workspaces = makeWorkspaces(5);
            const { embeds } = buildProjectListUI(workspaces, 0);

            const embedJson = embeds[0].toJSON();
            expect(embedJson.footer).toBeUndefined();
        });

        it('shows select menu + Prev/Next buttons for >25 workspaces', () => {
            const workspaces = makeWorkspaces(30);
            const { embeds, components } = buildProjectListUI(workspaces, 0);

            // 2 rows: select menu + button row
            expect(components).toHaveLength(2);

            // First row is select menu with 25 items
            const selectRow = components[0].toJSON();
            expect(selectRow.components[0].options).toHaveLength(25);

            // Second row has 2 buttons (Prev, Next)
            const buttonRow = components[1].toJSON();
            expect(buttonRow.components).toHaveLength(2);
            expect(buttonRow.components[0].label).toContain('Prev');
            expect(buttonRow.components[1].label).toContain('Next');

            // On page 0, Prev is disabled and Next is enabled
            expect(buttonRow.components[0].disabled).toBe(true);
            expect(buttonRow.components[1].disabled).toBe(false);

            // Footer shows page info
            const embedJson = embeds[0].toJSON();
            expect(embedJson.footer?.text).toContain('Page 1 / 2');
            expect(embedJson.footer?.text).toContain('30 projects total');
        });

        it('page 1 shows remaining items and enables Prev', () => {
            const workspaces = makeWorkspaces(30);
            const { components } = buildProjectListUI(workspaces, 1);

            // Select menu has 5 remaining items
            const selectRow = components[0].toJSON();
            expect(selectRow.components[0].options).toHaveLength(5);

            // Prev enabled, Next disabled (last page)
            const buttonRow = components[1].toJSON();
            expect(buttonRow.components[0].disabled).toBe(false);
            expect(buttonRow.components[1].disabled).toBe(true);
        });

        it('clamps out-of-range page to the last valid page', () => {
            const workspaces = makeWorkspaces(30);
            const { embeds, components } = buildProjectListUI(workspaces, 100);

            const embedJson = embeds[0].toJSON();
            expect(embedJson.footer?.text).toContain('Page 2 / 2');

            const selectRow = components[0].toJSON();
            expect(selectRow.components[0].options).toHaveLength(5);
        });

        it('clamps negative page to 0', () => {
            const workspaces = makeWorkspaces(30);
            const { embeds } = buildProjectListUI(workspaces, -5);

            const embedJson = embeds[0].toJSON();
            expect(embedJson.footer?.text).toContain('Page 1 / 2');
        });

        it('select menu customId includes page number', () => {
            const workspaces = makeWorkspaces(60);
            const { components } = buildProjectListUI(workspaces, 1);

            const selectRow = components[0].toJSON();
            expect(selectRow.components[0].custom_id).toBe('project_select:1');
        });

        it('button customIds encode correct page numbers', () => {
            const workspaces = makeWorkspaces(80); // 4 pages
            const { components } = buildProjectListUI(workspaces, 2);

            const buttonRow = components[1].toJSON();
            // Prev button should navigate to page 1
            expect(buttonRow.components[0].custom_id).toBe(`${PROJECT_PAGE_PREFIX}:1`);
            // Next button should navigate to page 3
            expect(buttonRow.components[1].custom_id).toBe(`${PROJECT_PAGE_PREFIX}:3`);
        });

        it('handles exactly 25 workspaces (single page, no buttons)', () => {
            const workspaces = makeWorkspaces(25);
            const { components } = buildProjectListUI(workspaces, 0);

            expect(components).toHaveLength(1);
            const selectRow = components[0].toJSON();
            expect(selectRow.components[0].options).toHaveLength(25);
        });

        it('handles exactly 50 workspaces (2 full pages)', () => {
            const workspaces = makeWorkspaces(50);

            const page0 = buildProjectListUI(workspaces, 0);
            expect(page0.components[0].toJSON().components[0].options).toHaveLength(25);

            const page1 = buildProjectListUI(workspaces, 1);
            expect(page1.components[0].toJSON().components[0].options).toHaveLength(25);

            // Verify page 1 Next is disabled (last page)
            const buttonRow = page1.components[1].toJSON();
            expect(buttonRow.components[1].disabled).toBe(true);
        });
    });
});
