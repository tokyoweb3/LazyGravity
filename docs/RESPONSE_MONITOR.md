# Response Monitor Architecture

> CDP (Chrome DevTools Protocol) を経由して Antigravity の AI 応答をリアルタイム監視し、
> Discord に**アウトプット**と**プロセスログ**を分離配信する仕組み。

---

## 1. System Overview

```
Discord User
    |  prompt
    v
bot/index.ts  sendPromptToAntigravity()
    |  cdp.injectMessage(prompt)
    v
Antigravity (browser)  --- AI generates response in DOM ---
    ^
    |  CDP evaluate (4 calls / poll)
    |
ResponseMonitor.poll()
    |
    +---> onProgress(text)      --> Discord "generating" embed (output)
    +---> onProcessLog(text)    --> Discord "process log" embed (activity)
    +---> onPhaseChange(phase)  --> phase tracking
    +---> onComplete(text)      --> Discord "complete" embed (final)
```

### Key Files

| File | Role |
|------|------|
| `src/services/responseMonitor.ts` | CDP polling, DOM selectors, phase state machine |
| `src/bot/index.ts` | Discord embed rendering, callback wiring |
| `src/utils/discordFormatter.ts` | Text formatting for Discord (table/tree code blocks, UI chrome filtering) |
| `src/utils/logger.ts` | ANSI colored logger with level-based methods |

---

## 2. Dual Output Streams

ResponseMonitor produces **two independent streams** from the same DOM:

| Stream | Selector | Content | Discord Embed |
|--------|----------|---------|---------------|
| **Output** | `RESPONSE_TEXT` | Natural language AI response | "generating" / "complete" |
| **Process Log** | `PROCESS_LOGS` | Activity messages + tool output | "process log" |

This separation happens **at the DOM level** via CDP selectors, not via post-processing.
The `splitOutputAndLogs()` function in `discordFormatter.ts` is a secondary classifier
for edge cases but is not the primary separator.

### Why Two Selectors?

In Antigravity's DOM, a single conversation turn contains:
- The AI's natural language response (the "output")
- MCP tool invocations and results (e.g., search queries, JSON payloads)
- Activity status messages (e.g., "Initiating Task Execution", "Thought for 38 seconds")

These are **interleaved in the same DOM tree** with no parent container distinguishing them.
A single selector cannot extract both; scored filtering classifies each node into one stream.

---

## 3. CDP Selectors (Scored Approach)

### 3.1 RESPONSE_TEXT

Extracts the **newest AI response text**, filtering out non-response content.

**Algorithm:**
1. Scope to `.antigravity-agent-side-panel` (fallback: `document`)
2. Query all nodes matching scored CSS selectors
3. Iterate in **reverse DOM order** (newest first: index N-1 -> 0)
4. For each node, apply content filters to skip non-response text
5. Keep the first (= newest) node with the highest score (`score > bestScore`, strict)

**Scored Selectors (priority descending):**

| Score | Selector | Typical Match |
|-------|----------|---------------|
| 10 | `.rendered-markdown` | Final rendered response |
| 9 | `.leading-relaxed.select-text` | Response text container |
| 8 | `.flex.flex-col.gap-y-3` | Message block |
| 7 | `[data-message-author-role="assistant"]` | Role-tagged message |
| 6 | `[data-message-role="assistant"]` | Alternative role tag |
| 5-2 | Various `[class*=...]` and `.prose` | Fallback selectors |

**Tie-Breaking Rule:**
- DOM order is normal: index 0 = oldest, N-1 = newest
- Reverse iteration visits newest first
- Strict `>` (not `>=`) keeps the first found = newest element
- This ensures previous-turn responses never shadow the current response

### 3.2 PROCESS_LOGS

Extracts text from nodes that **would be filtered out** by RESPONSE_TEXT.

**Algorithm:**
1. Same scope and selectors as RESPONSE_TEXT
2. Forward DOM order (chronological)
3. Collect text from nodes matching `looksLikeActivityLog()` or `looksLikeToolOutput()`
4. Truncate each entry to 300 chars
5. Return as array of strings

### 3.3 Content Filters

These functions run inside CDP (browser context) to classify DOM text:

| Filter | Matches | Examples |
|--------|---------|----------|
| `looksLikeActivityLog` | Short status messages | "Analyzing...", "Thought for 38 seconds", "Initiating Task Execution" |
| `looksLikeToolOutput` | MCP tool names, results, code blocks | "jina-mcp-server / search_web", "title: X url: Y snippet: Z", "json" |
| `looksLikeFeedbackFooter` | UI feedback buttons | "good", "bad", "good bad" |
| `isInsideExcludedContainer` | Hidden/feedback containers | Nodes inside `<details>`, `[class*="feedback"]`, `<footer>` |

### 3.4 STOP_BUTTON

Detects whether AI generation is in progress:
1. Check for `[data-tooltip-id="input-send-button-cancel-tooltip"]` (primary)
2. Fallback: scan all buttons for "stop" / "停止" text

### 3.5 DUMP_ALL_TEXTS (Diagnostic Only)

Returns **all** candidate text nodes with metadata (selector, score, filter classification).
Not called during normal polling. Available for manual debugging via CDP console.

### 3.6 QUOTA_ERROR

Scans for quota/rate-limit error banners outside of message content.

---

## 4. Polling & Phase State Machine

### 4.1 Poll Cycle (4 CDP Calls)

```
poll()
  |
  +-- 1. STOP_BUTTON      -> isGenerating (bool)
  +-- 2. QUOTA_ERROR       -> quotaDetected (bool)
  +-- 3. RESPONSE_TEXT     -> currentText (string | null)
  +-- 4. PROCESS_LOGS      -> logEntries (string[])
  |
  +-- Handle phase transitions
  +-- Forward callbacks
```

Default interval: **2000ms**. Max duration: **300000ms** (5 min).

### 4.2 Phase Transitions

```
waiting --> thinking --> generating --> complete
   |           |            |             |
   +--timeout--+--timeout---+--timeout----+
   |
   +--quotaReached (immediate, if no text)
```

| Transition | Trigger |
|------------|---------|
| waiting -> thinking | Stop button appears (`isGenerating = true`) |
| thinking -> generating | Text changes (non-null, differs from lastText) |
| generating -> complete | Stop button gone N consecutive times (default: 3) |
| any -> timeout | `maxDurationMs` elapsed |
| waiting -> quotaReached | Quota error detected with no existing text |

### 4.3 Baseline Suppression

At `start()`, the monitor captures the current RESPONSE_TEXT as `baselineText`.
During polling, if `currentText === baselineText` and no new text has been seen yet (`lastText === null`),
the text is suppressed — it belongs to the **previous conversation turn**, not the current one.

### 4.4 Process Log Baseline

At `start()`, all current PROCESS_LOGS entries are captured as `baselineProcessLogs` (Set).
During polling, only entries **not in the baseline** are forwarded to `onProcessLog`.
This prevents activity messages from previous turns leaking into the current turn's log.

### 4.5 Completion Detection (Stop-Gone Confirmation)

The stop button disappearing does not immediately mean completion — it can flicker.

```
Stop button gone -> stopGoneCount++
Stop button back -> stopGoneCount = 0 (reset)
stopGoneCount >= stopGoneConfirmCount (default: 3) -> complete
```

**Important:** Text changes do NOT reset `stopGoneCount`. The AI may stream trailing tokens
after the stop button disappears. Resetting on text change would cause infinite loops.

---

## 5. Callback Flow (bot/index.ts)

```
ResponseMonitor
  |
  |-- onPhaseChange(phase, text)
  |     Logged as: [INFO] phase=thinking textLen=0
  |
  |-- onProcessLog(logText)
  |     Updates lastActivityLogText
  |     Renders "process log" embed via upsertLiveActivityEmbeds()
  |
  |-- onProgress(text)
  |     Calls splitOutputAndLogs(text) for secondary classification
  |     Renders "generating" embed via upsertLiveResponseEmbeds()
  |     Also refreshes activity embed with lastActivityLogText fallback
  |
  |-- onComplete(finalText)
  |     isFinalized = true
  |     Renders final "complete" embed (output)
  |     Renders final "process log" embed (lastActivityLogText)
  |     Handles quota warning, generated images, channel rename
  |
  |-- onTimeout(lastText)
  |     isFinalized = true
  |     Renders timeout embed with partial text if available
```

### Embed Queue System

Discord embed updates go through **three serial queues** to prevent race conditions:

| Queue | Purpose |
|-------|---------|
| `general` | One-shot embeds (errors, status, mode info) |
| `response` | Output embed updates (upsert pattern: create-or-edit) |
| `activity` | Process log embed updates (upsert pattern: create-or-edit) |

Each queue processes tasks sequentially. Multiple queues run in parallel.
The `liveResponseUpdateVersion` / `liveActivityUpdateVersion` counters prevent
stale renders from overwriting newer content.

---

## 6. Logging Architecture

### 6.1 Log Levels (src/utils/logger.ts)

| Level | ANSI Color | Use Case |
|-------|------------|----------|
| `logger.error` | Red | Failures, exceptions |
| `logger.warn` | Yellow | Quota detection, degraded states |
| `logger.info` | Cyan | State changes, text changes, process log updates |
| `logger.phase` | Magenta | Phase transitions (thinking, generating, complete) |
| `logger.done` | Green | Completion events |
| `logger.debug` | Dim | Verbose diagnostic (disabled in production log review) |

### 6.2 Log Output During Normal Operation

A typical successful run produces approximately these log lines:

```
[INFO]  start — pollInterval=2000ms ... baselineLen=236
[PHASE] waiting -> thinking textLen=0
[INFO]  processLog updated entries=3 len=558 latest="jina-mcp-server / search_web..."
[INFO]  processLog updated entries=4 len=859 latest="title: 東京都の天気..."
[INFO]  text changed len=0->186 "2026年2月24日の東京の天気は..."
[PHASE] thinking -> generating textLen=186
[INFO]  text changed len=186->236 "2026年2月24日の東京の天気は、以下のようになって..."
[INFO]  stopGone 1/3 — 2 more to complete
[INFO]  stopGone 2/3 — 1 more to complete
[INFO]  stopGone 3/3 — 0 more to complete
[DONE]  complete! stopGone=3/3 finalTextLen=236
[PHASE] generating -> complete textLen=236
[INFO]  finalize payload outputLen=236 logLen=859
[DONE]  [Output]       <-- green: full output text
[PHASE] [ProcessLog]   <-- magenta: full process log text
```

### 6.3 Finalize Content Logging

At completion, the bot logs both the output and process log with distinct colors:

- `[DONE] [Output]\n<full text>` — Green, the same text shown in Discord's "complete" embed
- `[PHASE] [ProcessLog]\n<full text>` — Magenta, the same text shown in Discord's "process log" embed

This allows terminal reviewers to see exactly what Discord displays without opening Discord.

### 6.4 What Is NOT Logged (by design)

To keep logs clean, the following are intentionally omitted from production output:

- Raw CDP stop button results (every poll)
- Raw text extraction results (every poll)
- Baseline suppression events (every poll during thinking)
- Baseline text content (only length is shown; previous-turn text is not relevant)
- DUMP diagnostic entries (removed from poll; selector retained for manual debug)
- Queue enqueue/start/done/settle events (only errors logged)

---

## 7. DOM Structure Assumptions

The selectors assume Antigravity's DOM follows this approximate structure:

```
.antigravity-agent-side-panel
  |
  +-- conversation turn 1 (oldest, DOM index 0)
  |     +-- .rendered-markdown  (previous response text)
  |     +-- .leading-relaxed    (activity messages)
  |     +-- .flex.flex-col      (tool output blocks)
  |
  +-- conversation turn 2
  |     +-- ...
  |
  +-- conversation turn N (newest, DOM index N-1)
        +-- .rendered-markdown  (current response text)  <-- RESPONSE_TEXT picks this
        +-- .leading-relaxed    (current activity)        <-- PROCESS_LOGS picks these
        +-- .flex.flex-col      (current tool output)     <-- PROCESS_LOGS picks these
```

**Key invariant:** DOM order is chronological (index 0 = oldest).
The reverse iteration in RESPONSE_TEXT ensures the newest turn's response wins.

---

## 8. Testing Strategy

### Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/services/responseMonitor.lean.test.ts` | 16 | Phase state machine, completion, baseline suppression, CDP call structure |
| `tests/services/responseMonitor.selectors.test.ts` | 15 | Content filter string matching (activity, tool output, feedback) |
| `tests/utils/discordFormatter.lean.test.ts` | 15 | UI chrome detection, splitOutputAndLogs, formatForDiscord |

### Mock Strategy

Tests use a minimal CDP mock (`call` + `getPrimaryContextId`) with no network event subscription.
The default mock returns `{ result: { value: null } }` for unmocked CDP calls,
which gracefully degrades (null is handled as "no data") without breaking tests.

### CDP Call Count Verification

The structural test verifies exactly **4 CDP calls per poll** (stop, quota, text, process_logs)
and **2 CDP calls at start** (baseline text, baseline process logs).

---

## 9. Troubleshooting

### "Collecting Process Logs..." stays forever (logLen=0)

**Cause:** Process logs are extracted by `PROCESS_LOGS` selector and forwarded via `onProcessLog`.
If this callback never fires, check:
1. CDP connection is established (`cdp.isConnected()`)
2. Antigravity DOM has elements matching the selectors
3. Content filters are not over-filtering (all entries classified as non-activity/non-tool)

### Wrong text selected (previous turn's response)

**Cause:** Baseline suppression or tie-breaking issue.
1. Check that `baselineText` was captured correctly at `start()`
2. Verify DOM order hasn't changed (column-reverse CSS would break assumptions)
3. Tie-breaking uses strict `>` — if changed to `>=`, oldest text wins instead

### Old conversation entries appear in process logs

**Cause:** `baselineProcessLogs` Set didn't capture them at start.
1. Entries are compared by first 200 chars of text
2. If text content changed between baseline capture and poll, the entry won't match
3. Consider extending the comparison length or using a different identity key
