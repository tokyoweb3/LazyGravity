import { logger } from '../utils/logger';
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    REST,
    Routes,
    ChannelType,
} from 'discord.js';
import { t } from "../utils/i18n";

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

/** /shutdown command definition */
const shutdownCommand = new SlashCommandBuilder()
    .setName('shutdown')
    .setDescription(t('Shut down Antigravity IDE'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

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
    .setDescription(t('Display and toggle auto-allow mode for approval dialogs'))
    .addStringOption((option) =>
        option
            .setName('mode')
            .setDescription(t('on / off (optional direct switch)'))
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
    )
    .addSubcommand((sub) =>
        sub
            .setName('account')
            .setDescription(t('Display or change the Antigravity account bound to this project channel'))
            .addStringOption((option) =>
                option
                    .setName('name')
                    .setDescription(t('Name of the account to bind to this project channel'))
                    .setRequired(false)
            )
    );

/** /new command definition (formerly /chat new, made into a standalone command) */
const newCommand = new SlashCommandBuilder()
    .setName('new')
    .setDescription(t('Start a new chat session in the current project'))
    .addStringOption(option =>
        option.setName('name')
            .setDescription(t('Name of the new chat session'))
            .setRequired(false)
    );

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

/** /join command definition */
const joinCommand = new SlashCommandBuilder()
    .setName('join')
    .setDescription(t('Join an existing Antigravity session (shows up to 20 recent sessions)'));

/** /mirror command definition */
const mirrorCommand = new SlashCommandBuilder()
    .setName('mirror')
    .setDescription(t('Toggle PC-to-Discord message mirroring for the current session'));

/** /output command definition */
const outputCommand = new SlashCommandBuilder()
    .setName('output')
    .setDescription(t('Toggle output format between Embed and Plain Text'))
    .addStringOption((option) =>
        option
            .setName('format')
            .setDescription(t('embed / plain (optional direct switch)'))
            .setRequired(false)
    );

/** /account command definition */
const accountCommand = new SlashCommandBuilder()
    .setName('account')
    .setDescription(t('Select the Antigravity account for the current session'));

/** /logs command definition */
const logsCommand = new SlashCommandBuilder()
    .setName('logs')
    .setDescription(t('View recent bot logs'))
    .addIntegerOption((option) =>
        option
            .setName('lines')
            .setDescription(t('Number of recent log lines (default: 50)'))
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(100)
    )
    .addStringOption((option) =>
        option
            .setName('level')
            .setDescription(t('Filter by log level'))
            .setRequired(false)
            .addChoices(
                { name: 'debug', value: 'debug' },
                { name: 'info', value: 'info' },
                { name: 'warn', value: 'warn' },
                { name: 'error', value: 'error' },
            )
    );

/** /ping command definition */
const pingCommand = new SlashCommandBuilder()
    .setName('ping')
    .setDescription(t('Check bot latency'));

/** /artifacts command definition */
const artifactsCommand = new SlashCommandBuilder()
    .setName('artifacts')
    .setDescription(t('Browse and view generated artifacts from the active session'));

/** /open command definition */
const openCommand = new SlashCommandBuilder()
    .setName('open')
    .setDescription(t('Open and read a file from the workspace'))
    .addStringOption((option) =>
        option
            .setName('filepath')
            .setDescription(t('Absolute or relative path to the file'))
            .setRequired(true)
    );

/** /heartbeat command definition */
const heartbeatCommand = new SlashCommandBuilder()
    .setName('heartbeat')
    .setDescription(t('Configure periodic bot heartbeat notifications'))
    .addSubcommand((sub) =>
        sub
            .setName('on')
            .setDescription(t('Enable periodic heartbeats'))
            .addStringOption((option) =>
                option
                    .setName('interval')
                    .setDescription(t('Interval (e.g., 1d, 1h, 30m - unit required)'))
                    .setRequired(false)
            )
            .addChannelOption((option) =>
                option
                    .setName('channel')
                    .setDescription(t('Target channel for heartbeat (defaults to current)'))
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                    .setRequired(false)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('off')
            .setDescription(t('Disable periodic heartbeats'))
    )
    .addSubcommand((sub) =>
        sub
            .setName('status')
            .setDescription(t('Display current heartbeat config and status'))
    );

/** /schedule command definition */
const scheduleCommand = new SlashCommandBuilder()
    .setName('schedule')
    .setDescription(t('Manage scheduled tasks'))
    .addSubcommand((sub) =>
        sub
            .setName('list')
            .setDescription(t('Show all scheduled tasks with next-run times'))
    )
    .addSubcommand((sub) =>
        sub
            .setName('add')
            .setDescription(t('Register a recurring task'))
            .addStringOption((option) =>
                option
                    .setName('cron')
                    .setDescription(t('Cron expression (e.g. "0 * * * *")'))
                    .setRequired(true)
            )
            .addStringOption((option) =>
                option
                    .setName('prompt')
                    .setDescription(t('Prompt content to execute'))
                    .setRequired(true)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('remove')
            .setDescription(t('Delete a scheduled task'))
            .addIntegerOption((option) =>
                option
                    .setName('id')
                    .setDescription(t('ID of the task to delete'))
                    .setRequired(true)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('clear')
            .setDescription(t('Remove all scheduled tasks and reset task IDs'))
    )
    .addSubcommand((sub) =>
        sub
            .setName('backup')
            .setDescription(t('Export all scheduled tasks as a JSON file attachment'))
    )
    .addSubcommand((sub) =>
        sub
            .setName('restore')
            .setDescription(t('Restore scheduled tasks from a JSON file attachment'))
            .addAttachmentOption((option) =>
                option
                    .setName('file')
                    .setDescription(t('The schedules_backup.json file to import'))
                    .setRequired(true)
            )
    );

/** Array of commands to register */
export const slashCommands = [
    helpCommand,
    modeCommand,
    modelCommand,
    templateCommand,
    stopCommand,
    shutdownCommand,
    screenshotCommand,
    statusCommand,
    autoAcceptCommand,
    projectCommand,
    newCommand,
    chatCommand,
    cleanupCommand,
    joinCommand,
    mirrorCommand,
    accountCommand,
    outputCommand,
    pingCommand,
    logsCommand,
    artifactsCommand,
    openCommand,
    heartbeatCommand,
    scheduleCommand,
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

            // Clear global commands to avoid duplicate suggestions such as old legacy commands.
            // This bot is expected to run primarily in guild scope when guildId is provided.
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: [] }
            );
            logger.info('Cleared global slash commands to prevent duplicate command listings.');
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
