<!-- hy-mt2-i18n:start -->
[English](./README.md) | **中文** | [日本語](./README_ja.md) | [Español](./README_es.md)
<!-- hy-mt2-i18n:end -->

<p align="center">
  <img src="https://raw.githubusercontent.com/tokyoweb3/LazyGravity/main/docs/assets/LazyGravityBanner.png" alt="LazyGravity Banner" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/lazy-gravity?style=flat-square&color=blue" alt="版本号" />
  <img src="https://img.shields.io/badge/Antigravity-1.19.5-ff6b35?style=flat-square" alt="Antigravity" />
  <img src="https://img.shields.io/badge/node-18.x+-brightgreen?style=flat-square&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/discord.js-14.x-5865F2?style=flat-square&logo=discord&logoColor=white" alt="discord.js" />
  <img src="https://img.shields.io/badge/telegram-optional-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram" />
  <img src="https://img.shields.io/badge/protocol-CDP%20%2F%20WebSocket-orange?style=flat-square" alt="CDP/WebSocket" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="许可证" />
</p>

# LazyGravity

**LazyGravity** 是一款本地运行的安全机器人，让你能够从智能手机或任何地方远程操控家中的电脑上的 [Antigravity](https://antigravity.dev)——它可支持 **Discord** 和 **Telegram**（后者为可选功能）。

您可以通过手机发送诸如“修复那个漏洞”或“开始设计新功能”之类的自然语言指令。Antigravity会利用您家用电脑的全部资源在本地执行这些指令，并将执行结果反馈到您的聊天平台。

https://github.com/user-attachments/assets/08eac63e-5ede-469b-ac6c-1c40ec77b0c0


## 快速设置

运行环境：**Node 版本 >= 18**。

```bash
npm install -g lazy-gravity
lazy-gravity setup
```

交互式向导会引导您完成 Discord 机器人的创建、令牌设置以及工作空间配置。完成后：

```bash
lazy-gravity open     # 启动已开启CDP功能的Antigravity
lazy-gravity start    # 启动机器人（默认为Discord平台，或同时启用两个平台）
```

或者无需安装直接运行：

```bash
npx lazy-gravity
```

## 功能特性

## 功能特性

1. **完全本地化且安全**
   - **无需暴露外部服务器或端口**——作为您电脑上的本地进程运行，直接与 Discord/Telegram 进行通信。
   - **白名单访问控制**：仅有经过授权的用户 ID 才能与该机器人交互（针对不同平台设有相应的允许列表）。
   - **安全的凭证管理**：机器人令牌和 API 密钥均存储在本地（绝不会出现在源代码中）。
   - **防止路径遍历及保护资源**：通过沙箱化的目录访问机制以及并发任务限制，有效避免滥用行为。

2. **多平台支持**
   - **Discord**（默认）：具备完整功能，支持斜杠命令、丰富嵌入内容、反应功能以及频道管理。
   - **Telegram**（可选）：可发送提示语、接收回复，并使用内联键盘按钮。需要安装 [grammy](https://grammy.dev/)（通过 `npm install grammy` 安装）。
   - 可通过单个进程同时运行两个平台，也可单独使用任意一个平台。

3. **项目管理（频道-目录绑定）**
   - **Discord**：通过交互式选择菜单，使用 `/project` 命令将频道绑定到本地项目目录。
   - **Telegram**：使用 `/project` 命令将聊天窗口绑定到工作区目录。
   - 发送到已绑定频道/聊天窗口的消息会自动携带正确的项目上下文转发至 Antigravity。

4. **基于上下文的回复**
   - **Discord**：结果以丰富的嵌入消息形式呈现。可使用“回复”功能在保留完整上下文的前提下继续对话。
   - **Telegram**：结果以带内联键盘按钮的格式化HTML消息形式发送。

5. **实时进度监控**
   - 运行时间较长的 Antigravity 任务会通过一系列消息来汇报进度（已送达确认/规划中/分析中/执行中/实现中/最终总结）。

6. **文件附件与上下文解析**
   - 可发送图片（截图、设计稿）或文本文件——它们会自动作为上下文转发至 Antigravity。

## 使用方式与命令

### 自然语言消息
只需在任意绑定频道中输入即可：
> `重构 src/components 下的组件，让布局看起来与昨天的截图一致`（并附上图片）

### 斜杠命令

- `📂 /project list` — 通过下拉菜单浏览项目；选中某个项目后会自动创建一个分类频道和会话频道
- `📂 /project create <name>` — 创建新的项目目录以及 Discord 分类频道/频道
- `💬 /new` — 在当前项目中启动一个新的 Antigravity 聊天会话
- `💬 /chat` — 显示当前会话信息，并列出该项目中的所有会话
- `⚙️ /model [name]` — 切换大型语言模型（例如 `gpt-4o`、`claude-3-opus`、`gemini-1.5-pro`）
- `⚙️ /mode` — 通过下拉菜单切换执行模式（如 `code`、`architect`、`ask` 等）
- `📝 /template list` — 显示已注册的模板，并附带执行按钮
- `📝 /template add <name> <prompt>` — 注册一个新的提示词模板
- `📝 /template delete <name>` — 删除某个模板
- `📅 /schedule list` — 显示所有已安排的任务及其下次本地运行时间
- `📅 /schedule add <cron> <prompt>` — 为当前频道的绑定项目注册周期性任务
- `📅 /schedule remove <id>` — 按编号删除已安排的任务
- `📅 /schedule clear` — 删除所有已安排的任务，并重置任务编号计数器
- `📅 /schedule backup` — 将所有已安排的任务导出为 JSON 文件附件
- `📅 /schedule restore <file>` — 从 JSON 文件附件中恢复已安排的任务
- `🔗 /join` — 加入现有的 Antigravity 会话（最多显示最近 20 个会话）
- `🔗 /mirror` — 切换当前会话的电脑端与 Discord 端消息同步状态
- `🛑 /stop` — 强制停止正在运行的 Antigravity 任务
- `🛑 /shutdown` — 关闭 IDE，同时保留当前的 CDP 项目连接和会话绑定关系
- `📸 /screenshot` — 截取并发送 Antigravity 的当前屏幕画面
- `🔧 /status` — 显示机器人的连接状态、当前模式以及正在处理的项目
- `💓 /heartbeat [on|off|status]` — 配置机器人的定期心跳通知功能
- `✅ /autoaccept [on|off|status]` — 切换文件编辑对话框的自动批准功能
- `📝 /output [embed|plain]` — 在嵌入格式和纯文本格式之间切换输出方式（纯文本在手机上更易于复制）
- `📋 /logs [lines] [level]` — 查看最近的机器人日志（为临时日志）
- `🏓 /ping` — 检测机器人的响应延迟
- `🧹 /cleanup [days]` — 扫描并清理长时间未使用的会话频道（默认为 7 天）
- `❓ /help` — 显示可用命令列表

### Telegram 命令

Telegram 命令使用下划线而非子命令语法（Telegram 不允许在命令名称中使用连字符或空格）。

- `/project` — 管理工作空间绑定（列出、选择、创建）
- `/project_create <name>` — 创建新的工作空间目录
- `/new` — 启动新的聊天会话
- `/template` — 显示带有执行按钮的提示词模板列表
- `/template_add <name> <prompt>` — 添加新的提示词模板
- `/template_delete <name>` — 删除提示词模板
- `/mode` — 切换执行模式
- `/model` — 切换大型语言模型
- `/screenshot` — 截取 Antigravity 的屏幕截图
- `/autoaccept [on|off]` — 切换自动接受模式
- `/logs [count]` — 显示最近的日志记录
- `/stop` — 中断当前的大型语言模型生成过程
- `/status` — 显示机器人的状态及连接情况
- `/ping` — 检测机器人的延迟
- `/help` — 显示可用的命令列表

### CLI 命令

```bash
lazy-gravity              # 自动模式：若未配置则自动执行设置流程，否则直接启动机器人
lazy-gravity setup        # 交互式设置向导
lazy-gravity open         # 使用 CDP 打开 Antigravity（自动选择可用端口）
lazy-gravity start        # 启动 Discord 机器人
lazy-gravity doctor       # 检查环境与依赖项
lazy-gravity --verbose    # 显示调试级日志（包括 CDP 详情、检测器事件等）
lazy-gravity --quiet      # 仅显示错误信息
lazy-gravity --version    # 显示版本信息
lazy-gravity --help       # 显示帮助信息
```

### 选项 A：npm（推荐）

```bash
npm install -g lazy-gravity
lazy-gravity setup
```

向导会引导您完成 4 个步骤：

1. **Discord Bot Token** — 在 [Discord 开发者门户](https://discord.com/developers/applications) 创建一个机器人。
   - 启用特权网关意图：**PRESENCE、SERVER MEMBERS、MESSAGE CONTENT**。

## 详细设置步骤

### 方案 A：npm（推荐）

```bash
npm install -g lazy-gravity
lazy-gravity setup
```

向导会引导您完成4个步骤：

1. **Discord Bot Token** — 在[Discord开发者门户](https://discord.com/developers/applications)创建一个机器人。
   - 启用特权网关意图：**PRESENCE、SERVER MEMBERS、MESSAGE CONTENT**。
   - 生成带有以下机器人权限的OAuth2邀请链接：**Manage Channels**（用于执行 `/project` 命令所需）、**Send Messages**、**Embed Links**、**Attach Files**、**Read Message History**以及**Add Reactions**。
   - 将该机器人邀请到您的服务器，随后复制其机器人令牌。客户端ID会自动从该令牌中提取出来。
2. **Guild (Server) ID** — 用于即时注册斜杠命令（可选；按回车键可跳过）。
3. **Allowed User IDs** — 被授权与机器人交互的Discord用户ID。
4. **Workspace Directory** — 您的编程项目所在的上级目录。

配置信息会被保存到 `~/.lazy-gravity/config.json` 中。

### 方案 B：从源码生成

```bash
git clone https://github.com/tokyoweb3/LazyGravity.git
cd LazyGravity
npm install
```

配置您的 `.env` 文件：

```bash
cp.env.example.env
```

编辑 `.env` 文件并填入所需的值：

```env
DISCORD_BOT_TOKEN=你的机器人令牌
GUILD_ID=你的服务器ID
ALLOWED_USER_IDS=123456789,987654321
WORKSPACE_BASE_DIR=~/Code
# ANTIGRAVITY_PATH=/path/to/antigravity.AppImage  # 可选：适用于Linux用户或自定义安装场景
```

接着启动机器人：

```bash
npm run start
```

#### 添加 Telegram 支持（可选）

1. 安装 grammy：`npm install grammy`
2. 在 Telegram 上通过 [@BotFather](https://t.me/BotFather) 创建机器人并复制其令牌。
3. 将以下内容添加到您的 `.env` 文件中：

```env
PLATFORMS=discord,telegram        # 若仅需支持 Telegram，则只需填写“telegram”
TELEGRAM_BOT_TOKEN=你的Telegram机器人令牌
TELEGRAM_ALLOWED_USER_IDS=123456789    # 你的Telegram数字用户ID
```

对于仅支持 Telegram 的部署场景，无需使用 Discord 的凭证（`DISCORD_BOT_TOKEN`、`CLIENT_ID`、`ALLOWED_USER_IDS`）。

或者，您也可以构建并使用 CLI：

```bash
npm run build
node dist/bin/cli.js setup    # 或：node dist/bin/cli.js start
```

### 通过 CDP 启动 Antigravity

LazyGravity 通过 Chrome DevTools 协议（CDP）与 Antigravity 建立连接。您需要以开启远程调试端口的方式启动 Antigravity。

```bash
# 最简便的方式（自动选择可用端口）：
lazy-gravity open
```

如果您是从源代码处克隆的，也可以使用附带的启动脚本（它们会自动检测 9222–9666 范围内的可用端口）：

#### macOS
双击仓库根目录中的**`start_antigravity_mac.command`**。

- **首次运行**：如果出现权限错误，请在终端中执行一次 `chmod +x start_antigravity_mac.command`。

#### Windows
双击仓库根目录下的 **`start_antigravity_win.bat`** 文件。

- **如果无法启动**：请确认 Antigravity IDE 是安装在 `"%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe"` 路径下。如果安装在其他位置，请右键点击该文件并更新可执行文件路径。
- **正在升级到 Antigravity 2.0？** Windows 版的可执行文件已被重命名为 `Antigravity IDE.exe`。如果您仍在使用旧版本的 `Antigravity.exe`，自动启动功能将无法找到它。请升级 Antigravity，或在您的 `.env` 文件中设置 `ANTIGRAVITY_PATH` 变量来指定路径。

#### Linux
在 Linux 系统上（尤其是使用 AppImages 时），`antigravity` 命令可能无法全局访问。
你可以在 `.env` 文件中设置 `ANTIGRAVITY_PATH` 环境变量，指定可执行文件的准确路径：
```env
ANTIGRAVITY_PATH=/opt/applications/antigravity.AppImage
```

> **提示**：CDP 端口会从候选端口（9222、9223、9333、9444、9555、9666）中自动扫描。
> 先启动 Antigravity，然后再启动机器人——两者会自动建立连接。

## 故障排除

如果机器人无响应或您更新了代码，请重启它：

1. **停止机器人**——在终端中按 `Ctrl + C`，或者：
   ```bash
   pkill -f "lazy-gravity"
   ```
2. **重启**
   ```bash
   lazy-gravity start
   # 或者，从源码目录运行：npm run start
   ```

## 故障排除

如果机器人无响应或您已更新代码，请重启它：

1. **停止机器人**——在终端中按下 `Ctrl + C`，或者：
   ```bash
   pkill -f "lazy-gravity"
   ```
2. **重启**
   ```bash
   lazy-gravity start
   # 或者，从源码目录执行：npm run start
   ```

如果重新启动了 Antigravity，机器人会自动尝试重新连接 CDP。发送消息也会触发自动重新连接项目。

运行 `lazy-gravity doctor` 可以诊断配置及连接问题。

# CDP 连接的工作原理

## CDP 连接的工作原理

<p align="center">
  <img src="https://raw.githubusercontent.com/tokyoweb3/LazyGravity/main/docs/images/architecture.svg" alt="LazyGravity 架构" width="100%" />
</p>

1. 机器人会扫描调试端口（默认为 9222），并自动检测 Antigravity 的目标实例。
2. 通过 WebSocket 连接到 CDP（针对 DOM 操作则使用 `Runtime.evaluate`）。
3. 将消息注入聊天输入框，监控 Antigravity 的响应，并截取屏幕截图。

**断开连接时**：会自动重试最多3次（`maxReconnectAttempts`参数设定）。若所有重试均失败，将会向当前使用的聊天平台发送错误通知。

## 平台架构

LazyGravity 采用了**平台抽象层**，因此其核心机器人逻辑与具体平台无关：

```
src/platform/
├── types.ts              # 共享接口（PlatformMessage、PlatformChannel 等）
├── adapter.ts            # PlatformAdapter 接口
├── richContentBuilder.ts # 用于富内容（嵌入内容/HTML）的不可变构建器
├── discord/              # Discord 适配器（discord.js 封装）
│   ├── discordAdapter.ts
│   └── wrappers.ts
└── telegram/             # Telegram 适配器（兼容 Grammy 的封装）
    ├── telegramAdapter.ts
    ├── telegramFormatter.ts  # Markdown 转换为 Telegram HTML 的工具
    └── wrappers.ts
```

这两个适配器都实现了相同的 `PlatformAdapter` 接口，并通过 `PlatformAdapterEvents` 发布事件。`EventRouter` 负责将事件分发到与平台无关的处理函数，而 `WorkspaceQueue` 则负责对不同平台上的每个工作空间中的并发请求进行序列化处理。

## 许可证

[MIT](LICENSE)
