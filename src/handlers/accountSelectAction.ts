import type { PlatformSelectInteraction } from '../platform/types';
import type { SelectAction } from './selectHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import type { AntigravityAccountConfig } from '../utils/configLoader';
import type { AccountPreferenceRepository } from '../database/accountPreferenceRepository';
import type { ChannelPreferenceRepository } from '../database/channelPreferenceRepository';
import { listAccountNames } from '../utils/accountUtils';
import { ACCOUNT_SELECT_ID, buildAccountPayload } from '../ui/accountUi';
import { logger } from '../utils/logger';

export interface AccountSelectActionDeps {
    readonly bridge: CdpBridge;
    readonly accountPrefRepo: AccountPreferenceRepository;
    readonly channelPrefRepo?: ChannelPreferenceRepository;
    readonly getWorkspacePathForChannel?: (channelId: string) => string | null | undefined;
    readonly antigravityAccounts: AntigravityAccountConfig[];
}

export function createAccountSelectAction(deps: AccountSelectActionDeps): SelectAction {
    return {
        match(customId: string): boolean {
            return customId === ACCOUNT_SELECT_ID;
        },

        async execute(
            interaction: PlatformSelectInteraction,
            values: readonly string[],
        ): Promise<void> {
            const selectedAccount = values[0];
            if (!selectedAccount) return;

            const names = listAccountNames(deps.antigravityAccounts);

            if (!names.includes(selectedAccount)) {
                await interaction.followUp({
                    text: `⚠️ Unknown account: **${selectedAccount}**`,
                }).catch(() => {});
                return;
            }

            await interaction.deferUpdate();

            deps.accountPrefRepo.setAccountName(interaction.user.id, selectedAccount);
            deps.channelPrefRepo?.setAccountName(interaction.channel.id, selectedAccount);
            deps.bridge.selectedAccountByChannel?.set(interaction.channel.id, selectedAccount);

            const channelWorkspace = deps.getWorkspacePathForChannel?.(interaction.channel.id) ?? null;
            if (channelWorkspace) {
                deps.bridge.pool.setPreferredAccountForWorkspace?.(channelWorkspace, selectedAccount);
            }

            const selectedPort = deps.antigravityAccounts.find((a) => a.name === selectedAccount)?.cdpPort;
            logger.info(
                `[AccountSwitch] source=select channel=${interaction.channel.id} user=${interaction.user.id} ` +
                `account=${selectedAccount} port=${selectedPort ?? 'unknown'} ` +
                `workspace=${channelWorkspace ?? 'unbound'}`,
            );

            const payload = buildAccountPayload(selectedAccount, names);
            await interaction.update(payload);
            await interaction.followUp({
                text: `✅ Switched account to **${selectedAccount}**.`,
            }).catch(() => {});
        },
    };
}
