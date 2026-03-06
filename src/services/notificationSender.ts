/**
 * Platform-agnostic notification builders.
 *
 * Every exported function is **pure** — no side effects, no I/O.
 * They return a `MessagePayload` that any platform adapter can render.
 */

import type {
    MessagePayload,
    ButtonDef,
    ButtonStyle,
    ComponentRow,
    RichContentField,
    RichContent,
} from '../platform/types';
import {
    createRichContent,
    withTitle,
    withDescription,
    withColor,
    addField,
    withFooter,
    withTimestamp,
    pipe,
} from '../platform/richContentBuilder';

// ---------------------------------------------------------------------------
// Custom-ID prefix constants (must stay in sync with cdpBridgeManager)
// ---------------------------------------------------------------------------

const APPROVE_ACTION_PREFIX = 'approve_action';
const ALWAYS_ALLOW_ACTION_PREFIX = 'always_allow_action';
const DENY_ACTION_PREFIX = 'deny_action';
const PLANNING_OPEN_ACTION_PREFIX = 'planning_open_action';
const PLANNING_PROCEED_ACTION_PREFIX = 'planning_proceed_action';
const ERROR_POPUP_DISMISS_ACTION_PREFIX = 'error_popup_dismiss_action';
const ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX = 'error_popup_copy_debug_action';
const ERROR_POPUP_RETRY_ACTION_PREFIX = 'error_popup_retry_action';
const RUN_COMMAND_RUN_ACTION_PREFIX = 'run_command_run_action';
const RUN_COMMAND_REJECT_ACTION_PREFIX = 'run_command_reject_action';

// ---------------------------------------------------------------------------
// Notification colours
// ---------------------------------------------------------------------------

/** Warning orange — used for approval requests. */
const COLOR_APPROVAL = 0xFFA500;
/** Blue — used for planning / informational notifications. */
const COLOR_PLANNING = 0x3498DB;
/** Red — used for error notifications. */
const COLOR_ERROR = 0xE74C3C;
/** Green — used for success / progress notifications. */
const COLOR_SUCCESS = 0x2ECC71;
/** Grey — used for neutral status notifications. */
const COLOR_NEUTRAL = 0x95A5A6;

// ---------------------------------------------------------------------------
// Phase → colour mapping for progress notifications
// ---------------------------------------------------------------------------

const PHASE_COLOURS: Readonly<Record<string, number>> = {
    thinking: COLOR_PLANNING,
    generating: COLOR_SUCCESS,
    error: COLOR_ERROR,
    waiting: COLOR_NEUTRAL,
    complete: COLOR_SUCCESS,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Create a single button definition. */
function button(customId: string, label: string, style: ButtonStyle): ButtonDef {
    return { type: 'button', customId, label, style };
}

/** Wrap one or more buttons into a component row. */
function buttonRow(...buttons: readonly ButtonDef[]): ComponentRow {
    return { components: buttons };
}

/**
 * Build a colon-separated customId following the project convention:
 *   `<prefix>:<projectName>` or `<prefix>:<projectName>:<channelId>`
 */
function customId(prefix: string, projectName: string, channelId: string | null): string {
    if (channelId !== null && channelId.trim().length > 0) {
        return `${prefix}:${projectName}:${channelId}`;
    }
    return `${prefix}:${projectName}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build the approval notification message. */
export function buildApprovalNotification(opts: {
    readonly title: string;
    readonly description: string;
    readonly projectName: string;
    readonly channelId: string | null;
    /** List of tool names requesting approval. */
    readonly toolNames?: readonly string[];
    /** Additional fields appended after default ones. */
    readonly extraFields?: readonly { readonly name: string; readonly value: string; readonly inline?: boolean }[];
}): MessagePayload {
    const { title, description, projectName, channelId, toolNames, extraFields } = opts;

    const richContent = pipe(
        createRichContent(),
        (rc) => withTitle(rc, title),
        (rc) => withDescription(rc, description),
        (rc) => withColor(rc, COLOR_APPROVAL),
        (rc) => addField(rc, 'Project', projectName, true),
        (rc) =>
            toolNames && toolNames.length > 0
                ? addField(rc, 'Tools', toolNames.join(', '), true)
                : rc,
        (rc) =>
            extraFields
                ? extraFields.reduce<typeof rc>((acc, f) => addField(acc, f.name, f.value, f.inline), rc)
                : rc,
        (rc) => withFooter(rc, 'Approval required'),
        (rc) => withTimestamp(rc),
    );

    const components: readonly ComponentRow[] = [
        buttonRow(
            button(customId(APPROVE_ACTION_PREFIX, projectName, channelId), 'Allow', 'success'),
            button(customId(ALWAYS_ALLOW_ACTION_PREFIX, projectName, channelId), 'Allow Chat', 'primary'),
            button(customId(DENY_ACTION_PREFIX, projectName, channelId), 'Deny', 'danger'),
        ),
    ];

    return { richContent, components };
}

/** Build the planning mode notification message. */
export function buildPlanningNotification(opts: {
    readonly title: string;
    readonly description: string;
    readonly projectName: string;
    readonly channelId: string | null;
    /** Additional fields appended before footer. */
    readonly extraFields?: readonly { readonly name: string; readonly value: string; readonly inline?: boolean }[];
}): MessagePayload {
    const { title, description, projectName, channelId, extraFields } = opts;

    const richContent = pipe(
        createRichContent(),
        (rc) => withTitle(rc, title),
        (rc) => withDescription(rc, description),
        (rc) => withColor(rc, COLOR_PLANNING),
        (rc) =>
            extraFields
                ? extraFields.reduce<typeof rc>((acc, f) => addField(acc, f.name, f.value, f.inline), rc)
                : rc,
        (rc) => withFooter(rc, 'Planning mode detected'),
        (rc) => withTimestamp(rc),
    );

    const components: readonly ComponentRow[] = [
        buttonRow(
            button(customId(PLANNING_OPEN_ACTION_PREFIX, projectName, channelId), 'Open', 'primary'),
            button(customId(PLANNING_PROCEED_ACTION_PREFIX, projectName, channelId), 'Proceed', 'success'),
        ),
    ];

    return { richContent, components };
}

/** Build the error popup notification message. */
export function buildErrorPopupNotification(opts: {
    readonly title: string;
    readonly errorMessage: string;
    readonly projectName: string;
    readonly channelId: string | null;
    /** Additional fields appended before footer. */
    readonly extraFields?: readonly { readonly name: string; readonly value: string; readonly inline?: boolean }[];
}): MessagePayload {
    const { title, errorMessage, projectName, channelId, extraFields } = opts;

    const richContent = pipe(
        createRichContent(),
        (rc) => withTitle(rc, title),
        (rc) => withDescription(rc, errorMessage),
        (rc) => withColor(rc, COLOR_ERROR),
        (rc) =>
            extraFields
                ? extraFields.reduce<typeof rc>((acc, f) => addField(acc, f.name, f.value, f.inline), rc)
                : rc,
        (rc) => withFooter(rc, 'Agent error detected'),
        (rc) => withTimestamp(rc),
    );

    const components: readonly ComponentRow[] = [
        buttonRow(
            button(customId(ERROR_POPUP_DISMISS_ACTION_PREFIX, projectName, channelId), 'Dismiss', 'secondary'),
            button(customId(ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX, projectName, channelId), 'Copy Debug', 'primary'),
            button(customId(ERROR_POPUP_RETRY_ACTION_PREFIX, projectName, channelId), 'Retry', 'success'),
        ),
    ];

    return { richContent, components };
}

/** Build the run command notification message. */
export function buildRunCommandNotification(opts: {
    readonly title: string;
    readonly commandText: string;
    readonly workingDirectory: string;
    readonly projectName: string;
    readonly channelId: string | null;
    /** Additional fields appended before footer. */
    readonly extraFields?: readonly { readonly name: string; readonly value: string; readonly inline?: boolean }[];
}): MessagePayload {
    const { title, commandText, workingDirectory, projectName, channelId, extraFields } = opts;

    const richContent = pipe(
        createRichContent(),
        (rc) => withTitle(rc, title),
        (rc) => withDescription(rc, `\`\`\`\n${commandText}\n\`\`\``),
        (rc) => withColor(rc, COLOR_APPROVAL),
        (rc) => addField(rc, 'Directory', workingDirectory || '(unknown)', true),
        (rc) => addField(rc, 'Project', projectName, true),
        (rc) =>
            extraFields
                ? extraFields.reduce<typeof rc>((acc, f) => addField(acc, f.name, f.value, f.inline), rc)
                : rc,
        (rc) => withFooter(rc, 'Run command approval required'),
        (rc) => withTimestamp(rc),
    );

    const components: readonly ComponentRow[] = [
        buttonRow(
            button(customId(RUN_COMMAND_RUN_ACTION_PREFIX, projectName, channelId), 'Run', 'success'),
            button(customId(RUN_COMMAND_REJECT_ACTION_PREFIX, projectName, channelId), 'Reject', 'danger'),
        ),
    ];

    return { richContent, components };
}

/** Build an auto-approved notification (shown when auto-accept fires). */
export function buildAutoApprovedNotification(opts: {
    readonly accepted: boolean;
    readonly projectName: string;
    readonly description?: string;
    readonly approveText?: string;
}): MessagePayload {
    const { accepted, projectName, description, approveText } = opts;

    const richContent = pipe(
        createRichContent(),
        (rc) => withTitle(rc, accepted ? 'Auto-approved' : 'Auto-approve failed'),
        (rc) => withDescription(
            rc,
            accepted
                ? 'An action was automatically approved.'
                : 'Auto-approve attempted but failed. Manual approval required.',
        ),
        (rc) => withColor(rc, accepted ? COLOR_SUCCESS : 0xF39C12),
        (rc) => addField(rc, 'Auto-approve mode', 'ON', true),
        (rc) => addField(rc, 'Workspace', projectName, true),
        (rc) => addField(
            rc,
            'Result',
            accepted ? 'Executed Always Allow/Allow' : 'Manual approval required',
            true,
        ),
        (rc) => description ? addField(rc, 'Action Detail', description.substring(0, 1024), false) : rc,
        (rc) => approveText ? addField(rc, 'Approved via', approveText, true) : rc,
        (rc) => withTimestamp(rc),
    );

    return { richContent };
}

/**
 * Build a "resolved" overlay from an existing notification payload.
 * Changes colour to grey, adds a Status field, and disables all buttons.
 */
export function buildResolvedOverlay(
    original: MessagePayload,
    statusText: string,
): MessagePayload {
    const rc = pipe(
        original.richContent ?? createRichContent(),
        (r) => withColor(r, COLOR_NEUTRAL),
        (r) => addField(r, 'Status', statusText, false),
    );

    const disabledComponents: ComponentRow[] | undefined = original.components
        ? original.components.map((row) => ({
              components: row.components.map((comp) =>
                  comp.type === 'button' ? { ...comp, disabled: true as const } : comp,
              ),
          }))
        : undefined;

    return {
        ...original,
        richContent: rc,
        components: disabledComponents,
    };
}

/** Build a simple status embed. */
export function buildStatusNotification(opts: {
    readonly title: string;
    readonly description: string;
    readonly color?: number;
    readonly fields?: readonly { readonly name: string; readonly value: string; readonly inline?: boolean }[];
}): MessagePayload {
    const { title, description, color, fields } = opts;

    const richContent = pipe(
        createRichContent(),
        (rc) => withTitle(rc, title),
        (rc) => withDescription(rc, description),
        (rc) => withColor(rc, color ?? COLOR_NEUTRAL),
        (rc) =>
            fields
                ? fields.reduce<typeof rc>(
                      (acc, f) => addField(acc, f.name, f.value, f.inline),
                      rc,
                  )
                : rc,
    );

    return { richContent };
}

/** Build a progress / phase notification (e.g. "Thinking...", "Generating..."). */
export function buildProgressNotification(opts: {
    readonly phase: string;
    readonly projectName?: string;
    readonly detail?: string;
}): MessagePayload {
    const { phase, projectName, detail } = opts;

    const phaseColor = PHASE_COLOURS[phase.toLowerCase()] ?? COLOR_NEUTRAL;

    const richContent = pipe(
        createRichContent(),
        (rc) => withTitle(rc, phase),
        (rc) => (detail ? withDescription(rc, detail) : rc),
        (rc) => withColor(rc, phaseColor),
        (rc) => (projectName ? addField(rc, 'Project', projectName, true) : rc),
    );

    return { richContent };
}
