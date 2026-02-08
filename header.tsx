
import React from 'react';

interface HeaderProps {
  onToggleMenu: () => void;
}

const Header: React.FC<HeaderProps> = ({ onToggleMenu }) => {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <div className="flex items-center gap-3 cursor-pointer group" onClick={() => window.location.reload()}>
        <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-110 transition-transform">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
        </div>
        <div className="hidden sm:block">
          <h1 className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Gemini 小說朗讀器</h1>
          <p className="text-[9px] text-slate-400 uppercase tracking-widest font-bold">AI 智慧閱讀助手</p>
        </div>
      </div>
      
      <button 
        onClick={onToggleMenu}
        className="w-10 h-10 flex flex-col items-center justify-center gap-1.5 bg-slate-800/50 hover:bg-slate-800 rounded-xl transition-all group"
      >
        <div className="w-5 h-0.5 bg-slate-300 group-hover:bg-indigo-400 group-hover:w-6 transition-all"></div>
        <div className="w-5 h-0.5 bg-slate-300 group-hover:bg-indigo-400 transition-all"></div>
        <div className="w-5 h-0.5 bg-slate-300 group-hover:bg-indigo-400 group-hover:w-4 transition-all"></div>
      </button>
    </header>
  );
};

export default Header;
