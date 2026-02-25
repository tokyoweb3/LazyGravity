# Contributing to LazyGravity

Thank you for your interest in contributing to LazyGravity! This guide will help you get started.

## Development Setup

### Prerequisites

- **Node.js** >= 18
- **npm** (comes with Node.js)
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))

### Getting Started

```bash
git clone https://github.com/tokyoweb3/LazyGravity.git
cd LazyGravity
npm install
```

Set up your environment:

```bash
cp .env.example .env
# Edit .env with your Discord bot token and settings
```

Run the bot in development mode:

```bash
npm run dev
```

Or build and run:

```bash
npm run build
npm run start:built
```

### Project Structure

```
src/
  index.ts           # Entry point
  bin/               # CLI commands (setup, doctor, start, open)
  bot/               # Discord.js client config, event listeners
  commands/          # Slash commands and message parsing
  handlers/          # Message and reaction handlers
  services/          # Antigravity integration, task queue management
  utils/             # Security, logger, config utilities
  database/          # SQLite local DB management
tests/
docs/
```

## Code Style

### TypeScript

- **Immutability**: Always create new objects instead of mutating. Use spread operators and `map`/`filter`/`reduce`.
- **Small files**: Aim for 200-400 lines per file, 800 max. Extract utilities when files grow large.
- **Small functions**: Keep functions under 50 lines.
- **Error handling**: Always handle errors with try/catch and provide clear error messages.
- **No hardcoded secrets**: Use environment variables for API keys, tokens, and sensitive data.

### Code Comments

- Write code comments in **English**.
- Only add comments where the logic isn't self-evident.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>
```

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only changes |
| `test` | Adding or correcting tests |
| `chore` | Maintenance tasks (deps, CI, etc.) |
| `perf` | Performance improvement |
| `ci` | CI/CD changes |

### Examples

```
feat: add retry button on model error embeds
fix: prevent duplicate CDP connections on rapid reconnect
docs: update README with new CLI commands
refactor: extract color constants from doctor command
```

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`.
2. **Make your changes** following the code style guidelines above.
3. **Write tests** for new functionality (aim for 80%+ coverage).
4. **Run the test suite** to ensure nothing is broken:
   ```bash
   npm test
   ```
5. **Build** to verify there are no TypeScript errors:
   ```bash
   npm run build
   ```
6. **Push** your branch and open a Pull Request against `main`.
7. Fill out the PR template with a summary, linked issues, and checklist.

### PR Review

- A maintainer will review your PR.
- Address any feedback and push follow-up commits.
- Once approved, a maintainer will merge your PR.

## Running Tests

```bash
# Unit tests
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# Integration tests
npm run test:integration
```

## Reporting Issues

- **Bugs**: Use the [Bug Report](https://github.com/tokyoweb3/LazyGravity/issues/new?template=bug_report.md) template.
- **Feature Requests**: Use the [Feature Request](https://github.com/tokyoweb3/LazyGravity/issues/new?template=feature_request.md) template.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
