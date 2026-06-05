import { describe, expect, it } from 'vitest';
import { buildCueIndex, detectFormat, findCue, parseSubtitle } from '../src/shared/subtitles';

describe('subtitle parser', () => {
  it('parses SRT and finds cue by timestamp', () => {
    const input = `1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:05,500\nWorld`;
    const cues = parseSubtitle(input, 'srt');
    const cue = findCue(buildCueIndex(cues), 1.5);
    expect(cues).toHaveLength(2);
    expect(cue?.text).toBe('Hello');
  });

  it('parses VTT payload with header', () => {
    const input = `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi`;
    const cues = parseSubtitle(input, 'vtt');
    expect(cues[0].text).toBe('Hi');
  });

  it('parses ASS/SSA dialogue lines', () => {
    const ass = `[Script Info]\nTitle: Demo\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\i1}Hello\\NWorld`;
    const cues = parseSubtitle(ass, 'ass');
    expect(cues[0].text).toBe('Hello\nWorld');
    expect(cues[0].start).toBe(1);
  });

  it('detects supported extensions', () => {
    expect(detectFormat('movie.srt')).toBe('srt');
    expect(detectFormat('movie.vtt')).toBe('vtt');
    expect(detectFormat('movie.ass')).toBe('ass');
    expect(detectFormat('movie.ssa')).toBe('ssa');
    expect(detectFormat('movie.txt')).toBeNull();
  });
});
