// ── Constants ──────────────────────────────────────────────────────────────
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'albumRoulette_v5';

// ── State ──────────────────────────────────────────────────────────────────
let albums = [], pool = [], current = null, skipped = new Set(), markedCount = 0;

// ── localStorage ───────────────────────────────────────────────────────────
function getStored() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch (e) { return {}; }
}
function setStored(patch) {
  const cur = getStored();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cur, ...patch }));
}

// ── Helpers ────────────────────────────────────────────────────────────────
function colLetterToIndex(l) {
  l = (l || 'A').toUpperCase().trim();
  let n = 0;
  for (let i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64);
  return n - 1;
}
function todayString() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}
function isHeardRecently(ds) {
  if (!ds || !ds.trim()) return false;
  const d = new Date(ds);
  return !isNaN(d) && (Date.now() - d.getTime()) < ONE_YEAR_MS;
}
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = ''; }, 3500);
}
function setStatus(state, label) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  dot.className = 'dot' + (state === 'live' ? ' live' : state === 'error' ? ' error' : '');
  txt.textContent = label || (state === 'live' ? 'Connected' : state === 'error' ? 'Error' : 'Not connected');
}

// ── Drawer ─────────────────────────────────────────────────────────────────
function toggleDrawer() {
  document.getElementById('settings-drawer').classList.contains('open')
    ? closeDrawer() : openDrawer();
}
function openDrawer() {
  document.getElementById('settings-drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('show');
  document.getElementById('gear-btn').classList.add('active');
  renderStorageInfo();
}
function closeDrawer() {
  document.getElementById('settings-drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('show');
  document.getElementById('gear-btn').classList.remove('active');
}

// ── Screen management ──────────────────────────────────────────────────────
function showScreen(name) {
  document.getElementById('setup-screen').style.display  = name === 'setup' ? '' : 'none';
  document.getElementById('album-card').style.display    = name === 'card'  ? 'flex' : 'none';
  document.getElementById('done-screen').style.display   = name === 'done'  ? '' : 'none';
  document.getElementById('stats-bar').classList.toggle('visible', name !== 'setup');
  if (name !== 'card') {
    document.getElementById('skipped-note').style.display = 'none';
  }
}

// ── CSV parsing ────────────────────────────────────────────────────────────
function parseCSV(text) {
  // Split into lines, handle \r\n and \r
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return lines.map(line => {
    // Basic CSV parser: handle quoted fields
    const fields = [];
    let field = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  });
}

function buildConfigFromForm() {
  return {
    colBand:   colLetterToIndex(document.getElementById('col-band').value),
    colAlbum:  colLetterToIndex(document.getElementById('col-album').value),
    colDate:   colLetterToIndex(document.getElementById('col-date').value),
    hasHeader: document.getElementById('has-header').value === 'yes',
  };
}

// ── Load CSV file ──────────────────────────────────────────────────────────
function handleCSVFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      importCSV(e.target.result);
    } catch (err) {
      showToast('Could not read CSV: ' + err.message, 'error');
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function importCSV(text) {
  const cfg    = buildConfigFromForm();
  const rows   = parseCSV(text);
  const start  = cfg.hasHeader ? 1 : 0;

  // Load existing stored albums so we can preserve last-listen dates
  const stored      = getStored();
  const existingMap = {};  // key: "band|||album" → lastListen
  (stored.albums || []).forEach(a => {
    const key = (a.band + '|||' + a.album).toLowerCase();
    existingMap[key] = a.lastListen || '';
  });

  const newAlbums = [];
  let added = 0, skippedDup = 0;

  for (let i = start; i < rows.length; i++) {
    const row   = rows[i];
    const band  = (row[cfg.colBand]  || '').trim();
    const album = (row[cfg.colAlbum] || '').trim();
    if (!band && !album) continue;

    const key = (band + '|||' + album).toLowerCase();
    const lastListen = existingMap.hasOwnProperty(key)
      ? existingMap[key]                        // preserve existing date
      : (row[cfg.colDate] || '').trim();        // use CSV value for new entries

    // Check if this is actually new
    if (!existingMap.hasOwnProperty(key)) added++;
    else skippedDup++;

    newAlbums.push({ band, album, lastListen });
  }

  if (newAlbums.length === 0) {
    showToast('No albums found — check column settings.', 'error');
    return;
  }

  // Save config and albums
  setStored({
    albums: newAlbums,
    config: {
      colBand:   document.getElementById('col-band').value,
      colAlbum:  document.getElementById('col-album').value,
      colDate:   document.getElementById('col-date').value,
      hasHeader: document.getElementById('has-header').value,
    },
    source: 'csv',
  });

  const msg = stored.albums
    ? `Loaded ${newAlbums.length} albums (+${added} new, ${skippedDup} updated)`
    : `Loaded ${newAlbums.length} albums`;
  showToast(msg, 'success');

  albums = newAlbums;
  setStatus('live', 'CSV file');
  renderStorageInfo();
  closeDrawer();
  initSession();
}

// ── Storage info panel ─────────────────────────────────────────────────────
function renderStorageInfo() {
  const stored = getStored();
  const el     = document.getElementById('storage-info');
  if (!el) return;

  if (!stored.albums || stored.albums.length === 0) {
    el.innerHTML = '<div style="color:var(--text-dim);font-size:11px;">No data loaded yet.</div>';
    return;
  }

  const total    = stored.albums.length;
  const heard    = stored.albums.filter(a => isHeardRecently(a.lastListen)).length;
  const unheard  = total - heard;

  el.innerHTML = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;">
      <div><span style="color:var(--gold);font-size:16px;font-family:var(--serif);font-weight:700;">${total}</span>
           <div style="color:var(--text-dim);font-size:9px;letter-spacing:1px;text-transform:uppercase;margin-top:1px;">Albums stored</div></div>
      <div><span style="color:var(--gold);font-size:16px;font-family:var(--serif);font-weight:700;">${unheard}</span>
           <div style="color:var(--text-dim);font-size:9px;letter-spacing:1px;text-transform:uppercase;margin-top:1px;">To discover</div></div>
      <div><span style="color:var(--gold);font-size:16px;font-family:var(--serif);font-weight:700;">${heard}</span>
           <div style="color:var(--text-dim);font-size:9px;letter-spacing:1px;text-transform:uppercase;margin-top:1px;">Heard recently</div></div>
    </div>`;
}

// ── Demo data ──────────────────────────────────────────────────────────────
function loadDemo() {
  const old    = `1/1/${new Date().getFullYear() - 2}`;
  const recent = `6/1/${new Date().getFullYear()}`;
  const base = [
    { band: 'Radiohead',      album: 'OK Computer',           lastListen: old    },
    { band: 'The Beatles',    album: 'Abbey Road',            lastListen: ''     },
    { band: 'David Bowie',    album: 'Ziggy Stardust',        lastListen: recent },
    { band: 'Fleetwood Mac',  album: 'Rumours',               lastListen: ''     },
    { band: 'Pink Floyd',     album: 'Dark Side of the Moon', lastListen: old    },
    { band: 'Joni Mitchell',  album: 'Blue',                  lastListen: ''     },
    { band: 'Led Zeppelin',   album: 'IV',                    lastListen: old    },
    { band: 'Kendrick Lamar', album: 'To Pimp a Butterfly',   lastListen: ''     },
    { band: 'Arcade Fire',    album: 'Funeral',               lastListen: recent },
    { band: 'Nick Drake',     album: 'Pink Moon',             lastListen: ''     },
    { band: 'Talking Heads',  album: 'Remain in Light',       lastListen: old    },
    { band: 'Björk',          album: 'Homogenic',             lastListen: ''     },
  ];

  // Merge with any saved listen dates
  const stored = getStored();
  const existingMap = {};
  (stored.albums || []).forEach(a => {
    existingMap[(a.band + '|||' + a.album).toLowerCase()] = a.lastListen || '';
  });
  albums = base.map(a => {
    const key = (a.band + '|||' + a.album).toLowerCase();
    return existingMap.hasOwnProperty(key) ? { ...a, lastListen: existingMap[key] } : a;
  });

  setStored({ source: 'demo', albums });
  setStatus('live', 'Demo data');
  showToast('Demo data loaded!', 'success');
  closeDrawer();
  initSession();
}

// ── Session ────────────────────────────────────────────────────────────────
function initSession() {
  skipped.clear();
  markedCount = 0;
  pool = albums.map((_, i) => i).filter(i => !isHeardRecently(albums[i].lastListen));
  updateStats();
  pickNext();
}

function buildAvailable() { return pool.filter(i => !skipped.has(i)); }

function pickNext() {
  let avail = buildAvailable();
  if (avail.length === 0) {
    if (pool.length > 0) { skipped.clear(); avail = buildAvailable(); }
    if (avail.length === 0) { showScreen('done'); return; }
  }
  current = avail[Math.floor(Math.random() * avail.length)];
  renderCard(albums[current]);
  showScreen('card');
}

function renderCard(a) {
  document.getElementById('card-band').textContent  = a.band;
  document.getElementById('card-album').textContent = a.album;
  document.getElementById('card-count').textContent =
    `${pool.length - buildAvailable().length} of ${pool.length} explored`;
  document.getElementById('card-meta').textContent  =
    a.lastListen ? `Last listened: ${a.lastListen}` : 'Never logged';

  const canvas = document.getElementById('vinyl-canvas');
  drawTruchet(canvas, a.band, a.album);

  const note = document.getElementById('skipped-note');
  note.style.display = skipped.size > 0 ? 'block' : 'none';
  note.textContent   = `${skipped.size} album${skipped.size > 1 ? 's' : ''} passed this round`;
}

// ── Tri-tree truchet ───────────────────────────────────────────────────────
const _hs3   = Math.sqrt(3) / 2;
const _sixth = Math.PI / 3;

function _mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function _fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function drawTruchet(canvas, band, album) {
  const W   = canvas.width;
  const ctx = canvas.getContext('2d');
  const rng = _mulberry32(_fnv1a(band + '\x00' + album));

  // Derive palette from seed
  const hue  = rng() * 360;
  const hue2 = (hue + 140 + rng() * 80) % 360;
  const pal  = [
    `hsl(${hue  |0},${25+rng()*30|0}%,${10+rng()*8|0}%)`,  // bg / outline
    `hsl(${hue2 |0},${35+rng()*35|0}%,${55+rng()*20|0}%)`, // fill arcs
  ];

  const sw              = W * 0.075;
  const splitChance     = 0.5;
  const forceSplitLayer = 3;

  ctx.save();
  ctx.fillStyle = pal[0];
  ctx.fillRect(0, 0, W, W);
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(W / 2, W / 2);
  ctx.lineCap   = 'round';
  ctx.lineWidth = sw / 2;

  function outlined_arc(x, y, s, a1, a2) {
    ctx.strokeStyle = pal[1];
    ctx.beginPath(); ctx.arc(x, y, s / 2, a1, a2); ctx.stroke();
    ctx.strokeStyle = pal[0];
    ctx.beginPath(); ctx.arc(x, y, (s + sw) / 2, a1, a2); ctx.stroke();
  }

  function truchet(x, y, s, up) {
    ctx.save();
    ctx.translate(x, y);
    if (!up) ctx.rotate(Math.PI);
    const r  = rng() * 3 | 0;
    const rp = Math.round(s / sw);
    for (let i = 0; i < rp * (r === 0 ? 0.75 : 0.5); i++)
      outlined_arc(-s / 2,        _hs3 * 0.5 * s,  sw * (2*i+1), -_sixth, 0);
    for (let i = 0; i < rp * (r === 1 ? 0.75 : 0.5); i++)
      outlined_arc( s / 2,        _hs3 * 0.5 * s,  sw * (2*i+1), Math.PI, Math.PI + _sixth);
    for (let i = 0; i < rp * (r === 2 ? 0.75 : 0.5); i++)
      outlined_arc(0,        -s * _hs3 * 0.5,  sw * (2*i+1), _sixth, 2 * _sixth);
    ctx.restore();
  }

  function splitTri(x, y, s, up, l, forced) {
    if (forced || (rng() < splitChance && s > sw * 4)) {
      const nf = (l + 1) < forceSplitLayer;
      const dy = s * (up ? 1 : -1) * _hs3 / 4;
      splitTri(x,       y + dy,  s/2, !up, l+1, nf);
      splitTri(x,       y - dy,  s/2,  up, l+1, nf);
      splitTri(x - s/4, y + dy,  s/2,  up, l+1, nf);
      splitTri(x + s/4, y + dy,  s/2,  up, l+1, nf);
    } else {
      truchet(x, y, s, up);
    }
  }

  splitTri(0, 0, sw * (2 ** 7), true, 0, true);
  ctx.restore();
}

function skipAlbum() {
  if (current === null) return;
  skipped.add(current);
  pickNext();
}

function markListened() {
  if (current === null) return;
  const a     = albums[current];
  const today = todayString();

  a.lastListen = today;
  pool = pool.filter(i => i !== current);
  markedCount++;
  skipped.delete(current);
  updateStats();

  // Persist the updated listen date to localStorage
  const stored = getStored();
  if (stored.albums) {
    const updated = stored.albums.map(sa =>
      sa.band === a.band && sa.album === a.album ? { ...sa, lastListen: today } : sa
    );
    setStored({ albums: updated });
  }
  showToast(`✓ Marked "${a.album}"`, 'success');

  pickNext();
}

function updateStats() {
  document.getElementById('stat-total').textContent   = albums.length;
  document.getElementById('stat-unheard').textContent = pool.length;
  document.getElementById('stat-marked').textContent  = markedCount;
}

function restartSession() {
  const stored = getStored();
  if (stored.source === 'demo') { loadDemo(); return; }
  if (stored.albums && stored.albums.length > 0) {
    albums = stored.albums;
    setStatus('live', 'CSV file');
    initSession();
  } else {
    showScreen('setup');
  }
}

function resetAll() {
  if (!confirm('Clear all saved data and start over?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

// ── Boot ───────────────────────────────────────────────────────────────────
(function boot() {
  // Restore column config to form
  const stored = getStored();
  if (stored.config) {
    const c = stored.config;
    if (c.colBand)   document.getElementById('col-band').value   = c.colBand;
    if (c.colAlbum)  document.getElementById('col-album').value  = c.colAlbum;
    if (c.colDate)   document.getElementById('col-date').value   = c.colDate;
    if (c.hasHeader) document.getElementById('has-header').value = c.hasHeader;
  }

  if (stored.source === 'demo' && stored.albums && stored.albums.length > 0) {
    albums = stored.albums;
    setStatus('live', 'Demo data');
    initSession();
    return;
  }

  if (stored.source === 'demo') {
    loadDemo();
    return;
  }

  if (stored.source === 'csv' && stored.albums && stored.albums.length > 0) {
    albums = stored.albums;
    setStatus('live', 'CSV file');
    initSession();
    return;
  }

  showScreen('setup');
})();