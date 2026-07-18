import * as readline from 'readline';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// @inquirer/select is ESM-only — use native import() that tsc won't rewrite to require()
// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

type SelectFn = typeof import('@inquirer/select')['default'];
let _select: SelectFn | undefined;

/**
 * Lazily loads the inquirer select function dynamically to support ES Module format.
 * @returns Inquirer select prompt function.
 */
async function getSelect(): Promise<SelectFn> {
    if (_select === undefined) {
        const mod = await dynamicImport('@inquirer/select');
        _select = mod.default as SelectFn;
    }
    return _select;
}
import { ConfigLoader } from '../../utils/configLoader';
import type { PersistedConfig } from '../../utils/configLoader';
import { CDP_PORTS } from '../../utils/cdpPorts';
import type { PlatformType } from '../../platform/types';

// ---------------------------------------------------------------------------
// ANSI colors
// ---------------------------------------------------------------------------

const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
} as const;

const SETUP_LOGO = `
${C.cyan}      .           *                  .${C.reset}
${C.cyan}            /\\___/\\            z Z${C.reset}
${C.cyan}    *      ( - . - )____________z${C.reset}          *
${C.cyan}            \\_                __)${C.reset}
${C.cyan}              \\_  \\________/  /${C.reset}          .
${C.cyan}                \\__)      \\__)${C.reset}

     ${C.bold}~ LazyGravity Setup ~${C.reset}
`;

// ---------------------------------------------------------------------------
// Pure validators
// ---------------------------------------------------------------------------

/**
 * Validates if the input string is not empty.
 * @param value String candidate.
 * @returns True if not empty.
 */
function isNonEmpty(value: string): boolean {
    return value.trim().length > 0;
}

/**
 * Validates if the input string represents only digits.
 * @param value String candidate.
 * @returns True if numeric digits.
 */
function isNumericString(value: string): boolean {
    return /^\d+$/.test(value.trim());
}

/**
 * Parses comma-separated user ID values from terminal inputs.
 * @param raw Raw input string.
 * @returns Clean parsed list array.
 */
function parseAllowedUserIds(raw: string): string[] {
    return raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
}

/**
 * Validates raw user IDs string format for terminal prompts.
 * @param raw Input string.
 * @returns Error description string, or null if valid.
 */
function validateAllowedUserIds(raw: string): string | null {
    const ids = parseAllowedUserIds(raw);
    if (ids.length === 0) {
        return 'Please enter at least one user ID.';
    }
    const invalid = ids.find((id) => !isNumericString(id));
    if (invalid) {
        return `Invalid user ID: "${invalid}" — must be a numeric string.`;
    }
    return null;
}

/**
 * Expands home tilde characters into the user's home directory.
 * @param raw Input path string.
 * @returns Expanded absolute path string.
 */
function expandTilde(raw: string): string {
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    return raw;
}

// ---------------------------------------------------------------------------
// Discord API helpers
// ---------------------------------------------------------------------------

/**
 * Representation of Discord API bot info.
 */
interface BotInfo {
    /** Bot application ID. */
    id: string;
    /** Bot username string. */
    username: string;
}

/**
 * Extract Bot ID from a Discord token.
 * Token format: base64(bot_id).timestamp.hmac
 * @param token Raw Discord bot token.
 * @returns Extracted bot/client ID or null.
 */
function extractBotIdFromToken(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        const decoded = Buffer.from(parts[0], 'base64').toString('utf-8');
        return isNumericString(decoded) ? decoded : null;
    } catch {
        return null;
    }
}

/**
 * Verify a Discord bot token via GET /users/@me and return bot info.
 * @param token Bot token to verify.
 * @returns BotInfo metadata object or null.
 */
function verifyToken(token: string): Promise<BotInfo | null> {
    return new Promise((resolve) => {
        const req = https.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bot ${token}` },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    resolve(null);
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    resolve({ id: json.id, username: json.username });
                } catch {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(10000, () => {
            req.destroy();
            resolve(null);
        });
    });
}

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

/**
 * Factory creating readline interface.
 * @returns Readline interface instance.
 */
function createInterface(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

/**
 * Helper to prompt the user with a question.
 * @param rl Readline interface.
 * @param prompt Prompt message.
 * @returns Answer string.
 */
function ask(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer);
        });
    });
}

/**
 * Read a secret value without echoing to the terminal.
 * Falls back to normal readline if raw mode is unavailable (e.g. piped stdin).
 * @param rl Readline interface.
 * @param prompt Prompt message.
 * @returns Secret input string.
 */
function askSecret(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => {
        if (!process.stdin.isTTY) {
            rl.question(prompt, resolve);
            return;
        }

        process.stdout.write(prompt);
        rl.pause();

        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        let input = '';

        const onData = (char: string): void => {
            const code = char.charCodeAt(0);

            if (char === '\r' || char === '\n') {
                stdin.setRawMode(false);
                stdin.removeListener('data', onData);
                process.stdout.write('\n');
                rl.resume();
                resolve(input);
            } else if (code === 127 || code === 8) {
                if (input.length > 0) {
                    input = input.slice(0, -1);
                    process.stdout.write('\b \b');
                }
            } else if (code === 3) {
                stdin.setRawMode(false);
                process.stdout.write('\n');
                process.exit(0);
            } else if (code >= 32) {
                input += char;
                process.stdout.write('*');
            }
        };

        stdin.on('data', onData);
    });
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/**
 * Output helper logging section header.
 * @param title Header title.
 */
function sectionHeader(title: string): void {
    console.log(`\n  ${C.cyan}—${C.reset} ${C.bold}${title}${C.reset}\n`);
}

/**
 * Output helper logging hint information.
 * @param text Hint text.
 */
function hint(text: string): void {
    console.log(`  ${C.dim}${text}${C.reset}`);
}

/**
 * Prints a blank hint line.
 */
function hintBlank(): void {
    console.log('');
}

/**
 * Output helper logging error messages.
 * @param text Error text.
 */
function errMsg(text: string): void {
    console.log(`  ${C.red}${text}${C.reset}\n`);
}

/**
 * Helper building Discord bot OAuth invite URL.
 * @param clientId Bot application client ID.
 * @returns OAuth invite URL.
 */
function buildInviteUrl(clientId: string): string {
    const permissions = '2147485696';
    return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot%20applications.commands`;
}

// ---------------------------------------------------------------------------
// Status detection (pure functions)
// ---------------------------------------------------------------------------

/**
 * Checks if Discord is fully configured.
 * @param p Current configurations.
 * @returns True if configured.
 */
function isDiscordConfigured(p: PersistedConfig): boolean {
    return !!(p.discordToken && p.clientId && p.allowedUserIds && p.allowedUserIds.length > 0);
}

/**
 * Checks if Telegram is fully configured.
 * @param p Current configurations.
 * @returns True if configured.
 */
function isTelegramConfigured(p: PersistedConfig): boolean {
    return !!(p.telegramToken && p.telegramAllowedUserIds && p.telegramAllowedUserIds.length > 0);
}

/**
 * Formats directory path label for displays.
 * @param p Current configurations.
 * @returns Display workspace directory path.
 */
function workspaceLabel(p: PersistedConfig): string {
    return p.workspaceBaseDir ?? (path.join(os.homedir(), 'Code') + ' (default)');
}

/**
 * Validates raw Telegram bot token format.
 * @param token Candidate token.
 * @returns True if format matches telegram credentials regex.
 */
function isValidTelegramTokenFormat(token: string): boolean {
    return /^\d+:[A-Za-z0-9_-]+$/.test(token);
}

/**
 * Recompute platforms from the current persisted state and save.
 * Called after each individual setup flow so Ctrl+C mid-session
 * still leaves a valid platforms array.
 */
function savePlatformsFromState(): void {
    const current = ConfigLoader.readPersisted();
    const platforms: PlatformType[] = [];
    if (isDiscordConfigured(current)) platforms.push('discord');
    if (isTelegramConfigured(current)) platforms.push('telegram');
    ConfigLoader.save({ platforms });
}

/**
 * Add a platform to the persisted platforms list (idempotent).
 * @param platform Target platform.
 */
function addPlatform(platform: PlatformType): void {
    const current = ConfigLoader.readPersisted();
    const platforms = current.platforms ?? [];
    if (!platforms.includes(platform)) {
        ConfigLoader.save({ platforms: [...platforms, platform] });
    }
}

/**
 * Remove a platform from the persisted platforms list (idempotent).
 * Credentials are preserved — only the enabled flag changes.
 * @param platform Target platform.
 */
function removePlatform(platform: PlatformType): void {
    const current = ConfigLoader.readPersisted();
    const platforms = (current.platforms ?? []).filter((p) => p !== platform);
    ConfigLoader.save({ platforms });
}

type PlatformStatus = 'enabled' | 'disabled' | 'not_configured';

/**
 * Determines current platform setup status.
 * @param hasCredentials Credentials configured state.
 * @param platforms Enabled platforms list.
 * @param platform Target platform.
 * @returns Platform status.
 */
function platformStatus(
    hasCredentials: boolean,
    platforms: PlatformType[] | undefined,
    platform: PlatformType,
): PlatformStatus {
    if (!hasCredentials) return 'not_configured';
    if (platforms?.includes(platform)) return 'enabled';
    return 'disabled';
}

/**
 * Formats a stylized status badge string for choices.
 * @param status Target status string.
 * @returns Stylized badge.
 */
function statusBadge(status: PlatformStatus): string {
    switch (status) {
        case 'enabled':
            return `${C.green}[enabled]${C.reset}`;
        case 'disabled':
            return `${C.yellow}[disabled]${C.reset}`;
        case 'not_configured':
            return `${C.dim}[not configured]${C.reset}`;
    }
}

// ---------------------------------------------------------------------------
// Input prompt helpers
// ---------------------------------------------------------------------------

/**
 * Prompts user for Discord bot token and performs online validation.
 * @param rl Readline interface.
 * @returns Token parameters object.
 */
async function promptToken(rl: readline.Interface): Promise<{ token: string; clientId: string; botName: string | null }> {
    while (true) {
        const token = await askSecret(rl, `  ${C.yellow}>${C.reset} `);
        if (!isNonEmpty(token)) {
            errMsg('Token cannot be empty. Please try again.');
            continue;
        }

        const trimmed = token.trim();

        const clientId = extractBotIdFromToken(trimmed);
        if (!clientId) {
            errMsg('Invalid token format. A Discord bot token has 3 dot-separated segments.');
            continue;
        }

        process.stdout.write(`  ${C.dim}Verifying token...${C.reset}`);
        const botInfo = await verifyToken(trimmed);

        if (botInfo) {
            process.stdout.write(`\r  ${C.green}Verified!${C.reset} Bot: ${C.bold}${botInfo.username}${C.reset} (${botInfo.id})\n`);
            return { token: trimmed, clientId: botInfo.id, botName: botInfo.username };
        }

        process.stdout.write(`\r  ${C.yellow}Could not verify online${C.reset} — using extracted ID: ${clientId}\n`);
        return { token: trimmed, clientId, botName: null };
    }
}

/**
 * Prompts user for Discord Guild (Server) ID.
 * @param rl Readline interface.
 * @returns Guild ID or undefined.
 */
async function promptGuildId(rl: readline.Interface): Promise<string | undefined> {
    const raw = await ask(rl, `  ${C.yellow}>${C.reset} `);
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (isNumericString(trimmed)) return trimmed;
    errMsg('Guild ID must be a numeric string. Skipping.');
    return undefined;
}

/**
 * Prompts user for allowed Discord operator user IDs.
 * @param rl Readline interface.
 * @returns Parsed user IDs.
 */
async function promptAllowedUserIds(rl: readline.Interface): Promise<string[]> {
    while (true) {
        const raw = await ask(rl, `  ${C.yellow}>${C.reset} `);
        const error = validateAllowedUserIds(raw);
        if (error === null) {
            return parseAllowedUserIds(raw);
        }
        errMsg(`${error}`);
    }
}

/**
 * Prompts user for Workspace base directory path.
 * @param rl Readline interface.
 * @returns Absolute workspace directory path.
 */
async function promptWorkspaceDir(rl: readline.Interface): Promise<string> {
    const defaultDir = path.join(os.homedir(), 'Code');

    while (true) {
        const raw = await ask(rl, `  ${C.yellow}>${C.reset} [${C.dim}${defaultDir}${C.reset}] `);
        const dir = expandTilde(raw.trim().length > 0 ? raw.trim() : defaultDir);
        const resolved = path.resolve(dir);

        if (fs.existsSync(resolved)) {
            return resolved;
        }

        const answer = await ask(rl, `  ${C.yellow}"${resolved}" does not exist. Create it? (y/n):${C.reset} `);
        if (answer.trim().toLowerCase() === 'y') {
            fs.mkdirSync(resolved, { recursive: true });
            return resolved;
        }
        errMsg('Please enter an existing directory.');
    }
}

// ---------------------------------------------------------------------------
// Platform sub-menu (enable / reconfigure / disable / back)
// ---------------------------------------------------------------------------

type PlatformAction = 'enable' | 'reconfigure' | 'disable' | 'back';

/**
 * Platform sub-menu wizard.
 * @param rl Readline interface.
 * @param platformName Target platform name.
 * @param status Current status.
 * @returns Target action.
 */
async function platformSubMenu(
    rl: readline.Interface,
    platformName: string,
    status: PlatformStatus,
): Promise<PlatformAction> {
    const select = await getSelect();

    const choices: Array<{ name: string; value: PlatformAction }> =
        status === 'disabled'
            ? [
                  { name: 'Enable', value: 'enable' as const },
                  { name: 'Reconfigure', value: 'reconfigure' as const },
                  { name: 'Back', value: 'back' as const },
              ]
            : [
                  { name: 'Reconfigure', value: 'reconfigure' as const },
                  { name: 'Disable', value: 'disable' as const },
                  { name: 'Back', value: 'back' as const },
              ];

    rl.pause();
    try {
        return await select<PlatformAction>({
            message: `${platformName}:`,
            choices,
        });
    } finally {
        rl.resume();
    }
}

// ---------------------------------------------------------------------------
// Individual setup flows (each saves immediately)
// ---------------------------------------------------------------------------

/**
 * Runs Discord configuration setup questions sequence.
 * @param rl Readline interface.
 */
async function runDiscordSetup(rl: readline.Interface): Promise<void> {
    sectionHeader('Discord Bot Token');
    hint('1. Go to https://discord.com/developers/applications and log in');
    hint('2. Click "New Application" (top-right), enter a name (e.g. LazyGravity), and create it');
    hint('3. Go to the "Bot" tab on the left sidebar');
    hint('4. Click "Reset Token" to generate and copy the token');
    hint(`5. Scroll down to ${C.bold}"Privileged Gateway Intents"${C.dim} and enable ALL of:`);
    hint(`   ${C.cyan}PRESENCE INTENT${C.dim}`);
    hint(`   ${C.cyan}SERVER MEMBERS INTENT${C.dim}`);
    hint(`   ${C.cyan}MESSAGE CONTENT INTENT${C.dim} ${C.yellow}(required — bot cannot read messages without this)${C.dim}`);
    hint(`6. Click ${C.bold}"Save Changes"${C.dim} at the bottom (Warning banner)`);
    hintBlank();
    const { token: discordToken, clientId } = await promptToken(rl);
    console.log('');

    sectionHeader('Guild (Server) ID');
    hint('This registers slash commands instantly to your server.');
    hint('1. Open Discord Settings > Advanced > enable "Developer Mode"');
    hint('2. Right-click your server icon > "Copy Server ID"');
    hint(`${C.yellow}Press Enter to skip${C.dim} (commands will register globally, may take ~1 hour)`);
    hintBlank();
    const guildId = await promptGuildId(rl);
    console.log('');

    sectionHeader('Allowed Discord User IDs');
    hint('Only these users can send commands to the bot.');
    hint('1. In Discord, right-click your own profile icon');
    hint('2. Click "Copy User ID" (requires Developer Mode from step above)');
    hint('Multiple IDs: separate with commas (e.g. 123456,789012)');
    hintBlank();
    const allowedUserIds = await promptAllowedUserIds(rl);
    console.log('');

    ConfigLoader.save({ discordToken, clientId, guildId, allowedUserIds });
    savePlatformsFromState();

    const inviteUrl = buildInviteUrl(clientId);
    console.log(`  ${C.green}Discord saved!${C.reset}`);
    console.log(`  ${C.dim}Invite URL:${C.reset} ${inviteUrl}\n`);
}

/**
 * Runs Telegram configuration setup questions sequence.
 * @param rl Readline interface.
 */
async function runTelegramSetup(rl: readline.Interface): Promise<void> {
    sectionHeader('Telegram Bot Token');
    hint('1. Open Telegram and message @BotFather');
    hint('2. Send /newbot and follow the prompts to create a bot');
    hint('3. Copy the token BotFather gives you');
    hintBlank();

    let telegramToken = '';
    while (true) {
        const raw = await askSecret(rl, `  ${C.yellow}>${C.reset} `);
        if (!isNonEmpty(raw)) {
            errMsg('Token cannot be empty. Please try again.');
            continue;
        }
        const trimmed = raw.trim();
        if (!isValidTelegramTokenFormat(trimmed)) {
            errMsg('Invalid token format. Telegram tokens look like: 123456:ABCdef...');
            continue;
        }
        telegramToken = trimmed;
        break;
    }
    console.log('');

    sectionHeader('Allowed Telegram User IDs');
    hint('Only these users can send messages to the bot.');
    hint('To find your ID: message @userinfobot on Telegram');
    hint('Multiple IDs: separate with commas (e.g. 123456,789012)');
    hintBlank();
    const telegramAllowedUserIds = await promptAllowedUserIds(rl);
    console.log('');

    ConfigLoader.save({ telegramToken, telegramAllowedUserIds });
    savePlatformsFromState();
    console.log(`  ${C.green}Telegram saved!${C.reset}\n`);
}

/**
 * Runs Workspace directory configuration setup questions sequence.
 * @param rl Readline interface.
 */
async function runWorkspaceSetup(rl: readline.Interface): Promise<void> {
    sectionHeader('Workspace Base Directory');
    hint('The parent directory where your coding projects live.');
    hint('LazyGravity will scan subdirectories as workspaces.');
    hintBlank();
    const workspaceBaseDir = await promptWorkspaceDir(rl);
    console.log('');

    ConfigLoader.save({ workspaceBaseDir });
    console.log(`  ${C.green}Workspace saved!${C.reset}\n`);
}

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

/**
 * Primary command runner function launched during setup interactive prompts loop.
 */
export async function setupAction(): Promise<void> {
    const rl = createInterface();

    try {
        console.log(SETUP_LOGO);

        while (true) {
            const config = ConfigLoader.readPersisted();
            const discordSt = platformStatus(isDiscordConfigured(config), config.platforms, 'discord');
            const telegramSt = platformStatus(isTelegramConfigured(config), config.platforms, 'telegram');
            const wsLabel = `${C.dim}${workspaceLabel(config)}${C.reset}`;

            const select = await getSelect();
            rl.pause();
            const choice = await select({
                message: 'Configure:',
                choices: [
                    { name: `Discord                ${statusBadge(discordSt)}`, value: 'discord' as const },
                    { name: `Telegram               ${statusBadge(telegramSt)}`, value: 'telegram' as const },
                    { name: `Workspace Directory    ${wsLabel}`, value: 'workspace' as const },
                    { name: `Done — save & exit`, value: 'done' as const },
                ],
            });
            rl.resume();

            switch (choice) {
                case 'discord':
                    if (discordSt === 'not_configured') {
                        await runDiscordSetup(rl);
                    } else {
                        const action = await platformSubMenu(rl, 'Discord', discordSt);
                        switch (action) {
                            case 'enable':
                                addPlatform('discord');
                                console.log(`  ${C.green}Discord enabled.${C.reset}\n`);
                                break;
                            case 'reconfigure':
                                await runDiscordSetup(rl);
                                break;
                            case 'disable':
                                removePlatform('discord');
                                console.log(`  ${C.yellow}Discord disabled.${C.reset} Credentials kept.\n`);
                                break;
                            case 'back':
                                break;
                        }
                    }
                    break;
                case 'telegram':
                    if (telegramSt === 'not_configured') {
                        await runTelegramSetup(rl);
                    } else {
                        const action = await platformSubMenu(rl, 'Telegram', telegramSt);
                        switch (action) {
                            case 'enable':
                                addPlatform('telegram');
                                console.log(`  ${C.green}Telegram enabled.${C.reset}\n`);
                                break;
                            case 'reconfigure':
                                await runTelegramSetup(rl);
                                break;
                            case 'disable':
                                removePlatform('telegram');
                                console.log(`  ${C.yellow}Telegram disabled.${C.reset} Credentials kept.\n`);
                                break;
                            case 'back':
                                break;
                        }
                    }
                    break;
                case 'workspace':
                    await runWorkspaceSetup(rl);
                    break;
                case 'done': {
                    const finalConfig = ConfigLoader.readPersisted();
                    const platforms = finalConfig.platforms ?? [];

                    if (platforms.length === 0) {
                        errMsg('No platforms enabled yet. Please enable at least one platform.');
                        break;
                    }

                    const configPath = ConfigLoader.getConfigFilePath();
                    console.log(`\n  ${C.green}Setup complete!${C.reset} Platforms: ${platforms.join(', ')}\n`);
                    console.log(`  ${C.dim}Saved to${C.reset} ${configPath}\n`);

                    if (platforms.includes('discord') && finalConfig.clientId) {
                        const inviteUrl = buildInviteUrl(finalConfig.clientId);
                        console.log(`  ${C.cyan}Discord:${C.reset}`);
                        console.log(`  ${C.bold}1.${C.reset} ${C.yellow}Verify Privileged Gateway Intents are enabled${C.reset} in the Bot tab:`);
                        console.log(`     ${C.dim}Required: PRESENCE INTENT, SERVER MEMBERS INTENT, MESSAGE CONTENT INTENT${C.reset}`);
                        console.log(`     https://discord.com/developers/applications/${finalConfig.clientId}/bot\n`);
                        console.log(`  ${C.bold}2.${C.reset} Add the bot to your server:`);
                        console.log(`     ${inviteUrl}\n`);
                    }

                    if (platforms.includes('telegram')) {
                        console.log(`  ${C.cyan}Telegram:${C.reset}`);
                        console.log(`  ${C.dim}Your Telegram bot is ready. Message it on Telegram after starting.${C.reset}\n`);
                    }

                    console.log(`  ${C.cyan}Start:${C.reset}`);
                    console.log(`  ${C.bold}1.${C.reset} Open Antigravity with CDP enabled:`);
                    console.log(`     ${C.green}lazy-gravity open${C.reset}`);
                    console.log(`     ${C.dim}(auto-selects an available port from: ${CDP_PORTS.join(', ')})${C.reset}\n`);
                    console.log(`  ${C.bold}2.${C.reset} Run: ${C.green}lazy-gravity start${C.reset}\n`);

                    return;
                }
            }
        }
    } finally {
        rl.close();
    }
}
