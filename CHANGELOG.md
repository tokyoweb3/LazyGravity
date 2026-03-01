# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-26

### Added

- Discord bot with slash command interface for controlling Antigravity
- `/model` command to select and switch AI models
- `/mode` command to switch between task modes
- `/template` command to list, register, and delete prompt templates
- `/project` command to list and create projects with auto channel binding
- `/chat` command to display current session info and session list
- `/new` command to start a new chat session
- `/stop` command to interrupt active LLM generation
- `/screenshot` command to capture current Antigravity screen
- `/status` command to check bot and connection status
- `/autoaccept` command to toggle auto-allow mode for approval dialogs
- `/cleanup` command to scan and clean up inactive session channels
- `/help` and `/ping` utility commands
- Structured DOM extraction and HTML-to-Markdown conversion
- Planning mode detection with notification quality fixes
- Secure token management (no hardcoded secrets)
- `allowedUserIds` whitelist for access control
- SQLite-based local persistence for configuration and routing
- CDP (Chrome DevTools Protocol) integration with Antigravity browser
- WebSocket-based communication with Antigravity
- CLI entry point (`lazy-gravity` command) with setup wizard and doctor command
- Comprehensive test suite (390+ tests)

[Unreleased]: https://github.com/tokyoweb3/LazyGravity/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tokyoweb3/LazyGravity/releases/tag/v0.1.0
