# 🐾 AntigravityClaw (仮)

**AntigravityClaw** は、どこからでもスマホのDiscordアプリを使って、自宅PCで稼働する AI コーディング起動ツール (Antigravity 等) を遠隔操作・対話できるローカル完結型のセキュアなDiscord Botです。

外出先からの「あの件、直しておいて」「新しい機能の設計を始めて」といった自然言語の依頼を、自宅PCのマシンパワーとローカル環境で直接・安全に実行し、結果をDiscordで受け取ることができます。

## ✨ 主な機能

1. 🔒 **完全ローカル・セキュア設計**
   - 外部サーバーへのデプロイやWebHook(ポート開放/SSH)は**一切不要**。あなたのPC内でプロセスとして常駐し、Discordと直接通信します。
   - **ホワイトリスト制御**: 許可されたDiscordユーザーID (`allowedUserIds`) 以外からのアクセスは完全に遮断されます。
   - **安全な鍵管理**: Bot TokenやAPIキーはセキュアにPC内ローカル保管され（`.env`のパーミッション厳格化等）、ソースコード上には一切記述されません。
   - **パストラバーサル防止 & リソース保護**: プロジェクト外のディレクトリへの不正アクセスを防ぐJail(サンドボックス)的制御に加え、タスクの同時実行数を制限しPCのフリーズ（DoS）を防ぎます。

2. 📂 **ワークスペース管理 (チャンネル↔ディレクトリ バインディング)**
   - `/workspace` コマンドでDiscordチャンネルとローカルPCのプロジェクトディレクトリを紐付け。セレクトメニューやボタンによるインタラクティブなUIで直感的に操作できます。
   - バインドされたチャンネルからのメッセージは、自動的にワークスペースのコンテキスト付きでAntigravityに送信されます。

3. 💬 **コンテキストを引き継ぐEmbed返信**
   - 実行結果はリッチなEmbed形式で通知。その結果に対してDiscordの「返信（Reply）」機能を使って指示を出すことで、Botが過去の文脈や対象ディレクトリを正確に引き継いで後続処理を行います。

4. 📊 **長時間ジョブのリアルタイム監視**
   - 長時間かかるビルドや生成推論タスクのプログレスを、メッセージのリアルタイム「編集（Edit）」機能を使って進捗率や状況として表示します。

5. ⏰ **Cron対応のスケジュール・定期実行タスク機能**
   - `/schedule` コマンドで、「毎日朝9時にテストを実行して」「毎週末に依存関係をアップデートして」といった定期実行を仕掛けることができます。

6. 📎 **添付ファイルとコンテキスト解析**
   - Discordに送信した画像（スクショ等）やテキストファイルを読み取り、Antigravity側にコンテキストとして自動で渡すことができます。

## 🚀 使い方とコマンド一覧

### 🪄 メッセージでの自然言語指示
チャンネル内でBotに向けてメンション(`@AntigravityClaw`)して自然言語で指示を出すだけです。
> `@AntigravityClaw src/components 配下をリファクタリングして。昨日のスクショみたいなレイアウトにして` (画像添付)

### 💻 スラッシュコマンド（クイックアクション）

- `⚙️ /models [model_name]`
  - 利用するLLM（例: `gpt-4o`, `claude-3-opus`, `gemini-1.5-pro` など）をワンタップで切り替えます。
- `⚙️ /mode [mode_name]`
  - 実行モード（例: `code`, `architect`, `ask` など）を切り替えます。
- `📝 /templates [template_name]`
  - よく使うプロンプト（例: `PR作成`, `エラー調査`）を呼び出して即時実行します。新規登録も可能です。
- `📂 /workspace show`
  - 現在のチャンネルのワークスペースバインディングを表示し、セレクトメニューからワークスペースを選択・切替できます。
- `📂 /workspace bind <path>`
  - 現在のチャンネルを指定したワークスペースディレクトリにバインドします。バインド後、そのチャンネルからのメッセージは自動的にワークスペースのコンテキスト付きでAntigravityに送信されます。
- `📂 /workspace unbind`
  - 現在のチャンネルのワークスペースバインドを解除し、通常モードに戻します。
- `📂 /workspace list`
  - サーバー内の全チャンネルのワークスペースバインディング一覧を表示します。
- `🛑 /stop`
  - 実行中の時間のかかるタスクや暴走したAIプロセスを安全に強制終了（Kill）します。
- `⏰ /schedule add [cron式] [プロンプト]`
  - 定期実行タスクを登録します。
- `⏰ /schedules list`
  - 現在登録されているスケジュール一覧を表示・管理（削除・停止）します。
- `💬 /chat new`
  - ワークスペースカテゴリ配下に新しいセッションチャンネルを作成し、Antigravityで新規チャットを開始します。
- `💬 /chat status`
  - 現在のチャットセッション情報（セッション番号、ワークスペース、リネーム状態など）を表示します。
- `💬 /chat list`
  - 同ワークスペース内の全チャットセッション一覧を表示します。
- `📸 /screenshot`
  - Antigravityの現在の画面をキャプチャしてDiscordに画像として送信します。
- `🔌 /cdp connect`
  - AntigravityへCDP（Chrome DevTools Protocol）で手動接続を試みます。
- `🔌 /cdp status`
  - 現在のAntigravityとのCDP接続ステータス（接続中/未接続など）を表示します。

---

## 🔄 運用とトラブルシューティング (再起動など)

Botの調子が悪い場合や、コードを更新した場合は、以下の手順でプロセスを再起動してください。

1. **プロセスを終了する**
   動かしているターミナルで `Ctrl + C` を押すか、以下のコマンドで現在動いているBotプロセスを強制終了します。
   ```bash
   pkill -f "src/index.ts"
   ```
2. **再度起動する**
   プロジェクトのディレクトリで以下のコマンドを実行します。
   ```bash
   npx ts-node src/index.ts
   # または npm run start
   ```

Antigravity本体を再起動した場合は、Botが自動でCDPの再接続を試みますが、もし繋がらない場合はDiscord上から `/cdp connect` をお試しください。

---

## 🛠️ セットアップ (たったの3ステップ)

1. **インストール & 起動**
   ```bash
   git clone https://github.com/yourusername/antigravity-claw.git
   cd antigravity-claw
   npm install
   ```

2. **初期設定 (初回のみ)**
   ```bash
   npm run setup
   ```
   インタラクティブなプロンプトに従って、Discord Bot Token と 許可する自分のDiscord User IDを入力します。入力されたトークンはPCのセキュア領域に暗号化保存されます。

3. **Antigravityをデバッグモードで起動（CDP接続に必要）**

   AntigravityClawはChrome DevTools Protocol (CDP) を使ってAntigravityのUIを直接操作します。
   そのため、**Antigravity（VSCode/Electron系）をリモートデバッグポート付きで起動**する必要があります。

   **VSCode / Antigravity の起動方法:**
   ```bash
   # macOS / Linux
   /path/to/code --remote-debugging-port=9222

   # Windows
   code.exe --remote-debugging-port=9222
   ```

   または `.env` ファイルで対象ポートを設定できます:
   ```env
   # .env
   CDP_PORT=9222          # Antigravityのデバッグポート（デフォルト: 9222）
   ALLOWED_USER_IDS=123456789,987654321
   DISCORD_BOT_TOKEN=your_token_here
   WORKSPACE_BASE_DIR=~/Code  # ワークスペースのベースディレクトリ（デフォルト: ~/Code）
   ```

   > **💡 ヒント**: 複数ポートを自動スキャン（9222, 9000-9003）します。
   > Antigravityを起動後にBotを起動すれば自動で接続されます。

4. **実行**
   ```bash
   npm run start
   ```
   これでBotがオンラインになります！Discordから話しかけてみてください。

---

## 🔗 CDP接続の仕組み

AntigravityClawは以下のようにAntigravityのUIへ接続します:

```
Discord (スマホ) ←→ AntigravityClaw Bot ←→ CDP (WebSocket) ←→ Antigravity UI
```

1. Botがデバッグポート（デフォルト: 9222）をスキャンし、Antigravityのターゲットを自動検出
2. WebSocket経由でCDPに接続（`Runtime.evaluate` でDOM操作）
3. チャット入力欄へのメッセージ注入、AIレスポンスの監視、スクリーンショット取得などを実行

**接続が切れた場合**: 最大3回まで自動再接続を試みます（`maxReconnectAttempts`で設定可）。
接続に失敗し続けた場合は、Discordにエラーメッセージ（⚠️）が送信されます。
