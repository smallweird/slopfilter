# Slopfilter

A community-powered Chrome extension that filters AI-slop, bot accounts, ragebait, and spam on X.com.

When you flag an account, your flag is shared with everyone running the extension. When enough people flag the same account, it gets hidden or blurred for the whole community — no algorithm, no AI, just collective human judgement.

---

## How it works

- **Hover any post** on X.com — a 🚩 button appears
- **Click it** to flag the account as bot, AI-slop, ragebait, or spam
- **Flagged accounts** are immediately blurred or hidden for you, and your flag is submitted to the shared community list
- **Click a blurred post** to reveal it for the session
- **Click 🚩 again** on an already-flagged account to unflag it

Your identity is a randomly generated UUID — never shown, never editable. Your display name (e.g. `suspiciousHeron36`) is cosmetic only.

---

## Install (unpacked)

1. Clone or download this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `extension/` folder
5. Go to [x.com](https://x.com) — the extension is active immediately

After pulling any update, click the **reload ↻** icon on the Slopfilter card in `chrome://extensions`, then reload the x.com tab.

---

## Popup settings

| Setting | What it does |
|---|---|
| **Strictness** | Minimum number of independent community flags before an account is filtered for you. Your own flags always hide regardless. |
| **Categories** | Toggle which flag types are active. Disable a category and those accounts reappear. |
| **Blur / Hide** | Choose whether flagged posts are blurred-with-reveal or hidden entirely. |

---

## Privacy

- The extension **never reports what you're viewing**. The server only receives flag submissions.
- The community list is downloaded and matched locally — your timeline stays private.
- Your installer ID is a random UUID stored in `chrome.storage.sync`. It roams with your Chrome profile and survives reinstalls, but is never exposed in the UI.

---

## Files

| File | Role |
|---|---|
| `extension/manifest.json` | MV3 manifest |
| `extension/background.js` | Service worker: identity bootstrap, flag submission, community sync |
| `extension/content.js` | Timeline scanning, blur/hide treatments, floating flag button |
| `extension/content.css` | Styles injected into x.com |
| `extension/popup.html/css/js` | Toolbar popup UI |
| `scripts/generate-icons.js` | Generates extension icons (Node, optional) |
