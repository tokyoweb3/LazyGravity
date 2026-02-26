# Antigravity DOM Selectors Reference

Central reference for all CSS selectors and DOM structures used to interact with the Antigravity (Windsurf/Cascade) UI via CDP.

> **Last verified**: 2025-02 (against live Antigravity DOM)

---

## Root Scope

All scripts scope queries to the side panel first, falling back to `document`.

```
.antigravity-agent-side-panel
```

**Used by**: All detectors, all scripts

---

## 1. User Message Bubble

The message a user types directly in the Antigravity chat input.

### Verified DOM Structure

```html
<div class="bg-gray-500/15 p-2 rounded-lg w-full text-sm select-text">
  <div class="flex flex-row items-end gap-2">
    <div class="flex-1 flex flex-col gap-2">
      <div>
        <div class="whitespace-pre-wrap text-sm" style="word-break: break-word;">
          {user message text}
        </div>
      </div>
    </div>
    <div> <!-- undo button: div[role="button"][data-tooltip-id^="undo-tooltip-"] --> </div>
  </div>
</div>
```

### Selectors

| Selector | Purpose | Strategy | File |
|----------|---------|----------|------|
| `[class*="bg-gray-500/15"][class*="select-text"] .whitespace-pre-wrap` | Direct text element query (last match = most recent) | A (primary) | `userMessageDetector.ts` |
| `[class*="bg-gray-500/15"][class*="rounded-lg"][class*="select-text"]` | User message bubble container (filtered: excludes parents with nested bubbles) | B (fallback) | `userMessageDetector.ts` |
| `.whitespace-pre-wrap` | User message text element inside bubble | B (fallback) | `userMessageDetector.ts` |
| `[style*="word-break"]` | User message text element (secondary fallback) | B (fallback) | `userMessageDetector.ts` |

> **Note**: Strategy A directly queries innermost text elements to avoid the parent-container problem where a wrapper div matches and returns concatenated text from multiple messages. Strategy B adds a filter to exclude parent containers that contain nested bubble elements.

---

## 2. AI Response Content

The assistant's response body, rendered with markdown formatting.

### Key Selectors (ordered by score/specificity)

| Score | Selector | Status | File |
|-------|----------|--------|------|
| 10 | `.rendered-markdown` | **Verified** | `responseMonitor.ts`, `assistantDomExtractor.ts` |
| 9 | `.leading-relaxed.select-text` | **Verified** | `responseMonitor.ts`, `planningDetector.ts`, `assistantDomExtractor.ts` |
| 8 | `.flex.flex-col.gap-y-3` | Unverified — generic | `responseMonitor.ts`, `assistantDomExtractor.ts` |
| 7 | `[data-message-author-role="assistant"]` | **NOT FOUND** in DOM | `responseMonitor.ts`, `assistantDomExtractor.ts` |
| 6 | `[data-message-role="assistant"]` | **NOT FOUND** in DOM | `responseMonitor.ts`, `assistantDomExtractor.ts` |
| 5 | `[class*="assistant-message"]` | **NOT FOUND** in DOM | `responseMonitor.ts`, `assistantDomExtractor.ts` |
| 4 | `[class*="message-content"]` | **NOT FOUND** in DOM | `responseMonitor.ts`, `assistantDomExtractor.ts` |
| 3 | `[class*="markdown-body"]` | **NOT FOUND** in DOM | `responseMonitor.ts`, `assistantDomExtractor.ts` |
| 2 | `.prose` | Unverified | `responseMonitor.ts`, `assistantDomExtractor.ts` |

> **Note**: Selectors scored 3-7 appear to be inherited from ChatGPT/generic patterns and do **not** exist in Antigravity's DOM. They are harmless (scored lower, never matched) but add noise. The top selectors (`.rendered-markdown`, `.leading-relaxed.select-text`) are the ones that actually match.

### Exclusion Containers

Nodes inside these containers are skipped during response extraction:

| Selector | Purpose |
|----------|---------|
| `details` | Thinking/tool-call collapsible sections |
| `[class*="feedback"], footer` | Good/Bad feedback buttons |
| `.notify-user-container` | Planning mode notification |
| `[role="dialog"]` | Modal dialogs (error popup, etc.) |

---

## 3. Chat Title (Header)

The currently active conversation title shown in the panel header.

### Selectors

| Selector | Purpose | File |
|----------|---------|------|
| `.antigravity-agent-side-panel` | Panel root | `chatSessionService.ts`, `cdpBridgeManager.ts` |
| `div[class*="border-b"]` | Header bar (first match inside panel) | `chatSessionService.ts`, `cdpBridgeManager.ts` |
| `div[class*="text-ellipsis"]` | Title text element (inside header) | `chatSessionService.ts`, `cdpBridgeManager.ts` |

Default/empty chat title: `"Agent"` (treated as no active chat)

---

## 4. New Chat Button

| Selector | Purpose | File |
|----------|---------|------|
| `[data-tooltip-id="new-conversation-tooltip"]` | New conversation button | `chatSessionService.ts` |

State detection: `cursor: pointer` = enabled, `cursor: not-allowed` = already empty chat

---

## 5. Stop / Cancel Button

| Selector | Purpose | File |
|----------|---------|------|
| `[data-tooltip-id="input-send-button-cancel-tooltip"]` | Stop generation button (primary) | `responseMonitor.ts` |
| `button, [role="button"]` with stop text patterns | Stop button (text fallback) | `responseMonitor.ts` |

Text patterns: `stop`, `stop generating`, `stop response`, `停止`, `生成を停止`, `応答を停止`

---

## 6. Past Conversations Panel

Selectors for opening, browsing, and selecting past conversations.

### Opening the Panel

| Priority | Selector | Purpose | File |
|----------|----------|---------|------|
| 1 | `[data-past-conversations-toggle]` | Toggle button (data attribute) | `chatSessionService.ts` |
| 2 | `[data-tooltip-id]` containing `history` or `past-conversations` | Tooltip-based lookup | `chatSessionService.ts` |
| 3 | `svg.lucide-history` | SVG icon class | `chatSessionService.ts` |

### Scraping Sessions

| Selector | Purpose | File |
|----------|---------|------|
| `div[class*="overflow-auto"], div[class*="overflow-y-scroll"]` | Scrollable conversation list container | `chatSessionService.ts` |
| `div[class*="text-xs"][class*="opacity"]` | Section header (e.g. "Other Conversations") — used as boundary to exclude other-project sessions | `chatSessionService.ts` |
| `div[class*="cursor-pointer"]` | Session row items (rows below "Other Conversations" boundary are skipped) | `chatSessionService.ts` |
| `span.text-sm span, span.text-sm` | Session title text | `chatSessionService.ts` |
| `/focusBackground/i` (className regex) | Active/current session indicator | `chatSessionService.ts` |

### Show More

| Selector | Purpose | File |
|----------|---------|------|
| `div, span` with text matching `/^Show\s+\d+\s+more/i` | "Show N more..." link | `chatSessionService.ts` |

---

## 7. Approval Buttons

Tool permission dialog (Allow/Deny).

### Detection

| Selector | Purpose | File |
|----------|---------|------|
| `button` (all visible) | Scan for allow/deny text patterns | `approvalDetector.ts` |
| `[role="dialog"], .modal, .dialog, .approval-container, .permission-dialog` | Dialog container | `approvalDetector.ts` |
| `p, .description, [data-testid="description"]` | Action description text | `approvalDetector.ts` |

### Button Text Patterns

- **Allow Once**: `allow once`, `allow one time`, `今回のみ許可`, `1回のみ許可`, `一度許可`
- **Always Allow**: `allow this conversation`, `allow this chat`, `always allow`, `常に許可`, `この会話を許可`
- **Allow**: `allow`, `permit`, `許可`, `承認`, `確認`
- **Deny**: `deny`, `拒否`, `decline`

---

## 8. Planning Mode

Open/Proceed button pair for plan review.

### Detection

| Selector | Purpose | File |
|----------|---------|------|
| `.notify-user-container` | Planning notification container | `planningDetector.ts` |
| `span.inline-flex.break-all` | Plan title (file name) | `planningDetector.ts` |
| `span.text-sm` | Plan summary text | `planningDetector.ts` |
| `.leading-relaxed.select-text` | Plan description body | `planningDetector.ts` |

### Plan Content (after Open)

| Selector | Purpose | File |
|----------|---------|------|
| `div.relative.pl-4.pr-4.py-1, div.relative.pl-4.pr-4` | Plan content container | `planningDetector.ts` |
| `.leading-relaxed.select-text` (inside container) | Rendered plan content | `planningDetector.ts` |

---

## 9. Error Popup

Agent termination / unexpected error dialogs.

### Detection

| Selector | Purpose | File |
|----------|---------|------|
| `[role="dialog"], [role="alertdialog"], .modal, .dialog` | Dialog elements | `errorPopupDetector.ts` |
| `div[class*="fixed"], div[class*="absolute"]` with z-index > 10 | Overlay fallback | `errorPopupDetector.ts` |
| `h1, h2, h3, h4, [class*="title"], [class*="heading"]` | Error title extraction | `errorPopupDetector.ts` |

### Error Text Patterns

`agent terminated`, `terminated due to error`, `unexpected error`, `something went wrong`, `an error occurred`

---

## 10. Quota Error

Model quota reached / rate limit detection.

### Detection

| Selector | Purpose | File |
|----------|---------|------|
| `h3 span, h3` | Quota popup heading text | `responseMonitor.ts` |
| `span` (all) | Inline quota error text | `responseMonitor.ts` |
| `[role="alert"], [class*="error"], [class*="warning"], [class*="toast"], [class*="banner"], [class*="notification"], [class*="alert"], [class*="quota"], [class*="rate-limit"]` | Semantic error containers | `responseMonitor.ts` |

### Quota Keywords

`model quota reached`, `rate limit`, `quota exceeded`, `exhausted your quota`, `exhausted quota`

### isInsideResponse Guard

Quota text is only matched outside response containers to avoid false positives:

```
.rendered-markdown, .prose, pre, code,
[data-message-author-role="assistant"],
[data-message-role="assistant"],
[class*="message-content"]
```

---

## 11. Code Blocks (inside AI response)

Antigravity renders code blocks in a non-standard way.

### Structure

```html
<pre>
  <div class="font-sans text-sm ..."> <!-- language label header --> </div>
  <div class="...rounded-t...border-b..."> <!-- copy button header bar --> </div>
  <style>...</style> <!-- injected CSS -->
  <div class="code-line">line 1</div>
  <div class="code-line">line 2</div>
</pre>
```

### Selectors (used in normalization)

| Selector | Purpose | File |
|----------|---------|------|
| `.font-sans.text-sm` | Language label div | `assistantDomExtractor.ts` |
| `[class*="text-sm"][class*="opacity"]` | Language label fallback | `assistantDomExtractor.ts` |
| `style` | Injected CSS (removed during normalization) | `assistantDomExtractor.ts` |
| `[class*="rounded-t"][class*="border-b"]` | Header bar (removed during normalization) | `assistantDomExtractor.ts` |
| `.code-line, [class*="code-line"]` | Individual code lines | `assistantDomExtractor.ts` |

---

## Maintenance Notes

### When Antigravity updates its DOM

See [DOM Inspection Guide](dom-inspection-guide.md) for the full verification procedure (DevTools connection, selector testing, stability evaluation).

1. Connect DevTools to Antigravity and inspect the current DOM structure
2. Update this document with new selectors and their verified status
3. Update the affected detector/extractor source files
4. Run `npm test` to verify no regressions

### Known dead selectors (safe to remove)

The following selectors exist in `responseMonitor.ts` and `assistantDomExtractor.ts` but have **never matched** in Antigravity's DOM. They are inherited from ChatGPT/generic patterns and only serve as defensive fallbacks:

- `[data-message-author-role="assistant"]` (score 7)
- `[data-message-role="assistant"]` (score 6)
- `[class*="assistant-message"]` (score 5)
- `[class*="message-content"]` (score 4)
- `[class*="markdown-body"]` (score 3)

These can be safely removed if desired, as they never match and the higher-scored selectors (`.rendered-markdown`, `.leading-relaxed.select-text`) are the ones that actually work.

### Previously broken selectors (fixed)

- `[data-message-author-role="user"]` — Used in `userMessageDetector.ts` before fix. **Does not exist** in Antigravity DOM. Replaced with `[class*="bg-gray-500/15"][class*="rounded-lg"][class*="select-text"]` (commit `8285624`).
- Single bubble query `[class*="bg-gray-500/15"][class*="rounded-lg"][class*="select-text"]` without parent filter — Matched parent wrapper containers containing multiple user messages, causing echo duplication and previous-prompt pickup bugs. Fixed by adding Strategy A (direct text element query) + Strategy B (parent filter).
