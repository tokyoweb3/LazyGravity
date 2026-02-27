import * as os from 'os';
import * as path from 'path';

const APP_NAME = 'Antigravity';

/**
 * Get the Antigravity CLI binary path for the current platform.
 *
 * - macOS: /Applications/Antigravity.app/Contents/Resources/app/bin/antigravity
 * - Windows: %LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe
 * - Linux: antigravity (assumed in PATH)
 */
export function getAntigravityCliPath(): string {
    switch (process.platform) {
        case 'darwin':
            return '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity';
        case 'win32': {
            const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
            return path.join(localAppData, 'Programs', APP_NAME, `${APP_NAME}.exe`);
        }
        default:
            return APP_NAME.toLowerCase();
    }
}

/**
 * Get fallback launch command and args for opening a workspace.
 *
 * - macOS: open -a Antigravity <path>
 * - Windows: use full exe path with shell (handles spaces in paths)
 * - Linux: antigravity <path>
 */
export function getAntigravityFallback(workspacePath: string): { command: string; args: string[]; options?: { shell: boolean } } {
    switch (process.platform) {
        case 'darwin':
            return { command: 'open', args: ['-a', APP_NAME, workspacePath] };
        case 'win32': {
            const exePath = getAntigravityCliPath();
            return { command: exePath, args: [workspacePath], options: { shell: true } };
        }
        default:
            return { command: APP_NAME.toLowerCase(), args: [workspacePath] };
    }
}

/**
 * Get a platform-appropriate hint for starting Antigravity with CDP.
 *
 * Used in user-facing messages (Discord embeds, CLI doctor, logs).
 */
export function getAntigravityCdpHint(port: number = 9222): string {
    switch (process.platform) {
        case 'darwin':
            return `open -a ${APP_NAME} --args --remote-debugging-port=${port}`;
        case 'win32':
            return `${APP_NAME}.exe --remote-debugging-port=${port}`;
        default:
            return `${APP_NAME.toLowerCase()} --remote-debugging-port=${port}`;
    }
}
