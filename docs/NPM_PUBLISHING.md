# NPM Publishing Guide (Fork Maintainers)

このリポジトリを fork して npm 公開するための最短手順です。

## 1) package 情報を fork 用に変更

`package.json` の以下を自分の fork 情報へ更新してください。

- `name`（公開したい npm package 名）
- `repository.url`
- `bugs.url`
- `homepage`
- `author`

> 既存の `lazy-gravity` 名は本家と衝突するため、fork では通常 `@scope/name` を推奨します。

---

## 2) ローカルで公開物を確認

```bash
npm ci
npm run build
npm run test
npm run pack:check
```

`npm run pack:check` で実際に npm に含まれるファイルを dry-run できます。

---

## 3) 手動で公開したい場合

```bash
npm login
npm publish --access public
```

- scoped package (`@scope/name`) の場合は `--access public` が必要です。

---

## 4) GitHub Actions + semantic-release で自動公開する場合

このリポジトリは `.github/workflows/release.yml` と `.releaserc.json` で自動公開対応済みです。

必要な設定:

1. GitHub Repository Secrets に npm token を設定（必要な場合）
2. npm 側で Trusted Publishing か token publish を有効化
3. `main` へマージ後、release workflow が走ることを確認

ローカル検証:

```bash
npm run release:dry-run
```

---

## 5) バージョニング規約

semantic-release で version を自動決定するため、コミットメッセージは Conventional Commits を推奨します。

- `feat:` → minor
- `fix:` → patch
- `feat!:`, `BREAKING CHANGE:` → major

