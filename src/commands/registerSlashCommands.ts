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
 * Slash command definitions for the Discord Interactions API.
 * Registers bot slash commands to the application.
 */

/** /mode command definition */
const modeCommand = new SlashCommandBuilder()
    .setName('mode')
    .setDescription(t('Display and change execution mode via a dropdown'));

/** /model command definition (formerly /models, unified to singular) */
const modelCommand = new SlashCommandBuilder()
    .setName('model')
    .setDescription(t('Display and change available LLM models'))
    .addStringOption((option) =>
        option
            .setName('name')
            .setDescription(t('Name of the model to change to'))
            .setRequired(false)
    );

/** /template command definition (formerly /templates, unified to singular) */
const templateCommand = new SlashCommandBuilder()
    .setName('template')
    .setDescription(t('List, register, or delete templates'))
    .addSubcommand((sub) =>
        sub
            .setName('list')
            .setDescription(t('Display registered template list with execute buttons'))
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

/** /stop command definition */
const stopCommand = new SlashCommandBuilder()
    .setName('stop')
    .setDescription(t('Interrupt active LLM generation'));

/** /screenshot command definition */
const screenshotCommand = new SlashCommandBuilder()
    .setName('screenshot')
    .setDescription(t('Capture current Antigravity screen'));

/** /status command definition (formerly /cdp status, extended to overall bot status) */
const statusCommand = new SlashCommandBuilder()
    .setName('status')
    .setDescription(t('Display overall bot status including connection, model, mode'));

/** /autoaccept command definition */
const autoAcceptCommand = new SlashCommandBuilder()
    .setName('autoaccept')
    .setDescription(t('Toggle auto-allow mode for approval dialogs'))
    .addStringOption((option) =>
        option
            .setName('mode')
            .setDescription(t('on / off / status (default: status)'))
            .setRequired(false)
    );

/** /project command definition (formerly /workspace, renamed to project) */
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

/** /new command definition (formerly /chat new, made into a standalone command) */
const newCommand = new SlashCommandBuilder()
    .setName('new')
    .setDescription(t('Start a new chat session in the current project'));

/** /chat command definition (merged status + list) */
const chatCommand = new SlashCommandBuilder()
    .setName('chat')
    .setDescription(t('Display current chat session info and session list'));

/** /cleanup command definition */
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

/** /help command definition */
const helpCommand = new SlashCommandBuilder()
    .setName('help')
    .setDescription(t('Display list of available commands'));

/** Array of commands to register */
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
 * Register slash commands with Discord
 * @param token Bot token
 * @param clientId Bot application ID
 * @param guildId Target guild (server) ID (global registration if omitted)
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
            // Guild-specific registration (takes effect immediately)
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commandData }
            );
            logger.info(`Registered ${commandData.length} slash commands to guild ${guildId}.`);
        } else {
            // Global registration (may take up to 1 hour to take effect)
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commandData }
            );
            logger.info(`Registered ${commandData.length} slash commands globally.`);
        }
    } catch (error) {
        logger.error(t('❌ Failed to register slash commands:'), error);
        throw error;
    }
}
