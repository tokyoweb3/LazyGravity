# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | Yes                |

## Reporting a Vulnerability

We take the security of LazyGravity seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT open a public GitHub issue** for security vulnerabilities.
2. Use [GitHub Security Advisories](https://github.com/tokyoweb3/LazyGravity/security/advisories/new) to report the vulnerability privately.
3. Provide as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours of report
- **Initial Assessment**: Within 1 week
- **Fix & Disclosure**: Coordinated with reporter, typically within 30 days

### Scope

The following are in scope for security reports:

- Discord bot token or secret leakage
- Command injection via Discord messages
- Unauthorized access to bot commands (allowedUserIds bypass)
- SQLite injection
- Local file system access vulnerabilities
- Dependencies with known vulnerabilities

### Out of Scope

- Issues in third-party dependencies (report to the upstream project)
- Social engineering attacks
- Denial of service via Discord API rate limits

## Security Best Practices for Users

- Use a dedicated Discord server with only you and the bot (do not add the bot to shared servers)
- Never share your `.env` file or bot token
- Keep `allowedUserIds` restricted to trusted Discord accounts
- Run the bot on a trusted local machine
- Keep dependencies up to date (`npm audit`)

---

Copyright (c) LazyGravity Project
