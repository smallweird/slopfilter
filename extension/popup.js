// popup.js — Slopfilter popup logic
// Writes settings to chrome.storage; the content script reacts live (no save button).

const STOPS = [1, 10, 100, 1000];

function defaultSettings() {
  return {
    strictness: 10,
    treatment: 'blur', // 'blur' | 'hide'
    categories: { bot: true, 'ai-slop': true, ragebait: true, spam: true },
    anchor: { fx: 0.95, fy: 0.05 },
  };
}

const el = {
  dot: document.getElementById('statusDot'),
  name: document.getElementById('displayName'),
  strict: document.getElementById('strictness'),
  strictThumb: document.getElementById('strictThumb'),
  strictHint: document.getElementById('strictHint'),
  treat: document.getElementById('treatment'),
  treatThumb: document.getElementById('treatThumb'),
  flagging: document.getElementById('flagging'),
  flagThumb: document.getElementById('flagThumb'),
  chips: document.getElementById('chips'),
  count: document.getElementById('flagCount'),
  catCounts: document.getElementById('catCounts'),
};

let settings = defaultSettings();

// Move a segmented control's thumb + highlight the active button.
function setSegment(container, thumb, value) {
  const segs = [...container.querySelectorAll('.seg')];
  const idx = segs.findIndex((s) => s.dataset.val === String(value));
  const active = idx < 0 ? 0 : idx;
  segs.forEach((s, i) => s.classList.toggle('active', i === active));
  thumb.style.transform = `translateX(${active * 100}%)`;
}

function renderStrictHint() {
  el.strictHint.textContent =
    settings.strictness === 1
      ? 'Hides accounts with just 1 flag (basically everyone).'
      : `Hides accounts once ${settings.strictness} people flag them. Your own flags always hide.`;
}

async function load() {
  const sync = await chrome.storage.sync.get([
    'slopfilter:displayName',
    'slopfilter:subscribed',
  ]);
  const local = await chrome.storage.local.get([
    'slopfilter:settings',
    'slopfilter:flags',
  ]);

  const subscribed = !!sync['slopfilter:subscribed'];
  el.dot.classList.toggle('gold', subscribed);
  el.dot.classList.toggle('online', navigator.onLine);
  const displayName = sync['slopfilter:displayName'] || 'anon';
  el.name.textContent = displayName;
  document.getElementById('identity').title = subscribed
    ? `${displayName} — Reserved handle`
    : `${displayName} — Free user`;

  settings = Object.assign(defaultSettings(), local['slopfilter:settings'] || {});

  setSegment(el.strict, el.strictThumb, settings.strictness);
  setSegment(el.treat, el.treatThumb, settings.treatment);
  setSegment(el.flagging, el.flagThumb, settings.flagging);
  renderStrictHint();

  for (const chip of el.chips.querySelectorAll('.chip')) {
    chip.classList.toggle('on', !!settings.categories[chip.dataset.cat]);
  }

  const flags = local['slopfilter:flags'] || [];
  el.count.textContent = flags.length;

  const CAT_ICONS = { bot: '🤖', 'ai-slop': '✨', ragebait: '😡', spam: '🗑️' };
  const tally = { bot: 0, 'ai-slop': 0, ragebait: 0, spam: 0 };
  for (const f of flags) if (tally[f.category] !== undefined) tally[f.category]++;
  const parts = Object.entries(tally)
    .filter(([, n]) => n > 0)
    .map(([cat, n]) => `${CAT_ICONS[cat]} ${n}`);
  el.catCounts.textContent = parts.join('  ·  ');
}

async function save() {
  await chrome.storage.local.set({ 'slopfilter:settings': settings });
}

el.strict.addEventListener('click', (e) => {
  const seg = e.target.closest('.seg');
  if (!seg) return;
  settings.strictness = Number(seg.dataset.val);
  setSegment(el.strict, el.strictThumb, settings.strictness);
  renderStrictHint();
  save();
});

el.treat.addEventListener('click', (e) => {
  const seg = e.target.closest('.seg');
  if (!seg) return;
  settings.treatment = seg.dataset.val;
  setSegment(el.treat, el.treatThumb, settings.treatment);
  save();
});

el.flagging.addEventListener('click', (e) => {
  const seg = e.target.closest('.seg');
  if (!seg) return;
  settings.flagging = seg.dataset.val === 'true';
  setSegment(el.flagging, el.flagThumb, settings.flagging);
  save();
});

el.chips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const cat = chip.dataset.cat;
  settings.categories[cat] = !settings.categories[cat];
  chip.classList.toggle('on', settings.categories[cat]);
  save();
});


load();
