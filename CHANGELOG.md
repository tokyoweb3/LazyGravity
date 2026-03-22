# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Named Antigravity account configuration via `ANTIGRAVITY_ACCOUNTS` for mapping multiple CDP ports to reusable account aliases
- `/account` command plus per-user and per-channel account preferences for Discord workflows with multiple Antigravity instances
- `/open` command to explicitly launch and connect a workspace to its assigned Antigravity account
- **Telegram Topics (Forums) Support**: `/project` and `/new` commands now automatically create and bind isolated Topics in Telegram Forums, matching Discord's thread/channel isolation behavior
- **Telegram Session Management**: Added `/join` command to take over existing Antigravity sessions and `/mirror` command to toggle PC-to-Telegram message mirroring, bringing feature parity with Discord

### Changed

- CDP connection management, launcher scripts, `open`, and `doctor` now respect configured Antigravity account ports instead of relying only on the default fixed scan list
- README and `.env.example` now document multi-instance account setup for custom Antigravity profiles

## [0.3.0] - 2026-03-03

### Added

- **Multi-platform support**: Platform abstraction layer for Discord + Telegram ([#67](https://github.com/tokyoweb3/LazyGravity/pull/67))
- **Telegram bot integration**: Full Telegram support with grammy — send prompts, receive responses, inline keyboard buttons
- Telegram commands: `/project`, `/project_create`, `/template`, `/template_add`, `/template_delete`, `/mode`, `/model`, `/screenshot`, `/autoaccept`, `/logs`, `/stop`, `/status`, `/ping`, `/help`
- Platform-agnostic handler factories for message, button, select, and command events
- `EventRouter` with per-platform authorization and event dispatch
- `WorkspaceQueue` for per-workspace task serialization across platforms
- `TelegramBindingRepository` for Telegram chat-to-workspace bindings (SQLite)
- Platform-agnostic notification/UI payload builders (approval, planning, error, status, progress)
- `PlatformAdapter` interface with Discord and Telegram implementations
- `RichContentBuilder` for immutable rich content construction
- `TelegramFormatter` for Markdown-to-Telegram HTML conversion
- Telegram photo message support with automatic image forwarding
- Default model pre-selection with DB persistence
- Interactive arrow-key setup wizard with platform toggle
- `PLATFORMS` environment variable to select active platforms (`discord`, `telegram`, or both)
- Test suite expanded from 690+ to 1270+ tests

### Fixed

- Credential validation for Discord token/clientId with explicit error logging
- `doctor` command now validates `PLATFORMS` values against known platforms
- i18n keys in session picker use proper variable interpolation
- Discord component row validation (prevents mixing buttons and select menus)
- `WorkspaceQueue` memory cleanup via `.finally()` on completed chains

### Changed

- `description` in package.json updated to reflect multi-platform support

## [0.2.0] - 2026-03-02

### Added

- `/output` command to toggle between Embed and plain-text output format ([#54](https://github.com/tokyoweb3/LazyGravity/pull/54))
- `/logs` slash command to view recent bot logs from Discord ([#53](https://github.com/tokyoweb3/LazyGravity/pull/53))
- `/join` command to take over an existing Antigravity session ([#37](https://github.com/tokyoweb3/LazyGravity/pull/37))
- `/mirror` command to toggle PC→Discord message mirroring ([#37](https://github.com/tokyoweb3/LazyGravity/pull/37))
- Auto update check on startup ([#35](https://github.com/tokyoweb3/LazyGravity/pull/35))
- `ANTIGRAVITY_PATH` environment variable for Linux/custom installations ([#43](https://github.com/tokyoweb3/LazyGravity/pull/43))
- OSS standard files (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT) and CI build step ([#57](https://github.com/tokyoweb3/LazyGravity/pull/57))

### Fixed

- Per-workspace prompt queue to serialize send-response cycles ([#66](https://github.com/tokyoweb3/LazyGravity/pull/66))
- CDP disconnect handling and activity-based timeout in ResponseMonitor ([#50](https://github.com/tokyoweb3/LazyGravity/pull/50))
- Cross-platform path extraction in cdpConnectionPool with platform-aware CDP hints ([#45](https://github.com/tokyoweb3/LazyGravity/pull/45))
- Windows path handling and chat casing issues ([#43](https://github.com/tokyoweb3/LazyGravity/pull/43))
- Discord UX quality fixes for embeds and notifications ([#34](https://github.com/tokyoweb3/LazyGravity/pull/34))

### Changed

- Simplified logger: removed file transport, added verbose debug mode ([#33](https://github.com/tokyoweb3/LazyGravity/pull/33))
- Test suite expanded from 390 to 690+ tests

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

[Unreleased]: https://github.com/tokyoweb3/LazyGravity/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/tokyoweb3/LazyGravity/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tokyoweb3/LazyGravity/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tokyoweb3/LazyGravity/releases/tag/v0.1.0
