// background.js — Slopfilter service worker (Phase 2)
// Responsibilities: identity bootstrap, default settings, flag submission to
// Supabase (with offline retry queue), and periodic community-list delta sync.

const SUPABASE_URL = 'https://uuvrkgqgsrqkxvdxdsyk.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dnJrZ3Fnc3Jxa3h2ZHhkc3lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNjQzNjAsImV4cCI6MjA5Nzc0MDM2MH0.EHdaVvM00uS_-6L0E5HYBfN5iiiAExn5DbtxSRYxBS8';

const ADJECTIVES = [
  'suspicious', 'grumpy', 'sleepy', 'sneaky', 'salty', 'cranky', 'feral',
  'dizzy', 'soggy', 'spicy', 'moody', 'rowdy', 'clumsy', 'sassy', 'brisk',
];
const ANIMALS = [
  'Heron', 'Otter', 'Badger', 'Marmot', 'Gecko', 'Walrus', 'Lemur', 'Newt',
  'Crow', 'Toad', 'Stoat', 'Vole', 'Quokka', 'Yak', 'Tapir',
];

function randInt(n) {
  return Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * n);
}

function randomDisplayName() {
  return (
    ADJECTIVES[randInt(ADJECTIVES.length)] +
    ANIMALS[randInt(ANIMALS.length)] +
    (randInt(90) + 10)
  );
}

function defaultSettings() {
  return {
    strictness: 10,
    treatment: 'blur',
    flagging: true,
    categories: { bot: true, 'ai-slop': true, ragebait: true, spam: true },
    anchor: { fx: 0.95, fy: 0.05 },
  };
}

async function ensureIdentity() {
  const sync = await chrome.storage.sync.get([
    'slopfilter:id',
    'slopfilter:displayName',
  ]);
  const patch = {};
  if (!sync['slopfilter:id']) patch['slopfilter:id'] = crypto.randomUUID();
  if (!sync['slopfilter:displayName']) {
    patch['slopfilter:displayName'] = randomDisplayName();
  }
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
}

async function ensureSettings() {
  const local = await chrome.storage.local.get('slopfilter:settings');
  if (!local['slopfilter:settings']) {
    await chrome.storage.local.set({ 'slopfilter:settings': defaultSettings() });
  }
}

async function getInstallerId() {
  const s = await chrome.storage.sync.get('slopfilter:id');
  return s['slopfilter:id'] || null;
}

// ----- Flag submission -----

const HEADERS = {
  'Content-Type': 'application/json',
  'apikey': ANON_KEY,
  'Authorization': `Bearer ${ANON_KEY}`,
  // upsert: silently ignore duplicate (same flagger + handle)
  'Prefer': 'resolution=ignore-duplicates',
};

async function pushFlag(flaggerId, handle, category) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/flags`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      flagger_id: flaggerId,
      target_handle: handle.toLowerCase(),
      category,
    }),
  });
  // 201 = created, 409 = already flagged (unique constraint) — both are fine
  if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`);
}

async function enqueueRetry(entry) {
  const s = await chrome.storage.local.get('slopfilter:retry');
  const q = s['slopfilter:retry'] || [];
  // avoid duplicate queue entries for the same handle
  if (!q.some((e) => e.target_handle === entry.target_handle && e.flagger_id === entry.flagger_id)) {
    q.push(entry);
    await chrome.storage.local.set({ 'slopfilter:retry': q });
  }
}

async function flushRetryQueue() {
  const s = await chrome.storage.local.get('slopfilter:retry');
  const q = s['slopfilter:retry'] || [];
  if (!q.length) return;
  const failed = [];
  for (const entry of q) {
    try {
      await pushFlag(entry.flagger_id, entry.target_handle, entry.category);
    } catch {
      failed.push(entry);
    }
  }
  await chrome.storage.local.set({ 'slopfilter:retry': failed });
}

// ----- Community sync -----

async function syncCommunity() {
  try {
    const s = await chrome.storage.local.get([
      'slopfilter:community',
      'slopfilter:lastSync',
    ]);
    const lastSync = s['slopfilter:lastSync'];

    let url =
      `${SUPABASE_URL}/rest/v1/flagged_accounts` +
      `?select=target_handle,flag_count,categories,last_flagged_at`;
    if (lastSync) {
      url += `&last_flagged_at=gte.${encodeURIComponent(lastSync)}`;
    }

    const res = await fetch(url, {
      headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) {
      console.warn(`[slopfilter] sync failed: HTTP ${res.status}`);
      return;
    }

    const rows = await res.json();
    const cache = s['slopfilter:community'] || {};
    for (const row of rows) {
      cache[row.target_handle.toLowerCase()] = {
        count: Number(row.flag_count),
        categories: row.categories || [],
      };
    }

    await chrome.storage.local.set({
      'slopfilter:community': cache,
      'slopfilter:lastSync': new Date().toISOString(),
    });
    console.debug(`[slopfilter] synced ${rows.length} community record(s)`);
  } catch (e) {
    console.warn('[slopfilter] sync error:', e);
  }
}

// ----- Message handler (content script → background) -----

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SUBMIT_FLAG') {
    getInstallerId().then(async (flaggerId) => {
      if (!flaggerId) return;
      try {
        await pushFlag(flaggerId, msg.handle, msg.category);
        await syncCommunity(); // pull the updated list back down immediately
      } catch {
        await enqueueRetry({
          flagger_id: flaggerId,
          target_handle: msg.handle.toLowerCase(),
          category: msg.category,
        });
      }
    });
  }
});

// ----- Alarms -----

chrome.alarms.create('slopfilter:sync', { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'slopfilter:sync') return;
  await flushRetryQueue();
  await syncCommunity();
});

// ----- Lifecycle -----

chrome.runtime.onInstalled.addListener(async () => {
  await ensureIdentity();
  await ensureSettings();
  await syncCommunity(); // full pull on first install
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureIdentity();
  await flushRetryQueue();
  await syncCommunity();
});
