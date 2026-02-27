# Antigravity DOM Inspection Guide

## Overview

Antigravity is an Electron-based app. When launched with `--remote-debugging-port=9223`, you can inspect its DOM via Chrome DevTools Protocol (CDP), just like a regular browser.

This guide covers how to connect DevTools and the investigation flow for creating new DOM selectors.

## Connecting DevTools

### Prerequisites

Antigravity must be running with the CDP port enabled:

```bash
open -a Antigravity --args --remote-debugging-port=9223
```

### Steps

1. Open `chrome://inspect/#devices` in Chrome (or Edge)
2. Click **Configure** → add `localhost:9223` (if not already listed)
3. The Antigravity page appears under **Remote Target**
4. Click **inspect** → DevTools opens

You can now use the Elements / Console / Network panels as you would on any web page.

### Useful Panels

| Panel | Purpose |
|-------|---------|
| Elements | Inspect HTML structure, identify elements |
| Console | Test selectors (`document.querySelector(...)`) |
| Network | Inspect CDP communication (for debugging) |

## DOM Inspection Best Practices

### Phase 1: Reproduce the Target State

Reproduce the UI state you want to inspect in Antigravity.

- Error popup → intentionally trigger an error
- Buttons → create the conditions for the button to appear
- Response text → have the model generate a response

**Important:** Keep DevTools open. Some popups are removed from the DOM when dismissed.

### Phase 2: Identify the Element

1. **Select the element in the Elements panel**
   - Click the "element selection tool" (arrow icon) in the top-left
   - Click the target element in Antigravity → it highlights in the Elements panel

2. **Record the following information**
   - Tag name (`div`, `button`, `h2`, etc.)
   - Class names (`class="error-dialog"`)
   - Data attributes (`data-tooltip-id="retry-tooltip"`)
   - ARIA attributes (`aria-label="Retry"`)
   - Text content
   - Parent element structure (nesting depth)

3. **Sharing format (example)**

```
Element: Error popup title
Tag: <h2 class="error-title">
Text: "Agent terminated due to error"
Parent structure: body > div.app > div.modal-overlay > div.error-dialog > h2
Data attributes: none
```

### Phase 3: Test Selectors in Console

Based on what you found in Elements, test selectors in the Console panel.

```javascript
// 1. Basic selector check
document.querySelector('.error-dialog')

// 2. Search by text content (when class names are absent or unstable)
document.querySelectorAll('button').forEach(b => {
  if (b.textContent.includes('Retry')) console.log(b)
})

// 3. Search by data attribute (most stable)
document.querySelector('[data-tooltip-id="retry-tooltip"]')

// 4. Scope to the side panel
document.querySelector('.antigravity-agent-side-panel')
  ?.querySelector('.error-dialog')
```

### Phase 4: Evaluate Selector Stability

Priority when choosing selectors (higher = more stable):

| Priority | Selector Type | Example | Stability |
|:--------:|---------------|---------|:---------:|
| 1 | Data attributes | `[data-tooltip-id="retry-tooltip"]` | High |
| 2 | ARIA attributes | `[aria-label="Retry"]` | High |
| 3 | Role + text | `[role="button"]` + textContent | Medium |
| 4 | Class names | `.error-dialog` | Low (changes with UI updates) |
| 5 | Tag + position | `div > div:nth-child(2)` | Lowest (fragile) |

**Rules:**
- Prefer data or ARIA attributes when available
- When using class names only, prepare text-pattern fallbacks
- Avoid position-based selectors (`nth-child`, etc.)

### Phase 5: Check Multi-language Variants

Antigravity's UI text may change depending on the language setting.

- Verify text in both English and Japanese
- Include both variants in pattern matching when button labels differ

```javascript
// Good: multi-language support
const PATTERNS = [/^Retry$/, /^再試行$/, /^Try Again$/, /^もう一度試す$/];
```

## Investigation Report Template

When creating new DOM selectors, share the following to make implementation smooth.

```markdown
### Target: [Component Name]

**Reproduction steps:**
1. ...
2. ...

**Screenshot:** (if available)

**DOM structure:**
body > div.xxx > div.yyy > div.zzz
  ├── h2.title → "Agent terminated due to error"
  ├── p.description → "You can prompt the model..."
  └── div.buttons
      ├── button → "Dismiss"
      ├── button → "Copy debug info"
      └── button → "Retry"

**Working selectors:**
- `document.querySelector('[data-testid="error-dialog"]')` ← recommended
- `document.querySelector('.error-dialog')` ← fallback

**Text variants:**
- EN: "Agent terminated due to error"
- JP: (not confirmed)

**Notes:**
- Popup disappears on Dismiss
- Removed from DOM when dismissed
```

## Usage in This Project

In LazyGravity, DOM selectors are defined in `RESPONSE_SELECTORS` (`src/services/responseMonitor.ts`) and various detector files. When adding or modifying selectors:

1. Investigate the DOM structure using the steps above
2. Verify selector behavior in Console
3. Add or update the selector in the appropriate source file
4. Update `docs/ANTIGRAVITY_DOM_SELECTORS.md` with the new selector and its verified status
5. Run `npm test` to verify no regressions
