import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const describeWindows = process.platform === 'win32' ? describe : describe.skip;

describeWindows('Windows source launcher', () => {
    let workspace: string;
    let logPath: string;
    let env: NodeJS.ProcessEnv;
    const marker = () => path.join(workspace, 'node_modules', '.install-complete');

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lazy-gravity-launcher-test-'));
        logPath = path.join(workspace, 'actions.log');
        fs.copyFileSync(path.resolve(__dirname, '../../start_lazy_gravity_win.bat'), path.join(workspace, 'start.bat'));
        const bin = path.join(workspace, 'bin');
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, 'npm.cmd'), [
            '@echo off', 'echo %*>>"%LAUNCHER_TEST_LOG%"',
            'if "%1"=="ci" (',
            '  if "%LAUNCHER_TEST_CI_FAIL%"=="1" exit /b 1',
            '  if not exist node_modules mkdir node_modules', ')', 'exit /b 0', '',
        ].join('\r\n'));
        const cliDir = path.join(workspace, 'dist', 'bin');
        fs.mkdirSync(cliDir, { recursive: true });
        fs.writeFileSync(path.join(cliDir, 'cli.js'),
            "require('fs').appendFileSync(process.env.LAUNCHER_TEST_LOG, process.argv[2] + '\\n');");
        const preload = path.join(workspace, 'node-version.cjs');
        fs.writeFileSync(preload, "Object.defineProperty(process.versions, 'node', { value: process.env.LAUNCHER_TEST_VERSION });");
        env = { ...process.env };
        for (const key of Object.keys(env)) {
            if (['PATH', 'NODE_OPTIONS'].includes(key.toUpperCase())) delete env[key];
        }
        env.Path = [bin, path.dirname(process.execPath), path.join(process.env.SystemRoot!, 'System32')].join(path.delimiter);
        env.NODE_OPTIONS = `--require "${preload.replace(/\\/g, '/')}"`;
        env.LAUNCHER_TEST_LOG = logPath;
        env.LAUNCHER_TEST_VERSION = '22.14.0';
        env.ELECTRON_RUN_AS_NODE = '1';
    });

    afterEach(() => {
        const resolved = path.resolve(workspace);
        if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('lazy-gravity-launcher-test-')) {
            throw new Error('Unexpected launcher test cleanup path');
        }
        fs.rmSync(resolved, { recursive: true, force: true });
    });

    /** Run only the copied launcher with stubbed npm/CLI processes and a controlled Node version. */
    function run() {
        const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start.bat'], {
            cwd: workspace, env, input: '\n', encoding: 'utf8', timeout: 15000, windowsHide: true,
        });
        if (result.error) throw result.error;
        return result;
    }

    it('rejects Node 22.13 before installing or starting the CLI', () => {
        env.LAUNCHER_TEST_VERSION = '22.13.0';
        const result = run();
        expect(result.stderr).toBe('');
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('Node.js 22.14 or newer is required');
        expect(fs.existsSync(logPath)).toBe(false);
        expect(fs.existsSync(marker())).toBe(false);
    });

    it.each(['22.14.0', '24.0.0'])('reinstalls partial dependencies on Node %s and skips only after success', version => {
        env.LAUNCHER_TEST_VERSION = version;
        const tsc = path.join(workspace, 'node_modules', 'typescript', 'bin');
        fs.mkdirSync(tsc, { recursive: true });
        fs.writeFileSync(path.join(tsc, 'tsc'), 'partial install');
        const installed = run();
        expect(installed.stderr).toBe('');
        expect({ status: installed.status, stdout: installed.stdout, stderr: installed.stderr }).toMatchObject({ status: 0 });
        expect(fs.existsSync(marker())).toBe(true);
        expect(fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/)).toEqual([
            'ci --no-audit --no-fund', 'run build', 'open', 'start',
        ]);
        fs.writeFileSync(logPath, '');
        expect(run().status).toBe(0);
        expect(fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/)).toEqual(['run build', 'open', 'start']);
    });

    it('leaves no completion marker when npm ci fails and retries on the next launch', () => {
        env.LAUNCHER_TEST_CI_FAIL = '1';
        const failed = run();
        expect(failed.stderr).toBe('');
        expect({ status: failed.status, stdout: failed.stdout, stderr: failed.stderr }).toMatchObject({ status: 1, stdout: expect.stringContaining('Installing project dependencies') });
        expect(fs.existsSync(marker())).toBe(false);
        expect(fs.readFileSync(logPath, 'utf8').trim()).toBe('ci --no-audit --no-fund');
        env.LAUNCHER_TEST_CI_FAIL = '0';
        expect(run().status).toBe(0);
        expect(fs.existsSync(marker())).toBe(true);
    });
});
