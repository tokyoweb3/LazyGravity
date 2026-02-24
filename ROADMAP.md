# LazyGravity Roadmap

> Tracking upcoming work and known issues.
> Checked items are complete; unchecked items are planned or in progress.

---

## Known Issues

- [ ] **Error Retry UI** — Display a Retry button in Discord when Antigravity returns a model error
- [ ] **Planning Mode Flow** — Surface Open / Proceed decision points in Discord when Antigravity enters Planning mode
- [ ] **Output Streaming** — Re-enable real-time streaming of final output (currently buffered to avoid process-log noise)

## CLI & Management

- [x] **`/status` command** — Show bot connection state, active projects, and current mode
- [x] **Invite Link Generator** — Auto-generate a bot invite URL during `lazy-gravity setup`
- [ ] **`doctor` enhancements** — Expand environment checks and add colored terminal output

## UX & Notifications

- [ ] **Startup Dashboard** — Post a rich Embed to Discord on bot startup (OS, port, model, version)
- [ ] **Heartbeat** — Optional periodic alive-check notification
- [ ] **Scheduled Tasks** — Wire the existing `ScheduleService` backend to a `/schedule` slash command
- [ ] **Usage Stats & Rate Limiting** — `/stats` command and per-user rate limits
- [ ] **External Webhooks** — Notify Slack, LINE Notify, etc. on task completion

## Advanced Features

- [ ] **Template Import / Export** — Portable prompt templates (file-based or clipboard)
- [ ] **Auto Update Check** — Query the npm registry on startup and notify when a new version is available

## Scalability & Architecture

- [ ] **Logger Improvements** — Log-level filtering, file output, rotation, `--verbose` / `--quiet` flags
- [ ] **Multi-Editor Support** — Adapter abstraction for Cursor, Windsurf, and other CDP-compatible editors
- [ ] **Plugin System** — User-defined hooks and commands

## Public Release

- [x] **Assets** — Demo video, banner image, and Mermaid architecture diagram (all in README)
- [x] **npm Publish** — Published as `lazy-gravity` (v0.0.4)
- [ ] **GitHub Infrastructure** — Issue / PR templates, `CONTRIBUTING.md`, GitHub Discussions
- [ ] **v1.0 Stable Release** — First production-ready version

---

## Completed

- [x] Session sync — fixed sessions drifting when Antigravity UI is used directly
- [x] Media support — image attachment receiving and content extraction
- [x] Process log filtering — strip terminal output from final responses
- [x] Channel naming — LLM-powered high-precision channel titles
- [x] Output buffering — show complete output after generation finishes
- [x] Approval routing — confirmation buttons sent to the correct channel
- [x] `/stop` command — fixed accidental voice recording trigger
- [x] Channel isolation — messages in old channels no longer leak to latest session
- [x] Completion detection — improved end-of-response detection (previously timeout-based)
