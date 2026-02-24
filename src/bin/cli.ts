#!/usr/bin/env node
import { Command } from 'commander';
import { version } from '../../package.json';
import { startAction } from './commands/start';
import { doctorAction } from './commands/doctor';

const program = new Command()
    .name('lazy-gravity')
    .description('Control your AI coding assistant from Discord')
    .version(version);

program
    .command('start')
    .description('Start the Discord bot')
    .action(startAction);

program
    .command('doctor')
    .description('Check environment and dependencies')
    .action(doctorAction);

// Default: no subcommand = start
program.action(startAction);

program.parse();
