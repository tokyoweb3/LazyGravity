/**
 * Artifacts UI — Discord embed + select menu for the /artifacts command.
 *
 * Follows the same pattern as sessionPickerUi.ts.
 */

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    StringSelectMenuBuilder,
    MessageFlags,
} from 'discord.js';
import { UserPreferenceRepository } from '../database/userPreferenceRepository';
import { ChatSessionRepository } from '../database/chatSessionRepository';

import type { ArtifactInfo } from '../services/artifactService';
import { ArtifactService, artifactTypeLabel } from '../services/artifactService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Custom ID for the artifact select menu */
export const ARTIFACT_SELECT_ID = 'artifact_select';

/** Custom ID for the toggle buttons */
export const ARTIFACT_THREAD_BTN = 'artifact_mode_thread';
export const ARTIFACT_INLINE_BTN = 'artifact_mode_inline';

/** Discord select menu option limit */
const MAX_SELECT_OPTIONS = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.slice(0, max - 1) + '…';
}

function formatOptionDescription(artifact: ArtifactInfo): string | undefined {
    const parts: string[] = [];
    parts.push(artifactTypeLabel(artifact.artifactType));
    if (artifact.summary) {
        parts.push(truncate(artifact.summary, 60));
    }
    const combined = parts.join(' · ');
    // Discord limits descriptions to 100 chars
    return combined.length > 0 ? truncate(combined, 100) : undefined;
}

function formatUpdatedAt(iso?: string): string {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '';
    }
}

// ---------------------------------------------------------------------------
// Discord-specific builder
// ---------------------------------------------------------------------------

/**
 * Build the artifact picker embed + select menu components.
 */
export function buildArtifactPickerUI(
    artifacts: ArtifactInfo[],
    conversationId?: string,
    renderMode: 'thread' | 'inline' = 'thread',
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<any>[] } {
    const embed = new EmbedBuilder()
        .setTitle('📂 Artifacts')
        .setColor(0x5865F2)
        .setTimestamp();

    if (artifacts.length === 0) {
        embed.setDescription('No artifacts found for the active session.');
        return { embeds: [embed], components: [] };
    }

    const displayId = conversationId
        ? conversationId.slice(0, 8) + '…'
        : 'current session';

    embed.setDescription(
        `**${artifacts.length}** artifact(s) found (conversation \`${displayId}\`)\n` +
        'Select one to render its content below.',
    );

    const fields = artifacts.map((a) => ({
        name: a.filename,
        value: [
            artifactTypeLabel(a.artifactType),
            a.summary ? `*${truncate(a.summary, 120)}*` : '',
            a.updatedAt ? `🕐 v${a.version ?? '?'} · ${formatUpdatedAt(a.updatedAt)}` : '',
        ].filter(Boolean).join('\n'),
        inline: false,
    }));

    // Add summary fields (max 10 to avoid embed limit)
    embed.addFields(...fields.slice(0, 10));

    const pageItems = artifacts.slice(0, MAX_SELECT_OPTIONS);

    const options = pageItems.map((a) => ({
        label: truncate(a.filename, 100),
        value: ArtifactService.encodeSelectValue(a.conversationId, a.filename),
        description: formatOptionDescription(a),
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(ARTIFACT_SELECT_ID)
        .setPlaceholder('Select an artifact to view…')
        .addOptions(options);

    const components: ActionRowBuilder<any>[] = [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
    ];

    // Add toggle button row
    const toggleButton = new ButtonBuilder();
    if (renderMode === 'thread') {
        toggleButton
            .setCustomId(ARTIFACT_INLINE_BTN)
            .setLabel('💬 Switch to Inline')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('💬');
        embed.setFooter({ text: 'Output: Thread (one thread per file)' });
    } else {
        toggleButton
            .setCustomId(ARTIFACT_THREAD_BTN)
            .setLabel('📌 Switch to Thread')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📌');
        embed.setFooter({ text: 'Output: Inline' });
    }

    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(toggleButton));

    return { embeds: [embed], components };
}

// ---------------------------------------------------------------------------
// Interaction sender
// ---------------------------------------------------------------------------

/**
 * Send the artifacts picker UI as an editReply to a slash command interaction.
 */
export async function sendArtifactsUI(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    artifacts: ArtifactInfo[],
    conversationId?: string,
    renderMode: 'thread' | 'inline' = 'thread',
): Promise<void> {
    const { embeds, components } = buildArtifactPickerUI(artifacts, conversationId, renderMode);
    await interaction.editReply({ embeds, components });
}

/**
 * Higher-level helper to send the artifact picker UI, 
 * automatically discovering artifacts for the current channel.
 */
export async function sendArtifactPickerUI(
    interaction: { reply: (opts: any) => Promise<any>; editReply: (opts: any) => Promise<any>; user: { id: string }; channelId: string },
    deps: { userPrefRepo?: UserPreferenceRepository; chatSessionRepo?: ChatSessionRepository },
    edit: boolean = false
): Promise<void> {
    const artifactService = new ArtifactService();
    const sessionTitle = deps.chatSessionRepo?.findByChannelId(interaction.channelId)?.displayName?.trim() ?? '';
    
    // 1. Resolve conversation (either matching session title or latest)
    let conversationId = sessionTitle ? artifactService.findConversationByTitle(sessionTitle) : null;
    if (!conversationId) conversationId = artifactService.getLatestConversationWithArtifacts();

    if (!conversationId) {
        const payload = { content: '📂 No artifacts found for this session.', components: [], ephemeral: true };
        if (edit) await interaction.editReply(payload);
        else await interaction.reply(payload);
        return;
    }

    // 2. List artifacts
    const artifacts = artifactService.listArtifacts(conversationId);
    if (artifacts.length === 0) {
        const payload = { content: '📂 No artifacts found in this conversation.', components: [], ephemeral: true };
        if (edit) await interaction.editReply(payload);
        else await interaction.reply(payload);
        return;
    }

    // 3. Get user render mode pref
    const renderMode = deps.userPrefRepo?.getArtifactRenderMode(interaction.user.id) ?? 'thread';

    // 4. Build and send
    const { embeds, components } = buildArtifactPickerUI(artifacts, conversationId, renderMode);
    
    const payload = { embeds, components, ephemeral: true };
    if (edit) await interaction.editReply(payload);
    else await interaction.reply(payload);
}
