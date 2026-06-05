import { buildCueIndex, detectFormat, findCue, parseSubtitle } from '../shared/subtitles';
import type { IndexedCues } from '../shared/subtitles';
import type { SubtitleFormat, SubtitleTrack, TrackStyle, VideoStatus } from '../shared/types';

type Slot = 0 | 1;

interface RuntimeTrack extends SubtitleTrack {
  index: IndexedCues;
}

interface LoadTrackMessage {
  type: 'LOAD_TRACK';
  slot: Slot;
  fileName: string;
  content: string;
}

interface SetOffsetMessage {
  type: 'SET_OFFSET';
  slot: Slot;
  deltaMs?: number;
  valueMs?: number;
}

interface SetStyleMessage {
  type: 'SET_STYLE';
  slot: Slot;
  style: Partial<TrackStyle>;
}

interface ResetOffsetMessage {
  type: 'RESET_OFFSET';
  slot: Slot;
}

interface GetStatusMessage {
  type: 'GET_STATUS';
}

interface ClearTrackMessage {
  type: 'CLEAR_TRACK';
  slot: Slot;
}

type ContentMessage =
  | LoadTrackMessage
  | SetOffsetMessage
  | SetStyleMessage
  | ResetOffsetMessage
  | GetStatusMessage
  | ClearTrackMessage;

const DEFAULT_STYLES: [TrackStyle, TrackStyle] = [
  {
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: 34,
    color: '#ffffff',
    background: 'rgba(0, 0, 0, 0.3)',
    opacity: 1,
    outline: '2px #000000',
    shadow: '0 2px 6px rgba(0,0,0,0.9)',
    verticalPercent: 88
  },
  {
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: 28,
    color: '#ffd700',
    background: 'rgba(0, 0, 0, 0.2)',
    opacity: 1,
    outline: '2px #000000',
    shadow: '0 2px 6px rgba(0,0,0,0.9)',
    verticalPercent: 80
  }
];

const tracks: [RuntimeTrack | null, RuntimeTrack | null] = [null, null];
let activeVideo: HTMLVideoElement | null = null;

const container = document.createElement('div');
container.id = '__subtitle_studio_root';
const shadowRoot = container.attachShadow({ mode: 'open' });
const host = document.createElement('div');
host.className = 'host';
const primary = document.createElement('div');
const secondary = document.createElement('div');
primary.className = 'track';
secondary.className = 'track';
host.append(primary, secondary);
shadowRoot.append(host, buildStyles());
document.documentElement.appendChild(container);

function buildStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    .host {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483646;
      display: none;
    }
    .track {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
      max-width: 96%;
      white-space: pre-line;
      line-height: 1.35;
      padding: 2px 8px;
      border-radius: 6px;
    }
  `;
  return style;
}

function parseOutline(outline: string): string {
  const [width = '0', color = '#000'] = outline.trim().split(' ');
  return `${width} 0 ${color}, -${width} 0 ${color}, 0 ${width} ${color}, 0 -${width} ${color}`;
}

function applyStyle(node: HTMLDivElement, style: TrackStyle): void {
  node.style.fontFamily = style.fontFamily;
  node.style.fontSize = `${style.fontSize}px`;
  node.style.color = style.color;
  node.style.opacity = `${style.opacity}`;
  node.style.background = style.background;
  node.style.top = `${style.verticalPercent}%`;
  node.style.textShadow = `${style.shadow}, ${parseOutline(style.outline)}`;
}

function findBestVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video')).filter((video) => {
    const rect = video.getBoundingClientRect();
    return rect.width > 120 && rect.height > 80;
  });

  if (videos.length === 0) {
    return null;
  }

  videos.sort((a, b) => {
    const rectA = a.getBoundingClientRect();
    const rectB = b.getBoundingClientRect();
    return rectB.width * rectB.height - rectA.width * rectA.height;
  });

  return videos[0];
}

function renderTrack(node: HTMLDivElement, slot: Slot, now: number): void {
  const track = tracks[slot];
  if (!track) {
    node.textContent = '';
    return;
  }

  const cue = findCue(track.index, now + track.offsetMs / 1000);
  node.textContent = cue?.text ?? '';
  applyStyle(node, track.style);
}

function updateHostLayout(video: HTMLVideoElement): void {
  const rect = video.getBoundingClientRect();
  host.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none';
  host.style.left = `${Math.round(rect.left)}px`;
  host.style.top = `${Math.round(rect.top)}px`;
  host.style.width = `${Math.round(rect.width)}px`;
  host.style.height = `${Math.round(rect.height)}px`;
}

function animationLoop(): void {
  const candidate = findBestVideo();
  if (candidate) {
    activeVideo = candidate;
    updateHostLayout(candidate);
    const now = candidate.currentTime;
    renderTrack(primary, 0, now);
    renderTrack(secondary, 1, now);
  } else {
    host.style.display = 'none';
  }
  requestAnimationFrame(animationLoop);
}

function createTrack(fileName: string, content: string): RuntimeTrack {
  const format = detectFormat(fileName);
  if (!format) {
    throw new Error('Unsupported subtitle format. Use .srt, .vtt, .ass, or .ssa');
  }
  const cues = parseSubtitle(content, format as SubtitleFormat);
  return {
    id: crypto.randomUUID(),
    name: fileName,
    format,
    cues,
    offsetMs: 0,
    style: structuredClone(DEFAULT_STYLES[0]),
    index: buildCueIndex(cues)
  };
}

function buildStatus(): VideoStatus {
  const video = activeVideo ?? findBestVideo();
  const currentTracks = tracks.map((track) =>
    track
      ? {
          id: track.id,
          name: track.name,
          format: track.format,
          offsetMs: track.offsetMs
        }
      : null
  ) as VideoStatus['tracks'];

  return {
    url: location.href,
    title: document.title,
    hasVideo: Boolean(video),
    currentTime: video?.currentTime ?? 0,
    duration: Number.isFinite(video?.duration) ? (video?.duration ?? 0) : 0,
    tracks: currentTracks
  };
}

function adjustPrimaryOffset(deltaMs: number): void {
  if (!tracks[0]) {
    return;
  }
  tracks[0].offsetMs += deltaMs;
}

document.addEventListener('keydown', (event) => {
  if (!event.altKey || !tracks[0]) {
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    adjustPrimaryOffset(-100);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    adjustPrimaryOffset(100);
  }
});

document.addEventListener('fullscreenchange', () => {
  if (activeVideo) {
    updateHostLayout(activeVideo);
  }
});

const observer = new MutationObserver(() => {
  if (!document.documentElement.contains(container)) {
    document.documentElement.appendChild(container);
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  try {
    if (message.type === 'LOAD_TRACK') {
      const track = createTrack(message.fileName, message.content);
      track.style = structuredClone(DEFAULT_STYLES[message.slot]);
      tracks[message.slot] = track;
      sendResponse({ ok: true, status: buildStatus() });
      return true;
    }

    if (message.type === 'SET_OFFSET') {
      const track = tracks[message.slot];
      if (track) {
        if (typeof message.valueMs === 'number') {
          track.offsetMs = message.valueMs;
        }
        if (typeof message.deltaMs === 'number') {
          track.offsetMs += message.deltaMs;
        }
      }
      sendResponse({ ok: true, status: buildStatus() });
      return true;
    }

    if (message.type === 'RESET_OFFSET') {
      const track = tracks[message.slot];
      if (track) {
        track.offsetMs = 0;
      }
      sendResponse({ ok: true, status: buildStatus() });
      return true;
    }

    if (message.type === 'SET_STYLE') {
      const track = tracks[message.slot];
      if (track) {
        track.style = { ...track.style, ...message.style };
      }
      sendResponse({ ok: true, status: buildStatus() });
      return true;
    }

    if (message.type === 'CLEAR_TRACK') {
      tracks[message.slot] = null;
      sendResponse({ ok: true, status: buildStatus() });
      return true;
    }

    if (message.type === 'GET_STATUS') {
      sendResponse({ ok: true, status: buildStatus() });
      return true;
    }

    sendResponse({ ok: false, error: 'Unsupported message' });
    return true;
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
    return true;
  }
});

animationLoop();
