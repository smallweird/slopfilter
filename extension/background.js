// background.js — Slopfilter service worker (Phase 1)
// Responsibilities: bootstrap the hidden installer ID + a random display name,
// and seed default settings. The ID is generated ONCE and never regenerated,
// so it survives refreshes and extension updates. Stored in chrome.storage.sync
// so it roams with the user's Chrome profile (and survives reinstall when
// Chrome Sync is on), with no UI to view or edit it.

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
    strictness: 10, // one of 1 | 10 | 100 | 1000
    treatment: 'blur', // 'hide' | 'blur'
    categories: { bot: true, 'ai-slop': true, ragebait: true, spam: true },
    anchor: { fx: 0.95, fy: 0.05 }, // flag-button position (fraction of a post's box)
  };
}

// Generate-once identity. Returns the existing values untouched if present.
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

chrome.runtime.onInstalled.addListener(async () => {
  await ensureIdentity();
  await ensureSettings();
});

// Safety net: also ensure identity exists on browser startup.
chrome.runtime.onStartup.addListener(ensureIdentity);
