
import React from 'react';
import { ReaderState, VoiceOption } from '../types.ts';

interface AudioControlsProps {
  state: ReaderState;
  onPlayPause: () => void;
  onStop: () => void;
  onNext?: () => void;
  voice: string;
  onVoiceChange: (voice: string) => void;
  title: string;
  volume: number;
  onVolumeChange: (volume: number) => void;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  currentTime: number;
  duration: number;
}

const VOICES: VoiceOption[] = [
  { id: 'Kore', name: 'Kore (男)', gender: 'male' },
  { id: 'Puck', name: 'Puck (男)', gender: 'male' },
  { id: 'Charon', name: 'Charon (男)', gender: 'male' },
  { id: 'Fenrir', name: 'Fenrir (男)', gender: 'male' },
  { id: 'Aoede', name: 'Aoede (女)', gender: 'female' },
];

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const AudioControls: React.FC<AudioControlsProps> = ({ 
  state, onPlayPause, onStop, onNext, voice, onVoiceChange, title, volume, onVolumeChange, playbackRate, onPlaybackRateChange, currentTime, duration
}) => {
  if (state === ReaderState.IDLE || state === ReaderState.ERROR) return null;

  const isReading = state === ReaderState.READING;
  const isPlaying = state === ReaderState.PLAYING;
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 p-3 md:p-6 z-50">
      <div className="max-w-5xl mx-auto bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl md:rounded-[2rem] shadow-2xl overflow-hidden">
        {/* Progress Bar */}
        <div className="w-full h-1 bg-slate-800">
          <div 
            className="h-full bg-indigo-500 transition-all duration-100 ease-linear"
            style={{ width: `${progressPercent}%` }}
          ></div>
        </div>

        <div className="p-3 md:p-5">
          <div className="flex flex-col gap-3">
            {/* Top Row: Info & Main Controls */}
            <div className="flex items-center justify-between gap-4">
              {/* Info Section */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-indigo-600 rounded-lg flex-shrink-0 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                    <path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">{title}</h3>
                  <p className="text-[10px] text-slate-400 font-medium">
                    {state === ReaderState.READING ? '語音處理中...' : `${formatTime(currentTime)} / ${formatTime(duration)}`}
                  </p>
                </div>
              </div>

              {/* Playback Buttons */}
              <div className="flex items-center gap-2 md:gap-4">
                <button 
                  onClick={onStop}
                  className="p-2 text-slate-400 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
                </button>
                
                <button 
                  onClick={onPlayPause}
                  disabled={isReading}
                  className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-white text-slate-950 flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                >
                  {isReading ? (
                    <div className="w-5 h-5 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin"></div>
                  ) : isPlaying ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="16" x="14" y="4" rx="1"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><path d="m7 4 12 8-12 8V4z"/></svg>
                  )}
                </button>

                <button 
                  onClick={onNext}
                  className="p-2 text-slate-400 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Bottom Row: Settings (Speed, Volume, Voice) */}
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-white/5 overflow-x-auto no-scrollbar">
              {/* Speed */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[10px] text-slate-500 font-bold uppercase whitespace-nowrap">{playbackRate.toFixed(1)}x</span>
                <input 
                  type="range" min="0.5" max="2.0" step="0.1" value={playbackRate} 
                  onChange={(e) => onPlaybackRateChange(parseFloat(e.target.value))}
                  className="w-12 md:w-20 h-1 bg-slate-800 rounded-full appearance-none accent-indigo-500"
                />
              </div>

              {/* Volume */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => onVolumeChange(volume === 0 ? 0.8 : 0)} className="text-slate-500">
                  {volume === 0 ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L5.414 8.586H3a1 1 0 0 0-1 1v4.828a1 1 0 0 0 1 1h2.414l4.383 4.382A.705.705 0 0 0 11 19.298V4.702z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L5.414 8.586H3a1 1 0 0 0-1 1v4.828a1 1 0 0 0 1 1h2.414l4.383 4.382A.705.705 0 0 0 11 19.298V4.702z"/><path d="M16 9a5 5 0 0 1 0 6"/></svg>
                  )}
                </button>
                <input 
                  type="range" min="0" max="1" step="0.1" value={volume} 
                  onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                  className="w-12 md:w-20 h-1 bg-slate-800 rounded-full appearance-none accent-indigo-500"
                />
              </div>

              {/* Voice Selector */}
              <div className="flex-shrink-0">
                <select 
                  value={voice}
                  onChange={(e) => onVoiceChange(e.target.value)}
                  className="bg-slate-800 text-[10px] md:text-xs font-bold rounded-lg px-2 py-1 focus:outline-none border border-white/5 text-white"
                >
                  {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioControls;
