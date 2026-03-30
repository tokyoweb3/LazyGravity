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

async function getSelect(): Promise<SelectFn> {
    if (_select === undefined) {
        const mod = await dynamicImport('@inquirer/select');
        _select = mod.default as SelectFn;
    }
    return _select;
}
import { ConfigLoader } from '../../utils/configLoader';
import type { PersistedConfig } from '../../utils/configLoader';
import type { AppConfig } from '../../utils/config';
import { CDP_PORTS } from '../../utils/cdpPorts';
import {
    normalizeAntigravityAccounts,
    parseAntigravityAccounts,
    serializeAntigravityAccounts,
} from '../../utils/cdpPorts';
import type { PlatformType } from '../../platform/types';
import {
    discoverAntigravityAccounts,
    hasCockpitSettings,
} from '../../services/antigravityAccountDiscovery';

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

function isNonEmpty(value: string): boolean {
    return value.trim().length > 0;
}

function isNumericString(value: string): boolean {
    return /^\d+$/.test(value.trim());
}

function parseAllowedUserIds(raw: string): string[] {
    return raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
}

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

function expandTilde(raw: string): string {
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    return raw;
}

// ---------------------------------------------------------------------------
// Discord API helpers
// ---------------------------------------------------------------------------

interface BotInfo {
    id: string;
    username: string;
}

/**
 * Extract Bot ID from a Discord token.
 * Token format: base64(bot_id).timestamp.hmac
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

function createInterface(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

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

function sectionHeader(title: string): void {
    console.log(`\n  ${C.cyan}—${C.reset} ${C.bold}${title}${C.reset}\n`);
}

function hint(text: string): void {
    console.log(`  ${C.dim}${text}${C.reset}`);
}

function hintBlank(): void {
    console.log('');
}

function errMsg(text: string): void {
    console.log(`  ${C.red}${text}${C.reset}\n`);
}

function buildInviteUrl(clientId: string): string {
    const permissions = '2147485696';
    return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot%20applications.commands`;
}

function renderSetupScreen(envFileStatus?: string): void {
    if (process.stdout.isTTY) {
        console.clear();
    }
    console.log(SETUP_LOGO);
    if (envFileStatus) {
        console.log(`  ${C.dim}.env: ${envFileStatus}${C.reset}\n`);
    }
}

function renderSetupSubMenu(envFileStatus: string | undefined, title: string, status: string): void {
    renderSetupScreen(envFileStatus);
    console.log(`✔ ${C.cyan}${title}${C.reset} ${status}`);
}

// ---------------------------------------------------------------------------
// Status detection (pure functions)
// ---------------------------------------------------------------------------

function isDiscordConfigured(p: PersistedConfig): boolean {
    return !!(p.discordToken && p.clientId && p.allowedUserIds && p.allowedUserIds.length > 0);
}

function isTelegramConfigured(p: PersistedConfig): boolean {
    return !!(p.telegramToken && p.telegramAllowedUserIds && p.telegramAllowedUserIds.length > 0);
}

function resolveWorkspaceLabel(p: PersistedConfig): { label: string; source: ConfigSource } {
    const envValue = process.env.WORKSPACE_BASE_DIR?.trim();
    if (envValue) {
        return { label: expandTilde(envValue), source: 'env' };
    }

    if (p.workspaceBaseDir && p.workspaceBaseDir.trim().length > 0) {
        return { label: p.workspaceBaseDir, source: 'persisted' };
    }

    return { label: path.join(os.homedir(), 'Code') + ' (default)', source: 'none' };
}

function getPersistedAntigravityAccounts(p: PersistedConfig) {
    if (typeof p.antigravityAccounts === 'string') {
        return parseAntigravityAccounts(p.antigravityAccounts);
    }
    return normalizeAntigravityAccounts(p.antigravityAccounts);
}

function isValidTelegramTokenFormat(token: string): boolean {
    return /^\d+:[A-Za-z0-9_-]+$/.test(token);
}

function savePlatformsFromState(current: PersistedConfig): void {
    const platforms: PlatformType[] = [];
    if (isDiscordConfigured(current)) platforms.push('discord');
    if (isTelegramConfigured(current)) platforms.push('telegram');
    current.platforms = platforms;
}

function addPlatform(current: PersistedConfig, platform: PlatformType): void {
    const platforms = current.platforms ?? [];
    if (!platforms.includes(platform)) {
        current.platforms = [...platforms, platform];
    }
}

function removePlatform(current: PersistedConfig, platform: PlatformType): void {
    current.platforms = (current.platforms ?? []).filter((p) => p !== platform);
}

type PlatformStatus = 'enabled' | 'disabled' | 'not_configured';
type ConfigSource = 'env' | 'persisted' | 'both' | 'none';

function resolvePlatformsForDisplay(persisted: PersistedConfig): PlatformType[] {
    const envValue = process.env.PLATFORMS;
    if (envValue) {
        const parsed = envValue
            .split(',')
            .map((p) => p.trim().toLowerCase())
            .filter((p): p is PlatformType => p === 'discord' || p === 'telegram');
        if (parsed.length > 0) return parsed;
    }
    if (persisted.platforms && persisted.platforms.length > 0) {
        return persisted.platforms;
    }
    return ['discord'];
}

function resolveConfigSource(envConfigured: boolean, persistedConfigured: boolean): ConfigSource {
    if (envConfigured && persistedConfigured) return 'both';
    if (envConfigured) return 'env';
    if (persistedConfigured) return 'persisted';
    return 'none';
}

function formatMenuLabel(left: string, right: string): string {
    return `${left.padEnd(22, ' ')} ${right}`;
}

function isDiscordConfiguredFromEnv(): boolean {
    return !!(process.env.DISCORD_BOT_TOKEN && process.env.CLIENT_ID && process.env.ALLOWED_USER_IDS);
}

function isTelegramConfiguredFromEnv(): boolean {
    return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ALLOWED_USER_IDS);
}

function getMultiInstanceRawValue(p: PersistedConfig): { value: string; source: ConfigSource } {
    if (typeof p.antigravityAccounts === 'string' && p.antigravityAccounts.trim().length > 0) {
        return { value: p.antigravityAccounts.trim(), source: 'persisted' };
    }

    if (Array.isArray(p.antigravityAccounts) && p.antigravityAccounts.length > 0) {
        return { value: serializeAntigravityAccounts(p.antigravityAccounts), source: 'persisted' };
    }

    const envValue = process.env.ANTIGRAVITY_ACCOUNTS?.trim() ?? '';
    if (envValue) {
        return { value: envValue, source: 'env' };
    }

    return { value: '', source: 'none' };
}

function abbreviateUserDataDir(userDataDir: string | undefined): string {
    const trimmed = (userDataDir ?? '').trim();
    if (!trimmed) {
        return '';
    }

    if (trimmed.length <= 16) {
        return trimmed;
    }

    return `...${trimmed.slice(-12)}`;
}

function formatMultiInstanceSummary(rawValue: string): string {
    const accounts = parseAntigravityAccounts(rawValue);
    if (accounts.length === 0) {
        return '[not configured]';
    }

    const preview = accounts
        .slice(0, 3)
        .map((account) => {
            const suffix = abbreviateUserDataDir(account.userDataDir);
            return suffix
                ? `${account.name}:${account.cdpPort}@${suffix}`
                : `${account.name}:${account.cdpPort}`;
        })
        .join(',');

    const remainder = accounts.length > 3 ? ',...' : '';
    const label = accounts.length === 1 ? 'instance' : 'instances';
    return `${accounts.length} ${label} => ${preview}${remainder}`;
}

function platformStatus(
    hasCredentials: boolean,
    platforms: PlatformType[] | undefined,
    platform: PlatformType,
): PlatformStatus {
    if (!hasCredentials) return 'not_configured';
    if (platforms?.includes(platform)) return 'enabled';
    return 'disabled';
}

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

async function promptGuildId(rl: readline.Interface): Promise<string | undefined> {
    const raw = await ask(rl, `  ${C.yellow}>${C.reset} `);
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (isNumericString(trimmed)) return trimmed;
    errMsg('Guild ID must be a numeric string. Skipping.');
    return undefined;
}

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

async function promptWorkspaceDir(rl: readline.Interface, current: PersistedConfig): Promise<string> {
    const configured = resolveWorkspaceLabel(current).label;
    const defaultDir = configured.endsWith(' (default)')
        ? path.join(os.homedir(), 'Code')
        : configured;

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

async function confirm(
    rl: readline.Interface,
    prompt: string,
    defaultAnswer: 'y' | 'n' = 'y',
): Promise<boolean> {
    while (true) {
        const suffix = defaultAnswer === 'y' ? ' [Y/n]' : ' [y/N]';
        const raw = (await ask(rl, `  ${C.yellow}${prompt}${suffix}:${C.reset} `)).trim().toLowerCase();
        if (!raw) return defaultAnswer === 'y';
        if (raw === 'y' || raw === 'yes') return true;
        if (raw === 'n' || raw === 'no') return false;
        errMsg('Please answer y or n.');
    }
}

function validateAntigravityAccountsInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }

    const accounts = parseAntigravityAccounts(trimmed);
    if (accounts.length === 0) {
        return 'Invalid format. Use comma-separated entries like default:9222@/path/to/profile';
    }

    const seenNames = new Set<string>();
    const seenPorts = new Set<number>();

    for (const account of accounts) {
        if (seenNames.has(account.name)) {
            return `Duplicate account name: "${account.name}".`;
        }
        seenNames.add(account.name);

        if (seenPorts.has(account.cdpPort)) {
            return `Duplicate CDP port: ${account.cdpPort}.`;
        }
        seenPorts.add(account.cdpPort);
    }

    return null;
}

function findMissingUserDataDirs(raw: string): string[] {
    return parseAntigravityAccounts(raw)
        .map((account) => account.userDataDir?.trim() ?? '')
        .filter((dir): dir is string => dir.length > 0)
        .filter((dir) => !fs.existsSync(dir));
}

function saveAntigravityAccountsToState(current: PersistedConfig, raw: string): void {
    const trimmed = raw.trim();
    current.antigravityAccounts = trimmed
        ? parseAntigravityAccounts(trimmed)
        : undefined;
}

function savePersistedConfig(config: PersistedConfig): void {
    ConfigLoader.save({
        discordToken: config.discordToken,
        clientId: config.clientId,
        guildId: config.guildId,
        allowedUserIds: config.allowedUserIds,
        workspaceBaseDir: config.workspaceBaseDir,
        autoApproveFileEdits: config.autoApproveFileEdits,
        logLevel: config.logLevel,
        extractionMode: config.extractionMode,
        telegramToken: config.telegramToken,
        telegramAllowedUserIds: config.telegramAllowedUserIds,
        platforms: config.platforms,
        antigravityAccounts: config.antigravityAccounts,
    });
}

function toWorkingConfig(): PersistedConfig {
    const loaded: AppConfig = ConfigLoader.load();

    return {
        discordToken: loaded.discordToken,
        clientId: loaded.clientId,
        guildId: loaded.guildId,
        allowedUserIds: loaded.allowedUserIds,
        workspaceBaseDir: loaded.workspaceBaseDir,
        autoApproveFileEdits: loaded.autoApproveFileEdits,
        logLevel: loaded.logLevel,
        extractionMode: loaded.extractionMode,
        telegramToken: loaded.telegramToken,
        telegramAllowedUserIds: loaded.telegramAllowedUserIds,
        platforms: loaded.platforms,
        antigravityAccounts: loaded.antigravityAccounts,
    };
}

// ---------------------------------------------------------------------------
// Platform sub-menu (enable / reconfigure / disable / back)
// ---------------------------------------------------------------------------

type PlatformAction = 'configure' | 'enable' | 'reconfigure' | 'disable' | 'back';

async function platformSubMenu(
    rl: readline.Interface,
    envFileStatus: string | undefined,
    platformName: string,
    platformStatusLabel: string,
    status: PlatformStatus,
): Promise<PlatformAction> {
    const select = await getSelect();

    const choices: Array<{ name: string; value: PlatformAction }> =
        status === 'not_configured'
            ? [
                  { name: 'Configure', value: 'configure' as const },
                  { name: 'Back', value: 'back' as const },
              ]
            : status === 'disabled'
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
        renderSetupSubMenu(envFileStatus, platformName, platformStatusLabel);
        return await select<PlatformAction>({
            message: `${platformName}:`,
            choices,
        });
    } finally {
        rl.resume();
    }
}

// ---------------------------------------------------------------------------
// Individual setup flows
// ---------------------------------------------------------------------------

async function runDiscordSetup(rl: readline.Interface, current: PersistedConfig): Promise<void> {
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

    current.discordToken = discordToken;
    current.clientId = clientId;
    current.guildId = guildId;
    current.allowedUserIds = allowedUserIds;
    savePlatformsFromState(current);

    const inviteUrl = buildInviteUrl(clientId);
    console.log(`  ${C.green}Discord saved!${C.reset}`);
    console.log(`  ${C.dim}Invite URL:${C.reset} ${inviteUrl}\n`);
}

async function runTelegramSetup(rl: readline.Interface, current: PersistedConfig): Promise<void> {
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

    current.telegramToken = telegramToken;
    current.telegramAllowedUserIds = telegramAllowedUserIds;
    savePlatformsFromState(current);
    console.log(`  ${C.green}Telegram saved!${C.reset}\n`);
}

async function runWorkspaceSetup(
    rl: readline.Interface,
    envFileStatus: string | undefined,
    workspaceStatusLabel: string,
    current: PersistedConfig,
): Promise<void> {
    renderSetupSubMenu(envFileStatus, 'Workspace Directory', workspaceStatusLabel);
    sectionHeader('Workspace Base Directory');
    hint('The parent directory where your coding projects live.');
    hint('LazyGravity will scan subdirectories as workspaces.');
    hintBlank();
    const workspaceBaseDir = await promptWorkspaceDir(rl, current);
    console.log('');

    current.workspaceBaseDir = workspaceBaseDir;
    console.log(`  ${C.green}Workspace saved!${C.reset}\n`);
}

type AntigravitySetupAction = 'auto_detect' | 'manual' | 'clear' | 'back';
type WorkspaceSetupAction = 'reconfigure' | 'back';

async function antigravitySubMenu(): Promise<AntigravitySetupAction> {
    const select = await getSelect();
    return select<AntigravitySetupAction>({
        message: 'AG Multi-instance:',
        choices: [
            { name: 'Auto-detect from cockpit-tools / running Antigravity', value: 'auto_detect' },
            { name: 'Enter manually (name:port@path)', value: 'manual' },
            { name: 'Clear saved Antigravity instances', value: 'clear' },
            { name: 'Back', value: 'back' },
        ],
    });
}

async function workspaceSubMenu(): Promise<WorkspaceSetupAction> {
    const select = await getSelect();
    return select<WorkspaceSetupAction>({
        message: 'Workspace Directory:',
        choices: [
            { name: 'Reconfigure', value: 'reconfigure' },
            { name: 'Back', value: 'back' },
        ],
    });
}

async function runManualAntigravitySetup(rl: readline.Interface, current: PersistedConfig): Promise<void> {
    sectionHeader('AG Multi-instance');
    hint('Format: name:cdpPort@user-data-dir');
    hint('Examples:');
    hint('  default:9222');
    hint('  work:9333@/Users/you/Library/Application Support/Antigravity/work');
    hint('Multiple instances: separate with commas');
    hintBlank();

    const existing = typeof current.antigravityAccounts === 'string'
        ? current.antigravityAccounts
        : serializeAntigravityAccounts(current.antigravityAccounts);
    const raw = await ask(
        rl,
        `  ${C.yellow}>${C.reset} [${C.dim}${existing || 'default:9222'}${C.reset}] `,
    );
    const nextValue = raw.trim() || existing || 'default:9222';

    const validationError = validateAntigravityAccountsInput(nextValue);
    if (validationError) {
        errMsg(validationError);
        return;
    }

    const missingDirs = findMissingUserDataDirs(nextValue);
    if (missingDirs.length > 0) {
        console.log(`  ${C.yellow}These user-data-dir paths do not exist:${C.reset}`);
        for (const dir of missingDirs) {
            console.log(`    ${dir}`);
        }
        console.log('');
        const keep = await confirm(rl, 'Save them anyway', 'n');
        if (!keep) {
            console.log('');
            return;
        }
    }

    saveAntigravityAccountsToState(current, nextValue);
    console.log(`\n  ${C.green}Antigravity instances saved!${C.reset}\n`);
}

async function runAutoDetectAntigravitySetup(rl: readline.Interface, current: PersistedConfig): Promise<void> {
    sectionHeader('Detect Antigravity Instances');
    hint('Scanning cockpit-tools app data and running Antigravity processes...');
    hintBlank();

    const existingAccounts = getPersistedAntigravityAccounts(current);
    const result = await discoverAntigravityAccounts(existingAccounts);
    const discovered = result.accounts;

    if (discovered.length === 0) {
        errMsg('No Antigravity instances were detected.');
        return;
    }

    console.log(`  ${C.cyan}Detected:${C.reset}`);
    for (const account of discovered) {
        const userDataDir = account.userDataDir ?? '(not detected)';
        console.log(`  - ${account.name}: ${account.cdpPort}@${userDataDir}`);
        const source = (account as { source?: string }).source;
        if (source) {
            console.log(`    ${C.dim}${source}${C.reset}`);
        }
    }
    console.log('');

    if (result.warnings.length > 0) {
        console.log(`  ${C.yellow}Warnings:${C.reset}`);
        for (const warning of result.warnings) {
            console.log(`  - ${warning}`);
        }
        console.log('');
    }

    const missingDirs = discovered
        .map((account) => account.userDataDir?.trim() ?? '')
        .filter((dir): dir is string => dir.length > 0)
        .filter((dir) => !fs.existsSync(dir));

    if (missingDirs.length > 0) {
        console.log(`  ${C.yellow}Warning:${C.reset} some detected user-data-dir paths do not exist.`);
        for (const dir of missingDirs) {
            console.log(`    ${dir}`);
        }
        console.log('');
    }

    const shouldImport = await confirm(rl, 'Import these instances into setup', 'y');
    if (!shouldImport) {
        console.log('');
        return;
    }

    saveAntigravityAccountsToState(current, serializeAntigravityAccounts(discovered));
    console.log(`\n  ${C.green}Imported ${discovered.length} Antigravity instance(s).${C.reset}\n`);
}

async function runAntigravitySetup(
    rl: readline.Interface,
    envFileStatus: string | undefined,
    current: PersistedConfig,
): Promise<void> {
    if (!hasCockpitSettings()) {
        sectionHeader('AG Multi-instance');
        hint('Cockpit Tools was not detected on this machine.');
        hint('Install it first, then configure your Antigravity multi-instances there.');
        hint('Download: https://github.com/jlcodes99/cockpit-tools/releases');
        hintBlank();
        return;
    }

    rl.pause();
    renderSetupSubMenu(envFileStatus, 'AG Multi-instance', '');
    const action = await antigravitySubMenu();
    rl.resume();

    switch (action) {
        case 'auto_detect':
            await runAutoDetectAntigravitySetup(rl, current);
            return;
        case 'manual':
            await runManualAntigravitySetup(rl, current);
            return;
        case 'clear':
            if (await confirm(rl, 'Clear saved Antigravity instances', 'n')) {
                current.antigravityAccounts = undefined;
                console.log(`\n  ${C.green}Cleared saved Antigravity instances.${C.reset}\n`);
            } else {
                console.log('');
            }
            return;
        case 'back':
            return;
    }
}

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

export async function setupAction(): Promise<void> {
    const rl = createInterface();
    const envFilePath = path.resolve('.env');
    const envFileStatus = fs.existsSync(envFilePath) ? envFilePath : undefined;
    const workingConfig: PersistedConfig = toWorkingConfig();

    try {
        while (true) {
            renderSetupScreen(envFileStatus);
            const platforms = resolvePlatformsForDisplay(workingConfig);
            const discordSource = resolveConfigSource(isDiscordConfiguredFromEnv(), isDiscordConfigured(workingConfig));
            const telegramSource = resolveConfigSource(isTelegramConfiguredFromEnv(), isTelegramConfigured(workingConfig));
            const multiInstance = getMultiInstanceRawValue(workingConfig);
            const discordSt = platformStatus(discordSource !== 'none', platforms, 'discord');
            const telegramSt = platformStatus(telegramSource !== 'none', platforms, 'telegram');
            const workspace = resolveWorkspaceLabel(workingConfig);
            const wsLabel = `${C.dim}${workspace.label}${C.reset}`;
            const multiInstanceLabel = multiInstance.value
                ? `${C.dim}${formatMultiInstanceSummary(multiInstance.value)}${C.reset}`
                : `${C.dim}[not configured]${C.reset}`;
            const discordRight = `${statusBadge(discordSt)}`;
            const telegramRight = `${statusBadge(telegramSt)}`;
            const multiInstanceRight = `${multiInstanceLabel}`;

            const select = await getSelect();
            rl.pause();
            const choice = await select({
                message: 'Configure:',
                choices: [
                    { name: formatMenuLabel('Discord', discordRight), value: 'discord' as const },
                    { name: formatMenuLabel('Telegram', telegramRight), value: 'telegram' as const },
                    { name: formatMenuLabel('Workspace Directory', wsLabel), value: 'workspace' as const },
                    { name: formatMenuLabel('AG Multi-instance', multiInstanceRight), value: 'antigravity' as const },
                    { name: `Done — save & exit`, value: 'done' as const },
                    { name: `Exit without save`, value: 'cancel' as const },
                ],
            });
            rl.resume();

            switch (choice) {
                case 'discord':
                    {
                        const action = await platformSubMenu(rl, envFileStatus, 'Discord', discordRight, discordSt);
                        switch (action) {
                            case 'configure':
                            case 'reconfigure':
                                await runDiscordSetup(rl, workingConfig);
                                break;
                            case 'enable':
                                addPlatform(workingConfig, 'discord');
                                console.log(`  ${C.green}Discord enabled.${C.reset}\n`);
                                break;
                            case 'disable':
                                removePlatform(workingConfig, 'discord');
                                console.log(`  ${C.yellow}Discord disabled.${C.reset} Credentials kept.\n`);
                                break;
                            case 'back':
                                break;
                        }
                    }
                    break;
                case 'telegram':
                    {
                        const action = await platformSubMenu(rl, envFileStatus, 'Telegram', telegramRight, telegramSt);
                        switch (action) {
                            case 'configure':
                            case 'reconfigure':
                                await runTelegramSetup(rl, workingConfig);
                                break;
                            case 'enable':
                                addPlatform(workingConfig, 'telegram');
                                console.log(`  ${C.green}Telegram enabled.${C.reset}\n`);
                                break;
                            case 'disable':
                                removePlatform(workingConfig, 'telegram');
                                console.log(`  ${C.yellow}Telegram disabled.${C.reset} Credentials kept.\n`);
                                break;
                            case 'back':
                                break;
                        }
                    }
                    break;
                case 'workspace':
                    rl.pause();
                    renderSetupSubMenu(envFileStatus, 'Workspace Directory', wsLabel);
                    const workspaceAction = await workspaceSubMenu();
                    rl.resume();
                    if (workspaceAction === 'reconfigure') {
                        await runWorkspaceSetup(rl, envFileStatus, wsLabel, workingConfig);
                    }
                    break;
                case 'antigravity':
                    await runAntigravitySetup(rl, envFileStatus, workingConfig);
                    break;
                case 'done': {
                    const platforms = workingConfig.platforms ?? [];

                    if (platforms.length === 0) {
                        errMsg('No platforms enabled yet. Please enable at least one platform.');
                        break;
                    }

                    savePersistedConfig(workingConfig);
                    const configPath = ConfigLoader.getConfigFilePath();
                    console.log(`\n  ${C.green}Setup complete!${C.reset} Platforms: ${platforms.join(', ')}\n`);
                    console.log(`  ${C.dim}Saved to${C.reset} ${configPath}\n`);
                    if (envFileStatus) {
                        console.log(`  ${C.dim}Detected .env at${C.reset} ${envFileStatus}\n`);
                        console.log(`  ${C.dim}Values shown in setup may come from .env, but setup saves to config.json.${C.reset}\n`);
                    }

                    if (platforms.includes('discord') && workingConfig.clientId) {
                        const inviteUrl = buildInviteUrl(workingConfig.clientId);
                        console.log(`  ${C.cyan}Discord:${C.reset}`);
                        console.log(`  ${C.bold}1.${C.reset} ${C.yellow}Verify Privileged Gateway Intents are enabled${C.reset} in the Bot tab:`);
                        console.log(`     ${C.dim}Required: PRESENCE INTENT, SERVER MEMBERS INTENT, MESSAGE CONTENT INTENT${C.reset}`);
                        console.log(`     https://discord.com/developers/applications/${workingConfig.clientId}/bot\n`);
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
                case 'cancel':
                    return;
            }
        }
    } finally {
        rl.close();
    }
}
