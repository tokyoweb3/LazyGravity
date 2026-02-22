# Architecture & Core Design

## 1. システム全体構成 / System Overview
AntigravityClaw は外部の中間サーバーを経由せず、ユーザーのローカルPC内で完結してDiscord API（WSS経由）とやり取りします。

```mermaid
graph TD
    A[📱 Discord アプリ (スマホ/PC)] -->|WebSocket (Gateway)| B[🔒 Local PC (AntigravityClaw Bot)]
    B -->|REST API| A
    
    subgraph Local Environment (Your PC)
        B -->|Spawn/Execute| C[Antigravity CLI / AI Coding Agent]
        B -->|Read/Write| D[📁 Local Workspaces]
        B -.->|Secure Storage| E[.env File (Local)]
        B -.->|Persist State| F[SQLite Database]
    end
```

## 2. 認証・セキュリティ設計
外部公開をしないためポートマッピングやWebhookは使用しません。

- **Bot TokenとAPI Keyの管理:**
  - `dotenv`パッケージを利用し、ローカルの `.env` ファイルに保存しますが、セキュリティを高めるため、**ファイルパーミッションを厳格化 (例: `chmod 600`)** することを推奨します（必要に応じてOSネイティブのクレデンシャル連携も検討）。
  - GitHub上には `.env.example` のみを提供し、機密情報の漏洩を防止します。
- **認可 (Authorization):**
  - メッセージ受信イベント (`messageCreate`), インタラクション受信 (`interactionCreate`) イベントの冒頭にミドルウェア層を設け、発信者の `userId` がホワイトリストの `allowedUserIds` に含まれるか**必ず最初に評価**する。
- **入力値の検証とパストラバーサル対策 (Directory Traversal Protection):**
  - ユーザー入力やワークスペース指定に対するディレクトリトラバーサル攻撃（例: `../../etc/passwd`）を防ぐため、基準となるルートディレクトリ（`WORKSPACE_BASE_DIR`）を定義し、すべてのパス解決がその配下に収まることを `path.resolve` 等を用いて厳格にバリデーションします。

## 3. スマート・ルーティング機能
「どのワークスペース（ディレクトリ）への指示か」をDiscordのチャンネル構成とリンクさせます。

### チャンネル構造のルール
- 毎回の指示に対して固定の1チャンネルを使うのではなく、「ワークスペース単位（プロジェクト）」の**カテゴリ**を作成。
- その配下に、タスクやスレッドごとの**チャンネル**を生成する（またはDiscord標準のフォーラム/スレッド機能を利用）。
- **Botの振る舞い:**
  - `!workspace bind [パス]` 等でパスとカテゴリを紐付けるか、BotからPCの特定ディレクトリツリー（例: `~/Code/`）を読み取ってインタラクティブにカテゴリを作成するUIを提供する。

## 4. コンテキスト（文脈）の引継ぎ
LLMエージェントへの指示と実行結果を、Discordの「リプライチェーン」によって管理・永続化する。

- **Embedへのメタデータ埋め込み:**
  - 長いログや結果はEmbedに格納。
  - Embedの `Footer` や `Author URL` などの見えにくい部分、またはローカルのSQLiteにメッセージIDをキーとしたステートを保存し、対象のファイルパスや直前の指示履歴（タスクID）を保持。
- **リプライ(Reply)による後続指示:**
  - ユーザーがBotの出力したEmbedに対して「返信」を行った場合、Botは親メッセージに含まれるメタデータ（あるいはSQLiteから引いた文脈）を元に、「続きから作業している」状態として元のディレクトリとコンテキストをAntigravityに渡す。

## 5. 定期実行タスク (Cron / Scheduling)
- ローカルPCの `node-cron` を使用。
- SQLiteでスケジュール設定を永続化（`id`, `cron_expression`, `prompt`, `workspace_id`, `status`）。
- Bot起動時にSQLiteから定義を読み込み、オンメモリのnode-cronに再スケジュールする機能が必要。

## 6. プログレスバーのリアルタイム更新
- Antigravityなどの裏側のAIエージェントのログやステータス出力（標準出力や特定フォーマットのログ）をストリームで監視する。
- 数秒（例: 3〜5秒）に一度だけDiscordのメッセージ編集API (`message.edit`) を叩き、Rate Limit（API制限）に引っかからないようDebounce/Throttle制御を強くかけること。

## 7. Antigravity プロセスの起動方式 (CLI Spawn) とリソース制御
- **CLI Spawn:** Antigravity(または対象ディレクトリのAIコーディングツール)は、`child_process.spawn` を用いて、独立したバックグラウンドプロセスとして起動します。
- **排他制御とキューイング (Task Queue):** ローカルPCのリソース枯渇（DoS状態）を防ぐため、ワークスペース単位、または全体での同時実行タスク数を制限（Mutex/Queue）します。
- **強制終了機能 (Kill Switch):** 無限ループや暴走に備え、発行したプロセスのPIDを管理し、Discordからの中断コマンド (`/stop`) でプロセスツリーを強制終了（kill）できる仕組みを設けます。
- **Discord制限の回避 (Message Chunking):** Discordの文字数制限（通常2000文字、Embedで4096文字）を超える大量の出力に対しては、長文を分割送信する、またはテキストファイルとして添付送信するフォールバック機構を実装します。
