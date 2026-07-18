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
/** Prefix for interactive feedback action buttons. */
export const FEEDBACK_ACTION_PREFIX = 'feedback_action';
/** Prefix for interactive question choice option selection. */
export const QUESTION_SELECT_ACTION_PREFIX = 'question_select_action';
/** Prefix for interactive question skip button action. */
export const QUESTION_SKIP_ACTION_PREFIX = 'question_skip_action';

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

/**
 * Create a single button definition.
 * @param customId Button identifier payload.
 * @param label Button display text.
 * @param style Button visual styling keyword.
 * @returns ButtonDef configuration structure.
 */
function button(customId: string, label: string, style: ButtonStyle): ButtonDef {
    return { type: 'button', customId, label, style };
}

/**
 * Wrap one or more buttons into a component row.
 * @param buttons Buttons configuration array.
 * @returns ComponentRow wrapper.
 */
function buttonRow(...buttons: readonly ButtonDef[]): ComponentRow {
    return { components: buttons };
}

/**
 * Build a colon-separated customId following the project convention:
 *   `<prefix>:<projectName>` or `<prefix>:<projectName>:<channelId>`
 * @param prefix Action identifier prefix.
 * @param projectName Active workspace name.
 * @param channelId Optional channel snowflake.
 * @returns Serialized customId string.
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

/**
 * Build the approval notification message.
 * @param opts Parameter attributes configuration.
 * @returns Platform-agnostic MessagePayload result.
 */
export function buildApprovalNotification(opts: {
    readonly title: string;
    readonly description: string;
    readonly projectName: string;
    readonly channelId: string | null;
    /** List of tool names requesting approval. */
    readonly toolNames?: readonly string[];
    /** Additional fields appended after default ones. */
    readonly extraFields?: readonly { readonly name: string; readonly value: string; readonly inline?: boolean }[];
    /** Whether an 'Always Allow' / 'Allow Chat' button exists. */
    readonly hasAlwaysAllow?: boolean;
    readonly alwaysAllowText?: string;
    readonly walkthroughCustomId?: string;
    readonly taskCustomId?: string;
}): MessagePayload {
    const { title, description, projectName, channelId, toolNames, extraFields, hasAlwaysAllow, alwaysAllowText, walkthroughCustomId, taskCustomId } = opts;

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

    const buttons = [
        button(customId(APPROVE_ACTION_PREFIX, projectName, channelId), 'Allow', 'success'),
    ];
    
    if (hasAlwaysAllow) {
        buttons.push(button(customId(ALWAYS_ALLOW_ACTION_PREFIX, projectName, channelId), alwaysAllowText || 'Allow Chat', 'primary'));
    }
    
    buttons.push(button(customId(DENY_ACTION_PREFIX, projectName, channelId), 'Deny', 'danger'));

    const components: ComponentRow[] = [
        buttonRow(...buttons),
    ];

    const artifactButtons = [];
    if (walkthroughCustomId) {
        artifactButtons.push(button(walkthroughCustomId, 'Review walkthrough.md', 'success'));
    }
    if (taskCustomId) {
        artifactButtons.push(button(taskCustomId, 'Review task.md', 'primary'));
    }

    if (artifactButtons.length > 0) {
        components.push(buttonRow(...artifactButtons));
    }

    return { richContent, components };
}

/**
 * Build the planning mode notification message.
 * @param opts Parameter attributes configuration.
 * @returns Platform-agnostic MessagePayload result.
 */
export function buildPlanningNotification(opts: {
    readonly title: string;
    readonly description: string;
    readonly projectName: string;
    readonly channelId: string | null;
    /** Additional fields appended before footer. */
    readonly extraFields?: readonly { readonly name: string; readonly value: string; readonly inline?: boolean }[];
    readonly hasOpenButton?: boolean;
    readonly openText?: string;
    readonly proceedText?: string;
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

    const buttons = [];
    if (opts.hasOpenButton !== false) {
        const openLabel = opts.openText || 'Open Plan';
        buttons.push(button(customId(PLANNING_OPEN_ACTION_PREFIX, projectName, channelId), openLabel, 'primary'));
    }
    const buttonLabel = opts.proceedText || 'Proceed';
    buttons.push(button(customId(PLANNING_PROCEED_ACTION_PREFIX, projectName, channelId), buttonLabel, 'success'));

    const components: readonly ComponentRow[] = [
        buttonRow(...buttons),
    ];

    return { richContent, components };
}

/**
 * Build the error popup notification message.
 * @param opts Parameter attributes configuration.
 * @returns Platform-agnostic MessagePayload result.
 */
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

/**
 * Build the run command notification message.
 * @param opts Parameter attributes configuration.
 * @returns Platform-agnostic MessagePayload result.
 */
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
    const safeCommandText = (commandText || '')
        .replace(/```/g, '`\u200b``')
        .slice(0, 3800);
    const safeWorkingDirectory = (workingDirectory || '(unknown)').slice(0, 1024);

    const richContent = pipe(
        createRichContent(),
        (rc) => withTitle(rc, title),
        (rc) => withDescription(rc, `\`\`\`\n${safeCommandText}\n\`\`\``),
        (rc) => withColor(rc, COLOR_APPROVAL),
        (rc) => addField(rc, 'Directory', safeWorkingDirectory, true),
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

/**
 * Build an auto-approved notification (shown when auto-accept fires).
 * @param opts Parameter attributes configuration.
 * @returns Platform-agnostic MessagePayload result.
 */
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
 * @param original Original source MessagePayload context.
 * @param statusText Resulting outcome text label.
 * @returns Modified resolved MessagePayload.
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

/**
 * Build a simple status embed.
 * @param opts Parameter attributes configuration.
 * @returns Platform-agnostic MessagePayload result.
 */
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

/** Configuration interface for buildQuestionNotification. */
export interface BuildQuestionNotificationParams {
    /** Alert question title. */
    title: string;
    /** Question detailed prompt. */
    description: string;
    /** Target workspace project name. */
    projectName: string;
    /** Target channel identifier. */
    channelId: string;
    /** Available choices list. */
    options: { text: string; x: number; y: number }[];
}

/**
 * Build a multiple-choice question notification message.
 * @param params Parameter attributes configuration.
 * @returns Platform-agnostic MessagePayload result.
 */
export function buildQuestionNotification(
    params: BuildQuestionNotificationParams,
): MessagePayload {
    const { title, description, projectName, channelId, options } = params;

    const baseContent = pipe(
        createRichContent(),
        (rc) => withTitle(rc, title),
        (rc) => withColor(rc, COLOR_APPROVAL),
    );

    const embed = description ? withDescription(baseContent, description) : baseContent;

    const selectMenuOptions = options.map((opt, i) => ({
        label: opt.text.substring(0, 100), // Discord max length for label is 100
        value: i.toString(),
    })).slice(0, 25); // Discord max options in a select menu is 25

    // Ensure customIds fit within 100 chars without losing channelId
    const encodeSafe = (str: string, maxLen: number) => {
        let encoded = encodeURIComponent(str);
        if (encoded.length <= maxLen) return encoded;
        return encoded.substring(0, maxLen).replace(/(%[0-9A-F]?)$/i, '');
    };

    const encodedChannel = encodeURIComponent(channelId);
    
    const selectOverhead = QUESTION_SELECT_ACTION_PREFIX.length + 2 + encodedChannel.length;
    const safeSelectProjectName = encodeSafe(projectName, 100 - selectOverhead);
    const encodedCustomId = `${QUESTION_SELECT_ACTION_PREFIX}:${safeSelectProjectName}:${encodedChannel}`;

    const skipOverhead = QUESTION_SKIP_ACTION_PREFIX.length + 2 + encodedChannel.length;
    const safeSkipProjectName = encodeSafe(projectName, 100 - skipOverhead);
    const encodedSkipCustomId = `${QUESTION_SKIP_ACTION_PREFIX}:${safeSkipProjectName}:${encodedChannel}`;

    return {
        richContent: embed,
        components: [
            {
                components: [
                    {
                        type: 'selectMenu',
                        customId: encodedCustomId,
                        placeholder: 'Select an option...',
                        options: selectMenuOptions,
                    },
                ],
            },
            {
                components: [
                    {
                        type: 'button',
                        customId: encodedSkipCustomId,
                        label: 'Skip',
                        style: 'secondary',
                    },
                ],
            },
        ],
    };
}

/**
 * Build a progress / phase notification (e.g. "Thinking...", "Generating...").
 * @param opts Parameter attributes configuration.
 * @returns Platform-agnostic MessagePayload result.
 */
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
