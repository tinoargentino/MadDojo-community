import {loopAtBar, resizeGridLoop} from './loop-grid.js';
import {detailedWaveform} from './waveform.js';
import {PracticeEngine, encodeWav, clamp} from './engine.js?v=20261106-loading';

const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const engine = new PracticeEngine();
const state = {
  songs: [], song: null, analysis: null, inbox: '', loading: false, browserReady: false, audioLoad: null,
  keyboardLoopBeats: null, detailWaveforms: {}, loopPending: false, viewStart: 0, viewDuration: 40, pitchMode: false, muted: false,
  grid: {bpm: 96, grid_offset: 0, beats_per_bar: 4, manual_grid: false, loops: []},
  mic: null, worker: null, recording: null, startingRecording: false, savingTake: false, pendingTakes: [],
  trace: [], score: {total: 0, voiced: 0, hit: 0},
  octave: Number(localStorage.getItem('dojo.octave') || 0),
  inputOffset: Number(localStorage.getItem('dojo.inputOffset') || 0),
  activeTake: null, liveMidi: null, lastCents: null, lastLibrary: '',
};
let toastTimeout, saveTimeout, loadGeneration = 0, drag = null, lastPaint = 0, lastUI = 0, micConnection = null, browserLoad = null;

function syncSidebar() {
  const collapsed = document.documentElement.dataset.sidebarCollapsed === 'true';
  const button = $('sidebar-toggle');
  button.setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? 'Show song library' : 'Hide song library';
  button.setAttribute('aria-label', label);
  button.title = `${label} · ⌘/Ctrl B`;
}
syncSidebar();
function toggleSidebar() {
  const collapsed = document.documentElement.dataset.sidebarCollapsed !== 'true';
  document.documentElement.dataset.sidebarCollapsed = String(collapsed);
  try { localStorage.setItem('dojo.sidebarCollapsed', String(collapsed)); } catch { /* Works without storage. */ }
  syncSidebar();
}
on('sidebar-toggle', 'click', toggleSidebar);

let commandMatches = [], commandIndex = 0;
function commands() {
  const items = [
    {label: 'Toggle song library', hint: '⌘/Ctrl B', search: 'sidebar collapse expand', run: toggleSidebar},
    {label: 'Add songs', run: () => openImport()},
    {label: 'Settings', run: openSettings},
    {label: 'Keyboard shortcuts', hint: '?', search: 'help keys', run: () => $('shortcuts-dialog').showModal()},
  ];
  if (state.analysis && state.song?.status === 'ready') items.push(
    {label: engine.playing ? 'Pause playback' : 'Play', hint: 'Space', run: togglePlayback},
    {label: 'Stop and return', hint: 'Esc', search: 'escape', run: () => $('stop').click()},
    {label: 'Restart loop or song', hint: 'Enter', run: () => $('restart').click()},
    {label: state.recording ? 'Finish recording' : 'Record a take', hint: 'R', run: toggleRecording},
    {label: 'Start loop at current bar / turn off', hint: 'L', run: toggleLoop},
    {label: 'Shorten loop by one bar', hint: ',', run: () => resizeLoop(-1)},
    {label: 'Extend loop by one bar', hint: '.', run: () => resizeLoop(1)},
    {label: 'Shorten loop by one beat', hint: 'Shift ,', run: () => resizeLoop(-1, true)},
    {label: 'Extend loop by one beat', hint: 'Shift .', run: () => resizeLoop(1, true)},
    {label: 'Mark loop start', hint: '[', run: markLoopStart},
    {label: 'Mark loop end', hint: ']', run: markLoopEnd},
    {label: 'Mute / restore guide track', hint: 'V', run: toggleVocal},
    {label: 'Lower guide track volume', hint: '−', search: 'minus', run: () => adjustGuideVolume(-5)},
    {label: 'Raise guide track volume', hint: '+', search: 'plus equal', run: () => adjustGuideVolume(5)},
    {label: 'Seek back one beat', hint: '←', search: 'arrowleft', run: () => engine.seek(engine.position - 60 / state.grid.bpm)},
    {label: 'Seek forward one beat', hint: '→', search: 'arrowright', run: () => engine.seek(engine.position + 60 / state.grid.bpm)},
    {label: 'Seek back one bar', hint: 'Shift ←', run: () => engine.seek(engine.position - 60 / state.grid.bpm * state.grid.beats_per_bar)},
    {label: 'Seek forward one bar', hint: 'Shift →', run: () => engine.seek(engine.position + 60 / state.grid.bpm * state.grid.beats_per_bar)},
    ...(state.song.mode === 'drum' ? [] : [{label: state.pitchMode ? 'Show practice' : 'Show pitch lab', run: () => setPitchMode(!state.pitchMode)}]),
    {label: 'Zoom in', hint: 'Z', run: () => zoom(.5)},
    {label: 'Zoom out', hint: 'Shift Z', run: () => zoom(2)},
    {label: 'Fit full song', run: () => $('zoom-fit').click()},
    {label: 'Export stems', run: () => $('download-button').click()},
    {label: 'Save loop phrase', run: () => $('save-loop').click()},
  );
  return [...items.map(item => ({...item, group: 'Commands'})), ...state.songs.map(song => ({group: 'Songs', label: song.title, hint: song.status !== 'ready' ? song.stage : song.mode && song.mode !== 'singer' ? {bass: 'Bass', guitar: 'Guitar', drum: 'Drums'}[song.mode] : song.id === state.song?.id ? 'Current song' : 'Song', run: () => loadSong(song.id)}))];
}
function adjustGuideVolume(delta) {
  $('vocal-volume').value = clamp(Number($('vocal-volume').value) + delta, 0, 100);
  state.muted = false; updateVolumes();
}
function commandSearchText(text) {
  return text.toLocaleLowerCase().replace(/⌘/g, 'cmd command ').replace(/([a-z])\+(?=[a-z])/g, '$1 ').replace(/\+/g, ' plus ').replace(/ctrl/g, 'ctrl control').replace(/\//g, ' ').trim();
}
function highlightCommand() {
  [...$('command-results').querySelectorAll('[role=option]')].forEach((row, i) => row.setAttribute('aria-selected', String(i === commandIndex)));
  const row = $('command-results').querySelectorAll('[role=option]')[commandIndex];
  if (row) {
    $('command-query').setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({block: 'nearest'});
  } else $('command-query').removeAttribute('aria-activedescendant');
}
function renderCommands() {
  const words = commandSearchText($('command-query').value).split(/\s+/).filter(Boolean);
  commandMatches = commands().filter(item => words.every(word => commandSearchText(`${item.label} ${item.hint || ''} ${item.search || ''}`).includes(word)));
  commandIndex = 0;
  const list = $('command-results'); list.replaceChildren();
  let group;
  commandMatches.forEach((item, i) => {
    if (!group || group.getAttribute('aria-label') !== item.group) {
      group = document.createElement('div'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', item.group);
      const heading = document.createElement('div'); heading.className = 'command-group-label'; heading.textContent = item.group; heading.setAttribute('aria-hidden', 'true'); group.append(heading); list.append(group);
    }
    const row = document.createElement('div'); row.id = `command-${i}`; row.className = 'command-row'; row.setAttribute('role', 'option');
    const label = document.createElement('span'); label.textContent = item.label; row.append(label);
    if (item.hint) { const hint = document.createElement('small'); hint.textContent = item.hint; row.append(hint); }
    row.addEventListener('click', () => runCommand(i));
    group.append(row);
  });
  if (!commandMatches.length) { const empty = document.createElement('p'); empty.className = 'command-empty'; empty.textContent = 'No results'; list.append(empty); }
  highlightCommand();
}
async function runCommand(index) {
  const item = commandMatches[index]; if (!item) return;
  $('command-dialog').close();
  try { await item.run(); } catch (error) { report(error); }
}
function openCommands() {
  if ($('command-dialog').open) { $('command-dialog').close(); return; }
  if (document.querySelector('dialog[open]')) return;
  $('command-query').value = '';
  $('command-dialog').showModal(); renderCommands(); $('command-query').focus();
}
on('commands-button', 'click', openCommands);
on('command-query', 'input', renderCommands);
on('command-query', 'keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (commandMatches.length) commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : -1) + commandMatches.length) % commandMatches.length;
    highlightCommand();
  } else if (event.key === 'Enter') { event.preventDefault(); runCommand(commandIndex); }
});
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) return;
  if (event.code === 'KeyK') { event.preventDefault(); openCommands(); }
  if (event.code === 'KeyB' && !document.querySelector('dialog[open]') && !event.target.closest('input,textarea,select,[contenteditable="true"]')) {
    event.preventDefault(); toggleSidebar();
  }
});

let paintColors;
function syncTheme() {
  const style = getComputedStyle(document.documentElement);
  paintColors = Object.fromEntries(['green', 'backing', 'accent', 'line', 'muted', 'paper', 'green-soft'].map(name => [name, style.getPropertyValue(`--${name}`).trim()]));
  document.querySelector('meta[name="theme-color"]').content = style.getPropertyValue('--bg').trim();
}
$('theme-select').value = document.documentElement.dataset.theme || 'paper';
syncTheme();
on('theme-select', 'change', () => {
  const theme = $('theme-select').value;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('dojo.theme', theme); } catch { /* Theme still works without storage. */ }
  syncTheme();
  drawWaveform(); drawOverview(); drawPitch();
});

function toast(message, error = false, duration = 4500) {
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').hidden = true, duration);
}
function report(error) { console.error(error); toast(error?.message || 'Something went wrong. Please try again.', true, 7000); }
function on(id, event, handler) {
  $(id).addEventListener(event, e => {
    try { const result = handler(e); if (result?.catch) result.catch(report); } catch (error) { report(error); }
  });
}
async function api(path, options = {}) {
  const response = await fetch(new URL(`api/${path}`, document.baseURI), options);
  if (!response.ok) {
    let detail;
    try { detail = (await response.json()).detail; } catch { /* HTTP fallback. */ }
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status}).`);
  }
  return response.json();
}
const audioURL = (songId, stem) => new URL(`api/songs/${songId}/audio/${stem}`, document.baseURI).href;
const previewURL = (songId, stem) => new URL(`api/songs/${songId}/preview/${stem}`, document.baseURI).href;
const takeURL = id => new URL(`api/takes/${id}/audio`, document.baseURI).href;

export function formatTime(seconds, decimals = 0) {
  seconds = Math.max(0, Number(seconds) || 0);
  const factor = 10 ** decimals;
  seconds = Math.round(seconds * factor) / factor;
  const min = Math.floor(seconds / 60), sec = seconds - min * 60;
  return `${String(min).padStart(2, '0')}:${sec.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')}`;
}
export function parseTime(value) {
  const parts = value.trim().split(':');
  if (parts.length > 2 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
}
const noteName = midi => {
  if (!Number.isFinite(midi)) return '—';
  const m = Math.round(midi), notes = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${notes[(m % 12 + 12) % 12]}${Math.floor(m / 12) - 1}`;
};

function renderLibrary() {
  const query = $('song-search').value.toLowerCase();
  const list = $('song-list');
  list.replaceChildren();
  $('song-count').textContent = state.songs.filter(s => !s.demo).length || state.songs.length;
  for (const song of state.songs.filter(s => s.title.toLowerCase().includes(query))) {
    const button = document.createElement('button');
    button.className = `song-item${song.id === state.song?.id ? ' active' : ''}`;
    button.setAttribute('aria-label', `${song.title}, ${song.status === 'ready' ? 'ready to practice' : song.stage}`);
    button.setAttribute('aria-pressed', String(song.id === state.song?.id));
    button.innerHTML = `<span class="song-art">${icon(song.demo ? 'wave' : 'music')}</span><span class="song-text"><strong></strong><small></small></span>`;
    button.querySelector('strong').textContent = song.title;
    button.querySelector('small').textContent = song.status === 'ready' ? `${song.mode && song.mode !== 'singer' ? {bass: 'Bass', guitar: 'Guitar', drum: 'Drums'}[song.mode] + ' · ' : ''}${formatTime(song.duration)} · ${Math.round(song.bpm)} BPM` : (song.status === 'error' ? 'Needs attention' : song.stage);
    if (song.status === 'processing') {
      const progress = document.createElement('span');
      progress.className = 'song-progress'; progress.style.width = `${song.progress * 100}%`;
      button.append(progress);
    }
    button.addEventListener('click', () => loadSong(song.id).catch(report));
    list.append(button);
  }
  if (!list.children.length) {
    const empty = document.createElement('p'); empty.className = 'tiny muted';
    empty.style.padding = '12px'; empty.textContent = query ? 'No songs found.' : 'Add a song to begin.'; list.append(empty);
  }
}

async function refreshLibrary(initial = false) {
  const data = await api('library');
  for (const song of data.songs) {
    if (song.id === 'warmup' && song.demo) song.title = 'Five-note warm-up';
  }
  state.songs = data.songs; state.inbox = data.inbox;
  $('inbox-path').textContent = data.inbox;
  $('copy-folder').title = data.inbox;
  const signature = JSON.stringify(data.songs);
  if (signature !== state.lastLibrary) { state.lastLibrary = signature; renderLibrary(); }
  if (initial) {
    const last = localStorage.getItem('dojo.song');
    const song = data.songs.find(s => s.id === last) || data.songs.find(s => s.status === 'ready') || data.songs[0];
    if (song) await loadSong(song.id);
  } else if (state.song) {
    const fresh = data.songs.find(s => s.id === state.song.id);
    if (fresh && state.song.status !== 'ready' && fresh.status === 'ready') await loadSong(fresh.id);
    else if (fresh && fresh.status !== 'ready') { state.song = fresh; renderSongHeader(); }
  }
  const watchErrors = Object.values(data.watch_errors || {});
  if (watchErrors.length) $('inbox-path').title = watchErrors.join('\n');
}

function renderSongHeader() {
  const song = state.song;
  if (!song) return;
  $('song-title').textContent = song.title;
  document.title = `${song.title} · MadDojo`;
  const mode = song.mode || 'singer';
  const guide = {singer: 'Guide vocal', bass: 'Guide bass', guitar: 'Guide guitar', drum: 'Guide drums'}[mode];
  document.querySelectorAll('.guide-label,.pitch-guide-label').forEach(label => label.textContent = guide);
  $('vocal-mute').setAttribute('aria-label', `Mute ${guide.toLowerCase()} (V)`);
  $('vocal-volume').setAttribute('aria-label', `${guide} volume`);
  $('pitch-tab').hidden = mode === 'drum';
  $('pitch-settings').hidden = mode === 'drum';
  if (mode === 'drum') setPitchMode(false);
  $('song-subtitle').textContent = song.demo ? '' : [song.duration ? formatTime(song.duration) : '', mode !== 'singer' ? {bass: 'Bass', guitar: 'Guitar', drum: 'Drums'}[mode] : '', song.bpm ? `${Math.round(song.bpm)} BPM` : ''].filter(Boolean).join(' · ');
  $('song-subtitle').hidden = !$('song-subtitle').textContent;
  const ready = song.status === 'ready';
  $('ardour-session-panel').hidden = !ready;
  $('browser-practice').hidden = !ready;
  if (ready) {
    $('ardour-download').href = new URL(`api/songs/${song.id}/ardour`, document.baseURI).href;
  }
  $('ready-badge').hidden = ready;
  $('ready-badge').innerHTML = `<span class="status-dot"></span>${ready ? 'Stems ready' : song.status === 'error' ? 'Needs attention' : 'Preparing stems'}`;
  $('practice-workspace').hidden = !ready;
  $('preparation-panel').hidden = ready;
  if (!ready) {
    $('preparation-title').textContent = song.status === 'error' ? 'Preparation failed' : 'Preparing song';
    $('preparation-stage').textContent = song.stage;
    $('preparation-progress').value = song.progress;
    $('preparation-detail').textContent = song.error || 'You can practice another song while this prepares.';
    $('retry-button').hidden = song.status !== 'error';
  }
}

async function loadSong(id) {
  if (state.song?.id === id && state.analysis && state.song.status === 'ready') return;
  if (state.recording) await finishRecording();
  if (state.savingTake) throw new Error('Your take is still saving. Please wait a moment.');
  const song = state.songs.find(s => s.id === id);
  if (!song) return;
  const generation = ++loadGeneration;
  engine.pause(); engine.stopTake();
  engine.cancelLoad(); browserLoad = null;
  engine.buffers = {}; engine.duration = 0; engine.offset = 0;
  state.loopPending = false; state.keyboardLoopBeats = null; state.detailWaveforms = {};
  state.song = song; state.analysis = null; state.trace = []; resetScore();
  state.browserReady = false; state.audioLoad = null;
  state.loading = true; state.activeTake = null;
  $('play').disabled = true;
  $('take-list').replaceChildren();
  renderLibrary(); renderSongHeader();
  localStorage.setItem('dojo.song', id);
  if (song.status !== 'ready') { state.loading = false; return; }
  let analysis;
  try { analysis = await api(`songs/${id}/analysis`); }
  finally { if (generation === loadGeneration) state.loading = false; }
  if (generation !== loadGeneration) return;
  state.analysis = analysis;
  engine.duration = analysis.duration;
  state.loading = false;
  state.grid = {bpm: analysis.bpm, grid_offset: 0, beats_per_bar: 4, manual_grid: false, loops: [], ...song.practice};
  state.grid.bpm ||= analysis.bpm;
  state.viewStart = 0; state.viewDuration = engine.duration;
  engine.setLoop(0, Math.min(engine.duration, 8 * 60 / state.grid.bpm), false);
  $('duration').textContent = formatTime(engine.duration);
  $('waveform').setAttribute('aria-valuemax', String(engine.duration));
  updateLoopUI(); renderSavedLoops(); updateGridSummary(); updateEngineUI();
  await ensureBrowserAudio();
}

async function ensureBrowserAudio() {
  if (state.browserReady) return true;
  if (!state.analysis || state.loading) return false;
  const id = state.song.id, generation = loadGeneration;
  if (browserLoad?.id === id) return browserLoad.promise;
  const task = {id, promise: null};
  browserLoad = task;
  state.audioLoad = {status: 'loading', received: 0, total: 0, stage: 'downloading'};
  updateAudioLoad();
  task.promise = (async () => {
    try {
      const loaded = await engine.load({vocals: previewURL(id, 'vocals'), backing: previewURL(id, 'backing')}, {
        duration: state.analysis.duration,
        onProgress: progress => {
          if (browserLoad !== task || generation !== loadGeneration) return;
          state.audioLoad = {status: 'loading', ...progress}; updateAudioLoad();
        },
      });
      if (generation !== loadGeneration || browserLoad !== task || !loaded) return false;
      state.browserReady = true; state.audioLoad = null;
      updateEngineUI(); updateLoopUI();
      const current = () => generation === loadGeneration;
      for (const stem of ['vocals', 'backing']) {
        detailedWaveform(engine.buffers[stem], current).then(detail => {
          if (detail && current()) state.detailWaveforms[stem] = detail;
        }).catch(console.error);
      }
      renderTakes().catch(report);
      return true;
    } catch (error) {
      if (generation !== loadGeneration || browserLoad !== task) return false;
      state.audioLoad = {status: 'error', message: error.message};
      throw error;
    } finally {
      if (browserLoad === task) { browserLoad = null; updateAudioLoad(); }
    }
  })();
  return task.promise;
}

function updateAudioLoad() {
  const load = state.audioLoad, busy = load?.status === 'loading', failed = load?.status === 'error';
  const visible = !state.browserReady && Boolean(state.analysis) && !$('browser-practice').hidden;
  $('audio-load-panel').hidden = !visible;
  $('play').disabled = !state.browserReady;
  $('record').disabled = !state.browserReady;
  if (!visible) return;
  const title = failed ? 'Practice audio could not load.' : busy && load.stage !== 'downloading' ? 'Getting playback ready…' : 'Loading practice audio…';
  if ($('audio-load-title').textContent !== title) $('audio-load-title').textContent = title;
  const mb = bytes => `${(bytes / 1e6).toFixed(1)} MB`;
  $('audio-load-detail').textContent = failed ? load.message : load?.received > 0
    ? `${mb(load.received)}${load.total ? ` of ${mb(load.total)}` : ''} · Play becomes available when both tracks are ready.`
    : 'Loading guide and backing';
  const bar = $('audio-load-progress');
  bar.hidden = failed;
  if (busy && load.total > 0) bar.value = Math.min(1, load.received / load.total);
  else bar.removeAttribute('value');
  $('audio-load-retry').hidden = busy;
}

let pendingImportFiles = null, youtubeImportBusy = false;
function openImport(files = null) {
  pendingImportFiles = files ? [...files] : null;
  $('import-choose').textContent = pendingImportFiles ? `Prepare ${pendingImportFiles.length} song${pendingImportFiles.length === 1 ? '' : 's'}` : 'Choose audio files';
  $('youtube-import').hidden = Boolean(pendingImportFiles);
  $('import-dialog').showModal();
}
async function importYoutube() {
  if (youtubeImportBusy) return;
  const input = $('youtube-url');
  if (!input.value.trim() || !input.reportValidity()) { input.focus(); return; }
  const mode = $('import-mode').value;
  youtubeImportBusy = true;
  for (const id of ['youtube-submit', 'import-choose', 'import-mode']) $(id).disabled = true;
  $('youtube-status').textContent = 'Downloading audio…';
  try {
    const form = new FormData(); form.append('url', input.value.trim()); form.append('mode', mode);
    const data = await api('import/youtube', {method: 'POST', body: form});
    input.value = ''; $('youtube-status').textContent = ''; $('import-dialog').close();
    await refreshLibrary();
    if (!engine.playing && !state.recording) await loadSong(data.song.id);
    toast(data.created ? 'Song added. Preparing practice tracks.' : 'Already in your library');
  } catch (error) { $('youtube-status').textContent = error.message; }
  finally {
    youtubeImportBusy = false;
    for (const id of ['youtube-submit', 'import-choose', 'import-mode']) $(id).disabled = false;
  }
}
on('youtube-submit', 'click', importYoutube);
on('youtube-url', 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); return importYoutube(); } });
on('import-mode', 'change', () => { $('import-mode-note').hidden = $('import-mode').value !== 'guitar'; });
on('import-choose', 'click', () => {
  if (!pendingImportFiles) { $('file-input').click(); return; }
  const files = pendingImportFiles; pendingImportFiles = null;
  const mode = $('import-mode').value; $('import-dialog').close();
  return importFiles(files, mode);
});
async function importFiles(files, mode = 'singer') {
  const chosen = [...files];
  if (!chosen.length) return;
  $('import-button').disabled = true;
  let firstId, success = 0, duplicate = 0;
  try {
    for (let i = 0; i < chosen.length; i++) {
      toast(`Adding ${chosen[i].name}${chosen.length > 1 ? ` (${i + 1}/${chosen.length})` : ''}…`, false, 60000);
      try {
        const form = new FormData(); form.append('file', chosen[i]); form.append('mode', mode);
        const data = await api('import', {method: 'POST', body: form});
        firstId ||= data.song.id;
        if (data.created) success++; else duplicate++;
      } catch (error) { report(error); }
    }
    await refreshLibrary();
    if (firstId && !engine.playing && !state.recording) await loadSong(firstId);
    if (success) toast(`${success === 1 ? 'Song added' : `${success} songs added`}. Preparing practice tracks.`, false, 6000);
    else if (duplicate) toast('Already in your library. No extra copy needed.');
  } finally { $('import-button').disabled = false; $('file-input').value = ''; }
}

function gridBeats() {
  if (!state.analysis) return [];
  const offset = state.grid.grid_offset || 0;
  if (!state.grid.manual_grid) return state.analysis.beats.map(x => x + offset).filter(x => x >= 0 && x <= engine.duration);
  const beat = 60 / state.grid.bpm;
  const first = offset + Math.ceil(-offset / beat) * beat;
  const count = Math.ceil(engine.duration / beat) + 2;
  return Array.from({length: count}, (_, i) => first + i * beat).filter(x => x >= 0 && x <= engine.duration);
}
function beatNumber(index) {
  // Keep bar phase tied to the declared first beat, even with lead-in beats.
  if (state.grid.manual_grid) return index + Math.ceil(-(state.grid.grid_offset || 0) / (60 / state.grid.bpm));
  const skipped = state.analysis?.beats.findIndex(time => time + (state.grid.grid_offset || 0) >= 0) ?? 0;
  return index + Math.max(0, skipped);
}
function nearestBeat(time) {
  if (!$('snap').checked) return clamp(time, 0, engine.duration);
  const beats = gridBeats();
  if (!beats.length) return time;
  const candidates = [0, ...beats, engine.duration];
  return candidates.reduce((best, b) => Math.abs(b - time) < Math.abs(best - time) ? b : best, candidates[0]);
}
function selectLoop(a, b, enabled = true) {
  if (!engine.duration) return;
  const start = clamp(Math.min(a, b), 0, engine.duration - .05);
  const end = clamp(Math.max(a, b), start + .05, engine.duration);
  state.loopPending = false;
  engine.setLoop(start, end, enabled);
  updateLoopUI();
}
function markLoopStart() {
  if (!engine.duration) return;
  const start = nearestBeat(engine.position);
  if (start >= engine.duration - .05) return;
  selectLoop(start, engine.duration, false);
  state.loopPending = true;
  updateLoopUI();
}
function markLoopEnd() {
  if (!engine.duration) return;
  const end = nearestBeat(engine.position);
  if (end < engine.loop.a + .05) {
    toast('Set the loop end after its start');
    return;
  }
  selectLoop(engine.loop.a, end, true);
}
function toggleLoop() {
  if (!state.analysis) return;
  if (engine.loop.enabled) { selectLoop(engine.loop.a, engine.loop.b, false); return; }
  const range = loopAtBar(gridBeats(), beatNumber(0), engine.position, engine.duration,
    state.grid.beats_per_bar, state.keyboardLoopBeats || state.grid.beats_per_bar);
  if (range) { selectLoop(range.a, range.b); revealLoop(); }
}
function resizeLoop(direction, fine = false) {
  if (!state.analysis || state.loopPending) return;
  const beats = gridBeats();
  const range = resizeGridLoop(beats, engine.loop.a, engine.loop.b, engine.duration,
    direction * (fine ? 1 : state.grid.beats_per_bar));
  if (!range) return;
  selectLoop(range.a, range.b, engine.loop.enabled);
  state.keyboardLoopBeats = Math.max(1, beats.filter(beat => beat > range.a + .001 && beat <= range.b + .001).length);
  revealLoop();
}
function revealLoop() {
  const {a, b} = engine.loop;
  if (b > state.viewStart + state.viewDuration || a < state.viewStart) {
    state.viewStart = Math.max(0, a - .3);
    state.viewDuration = Math.min(engine.duration, Math.max(6, (b - a) * 1.3));
    boundView();
  }
}
function updateLoopUI() {
  $('loop-toggle').setAttribute('aria-pressed', String(engine.loop.enabled));
  if (document.activeElement !== $('loop-a')) $('loop-a').value = formatTime(engine.loop.a, 2);
  if (document.activeElement !== $('loop-b')) $('loop-b').value = state.loopPending ? '' : formatTime(engine.loop.b, 2);
  $('loop-b').placeholder = state.loopPending ? 'Press ]' : '';
  $('save-loop').disabled = state.loopPending;
}
function selectBars(bars) {
  if (!state.analysis) return;
  const range = loopAtBar(gridBeats(), beatNumber(0), engine.position, engine.duration,
    state.grid.beats_per_bar, bars * state.grid.beats_per_bar);
  if (!range) return;
  state.keyboardLoopBeats = bars * state.grid.beats_per_bar;
  selectLoop(range.a, range.b); revealLoop();
}
function savePractice() {
  clearTimeout(saveTimeout);
  const id = state.song?.id;
  const body = JSON.stringify(state.grid);
  if (!id) return;
  saveTimeout = setTimeout(() => api(`songs/${id}/practice`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body}).catch(report), 400);
}
function renderSavedLoops() {
  const select = $('saved-loops'); select.replaceChildren(new Option('Your saved phrases', ''));
  state.grid.loops.forEach((loop, i) => select.add(new Option(`${loop.name} · ${formatTime(loop.a, 1)}–${formatTime(loop.b, 1)}`, String(i))));
}
function saveLoop() {
  if (!state.analysis) return;
  const same = state.grid.loops.find(l => Math.abs(l.a - engine.loop.a) < .02 && Math.abs(l.b - engine.loop.b) < .02);
  if (same) { toast('This phrase is already saved.'); return; }
  state.grid.loops.push({name: `Phrase ${state.grid.loops.length + 1}`, a: engine.loop.a, b: engine.loop.b});
  savePractice(); renderSavedLoops();
  $('saved-loops').value = String(state.grid.loops.length - 1);
  toast('Phrase saved. Come back to it any time.');
}
function updateGridSummary() {
  $('grid-summary').textContent = `${Math.round(state.grid.bpm * 10) / 10} BPM · ${state.grid.beats_per_bar} beats/bar · ${state.song?.demo ? 'original exercise' : state.grid.manual_grid ? 'manual grid' : 'estimated grid'}`;
}
function boundView() {
  state.viewDuration = clamp(state.viewDuration, Math.min(3, engine.duration || 3), engine.duration || 40);
  state.viewStart = clamp(state.viewStart, 0, Math.max(0, engine.duration - state.viewDuration));
  $('zoom-label').textContent = state.viewDuration >= engine.duration - .01 ? 'Full song' : `${Math.round(state.viewDuration)} sec`;
}
function zoom(factor, center = engine.position) {
  if (!state.analysis) return;
  const fraction = clamp((center - state.viewStart) / state.viewDuration, 0, 1);
  state.viewDuration *= factor;
  state.viewStart = center - state.viewDuration * fraction;
  boundView();
}
function setMix(vocal, backing, preset) {
  state.muted = false;
  $('vocal-volume').value = vocal; $('backing-volume').value = backing;
  updateVolumes(preset);
}
function updateVolumes(preset = null) {
  const vocal = Number($('vocal-volume').value), backing = Number($('backing-volume').value);
  engine.setVolume('vocals', state.muted ? 0 : vocal / 100);
  engine.setVolume('backing', backing / 100);
  $('vocal-level').textContent = state.muted ? 'Off' : `${vocal}%`;
  $('backing-level').textContent = `${backing}%`;
  $('vocal-mute').setAttribute('aria-pressed', String(state.muted));
  $('vocal-mute').setAttribute('aria-label', state.muted ? 'Restore guide track (V)' : 'Mute guide track (V)');
  $('vocal-mute').querySelector('use').setAttribute('href', state.muted || !vocal ? '#i-mute' : '#i-volume');
  document.querySelectorAll('[data-mix]').forEach(b => b.classList.toggle('selected', b.dataset.mix === preset));
}
function toggleVocal() { state.muted = !state.muted; updateVolumes(); }
async function togglePlayback() {
  if (state.loading || !state.analysis) return;
  if (!state.browserReady) { if (!browserLoad) await ensureBrowserAudio(); return; }
  if (engine.playing || engine.starting) engine.pause(); else { await engine.play(); updateEngineUI(); }
}
function updateEngineUI() {
  $('play').classList.toggle('playing', engine.playing);
  $('play').innerHTML = icon(engine.playing ? 'pause' : 'play');
  $('play').setAttribute('aria-label', engine.playing ? 'Pause (Space)' : 'Play (Space)');
  updateAudioLoad();
  if (state.audioLoad?.status === 'loading') { $('engine-status').textContent = 'Loading practice audio…'; return; }
  if (state.audioLoad?.status === 'error') { $('engine-status').textContent = 'Retry audio above'; return; }
  const diag = engine.diagnostics();
  if (typeof diag === 'object') {
    $('engine-status').textContent = diag.estimatedMs ? `~${Math.round(diag.estimatedMs)} ms output` : `${(diag.sampleRate / 1000).toFixed(1)} kHz audio`;
    $('audio-diagnostics').textContent = `${(diag.sampleRate / 1000).toFixed(1)} kHz · ${diag.estimatedMs ? `~${Math.round(diag.estimatedMs)} ms reported output latency` : 'output latency unavailable'} · ${diag.state}. This excludes microphone and network loading time.`;
  }
}

function canvasContext(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  return {ctx, width: rect.width, height: rect.height};
}
function drawWaveform() {
  const canvas = canvasContext($('waveform'));
  if (!canvas || !state.analysis) return;
  const {ctx, width: w, height: h} = canvas;
  const left = 18, right = w - 18, inner = right - left;
  const x = time => left + (time - state.viewStart) / state.viewDuration * inner;
  const a = x(engine.loop.a), b = x(engine.loop.b);
  if (engine.loop.enabled) {
    ctx.fillStyle = paintColors['green'] + '22'; ctx.fillRect(Math.max(left, a), 30, Math.min(right, b) - Math.max(left, a), h - 30);
  }
  const beats = gridBeats(), meter = state.grid.beats_per_bar;
  ctx.font = '9px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle';
  const stride = state.viewDuration > 100 ? meter * Math.ceil(state.viewDuration / 100) : 1;
  beats.forEach((time, i) => {
    if (time < state.viewStart || time > state.viewStart + state.viewDuration || i % stride) return;
    const number = beatNumber(i);
    const px = Math.round(x(time)) + .5, bar = number % meter === 0;
    ctx.strokeStyle = bar ? paintColors['line'] : paintColors['line']; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, 29); ctx.lineTo(px, h - 8); ctx.stroke();
    if (bar && (inner / (state.viewDuration / (60 / state.grid.bpm) / meter)) > 27) {
      ctx.fillStyle = paintColors['muted']; ctx.fillText(number < 0 ? '·' : String(Math.floor(number / meter) + 1), px + 5, 13);
    }
  });
  const laneH = (h - 38) / 2;
  [['vocals', paintColors['green'], .74], ['backing', paintColors['backing'], .85]].forEach(([stem, color, max], index) => {
    const y = 34 + laneH * (index + .5);
    ctx.strokeStyle = paintColors['line']; ctx.beginPath(); ctx.moveTo(left, y + .5); ctx.lineTo(right, y + .5); ctx.stroke();
    const detail = state.viewDuration <= 30 ? state.detailWaveforms[stem] : null;
    const data = detail?.values || state.analysis.waveforms[stem];
    const peak = detail?.peak || Math.max(.05, ...data);
    ctx.fillStyle = color;
    const step = state.viewDuration <= 30 ? 1 : 2.8;
    for (let px = left; px < right; px += step) {
      const time = state.viewStart + (px - left) / inner * state.viewDuration;
      const dataStart = Math.floor(time / engine.duration * data.length);
      const dataEnd = Math.ceil((time + state.viewDuration / inner * step) / engine.duration * data.length);
      let v = 0;
      for (let i = dataStart; i < Math.max(dataStart + 1, dataEnd) && i < data.length; i++) v = Math.max(v, data[i] || 0);
      const amp = Math.max(.7, (v / peak) ** .85 * laneH * .39 * max);
      ctx.globalAlpha = stem === 'vocals' && state.muted ? .3 : .85;
      ctx.fillRect(px, y - amp, Math.max(1, step - 1), amp * 2);
    }
    ctx.globalAlpha = 1;
  });
  if (state.loopPending) {
    ctx.fillStyle = paintColors['green'];
    ctx.fillRect(x(engine.loop.a), 27, 1, h - 33);
    ctx.font = '10px system-ui'; ctx.fillText('A', x(engine.loop.a) + 4, 24);
  }
  if (engine.loop.enabled || drag?.selecting) {
    let start = engine.loop.a, end = engine.loop.b;
    if (drag?.selecting) { start = Math.min(drag.start, drag.end); end = Math.max(drag.start, drag.end); }
    [start, end].forEach((time, i) => {
      const px = x(time); if (px < left || px > right) return;
      ctx.fillStyle = paintColors['green']; ctx.fillRect(px, 27, 1, h - 33);
      ctx.fillRect(px - (i ? 15 : 0), 27, 15, 16);
      ctx.fillStyle = paintColors['paper']; ctx.font = '9px system-ui'; ctx.fillText(i ? 'B' : 'A', px + (i ? -11 : 4), 35);
    });
  }
  const playX = x(engine.position);
  if (playX >= left && playX <= right) {
    ctx.fillStyle = paintColors['accent']; ctx.fillRect(playX - .5, 24, 1.4, h - 29);
    ctx.beginPath(); ctx.moveTo(playX - 4, 18); ctx.lineTo(playX + 4, 18); ctx.lineTo(playX, 25); ctx.fill();
  }
}
function drawOverview() {
  const canvas = canvasContext($('overview')); if (!canvas || !state.analysis) return;
  const {ctx, width: w, height: h} = canvas, data = state.analysis.waveforms.vocals;
  const max = Math.max(.03, ...data);
  for (let px = 0; px < w; px += 2) {
    const i = Math.floor(px / w * data.length), amp = Math.max(1, (data[i] || 0) / max * h * .37);
    ctx.fillStyle = paintColors['backing']; ctx.fillRect(px, h / 2 - amp, 1, amp * 2);
  }
  const a = state.viewStart / engine.duration * w, b = (state.viewStart + state.viewDuration) / engine.duration * w;
  ctx.fillStyle = paintColors['green'] + '22'; ctx.fillRect(a, 0, b - a, h);
  ctx.strokeStyle = paintColors['muted']; ctx.lineWidth = 1; ctx.strokeRect(a + .5, .5, b - a - 1, h - 1);
  if (engine.loop.enabled) {
    ctx.fillStyle = paintColors['green'] + '22'; ctx.fillRect(engine.loop.a / engine.duration * w, 0, (engine.loop.b - engine.loop.a) / engine.duration * w, h);
  }
  ctx.fillStyle = paintColors['accent']; ctx.fillRect(engine.position / engine.duration * w, 0, 1.5, h);
}
function referenceAt(time) {
  if (!state.analysis || time < 0) return null;
  const value = state.analysis.pitch[Math.round(time / state.analysis.pitch_hop)];
  return typeof value === 'number' ? value + state.octave : null;
}
function drawPitch() {
  if (!state.pitchMode || !state.analysis) return;
  const canvas = canvasContext($('pitch-canvas')); if (!canvas) return;
  const {ctx, width: w, height: h} = canvas;
  const position = engine.position;
  const windowDuration = Math.min(12, engine.duration);
  let start = clamp(position - windowDuration * .35, 0, engine.duration - windowDuration);
  if (!engine.playing && engine.loop.enabled) start = clamp(engine.loop.a - 1, 0, engine.duration - windowDuration);
  const end = start + windowDuration;
  const values = state.analysis.pitch.filter((v, i) => v !== null && i * state.analysis.pitch_hop >= start && i * state.analysis.pitch_hop <= end).map(v => v + state.octave);
  const lo = Math.min(55 + state.octave, ...(values.length ? values : [55])), hi = Math.max(72 + state.octave, ...(values.length ? values : [72]));
  const min = Math.floor(lo / 2) * 2 - 2, max = Math.ceil(hi / 2) * 2 + 2;
  const x = time => 34 + (time - start) / windowDuration * (w - 44);
  const y = midi => 8 + (max - midi) / (max - min) * (h - 25);
  ctx.font = '9px system-ui'; ctx.textBaseline = 'middle';
  for (let note = min; note <= max; note++) {
    const isC = note % 12 === 0;
    ctx.strokeStyle = isC ? paintColors['line'] : paintColors['line'];
    ctx.beginPath(); ctx.moveTo(32, y(note)); ctx.lineTo(w, y(note)); ctx.stroke();
    if (isC || note % 12 === 7) { ctx.fillStyle = paintColors['muted']; ctx.fillText(noteName(note), 0, y(note)); }
  }
  function drawLine(points, color, thickness) {
    ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
    let previous = null;
    for (const [time, midi] of points) {
      if (midi === null || time < start || time > end) { previous = null; continue; }
      if (previous && time - previous[0] < .15 && Math.abs(midi - previous[1]) < 4) ctx.lineTo(x(time), y(midi));
      else ctx.moveTo(x(time), y(midi));
      previous = [time, midi];
    }
    ctx.stroke();
  }
  const first = Math.max(0, Math.floor(start / state.analysis.pitch_hop));
  const last = Math.min(state.analysis.pitch.length, Math.ceil(end / state.analysis.pitch_hop));
  const guide = [];
  for (let i = first; i < last; i++) guide.push([i * state.analysis.pitch_hop, state.analysis.pitch[i] === null ? null : state.analysis.pitch[i] + state.octave]);
  drawLine(guide, paintColors['green-soft'], 12); drawLine(guide, paintColors['green'], 2);
  drawLine(state.trace.map(p => [p.time, p.midi]), paintColors['accent'], 2.5);
  const px = x(position); ctx.strokeStyle = paintColors['accent']; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  if (state.liveMidi && engine.playing) {
    ctx.fillStyle = paintColors['accent']; ctx.beginPath(); ctx.arc(px, y(state.liveMidi), 4, 0, 2 * Math.PI); ctx.fill();
  }
}

function animate(now) {
  requestAnimationFrame(animate);
  if (document.hidden || !state.analysis || $('browser-practice').hidden) return;
  if (now - lastPaint > 30) {
    if (engine.playing && !drag && (engine.position > state.viewStart + state.viewDuration || engine.position < state.viewStart)) {
      state.viewStart = clamp(engine.position - state.viewDuration * .2, 0, Math.max(0, engine.duration - state.viewDuration));
    }
    drawWaveform(); drawOverview(); drawPitch(); lastPaint = now;
  }
  if (now - lastUI > 90) {
    const time = formatTime(engine.position, 1), [base, decimals] = time.split('.');
    $('position').innerHTML = `${base}<span>.${decimals}</span>`;
    $('waveform').setAttribute('aria-valuenow', engine.position.toFixed(1));
    $('waveform').setAttribute('aria-valuetext', `${time} of ${formatTime(engine.duration)}`);
    $('overview').setAttribute('aria-valuenow', Math.round(engine.position / engine.duration * 100));
    const beats = gridBeats(), i = Math.max(0, beats.findLastIndex(b => b <= engine.position));
    const number = beatNumber(i), meter = state.grid.beats_per_bar;
    $('bar-count').textContent = number < 0 ? 'Lead-in' : `Bar ${Math.floor(number / meter) + 1} · beat ${number % meter + 1}`;
    $('target-note').textContent = noteName(referenceAt(engine.position));
    if (state.recording) $('record-label').textContent = `Finish · ${formatTime(engine.context.currentTime - state.recording.contextStart)}`;
    lastUI = now;
  }
}

function resetScore() {
  state.score = {total: 0, voiced: 0, hit: 0};
  $('pitch-score').textContent = '—';
}

async function enableMic(deviceId = '') {
  if (micConnection) return micConnection;
  micConnection = connectMicrophone(deviceId);
  try { return await micConnection; } finally { micConnection = null; }
}

async function connectMicrophone(deviceId = '') {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is unavailable. Check microphone permissions and reopen MadDojo.');
  if (state.recording) await finishRecording();
  if (state.mic) disconnectMic();
  $('mic-toggle').disabled = true;
  $('mic-status').textContent = 'Waiting for microphone permission…';
  let stream;
  try {
    const ctx = engine.ensureContext(); await ctx.resume();
    stream = await navigator.mediaDevices.getUserMedia({audio: {
      ...(deviceId ? {deviceId: {exact: deviceId}} : {}),
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: 1, latency: {ideal: .01},
    }});
    if (!engine.workletReady) {
      await ctx.audioWorklet.addModule(new URL('capture-worklet.js', import.meta.url));
      engine.workletReady = true;
    }
    const source = ctx.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(ctx, 'dojo-capture', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]});
    const monitor = ctx.createGain(); monitor.gain.value = 0;
    source.connect(capture).connect(monitor).connect(engine.master);
    const worker = new Worker(new URL('pitch-worker.js?v=maddojo-modes', import.meta.url), {type: 'module'});
    state.mic = {stream, source, capture, monitor}; state.worker = worker;
    worker.onmessage = ({data}) => handlePitch(data);
    worker.onerror = () => toast('Live pitch analysis stopped. Recording still works. Reconnect the microphone to retry.', true);
    capture.port.onmessage = ({data}) => {
      if (data.type === 'record-start' && state.recording) {
        const take = state.recording;
        take.contextStart = data.frame / ctx.sampleRate;
        take.segment = {start: 0, position: engine.positionAt(take.contextStart), playing: engine.playing, loop: {...engine.loop}};
        take.started?.();
      }
      if (data.type === 'record-stop' && state.recording) {
        const take = state.recording;
        take.contextEnd = data.frame / ctx.sampleRate;
        take.stopped?.();
      }
      if (data.type === 'samples') {
        if (data.recording && state.recording) state.recording.chunks.push(data.samples);
        // A clone is sent so recorded PCM retains its own buffer.
        if (state.song?.mode !== 'drum') worker.postMessage({samples: data.samples, frame: data.frame, sampleRate: ctx.sampleRate, minFrequency: state.song?.mode === 'bass' ? 30 : 65});
      }
    };
    const track = stream.getAudioTracks()[0];
    track.addEventListener('ended', () => {
      if (state.mic?.stream === stream) {
        if (state.recording) finishRecording().catch(report).finally(disconnectMic);
        else disconnectMic();
        toast('Your microphone disconnected. Reconnect it to keep recording.', true);
      }
    });
    $('mic-status').textContent = track.label || 'Microphone connected';
    $('mic-toggle').textContent = 'Mic connected';
    $('mic-toggle').disabled = true;
    $('mic-details').hidden = false;
    $('pitch-hint').textContent = 'Press play and follow the guide. Keep the microphone clear of the speakers.';
    const devices = await navigator.mediaDevices.enumerateDevices();
    const select = $('mic-select'); select.replaceChildren();
    devices.filter(d => d.kind === 'audioinput').forEach((device, i) => select.add(new Option(device.label || `Microphone ${i + 1}`, device.deviceId)));
    select.value = track.getSettings().deviceId || select.options[0]?.value;
    updateEngineUI();
  } catch (error) {
    if (state.mic?.stream === stream) disconnectMic();
    stream?.getTracks().forEach(t => t.stop());
    $('mic-toggle').disabled = false;
    $('mic-toggle').textContent = 'Enable mic';
    $('mic-status').textContent = 'Your microphone is not connected yet.';
    const explanations = {
      NotAllowedError: 'Microphone access was declined. Allow microphone access in your app or browser settings, then enable the mic again.',
      NotFoundError: 'No microphone found. Connect an input device, then try again.',
      NotReadableError: 'The microphone is busy or unavailable. Check the selected input and try again.',
      OverconstrainedError: 'That microphone is no longer available. Reconnect using the default input.',
    };
    throw new Error(explanations[error.name] || error.message);
  }
}

function disconnectMic() {
  if (!state.mic) return;
  const mic = state.mic; state.mic = null;
  mic.stream.getTracks().forEach(t => t.stop());
  mic.source.disconnect(); mic.capture.disconnect(); mic.monitor.disconnect();
  mic.capture.port.close(); state.worker?.terminate(); state.worker = null;
  $('mic-status').textContent = '';
  $('mic-toggle').textContent = 'Enable mic'; $('mic-toggle').disabled = false;
  $('mic-details').hidden = true; $('monitor').checked = false;
  $('mic-meter-fill').style.width = '0%'; $('live-note').textContent = '—';
  state.liveMidi = null;
  $('pitch-hint').textContent = 'Enable your microphone to see your input.';
}

function handlePitch(data) {
  $('mic-meter-fill').style.width = `${clamp(data.rms * 350, 0, 100)}%`;
  $('mic-meter-fill').parentElement.setAttribute('aria-valuenow', String(Math.round(clamp(data.rms * 350, 0, 100))));
  $('mic-meter-fill').style.filter = data.rms > .35 ? 'sepia(1) saturate(3)' : '';
  state.liveMidi = data.midi;
  $('live-note').textContent = noteName(data.midi);
  if (!state.analysis || !engine.playing) return;
  const contextTime = data.frame / engine.context.sampleRate - state.inputOffset / 1000;
  const time = engine.positionAt(contextTime);
  const target = referenceAt(time);
  state.trace.push({time, midi: data.midi});
  if (state.trace.length > 15000) state.trace.splice(0, 1000);
  if (target !== null) {
    state.score.total++;
    if (data.midi !== null) state.score.voiced++;
    const cents = data.midi !== null ? (data.midi - target) * 100 : null;
    const hit = cents !== null && Math.abs(cents) <= 50;
    if (hit) state.score.hit++;
    if (state.recording) {
      state.recording.score.total++;
      if (data.midi !== null) state.recording.score.voiced++;
      if (hit) state.recording.score.hit++;
    }
    state.lastCents = cents;
    if (cents !== null) $('pitch-hint').textContent = hit ? 'In tune' : `${Math.round(Math.abs(cents))} cents ${cents > 0 ? 'above' : 'below'} the guide`;
    else $('pitch-hint').textContent = 'Listening for your input…';
  } else $('pitch-hint').textContent = 'No guide note';
  if (state.score.total >= 20 && state.score.voiced >= 8) $('pitch-score').textContent = `${Math.round(state.score.hit / state.score.total * 100)}%`;
}

function markRecordingSegment() {
  const take = state.recording;
  if (!take?.segment || !engine.context) return;
  const elapsed = Math.max(0, engine.context.currentTime - take.contextStart);
  take.segments.push({...take.segment, end: elapsed});
  take.segment = {start: elapsed, position: engine.position, playing: engine.playing, loop: {...engine.loop}};
}

async function startRecording() {
  if (!state.analysis || state.loading) throw new Error('Open a prepared song before recording.');
  if (!await ensureBrowserAudio()) return;
  if (state.savingTake) throw new Error('Your previous take is still saving.');
  if (!state.mic) await enableMic();
  await engine.context.resume();
  engine.stopTake();
  resetScore(); state.trace = [];
  const take = {
    songId: state.song.id, contextStart: engine.context.currentTime,
    chunks: [], segments: [], score: {total: 0, voiced: 0, hit: 0},
    startPosition: engine.position, octave: state.octave, alignment: state.inputOffset,
  };
  state.recording = take;
  const started = new Promise(resolve => take.started = resolve);
  state.mic.capture.port.postMessage({type: 'record'});
  await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('The audio input did not start. Reconnect your microphone.')), 4000))]);
  if (!engine.playing) await engine.play();
  $('record').classList.add('recording'); $('record').setAttribute('aria-label', 'Finish and save this take (R)');
  $('record-label').textContent = 'Finish take';
  $('mic-disable').disabled = true; $('mic-select').disabled = true;
  toast('Recording your input. Press R again to save the take.');
}

async function finishRecording() {
  const take = state.recording;
  if (!take || state.savingTake) return;
  state.savingTake = true;
  $('record').disabled = true;
  try {
    if (state.mic) {
      const stopped = new Promise(resolve => take.stopped = resolve);
      state.mic.capture.port.postMessage({type: 'stop'});
      await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 700))]);
    }
    const end = (take.contextEnd ?? engine.context.currentTime) - take.contextStart;
    if (take.segment) take.segments.push({...take.segment, end});
    state.recording = null;
    engine.pause();
    const blob = encodeWav(take.chunks, engine.context.sampleRate);
    const duration = take.chunks.reduce((n, c) => n + c.length, 0) / engine.context.sampleRate;
    if (duration < .1) { toast('That take was too short. Give it another try.'); return; }
    const metadata = {
      startPosition: take.startPosition, segments: take.segments,
      pitchScore: take.score.total >= 20 && take.score.voiced >= 8 ? Math.round(take.score.hit / take.score.total * 100) : null,
      voicedCoverage: take.score.total ? Math.round(take.score.voiced / take.score.total * 100) : null,
      scoreFrames: take.score.total, toleranceCents: 50, octave: take.octave, alignmentMs: take.alignment,
      sampleRate: engine.context.sampleRate, latency: engine.diagnostics(),
    };
    $('record-label').textContent = 'Saving take…';
    const pending = {songId: take.songId, blob, metadata, duration};
    try {
      await uploadTake(pending);
      toast('Take saved. Listen back with the backing, or download your input.');
    } catch (error) {
      state.pendingTakes.push(pending);
      toast('Could not save this take. Your recording is available below to download or retry.', true, 10000);
    }
    if (state.song?.id === take.songId) await renderTakes();
  } finally {
    state.recording = null; state.savingTake = false;
    $('record').disabled = false; $('record').classList.remove('recording');
    $('record').setAttribute('aria-label', 'Record a take (R)'); $('record-label').textContent = 'Record a take';
    $('mic-disable').disabled = false; $('mic-select').disabled = false;
  }
}

async function uploadTake(pending) {
  const form = new FormData(); form.append('file', pending.blob, 'take.wav');
  form.append('metadata', JSON.stringify(pending.metadata));
  return api(`songs/${pending.songId}/takes`, {method: 'POST', body: form});
}
async function toggleRecording() {
  if (state.startingRecording || state.savingTake) return;
  if (state.recording) await finishRecording();
  else {
    state.startingRecording = true; $('record').disabled = true;
    try { await startRecording(); }
    catch (error) {
      state.mic?.capture.port.postMessage({type: 'stop'});
      state.recording = null; throw error;
    } finally { state.startingRecording = false; $('record').disabled = false; }
  }
}

async function renderTakes() {
  const id = state.song?.id;
  if (!id) return;
  const pending = state.pendingTakes.filter(t => t.songId === id);
  let takes = [];
  try { takes = await api(`songs/${id}/takes`); }
  catch (error) { if (!pending.length) throw error; }
  if (state.song?.id !== id) return;
  const list = $('take-list'); list.replaceChildren();
  $('take-count').textContent = takes.length + pending.length;
  for (const take of pending) {
    const row = document.createElement('div'); row.className = 'take-row';
    const info = document.createElement('span'); info.className = 'take-info';
    info.innerHTML = '<strong>Unsaved take</strong><small>Download before closing this tab</small>';
    take.url ||= URL.createObjectURL(take.blob);
    const link = document.createElement('a'); link.href = take.url; link.download = 'MadDojo - unsaved take.wav'; link.innerHTML = icon('download'); link.setAttribute('aria-label', 'Download unsaved take');
    const retry = document.createElement('button'); retry.className = 'secondary'; retry.textContent = 'Retry save';
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      try { await uploadTake(take); URL.revokeObjectURL(take.url); state.pendingTakes.splice(state.pendingTakes.indexOf(take), 1); await renderTakes(); toast('Take saved.'); }
      catch (error) { report(error); retry.disabled = false; }
    });
    row.append(info, retry, link); list.append(row);
  }
  for (const take of takes) {
    const row = document.createElement('div'); row.className = 'take-row';
    const play = document.createElement('button'); play.className = 'take-play'; play.innerHTML = icon('play');
    play.setAttribute('aria-label', `Listen to ${take.title} with backing`);
    const info = document.createElement('span'); info.className = 'take-info';
    const strong = document.createElement('strong'); strong.textContent = take.title;
    const small = document.createElement('small'); small.textContent = `${formatTime(take.duration)} · ${new Date(take.created * 1000).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}`;
    info.append(strong, small);
    const score = document.createElement('span'); score.className = 'take-score';
    score.textContent = take.metadata.pitchScore !== null && take.metadata.pitchScore !== undefined ? `${take.metadata.pitchScore}% in tune` : 'Listen back';
    score.title = 'Experimental: reference frames within 50 cents, including missed notes. This is not an overall performance score.';
    const voice = document.createElement('audio'); voice.controls = true; voice.preload = 'metadata'; voice.src = takeURL(take.id);
    voice.setAttribute('aria-label', `${take.title}, input only`);
    voice.addEventListener('play', () => { engine.pause(); engine.stopTake(); document.querySelectorAll('.take-row audio').forEach(a => { if (a !== voice) a.pause(); }); });
    const link = document.createElement('a'); link.href = takeURL(take.id) + '?download=true'; link.innerHTML = icon('download'); link.setAttribute('aria-label', `Download ${take.title} as WAV`);
    play.addEventListener('click', async () => {
      try {
        if (state.recording) throw new Error('Finish your recording before listening back.');
        document.querySelectorAll('.take-row audio').forEach(a => a.pause());
        if (state.activeTake === take.id) { engine.stopTake(); state.activeTake = null; play.innerHTML = icon('play'); return; }
        play.disabled = true;
        const response = await fetch(takeURL(take.id));
        if (!response.ok) throw new Error('Could not load this take.');
        const buffer = await engine.ensureContext().decodeAudioData(await response.arrayBuffer());
        await engine.playTake(buffer, take.metadata);
        document.querySelectorAll('.take-play').forEach(b => b.innerHTML = icon('play'));
        state.activeTake = take.id; play.innerHTML = icon('stop');
      } catch (error) { report(error); }
      finally { play.disabled = false; }
    });
    row.append(play, info, score, voice, link); list.append(row);
  }
  if (!list.children.length) {
    const p = document.createElement('p'); p.className = 'takes-empty'; p.textContent = 'No takes yet'; list.append(p);
  }
}

function openSettings() {
  $('grid-bpm').value = state.grid.bpm;
  $('grid-meter').value = state.grid.beats_per_bar;
  $('grid-offset').value = state.grid.grid_offset;
  $('grid-manual').checked = state.grid.manual_grid;
  $('pitch-octave').value = state.octave;
  $('input-offset').value = state.inputOffset;
  updateEngineUI(); $('settings-dialog').showModal();
}
function saveSettings() {
  const bpm = Number($('grid-bpm').value), offset = Number($('grid-offset').value), inputOffset = Number($('input-offset').value);
  if (!(bpm >= 30 && bpm <= 300 && offset >= -1200 && offset <= 1200 && inputOffset >= -500 && inputOffset <= 500)) throw new Error('Check the tempo and alignment values.');
  state.grid.bpm = bpm;
  state.grid.grid_offset = offset;
  state.grid.beats_per_bar = Number($('grid-meter').value);
  state.grid.manual_grid = $('grid-manual').checked;
  state.octave = Number($('pitch-octave').value); state.inputOffset = inputOffset;
  localStorage.setItem('dojo.octave', String(state.octave));
  localStorage.setItem('dojo.inputOffset', String(state.inputOffset));
  resetScore(); savePractice(); updateGridSummary(); $('settings-dialog').close();
}
function setPitchMode(enabled) {
  state.pitchMode = enabled;
  $('pitch-panel').hidden = !enabled;
  $('practice-tab').setAttribute('aria-selected', String(!enabled));
  $('pitch-tab').setAttribute('aria-selected', String(enabled));
  $('practice-workspace').classList.toggle('pitch-active', enabled);
}

on('import-button', 'click', () => openImport());
on('file-input', 'change', e => { const mode = $('import-mode').value; $('import-dialog').close(); return importFiles(e.target.files, mode); });
on('song-search', 'input', renderLibrary);
on('copy-folder', 'click', async () => {
  try { await navigator.clipboard.writeText(state.inbox); toast('Drop folder path copied.'); }
  catch { toast(state.inbox, false, 10000); }
});
on('play', 'click', togglePlayback);
on('audio-load-retry', 'click', ensureBrowserAudio);
on('restart', 'click', () => engine.seek(engine.loop.enabled ? engine.loop.a : 0));
on('stop', 'click', async () => { if (state.recording) await finishRecording(); engine.stop(); });
on('record', 'click', toggleRecording);
on('loop-toggle', 'click', toggleLoop);
on('loop-a', 'change', () => {
  const a = parseTime($('loop-a').value);
  if (!Number.isFinite(a) || a < 0 || a >= engine.loop.b) { updateLoopUI(); throw new Error('The loop start needs to come before its end. Use mm:ss.ss.'); }
  selectLoop(a, engine.loop.b, engine.loop.enabled); $('loop-a').blur();
});
on('loop-b', 'change', () => {
  const b = parseTime($('loop-b').value);
  if (!Number.isFinite(b) || b <= engine.loop.a || b > engine.duration) { updateLoopUI(); throw new Error('The loop end needs to follow its start and stay inside the song.'); }
  selectLoop(engine.loop.a, b, state.loopPending || engine.loop.enabled); $('loop-b').blur();
});
document.querySelectorAll('[data-bars]').forEach(button => button.addEventListener('click', () => selectBars(Number(button.dataset.bars))));
on('save-loop', 'click', saveLoop);
on('saved-loops', 'change', e => { const loop = state.grid.loops[e.target.value]; if (loop) selectLoop(loop.a, loop.b); e.target.blur(); });
on('vocal-volume', 'input', () => { state.muted = false; updateVolumes(); });
on('backing-volume', 'input', () => updateVolumes());
on('vocal-mute', 'click', toggleVocal);
document.querySelectorAll('[data-mix]').forEach(button => button.addEventListener('click', () => {
  const preset = button.dataset.mix;
  const mix = {listen: [100, 100], guide: [35, 85], solo: [0, 85]}[preset]; setMix(...mix, preset);
}));
on('zoom-in', 'click', () => zoom(.5));
on('zoom-out', 'click', () => zoom(2));
on('zoom-fit', 'click', () => { state.viewStart = 0; state.viewDuration = engine.duration; boundView(); });
on('practice-tab', 'click', () => setPitchMode(false));
on('pitch-tab', 'click', () => setPitchMode(true));
on('mic-toggle', 'click', () => enableMic());
on('mic-select', 'change', e => enableMic(e.target.value));
on('mic-disable', 'click', disconnectMic);
on('monitor', 'change', e => state.mic?.monitor.gain.setTargetAtTime(e.target.checked ? .7 : 0, engine.context.currentTime, .01));
on('shortcuts-button', 'click', () => $('shortcuts-dialog').showModal());
on('settings-button', 'click', openSettings);
on('settings-save', 'click', saveSettings);
on('grid-downbeat', 'click', () => {
  $('grid-offset').value = engine.position.toFixed(2); $('grid-manual').checked = true;
});
on('retry-button', 'click', async () => { await api(`songs/${state.song.id}/retry`, {method: 'POST'}); await refreshLibrary(); });
on('download-button', 'click', () => {
  if (!state.analysis) return;
  const list = $('export-links'); list.replaceChildren();
  for (const [stem, label] of [['backing', 'Backing · no guide track'], ['vocals', 'Isolated guide track'], ['original', 'Original mix']]) {
    const a = document.createElement('a'); a.href = audioURL(state.song.id, stem) + '?download=true';
    const span = document.createElement('span'); span.textContent = label; a.append(span); a.insertAdjacentHTML('beforeend', icon('download')); list.append(a);
  }
  $('export-dialog').showModal();
});
on('ardour-help', 'click', () => $('ardour-help-dialog').showModal());
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
});

function pointerTime(event, canvas = $('waveform')) {
  const r = canvas.getBoundingClientRect();
  return clamp(state.viewStart + (event.clientX - r.left - 18) / (r.width - 36) * state.viewDuration, 0, engine.duration);
}
on('waveform', 'pointerdown', e => {
  if (e.button !== 0 || !state.analysis) return;
  $('waveform').setPointerCapture(e.pointerId);
  const time = pointerTime(e);
  drag = {start: nearestBeat(time), rawStart: time, end: time, clientX: e.clientX, selecting: false};
});
on('waveform', 'pointermove', e => {
  if (!drag) return;
  drag.end = nearestBeat(pointerTime(e));
  if (Math.abs(e.clientX - drag.clientX) > 5) drag.selecting = true;
});
on('waveform', 'pointerup', e => {
  if (!drag) return;
  if (drag.selecting && Math.abs(drag.start - drag.end) >= .05) selectLoop(drag.start, drag.end);
  else engine.seek(drag.rawStart);
  drag = null; updateLoopUI();
  $('waveform').releasePointerCapture(e.pointerId);
});
on('waveform', 'pointercancel', () => drag = null);
$('waveform').addEventListener('wheel', e => {
  if (!state.analysis) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoom(e.deltaY > 0 ? 1.2 : .83, pointerTime(e));
  else { state.viewStart += (e.deltaX || e.deltaY) * state.viewDuration / 1200; boundView(); }
}, {passive: false});
on('overview', 'pointerdown', e => {
  if (!state.analysis) return;
  const r = $('overview').getBoundingClientRect();
  const time = (e.clientX - r.left) / r.width * engine.duration;
  if (state.viewDuration >= engine.duration - .01) engine.seek(time);
  else { state.viewStart = time - state.viewDuration / 2; boundView(); }
});
for (const name of ['transport', 'seek', 'loop']) engine.addEventListener(name, () => {
  markRecordingSegment(); updateEngineUI(); updateLoopUI();
});
engine.addEventListener('seek', () => { state.trace = []; });
engine.addEventListener('ended', () => { if (state.recording) finishRecording().catch(report); });
engine.addEventListener('take-ended', () => {
  state.activeTake = null; document.querySelectorAll('.take-play').forEach(b => b.innerHTML = icon('play'));
});
engine.addEventListener('context', () => {
  engine.context.addEventListener('statechange', () => {
    updateEngineUI();
    if (engine.context.state === 'suspended' && engine.playing) engine.pause();
  });
});

document.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
  if ($('browser-practice').hidden) return;
  const tag = event.target.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target.isContentEditable) return;
  let action;
  const step = 60 / state.grid.bpm * (event.shiftKey ? state.grid.beats_per_bar : 1);
  switch (event.code) {
    case 'Space': action = togglePlayback; break;
    case 'Enter': if (tag === 'BUTTON' || tag === 'A') return; action = () => engine.seek(engine.loop.enabled ? engine.loop.a : 0); break;
    case 'Escape': action = async () => { if (state.recording) await finishRecording(); engine.stop(); }; break;
    case 'KeyV': action = toggleVocal; break;
    case 'KeyL': action = toggleLoop; break;
    case 'Comma': action = () => resizeLoop(-1, event.shiftKey); break;
    case 'Period': action = () => resizeLoop(1, event.shiftKey); break;
    case 'KeyR': action = toggleRecording; break;
    case 'BracketLeft': action = markLoopStart; break;
    case 'BracketRight': action = markLoopEnd; break;
    case 'ArrowLeft': action = () => engine.seek(engine.position - step); break;
    case 'ArrowRight': action = () => engine.seek(engine.position + step); break;
    case 'Minus': action = () => adjustGuideVolume(-5); break;
    case 'Equal': action = () => adjustGuideVolume(5); break;
    case 'KeyZ': action = () => zoom(event.shiftKey ? 2 : .5); break;
    case 'Slash': action = () => $('shortcuts-dialog').showModal(); break;
  }
  if (action) {
    event.preventDefault();
    try { const result = action(); if (result?.catch) result.catch(report); } catch (error) { report(error); }
  }
});
let dragDepth = 0;
document.addEventListener('dragenter', e => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault(); dragDepth++; $('drop-overlay').hidden = false;
});
document.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
document.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
document.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  if (e.dataTransfer?.files.length) openImport(e.dataTransfer.files);
});
window.addEventListener('beforeunload', event => {
  if (state.recording || state.savingTake || state.pendingTakes.length) { event.preventDefault(); event.returnValue = ''; }
});

// Small read-only diagnostics hook for audio and browser verification.
window.dojo = {engine, state};
updateVolumes('guide');
refreshLibrary(true).catch(report);
setInterval(() => refreshLibrary().catch(() => {}), 2500);
requestAnimationFrame(animate);
