export interface AccountConfigLike {
    name: string;
    cdpPort: number;
}

export interface ChannelPreferenceLookup {
    getAccountName(channelId: string): string | null;
}

export interface AccountPreferenceLookup {
    getAccountName(userId: string): string | null;
}

export function resolveValidAccountName(
    requested: string | null | undefined,
    accounts: AccountConfigLike[] | undefined,
): string {
    const safeAccounts = accounts && accounts.length > 0 ? accounts : [{ name: 'default', cdpPort: 9222 }];
    if (!requested) return safeAccounts[0].name;
    return safeAccounts.some((account) => account.name === requested) ? requested : safeAccounts[0].name;
}

export function listAccountNames(accounts: AccountConfigLike[] | undefined): string[] {
    const safeAccounts = accounts && accounts.length > 0 ? accounts : [{ name: 'default', cdpPort: 9222 }];
    return safeAccounts.map((account) => account.name);
}

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
