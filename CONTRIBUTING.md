# Contributing to LazyGravity

First off, thank you for considering contributing to LazyGravity! It's people like you that make LazyGravity such a great tool.

## Development Setup

### Prerequisites
- **Node.js**: Version 18.x or higher
- **npm**: Version 8.x or higher
- **Antigravity**: Installed and running on your local machine

### Cloning the Repository
```bash
git clone https://github.com/tokyoweb3/LazyGravity.git
cd LazyGravity
```

### Installation
```bash
npm install
```

### Configuration
1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and fill in your Discord bot token, guild ID, and authorized user IDs.

### Running the Bot
- **Development mode** (with auto-reload):
  ```bash
  npm run dev
  ```
- **From source**:
  ```bash
  npm run start
  ```

---

## Code Style Guidelines

### TypeScript
- We use **TypeScript** for all source code. Ensure your code passes type checking:
  ```bash
  npm run build # This triggers tsc
  ```
- Use descriptive names for variables, functions, and classes.
- Prefer `interface` over `type` for object definitions where possible.

### Immutability Patterns
- Prefer `const` over `let`.
- Avoid mutating objects and arrays directly; use the spread operator (`...`) or other non-mutating methods.
- For state management (e.g., in services), use patterns that ensure predictability and easy debugging.

---

## Commit Message Format

We follow the **Conventional Commits** specification. Each commit message should follow this format:

`<type>: <description>`

### Allowed Types:
- `feat`: A new feature
- `fix`: A bug fix
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `docs`: Documentation only changes
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools and libraries
- `perf`: A code change that improves performance
- `ci`: Changes to our CI configuration files and scripts

**Example**: `feat: add support for custom message templates`

---

## PR Process and Review Expectations

1. **Self-Review**: Before submitting, ensure your code follows the style guidelines and passes tests.
2. **Template**: Use the provided Pull Request template.
3. **Atomic Commits**: Keep your commits focused on a single change.
4. **Review**: At least one maintainer will review your PR. Address any feedback promptly.
5. **Merging**: Once approved and all checks pass, your code will be merged into the `main` branch.

---

## How to Run Tests

Ensure all tests pass before submitting a PR.

### Unit Tests
```bash
npm run test:unit
```

### Integration Tests
Note: Integration tests may require a configured environment.
```bash
npm run test:integration
```

### Watch Mode
```bash
npm run test:watch
```

---

## Reporting Issues
Please use the provided [Issue Templates](https://github.com/tokyoweb3/LazyGravity/issues/new/choose) for bugs and feature requests.

## GitHub Discussions
For general questions or ideas, please visit our [Discussions](https://github.com/tokyoweb3/LazyGravity/discussions) page.
