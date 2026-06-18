# read-me-first — Slopfilter cold-start primer (for a fresh Claude Code instance, zero prior context)

META: You are CONTINUING this project in a new session/machine with no memory of it. Read this whole file, THEN read `SPEC.md` (full design) before writing code. Densest useful format for an LLM is terse structured text — binary/base64 would cost MORE tokens to decode, not fewer, so this is plain. Treat this as ground truth; verify file/line refs still exist before relying on them.

## WHAT
"Slopfilter" = Manifest V3 Chrome extension that filters AI-slop / bot / ragebait accounts on x.com using a SHARED COMMUNITY FLAG LIST. "Community" = shared blocklist that everyone contributes flags to and benefits from — NOT a social network. Users pick how strict their filter is. Goal: clean up X.

## WHO
Diego = product owner. Understands code but does NOT write it / has no time. Tests by loading the unpacked extension in Chrome and observing. Wants crisp/modern UI, tasteful animations (not overly complex). Communicate decisions + tradeoffs; he directs.


## ENV
- Windows 10, PowerShell (use PS syntax: `$null`, `$env:VAR`, backtick line-continuation).
- Node v24 lives at `D:\Program Files\nodejs\`, NOT on PATH. To use: `$env:Path = "D:\Program Files\nodejs;" + $env:Path`. Node is ONLY for tooling (icon gen, `node --check`); the extension itself needs no build/runtime Node.
- git 2.54 installed. `gh` CLI NOT installed.
- ZERO-BUILD: the files in `extension/` are exactly what Chrome runs. No bundler, no TypeScript, no npm deps. Plain vanilla JS. Rationale: MV3 forbids remotely-loaded code (no CDN), and simplicity for a PO-driven project.
- Test loop: `chrome://extensions` → Developer mode → Load unpacked → select `extension/`. After edits: click reload ↻ on the card + reload the x.com tab.
- Syntax check: `node --check file.js`. WARNING: `--check` validates syntax only — it does NOT catch undefined references (a call to an undefined function passes). Manually confirm every called function is defined (this bit us once: a missing `saveFlag` def shipped and silently broke flagging).

## ARCHITECTURE (core principle)
Flags go UP, the list comes DOWN, matching happens LOCALLY. The extension NEVER reports what the user views. In Phase 2 the server only receives flag submissions; the client periodically downloads the aggregated list, caches it, and matches in the content script. Private, cheap, offline-capable.

## PHASE STATUS
- PHASE 1 = DONE (local-only, no backend). Floating 🚩 flag button, per-account flagging w/ category, blur/hide treatment, popup settings UI, hidden installer ID, draggable button, live settings.
- PHASE 2 = NEXT. Supabase backend (Postgres + auto REST + RLS, free tier). Use Diego's MESS-AROUND throwaway GitHub/email for Supabase (NOT his personal account — personal is only for the git repo). Steps:
  1. Create Supabase project (mess-around account). Apply SQL schema from SPEC §8 (`flags` table w/ CHECK constraints + `flagged_accounts` aggregating view + `installers` table; RLS: anon INSERT into flags, reads only via the view).
  2. Submit flag: POST to Supabase REST `/rest/v1/flags` with headers `apikey`+`Authorization: Bearer <anon key>`, body `{flagger_id, target_handle, category, target_x_id?}`. Optimistic local apply + offline retry queue (NOT timed batching — flagging is rare/deliberate). ~150 bytes.
  3. Delta pull: every ~30 min + on startup, GET `flagged_accounts` (handle, distinct-flagger count, categories, last_flagged_at) since `last_synced_at`; cache in `chrome.storage.local` under `slopfilter:community`; load into content.js `community` Map. `verdict()` ALREADY consumes it (count >= strictness && category enabled).
  4. Fix profile-page handle extraction (Phase 1 works on the TIMELINE only).
  5. Store Supabase URL + anon key in a small config; anon key is public-safe (RLS enforces access).
- PHASE 3 = polish: per-category counts, flag/unflag UX, export/import, username system + $1/mo Stripe subscription (gold status dot, reserved unique handle, re-rolls free squatters).
- PHASE 4 = Chrome Web Store; later iOS Safari + Firefox-for-Android (code already kept portable; deferred).

## STORAGE KEYS (chrome.storage)
- sync: `slopfilter:id` (uuid, GENERATE-ONCE, never shown/editable), `slopfilter:displayName` (random `adjectiveAnimalNN`, cosmetic), `slopfilter:subscribed` (bool, Phase 3).
- local: `slopfilter:settings` = `{ strictness: 1|10|100|1000, treatment: 'blur'|'hide', categories: {bot,'ai-slop',ragebait,spam: bool}, anchor: {fx,fy} }`; `slopfilter:flags` = `[{handle, category, ts}]`. (Phase 2 adds `slopfilter:community`.)

## FILES (extension/)
- `manifest.json` — MV3. permissions:[storage]; host_permissions: x.com + twitter.com; icons 16/32/48/128.
- `background.js` — service worker. On install/startup: bootstrap `id` + `displayName` (sync) and default `settings` (local). Random-name word lists here.
- `content.js` — injected on x.com. Key fns: `extractHandle(article)` (timeline DOM, regex `^[A-Za-z0-9_]{1,15}$`, skips reserved paths); `verdict(handle)` (your own flags always hide if category on; else community count >= strictness); `refresh()` re-asserts treatment over all `article`s (debounced via rAF + 1s safety interval); `applyTreatment`/`clearTreatment` (INLINE styles); floating draggable flag button built on `<body>`; flag menu; click-to-reveal.
- `content.css` — styles the button/menu/label ONLY. Treatments are inline (see gotchas).
- `popup.html` / `popup.css` / `popup.js` — popup. Custom CSS design system (tokens, blue→indigo gradient, segmented controls w/ sliding thumb, animated category chips, blur/hide toggle, support button, flag count). No UI framework.
- `icons/icon-{16,32,48,128}.png` — generated by `scripts/generate-icons.js` (pure-Node PNG encoder; funnel mark on gradient). Regenerate: `node scripts/generate-icons.js`.

## HARD-WON GOTCHAS (do NOT relearn these)
1. X owns each `<article>`'s `className` via React and re-renders constantly; any CSS CLASS you add to an article is WIPED on re-render. => Apply treatments as INLINE `style` + `!important`, and RE-ASSERT every sweep (that's what `refresh()` + the 1s interval are for).
2. `filter: blur` on the `<article>` also blurs a child label. => Blur the article's CONTENT CHILDREN (not the article), keep the reason-label as a sibling child, set children `pointer-events:none` so a click falls through to the article for reveal.
3. The flag button MUST live on `<body>`. Injecting it into the post action bar (`[role="group"]`) failed — React clips/wipes injected children there.
4. The HTML `hidden` attribute is overridden by an explicit `display` in our CSS. => Need `.slopfilter-flagwrap[hidden], .slopfilter-menu[hidden] { display:none !important }`.
5. Handle extraction works on the TIMELINE only; profile/post pages have a different DOM (open TODO). Flag by @handle (renamable — accepted as "the price of policing"); capture numeric X user id only when resolvable.
6. `node --check` passes undefined references — verify called functions exist.
7. Always render handles with `textContent`, never `innerHTML` (XSS).
8. The strictness control has NO visible effect in Phase 1 (community list is empty); your own flags hide regardless. This is expected, not a bug.

## DECISIONS LOCKED (see SPEC for rationale)
- Account-level flagging only. Strictness stops: +1/+10/+100/+1000 (total distinct flags; applied locally). Threshold scope = total, not per-category.
- Identity = random UUID, generate-once, hidden. Sybil risk accepted at current scale.
- Backend = Supabase free tier. Monetization = $1/mo handle reservation (Stripe, Phase 3).
- Mobile deferred 100%.

NEXT: read `SPEC.md`, then begin Phase 2 step 1.
