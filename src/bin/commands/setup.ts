import * as readline from 'readline';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigLoader } from '../../utils/configLoader';
import { CDP_PORTS } from '../../utils/cdpPorts';

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

function stepHeader(step: number, total: number, title: string): void {
    console.log(`  ${C.cyan}[Step ${step}/${total}]${C.reset} ${C.bold}${title}${C.reset}`);
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

// ---------------------------------------------------------------------------
// Setup steps
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 4;

interface SetupResult {
    discordToken: string;
    clientId: string;
    guildId?: string;
    allowedUserIds: string[];
    workspaceBaseDir: string;
}

interface TokenResult {
    token: string;
    clientId: string;
    botName: string | null;
}

async function promptToken(rl: readline.Interface): Promise<TokenResult> {
    while (true) {
        const token = await askSecret(rl, `  ${C.yellow}>${C.reset} `);
        if (!isNonEmpty(token)) {
            errMsg('Token cannot be empty. Please try again.');
            continue;
        }

        const trimmed = token.trim();

        // Extract Client ID from token
        const clientId = extractBotIdFromToken(trimmed);
        if (!clientId) {
            errMsg('Invalid token format. A Discord bot token has 3 dot-separated segments.');
            continue;
        }

        // Verify token against Discord API
        process.stdout.write(`  ${C.dim}Verifying token...${C.reset}`);
        const botInfo = await verifyToken(trimmed);

        if (botInfo) {
            process.stdout.write(`\r  ${C.green}Verified!${C.reset} Bot: ${C.bold}${botInfo.username}${C.reset} (${botInfo.id})\n`);
            return { token: trimmed, clientId: botInfo.id, botName: botInfo.username };
        }

        // API failed but token format is valid — use extracted ID
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

async function runSetupWizard(): Promise<SetupResult> {
    const rl = createInterface();

    try {
        console.log(SETUP_LOGO);
        console.log(`  ${C.bold}Interactive setup — ${TOTAL_STEPS} steps${C.reset}\n`);

        stepHeader(1, TOTAL_STEPS, 'Discord Bot Token');
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

        stepHeader(2, TOTAL_STEPS, 'Guild (Server) ID');
        hint('This registers slash commands instantly to your server.');
        hint('1. Open Discord Settings > Advanced > enable "Developer Mode"');
        hint('2. Right-click your server icon > "Copy Server ID"');
        hint(`${C.yellow}Press Enter to skip${C.dim} (commands will register globally, may take ~1 hour)`);
        hintBlank();
        const guildId = await promptGuildId(rl);
        console.log('');

        stepHeader(3, TOTAL_STEPS, 'Allowed Discord User IDs');
        hint('Only these users can send commands to the bot.');
        hint('1. In Discord, right-click your own profile icon');
        hint('2. Click "Copy User ID" (requires Developer Mode from step 2)');
        hint('Multiple IDs: separate with commas (e.g. 123456,789012)');
        hintBlank();
        const allowedUserIds = await promptAllowedUserIds(rl);
        console.log('');

        stepHeader(4, TOTAL_STEPS, 'Workspace Base Directory');
        hint('The parent directory where your coding projects live.');
        hint('LazyGravity will scan subdirectories as workspaces.');
        hintBlank();
        const workspaceBaseDir = await promptWorkspaceDir(rl);
        console.log('');

        return { discordToken, clientId, guildId, allowedUserIds, workspaceBaseDir };
    } finally {
        rl.close();
    }
}

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

export async function setupAction(): Promise<void> {
    const result = await runSetupWizard();

    ConfigLoader.save({
        discordToken: result.discordToken,
        clientId: result.clientId,
        guildId: result.guildId,
        allowedUserIds: result.allowedUserIds,
        workspaceBaseDir: result.workspaceBaseDir,
    });

    const configPath = ConfigLoader.getConfigFilePath();
    const inviteUrl = buildInviteUrl(result.clientId);

    console.log(`  ${C.green}Setup complete!${C.reset}\n`);
    console.log(`  ${C.dim}Saved to${C.reset} ${configPath}\n`);
    console.log(`  ${C.cyan}Next steps:${C.reset}`);
    console.log(`  ${C.bold}1.${C.reset} ${C.yellow}Verify Privileged Gateway Intents are enabled${C.reset} in the Bot tab:`);
    console.log(`     ${C.dim}Required: PRESENCE INTENT, SERVER MEMBERS INTENT, MESSAGE CONTENT INTENT${C.reset}`);
    console.log(`     https://discord.com/developers/applications/${result.clientId}/bot\n`);
    console.log(`  ${C.bold}2.${C.reset} Add the bot to your server:`);
    console.log(`     ${inviteUrl}\n`);
    console.log(`  ${C.bold}3.${C.reset} Open Antigravity with CDP enabled:`);
    console.log(`     ${C.green}lazy-gravity open${C.reset}`);
    console.log(`     ${C.dim}(auto-selects an available port from: ${CDP_PORTS.join(', ')})${C.reset}\n`);
    console.log(`  ${C.bold}4.${C.reset} Run: ${C.green}lazy-gravity start${C.reset}\n`);
}
