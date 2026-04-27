
export interface ChapterInfo {
  title: string;
  url: string;
}

export interface NovelContent {
  title: string;
  content: string;
  sourceUrl?: string;
  nextChapterUrl?: string;
  prevChapterUrl?: string;
  chapters?: ChapterInfo[];
  groundingSources?: any[];
}

export enum ReaderState {
  IDLE = 'IDLE',
  FETCHING = 'FETCHING',
  READING = 'READING',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  ERROR = 'ERROR'
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'male' | 'female';
}
