<p align="center">
  <img src="https://raw.githubusercontent.com/tokyoweb3/LazyGravity/main/docs/assets/LazyGravityBanner.png" alt="LazyGravity Banner" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.0.4-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/node-18.x+-brightgreen?style=flat-square&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/discord.js-14.x-5865F2?style=flat-square&logo=discord&logoColor=white" alt="discord.js" />
  <img src="https://img.shields.io/badge/protocol-CDP%20%2F%20WebSocket-orange?style=flat-square" alt="CDP/WebSocket" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

# LazyGravity

**LazyGravity** is a local, secure Discord Bot that lets you remotely operate [Antigravity](https://antigravity.dev) on your home PC — from your smartphone's Discord app, anywhere.

Send natural language instructions like "fix that bug" or "start designing the new feature" from your phone. Antigravity executes them locally on your home PC using its full resources, and reports results back to Discord.

<p align="center">
  <video src="https://github.com/user-attachments/assets/84eca973-59e8-4ffa-93e9-fba78ba72f74" width="100%" controls autoplay muted loop>
    Your browser does not support the video tag.
  </video>
</p>


## Quick Setup

Runtime: **Node >= 18**.

```bash
npm install -g lazy-gravity
lazy-gravity setup
```

The interactive wizard walks you through Discord bot creation, token setup, and workspace configuration. When done:

```bash
lazy-gravity open     # Launch Antigravity with CDP enabled
lazy-gravity start    # Start the Discord bot
```

Or run directly without installing:

```bash
npx lazy-gravity
```

---

## Features

1. **Fully Local & Secure**
   - **No external server or port exposure** — runs as a local process on your PC, communicating directly with Discord.
   - **Whitelist access control**: only authorized Discord user IDs (`allowedUserIds`) can interact with the bot.
   - **Secure credential management**: Bot tokens and API keys are stored locally (never in source code).
   - **Path traversal prevention & resource protection**: sandboxed directory access and concurrent task limits prevent abuse.

2. **Project Management (Channel-Directory Binding)**
   - Use `/project` to bind a Discord channel to a local project directory via an interactive select menu with buttons.
   - Messages sent in a bound channel are automatically forwarded to Antigravity with the correct project context.

3. **Context-Aware Embed Replies**
   - Results are delivered as rich Discord Embeds. Use Discord's Reply feature on any result to continue the conversation — the bot preserves full context (directory, task history) across reply chains.

4. **Real-Time Progress Monitoring**
   - Long-running Antigravity tasks report progress as a series of messages (delivery confirmed / planning / analysis / execution / implementation / final summary).

5. **File Attachments & Context Parsing**
   - Send images (screenshots, mockups) or text files via Discord — they are automatically forwarded to Antigravity as context.

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
- `🛑 /stop` — Force-stop a running Antigravity task
- `📸 /screenshot` — Capture and send Antigravity's current screen
- `🔧 /status` — Show bot connection status, current mode, and active project
- `✅ /autoaccept [on|off|status]` — Toggle auto-approval of file edit dialogs
- `🧹 /cleanup [days]` — Scan and clean up inactive session channels (default: 7 days)
- `❓ /help` — Display list of available commands

### CLI Commands

```bash
lazy-gravity              # Auto: runs setup if unconfigured, otherwise starts the bot
lazy-gravity setup        # Interactive setup wizard
lazy-gravity open         # Open Antigravity with CDP (auto-selects available port)
lazy-gravity start        # Start the Discord bot
lazy-gravity doctor       # Check environment and dependencies
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
```

Then start the bot:

```bash
npm run start
```

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

**On disconnect**: automatically retries up to 3 times (`maxReconnectAttempts`). If all retries fail, an error notification is sent to Discord.

## License

[MIT](LICENSE)
