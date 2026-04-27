
import React, { useState } from 'react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenBrowse: () => void;
  onOpenLibrary: () => void;
  onOpenWebReader: () => void;
  onFetchWebFromMenu: (url: string) => void;
  webRate: number;
  onWebRateChange: (rate: number) => void;
  webVoice: string;
  webVoices: SpeechSynthesisVoice[];
  onWebVoiceChange: (voice: string) => void;
  webUseAiNarration: boolean;
  onWebUseAiNarrationChange: (value: boolean) => void;
  webApiKey: string;
  onWebApiKeyChange: (value: string) => void;
  onNewSearch: () => void;
  currentNovelTitle?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  isOpen, 
  onClose, 
  onOpenSettings, 
  onOpenBrowse, 
  onOpenLibrary,
  onOpenWebReader,
  onFetchWebFromMenu,
  webRate,
  onWebRateChange,
  webVoice,
  webVoices,
  onWebVoiceChange,
  webUseAiNarration,
  onWebUseAiNarrationChange,
  webApiKey,
  onWebApiKeyChange,
  onNewSearch,
  currentNovelTitle 
}) => {
  const [menuWebUrl, setMenuWebUrl] = useState('');

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      
      {/* Sidebar Content */}
      <div className={`fixed top-0 right-0 h-full w-[300px] bg-slate-900 border-l border-white/10 z-[160] transition-transform duration-500 ease-out shadow-2xl flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        
        <div className="p-6 flex items-center justify-between border-b border-white/5">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500">
              <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>
            </svg>
            選單
          </h2>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {currentNovelTitle && (
            <div className="mb-8 p-4 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl">
              <p className="text-[10px] uppercase tracking-widest font-bold text-indigo-400 mb-1">正在閱讀</p>
              <p className="text-sm font-bold text-white truncate">{currentNovelTitle}</p>
            </div>
          )}

          <MenuButton 
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>}
            label="搜尋新小說"
            onClick={() => { onNewSearch(); onClose(); }}
          />

          <MenuButton 
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="M8 6h10"/></svg>}
            label="我的書庫"
            onClick={() => { onOpenLibrary(); onClose(); }}
          />
          
          <MenuButton 
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>}
            label="瀏覽熱門書源"
            onClick={() => { onOpenBrowse(); onClose(); }}
          />

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-3">
            <button
              type="button"
              onClick={onOpenWebReader}
              className="w-full flex items-center gap-3 text-left p-2 rounded-xl hover:bg-white/5 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              <span className="text-sm font-bold text-slate-200">網址抓取</span>
            </button>

            <input
              value={menuWebUrl}
              onChange={(e) => setMenuWebUrl(e.target.value)}
              placeholder="貼上網址後立即抓取"
              className="w-full bg-slate-900/70 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => {
                if (!menuWebUrl.trim()) return;
                onFetchWebFromMenu(menuWebUrl);
                onClose();
              }}
              className="w-full px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors"
            >
              立即抓取
            </button>

            <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
              <div className="text-[11px] text-slate-400 font-bold mb-1">播放速度</div>
              <div className="text-white font-bold text-sm mb-2">{webRate.toFixed(1)}x</div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={webRate}
                onChange={(e) => onWebRateChange(parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
              <div className="text-[11px] text-slate-400 font-bold mb-2">語音</div>
              <select
                value={webVoice}
                onChange={(e) => onWebVoiceChange(e.target.value)}
                className="w-full bg-slate-800 text-xs font-bold rounded-lg px-2 py-2 focus:outline-none border border-white/5 text-white"
              >
                {webVoices.length === 0 && <option value="">預設</option>}
                {webVoices.map(v => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang || 'unknown'})
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3 space-y-2">
              <div className="text-[11px] text-slate-400 font-bold">AI 朗讀（GEMINI）</div>
              <input
                value={webApiKey}
                onChange={(e) => onWebApiKeyChange(e.target.value)}
                placeholder="API Key 選填，未填則使用預設"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={webUseAiNarration}
                  onChange={(e) => onWebUseAiNarrationChange(e.target.checked)}
                  className="accent-indigo-500"
                />
                使用 AI 朗讀
              </label>
            </div>
          </div>

          <div className="h-px bg-white/5 my-4" />

          <MenuButton 
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>}
            label="閱讀偏好設定"
            onClick={() => { onOpenSettings(); onClose(); }}
          />
        </div>

        <div className="p-6 text-center">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">Gemini AI Narrator v1.2</p>
        </div>
      </div>
    </>
  );
};

interface MenuButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

const MenuButton: React.FC<MenuButtonProps> = ({ icon, label, onClick }) => (
  <button 
    onClick={onClick}
    className="w-full flex items-center gap-4 p-4 rounded-2xl text-slate-300 hover:text-white hover:bg-white/5 transition-all group"
  >
    <span className="text-slate-400 group-hover:text-indigo-400 transition-colors">{icon}</span>
    <span className="font-medium">{label}</span>
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto opacity-0 group-hover:opacity-40 -translate-x-2 group-hover:translate-x-0 transition-all">
      <path d="m9 18 6-6-6-6"/>
    </svg>
  </button>
);

export default Sidebar;
