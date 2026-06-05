export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa';

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface TrackStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  background: string;
  opacity: number;
  outline: string;
  shadow: string;
  verticalPercent: number;
}

export interface SubtitleTrack {
  id: string;
  name: string;
  format: SubtitleFormat;
  cues: SubtitleCue[];
  offsetMs: number;
  style: TrackStyle;
}

export interface VideoStatus {
  url: string;
  title: string;
  hasVideo: boolean;
  currentTime: number;
  duration: number;
  tracks: Array<Pick<SubtitleTrack, 'id' | 'name' | 'format' | 'offsetMs'> | null>;
}

export interface SubtitleSearchQuery {
  title: string;
  season?: number;
  episode?: number;
  year?: number;
  language?: string;
  runtime?: number;
}

export interface SubtitleSearchResult {
  id: string;
  fileId: number;
  fileName: string;
  language: string;
  release?: string;
  year?: number;
  fps?: number;
  ratings?: number;
  downloadCount?: number;
  score: number;
}

export interface LibraryEntry {
  id: string;
  title: string;
  fileName: string;
  slot: 0 | 1;
  source: 'upload' | 'search';
  favorited?: boolean;
  usedAt: number;
}

export interface GlobalSettings {
  openSubtitlesApiKey: string;
}

export interface SiteOverride {
  host: string;
  styles: [TrackStyle, TrackStyle];
}
