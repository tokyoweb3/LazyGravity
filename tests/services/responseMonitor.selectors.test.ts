/**
 * TDD RED phase: Lean RESPONSE_SELECTORS tests.
 *
 * These tests verify that the DOM selector scripts are lean and simplified.
 * They should FAIL against the current implementation because the current
 * selectors contain SVG analysis, getBoundingClientRect, getComputedStyle,
 * composer DOM traversal, and removed properties.
 *
 * The new lean selectors should:
 *   - Use tooltip-id selector only (no SVG, no rect, no computed style)
 *   - NOT have ACTIVITY_STATUS, RESPONSE_DIAGNOSTICS, RESPONSE_TEXT_FROM_START
 *   - Use a scored/priority-based selector approach for RESPONSE_TEXT
 */

import { RESPONSE_SELECTORS } from '../../src/services/responseMonitor';

describe('Lean RESPONSE_SELECTORS', () => {
    // ---------------------------------------------------------------
    // Test 1: STOP_BUTTON script contains tooltip-id selector
    // ---------------------------------------------------------------
    it('STOP_BUTTON script contains input-send-button-cancel-tooltip', () => {
        expect(RESPONSE_SELECTORS.STOP_BUTTON).toContain('input-send-button-cancel-tooltip');
    });

    // ---------------------------------------------------------------
    // Test 2: STOP_BUTTON script does NOT contain 'svg'
    // ---------------------------------------------------------------
    it('STOP_BUTTON script does NOT contain svg analysis', () => {
        expect(RESPONSE_SELECTORS.STOP_BUTTON.toLowerCase()).not.toContain('svg');
    });

    // ---------------------------------------------------------------
    // Test 3: STOP_BUTTON script does NOT contain 'getBoundingClientRect'
    // ---------------------------------------------------------------
    it('STOP_BUTTON script does NOT contain getBoundingClientRect', () => {
        expect(RESPONSE_SELECTORS.STOP_BUTTON).not.toContain('getBoundingClientRect');
    });

    // ---------------------------------------------------------------
    // Test 4: STOP_BUTTON script does NOT contain 'getComputedStyle'
    // ---------------------------------------------------------------
    it('STOP_BUTTON script does NOT contain getComputedStyle', () => {
        expect(RESPONSE_SELECTORS.STOP_BUTTON).not.toContain('getComputedStyle');
    });

    // ---------------------------------------------------------------
    // Test 5: STOP_BUTTON script does NOT contain 'composer'
    // ---------------------------------------------------------------
    it('STOP_BUTTON script does NOT contain composer DOM traversal', () => {
        expect(RESPONSE_SELECTORS.STOP_BUTTON.toLowerCase()).not.toContain('composer');
    });

    // ---------------------------------------------------------------
    // Test 6: CLICK_STOP_BUTTON script contains tooltip-id selector
    // ---------------------------------------------------------------
    it('CLICK_STOP_BUTTON script contains input-send-button-cancel-tooltip', () => {
        expect(RESPONSE_SELECTORS.CLICK_STOP_BUTTON).toContain('input-send-button-cancel-tooltip');
    });

    // ---------------------------------------------------------------
    // Test 7: CLICK_STOP_BUTTON script does NOT contain 'svg'
    // ---------------------------------------------------------------
    it('CLICK_STOP_BUTTON script does NOT contain svg analysis', () => {
        expect(RESPONSE_SELECTORS.CLICK_STOP_BUTTON.toLowerCase()).not.toContain('svg');
    });

    // ---------------------------------------------------------------
    // Test 8: CLICK_STOP_BUTTON script does NOT contain 'heuristic'
    // ---------------------------------------------------------------
    it('CLICK_STOP_BUTTON script does NOT contain heuristic fallback', () => {
        expect(RESPONSE_SELECTORS.CLICK_STOP_BUTTON.toLowerCase()).not.toContain('heuristic');
    });

    // ---------------------------------------------------------------
    // Test 8b: stop detection should avoid broad substring matching
    // ---------------------------------------------------------------
    it('STOP_BUTTON script does NOT use broad substring includes matching', () => {
        expect(RESPONSE_SELECTORS.STOP_BUTTON).not.toContain('blob.includes');
        expect(RESPONSE_SELECTORS.STOP_BUTTON).not.toContain('includes(w)');
    });

    // ---------------------------------------------------------------
    // Test 8c: stop detection supports Japanese fallback labels
    // ---------------------------------------------------------------
    it('STOP_BUTTON script includes Japanese stop labels', () => {
        expect(RESPONSE_SELECTORS.STOP_BUTTON).toContain('停止');
    });

    // ---------------------------------------------------------------
    // Test 9: RESPONSE_SELECTORS does NOT have ACTIVITY_STATUS property
    // ---------------------------------------------------------------
    it('does NOT have ACTIVITY_STATUS property', () => {
        expect((RESPONSE_SELECTORS as any).ACTIVITY_STATUS).toBeUndefined();
    });

    // ---------------------------------------------------------------
    // Test 10: RESPONSE_SELECTORS does NOT have RESPONSE_DIAGNOSTICS property
    // ---------------------------------------------------------------
    it('does NOT have RESPONSE_DIAGNOSTICS property', () => {
        expect((RESPONSE_SELECTORS as any).RESPONSE_DIAGNOSTICS).toBeUndefined();
    });

    // ---------------------------------------------------------------
    // Test 11: RESPONSE_SELECTORS does NOT have RESPONSE_TEXT_FROM_START property
    // ---------------------------------------------------------------
    it('does NOT have RESPONSE_TEXT_FROM_START property', () => {
        expect((RESPONSE_SELECTORS as any).RESPONSE_TEXT_FROM_START).toBeUndefined();
    });

    // ---------------------------------------------------------------
    // Test 12: RESPONSE_TEXT script contains scored selector approach
    // ---------------------------------------------------------------
    it('RESPONSE_TEXT script contains scored/priority-based selector approach', () => {
        const script = RESPONSE_SELECTORS.RESPONSE_TEXT.toLowerCase();
        // The new lean extractor should use a scoring or priority mechanism
        const hasScoring = script.includes('score') || script.includes('priority') || script.includes('weight');
        expect(hasScoring).toBe(true);
    });

    // ---------------------------------------------------------------
    // Test 13: RESPONSE_TEXT excludes nodes inside <details> elements
    // ---------------------------------------------------------------
    it('RESPONSE_TEXT script contains details exclusion via .closest', () => {
        const script = RESPONSE_SELECTORS.RESPONSE_TEXT;
        expect(script).toContain("closest('details')");
    });

    // ---------------------------------------------------------------
    // Test 14: RESPONSE_TEXT excludes nodes inside feedback/footer
    // ---------------------------------------------------------------
    it('RESPONSE_TEXT script contains feedback/footer exclusion', () => {
        const script = RESPONSE_SELECTORS.RESPONSE_TEXT.toLowerCase();
        expect(script).toContain('feedback');
        expect(script).toContain('footer');
    });

    // ---------------------------------------------------------------
    // Test 15: RESPONSE_TEXT filters MCP tool output patterns
    // ---------------------------------------------------------------
    it('RESPONSE_TEXT script contains MCP tool output pattern filter', () => {
        const script = RESPONSE_SELECTORS.RESPONSE_TEXT.toLowerCase();
        // Should check for MCP server/tool format lines
        expect(script).toContain('looksliketooloutput');
    });
});
