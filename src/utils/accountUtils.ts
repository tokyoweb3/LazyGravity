export interface AccountConfigLike {
    name: string;
    cdpPort: number;
}

export function resolveValidAccountName(
    requested: string | null | undefined,
    accounts: AccountConfigLike[] | undefined,
): string {
    const safeAccounts = accounts && accounts.length > 0 ? accounts : [{ name: 'default', cdpPort: 9222 }];
    if (!requested) return safeAccounts[0].name;
    return safeAccounts.some((a) => a.name === requested) ? requested : safeAccounts[0].name;
}

export function listAccountNames(accounts: AccountConfigLike[] | undefined): string[] {
    const safeAccounts = accounts && accounts.length > 0 ? accounts : [{ name: 'default', cdpPort: 9222 }];
    return safeAccounts.map((a) => a.name);
}
