import type { SubtitleCue, SubtitleFormat } from './types';

export interface IndexedCues {
  cues: SubtitleCue[];
  starts: number[];
}

const hasTimingArrow = (value: string): boolean => value.includes('-->');
const CUE_SEARCH_WINDOW = 4;

function parseClockToSeconds(value: string): number {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length < 2 || parts.length > 3) {
    return 0;
  }
  const [hh, mm, ss] = parts.length === 3 ? parts : ['0', parts[0], parts[1]];
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

function parseAssClockToSeconds(value: string): number {
  const [h = '0', m = '0', s = '0'] = value.trim().split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s.replace(',', '.'));
}

function normalizeText(value: string): string {
  return value
    .replace(/\{\\[^}]+\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\r/g, '')
    .trim();
}

function parseSrt(input: string): SubtitleCue[] {
  const blocks = input.replace(/\r/g, '').trim().split(/\n\n+/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length < 2) {
      continue;
    }
    const timingLine = hasTimingArrow(lines[0]) ? lines[0] : lines[1];
    if (!hasTimingArrow(timingLine)) {
      continue;
    }
    const [start, end] = timingLine.split('-->').map((part) => parseClockToSeconds(part));
    const textStart = hasTimingArrow(lines[0]) ? 1 : 2;
    const text = normalizeText(lines.slice(textStart).join('\n'));
    if (text) {
      cues.push({ start, end, text });
    }
  }

  return cues;
}

function parseVtt(input: string): SubtitleCue[] {
  const lines = input.replace(/\r/g, '').split('\n');
  const cues: SubtitleCue[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || line === 'WEBVTT' || line.startsWith('NOTE')) {
      index += 1;
      continue;
    }

    const timingLine = hasTimingArrow(line) ? line : lines[index + 1]?.trim();
    if (!timingLine || !hasTimingArrow(timingLine)) {
      index += 1;
      continue;
    }

    const [startPart, endPart] = timingLine.split('-->');
    const start = parseClockToSeconds(startPart);
    const end = parseClockToSeconds(endPart.trim().split(' ')[0]);

    index += hasTimingArrow(line) ? 1 : 2;
    const textLines: string[] = [];
    while (index < lines.length && lines[index].trim() !== '') {
      textLines.push(lines[index]);
      index += 1;
    }
    while (index < lines.length && lines[index].trim() === '') {
      index += 1;
    }
    const text = normalizeText(textLines.join('\n'));
    if (text) {
      cues.push({ start, end, text });
    }
  }

  return cues;
}

function parseAssSsa(input: string): SubtitleCue[] {
  const lines = input.replace(/\r/g, '').split('\n');
  let inEvents = false;
  let formatColumns: string[] = [];
  const cues: SubtitleCue[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith('[')) {
      inEvents = line.toLowerCase() === '[events]';
      continue;
    }
    if (!inEvents) {
      continue;
    }
    if (line.toLowerCase().startsWith('format:')) {
      formatColumns = line
        .slice(7)
        .split(',')
        .map((entry) => entry.trim().toLowerCase());
      continue;
    }
    if (!line.toLowerCase().startsWith('dialogue:') || formatColumns.length === 0) {
      continue;
    }

    const payload = line.slice(9).trim();
    const maxSplits = formatColumns.length - 1;
    const parts: string[] = [];
    let current = '';
    let splits = 0;

    for (const char of payload) {
      if (char === ',' && splits < maxSplits) {
        parts.push(current);
        current = '';
        splits += 1;
      } else {
        current += char;
      }
    }
    parts.push(current);

    const startIndex = formatColumns.indexOf('start');
    const endIndex = formatColumns.indexOf('end');
    const textIndex = formatColumns.indexOf('text');

    if (startIndex < 0 || endIndex < 0 || textIndex < 0) {
      continue;
    }

    const start = parseAssClockToSeconds(parts[startIndex] ?? '0');
    const end = parseAssClockToSeconds(parts[endIndex] ?? '0');
    const text = normalizeText(parts[textIndex] ?? '');

    if (text) {
      cues.push({ start, end, text });
    }
  }

  return cues;
}

export function parseSubtitle(input: string, format: SubtitleFormat): SubtitleCue[] {
  const parserByFormat: Record<SubtitleFormat, (text: string) => SubtitleCue[]> = {
    srt: parseSrt,
    vtt: parseVtt,
    ass: parseAssSsa,
    ssa: parseAssSsa
  };

  return parserByFormat[format](input)
    .filter((cue) => cue.end > cue.start)
    .sort((a, b) => a.start - b.start);
}

export function buildCueIndex(cues: SubtitleCue[]): IndexedCues {
  return {
    cues,
    starts: cues.map((cue) => cue.start)
  };
}

export function findCue(indexed: IndexedCues, timeInSeconds: number): SubtitleCue | null {
  const { cues, starts } = indexed;
  if (cues.length === 0) {
    return null;
  }

  let left = 0;
  let right = starts.length - 1;
  let best = -1;

  while (left <= right) {
    const mid = (left + right) >> 1;
    if (starts[mid] <= timeInSeconds) {
      best = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  for (
    let index = Math.max(best, 0);
    index >= 0 && index >= best - CUE_SEARCH_WINDOW;
    index -= 1
  ) {
    const cue = cues[index];
    if (cue.start <= timeInSeconds && cue.end >= timeInSeconds) {
      return cue;
    }
  }

  for (
    let index = Math.max(best + 1, 0);
    index < cues.length && index <= best + CUE_SEARCH_WINDOW;
    index += 1
  ) {
    const cue = cues[index];
    if (cue.start <= timeInSeconds && cue.end >= timeInSeconds) {
      return cue;
    }
  }

  return null;
}

export function detectFormat(fileName: string): SubtitleFormat | null {
  const lowered = fileName.toLowerCase();
  if (lowered.endsWith('.srt')) return 'srt';
  if (lowered.endsWith('.vtt')) return 'vtt';
  if (lowered.endsWith('.ass')) return 'ass';
  if (lowered.endsWith('.ssa')) return 'ssa';
  return null;
}
