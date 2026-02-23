import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { CdpService } from '../services/cdpService';

export interface ModelsUiDeps {
    getCurrentCdp: () => CdpService | null;
    fetchQuota: () => Promise<any[]>;
}

/**
 * /models コマンドのインタラクティブなUIを組み立てて送信する
 */
export async function sendModelsUI(
    target: { editReply: (opts: any) => Promise<any> },
    deps: ModelsUiDeps,
): Promise<void> {
    const cdp = deps.getCurrentCdp();
    if (!cdp) {
        await target.editReply({ content: 'CDPに未接続です。' });
        return;
    }
    const models = await cdp.getUiModels();
    const currentModel = await cdp.getCurrentModel();
    const quotaData = await deps.fetchQuota();

    if (models.length === 0) {
        await target.editReply({ content: 'Antigravityのモデル一覧の取得に失敗しました。' });
        return;
    }

    function formatQuota(mName: string, current: boolean) {
        if (!mName) return `${current ? '[x]' : '[ ]'} 不明`;

        const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '');
        const nName = normalize(mName);
        const q = quotaData.find(q => {
            const nLabel = normalize(q.label);
            const nModel = normalize(q.model || '');
            return nLabel === nName || nModel === nName
                || nName.includes(nLabel) || nLabel.includes(nName)
                || (nModel && (nName.includes(nModel) || nModel.includes(nName)));
        });
        if (!q || !q.quotaInfo) return `${current ? '[x]' : '[ ]'} ${mName}`;

        const rem = q.quotaInfo.remainingFraction;
        const resetTime = q.quotaInfo.resetTime ? new Date(q.quotaInfo.resetTime) : null;
        const diffMs = resetTime ? resetTime.getTime() - Date.now() : 0;
        let timeStr = 'Ready';
        if (diffMs > 0) {
            const mins = Math.ceil(diffMs / 60000);
            if (mins < 60) timeStr = `${mins}m`;
            else timeStr = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }

        if (rem !== undefined && rem !== null) {
            const percent = Math.round(rem * 100);
            let icon = '🟢';
            if (percent <= 20) icon = '🔴';
            else if (percent <= 50) icon = '🟡';
            return `${current ? '[x]' : '[ ]'} ${mName} ${icon} ${percent}% (⏱️ ${timeStr})`;
        }

        return `${current ? '[x]' : '[ ]'} ${mName} (⏱️ ${timeStr})`;
    }

    const currentModelFormatted = currentModel ? formatQuota(currentModel, true) : '不明';

    const embed = new EmbedBuilder()
        .setTitle('モデル管理')
        .setColor(0x5865F2)
        .setDescription(`**現在のモデル:**\n${currentModelFormatted}\n\n` +
            `**利用可能なモデル (${models.length}件)**\n` +
            models.map(m => formatQuota(m, m === currentModel)).join('\n'),
        )
        .setFooter({ text: '最新のQuota情報を取得しました' })
        .setTimestamp();

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    for (const mName of models.slice(0, 24)) {
        if (currentRow.components.length === 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder<ButtonBuilder>();
        }
        const safeName = mName.length > 80 ? mName.substring(0, 77) + '...' : mName;
        currentRow.addComponents(new ButtonBuilder()
            .setCustomId(`model_btn_${mName}`)
            .setLabel(safeName)
            .setStyle(mName === currentModel ? ButtonStyle.Success : ButtonStyle.Secondary),
        );
    }

    if (currentRow.components.length < 5) {
        currentRow.addComponents(new ButtonBuilder()
            .setCustomId('model_refresh_btn')
            .setLabel('更新')
            .setStyle(ButtonStyle.Primary),
        );
        rows.push(currentRow);
    } else {
        rows.push(currentRow);
        if (rows.length < 5) {
            const refreshRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('model_refresh_btn')
                    .setLabel('更新')
                    .setStyle(ButtonStyle.Primary),
            );
            rows.push(refreshRow);
        }
    }

    await target.editReply({ content: '', embeds: [embed], components: rows });
}
