/**
 * Interface representing a simple account configuration option.
 */
export interface AccountConfigLike {
    /** Account name. */
    name: string;
    /** Debugging port. */
    cdpPort: number;
}

/**
 * Interface representing channel preferences storage lookups.
 */
export interface ChannelPreferenceLookup {
    /** Retrieve active account name configuration by channel. */
    getAccountName(channelId: string): string | null;
}

/**
 * Interface representing user preferences storage lookups.
 */
export interface AccountPreferenceLookup {
    /** Retrieve active account name configuration by user. */
    getAccountName(userId: string): string | null;
}

/**
 * Resolves a requested account name ensuring it belongs to the defined accounts configuration.
 * @param requested Candidate name.
 * @param accounts Active configured accounts list.
 * @returns Sanitized verified account name.
 */
export function resolveValidAccountName(
    requested: string | null | undefined,
    accounts: AccountConfigLike[] | undefined,
): string {
    const safeAccounts = accounts && accounts.length > 0 ? accounts : [{ name: 'default', cdpPort: 9222 }];
    if (!requested) return safeAccounts[0].name;
    return safeAccounts.some((account) => account.name === requested) ? requested : safeAccounts[0].name;
}

/**
 * Lists the names of all configured accounts.
 * @param accounts Configuration accounts list.
 * @returns Array of name strings.
 */
export function listAccountNames(accounts: AccountConfigLike[] | undefined): string[] {
    const safeAccounts = accounts && accounts.length > 0 ? accounts : [{ name: 'default', cdpPort: 9222 }];
    return safeAccounts.map((account) => account.name);
}

/**
 * Infers parent channel scope ID for thread subchannels.
 * @param channelId Target channel ID.
 * @param explicitParentChannelId Optional explicit parent channel ID.
 * @returns Resolved parent channel ID, or null.
 */
export function inferParentScopeChannelId(channelId: string, explicitParentChannelId?: string | null): string | null {
    if (explicitParentChannelId && explicitParentChannelId.trim().length > 0) {
        return explicitParentChannelId.trim();
    }

    const underscoreIndex = channelId.indexOf('_');
    if (underscoreIndex > 0) {
        return channelId.slice(0, underscoreIndex);
    }

    return null;
}

/**
 * Resolves the active account name according to context scope hierarchy.
 * Options order: session preference -> interactive channel override -> channel pref -> parent channel overrides -> user pref.
 * @param options Scope options dictionary.
 * @returns Resolved account name string.
 */
export function resolveScopedAccountName(
    options: {
        channelId: string;
        userId: string;
        sessionAccountName?: string | null;
        selectedAccountByChannel?: Map<string, string>;
        channelPrefRepo?: ChannelPreferenceLookup;
        accountPrefRepo?: AccountPreferenceLookup;
        accounts?: AccountConfigLike[];
        parentChannelId?: string | null;
    },
): string {
    const parentChannelId = inferParentScopeChannelId(options.channelId, options.parentChannelId);

    return resolveValidAccountName(
        options.sessionAccountName
            ?? options.selectedAccountByChannel?.get(options.channelId)
            ?? options.channelPrefRepo?.getAccountName(options.channelId)
            ?? (parentChannelId ? options.selectedAccountByChannel?.get(parentChannelId) : null)
            ?? (parentChannelId ? options.channelPrefRepo?.getAccountName(parentChannelId) : null)
            ?? options.accountPrefRepo?.getAccountName(options.userId)
            ?? 'default',
        options.accounts,
    );
}
