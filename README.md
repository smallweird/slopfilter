# Slopfilter

Community-powered Chrome extension that filters AI-slop, bot accounts, and
ragebait on X.com. See [SPEC.md](SPEC.md) for the full design.

> **Phase 1 (current):** local-only. Flag accounts yourself; flagged accounts get
> hidden/blurred for you. No backend yet — that's Phase 2.
>
> **Project root:** `D:\Ideas\slop-addon`

## Load it in Chrome (dev)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select the **`D:\Ideas\slop-addon\extension`** folder.
4. Open [x.com](https://x.com). Hover any post — a 🚩 button appears at its top-right.

### Iterating

This is a **zero-build** extension — the files in `extension/` are exactly what
Chrome runs. After editing any file:

- Go to `chrome://extensions` and click the **reload** ↻ icon on the Slopfilter card.
- Reload the x.com tab.

(Editing only `popup.*` usually just needs you to reopen the popup; content
script / manifest changes need the extension reload above.)

## How Phase 1 behaves

- **Flag an account:** hover a post → click 🚩 → pick a category. That account is
  saved to your local flag list and immediately hidden/blurred.
- **Strictness slider:** `+1 / +10 / +100 / +1000`. Today this only matters for a
  *community* list (Phase 2). Your **own** flags always hide the account regardless.
- **Category chips:** turn off a category and accounts you flagged under it reappear.
- **Treatment:** defaults to *blur-with-reveal*. (`hide` / `label` switch is in
  storage; a UI toggle for it is a small later addition.)

## Files

| File | Role |
|---|---|
| `extension/manifest.json` | MV3 manifest |
| `extension/background.js` | Service worker — bootstraps the hidden ID + random name + default settings |
| `extension/content.js` | Scans the timeline, applies treatments, floating flag button |
| `extension/content.css` | Styles injected into x.com |
| `extension/popup.html/.css/.js` | The toolbar popup (name + slider + chips + support) |

## Notes for devs

- Node lives at `D:\Program Files\nodejs\` on this machine (not on PATH). Not
  needed to run the extension; only for optional tooling. To use it:
  `$env:Path = "D:\Program Files\nodejs;" + $env:Path`.
- The hidden installer ID is in `chrome.storage.sync` and never shown. Inspect
  state via the extension's service-worker console: `chrome://extensions` →
  Slopfilter → "service worker" → `chrome.storage.sync.get(console.log)`.
