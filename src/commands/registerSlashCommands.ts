import { logger } from '../utils/logger';
import {
    SlashCommandBuilder,
    REST,
    Routes,
} from 'discord.js';
import { t } from "../utils/i18n";
import { AVAILABLE_MODELS } from '../services/modelService';
import { AVAILABLE_MODES } from '../services/modeService';

/**
 * Discord Interactions API 用のスラッシュコマンド定義
 * Botのスラッシュコマンドをアプリケーションに登録する
 */

/** /mode コマンド定義 */
const modeCommand = new SlashCommandBuilder()
    .setName('mode')
    .setDescription(t('Display and change execution mode via a dropdown'));

/** /model コマンド定義（旧 /models → 単数形に統一） */
const modelCommand = new SlashCommandBuilder()
    .setName('model')
    .setDescription(t('Display and change available LLM models'))
    .addStringOption((option) =>
        option
            .setName('name')
            .setDescription(t('Name of the model to change to'))
            .setRequired(false)
    );

/** /template コマンド定義（旧 /templates → 単数形に統一） */
const templateCommand = new SlashCommandBuilder()
    .setName('template')
    .setDescription(t('List, invoke, register, or delete templates'))
    .addSubcommand((sub) =>
        sub
            .setName('list')
            .setDescription(t('Display registered template list'))
    )
    .addSubcommand((sub) =>
        sub
            .setName('use')
            .setDescription(t('Invoke and execute a template'))
            .addStringOption((option) =>
                option
                    .setName('name')
                    .setDescription(t('Template name'))
                    .setRequired(true)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('add')
            .setDescription(t('Register a new template'))
            .addStringOption((option) =>
                option
                    .setName('name')
                    .setDescription(t('Template name'))
                    .setRequired(true)
            )
            .addStringOption((option) =>
                option
                    .setName('prompt')
                    .setDescription(t('Prompt content of the template'))
                    .setRequired(true)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('delete')
            .setDescription(t('Delete a template'))
            .addStringOption((option) =>
                option
                    .setName('name')
                    .setDescription(t('Name of the template to delete'))
                    .setRequired(true)
            )
    );

/** /stop コマンド定義 */
const stopCommand = new SlashCommandBuilder()
    .setName('stop')
    .setDescription(t('Interrupt active LLM generation'));

/** /screenshot コマンド定義 */
const screenshotCommand = new SlashCommandBuilder()
    .setName('screenshot')
    .setDescription(t('Capture current Antigravity screen'));

/** /status コマンド定義（旧 /cdp status → Bot全体のステータスに拡張） */
const statusCommand = new SlashCommandBuilder()
    .setName('status')
    .setDescription(t('Display overall bot status including connection, model, mode'));

/** /autoaccept コマンド定義 */
const autoAcceptCommand = new SlashCommandBuilder()
    .setName('autoaccept')
    .setDescription(t('Toggle auto-allow mode for approval dialogs'))
    .addStringOption((option) =>
        option
            .setName('mode')
            .setDescription(t('on / off / status (default: status)'))
            .setRequired(false)
    );

/** /project コマンド定義（旧 /workspace → プロジェクトに名称変更） */
const projectCommand = new SlashCommandBuilder()
    .setName('project')
    .setDescription(t('List projects, on select auto-create channel and bind'))
    .addSubcommand((sub) =>
        sub
            .setName('list')
            .setDescription(t('Display project list'))
    )
    .addSubcommand((sub) =>
        sub
            .setName('create')
            .setDescription(t('Create a new project'))
            .addStringOption((option) =>
                option
                    .setName('name')
                    .setDescription(t('Name of the project to create'))
                    .setRequired(true)
            )
    );

/** /new コマンド定義（旧 /chat new → 独立コマンドとして最短化） */
const newCommand = new SlashCommandBuilder()
    .setName('new')
    .setDescription(t('Start a new chat session in the current project'));

/** /chat コマンド定義（status + list を統合） */
const chatCommand = new SlashCommandBuilder()
    .setName('chat')
    .setDescription(t('Display current chat session info and session list'));

/** /cleanup コマンド定義 */
const cleanupCommand = new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription(t('Scan and clean up inactive session channels and categories'))
    .addIntegerOption((option) =>
        option
            .setName('days')
            .setDescription(t('Number of days of inactivity (default: 7)'))
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(365)
    );

/** /help コマンド定義 */
const helpCommand = new SlashCommandBuilder()
    .setName('help')
    .setDescription(t('Display list of available commands'));

/** 登録するコマンドの配列 */
export const slashCommands = [
    helpCommand,
    modeCommand,
    modelCommand,
    templateCommand,
    stopCommand,
    screenshotCommand,
    statusCommand,
    autoAcceptCommand,
    projectCommand,
    newCommand,
    chatCommand,
    cleanupCommand,
];

/**
 * Discord にスラッシュコマンドを登録する
 * @param token Botのトークン
 * @param clientId BotのアプリケーションID
 * @param guildId 登録先のギルド（サーバー）ID（省略時はグローバル登録）
 */
export async function registerSlashCommands(
    token: string,
    clientId: string,
    guildId?: string
): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(token);

    const commandData = slashCommands.map((cmd) => cmd.toJSON());

    try {
        if (guildId) {
            // ギルド限定登録（即時反映）
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commandData }
            );
            logger.info(`✅ スラッシュコマンド ${commandData.length} 件をギルド ${guildId} に登録しました。`);
        } else {
            // グローバル登録（反映に最大1時間かかる）
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commandData }
            );
            logger.info(`✅ スラッシュコマンド ${commandData.length} 件をグローバルに登録しました。`);
        }
    } catch (error) {
        logger.error(t('❌ Failed to register slash commands:'), error);
        throw error;
    }
}
