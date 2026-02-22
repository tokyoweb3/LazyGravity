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

## 3. ワークスペース管理（カテゴリ↔ワークスペース、チャンネル↔チャットセッション）
Discordの **カテゴリ = ワークスペース**、**チャンネル = チャットセッション** として管理します。

### 実装済みの機能
- **`/workspace`**: ベースディレクトリ配下のサブディレクトリ一覧（最大25件）をセレクトメニューで表示。選択するとカテゴリ + `session-1` チャンネルを自動作成しバインド。
- **`/chat new`**: 現在のワークスペースカテゴリ配下に新しいセッションチャンネル（`session-N`）を作成し、Antigravityで新規チャットを開始。
- **`/chat status`**: 現在のチャットセッション情報（セッション番号、ワークスペース、リネーム状態）を表示。
- **`/chat list`**: 同ワークスペースの全チャットセッション一覧を表示。
- **自動リネーム**: セッションチャンネルで初回メッセージ送信時、プロンプト内容からチャンネル名を自動生成してリネーム（例: `session-1` → `1-react認証バグ修正`）。

### データフロー
1. ユーザーが `/workspace` → セレクトメニューでワークスペースを選択
2. `ChannelManager.ensureCategory()` でカテゴリを作成、`createSessionChannel()` で `session-1` チャンネルを作成
3. `WorkspaceBindingRepository` が `workspace_bindings` テーブルに channel_id ↔ workspace_path を永続化
4. `ChatSessionRepository` が `chat_sessions` テーブルにセッション情報（カテゴリID、セッション番号、リネーム状態）を永続化
5. `/chat new` → 同カテゴリ配下に `session-N` を新規作成 + Antigravityで新規チャット開始
6. 初回メッセージ送信時 → `TitleGeneratorService` がタイトル生成 → `ChannelManager.renameChannel()` でリネーム

### アーキテクチャ
```
src/database/workspaceBindingRepository.ts  — SQLite CRUD (workspace_bindings テーブル)
src/database/chatSessionRepository.ts       — SQLite CRUD (chat_sessions テーブル)
src/services/workspaceService.ts            — FS操作・パス検証 (scanWorkspaces, validatePath)
src/services/channelManager.ts              — Discord カテゴリ/チャンネル管理 (ensureCategory, createSessionChannel, renameChannel)
src/services/titleGeneratorService.ts       — チャンネル名自動生成 (CDP経由 + テキスト抽出フォールバック)
src/services/chatSessionService.ts          — Antigravity UI操作 (CDP経由で新規チャット開始・セッション情報取得)
src/commands/workspaceCommandHandler.ts     — /workspace コマンド + セレクトメニュー処理
src/commands/chatCommandHandler.ts          — /chat コマンド (new, status, list)
```

### 将来の拡展
- CDP経由でAntigravityのワークスペースを直接切り替え（現在はプロンプトプレフィックス方式）
- LLM APIによる高精度タイトル生成（現在はテキスト抽出ベース）

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
