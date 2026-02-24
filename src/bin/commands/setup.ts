import * as readline from 'readline';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigLoader } from '../../utils/configLoader';

const SETUP_LOGO = `
      /\\_/\\
     ( o.o )  < Welcome to LazyGravity!
      > ^ <
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
            // Not a terminal — fall back to normal prompt
            rl.question(prompt, resolve);
            return;
        }

        process.stdout.write(prompt);

        // Pause the readline interface so we can take raw control
        rl.pause();

        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        let input = '';

        const onData = (char: string): void => {
            const code = char.charCodeAt(0);

            if (char === '\r' || char === '\n') {
                // Enter pressed
                stdin.setRawMode(false);
                stdin.removeListener('data', onData);
                process.stdout.write('\n');
                rl.resume();
                resolve(input);
            } else if (code === 127 || code === 8) {
                // Backspace
                if (input.length > 0) {
                    input = input.slice(0, -1);
                    process.stdout.write('\b \b');
                }
            } else if (code === 3) {
                // Ctrl+C
                stdin.setRawMode(false);
                process.stdout.write('\n');
                process.exit(0);
            } else if (code >= 32) {
                // Printable character
                input += char;
                process.stdout.write('*');
            }
        };

        stdin.on('data', onData);
    });
}

// ---------------------------------------------------------------------------
// Setup steps
// ---------------------------------------------------------------------------

interface SetupResult {
    discordToken: string;
    clientId: string;
    allowedUserIds: string[];
    workspaceBaseDir: string;
}

async function promptToken(rl: readline.Interface): Promise<string> {
    while (true) {
        const token = await askSecret(rl, '  Discord Bot Token: ');
        if (isNonEmpty(token)) {
            return token.trim();
        }
        console.log('  Token cannot be empty. Please try again.\n');
    }
}

async function promptClientId(rl: readline.Interface): Promise<string> {
    while (true) {
        const clientId = await ask(rl, '  Client ID: ');
        if (isNonEmpty(clientId) && isNumericString(clientId)) {
            return clientId.trim();
        }
        console.log('  Client ID must be a non-empty numeric string. Please try again.\n');
    }
}

async function promptAllowedUserIds(rl: readline.Interface): Promise<string[]> {
    while (true) {
        const raw = await ask(rl, '  Allowed User IDs (comma-separated): ');
        const error = validateAllowedUserIds(raw);
        if (error === null) {
            return parseAllowedUserIds(raw);
        }
        console.log(`  ${error} Please try again.\n`);
    }
}

async function promptWorkspaceDir(rl: readline.Interface): Promise<string> {
    const defaultDir = path.join(os.homedir(), 'Code');

    while (true) {
        const raw = await ask(rl, `  Workspace base directory [${defaultDir}]: `);
        const dir = expandTilde(raw.trim().length > 0 ? raw.trim() : defaultDir);
        const resolved = path.resolve(dir);

        if (fs.existsSync(resolved)) {
            return resolved;
        }

        const answer = await ask(rl, `  Directory "${resolved}" does not exist. Create it? (y/n): `);
        if (answer.trim().toLowerCase() === 'y') {
            fs.mkdirSync(resolved, { recursive: true });
            return resolved;
        }
        console.log('  Please enter an existing directory.\n');
    }
}

async function runSetupWizard(): Promise<SetupResult> {
    const rl = createInterface();

    try {
        console.log(SETUP_LOGO);
        console.log('  Interactive setup — 4 steps\n');

        console.log('  [Step 1/4] Discord Bot Token');
        console.log('  (Get yours at https://discord.com/developers/applications)\n');
        const discordToken = await promptToken(rl);
        console.log('');

        console.log('  [Step 2/4] Application Client ID');
        console.log('  (Found on your Discord application\'s General Information page)\n');
        const clientId = await promptClientId(rl);
        console.log('');

        console.log('  [Step 3/4] Allowed Discord User IDs');
        console.log('  (Only these users can control the bot)\n');
        const allowedUserIds = await promptAllowedUserIds(rl);
        console.log('');

        console.log('  [Step 4/4] Workspace Base Directory');
        console.log('  (Where your coding projects live)\n');
        const workspaceBaseDir = await promptWorkspaceDir(rl);
        console.log('');

        return { discordToken, clientId, allowedUserIds, workspaceBaseDir };
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
        allowedUserIds: result.allowedUserIds,
        workspaceBaseDir: result.workspaceBaseDir,
    });

    const configPath = ConfigLoader.getConfigFilePath();
    console.log('  Setup complete!\n');
    console.log(`  Saved to ${configPath}`);
    console.log('  Run `lazy-gravity start` to begin!\n');
}
