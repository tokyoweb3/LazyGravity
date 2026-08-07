import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    type MessageCreateOptions,
} from 'discord.js';
import type { ClassifyResult } from '../../services/assistantDomExtractor';

/**
 * Splits a long string into chunks that fit within Discord's embed description limit (4096 chars).
 * Tries to split on double newlines, then single newlines, then spaces, before hard splitting.
 */
function chunkText(text: string, limit = 4000): string[] {
    if (!text) return [];
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= limit) {
            chunks.push(remaining);
            break;
        }

        let slice = remaining.slice(0, limit);
        let splitIndex = slice.lastIndexOf('\n\n');
        
        if (splitIndex === -1 || splitIndex < limit * 0.5) {
            splitIndex = slice.lastIndexOf('\n');
        }
        if (splitIndex === -1 || splitIndex < limit * 0.5) {
            splitIndex = slice.lastIndexOf(' ');
        }
        if (splitIndex === -1 || splitIndex < limit * 0.5) {
            splitIndex = limit; // Hard split
        }

        chunks.push(remaining.slice(0, splitIndex).trim());
        remaining = remaining.slice(splitIndex).trim();
    }

    return chunks;
}

/**
 * Renders a classified Antigravity response into a Discord Message payload.
 *
 * Handles chunking for large outputs and structured cards (plan, files, actions).
 */
export function renderDiscordResponse(result: ClassifyResult, options?: { projectName?: string, channelId?: string }): MessageCreateOptions {
    const embeds: EmbedBuilder[] = [];
    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    // 1. Final Output Text
    if (result.finalOutputText) {
        const textChunks = chunkText(result.finalOutputText, 4000); // leave some buffer
        for (let i = 0; i < textChunks.length && i < 8; i++) { // max 10 embeds total, leave room
            const embed = new EmbedBuilder()
                .setColor(0x2b2d31) // Discord dark mode background-ish / neutral
                .setDescription(textChunks[i]);
            embeds.push(embed);
        }
    }

    // 2. Plan Cards
    if (result.planCards && result.planCards.length > 0) {
        const planText = result.planCards.join('\n\n');
        const chunks = chunkText(planText, 4000);
        for (let i = 0; i < chunks.length && embeds.length < 10; i++) {
            const embed = new EmbedBuilder()
                .setTitle(i === 0 ? 'Plan' : null)
                .setColor(0x5865f2) // Blurple
                .setDescription(chunks[i]);
            embeds.push(embed);
        }
    }

    // 3. File Changes
    if (result.fileChanges && result.fileChanges.length > 0) {
        const embed = new EmbedBuilder()
            .setTitle('File Changes')
            .setColor(0x3ba55c); // Greenish
            
        // Chunk into fields if necessary (max 25 fields, 1024 chars per field)
        let currentFieldVal = '';
        let fieldCount = 0;
        let processedCount = 0;
        let truncated = false;
        
        for (const file of result.fileChanges) {
            if (fieldCount >= 24) {
                truncated = true;
                break;
            }
            const line = `- \`${file.path}\` (${file.type})\n`;
            if (line.length > 1000) {
                if (currentFieldVal) {
                    embed.addFields({ name: fieldCount === 0 ? 'Files' : '...', value: currentFieldVal });
                    currentFieldVal = '';
                    fieldCount++;
                }
                const splitLine = chunkText(line, 1000);
                for (const sl of splitLine) {
                    if (fieldCount >= 24) {
                        truncated = true;
                        break;
                    }
                    embed.addFields({ name: fieldCount === 0 ? 'Files' : '...', value: sl || '-' });
                    fieldCount++;
                }
            } else if (currentFieldVal.length + line.length > 1000) {
                if (currentFieldVal) {
                    embed.addFields({ name: fieldCount === 0 ? 'Files' : '...', value: currentFieldVal });
                    fieldCount++;
                }
                currentFieldVal = line;
            } else {
                currentFieldVal += line;
            }
            if (!truncated) {
                processedCount++;
            }
        }
        if (currentFieldVal && fieldCount < 24) {
            embed.addFields({ name: fieldCount === 0 ? 'Files' : '...', value: currentFieldVal });
            fieldCount++;
        }
        if (processedCount < result.fileChanges.length) {
            const remaining = result.fileChanges.length - processedCount;
            embed.addFields({ name: '...', value: `*...and ${remaining} more*` });
        }
        
        embeds.push(embed);
    }

    // 4. Action Buttons
    if (result.actionButtons && result.actionButtons.length > 0) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (let i = 0; i < result.actionButtons.length && i < 5; i++) { // Max 5 buttons per row
            const btnText = result.actionButtons[i];
            let customId = `action_btn_${btnText.toLowerCase().replace(/\s+/g, '_')}`;
            if (options?.projectName && options?.channelId) {
                const overhead = customId.length + 2 + options.channelId.length;
                const safeProject = options.projectName.length > (100 - overhead)
                    ? options.projectName.substring(0, 100 - overhead)
                    : options.projectName;
                customId = `${customId}:${safeProject}:${options.channelId}`;
            }
            const btn = new ButtonBuilder()
                .setCustomId(customId)
                .setLabel(btnText)
                .setStyle(
                    btnText.toLowerCase() === 'proceed' || btnText.toLowerCase() === 'open' 
                    ? ButtonStyle.Primary 
                    : ButtonStyle.Secondary
                );
            row.addComponents(btn);
        }
        components.push(row);
    }

    // 5. Fallback if absolutely empty
    if (embeds.length === 0) {
        if (result.activityLines && result.activityLines.length > 0) {
            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setDescription('*(Processing...)*\n' + result.activityLines.slice(-3).join('\n').slice(0, 3900));
            embeds.push(embed);
        } else {
            return { content: '*(No output)*' };
        }
    }

    // Discord allows max 10 embeds per message.
    const finalEmbeds = embeds.slice(0, 10);
    
    return {
        embeds: finalEmbeds,
        components: components.length > 0 ? components : undefined,
    };
}
