import './styles.css';
import type {
  GlobalSettings,
  LibraryEntry,
  SubtitleSearchQuery,
  SubtitleSearchResult,
  TrackStyle,
  VideoStatus
} from '../shared/types';

const DEFAULT_TRACK_STYLE: [TrackStyle, TrackStyle] = [
  {
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: 34,
    color: '#ffffff',
    background: 'rgba(0,0,0,0.35)',
    opacity: 1,
    outline: '2px #000000',
    shadow: '0 2px 6px rgba(0,0,0,0.9)',
    verticalPercent: 88
  },
  {
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: 28,
    color: '#ffd700',
    background: 'rgba(0,0,0,0.25)',
    opacity: 1,
    outline: '2px #000000',
    shadow: '0 2px 6px rgba(0,0,0,0.9)',
    verticalPercent: 80
  }
];

interface LocalState {
  status: VideoStatus | null;
  searchResults: SubtitleSearchResult[];
  settings: GlobalSettings;
  library: LibraryEntry[];
  styles: [TrackStyle, TrackStyle];
}

const state: LocalState = {
  status: null,
  searchResults: [],
  settings: { openSubtitlesApiKey: '' },
  library: [],
  styles: structuredClone(DEFAULT_TRACK_STYLE)
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found');

function sanitizeDisplayText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 220);
}

function setStatus(message: string): void {
  const el = document.querySelector<HTMLElement>('#video-status');
  if (el) {
    el.textContent = message;
  }
}

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found');
  return tab.id;
}

async function sendToContent<T = any>(message: unknown): Promise<T> {
  const tabId = await getActiveTabId();
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response?.ok) {
    throw new Error(response?.error || 'Content script did not respond');
  }
  return response as T;
}

async function sendToBackground<T = any>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || 'Background request failed');
  }
  return response as T;
}

async function refreshStatus(): Promise<void> {
  try {
    const response = await sendToContent<{ status: VideoStatus }>({ type: 'GET_STATUS' });
    state.status = response.status;
    setStatus(
      response.status.hasVideo
        ? `Detected: ${response.status.title} (${response.status.currentTime.toFixed(1)}s)`
        : 'No active video detected'
    );
    renderLibrary();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to get video status');
  }
}

function renderSearchResults(): void {
  const list = document.querySelector<HTMLDivElement>('#search-results');
  if (!list) return;
  list.innerHTML = '';
  for (const result of state.searchResults) {
    const card = document.createElement('div');
    card.className = 'section';
    const heading = document.createElement('div');
    heading.className = 'row';
    const strong = document.createElement('strong');
    strong.textContent = sanitizeDisplayText(result.fileName);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = `${result.score}%`;
    heading.append(strong, badge);

    const detail = document.createElement('div');
    detail.className = 'small';
    detail.textContent = sanitizeDisplayText(
      `${result.language}${result.release ? ` • ${result.release}` : ''}`
    );

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.style.marginTop = '6px';
    const primaryButton = document.createElement('button');
    primaryButton.dataset.load = '0';
    primaryButton.textContent = 'Load primary';
    const secondaryButton = document.createElement('button');
    secondaryButton.dataset.load = '1';
    secondaryButton.textContent = 'Load secondary';
    actions.append(primaryButton, secondaryButton);
    card.append(heading, detail, actions);

    card.querySelectorAll<HTMLButtonElement>('button[data-load]').forEach((button) => {
      button.addEventListener('click', async () => {
        const slot = Number(button.dataset.load) as 0 | 1;
        try {
          setStatus('Downloading subtitle...');
          const payload = await sendToBackground<{ content: string }>({
            type: 'BG_DOWNLOAD_SUBTITLE',
            fileId: result.fileId
          });
          await sendToContent({
            type: 'LOAD_TRACK',
            slot,
            fileName: result.fileName,
            content: payload.content
          });
          await sendToBackground({
            type: 'BG_ADD_LIBRARY_ENTRY',
            entry: {
              id: `${result.fileId}-${slot}`,
              title: state.status?.title || result.fileName,
              fileName: result.fileName,
              slot,
              source: 'search',
              usedAt: Date.now()
            }
          });
          await refreshStatus();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Failed to load subtitle');
        }
      });
    });

    list.append(card);
  }
}

function renderLibrary(): void {
  const list = document.querySelector<HTMLDivElement>('#library-list');
  if (!list) return;
  list.innerHTML = '';

  const history = [...state.library].sort((a, b) => b.usedAt - a.usedAt).slice(0, 10);
  for (const entry of history) {
    const row = document.createElement('div');
    row.className = 'row';
    const fileName = document.createElement('span');
    fileName.textContent = sanitizeDisplayText(entry.fileName);
    const source = document.createElement('span');
    source.className = 'small';
    source.textContent = entry.source;
    const favButton = document.createElement('button');
    favButton.dataset.fav = entry.id;
    favButton.textContent = entry.favorited ? '★' : '☆';
    favButton.addEventListener('click', async () => {
      const payload = await sendToBackground<{ library: LibraryEntry[] }>({
        type: 'BG_TOGGLE_FAVORITE',
        id: entry.id
      });
      state.library = payload.library;
      renderLibrary();
    });
    row.append(fileName, source, favButton);
    list.append(row);
  }
}

function createTrackControls(slot: 0 | 1): string {
  return `
    <div class="section">
      <h2>${slot === 0 ? 'Primary' : 'Secondary'} track controls</h2>
      <div class="row">
        <button data-sync="${slot}:-500">-500ms</button>
        <button data-sync="${slot}:-100">-100ms</button>
        <button data-sync="${slot}:100">+100ms</button>
        <button data-sync="${slot}:500">+500ms</button>
        <button data-reset="${slot}">Reset</button>
      </div>
      <div class="row" style="margin-top:8px">
        <label>Size <input type="range" min="16" max="72" value="28" data-style="${slot}:fontSize" /></label>
        <label>Pos <input type="range" min="10" max="95" value="84" data-style="${slot}:verticalPercent" /></label>
      </div>
      <div class="row" style="margin-top:8px">
        <label>Color <input type="color" value="#ffffff" data-style="${slot}:color" /></label>
        <label>Background <input type="text" value="" data-style="${slot}:background" /></label>
      </div>
      <div class="row" style="margin-top:8px">
        <label>Font <input type="text" value="Inter, Arial, sans-serif" data-style="${slot}:fontFamily" /></label>
        <label>Opacity <input type="range" min="0.1" max="1" step="0.05" value="1" data-style="${slot}:opacity" /></label>
      </div>
      <div class="row" style="margin-top:8px">
        <label>Outline <input type="text" value="2px #000000" data-style="${slot}:outline" /></label>
        <label>Shadow <input type="text" value="0 2px 6px rgba(0,0,0,0.9)" data-style="${slot}:shadow" /></label>
      </div>
    </div>
  `;
}

function renderApp(): void {
  app.innerHTML = `
    <div class="section">
      <h2>Current video status</h2>
      <div id="video-status" class="small">Loading...</div>
      <div class="small">Primary offset shortcut: Alt+Left / Alt+Right</div>
    </div>

    <div class="section">
      <h2>Upload subtitles</h2>
      <div class="row">
        <label>Primary <input id="file-primary" type="file" accept=".srt,.vtt,.ass,.ssa" /></label>
        <label>Secondary <input id="file-secondary" type="file" accept=".srt,.vtt,.ass,.ssa" /></label>
      </div>
      <div id="dropzone" class="dropzone">Drag & drop subtitle file here (loads to primary)</div>
    </div>

    <div class="section">
      <h2>Subtitle search (OpenSubtitles)</h2>
      <div class="row"><input id="search-title" placeholder="Title" style="flex:1" /></div>
      <div class="row">
        <input id="search-season" type="number" placeholder="Season" style="width:74px" />
        <input id="search-episode" type="number" placeholder="Episode" style="width:74px" />
        <input id="search-year" type="number" placeholder="Year" style="width:74px" />
        <input id="search-language" placeholder="Lang" value="en" style="width:74px" />
      </div>
      <div class="row" style="margin-top:8px">
        <input id="api-key" placeholder="OpenSubtitles API key" style="flex:1" />
        <button id="save-api-key">Save key</button>
        <button id="search-btn">Search</button>
      </div>
      <div id="search-results" class="list" style="margin-top:8px"></div>
    </div>

    ${createTrackControls(0)}
    ${createTrackControls(1)}

    <div class="section">
      <h2>Library (recent/favorites/history)</h2>
      <div id="library-list" class="list"></div>
    </div>
  `;

  bindUpload('#file-primary', 0);
  bindUpload('#file-secondary', 1);
  bindDropzone();
  bindSearch();
  bindSyncButtons();
  bindStyleControls();
  bindApiKeyControls();
  syncControlValues();
}

function syncControlValues(): void {
  const apiInput = document.querySelector<HTMLInputElement>('#api-key');
  if (apiInput) {
    apiInput.value = state.settings.openSubtitlesApiKey;
  }

  document.querySelectorAll<HTMLInputElement>('input[data-style]').forEach((input) => {
    const [slotValue, key] = (input.dataset.style || '0:fontSize').split(':');
    const slot = Number(slotValue) as 0 | 1;
    const value = (state.styles[slot] as any)[key];
    if (typeof value === 'undefined') {
      return;
    }
    input.value = String(value);
  });
}

async function addLibraryUpload(fileName: string, slot: 0 | 1): Promise<void> {
  const payload = await sendToBackground<{ library: LibraryEntry[] }>({
    type: 'BG_ADD_LIBRARY_ENTRY',
    entry: {
      id: `${fileName}-${slot}-${Date.now()}`,
      title: state.status?.title || fileName,
      fileName,
      slot,
      source: 'upload',
      usedAt: Date.now()
    }
  });
  state.library = payload.library;
}

function bindUpload(selector: string, slot: 0 | 1): void {
  const input = document.querySelector<HTMLInputElement>(selector);
  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const content = await file.text();
    await sendToContent({ type: 'LOAD_TRACK', slot, fileName: file.name, content });
    await addLibraryUpload(file.name, slot);
    await refreshStatus();
  });
}

function bindDropzone(): void {
  const dropzone = document.querySelector<HTMLDivElement>('#dropzone');
  if (!dropzone) return;

  const preventDefaults = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, preventDefaults as EventListener);
  });

  dropzone.addEventListener('drop', async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const content = await file.text();
    await sendToContent({ type: 'LOAD_TRACK', slot: 0, fileName: file.name, content });
    await addLibraryUpload(file.name, 0);
    await refreshStatus();
  });
}

function bindSyncButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('button[data-sync]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [slot, delta] = (button.dataset.sync || '0:0').split(':').map(Number);
      await sendToContent({ type: 'SET_OFFSET', slot, deltaMs: delta });
      await refreshStatus();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('button[data-reset]').forEach((button) => {
    button.addEventListener('click', async () => {
      await sendToContent({ type: 'RESET_OFFSET', slot: Number(button.dataset.reset) });
      await refreshStatus();
    });
  });
}

function bindStyleControls(): void {
  document.querySelectorAll<HTMLInputElement>('input[data-style]').forEach((input) => {
    input.addEventListener('input', async () => {
      const [slotValue, key] = (input.dataset.style || '0:fontSize').split(':');
      const slot = Number(slotValue) as 0 | 1;
      const current = state.styles[slot];

      let value: string | number = input.value;
      if (key === 'fontSize' || key === 'verticalPercent' || key === 'opacity') {
        value = Number(input.value);
      }
      (current as any)[key] = value;

      await sendToContent({ type: 'SET_STYLE', slot, style: { [key]: value } });
    });
  });
}

function bindApiKeyControls(): void {
  const saveButton = document.querySelector<HTMLButtonElement>('#save-api-key');
  saveButton?.addEventListener('click', async () => {
    const input = document.querySelector<HTMLInputElement>('#api-key');
    state.settings.openSubtitlesApiKey = input?.value.trim() || '';
    await sendToBackground({ type: 'BG_SAVE_SETTINGS', settings: state.settings });
    setStatus('Settings saved');
  });
}

function bindSearch(): void {
  const button = document.querySelector<HTMLButtonElement>('#search-btn');
  button?.addEventListener('click', async () => {
    const title = (document.querySelector<HTMLInputElement>('#search-title')?.value || '').trim();
    if (!title) {
      setStatus('Enter a title to search subtitles');
      return;
    }

    const query: SubtitleSearchQuery = {
      title,
      season: Number(document.querySelector<HTMLInputElement>('#search-season')?.value || '') || undefined,
      episode: Number(document.querySelector<HTMLInputElement>('#search-episode')?.value || '') || undefined,
      year: Number(document.querySelector<HTMLInputElement>('#search-year')?.value || '') || undefined,
      language: document.querySelector<HTMLInputElement>('#search-language')?.value || 'en'
    };

    try {
      setStatus('Searching OpenSubtitles...');
      const payload = await sendToBackground<{ results: SubtitleSearchResult[] }>({
        type: 'BG_SEARCH_SUBTITLES',
        query
      });
      state.searchResults = payload.results;
      renderSearchResults();
      setStatus(`Found ${payload.results.length} subtitles`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Search failed');
    }
  });
}

async function bootstrap(): Promise<void> {
  renderApp();
  const storage = await sendToBackground<{ data: { settings: GlobalSettings; library: LibraryEntry[] } }>({
    type: 'BG_GET_STORAGE'
  });
  state.settings = storage.data.settings;
  state.library = storage.data.library;
  syncControlValues();
  await refreshStatus();
  renderSearchResults();
  renderLibrary();

  window.setInterval(() => {
    refreshStatus().catch(() => {
      // ignore polling errors
    });
  }, 1500);
}

bootstrap().catch((error) => {
  setStatus(error instanceof Error ? error.message : 'Failed to initialize');
});
