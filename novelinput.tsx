
import React, { useState } from 'react';

interface NovelInputProps {
  onSearch: (input: string) => void;
  isLoading: boolean;
}

const NovelInput: React.FC<NovelInputProps> = ({ onSearch, isLoading }) => {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSearch(input.trim());
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto mt-4 mb-8">
      <form onSubmit={handleSubmit} className="relative group">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="貼上小說網址 (如番茄、起點)..."
          className="w-full pl-6 pr-36 py-4 bg-slate-800/50 border border-slate-700 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-slate-500"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="absolute right-2 top-2 bottom-2 px-5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all active:scale-95 text-sm"
        >
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          )}
          <span>{isLoading ? '處理中' : '開啟閱讀'}</span>
        </button>
      </form>
      <div className="mt-2 text-center text-[11px] text-slate-500 font-bold uppercase tracking-wider">
        支援：番茄小說、起點中文網、WebNovel 等網址
      </div>
    </div>
  );
};

export default NovelInput;
