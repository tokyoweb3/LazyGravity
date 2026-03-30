import { exportConversationBundleByTitle, importConversationBundleToProfile } from '../../services/conversationTransferService';
import { COLORS } from '../../utils/logger';

export function exportConversationAction(profile: string, title: string, outDir: string): void {
    const bundleDir = exportConversationBundleByTitle(profile, title, outDir);
    console.log(`${COLORS.green}Exported conversation bundle:${COLORS.reset} ${bundleDir}`);
}

export function importConversationAction(profile: string, bundleDir: string): void {
    const result = importConversationBundleToProfile(bundleDir, profile);
    console.log(`${COLORS.green}Imported conversation:${COLORS.reset} ${result.conversationId}`);
    console.log(`${COLORS.dim}DB backup:${COLORS.reset} ${result.dbBackupPath}`);
}
