<p align="center">
  <img src="https://raw.githubusercontent.com/tokyoweb3/LazyGravity/main/docs/assets/LazyGravityBanner.png" alt="LazyGravity Banner" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/Antigravity-1.19.5-ff6b35?style=flat-square" alt="Antigravity" />
  <img src="https://img.shields.io/badge/node-18.x+-brightgreen?style=flat-square&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/discord.js-14.x-5865F2?style=flat-square&logo=discord&logoColor=white" alt="discord.js" />
  <img src="https://img.shields.io/badge/telegram-optional-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram" />
  <img src="https://img.shields.io/badge/protocol-CDP%20%2F%20WebSocket-orange?style=flat-square" alt="CDP/WebSocket" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

# LazyGravity

**LazyGravity** is a local, secure bot that lets you remotely operate [Antigravity](https://antigravity.dev) on your home PC — from your smartphone, anywhere. Supports **Discord** and **Telegram** (optional).

Send natural language instructions like "fix that bug" or "start designing the new feature" from your phone. Antigravity executes them locally on your home PC using its full resources, and reports results back to your chat platform.

https://github.com/user-attachments/assets/08eac63e-5ede-469b-ac6c-1c40ec77b0c0


## Quick Setup

Runtime: **Node >= 18**.

```bash
npm install -g lazy-gravity
lazy-gravity setup
```

The interactive wizard walks you through Discord bot creation, token setup, and workspace configuration. When done:

```bash
lazy-gravity open     # Launch Antigravity with CDP enabled
lazy-gravity start    # Start the bot (Discord by default, or both platforms)
```

Or run directly without installing:

```bash
npx lazy-gravity
```

---

## Features

1. **Fully Local & Secure**
   - **No external server or port exposure** — runs as a local process on your PC, communicating directly with Discord/Telegram.
   - **Whitelist access control**: only authorized user IDs can interact with the bot (per-platform allowlists).
   - **Secure credential management**: Bot tokens and API keys are stored locally (never in source code).
   - **Path traversal prevention & resource protection**: sandboxed directory access and concurrent task limits prevent abuse.

2. **Multi-Platform Support**
   - **Discord** (default): Full feature set with slash commands, rich embeds, reactions, and channel management.
   - **Telegram** (optional): Send prompts, receive responses, and use inline keyboard buttons. Requires [grammy](https://grammy.dev/) (`npm install grammy`).
   - Run both platforms simultaneously from a single process, or use either one standalone.

3. **Project Management (Channel-Directory Binding)**
   - **Discord**: Use `/project` to bind a channel to a local project directory via an interactive select menu.
   - **Telegram**: Use `/project` to bind a chat to a workspace directory.
   - Messages sent in a bound channel/chat are automatically forwarded to Antigravity with the correct project context.

4. **Context-Aware Replies**
   - **Discord**: Results delivered as rich Embeds. Use Reply to continue the conversation with full context preserved.
   - **Telegram**: Results delivered as formatted HTML messages with inline keyboard buttons.

5. **Real-Time Progress Monitoring**
   - Long-running Antigravity tasks report progress as a series of messages (delivery confirmed / planning / analysis / execution / implementation / final summary).

6. **File Attachments & Context Parsing**
   - Send images (screenshots, mockups) or text files — they are automatically forwarded to Antigravity as context.

## Usage & Commands

### Natural Language Messages
Just type in any bound channel:
> `refactor the components under src/components. Make the layout look like yesterday's screenshot` (with image attached)

### Slash Commands

- `📂 /project list` — Browse projects via select menu; selecting one auto-creates a category and session channel
- `📂 /project create <name>` — Create a new project directory + Discord category/channel
- `💬 /new` — Start a new Antigravity chat session in the current project
- `💬 /chat` — Show current session info and list all sessions in the project
- `⚙️ /model [name]` — Switch the LLM model (e.g. `gpt-4o`, `claude-3-opus`, `gemini-1.5-pro`)
- `⚙️ /mode` — Switch execution mode via dropdown (`code`, `architect`, `ask`, etc.)
- `📝 /template list` — Display registered templates with execute buttons
- `📝 /template add <name> <prompt>` — Register a new prompt template
- `📝 /template delete <name>` — Delete a template
- `🔗 /join` — Join an existing Antigravity session (shows up to 20 recent sessions)
- `🔗 /mirror` — Toggle PC→Discord message mirroring for the current session
- `🛑 /stop` — Force-stop a running Antigravity task
- `📸 /screenshot` — Capture and send Antigravity's current screen
- `🔧 /status` — Show bot connection status, current mode, and active project
- `✅ /autoaccept [on|off|status]` — Toggle auto-approval of file edit dialogs
- `📝 /output [embed|plain]` — Toggle output format between Embed and Plain Text (plain text is easier to copy on mobile)
- `📋 /logs [lines] [level]` — View recent bot logs (ephemeral)
- `🏓 /ping` — Check bot latency
- `🧹 /cleanup [days]` — Scan and clean up inactive session channels (default: 7 days)
- `❓ /help` — Display list of available commands

### Telegram Commands

Telegram commands use underscores instead of subcommand syntax (Telegram does not allow hyphens or spaces in command names).

- `/project` — Manage workspace bindings (list, select, create)
- `/project_create <name>` — Create a new workspace directory
- `/new` — Start a new chat session
- `/template` — List prompt templates with execute buttons
- `/template_add <name> <prompt>` — Add a new prompt template
- `/template_delete <name>` — Delete a prompt template
- `/mode` — Switch execution mode
- `/model` — Switch LLM model
- `/screenshot` — Capture Antigravity screenshot
- `/autoaccept [on|off]` — Toggle auto-accept mode
- `/logs [count]` — Show recent log entries
- `/stop` — Interrupt active LLM generation
- `/status` — Show bot status and connections
- `/ping` — Check bot latency
- `/help` — Show available commands

### CLI Commands

```bash
lazy-gravity              # Auto: runs setup if unconfigured, otherwise starts the bot
lazy-gravity setup        # Interactive setup wizard
lazy-gravity open         # Open Antigravity with CDP (auto-selects available port)
lazy-gravity start        # Start the Discord bot
lazy-gravity doctor       # Check environment and dependencies
lazy-gravity --verbose    # Show debug-level logs (CDP details, detector events, etc.)
lazy-gravity --quiet      # Only show errors
lazy-gravity --version    # Show version
lazy-gravity --help       # Show help
```

---

## Setup (Detailed)

### Option A: npm (Recommended)

```bash
npm install -g lazy-gravity
lazy-gravity setup
```

The wizard guides you through 4 steps:

1. **Discord Bot Token** — create a bot at the [Discord Developer Portal](https://discord.com/developers/applications).
   - Enable Privileged Gateway Intents: **PRESENCE, SERVER MEMBERS, MESSAGE CONTENT**.
   - Generate an OAuth2 invite URL with the following bot permissions: **Manage Channels** (required for `/project`), **Send Messages**, **Embed Links**, **Attach Files**, **Read Message History**, and **Add Reactions**.
   - Invite the bot to your server, then copy the bot token. Client ID is extracted from the token automatically.
2. **Guild (Server) ID** — for instant slash command registration (optional; press Enter to skip).
3. **Allowed User IDs** — Discord users authorized to interact with the bot.
4. **Workspace Directory** — parent directory where your coding projects live.

Config is saved to `~/.lazy-gravity/config.json`.

### Option B: From source

```bash
git clone https://github.com/tokyoweb3/LazyGravity.git
cd LazyGravity
npm install
```

Set up your `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

```env
DISCORD_BOT_TOKEN=your_bot_token_here
GUILD_ID=your_guild_id_here
ALLOWED_USER_IDS=123456789,987654321
WORKSPACE_BASE_DIR=~/Code
# ANTIGRAVITY_PATH=/path/to/antigravity.AppImage  # Optional: For Linux users or custom installations
```

Then start the bot:

```bash
npm run start
```

#### Adding Telegram Support (Optional)

1. Install grammy: `npm install grammy`
2. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram and copy the token.
3. Add the following to your `.env`:

```env
PLATFORMS=discord,telegram        # or just "telegram" for Telegram-only
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_ALLOWED_USER_IDS=123456789    # Your Telegram numeric user ID
```

For Telegram-only deployments, Discord credentials (`DISCORD_BOT_TOKEN`, `CLIENT_ID`, `ALLOWED_USER_IDS`) are not required.

Alternatively, you can build and use the CLI:

```bash
npm run build
node dist/bin/cli.js setup    # or: node dist/bin/cli.js start
```

### Launch Antigravity with CDP

LazyGravity connects to Antigravity via Chrome DevTools Protocol (CDP).
You need to launch Antigravity with a remote debugging port enabled.

```bash
# Easiest way (auto-selects an available port):
lazy-gravity open
```

If you cloned from source, you can also use the bundled launcher scripts (they auto-detect an available port from 9222–9666):

#### macOS
Double-click **`start_antigravity_mac.command`** in the repo root.

- **First run**: if you get a permission error, run `chmod +x start_antigravity_mac.command` once in the terminal.

#### Windows
Double-click **`start_antigravity_win.bat`** in the repo root.

- **If it doesn't launch**: the executable may not be in your PATH. Right-click the file, edit it, and replace `"Antigravity.exe"` with the full install path (e.g. `"%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"`).

#### Linux
On Linux (especially when using AppImages), the `antigravity` command might not be globally available.
You can specify the exact path to your executable by setting the `ANTIGRAVITY_PATH` environment variable in your `.env` file:
```env
ANTIGRAVITY_PATH=/opt/applications/antigravity.AppImage
```

> **Tip**: CDP ports are auto-scanned from candidates (9222, 9223, 9333, 9444, 9555, 9666).
> Launch Antigravity first, then start the bot — it connects automatically.

---

## Troubleshooting

If the bot is unresponsive or you've updated the code, restart it:

1. **Stop the bot** — press `Ctrl + C` in the terminal, or:
   ```bash
   pkill -f "lazy-gravity"
   ```
2. **Restart**
   ```bash
   lazy-gravity start
   # or, from source: npm run start
   ```

If Antigravity is restarted, the bot automatically attempts CDP reconnection. Sending a message triggers automatic project reconnection.

Run `lazy-gravity doctor` to diagnose configuration and connectivity issues.

---

## How CDP Connection Works

<p align="center">
  <img src="https://raw.githubusercontent.com/tokyoweb3/LazyGravity/main/docs/images/architecture.svg" alt="LazyGravity Architecture" width="100%" />
</p>

1. The bot scans debug ports (default: 9222) and auto-detects the Antigravity target
2. Connects via WebSocket to CDP (`Runtime.evaluate` for DOM operations)
3. Injects messages into the chat input, monitors Antigravity responses, and captures screenshots

**On disconnect**: automatically retries up to 3 times (`maxReconnectAttempts`). If all retries fail, an error notification is sent to the active chat platform.

## Platform Architecture

LazyGravity uses a **platform abstraction layer** so the core bot logic is platform-independent:

```
src/platform/
├── types.ts              # Shared interfaces (PlatformMessage, PlatformChannel, etc.)
├── adapter.ts            # PlatformAdapter interface
├── richContentBuilder.ts # Immutable builder for rich content (embeds/HTML)
├── discord/              # Discord adapter (discord.js wrappers)
│   ├── discordAdapter.ts
│   └── wrappers.ts
└── telegram/             # Telegram adapter (grammy-compatible wrappers)
    ├── telegramAdapter.ts
    ├── telegramFormatter.ts  # Markdown → Telegram HTML conversion
    └── wrappers.ts
```

Both adapters implement the same `PlatformAdapter` interface and emit events through `PlatformAdapterEvents`. The `EventRouter` dispatches events to platform-agnostic handlers, and the `WorkspaceQueue` serializes concurrent requests per workspace across platforms.

## License

[MIT](LICENSE)
