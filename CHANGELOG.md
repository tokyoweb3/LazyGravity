# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-26

### Added

- Discord bot with slash command interface for controlling Antigravity
- `/model` command to select and switch AI models
- `/mode` command to switch between task modes (e.g., research, code)
- `/schedule` command for cron-based job scheduling
- `/prompt` command to send prompts to Antigravity
- `/status` command to check bot and Antigravity connection status
- `/logs` command to view bot logs from Discord
- `/output` command to toggle between Embed and plain-text output
- Secure token management (no hardcoded secrets)
- `allowedUserIds` whitelist for access control
- SQLite-based local persistence for configuration and routing
- CDP (Chrome DevTools Protocol) integration with Antigravity browser
- WebSocket-based communication with Antigravity
- CLI entry point (`lazy-gravity` command)
- Comprehensive test suite (390+ tests)

[Unreleased]: https://github.com/tokyoweb3/LazyGravity/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tokyoweb3/LazyGravity/releases/tag/v0.1.0
