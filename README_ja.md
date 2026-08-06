<!-- hy-mt2-i18n:start -->
[English](./README.md) | [中文](./README_zh-CN.md) | **日本語** | [Español](./README_es.md)
<!-- hy-mt2-i18n:end -->

<p align="center">
  <img src="https://raw.githubusercontent.com/tokyoweb3/LazyGravity/main/docs/assets/LazyGravityBanner.png" alt="LazyGravityのバナー" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/lazy-gravity?style=flat-square&color=blue" alt="バージョン" />
  <img src="https://img.shields.io/badge/Antigravity-1.19.5-ff6b35?style=flat-square" alt="Antigravity" />
  <img src="https://img.shields.io/badge/node-18.x+-brightgreen?style=flat-square&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/discord.js-14.x-5865F2?style=flat-square&logo=discord&logoColor=white" alt="discord.js" />
  <img src="https://img.shields.io/badge/telegram-optional-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram" />
  <img src="https://img.shields.io/badge/protocol-CDP%20%2F%20WebSocket-orange?style=flat-square" alt="CDP/WebSocket" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="ライセンス" />
</p>

# LazyGravity

**LazyGravity**とは、スマートフォンを含むどこからでも、自宅のPC上で[Antigravity](https://antigravity.dev)を遠隔操作できる、ローカルで安全なボットです。**Discord**および**Telegram**に対応しており、Telegramはオプションです。

スマートフォンから「そのバグを直して」といった自然言語の指示や「新しい機能の設計を始めて」といったリクエストを送信できます。Antigravityは自宅のPC上で全リソースを活用してこれらの指示をローカルで実行し、結果をチャットプラットフォームに返信します。

https://github.com/user-attachments/assets/08eac63e-5ede-469b-ac6c-1c40ec77b0c0


## 迅速セットアップ

実行環境：**Node >= 18**。

```bash
npm install -g lazy-gravity
lazy-gravity setup
```

インタラクティブなウィザードが、Discordボットの作成、トークンの設定、ワークスペースの構成を段階的に案内します。設定が完了すると：

```bash
lazy-gravity open     # CDPを有効にしてAntigravityを起動する
lazy-gravity start    # ボットを起動する（デフォルトはDiscord、または両プラットフォーム）

インストールせずに直接実行するには：

```bash
npx lazy-gravity
```

# 機能

## 機能概要

1. **完全なローカル処理と高いセキュリティ**
   - **外部サーバーやポートの公開がない** — パソコン上でローカルプロセスとして実行され、Discord/Telegramと直接通信します。
   - **ホワイトリストによるアクセス制御**：認可されたユーザーIDのみがボットとやり取りできます（プラットフォームごとの許可リストに基づく）。
   - **安全な資格情報管理**：ボットトークンやAPIキーはローカルに保存され、ソースコード内には一切保存されません。
   - **パストラバーサルの防止とリソース保護**：サンドボックス化されたディレクトリアクセスと同時実行タスクの制限により、悪用を防ぎます。

2. **マルチプラットフォーム対応**
   - **Discord**（デフォルト）：スラッシュコマンド、リッチエンベッド、リアクション、チャンネル管理など、全機能が利用可能。
   - **Telegram**（オプション）：プロンプトの送信、応答の受信、インラインキーボードボタンの使用が可能。[grammy](https://grammy.dev/)が必要（`npm install grammy`）。
   - 単一のプロセスから両プラットフォームを同時に実行するか、どちらか一方を単独で使用できる。

3. **プロジェクト管理（チャンネルとディレクトリの紐付け）**
   - **Discord**: インタラクティブな選択メニューを使い、`/project` コマンドでチャンネルをローカルのプロジェクトディレクトリに紐付けます。
   - **Telegram**: `/project` コマンドを使用して、チャットをワークスペースのディレクトリに紐付けます。
   - 紐付けられたチャンネルやチャットで送信されたメッセージは、適切なプロジェクトコンテキストと共に自動的に Antigravity に転送されます。

4. **コンテキストを考慮した返信**
   - **Discord**：結果はリッチなエンベッドとして表示されます。返信機能を使えば、全てのコンテキストが保持されたまま会話を続けられます。
   - **Telegram**：結果はインラインキーボードボタン付きの形式化されたHTMLメッセージとして送信されます。

5. **リアルタイム進捗監視**
   - 長時間実行されるAntigravityのタスクは、進捗状況を一連のメッセージとして報告します（配信確認／計画中／分析中／実行中／実装中／最終まとめ）。

6. **ファイルの添付とコンテキストの解析**
   - 画像（スクリーンショット、モックアップ）やテキストファイルを送信すると、それらは自動的にコンテキストとしてAntigravityに転送されます。

## 使用方法とコマンド

### ネイティブ言語メッセージ
対象のチャンネルに直接テキストを入力するだけです：
> `src/components 内のコンポーネントをリファクタリングしてください。レイアウトを昨日のスクリーンショットのようにしてください`（画像を添付）

### スラッシュコマンド

- `📂 /project list` — 選択メニューからプロジェクトを閲覧可能。1つを選ぶと自動的にカテゴリーおよびセッションチャンネルが作成されます。
- `📂 /project create <name>` — 新しいプロジェクトディレクトリー＋Discordのカテゴリー/チャンネルを作成します。
- `💬 /new` — 現在のプロジェクトで新しいAntigravityチャットセッションを開始します。
- `💬 /chat` — 現在のセッション情報を表示し、プロジェクト内の全セッションを一覧表示します。
- `⚙️ /model [name]` — LLMモデルを切り替えます（例: `gpt-4o`, `claude-3-opus`, `gemini-1.5-pro`）。
- `⚙️ /mode` — ドロップダウンから実行モードを切り替えます（`code`, `architect`, `ask` など）。
- `📝 /template list` — 登録済みのテンプレートと実行ボタンを表示します。
- `📝 /template add <name> <prompt>` — 新しいプロンプトテンプレートを登録します。
- `📝 /template delete <name>` — テンプレートを削除します。
- `📅 /schedule list` — 次回の実行予定時刻を含む、スケジュール済みのタスクをすべて表示します。
- `📅 /schedule add <cron> <prompt>` — 現在のチャンネルが紐付けられているプロジェクト向けに定期的なタスクを登録します。
- `📅 /schedule remove <id>` — IDによってスケジュール済みのタスクを削除します。
- `📅 /schedule clear` — すべてのスケジュール済みタスクを削除し、タスクIDのカウンターをリセットします。
- `📅 /schedule backup` — スケジュール済みのタスクをJSONファイルとして添付してエクスポートします。
- `📅 /schedule restore <file>` — JSONファイルからスケジュール済みのタスクを復元します。
- `🔗 /join` — 既存のAntigravityセッションに参加します（過去20件までの最近のセッションが表示されます）。
- `🔗 /mirror` — 現在のセッションでPCとDiscord間のメッセージミラーリングをオン/オフ切り替えます。
- `🛑 /stop` — 実行中のAntigravityタスクを強制停止します。
- `🛑 /shutdown` — アクティブなCDPプロジェクトの接続やセッションのバインドは維持したままIDEをシャットダウンします。
- `📸 /screenshot` — Antigravityの現在の画面をキャプチャして送信します。
- `🔧 /status` — ボットの接続状況、現在のモード、およびアクティブなプロジェクトを表示します。
- `💓 /heartbeat [on|off|status]` — 定期的なボットのハートビート通知を設定します。
- `✅ /autoaccept [on|off|status]` — ファイル編集ダイアログの自動承認をオン/オフ切り替えます。
- `📝 /output [embed|plain]` — 出力形式をEmbedとPlain Textの間で切り替えます（Plain Textの方がスマホでコピーしやすいです）。
- `📋 /logs [lines] [level]` — 最近のボットログを確認できます（一時的なものです）。
- `🏓 /ping` — ボットの応答遅延をチェックします。
- `🧹 /cleanup [days]` — 無効状態のセッションチャンネルをスキャンして削除します（デフォルト：7日間）。
- `❓ /help` — 利用可能なコマンドの一覧を表示します。

### Telegramコマンド

Telegramのコマンドでは、サブコマンド構文の代わりにアンダースコアが使用されます（Telegramではコマンド名にハイフンやスペースを使用できません）。

- `/project` — ワークスペースのバインディングを管理する（一覧表示、選択、作成）
- `/project_create <name>` — 新しいワークスペースディレクトリを作成する
- `/new` — 新しいチャットセッションを開始する
- `/template` — 実行ボタン付きのプロンプトテンプレートを一覧表示する
- `/template_add <name> <prompt>` — 新しいプロンプトテンプレートを追加する
- `/template_delete <name>` — プロンプトテンプレートを削除する
- `/mode` — 実行モードを切り替える
- `/model` — LLMモデルを切り替える
- `/screenshot` — Antigravityのスクリーンショットを撮影する
- `/autoaccept [on|off]` — 自動承認モードをオン/オフに切り替える
- `/logs [count]` — 最近のログエントリを表示する
- `/stop` — 現在実行中のLLM生成を中断する
- `/status` — ボットの状態と接続状況を表示する
- `/ping` — ボットの応答遅延を確認する
- `/help` — 利用可能なコマンド一覧を表示する

### CLIコマンド

```bash
lazy-gravity              # 自動モード：設定がなければセットアップを実行し、そうでなければボットを起動する
lazy-gravity setup        # インタラクティブなセットアップウィザード
lazy-gravity open         # CDPを使ってAntigravityを起動する（利用可能なポートを自動選択）
lazy-gravity start        # Discordボットを起動する
lazy-gravity doctor       # 環境と依存関係をチェックする
lazy-gravity --verbose    # デバッグレベルのログを表示する（CDPの詳細、検出器イベントなど）
lazy-gravity --quiet      # エラーのみを表示する
lazy-gravity --version    # バージョン情報を表示する
lazy-gravity --help       # ヘルプを表示する
```

---

## 設定の詳細手順

### オプションA: npm（推奨）

```bash
npm install -g lazy-gravity
lazy-gravity setup
```

ウィザードが4つのステップを通して案内してくれます：

1. **Discord Bot Token** — [Discord Developer Portal](https://discord.com/developers/applications)でボットを作成してください。
   - Privileged Gateway Intentsを有効にします：**PRESENCE, SERVER MEMBERS, MESSAGE CONTENT**。
   - 次のボット権限を持つOAuth2招待URLを生成します：**Manage Channels**（`/project`に必要）、**Send Messages**、**Embed Links**、**Attach Files**、**Read Message History**、**Add Reactions**。
   - ボットをサーバーに招待したら、ボットトークンをコピーしてください。Client IDはトークンから自動的に抽出されます。
2. **Guild (Server) ID** — スラッシュコマンドの即時登録用です（任意。スキップするにはEnterキーを押してください）。
3. **Allowed User IDs** — ボットとやり取りできるように許可されたDiscordユーザーのIDです。
4. **Workspace Directory** — コーディングプロジェクトが保存されている親ディレクトリです。

設定内容は `~/.lazy-gravity/config.json` に保存されます。

### オプションB：ソースから

```bash
git clone https://github.com/tokyoweb3/LazyGravity.git
cd LazyGravity
npm install
```

`.env` ファイルの設定を行います：

```bash
cp.env.example.env
```

`.env` ファイルを編集し、必要な値を記入してください：

```env
DISCORD_BOT_TOKEN=your_bot_token_here
GUILD_ID=your_guild_id_here
ALLOWED_USER_IDS=123456789,987654321
WORKSPACE_BASE_DIR=~/Code
# ANTIGRAVITY_PATH=/path/to/antigravity.AppImage  # オプション：Linuxユーザーやカスタムインストール向け
```

次にボットを起動します：

```bash
npm run start
```

#### Telegramサポートの追加（オプション）

1. grammyをインストールする：`npm install grammy`
2. Telegram上の[@BotFather](https://t.me/BotFather)を通じてボットを作成し、トークンをコピーする。
3. `.env`ファイルに以下の内容を追加する：

```env
PLATFORMS=discord,telegram        # Telegram専用の場合は「telegram」のみにしても構いません
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_ALLOWED_USER_IDS=123456789    # ご自身のTelegramの数値形式のユーザーID
```

Telegramのみでのデプロイの場合、Discordの認証情報（`DISCORD_BOT_TOKEN`、`CLIENT_ID`、`ALLOWED_USER_IDS`）は必要ありません。

または、CLIをビルドして使用することもできます：

```bash
npm run build
node dist/bin/cli.js setup    # または: node dist/bin/cli.js start
```

### CDPを使用してAntigravityを起動する

LazyGravityはChrome DevTools Protocol（CDP）を介してAntigravityに接続します。
Antigravityを起動する際には、リモートデバッグポートを有効にする必要があります。

```bash
# 最も簡単な方法（利用可能なポートを自動で選択）：
lazy-gravity open
```

ソースからクローンした場合でも、同梱されているランチャースクリプトを使用できます（これらは9222～9666の範囲から利用可能なポートを自動的に検出します）。

#### macOS
リポジトリのルートにある**`start_antigravity_mac.command`**をダブルクリックしてください。

- **初回実行時**：権限エラーが表示された場合は、ターミナルで一度 `chmod +x start_antigravity_mac.command` を実行してください。

#### Windows
リポジトリのルートにある**`start_antigravity_win.bat`**をダブルクリックしてください。

- **起動しない場合**：`"%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe"` にAntigravity IDEがインストールされているか確認してください。別の場所にインストールされている場合は、そのファイルを右クリックし、実行可能ファイルのパスを更新してください。
- **Antigravity 2.0にアップグレードしましたか？** Windows向けの実行ファイルは `Antigravity IDE.exe` に名前が変更されました。まだ古い `Antigravity.exe` のインストール版を使用している場合、自動起動機能では見つからなくなります。Antigravityをアップグレードするか、`.env` ファイルで `ANTIGRAVITY_PATH` を設定して上書きしてください。

#### Linux
Linux上では（特にAppImagesを使用している場合）、`antigravity`コマンドがグローバルに利用可能でないことがあります。
`.env`ファイル内の`ANTIGRAVITY_PATH`環境変数を設定することで、実行ファイルの正確なパスを指定できます：
```env
ANTIGRAVITY_PATH=/opt/applications/antigravity.AppImage
```

> **ヒント**: CDPポートは、候補となるポート（9222、9223、9333、9444、9555、9666）から自動的にスキャンされます。
> まずAntigravityを起動し、その後ボットを起動すると自動的に接続されます。

---

## トラブルシューティング

ボットが応答しない場合やコードを更新した場合は、再起動してください：

1. **ボットを停止する** — ターミナルで `Ctrl + C` を押すか、または：
   ```bash
   pkill -f "lazy-gravity"
   ```
2. **再起動する**
   ```bash
   lazy-gravity start
   # または、ソースからは：npm run start
   ```

Antigravityが再起動されると、ボットは自動的にCDPの再接続を試みます。メッセージを送信すると、プロジェクトの自動的な再接続が行われます。

設定や接続に関する問題を診断するには、`lazy-gravity doctor` を実行してください。

# 厳格な制約事項

## CDP接続の動作原理

<p align="center">
  <img src="https://raw.githubusercontent.com/tokyoweb3/LazyGravity/main/docs/images/architecture.svg" alt="LazyGravityのアーキテクチャ" width="100%" />
</p>

1. ボットはデバッグポート（デフォルト：9222）をスキャンし、Antigravityのターゲットを自動的に検出します。
2. WebSocket経由でCDPに接続し（DOM操作の場合は`Runtime.evaluate`を使用）、
3. チャット入力欄にメッセージを挿入し、Antigravityの応答を監視しながらスクリーンショットを撮影します。

**接続切断時**：`maxReconnectAttempts`に指定された最大3回まで自動的に再試行します。すべての再試行が失敗した場合、アクティブなチャットプラットフォームにエラー通知が送信されます。

## プラットフォームのアーキテクチャ

LazyGravityは**プラットフォーム抽象化レイヤー**を採用しているため、コアのボットロジックはプラットフォームに依存しません：

```
src/platform/
├── types.ts              # 共有インターフェース（PlatformMessage、PlatformChannel など）
├── adapter.ts            # PlatformAdapter インターフェース
├── richContentBuilder.ts # リッチコンテンツ用の不変ビルダー（embeds/HTML）
├── discord/              # Discord アダプタ（discord.js ラッパー）
│   ├── discordAdapter.ts
│   └── wrappers.ts
└── telegram/             # Telegram アダプタ（grammy 互換ラッパー）
    ├── telegramAdapter.ts
    ├── telegramFormatter.ts  # Markdown → Telegram HTML 変換
    └── wrappers.ts
```

両方のアダプターは同じ `PlatformAdapter` インターフェースを実装し、`PlatformAdapterEvents` を通じてイベントを発行します。`EventRouter` はプラットフォームに依存しないハンドラーにイベントを転送し、`WorkspaceQueue` は各ワークスペース内の並行するリクエストをプラットフォーム間でシリアル化します。

## ライセンス

[MIT](LICENSE)
