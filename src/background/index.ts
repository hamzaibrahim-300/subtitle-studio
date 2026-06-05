import type {
  GlobalSettings,
  LibraryEntry,
  SiteOverride,
  SubtitleSearchQuery,
  SubtitleSearchResult
} from '../shared/types';

interface CacheMap {
  [key: string]: { content: string; savedAt: number };
}

interface StoredData {
  settings: GlobalSettings;
  library: LibraryEntry[];
  siteOverrides: SiteOverride[];
  cachedDownloads: CacheMap;
}

const DEFAULT_DATA: StoredData = {
  settings: { openSubtitlesApiKey: '' },
  library: [],
  siteOverrides: [],
  cachedDownloads: {}
};

const OPEN_SUBTITLES_BASE = 'https://api.opensubtitles.com/api/v1';
const TITLE_SIMILARITY_WEIGHT = 55;
const YEAR_MATCH_BASE = 20;
const YEAR_PENALTY = 6;
const SEASON_EXACT_BONUS = 12;
const EPISODE_EXACT_BONUS = 12;
const RUNTIME_MATCH_BASE = 8;
const RUNTIME_PENALTY_DIVISOR = 20;
const RATING_MAX_BONUS = 8;

async function getStoredData(): Promise<StoredData> {
  const data = await chrome.storage.local.get(Object.keys(DEFAULT_DATA));
  return {
    settings: data.settings ?? DEFAULT_DATA.settings,
    library: data.library ?? DEFAULT_DATA.library,
    siteOverrides: data.siteOverrides ?? DEFAULT_DATA.siteOverrides,
    cachedDownloads: data.cachedDownloads ?? DEFAULT_DATA.cachedDownloads
  };
}

async function saveStoredData(update: Partial<StoredData>): Promise<void> {
  await chrome.storage.local.set(update);
}

function similarity(a: string, b: string): number {
  const left = a.toLowerCase().trim();
  const right = b.toLowerCase().trim();
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = new Set(left.split(/\W+/).filter(Boolean));
  const rightTokens = new Set(right.split(/\W+/).filter(Boolean));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size, 1);
}

function scoreResult(query: SubtitleSearchQuery, raw: any): number {
  const attributes = raw.attributes ?? {};
  const feature = attributes.feature_details ?? {};
  let score =
    similarity(query.title, attributes.release ?? attributes.files?.[0]?.file_name ?? '') *
    TITLE_SIMILARITY_WEIGHT;

  if (query.year && feature.year) {
    score += Math.max(0, YEAR_MATCH_BASE - Math.abs(query.year - feature.year) * YEAR_PENALTY);
  }
  if (query.season && feature.season_number) {
    score += query.season === feature.season_number ? SEASON_EXACT_BONUS : 0;
  }
  if (query.episode && feature.episode_number) {
    score += query.episode === feature.episode_number ? EPISODE_EXACT_BONUS : 0;
  }
  if (query.runtime && feature.movie_duration) {
    score += Math.max(
      0,
      RUNTIME_MATCH_BASE - Math.abs(query.runtime - feature.movie_duration) / RUNTIME_PENALTY_DIVISOR
    );
  }
  score += Math.min(RATING_MAX_BONUS, Number(attributes.ratings ?? 0));

  return Math.min(100, Math.round(score));
}

async function openSubtitlesFetch(path: string, apiKey: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${OPEN_SUBTITLES_BASE}${path}`, {
    ...init,
    headers: {
      'Api-Key': apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'SubtitleStudio/1.0.0',
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenSubtitles request failed (${response.status}): ${text.slice(0, 140)}`);
  }

  return response.json();
}

async function searchOpenSubtitles(query: SubtitleSearchQuery): Promise<SubtitleSearchResult[]> {
  const { settings } = await getStoredData();
  if (!settings.openSubtitlesApiKey) {
    throw new Error('Set your OpenSubtitles API key in settings before searching.');
  }

  const params = new URLSearchParams({
    query: query.title,
    languages: query.language || 'en',
    order_by: 'download_count',
    order_direction: 'desc'
  });

  if (query.season) params.set('season_number', String(query.season));
  if (query.episode) params.set('episode_number', String(query.episode));
  if (query.year) params.set('year', String(query.year));

  const payload = await openSubtitlesFetch(`/subtitles?${params.toString()}`, settings.openSubtitlesApiKey);
  const rows = (payload.data ?? []) as any[];

  return rows
    .map((row) => {
      const file = row.attributes?.files?.[0];
      if (!file?.file_id) return null;
      return {
        id: row.id,
        fileId: file.file_id,
        fileName: file.file_name,
        language: row.attributes?.language ?? 'unknown',
        release: row.attributes?.release,
        year: row.attributes?.feature_details?.year,
        ratings: row.attributes?.ratings,
        downloadCount: row.attributes?.download_count,
        score: scoreResult(query, row)
      } satisfies SubtitleSearchResult;
    })
    .filter((row): row is SubtitleSearchResult => Boolean(row))
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
}

async function downloadSubtitle(fileId: number): Promise<string> {
  const data = await getStoredData();
  const key = String(fileId);
  const cached = data.cachedDownloads[key];
  if (cached) {
    return cached.content;
  }

  if (!data.settings.openSubtitlesApiKey) {
    throw new Error('OpenSubtitles API key missing.');
  }

  const response = await openSubtitlesFetch(
    '/download',
    data.settings.openSubtitlesApiKey,
    {
      method: 'POST',
      body: JSON.stringify({ file_id: fileId })
    }
  );

  const link = response.link as string | undefined;
  if (!link) {
    throw new Error('Subtitle download link not found.');
  }

  const subtitleResponse = await fetch(link);
  if (!subtitleResponse.ok) {
    throw new Error(`Failed to download subtitle (${subtitleResponse.status}).`);
  }
  const content = await subtitleResponse.text();

  await saveStoredData({
    cachedDownloads: {
      ...data.cachedDownloads,
      [key]: {
        content,
        savedAt: Date.now()
      }
    }
  });

  return content;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => {
      console.warn('Failed to configure side panel action behavior on install.', error);
    });
  chrome.storage.local.get(Object.keys(DEFAULT_DATA)).then((data) => {
    const updates: Partial<StoredData> = {};
    for (const [key, value] of Object.entries(DEFAULT_DATA)) {
      if (typeof data[key] === 'undefined') {
        (updates as any)[key] = value;
      }
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => {
      console.warn('Failed to configure side panel action behavior on startup.', error);
    });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-side-panel') {
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'BG_SEARCH_SUBTITLES') {
      const results = await searchOpenSubtitles(message.query as SubtitleSearchQuery);
      sendResponse({ ok: true, results });
      return;
    }

    if (message?.type === 'BG_DOWNLOAD_SUBTITLE') {
      const content = await downloadSubtitle(Number(message.fileId));
      sendResponse({ ok: true, content });
      return;
    }

    if (message?.type === 'BG_GET_STORAGE') {
      const data = await getStoredData();
      sendResponse({ ok: true, data });
      return;
    }

    if (message?.type === 'BG_SAVE_SETTINGS') {
      await saveStoredData({ settings: message.settings });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'BG_SAVE_SITE_OVERRIDE') {
      const data = await getStoredData();
      const incoming = message.siteOverride as SiteOverride;
      const withoutCurrent = data.siteOverrides.filter((entry) => entry.host !== incoming.host);
      await saveStoredData({ siteOverrides: [...withoutCurrent, incoming] });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'BG_ADD_LIBRARY_ENTRY') {
      const data = await getStoredData();
      const entry = message.entry as LibraryEntry;
      const library = [entry, ...data.library.filter((item) => item.id !== entry.id)].slice(0, 100);
      await saveStoredData({ library });
      sendResponse({ ok: true, library });
      return;
    }

    if (message?.type === 'BG_TOGGLE_FAVORITE') {
      const data = await getStoredData();
      const library = data.library.map((entry) =>
        entry.id === message.id ? { ...entry, favorited: !entry.favorited } : entry
      );
      await saveStoredData({ library });
      sendResponse({ ok: true, library });
      return;
    }

    sendResponse({ ok: false, error: 'Unsupported message' });
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });

  return true;
});
