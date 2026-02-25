import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { CDP_PORTS } from '../../utils/cdpPorts';
import { ConfigLoader } from '../../utils/configLoader';
import { COLORS } from '../../utils/logger';

const ok = (msg: string) => console.log(`  ${COLORS.green}[OK]${COLORS.reset} ${msg}`);
const warn = (msg: string) => console.log(`  ${COLORS.yellow}[--]${COLORS.reset} ${msg}`);
const fail = (msg: string) => console.log(`  ${COLORS.red}[!!]${COLORS.reset} ${msg}`);
const hint = (msg: string) => console.log(`       ${COLORS.dim}${msg}${COLORS.reset}`);

function checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(Array.isArray(parsed));
                } catch {
                    resolve(false);
                }
            });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

function checkEnvFile(): { exists: boolean; path: string } {
    const envPath = path.resolve(process.cwd(), '.env');
    return { exists: fs.existsSync(envPath), path: envPath };
}

function checkRequiredEnvVars(): { name: string; set: boolean }[] {
    const required = ['DISCORD_BOT_TOKEN', 'CLIENT_ID', 'ALLOWED_USER_IDS'];
    return required.map((name) => ({
        name,
        set: Boolean(process.env[name]),
    }));
}

export async function doctorAction(): Promise<void> {
    console.log(`\n${COLORS.cyan}lazy-gravity doctor${COLORS.reset}\n`);
    let allOk = true;

    // 1. Config directory check
    const configDir = ConfigLoader.getConfigDir();
    if (fs.existsSync(configDir)) {
        ok(`Config directory exists: ${configDir}`);
    } else {
        warn(`Config directory not found: ${configDir}`);
        hint('Run: lazy-gravity setup  (optional if using .env)');
    }

    // 2. Config file check
    const configFilePath = ConfigLoader.getConfigFilePath();
    if (ConfigLoader.configExists()) {
        ok(`Config file found: ${configFilePath}`);
    } else {
        warn(`Config file not found: ${configFilePath} (optional — .env fallback used)`);
    }

    // 3. .env file check
    const env = checkEnvFile();
    if (env.exists) {
        // Load .env so subsequent checks can see the variables
        require('dotenv').config({ path: env.path });
        ok(`.env file found: ${env.path}`);
    } else {
        if (!ConfigLoader.configExists()) {
            fail(`.env file not found: ${env.path}`);
            allOk = false;
        } else {
            warn(`.env file not found: ${env.path} (not needed — config.json used)`);
        }
    }

    // 4. Required environment variables (check both env and config.json sources)
    const vars = checkRequiredEnvVars();
    for (const v of vars) {
        if (v.set) {
            ok(`${v.name} is set`);
        } else {
            fail(`${v.name} is NOT set`);
            allOk = false;
        }
    }

    // 5. CDP port check
    console.log(`\n  ${COLORS.dim}Checking CDP ports...${COLORS.reset}`);
    let cdpOk = false;
    for (const port of CDP_PORTS) {
        const alive = await checkPort(port);
        if (alive) {
            ok(`CDP port ${port} is responding`);
            cdpOk = true;
        }
    }
    if (!cdpOk) {
        fail('No CDP ports responding');
        hint('Run: open -a Antigravity --args --remote-debugging-port=9222');
        allOk = false;
    }

    // 6. Node.js version check
    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split('.')[0], 10);
    if (major >= 18) {
        ok(`Node.js ${nodeVersion}`);
    } else {
        fail(`Node.js ${nodeVersion} (>= 18.0.0 required)`);
        allOk = false;
    }

    // Summary
    console.log('');
    if (allOk) {
        console.log(`  ${COLORS.green}All checks passed!${COLORS.reset}`);
    } else {
        console.log(`  ${COLORS.red}Some checks failed. Please fix the issues above.${COLORS.reset}`);
        process.exitCode = 1;
    }
}
