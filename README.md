# LazyGravity Plus

> Antigravity を **Discord から快適に遠隔操作**するために作り直した、実運用向けフォーク版。

LazyGravity Plus は、Antigravity をローカルPCで動かしつつ、Discord から安全に操作できる bot です。  
このフォークは **Discord中心** で使う前提で、アカウント切替・DeepThink・運用性を強化しています。

---

## このフォークの方針

- Discord運用を最優先（Telegram はオプション扱い）
- 実務で困るポイント（誤接続・設定の揮発）を潰す
- チャネルごとに「どう使うか」を固定できる

---

## 主な強化ポイント

### 1. Antigravity 複数アカウント対応
- `ANTIGRAVITY_ACCOUNTS` で複数インスタンス（port）を定義
- `/account [name]` でアカウント切替
- アカウント選択は **ユーザー単位 + チャネル単位** で保持
- ワークスペース接続時に安全なフォールバックを実施

### 2. DeepThink ループ
- `/loop [count]` でチャネルごとの推論深度を設定（1〜20）
- 設定値は永続化され、再起動後も維持
- 複雑タスクで「1回で終わる」問題を抑制

### 3. Discord 運用向け可視化
- `/status` で現在チャネルの `Account` / `DeepThink` を確認可能
- モード・接続・ミラー状態を1画面で把握

---

## クイックスタート

Node.js 18+ が必要です。

```bash
npm install -g lazy-gravity
lazy-gravity setup
lazy-gravity open
lazy-gravity start
```

ソースから使う場合:

```bash
git clone https://github.com/tokyoweb3/LazyGravityPlus.git
cd LazyGravityPlus
npm install
cp .env.example .env
npm run build
npm run start
```

---

## 必須設定（.env）

```env
DISCORD_BOT_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_guild_id_here
ALLOWED_USER_IDS=123456789012345678
WORKSPACE_BASE_DIR=~/Code

# このフォーク推奨
BOT_LANGUAGE=ja
ANTIGRAVITY_ACCOUNTS=default:9222,work:9333
```

### `ANTIGRAVITY_ACCOUNTS` の例
- `default:9222` → 通常作業
- `work:9333` → 検証/別アカウント用

---

## Discord コマンド

- `/project list` — プロジェクト一覧
- `/project create <name>` — 新規プロジェクト作成
- `/new` — 新規チャットセッション
- `/chat` — セッション状態確認
- `/mode` — 実行モード切替
- `/model [name]` — モデル切替
- `/account [name]` — Antigravityアカウント確認/切替
- `/loop [count]` — DeepThink回数の確認/設定
- `/status` — 接続状態 + Account + DeepThink 表示
- `/stop` — 生成停止
- `/screenshot` — スクリーンショット取得
- `/logs [lines] [level]` — ログ確認
- `/help` — ヘルプ

---

## セキュリティ

- 外部公開サーバー不要（ローカル実行）
- 許可ユーザーIDで制御
- 設定はローカル保存

---

## 運用メモ

- まず `/account` と `/loop` をチャネルごとに設定すると安定します。
- 長文/難問タスクは `loop` を 3〜8 程度に上げると改善しやすいです。
- 反応が不安定なときは `/status` で Account と接続先を確認してください。

---

## NPM公開（フォーク運用者向け）

この fork を npm 公開したい場合は、まず以下を実施してください。

1. `package.json` の `name / repository / bugs / homepage / author` を fork 用に更新
2. 公開物チェック:

```bash
npm ci
npm run build
npm run test
npm run pack:check
```

3. 手動公開:

```bash
npm login
npm publish --access public
```

4. 自動公開を使う場合は `npm run release:dry-run` で事前確認

詳細は `docs/NPM_PUBLISHING.md` を参照。

## ライセンス

MIT
