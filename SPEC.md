# Slopfilter — X.com Community Slop Filter (working title)

A browser extension that filters out AI-slop, bot accounts, ragebait, and
generally low-quality content on x.com, powered by a shared, community-built
flag list. Anyone running the extension can choose how strict their filter is.

> **Status:** Phase 1 built (local-only). Project root: `D:\Ideas\slop-addon`.
> **Owner:** Diego (Product Owner). Build: Claude.
> Last updated: 2026-06-18.

---

## 1. Core principle

> **Flags go _up_, the list comes _down_, and all matching happens _locally_.**

The extension never reports what the user is viewing. The server only ever
receives *flag submissions*. The extension periodically downloads the
aggregated flag list, caches it locally, and does all matching in the content
script. This keeps it private, cheap, and functional offline.

```
┌─────────────┐   submit flag    ┌──────────────────┐
│  Extension  │ ───────────────► │  Serverless API  │
│ (content    │                  │  (Supabase)      │
│  script on  │ ◄─────────────── │  + flag database │
│  x.com)     │   delta sync     └──────────────────┘
└─────────────┘
       │
       ▼ match locally → hide / blur / label
```

---

## 2. Locked decisions

| Topic | Decision |
|---|---|
| **Flag granularity** | **Account-level only.** "If they don't like it, they shouldn't post slop." |
| **Strictness slider** | 4 stops — **+1 / +10 / +100 / +1000** independent flags. `+1` is a meme option; `+10` is the real usability floor. Applied **locally** (instant, private, no re-fetch). Numbers adjustable later. |
| **Threshold scope** | **Total** distinct flags across all categories (not per-category) for now. |
| **Flagger identity** | Auto-generated random UUID on first install. Never shown, never editable. Stored in `chrome.storage.sync` (roams w/ Chrome profile, survives reinstall) + `local` fallback. Generate-once guard → persists across refreshes & updates. |
| **Display name** | Cosmetic only, over the hidden ID. Renames never affect flag ownership. (§6) |
| **Detection mechanism** | Community flags only (no local heuristics, no AI classification). |
| **Backend** | Supabase (Postgres + auto REST API + RLS), free tier. Account under Diego's "mess-around" email/GitHub. |
| **Cold start** | None. Diego seeds the list by using it. |
| **Tech stack** | Vanilla JS (zero-build). No Node/npm/bundler at runtime. Hand-written CSS. Manifest V3. |
| **Monetization** | **$1 / month subscription** (MRR) unlocks a reserved unique handle. (§6) |
| **Mobile** | Deferred 100%. Keep code portable; no mobile work now. |

---

## 3. Architecture components

- **Content script** — runs on `x.com`. Scans the timeline DOM, identifies the
  account behind each post, checks it against the locally cached flag list, and
  applies the chosen treatment (hide / blur-with-reveal / label badge).
- **Flag UI** — a single floating 🚩 button that follows the hovered post (see §4.1),
  with a category menu (bot / AI-slop / ragebait / spam).
- **Popup + options page** — see §3.1.
- **Background service worker** — owns the ID bootstrap, periodic delta sync,
  local cache, and the offline retry queue.
- **Backend (Supabase)** — stores raw flags, exposes an aggregated list + delta endpoint.

### 3.1 Popup UI (custom design system — no UI framework)

Modern dark UI hand-built in CSS (design tokens, blue→indigo accent gradient,
micro-animations). No Material/MUI — MV3 forbids remote code and a framework is
overkill; principles borrowed, not the library. Top → bottom:

1. **Brand row** — funnel logo (matches the toolbar icon) + "Slopfilter" wordmark,
   and an **identity chip** (display name + status dot: grey = free, gold = subscribed).
2. **Strictness** — animated **segmented control** `+1 / +10 / +100 / +1000` (sliding
   thumb) + a hint line. (Gates the community list — Phase 2; own flags always hide.)
3. **Category chips** — four animated multi-select toggles (🤖 bot / ✨ AI-slop /
   😡 ragebait / 🗑️ spam) with check states.
4. **When flagged** — segmented **Blur / Hide** treatment toggle.
5. **Support button** — gradient pill, $1/mo handle reservation (Phase 3).
6. **Footer** — count of accounts you've flagged.

The floating flag button, its dropdown, and the blurred-post label use the same
visual language (gradient, pop-in animations).

Icons: generated as PNGs (16/32/48/128) by `scripts/generate-icons.js` — a pure-Node
zero-dependency PNG encoder drawing the funnel mark.

---

## 4. Flagging target: handle vs numeric ID

X handles can be renamed to dodge a flag, but **handle-primary is the accepted
approach**: the rehandle cost *is* the punishment, and only matters once the user
base is large enough to re-flag a renamed account almost immediately. X's stable
numeric user ID is a **nice-to-have** captured best-effort when present.

**Plan:** key on `target_handle`; store `target_x_id` when resolvable; always
display the handle.

### 4.1 React-proofing the UI (learned the hard way)

X manages every `<article>` via React — it owns the element's `className` and
re-renders posts constantly. Two consequences shaped the implementation:

- **Flag button:** lives as a single **draggable 🚩 attached to `<body>`** (outside
  React's tree), repositioned over whichever post is hovered. Injecting it into the
  per-post action bar (`role="group"`) failed — React clipped/wiped it. Drag position
  is stored as a relative anchor `{fx, fy}` (fraction of a post's box) in settings, so
  all posts show it in the same spot. Click = menu; drag = reposition.
- **Treatments (blur/hide):** applied as **inline `style` + `!important`**, NOT a CSS
  class — React overwrites `className` on re-render and wiped class-based treatments
  instantly. Inline styles are re-asserted on every mutation + a 1s safety sweep.
  Blur uses click-to-reveal (per-account, per session).

---

## 5. Identity & persistence detail

No hardware-bound identifier is available to a sandboxed extension (nor wanted —
that's fingerprinting). Persistence is achieved by generate-once:

1. On startup, read ID from storage.
2. If present → use it.
3. If absent → `crypto.randomUUID()`, store it, never regenerate.

Stored in `chrome.storage.sync` (survives reinstall, roams across the user's
devices with Chrome Sync on) + `chrome.storage.local` fallback. Attached as a
signature to every flag so the server counts *independent* flaggers.

**Known limitation (accepted):** random IDs make Sybil attacks cheap. Irrelevant
at current scale. Future mitigations: per-IP rate limiting; weighted verified
sign-in. Schema leaves room; not built now.

---

## 6. Username / subscription system (DEFERRED — Phase 3+)

Cosmetics + monetization layered over the hidden ID.

- Free users: auto-assigned `adjectiveAnimalNN` handle (e.g. `suspiciousHeron36`).
  Collisions allowed — unlimited `slophater54`s. Status dot = grey.
- **$1 / month subscription** reserves a **unique** handle (first-come-first-serve).
  Status dot = gold. Reserving a name re-rolls anyone using it for free.
- Billing: Stripe (subscriptions). Server tracks subscription status →
  gates handle reservation.
- Schema impact now: a `display_name` column. A `reserved_handles` table +
  subscription status come in Phase 3.

---

## 7. Sync design

- **Push (submit flag):** flag is **optimistically applied locally on click**,
  **and** pushed to the server immediately. No timed batching (flagging is a rare,
  deliberate action — batching would only add a flush timer + loss risk). The
  **only** fallback is an **offline retry queue**: failed/offline pushes queue and
  retry. ~150 bytes per flag.
- **Pull (full list):** on install. ~30 KB gzipped @ 10k accounts; ~300 KB @ 100k.
- **Pull (delta):** every ~30 min + on browser startup. Client sends
  `last_synced_at`; server returns only entries changed since. Usually a few KB.
- **No desync risk:** server is the single source of truth; delta-pull reconciles.
  The user's own flag shows instantly via optimistic apply, confirmed next pull.
- **Threshold applied locally:** list downloaded with raw counts; slider filters
  client-side. Downloads low-count (noisy) entries; add a server-side floor only
  if volume explodes.

### 7.1 Data integrity

- **Sanitization (server):** `category` ∈ allowed set; `target_handle` matches
  `^[A-Za-z0-9_]{1,15}$` (X handle rules); reject malformed. Postgres `CHECK` + RLS.
- **Sanitization (client):** handles rendered via `textContent` only — never as
  HTML — so a crafted handle can't execute script.
- **Dedup / no double-counting:** `UNIQUE (flagger_id, target_handle)` +
  upsert-on-conflict → one installer, one flag per account. Aggregation uses
  `COUNT(DISTINCT flagger_id)`.

---

## 8. Data model (Supabase — draft)

```sql
-- A single flag submitted by one installer against one account.
create table flags (
  id            bigint generated always as identity primary key,
  flagger_id    uuid not null,              -- the hidden installer UUID
  target_x_id   text,                       -- X numeric user id (nice-to-have, nullable)
  target_handle text not null check (target_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  category      text not null check (category in ('bot','ai-slop','ragebait','spam')),
  created_at    timestamptz not null default now(),
  unique (flagger_id, target_handle)        -- one flag per installer per account
);

-- Aggregated view the extension pulls.
create view flagged_accounts as
  select
    target_handle,
    max(target_x_id)           as target_x_id,
    count(distinct flagger_id) as flag_count,
    max(created_at)            as last_flagged_at
  from flags
  group by target_handle;

-- Cosmetic/monetization, deferred (Phase 3).
create table installers (
  id           uuid primary key,
  display_name text,
  created_at   timestamptz not null default now()
);
```

> RLS: anonymous inserts into `flags` allowed (shape validated by CHECKs), reads
> only via the aggregated view. Finalize during Phase 2.

---

## 9. Phased build plan

1. **Phase 1 — Local core (no backend). ✅ BUILT**
   Content script detects accounts; strictness slider; hide/blur/label
   treatments; local-only flag list; popup UI per §3.1; ID bootstrap;
   floating flag button.
2. **Phase 2 — Backend + sync.**
   Supabase schema + RLS; flag submission signed with hidden UUID; aggregated +
   delta endpoints; background delta sync + local cache; offline retry queue;
   best-effort numeric-ID resolution.
3. **Phase 3 — Polish + monetization.**
   Per-category filtering; flag/unflag UX; popup stats; export/import;
   username system + $1/mo Stripe subscription + status dot.
4. **Phase 4 — Distribution.**
   Chrome Web Store. Later: iOS Safari + Firefox Android packaging.

---

## 10. Open questions / TODO

- [ ] Final project name (currently "Slopfilter").
- [x] Default treatment → blur-with-reveal; Hide available via popup toggle.
- [x] Threshold scope → total distinct flags (not per-category).
- [x] Toolbar/extension icons → funnel mark, generated via `scripts/generate-icons.js`.
- [ ] Confirm Supabase region / project setup (Phase 2) — under mess-around email/GitHub.
- [ ] Stripe account ownership (Phase 3).
- [ ] Flagging from a **profile page** doesn't resolve the handle (different DOM than the
      timeline). Works on the timeline. Fix handle extraction for profile/post pages (Phase 2).
