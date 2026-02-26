#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { version } from '../../package.json';
import { startAction } from './commands/start';
import { doctorAction } from './commands/doctor';
import { setupAction } from './commands/setup';
import { openAction } from './commands/open';
import { ConfigLoader } from '../utils/configLoader';

let commandRan = false;

const markRan = <T extends (...args: any[]) => any>(fn: T): T =>
    ((...args: any[]) => { commandRan = true; return fn(...args); }) as unknown as T;

const program = new Command()
    .name('lazy-gravity')
    .description('Control your AI coding assistant from Discord')
    .version(version)
    .option('--verbose', 'Show debug-level logs')
    .option('--quiet', 'Only show errors');

program
    .command('start')
    .description('Start the Discord bot')
    .action(markRan(startAction));

program
    .command('doctor')
    .description('Check environment and dependencies')
    .action(markRan(doctorAction));

program
    .command('setup')
    .description('Interactive setup wizard')
    .action(markRan(setupAction));

program
    .command('open')
    .description('Open Antigravity with CDP enabled (auto-selects available port)')
    .action(markRan(openAction));

program.parse();

// Default behavior: if no subcommand was matched, decide what to run
if (!commandRan) {
    const hasConfig = ConfigLoader.configExists();
    const hasEnv = fs.existsSync(path.resolve(process.cwd(), '.env'));

    if (!hasConfig && !hasEnv) {
        setupAction();
    } else {
        startAction(program.opts(), program);
    }
}
