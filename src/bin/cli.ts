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

const program = new Command()
    .name('lazy-gravity')
    .description('Control your AI coding assistant from Discord')
    .version(version)
    .option('--verbose', 'Show debug-level logs')
    .option('--quiet', 'Only show errors');

// Default action: no subcommand → start or setup
program.action(() => {
    const hasConfig = ConfigLoader.configExists();
    const hasEnv = fs.existsSync(path.resolve(process.cwd(), '.env'));

    if (!hasConfig && !hasEnv) {
        setupAction();
    } else {
        startAction(program.opts(), program);
    }
});

program
    .command('start')
    .description('Start the Discord bot')
    .action((_opts, cmd) => startAction(cmd.parent.opts(), cmd.parent));

program
    .command('doctor')
    .description('Check environment and dependencies')
    .action(doctorAction);

program
    .command('setup')
    .description('Interactive setup wizard')
    .action(setupAction);

program
    .command('open')
    .description('Open Antigravity with CDP enabled (auto-selects available port)')
    .action(openAction);

program.parse();
