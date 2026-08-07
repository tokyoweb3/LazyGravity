import type { MessagePayload, ButtonDef, ComponentRow } from '../../src/platform/types';
import {
    buildApprovalNotification,
    buildAutoApprovedNotification,
    buildPlanningNotification,
    buildErrorPopupNotification,
    buildResolvedOverlay,
    buildStatusNotification,
    buildProgressNotification,
} from '../../src/services/notificationSender';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all buttons from every component row in a payload. */
function extractButtons(payload: MessagePayload): readonly ButtonDef[] {
    if (!payload.components) return [];
    return payload.components.flatMap((row) =>
        row.components.filter((c): c is ButtonDef => c.type === 'button'),
    );
}

/** Extract all customIds from a payload's buttons. */
function extractCustomIds(payload: MessagePayload): readonly string[] {
    return extractButtons(payload).map((b) => b.customId);
}

// ---------------------------------------------------------------------------
// buildApprovalNotification
// ---------------------------------------------------------------------------

describe('buildApprovalNotification', () => {
    const baseOpts = {
        title: 'Approval Needed',
        description: 'Tool execution requires approval',
        projectName: 'my-project',
        channelId: 'ch-123',
        toolNames: ['Bash', 'Write'],
        hasAlwaysAllow: true,
    } as const;

    it('returns a MessagePayload with richContent', () => {
        const payload = buildApprovalNotification(baseOpts);
        expect(payload.richContent).toBeDefined();
        expect(payload.richContent!.title).toBe('Approval Needed');
        expect(payload.richContent!.description).toBe('Tool execution requires approval');
    });

    it('uses warning-orange colour (0xFFA500)', () => {
        const payload = buildApprovalNotification(baseOpts);
        expect(payload.richContent!.color).toBe(0xFFA500);
    });

    it('includes Project field', () => {
        const payload = buildApprovalNotification(baseOpts);
        const projectField = payload.richContent!.fields!.find((f) => f.name === 'Project');
        expect(projectField).toBeDefined();
        expect(projectField!.value).toBe('my-project');
    });

    it('includes Tools field when toolNames provided', () => {
        const payload = buildApprovalNotification(baseOpts);
        const toolsField = payload.richContent!.fields!.find((f) => f.name === 'Tools');
        expect(toolsField).toBeDefined();
        expect(toolsField!.value).toBe('Bash, Write');
    });

    it('omits Tools field when toolNames is empty', () => {
        const payload = buildApprovalNotification({ ...baseOpts, toolNames: [] });
        const toolsField = payload.richContent!.fields?.find((f) => f.name === 'Tools');
        expect(toolsField).toBeUndefined();
    });

    it('omits Tools field when toolNames is undefined', () => {
        const { toolNames: _, ...rest } = baseOpts;
        const payload = buildApprovalNotification(rest);
        const toolsField = payload.richContent!.fields?.find((f) => f.name === 'Tools');
        expect(toolsField).toBeUndefined();
    });

    it('has footer "Approval required"', () => {
        const payload = buildApprovalNotification(baseOpts);
        expect(payload.richContent!.footer).toBe('Approval required');
    });

    it('includes a timestamp', () => {
        const payload = buildApprovalNotification(baseOpts);
        expect(payload.richContent!.timestamp).toBeInstanceOf(Date);
    });

    it('contains exactly 3 buttons in one row', () => {
        const payload = buildApprovalNotification(baseOpts);
        expect(payload.components).toHaveLength(1);
        const buttons = extractButtons(payload);
        expect(buttons).toHaveLength(3);
    });

    it('has Allow, Allow Chat, and Deny buttons with correct styles', () => {
        const payload = buildApprovalNotification(baseOpts);
        const buttons = extractButtons(payload);
        expect(buttons[0]).toMatchObject({ label: 'Allow', style: 'success' });
        expect(buttons[1]).toMatchObject({ label: 'Allow Chat', style: 'primary' });
        expect(buttons[2]).toMatchObject({ label: 'Deny', style: 'danger' });
    });

    it('builds customIds with projectName and channelId', () => {
        const payload = buildApprovalNotification(baseOpts);
        const ids = extractCustomIds(payload);
        expect(ids[0]).toBe('approve_action:my-project:ch-123');
        expect(ids[1]).toBe('always_allow_action:my-project:ch-123');
        expect(ids[2]).toBe('deny_action:my-project:ch-123');
    });

    it('builds customIds without channelId when null', () => {
        const payload = buildApprovalNotification({ ...baseOpts, channelId: null });
        const ids = extractCustomIds(payload);
        expect(ids[0]).toBe('approve_action:my-project');
        expect(ids[1]).toBe('always_allow_action:my-project');
        expect(ids[2]).toBe('deny_action:my-project');
    });

    it('adds walkthrough and task review buttons in a second row when custom IDs are provided', () => {
        const payload = buildApprovalNotification({
            ...baseOpts,
            walkthroughCustomId: 'file_open:art:123:walkthrough.md',
            taskCustomId: 'file_open:art:123:task.md',
        });
        expect(payload.components).toHaveLength(2);
        
        // Check second row buttons
        const secondRow = (payload.components as any)[1];
        expect(secondRow.components).toHaveLength(2);
        expect(secondRow.components[0]).toMatchObject({ label: 'Review walkthrough.md', style: 'success', customId: 'file_open:art:123:walkthrough.md' });
        expect(secondRow.components[1]).toMatchObject({ label: 'Review task.md', style: 'primary', customId: 'file_open:art:123:task.md' });
    });
});

// ---------------------------------------------------------------------------
// buildPlanningNotification
// ---------------------------------------------------------------------------

describe('buildPlanningNotification', () => {
    const baseOpts = {
        title: 'Planning Mode',
        description: 'Agent is in planning mode',
        projectName: 'ws-a',
        channelId: 'ch-456',
    } as const;

    it('returns a MessagePayload with richContent', () => {
        const payload = buildPlanningNotification(baseOpts);
        expect(payload.richContent).toBeDefined();
        expect(payload.richContent!.title).toBe('Planning Mode');
        expect(payload.richContent!.description).toBe('Agent is in planning mode');
    });

    it('uses blue colour (0x3498DB)', () => {
        const payload = buildPlanningNotification(baseOpts);
        expect(payload.richContent!.color).toBe(0x3498DB);
    });

    it('has footer "Planning mode detected"', () => {
        const payload = buildPlanningNotification(baseOpts);
        expect(payload.richContent!.footer).toBe('Planning mode detected');
    });

    it('includes a timestamp', () => {
        const payload = buildPlanningNotification(baseOpts);
        expect(payload.richContent!.timestamp).toBeInstanceOf(Date);
    });

    it('contains exactly 2 buttons in one row by default', () => {
        const payload = buildPlanningNotification(baseOpts);
        expect(payload.components).toHaveLength(1);
        const buttons = extractButtons(payload);
        expect(buttons).toHaveLength(2);
    });

    it('contains exactly 1 button when hasOpenButton is false', () => {
        const payload = buildPlanningNotification({ ...baseOpts, hasOpenButton: false });
        expect(payload.components).toHaveLength(1);
        const buttons = extractButtons(payload);
        expect(buttons).toHaveLength(1);
        expect(buttons[0].label).toBe('Proceed');
    });

    it('has Open Plan and Proceed buttons with correct styles', () => {
        const payload = buildPlanningNotification(baseOpts);
        const buttons = extractButtons(payload);
        expect(buttons[0]).toMatchObject({ label: 'Open Plan', style: 'primary' });
        expect(buttons[1]).toMatchObject({ label: 'Proceed', style: 'success' });
    });

    it('builds customIds with projectName and channelId', () => {
        const payload = buildPlanningNotification(baseOpts);
        const ids = extractCustomIds(payload);
        expect(ids[0]).toBe('planning_open_action:ws-a:ch-456');
        expect(ids[1]).toBe('planning_proceed_action:ws-a:ch-456');
    });

    it('builds customIds without channelId when null', () => {
        const payload = buildPlanningNotification({ ...baseOpts, channelId: null });
        const ids = extractCustomIds(payload);
        expect(ids[0]).toBe('planning_open_action:ws-a');
        expect(ids[1]).toBe('planning_proceed_action:ws-a');
    });
});

// ---------------------------------------------------------------------------
// buildErrorPopupNotification
// ---------------------------------------------------------------------------

describe('buildErrorPopupNotification', () => {
    const baseOpts = {
        title: 'Agent Error',
        errorMessage: 'Something went wrong',
        projectName: 'err-proj',
        channelId: 'ch-err',
    } as const;

    it('returns a MessagePayload with richContent', () => {
        const payload = buildErrorPopupNotification(baseOpts);
        expect(payload.richContent).toBeDefined();
        expect(payload.richContent!.title).toBe('Agent Error');
        expect(payload.richContent!.description).toBe('Something went wrong');
    });

    it('uses red colour (0xE74C3C)', () => {
        const payload = buildErrorPopupNotification(baseOpts);
        expect(payload.richContent!.color).toBe(0xE74C3C);
    });

    it('has footer "Agent error detected"', () => {
        const payload = buildErrorPopupNotification(baseOpts);
        expect(payload.richContent!.footer).toBe('Agent error detected');
    });

    it('includes a timestamp', () => {
        const payload = buildErrorPopupNotification(baseOpts);
        expect(payload.richContent!.timestamp).toBeInstanceOf(Date);
    });

    it('contains exactly 3 buttons in one row', () => {
        const payload = buildErrorPopupNotification(baseOpts);
        expect(payload.components).toHaveLength(1);
        const buttons = extractButtons(payload);
        expect(buttons).toHaveLength(3);
    });

    it('has Dismiss, Copy Debug, and Retry buttons with correct styles', () => {
        const payload = buildErrorPopupNotification(baseOpts);
        const buttons = extractButtons(payload);
        expect(buttons[0]).toMatchObject({ label: 'Dismiss', style: 'secondary' });
        expect(buttons[1]).toMatchObject({ label: 'Copy Debug', style: 'primary' });
        expect(buttons[2]).toMatchObject({ label: 'Retry', style: 'success' });
    });

    it('builds customIds with projectName and channelId', () => {
        const payload = buildErrorPopupNotification(baseOpts);
        const ids = extractCustomIds(payload);
        expect(ids[0]).toBe('error_popup_dismiss_action:err-proj:ch-err');
        expect(ids[1]).toBe('error_popup_copy_debug_action:err-proj:ch-err');
        expect(ids[2]).toBe('error_popup_retry_action:err-proj:ch-err');
    });

    it('builds customIds without channelId when null', () => {
        const payload = buildErrorPopupNotification({ ...baseOpts, channelId: null });
        const ids = extractCustomIds(payload);
        expect(ids[0]).toBe('error_popup_dismiss_action:err-proj');
        expect(ids[1]).toBe('error_popup_copy_debug_action:err-proj');
        expect(ids[2]).toBe('error_popup_retry_action:err-proj');
    });
});

// ---------------------------------------------------------------------------
// buildStatusNotification
// ---------------------------------------------------------------------------

describe('buildStatusNotification', () => {
    it('returns a MessagePayload with title and description', () => {
        const payload = buildStatusNotification({
            title: 'Bot Status',
            description: 'Running smoothly',
        });
        expect(payload.richContent).toBeDefined();
        expect(payload.richContent!.title).toBe('Bot Status');
        expect(payload.richContent!.description).toBe('Running smoothly');
    });

    it('uses provided colour', () => {
        const payload = buildStatusNotification({
            title: 'T',
            description: 'D',
            color: 0x123456,
        });
        expect(payload.richContent!.color).toBe(0x123456);
    });

    it('defaults to neutral grey when colour is omitted', () => {
        const payload = buildStatusNotification({ title: 'T', description: 'D' });
        expect(payload.richContent!.color).toBe(0x95A5A6);
    });

    it('includes fields when provided', () => {
        const payload = buildStatusNotification({
            title: 'T',
            description: 'D',
            fields: [
                { name: 'Uptime', value: '3h', inline: true },
                { name: 'Version', value: '1.0.0' },
            ],
        });
        expect(payload.richContent!.fields).toHaveLength(2);
        expect(payload.richContent!.fields![0]).toMatchObject({
            name: 'Uptime',
            value: '3h',
            inline: true,
        });
        expect(payload.richContent!.fields![1]).toMatchObject({
            name: 'Version',
            value: '1.0.0',
        });
    });

    it('has no fields when omitted', () => {
        const payload = buildStatusNotification({ title: 'T', description: 'D' });
        expect(payload.richContent!.fields).toBeUndefined();
    });

    it('has no components', () => {
        const payload = buildStatusNotification({ title: 'T', description: 'D' });
        expect(payload.components).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// buildProgressNotification
// ---------------------------------------------------------------------------

describe('buildProgressNotification', () => {
    it('uses the phase as the title', () => {
        const payload = buildProgressNotification({ phase: 'Thinking' });
        expect(payload.richContent!.title).toBe('Thinking');
    });

    it('includes detail as description when provided', () => {
        const payload = buildProgressNotification({
            phase: 'Generating',
            detail: 'Processing tokens...',
        });
        expect(payload.richContent!.description).toBe('Processing tokens...');
    });

    it('omits description when detail is not provided', () => {
        const payload = buildProgressNotification({ phase: 'Thinking' });
        expect(payload.richContent!.description).toBeUndefined();
    });

    it('includes Project field when projectName is provided', () => {
        const payload = buildProgressNotification({
            phase: 'Thinking',
            projectName: 'my-proj',
        });
        const projectField = payload.richContent!.fields!.find((f) => f.name === 'Project');
        expect(projectField).toBeDefined();
        expect(projectField!.value).toBe('my-proj');
    });

    it('omits fields when projectName is not provided', () => {
        const payload = buildProgressNotification({ phase: 'Thinking' });
        expect(payload.richContent!.fields).toBeUndefined();
    });

    it('maps "thinking" phase to blue colour', () => {
        const payload = buildProgressNotification({ phase: 'thinking' });
        expect(payload.richContent!.color).toBe(0x3498DB);
    });

    it('maps "generating" phase to green colour', () => {
        const payload = buildProgressNotification({ phase: 'generating' });
        expect(payload.richContent!.color).toBe(0x2ECC71);
    });

    it('maps "error" phase to red colour', () => {
        const payload = buildProgressNotification({ phase: 'error' });
        expect(payload.richContent!.color).toBe(0xE74C3C);
    });

    it('maps "waiting" phase to neutral grey', () => {
        const payload = buildProgressNotification({ phase: 'waiting' });
        expect(payload.richContent!.color).toBe(0x95A5A6);
    });

    it('maps "complete" phase to green colour', () => {
        const payload = buildProgressNotification({ phase: 'complete' });
        expect(payload.richContent!.color).toBe(0x2ECC71);
    });

    it('falls back to neutral grey for unknown phases', () => {
        const payload = buildProgressNotification({ phase: 'unknown-phase' });
        expect(payload.richContent!.color).toBe(0x95A5A6);
    });

    it('is case-insensitive for phase colour lookup', () => {
        const payload = buildProgressNotification({ phase: 'THINKING' });
        expect(payload.richContent!.color).toBe(0x3498DB);
    });

    it('has no components', () => {
        const payload = buildProgressNotification({ phase: 'Thinking' });
        expect(payload.components).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('immutability', () => {
    it('calling buildApprovalNotification twice returns different objects', () => {
        const opts = {
            title: 'T',
            description: 'D',
            projectName: 'p',
            channelId: 'c',
        } as const;
        const a = buildApprovalNotification(opts);
        const b = buildApprovalNotification(opts);
        expect(a).not.toBe(b);
        expect(a.richContent).not.toBe(b.richContent);
        expect(a.components).not.toBe(b.components);
    });

    it('calling buildPlanningNotification twice returns different objects', () => {
        const opts = {
            title: 'T',
            description: 'D',
            projectName: 'p',
            channelId: 'c',
        } as const;
        const a = buildPlanningNotification(opts);
        const b = buildPlanningNotification(opts);
        expect(a).not.toBe(b);
        expect(a.richContent).not.toBe(b.richContent);
    });

    it('calling buildErrorPopupNotification twice returns different objects', () => {
        const opts = {
            title: 'T',
            errorMessage: 'E',
            projectName: 'p',
            channelId: 'c',
        } as const;
        const a = buildErrorPopupNotification(opts);
        const b = buildErrorPopupNotification(opts);
        expect(a).not.toBe(b);
        expect(a.richContent).not.toBe(b.richContent);
    });

    it('calling buildStatusNotification twice returns different objects', () => {
        const opts = { title: 'T', description: 'D' } as const;
        const a = buildStatusNotification(opts);
        const b = buildStatusNotification(opts);
        expect(a).not.toBe(b);
        expect(a.richContent).not.toBe(b.richContent);
    });

    it('calling buildProgressNotification twice returns different objects', () => {
        const opts = { phase: 'Thinking' } as const;
        const a = buildProgressNotification(opts);
        const b = buildProgressNotification(opts);
        expect(a).not.toBe(b);
        expect(a.richContent).not.toBe(b.richContent);
    });
});

// ---------------------------------------------------------------------------
// CustomId format consistency
// ---------------------------------------------------------------------------

describe('customId format', () => {
    it('approval customIds include projectName and channelId separated by colons', () => {
        const payload = buildApprovalNotification({
            title: 'T',
            description: 'D',
            projectName: 'proj-x',
            channelId: 'ch-y',
        });
        const ids = extractCustomIds(payload);
        for (const id of ids) {
            expect(id).toContain(':proj-x:ch-y');
        }
    });

    it('planning customIds include projectName and channelId separated by colons', () => {
        const payload = buildPlanningNotification({
            title: 'T',
            description: 'D',
            projectName: 'proj-x',
            channelId: 'ch-y',
        });
        const ids = extractCustomIds(payload);
        for (const id of ids) {
            expect(id).toContain(':proj-x:ch-y');
        }
    });

    it('error customIds include projectName and channelId separated by colons', () => {
        const payload = buildErrorPopupNotification({
            title: 'T',
            errorMessage: 'E',
            projectName: 'proj-x',
            channelId: 'ch-y',
        });
        const ids = extractCustomIds(payload);
        for (const id of ids) {
            expect(id).toContain(':proj-x:ch-y');
        }
    });

    it('handles empty-string channelId same as null', () => {
        const payload = buildApprovalNotification({
            title: 'T',
            description: 'D',
            projectName: 'proj',
            channelId: '   ',
        });
        const ids = extractCustomIds(payload);
        // Should NOT contain trailing colon or whitespace segment
        for (const id of ids) {
            expect(id).not.toContain(':   ');
            expect(id.endsWith(':proj')).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// buildAutoApprovedNotification
// ---------------------------------------------------------------------------

describe('buildAutoApprovedNotification', () => {
    it('returns "Auto-approved" title when accepted is true', () => {
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'proj-auto',
        });
        expect(payload.richContent!.title).toBe('Auto-approved');
    });

    it('returns "Auto-approve failed" title when accepted is false', () => {
        const payload = buildAutoApprovedNotification({
            accepted: false,
            projectName: 'proj-auto',
        });
        expect(payload.richContent!.title).toBe('Auto-approve failed');
    });

    it('uses green colour (0x2ECC71) when accepted is true', () => {
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'proj-auto',
        });
        expect(payload.richContent!.color).toBe(0x2ECC71);
    });

    it('uses amber colour (0xF39C12) when accepted is false', () => {
        const payload = buildAutoApprovedNotification({
            accepted: false,
            projectName: 'proj-auto',
        });
        expect(payload.richContent!.color).toBe(0xF39C12);
    });

    it('sets description for accepted=true', () => {
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'proj',
        });
        expect(payload.richContent!.description).toBe(
            'An action was automatically approved.',
        );
    });

    it('sets description for accepted=false', () => {
        const payload = buildAutoApprovedNotification({
            accepted: false,
            projectName: 'proj',
        });
        expect(payload.richContent!.description).toBe(
            'Auto-approve attempted but failed. Manual approval required.',
        );
    });

    it('includes Auto-approve mode, Workspace, and Result fields', () => {
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'ws-x',
        });
        const fields = payload.richContent!.fields!;
        const modeField = fields.find((f) => f.name === 'Auto-approve mode');
        const wsField = fields.find((f) => f.name === 'Workspace');
        const resultField = fields.find((f) => f.name === 'Result');

        expect(modeField).toBeDefined();
        expect(modeField!.value).toBe('ON');
        expect(wsField!.value).toBe('ws-x');
        expect(resultField!.value).toBe('Executed Always Allow/Allow');
    });

    it('shows "Manual approval required" in Result when accepted is false', () => {
        const payload = buildAutoApprovedNotification({
            accepted: false,
            projectName: 'ws-x',
        });
        const resultField = payload.richContent!.fields!.find((f) => f.name === 'Result');
        expect(resultField!.value).toBe('Manual approval required');
    });

    it('includes Action Detail field when description is provided', () => {
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'ws-x',
            description: 'Ran bash command',
        });
        const detailField = payload.richContent!.fields!.find(
            (f) => f.name === 'Action Detail',
        );
        expect(detailField).toBeDefined();
        expect(detailField!.value).toBe('Ran bash command');
    });

    it('omits Action Detail field when description is not provided', () => {
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'ws-x',
        });
        const detailField = payload.richContent!.fields?.find(
            (f) => f.name === 'Action Detail',
        );
        expect(detailField).toBeUndefined();
    });

    it('truncates description to 1024 characters', () => {
        const longDesc = 'X'.repeat(2000);
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'ws-x',
            description: longDesc,
        });
        const detailField = payload.richContent!.fields!.find(
            (f) => f.name === 'Action Detail',
        );
        expect(detailField!.value).toHaveLength(1024);
    });

    it('includes "Approved via" field when approveText is provided', () => {
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'ws-x',
            approveText: 'Always Allow',
        });
        const approvedField = payload.richContent!.fields!.find(
            (f) => f.name === 'Approved via',
        );
        expect(approvedField).toBeDefined();
        expect(approvedField!.value).toBe('Always Allow');
    });

    it('omits "Approved via" field when approveText is not provided', () => {
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'ws-x',
        });
        const approvedField = payload.richContent!.fields?.find(
            (f) => f.name === 'Approved via',
        );
        expect(approvedField).toBeUndefined();
    });

    it('has a timestamp', () => {
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'ws-x',
        });
        expect(payload.richContent!.timestamp).toBeInstanceOf(Date);
    });

    it('has no components (no buttons)', () => {
        const payload = buildAutoApprovedNotification({
            accepted: true,
            projectName: 'ws-x',
        });
        expect(payload.components).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// buildResolvedOverlay
// ---------------------------------------------------------------------------

describe('buildResolvedOverlay', () => {
    function createApprovalPayload() {
        return buildApprovalNotification({
            title: 'Approval Needed',
            description: 'Tool execution requires approval',
            projectName: 'my-project',
            channelId: 'ch-123',
            hasAlwaysAllow: true,
        });
    }

    it('changes colour to neutral grey (0x95A5A6)', () => {
        const original = createApprovalPayload();
        const resolved = buildResolvedOverlay(original, 'Approved by user');
        expect(resolved.richContent!.color).toBe(0x95A5A6);
    });

    it('adds a Status field with the provided status text', () => {
        const original = createApprovalPayload();
        const resolved = buildResolvedOverlay(original, 'Denied by admin');
        const statusField = resolved.richContent!.fields!.find(
            (f) => f.name === 'Status',
        );
        expect(statusField).toBeDefined();
        expect(statusField!.value).toBe('Denied by admin');
        expect(statusField!.inline).toBeFalsy();
    });

    it('preserves the original title and description', () => {
        const original = createApprovalPayload();
        const resolved = buildResolvedOverlay(original, 'Approved');
        expect(resolved.richContent!.title).toBe('Approval Needed');
        expect(resolved.richContent!.description).toBe('Tool execution requires approval');
    });

    it('disables all buttons', () => {
        const original = createApprovalPayload();
        const resolved = buildResolvedOverlay(original, 'Approved');
        const buttons = extractButtons(resolved);
        expect(buttons.length).toBeGreaterThan(0);
        for (const btn of buttons) {
            expect(btn.disabled).toBe(true);
        }
    });

    it('preserves button labels and styles after disabling', () => {
        const original = createApprovalPayload();
        const resolved = buildResolvedOverlay(original, 'Approved');
        const buttons = extractButtons(resolved);
        expect(buttons[0]).toMatchObject({ label: 'Allow', style: 'success', disabled: true });
        expect(buttons[1]).toMatchObject({ label: 'Allow Chat', style: 'primary', disabled: true });
        expect(buttons[2]).toMatchObject({ label: 'Deny', style: 'danger', disabled: true });
    });

    it('returns undefined components when original has no components', () => {
        const original = buildStatusNotification({
            title: 'Status',
            description: 'No buttons',
        });
        const resolved = buildResolvedOverlay(original, 'Done');
        expect(resolved.components).toBeUndefined();
    });

    it('does not mutate the original payload', () => {
        const original = createApprovalPayload();
        const originalColor = original.richContent!.color;
        const originalFieldCount = original.richContent!.fields?.length ?? 0;

        buildResolvedOverlay(original, 'Approved');

        expect(original.richContent!.color).toBe(originalColor);
        expect(original.richContent!.fields?.length ?? 0).toBe(originalFieldCount);
    });

    it('works with planning notification as input', () => {
        const original = buildPlanningNotification({
            title: 'Planning',
            description: 'Plan ready',
            projectName: 'p',
            channelId: 'c',
        });
        const resolved = buildResolvedOverlay(original, 'Plan accepted');
        expect(resolved.richContent!.color).toBe(0x95A5A6);
        const statusField = resolved.richContent!.fields!.find(
            (f) => f.name === 'Status',
        );
        expect(statusField!.value).toBe('Plan accepted');
        const buttons = extractButtons(resolved);
        for (const btn of buttons) {
            expect(btn.disabled).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// extraFields parameter
// ---------------------------------------------------------------------------

describe('extraFields parameter', () => {
    describe('buildApprovalNotification with extraFields', () => {
        it('appends extra fields after default fields', () => {
            const payload = buildApprovalNotification({
                title: 'Approval',
                description: 'Desc',
                projectName: 'proj',
                channelId: 'ch',
                extraFields: [
                    { name: 'Session', value: 'session-1', inline: true },
                    { name: 'Context', value: 'some context' },
                ],
            });
            const fields = payload.richContent!.fields!;
            // Default fields: Project (and possibly Tools)
            const sessionField = fields.find((f) => f.name === 'Session');
            const contextField = fields.find((f) => f.name === 'Context');
            expect(sessionField).toBeDefined();
            expect(sessionField!.value).toBe('session-1');
            expect(sessionField!.inline).toBe(true);
            expect(contextField).toBeDefined();
            expect(contextField!.value).toBe('some context');
        });

        it('places extra fields before footer', () => {
            const payload = buildApprovalNotification({
                title: 'Approval',
                description: 'Desc',
                projectName: 'proj',
                channelId: 'ch',
                extraFields: [{ name: 'Extra', value: 'val' }],
            });
            // Footer should still be present
            expect(payload.richContent!.footer).toBe('Approval required');
            // Extra field should exist in the fields array
            const extraField = payload.richContent!.fields!.find(
                (f) => f.name === 'Extra',
            );
            expect(extraField).toBeDefined();
        });

        it('works without extraFields (no crash)', () => {
            const payload = buildApprovalNotification({
                title: 'Approval',
                description: 'Desc',
                projectName: 'proj',
                channelId: 'ch',
            });
            // Only the Project field should be present
            expect(payload.richContent!.fields!.length).toBe(1);
            expect(payload.richContent!.fields![0].name).toBe('Project');
        });
    });

    describe('buildPlanningNotification with extraFields', () => {
        it('appends extra fields', () => {
            const payload = buildPlanningNotification({
                title: 'Planning',
                description: 'Desc',
                projectName: 'proj',
                channelId: 'ch',
                extraFields: [
                    { name: 'Duration', value: '5m', inline: true },
                ],
            });
            const durationField = payload.richContent!.fields!.find(
                (f) => f.name === 'Duration',
            );
            expect(durationField).toBeDefined();
            expect(durationField!.value).toBe('5m');
            expect(durationField!.inline).toBe(true);
        });

        it('has no extra fields when extraFields is omitted', () => {
            const payload = buildPlanningNotification({
                title: 'Planning',
                description: 'Desc',
                projectName: 'proj',
                channelId: 'ch',
            });
            // Planning notification has no default fields
            expect(payload.richContent!.fields).toBeUndefined();
        });
    });

    describe('buildErrorPopupNotification with extraFields', () => {
        it('appends extra fields', () => {
            const payload = buildErrorPopupNotification({
                title: 'Error',
                errorMessage: 'Something broke',
                projectName: 'proj',
                channelId: 'ch',
                extraFields: [
                    { name: 'Stack', value: 'line 42', inline: false },
                    { name: 'Code', value: 'ERR_001' },
                ],
            });
            const stackField = payload.richContent!.fields!.find(
                (f) => f.name === 'Stack',
            );
            const codeField = payload.richContent!.fields!.find(
                (f) => f.name === 'Code',
            );
            expect(stackField).toBeDefined();
            expect(stackField!.value).toBe('line 42');
            expect(codeField).toBeDefined();
            expect(codeField!.value).toBe('ERR_001');
        });

        it('has no extra fields when extraFields is omitted', () => {
            const payload = buildErrorPopupNotification({
                title: 'Error',
                errorMessage: 'Something broke',
                projectName: 'proj',
                channelId: 'ch',
            });
            expect(payload.richContent!.fields).toBeUndefined();
        });
    });
});
