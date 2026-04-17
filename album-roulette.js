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
    document.getElementById('vinyl').classList.remove('spinning');
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
  albums = [
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
  setStored({ source: 'demo' });
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

  const v = document.getElementById('vinyl');
  v.classList.remove('spinning');
  requestAnimationFrame(() => requestAnimationFrame(() => v.classList.add('spinning')));

  const note = document.getElementById('skipped-note');
  note.style.display = skipped.size > 0 ? 'block' : 'none';
  note.textContent   = `${skipped.size} album${skipped.size > 1 ? 's' : ''} passed this round`;
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

  // Persist the updated listen date to localStorage (unless demo mode)
  const stored = getStored();
  if (stored.source !== 'demo' && stored.albums) {
    const updated = stored.albums.map(sa => {
      if (sa.band === a.band && sa.album === a.album) {
        return { ...sa, lastListen: today };
      }
      return sa;
    });
    setStored({ albums: updated });
    showToast(`✓ Saved "${a.album}" — ${today}`, 'success');
  } else {
    showToast(`✓ Marked "${a.album}"`, 'success');
  }

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