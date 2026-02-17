import * as cheerio from 'cheerio';

export interface ChapterItem {
  title: string;
  url: string;
}

export interface NovelResult {
  title: string;
  content: string;
  sourceUrl?: string;
  nextChapterUrl?: string;
  prevChapterUrl?: string;
  chapters?: ChapterItem[]; // 章節目錄
}

const isQidianUrl = (input: string): boolean => {
  try {
    const u = new URL(input);
    return u.hostname === 'qidian.com' || u.hostname.endsWith('.qidian.com');
  } catch {
    return false;
  }
};

const toQidianMobileChapterUrl = (input: string): string => {
  const u = new URL(input);
  // 已經是手機版
  if (u.hostname === 'm.qidian.com') return u.toString();

  // 桌面版章節頁：https://www.qidian.com/chapter/<bookId>/<chapterId>/
  // 轉成手機版：https://m.qidian.com/chapter/<bookId>/<chapterId>/
  if (u.hostname.endsWith('qidian.com') && u.pathname.startsWith('/chapter/')) {
    const mobile = new URL(`https://m.qidian.com${u.pathname}`);
    mobile.search = u.search;
    mobile.hash = u.hash;
    return mobile.toString();
  }

  // 其他 qidian 網址：至少切到 m.qidian.com 同 path（有些頁面仍可解析）
  if (u.hostname.endsWith('qidian.com')) {
    const mobile = new URL(`https://m.qidian.com${u.pathname}`);
    mobile.search = u.search;
    mobile.hash = u.hash;
    return mobile.toString();
  }

  return input;
};

const resolveHref = (href: string, baseUrl: string, currentUrl: string): string => {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  // protocol-relative，例如：//m.qidian.com/chapter/...
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return baseUrl + href;
  return new URL(href, currentUrl).href;
};

const needsPuppeteer = (url: string): boolean => {
  const urlLower = url.toLowerCase();
  // 起點桌面版常回 202 探針頁（反爬），優先改抓 m.qidian.com（不需要 Puppeteer）
  return urlLower.includes('webnovel.com');
};

// 清理正文中被「當成文字」插入的廣告/樣式/腳本片段（例如 ttks.tw 章節頁）
const looksLikeInjectedCodeLine = (line: string, urlLower: string): boolean => {
  const t = line.trim();
  if (!t) return false;
  const tl = t.toLowerCase();

  // 常見：直接把 JS 呼叫輸出成文字
  if (/^loadadv\(\s*\d+\s*,\s*\d+\s*\)\s*;?$/i.test(t)) return true;

  // 常見：廣告容器/樣式 class 片段被輸出成文字
  if (tl.includes('.bg-container-') || tl.includes('.bg-ssp-')) return true;
  if (tl.includes('z-index: 2147483647')) return true;

  // CSS 規則整行（避免誤殺：只在看起來像 CSS 時才濾掉）
  const looksLikeCssRule =
    (t.startsWith('.') || t.startsWith('#') || t.startsWith('@')) &&
    t.includes('{') &&
    t.includes('}') &&
    (tl.includes('display') ||
      tl.includes('flex') ||
      tl.includes('z-index') ||
      tl.includes('justify-content') ||
      tl.includes('align-items') ||
      tl.includes('margin-left') ||
      tl.includes('margin-right'));
  if (looksLikeCssRule) return true;

  // 站點特化：天天看小說（ttks.tw）偶發把廣告初始化/樣式重複塞進正文
  if (urlLower.includes('ttks.tw')) {
    if (t.includes('loadAdv(')) return true;
    if (t.includes('.bg-container-') || t.includes('.bg-ssp-')) return true;
  }

  return false;
};

const cleanExtractedContent = (content: string, url: string): string => {
  const urlLower = url.toLowerCase();
  const raw = (content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');

  const out: string[] = [];
  let prevNonEmpty = '';
  let emptyStreak = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const isEmpty = trimmed.length === 0;

    if (isEmpty) {
      emptyStreak += 1;
      // 保留少量空行作為段落間隔，並避免空行爆炸
      if (emptyStreak <= 2) out.push('');
      continue;
    }

    emptyStreak = 0;

    if (looksLikeInjectedCodeLine(trimmed, urlLower)) continue;

    // 站內公告／廣告文案（如 twword「應廣大讀者的要求, 現推出VIP會員免廣告功能」）
    if (trimmed.includes('應廣大讀者的要求') || trimmed.includes('現推出VIP會員免廣告') || trimmed.includes('VIP會員免廣告功能')) continue;

    // 壓縮連續重複行（ttks.tw 會重複輸出同一段 CSS）
    if (trimmed === prevNonEmpty) continue;

    out.push(trimmed);
    prevNonEmpty = trimmed;
  }

  // 去除首尾空行
  while (out.length > 0 && out[0] === '') out.shift();
  while (out.length > 0 && out[out.length - 1] === '') out.pop();

  return out.join('\n');
};

const postProcessResult = (result: NovelResult, url: string): NovelResult => {
  return {
    ...result,
    content: cleanExtractedContent(result.content || '', url),
  };
};

// 提取下一章链接
const extractNextChapterUrl = ($: cheerio.CheerioAPI, url: string): string | undefined => {
  const urlLower = url.toLowerCase();
  let baseUrl: string;
  try {
    baseUrl = new URL(url).origin;
  } catch {
    return undefined;
  }

  // 起點（手機版）：「下一章」有時不在 a 文本中，藏在腳本資料中
  if (urlLower.includes('m.qidian.com') && urlLower.includes('/chapter/')) {
    const pathMatch = url.match(/\/chapter\/(\d+)\/(\d+)\//);
    const bookId = pathMatch?.[1];
    if (bookId) {
      const scriptsText = $('script')
        .toArray()
        .map(s => ($(s).html() || $(s).text() || '').toString())
        .join('\n');

      const nextIdMatch =
        scriptsText.match(/"next"\s*:\s*(\d{6,})/) ||
        scriptsText.match(/\bnext\s*[:=]\s*(\d{6,})/);
      if (nextIdMatch?.[1]) {
        return `https://m.qidian.com/chapter/${bookId}/${nextIdMatch[1]}/`;
      }

      const nextUrlMatch =
        scriptsText.match(/"nextUrl"\s*:\s*"([^"]+)"/) ||
        scriptsText.match(/nextUrl\s*[:=]\s*['"]([^'"]+)['"]/);
      if (nextUrlMatch?.[1]) {
        return resolveHref(nextUrlMatch[1], baseUrl, url);
      }
    }
  }

  // 黃金屋 (hjwzw.com)：章節 URL 為 /Book/Read/<bookId>,<chapterId>，依數字推斷下一章
  if (urlLower.includes('hjwzw.com')) {
    const m = url.match(/\/Book\/Read\/(\d+),(\d+)/i);
    if (m) {
      const [, bookId, chapterId] = m;
      const nextId = parseInt(chapterId, 10) + 1;
      const inferred = `${baseUrl}/Book/Read/${bookId},${nextId}`;
      const fromPage = $('a').toArray().find(a => {
        const t = $(a).text().trim();
        const href = $(a).attr('href');
        return href && (t.includes('下一章') || t.includes('下一頁')) && !href.startsWith('#');
      });
      if (fromPage) {
        const href = $(fromPage).attr('href');
        if (href) {
          try {
            return resolveHref(href, baseUrl, url);
          } catch {
            return inferred;
          }
        }
      }
      return inferred;
    }
  }
  
  // 稷下書院 / twword.com - 从脚本变量中提取
  if (urlLower.includes('twword.com')) {
    // 尝试从 JavaScript 变量中提取（支持多种格式）
    const scripts = $('script').toArray();
    for (const script of scripts) {
      const scriptText = $(script).html() || $(script).text() || '';
      // 匹配 var nextUrl = '/path/to/next.html';
      let nextUrlMatch = scriptText.match(/var\s+nextUrl\s*=\s*['"]([^'"]+)['"]/);
      if (!nextUrlMatch) {
        // 匹配 nextUrl = '/path/to/next.html';
        nextUrlMatch = scriptText.match(/nextUrl\s*=\s*['"]([^'"]+)['"]/);
      }
      if (!nextUrlMatch) {
        // 匹配 "nextUrl":"/path/to/next.html"
        nextUrlMatch = scriptText.match(/["']nextUrl["']\s*:\s*["']([^"']+)["']/);
      }
      if (nextUrlMatch && nextUrlMatch[1]) {
        const nextUrl = nextUrlMatch[1];
        console.log('從腳本變量提取到下一章:', nextUrl);
        try {
          return resolveHref(nextUrl, baseUrl, url);
        } catch {
          return resolveHref(nextUrl, baseUrl, url);
        }
      }
    }
    
    // 从底部导航中提取
    const footNavLinks = $('.foot-nav a').toArray();
    console.log(`找到 ${footNavLinks.length} 個底部導航鏈接`);
    for (const link of footNavLinks) {
      const $link = $(link);
      const text = $link.text().trim();
      const href = $link.attr('href');
      console.log(`檢查鏈接: 文字="${text}", href="${href}"`);
      if (text && (text.includes('下一章') || text.includes('下一頁'))) {
        if (href) {
          console.log('從底部導航提取到下一章:', href);
          try {
            return resolveHref(href, baseUrl, url);
          } catch {
            return resolveHref(href, baseUrl, url);
          }
        }
      }
    }
    
    // 从 nextBtn 类中提取
    const nextBtnLink = $('.nextBtn').parent('a').attr('href') || 
                       $('a.nextBtn').attr('href') ||
                       $('[class*="next"]').filter((_, el) => {
                         const text = $(el).text().toLowerCase();
                         return text.includes('下一章') || text.includes('下一頁');
                       }).attr('href');
    if (nextBtnLink) {
      return resolveHref(nextBtnLink, baseUrl, url);
    }
    
    // 如果所有方法都失敗，嘗試從 URL 模式推斷下一章（僅作為最後手段）
    console.log('嘗試從 URL 模式推斷下一章...');
    // 匹配類似 /0315678038/8096_180.html 的 URL
    const urlMatch = url.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
    if (urlMatch) {
      const [, bookId, chapterPrefix, chapterNum] = urlMatch;
      const nextChapterNum = parseInt(chapterNum, 10) + 1;
      const inferredUrl = `${baseUrl}/${bookId}/${chapterPrefix}_${nextChapterNum}.html`;
      console.log(`從 URL 模式推斷下一章: ${inferredUrl} (當前: ${chapterNum}, 下一章: ${nextChapterNum})`);
      return inferredUrl;
    }
  }
  
  // 通用提取：查找包含"下一章"、"下一頁"、"Next"等文字的链接
  const allLinks = $('a').toArray();
  for (const link of allLinks) {
    const $link = $(link);
    const text = $link.text().trim().toLowerCase();
    const href = $link.attr('href');
    if (href && (text.includes('下一章') || text.includes('下一頁') || text.includes('下一页'))) {
      console.log('從通用鏈接提取到下一章:', href);
      try {
        return resolveHref(href, baseUrl, url);
      } catch {
        return resolveHref(href, baseUrl, url);
      }
    }
  }
  
  console.log('未找到下一章鏈接');
  return undefined;
};

// 提取上一章链接
const extractPrevChapterUrl = ($: cheerio.CheerioAPI, url: string): string | undefined => {
  const urlLower = url.toLowerCase();
  let baseUrl: string;
  try {
    baseUrl = new URL(url).origin;
  } catch {
    return undefined;
  }

  // 起點（手機版）：「上一章」常不以文字 a 呈現，需從腳本資料抓 prev/preUrl
  if (urlLower.includes('m.qidian.com') && urlLower.includes('/chapter/')) {
    const pathMatch = url.match(/\/chapter\/(\d+)\/(\d+)\//);
    const bookId = pathMatch?.[1];
    if (bookId) {
      const scriptsText = $('script')
        .toArray()
        .map(s => ($(s).html() || $(s).text() || '').toString())
        .join('\n');

      const prevIdMatch =
        scriptsText.match(/"prev"\s*:\s*(\d{6,})/) ||
        scriptsText.match(/\bprev\s*[:=]\s*(\d{6,})/);
      if (prevIdMatch?.[1]) {
        return `https://m.qidian.com/chapter/${bookId}/${prevIdMatch[1]}/`;
      }

      const preUrlMatch =
        scriptsText.match(/"preUrl"\s*:\s*"([^"]+)"/) ||
        scriptsText.match(/preUrl\s*[:=]\s*['"]([^'"]+)['"]/);
      if (preUrlMatch?.[1]) {
        return resolveHref(preUrlMatch[1], baseUrl, url);
      }
    }
  }

  // 黃金屋 (hjwzw.com)：章節 URL 為 /Book/Read/<bookId>,<chapterId>，依數字推斷上一章（第一章無上一章）
  if (urlLower.includes('hjwzw.com')) {
    const m = url.match(/\/Book\/Read\/(\d+),(\d+)/i);
    if (m) {
      const [, bookId, chapterId] = m;
      const prevNum = parseInt(chapterId, 10) - 1;
      if (prevNum < 1) return undefined;
      const inferred = `${baseUrl}/Book/Read/${bookId},${prevNum}`;
      const fromPage = $('a').toArray().find(a => {
        const t = $(a).text().trim();
        const href = $(a).attr('href');
        return href && (t.includes('上一章') || t.includes('上一頁')) && !href.startsWith('#');
      });
      if (fromPage) {
        const href = $(fromPage).attr('href');
        if (href) {
          try {
            return resolveHref(href, baseUrl, url);
          } catch {
            return inferred;
          }
        }
      }
      return inferred;
    }
  }
  
  // 稷下書院 / twword.com - 从脚本变量中提取
  if (urlLower.includes('twword.com')) {
    // 尝试从 JavaScript 变量中提取（支持多种格式）
    const scripts = $('script').toArray();
    for (const script of scripts) {
      const scriptText = $(script).html() || $(script).text() || '';
      // 匹配 var prevUrl = '/path/to/prev.html';
      let prevUrlMatch = scriptText.match(/var\s+prevUrl\s*=\s*['"]([^'"]+)['"]/);
      if (!prevUrlMatch) {
        // 匹配 prevUrl = '/path/to/prev.html';
        prevUrlMatch = scriptText.match(/prevUrl\s*=\s*['"]([^'"]+)['"]/);
      }
      if (!prevUrlMatch) {
        // 匹配 "prevUrl":"/path/to/prev.html"
        prevUrlMatch = scriptText.match(/["']prevUrl["']\s*:\s*["']([^"']+)["']/);
      }
      if (prevUrlMatch && prevUrlMatch[1]) {
        const prevUrl = prevUrlMatch[1];
        console.log('從腳本變量提取到上一章:', prevUrl);
        try {
          return resolveHref(prevUrl, baseUrl, url);
        } catch {
          return resolveHref(prevUrl, baseUrl, url);
        }
      }
    }
    
    // 从底部导航中提取
    const footNavLinks = $('.foot-nav a').toArray();
    for (const link of footNavLinks) {
      const $link = $(link);
      const text = $link.text().trim();
      const href = $link.attr('href');
      if (text && (text.includes('上一章') || text.includes('上一頁'))) {
        if (href) {
          console.log('從底部導航提取到上一章:', href);
          try {
            return resolveHref(href, baseUrl, url);
          } catch {
            return resolveHref(href, baseUrl, url);
          }
        }
      }
    }
    
    // 从 prevBtn 类中提取
    const prevBtnLink = $('.prevBtn').parent('a').attr('href') || 
                       $('a.prevBtn').attr('href') ||
                       $('[class*="prev"]').filter((_, el) => {
                         const text = $(el).text().toLowerCase();
                         return text.includes('上一章') || text.includes('上一頁');
                       }).attr('href');
    if (prevBtnLink) {
      return resolveHref(prevBtnLink, baseUrl, url);
    }
    
    // 如果所有方法都失敗，嘗試從 URL 模式推斷上一章（僅作為最後手段）
    console.log('嘗試從 URL 模式推斷上一章...');
    // 匹配類似 /0315678038/8096_180.html 的 URL
    const urlMatch = url.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
    if (urlMatch) {
      const [, bookId, chapterPrefix, chapterNum] = urlMatch;
      const prevChapterNum = parseInt(chapterNum, 10) - 1;
      if (prevChapterNum > 0) {
        const inferredUrl = `${baseUrl}/${bookId}/${chapterPrefix}_${prevChapterNum}.html`;
        console.log(`從 URL 模式推斷上一章: ${inferredUrl} (當前: ${chapterNum}, 上一章: ${prevChapterNum})`);
        return inferredUrl;
      }
    }
  }
  
  // 通用提取：查找包含"上一章"、"上一頁"、"Previous"等文字的链接
  const allLinks = $('a').toArray();
  for (const link of allLinks) {
    const $link = $(link);
    const text = $link.text().trim().toLowerCase();
    const href = $link.attr('href');
    if (href && (text.includes('上一章') || text.includes('上一頁') || text.includes('上一页'))) {
      console.log('從通用鏈接提取到上一章:', href);
      try {
        return resolveHref(href, baseUrl, url);
      } catch {
        return resolveHref(href, baseUrl, url);
      }
    }
  }
  
  console.log('未找到上一章鏈接');
  return undefined;
};

// 提取章節目錄
const extractChapters = async ($: cheerio.CheerioAPI, url: string): Promise<ChapterItem[] | undefined> => {
  const urlLower = url.toLowerCase();
  let baseUrl: string;
  try {
    baseUrl = new URL(url).origin;
  } catch {
    return undefined;
  }

  // 起點中文網（手機版目錄頁含完整章節連結）
  // 目錄頁：https://m.qidian.com/book/<bookId>/catalog
  if (urlLower.includes('qidian.com')) {
    try {
      const bookIdMatch =
        url.match(/\/chapter\/(\d+)\//) ||
        url.match(/\/book\/(\d+)\//) ||
        url.match(/\/book\/(\d+)/);
      const bookId = bookIdMatch?.[1];
      if (!bookId) return undefined;

      const catalogUrl = `https://m.qidian.com/book/${bookId}/catalog`;
      const resp = await fetch(catalogUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          'Referer': 'https://m.qidian.com/',
        },
      });
      if (!resp.ok) return undefined;

      const html = await resp.text();
      const $toc = cheerio.load(html);
      const links = $toc('a[href*="/chapter/"]').toArray();

      const chapters: ChapterItem[] = [];
      const seen = new Set<string>();
      const tocBase = new URL(catalogUrl).origin;

      for (const a of links) {
        const $a = $toc(a);
        const href = ($a.attr('href') || '').trim();
        if (!href) continue;

        let title = ($a.text() || '').replace(/\s+/g, ' ').trim();
        if (!title) continue;

        // 去掉常見尾綴
        title = title.replace(/\s*(免费|VIP)\s*$/i, '').trim();

        // 去掉日期/附加資訊（目錄第一個常帶「2026-.. 作家入驻 ...」）
        const dateIdx = title.search(/\b20\d{2}-\d{2}-\d{2}\b/);
        if (dateIdx > 0) title = title.slice(0, dateIdx).trim();
        const extraIdx = title.indexOf('作家入驻');
        if (extraIdx > 0) title = title.slice(0, extraIdx).trim();

        const fullUrl = resolveHref(href, tocBase, catalogUrl);
        if (seen.has(fullUrl)) continue;
        seen.add(fullUrl);

        chapters.push({ title, url: fullUrl });
      }

      if (chapters.length > 0) {
        console.log(`✓ 起點目錄抓取成功，共 ${chapters.length} 章`);
        return chapters;
      }
    } catch (error) {
      console.log('起點目錄抓取失敗（不影響主流程）:', error);
    }
  }

  // 縱橫中文網（zongheng.com）
  // 章節頁（read/book）：https://read.zongheng.com/chapter/<bookId>/<chapterId>.html
  // 目錄頁（優先，較輕）：https://m.zongheng.com/chapter/list/<bookId>
  // 目錄頁（備用，較大）：https://book.zongheng.com/showchapter/<bookId>.html
  if (urlLower.includes('zongheng.com')) {
    try {
      const bookIdMatch =
        url.match(/\/chapter\/(\d+)\//) ||
        url.match(/\/showchapter\/(\d+)\.html/) ||
        url.match(/\/book\/(\d+)\.html/);
      const bookId = bookIdMatch?.[1];
      if (!bookId) return undefined;

      const fetchTextWithTimeout = async (targetUrl: string, init: RequestInit, timeoutMs: number) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const resp = await fetch(targetUrl, { ...init, signal: controller.signal });
          if (!resp.ok) return undefined;
          return await resp.text();
        } finally {
          clearTimeout(timer);
        }
      };

      const normalizeZonghengChapterTitle = (raw: string): string => {
        const t = (raw || '').replace(/\s+/g, ' ').trim();
        if (!t) return '';
        // 手機目錄常是「第一卷 第1章 xxx」，保留從「第N章」開始
        const idx = t.search(/第\s*\d+\s*章/);
        if (idx >= 0) return t.slice(idx).trim();
        return t;
      };

      const parseChaptersFromHtml = (html: string, selector: string, base: string, current: string) => {
        const $toc = cheerio.load(html);
        const links = $toc(selector).toArray();
        const seen = new Set<string>();
        const out: Array<ChapterItem & { _no?: number; _i: number }> = [];

        let i = 0;
        for (const a of links) {
          const $a = $toc(a);
          const href = ($a.attr('href') || '').trim();
          if (!href) continue;

          const fullUrl = resolveHref(href, base, current);
          const m = fullUrl.match(/\/chapter\/(\d+)\/(\d+)(?:\.html)?/i);
          if (!m) continue;
          if (m[1] !== bookId) continue;

          const canonicalUrl = `https://read.zongheng.com/chapter/${bookId}/${m[2]}.html`;
          if (seen.has(canonicalUrl)) continue;
          seen.add(canonicalUrl);

          const title = normalizeZonghengChapterTitle($a.text() || '');
          if (!title) continue;

          const noMatch = title.match(/第\s*(\d+)\s*章/);
          const no = noMatch?.[1] ? parseInt(noMatch[1], 10) : undefined;

          out.push({ title, url: canonicalUrl, _no: Number.isFinite(no as any) ? no : undefined, _i: i++ });
        }

        // 優先用「第N章」排序（更穩），否則保留原順序
        out.sort((a, b) => {
          if (a._no != null && b._no != null) return a._no - b._no;
          if (a._no != null) return -1;
          if (b._no != null) return 1;
          return a._i - b._i;
        });

        return out.map(({ title, url }) => ({ title, url }));
      };

      // 1) 優先抓手機目錄（體積更小、在 serverless 上更不容易超時）
      const mobileCatalogUrl = `https://m.zongheng.com/chapter/list/${bookId}`;
      const mobileHtml = await fetchTextWithTimeout(
        mobileCatalogUrl,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': 'https://m.zongheng.com/',
          },
        },
        6500
      );
      if (mobileHtml) {
        const chapters = parseChaptersFromHtml(
          mobileHtml,
          `a[href*="/chapter/${bookId}/"], a[href*="//m.zongheng.com/chapter/${bookId}/"]`,
          'https://m.zongheng.com',
          mobileCatalogUrl
        );
        if (chapters.length > 0) {
          console.log(`✓ 縱橫目錄抓取成功（mobile），共 ${chapters.length} 章`);
          return chapters;
        }
      }

      // 2) 備用：桌面 showchapter（較大）
      const catalogUrl = `https://book.zongheng.com/showchapter/${bookId}.html`;
      const html = await fetchTextWithTimeout(
        catalogUrl,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': 'https://book.zongheng.com/',
          },
        },
        6500
      );
      if (html) {
        const chapters = parseChaptersFromHtml(html, 'a[href*="/chapter/"]', 'https://book.zongheng.com', catalogUrl);
        if (chapters.length > 0) {
          console.log(`✓ 縱橫目錄抓取成功（showchapter），共 ${chapters.length} 章`);
          return chapters;
        }
      }
    } catch (error) {
      console.log('縱橫目錄抓取失敗（不影響主流程）:', error);
    }
  }

  // 黃金屋 (hjwzw.com)：章節頁 /Book/Read/<bookId>,<chapterId>，目錄頁 /Book/Chapter/<bookId>
  if (urlLower.includes('hjwzw.com')) {
    try {
      const bookMatch = url.match(/\/Book\/Read\/(\d+),(\d+)/i) || url.match(/\/Book\/Chapter\/(\d+)/i);
      const bookId = bookMatch?.[1];
      if (!bookId) return undefined;

      const catalogUrl = `${baseUrl}/Book/Chapter/${bookId}`;
      const resp = await fetch(catalogUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          'Referer': baseUrl + '/',
        },
      });
      if (!resp.ok) return undefined;

      const html = await resp.text();
      const $toc = cheerio.load(html);
      const chapters: ChapterItem[] = [];
      const seen = new Set<string>();

      // 目錄頁中的章節連結：/Book/Read/<bookId>,<chapterId>
      const links = $toc('a[href*="/Book/Read/"], a[href*="Book/Read/"]').toArray();
      for (const a of links) {
        const $a = $toc(a);
        const href = ($a.attr('href') || '').trim();
        if (!href) continue;

        const fullUrl = resolveHref(href, baseUrl, catalogUrl);
        const m = fullUrl.match(/\/Book\/Read\/(\d+),(\d+)/i);
        if (!m || m[1] !== bookId) continue;
        if (seen.has(fullUrl)) continue;
        seen.add(fullUrl);

        let title = ($a.text() || '').replace(/\s+/g, ' ').trim();
        if (!title) title = `第 ${m[2]} 章`;
        chapters.push({ title, url: fullUrl });
      }

      if (chapters.length > 0) {
        chapters.sort((a, b) => {
          const idA = parseInt(a.url.match(/\/Book\/Read\/\d+,(\d+)/i)?.[1] || '0', 10);
          const idB = parseInt(b.url.match(/\/Book\/Read\/\d+,(\d+)/i)?.[1] || '0', 10);
          return idA - idB;
        });
        console.log(`✓ 黃金屋目錄抓取成功，共 ${chapters.length} 章`);
        return chapters;
      }
    } catch (error) {
      console.log('黃金屋目錄抓取失敗（不影響主流程）:', error);
    }
  }

  // 稷下書院 / twword.com
  if (urlLower.includes('twword.com')) {
    try {
      // 嘗試從當前頁面找到目錄鏈接
      let tocUrl: string | undefined;
      
      // 查找目錄鏈接
      const tocLinks = $('a').toArray();
      for (const link of tocLinks) {
        const $link = $(link);
        const text = $link.text().trim().toLowerCase();
        const href = $link.attr('href');
        if (href && (text.includes('目錄') || text.includes('章節目錄') || text.includes('章節列表'))) {
          if (href.startsWith('http')) {
            tocUrl = href;
          } else if (href.startsWith('/')) {
            tocUrl = baseUrl + href;
          } else {
            try {
              tocUrl = new URL(href, url).href;
            } catch {
              tocUrl = baseUrl + href;
            }
          }
          console.log('找到目錄鏈接:', tocUrl);
          break;
        }
      }
      
      // 如果沒找到目錄鏈接，嘗試從 URL 推斷目錄頁
      if (!tocUrl) {
        // 例如：https://look.twword.com/0315678038/8096_180.html -> https://look.twword.com/0315678038/
        const urlMatch = url.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
        if (urlMatch) {
          const [, bookId] = urlMatch;
          tocUrl = `${baseUrl}/${bookId}/`;
          console.log('從 URL 推斷目錄頁:', tocUrl);
        }
      }
      
      if (tocUrl) {
        // 抓取目錄頁
        const response = await fetch(tocUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
          }
        });
        
        if (response.ok) {
          const html = await response.text();
          const $toc = cheerio.load(html);
          
          // 提取章節列表
          const chapters: ChapterItem[] = [];
          
          // 嘗試多種選擇器
          const selectors = [
            'a[href*=".html"]',
            '.chapter-list a',
            '.chapter-item a',
            'ul.chapter-list a',
            'div.chapter-list a'
          ];
          
          for (const selector of selectors) {
            const links = $toc(selector).toArray();
            if (links.length > 0) {
              for (const link of links) {
                const $link = $toc(link);
                const href = $link.attr('href');
                const title = $link.text().trim();
                
                if (href && title && href.includes('.html')) {
                  let fullUrl: string;
                  if (href.startsWith('http')) {
                    fullUrl = href;
                  } else if (href.startsWith('/')) {
                    fullUrl = baseUrl + href;
                  } else {
                    try {
                      fullUrl = new URL(href, tocUrl).href;
                    } catch {
                      fullUrl = baseUrl + href;
                    }
                  }
                  
                  // 過濾非章節鏈接
                  // 只保留符合章節URL模式的鏈接（例如：/0315678038/8096_XXX.html）
                  const urlMatch = fullUrl.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
                  if (!urlMatch) {
                    continue; // 跳過不符合章節URL模式的鏈接
                  }
                  
                  // 過濾掉明顯不是章節的標題
                  const titleLower = title.toLowerCase();
                  const excludeKeywords = ['排行榜', '登陸', '登錄', '登入', '註冊', '註冊', '首頁', 'home', 'ranking', 'login', 'signin', 'signup', 'register', '關於', 'about', '聯繫', 'contact'];
                  if (excludeKeywords.some(keyword => titleLower.includes(keyword.toLowerCase()))) {
                    continue;
                  }
                  
                  // 避免重複
                  if (!chapters.find(ch => ch.url === fullUrl)) {
                    chapters.push({ title, url: fullUrl });
                  }
                }
              }
              
              if (chapters.length > 0) {
                // 按章節號排序
                chapters.sort((a, b) => {
                  const matchA = a.url.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
                  const matchB = b.url.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
                  if (matchA && matchB) {
                    const numA = parseInt(matchA[3], 10);
                    const numB = parseInt(matchB[3], 10);
                    return numA - numB;
                  }
                  return 0;
                });
                
                console.log(`從目錄頁提取到 ${chapters.length} 個章節`);
                return chapters;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('提取目錄失敗:', error);
    }
  }
  
  return undefined;
};

const extractContent = ($: cheerio.CheerioAPI, url: string): NovelResult | null => {
  const urlLower = url.toLowerCase();

  if (urlLower.includes('fanqienovel.com') || urlLower.includes('fanqie')) {
    const title = $('h1.chapter-title, .chapter-title, h1').first().text().trim() ||
      $('title').text().trim();
    const content = $('.chapter-content, .content, #chaptercontent, .chapter-body')
      .first()
      .find('p, div')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(text => text.length > 0)
      .join('\n\n');
    if (content.length > 100) {
      const nextChapterUrl = extractNextChapterUrl($, url);
      return { title, content, sourceUrl: url, nextChapterUrl };
    }
  }

  if (urlLower.includes('qidian.com')) {
    const title = $('h1.chapter-title, .chapter-title, h1').first().text().trim() ||
      $('title').text().trim();
    const content = $('.chapter-content, .content, .read-content, .chapter-body')
      .first()
      .find('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(text => text.length > 0)
      .join('\n\n');
    if (content.length > 100) {
      const nextChapterUrl = extractNextChapterUrl($, url);
      return { title, content, sourceUrl: url, nextChapterUrl };
    }
  }

  if (urlLower.includes('jjwxc.net') || urlLower.includes('jjwxc')) {
    const title = $('h1, .novel-title, .chapter-title').first().text().trim() ||
      $('title').text().trim();
    const content = $('.noveltext, .content, #noveltext, .chapter-content')
      .first()
      .find('p, div')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(text => text.length > 0 && !text.includes('晉江'))
      .join('\n\n');
    if (content.length > 100) {
      const nextChapterUrl = extractNextChapterUrl($, url);
      return { title, content, sourceUrl: url, nextChapterUrl };
    }
  }

  if (urlLower.includes('zongheng.com')) {
    const title = $('h1, .chapter-title').first().text().trim() ||
      $('title').text().trim();
    const content = $('.content, .chapter-content, .read-content')
      .first()
      .find('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(text => text.length > 0)
      .join('\n\n');
    if (content.length > 100) {
      const nextChapterUrl = extractNextChapterUrl($, url);
      const prevChapterUrl = extractPrevChapterUrl($, url);
      return { title, content, sourceUrl: url, nextChapterUrl, prevChapterUrl };
    }
  }

  if (urlLower.includes('hjwzw.com')) {
    const $main = $('div[style*="750px"]').first();
    if ($main.length > 0) {
      const title = $('h1, .chapter-title, .title').first().text().trim() || $('title').text().trim();
      const content = $main
        .find('p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(t => t.length > 5 && !t.includes('請記住本站域名'))
        .join('\n\n');
      if (content.length > 100) {
        const nextChapterUrl = extractNextChapterUrl($, url);
        const prevChapterUrl = extractPrevChapterUrl($, url);
        return { title, content, sourceUrl: url, nextChapterUrl, prevChapterUrl };
      }
    }
  }

  if (urlLower.includes('twword.com')) {
    const title = $('.chapter-content h1').first().text().trim() ||
      $('h1').first().text().trim() ||
      $('title').text().trim();
    const $content = $('.chapter-content .content').first();
    
    // 先提取下一章和上一章链接（无论内容是否足够）
    const nextChapterUrl = extractNextChapterUrl($, url);
    const prevChapterUrl = extractPrevChapterUrl($, url);
    console.log('twword.com 提取到的下一章链接:', nextChapterUrl);
    console.log('twword.com 提取到的上一章链接:', prevChapterUrl);
    
    if ($content.length > 0) {
      $content.find('.gadBlock, .adBlock, ins, script, iframe, ad').remove();
      const content = $content
        .find('p')
        .map((_, el) => $(el).text().trim())
        .get()
.filter(text => {
          if (text.length === 0) return false;
          if (text.includes('溫馨提示')) return false;
          if (text.includes('應廣大讀者的要求') || text.includes('現推出VIP會員免廣告') || text.includes('VIP會員免廣告功能')) return false;
          return true;
        })
        .join('\n\n');
      if (content.length > 100) {
        return { title, content, sourceUrl: url, nextChapterUrl, prevChapterUrl };
      }
    }

    // 即使内容不够，也返回结果（包含下一章和上一章链接）
    if (nextChapterUrl || prevChapterUrl) {
      return { 
        title, 
        content: '', 
        sourceUrl: url, 
        nextChapterUrl,
        prevChapterUrl
      };
    }
  }

  const commonSelectors = [
    '.chapter-content',
    '.content',
    '#chaptercontent',
    '.chapter-body',
    '.read-content',
    'article',
    '.noveltext',
    '#noveltext',
    '.text-content'
  ];

  for (const selector of commonSelectors) {
    const $content = $(selector).first();
    if ($content.length > 0) {
      const title = $('h1, .chapter-title, .title').first().text().trim() ||
        $('title').text().trim();
      const content = $content
        .find('p, div')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => {
          const textLower = text.toLowerCase();
          return text.length > 10 &&
            !textLower.includes('copyright') &&
            !textLower.includes('版權') &&
            !textLower.includes('本章完') &&
            !textLower.includes('下一章');
        })
        .join('\n\n');
      if (content.length > 200) {
        const nextChapterUrl = extractNextChapterUrl($, url);
        const prevChapterUrl = extractPrevChapterUrl($, url);
        return { title, content, sourceUrl: url, nextChapterUrl, prevChapterUrl };
      }
    }
  }

  const title = $('h1, .chapter-title, .title').first().text().trim() ||
    $('title').text().trim();
  const paragraphs = $('p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(text => {
      const textLower = text.toLowerCase();
      return text.length > 20 &&
        !textLower.includes('copyright') &&
        !textLower.includes('版權') &&
        !textLower.includes('廣告') &&
        !textLower.includes('advertisement');
    });

  if (paragraphs.length > 3) {
    const content = paragraphs.join('\n\n');
    if (content.length > 200) {
      const nextChapterUrl = extractNextChapterUrl($, url);
      const prevChapterUrl = extractPrevChapterUrl($, url);
      return { title, content, sourceUrl: url, nextChapterUrl, prevChapterUrl };
    }
  }

  return null;
};

const fetchWithPuppeteer = async (url: string): Promise<NovelResult> => {
  const chromium = (await import('@sparticuz/chromium')).default as any;
  const puppeteer = (await import('puppeteer-core')).default as any;

  let browser: any = null;
  try {
    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath || undefined,
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    const html = await page.content();
    const $ = cheerio.load(html);

    const result = extractContent($, url);
    if (result && result.content.length >= 200) {
      // 確保返回結果包含下一章和上一章鏈接（即使 extractContent 沒有提取到）
      if (!result.nextChapterUrl) {
        // 如果沒有下一章鏈接，嘗試再次提取
        const nextChapterUrl = extractNextChapterUrl($, url);
        if (nextChapterUrl) {
          console.log(`✓ 從 Puppeteer HTML 中提取到下一章鏈接: ${nextChapterUrl}`);
          result.nextChapterUrl = nextChapterUrl;
        }
      }
      if (!result.prevChapterUrl) {
        // 如果沒有上一章鏈接，嘗試再次提取
        const prevChapterUrl = extractPrevChapterUrl($, url);
        if (prevChapterUrl) {
          console.log(`✓ 從 Puppeteer HTML 中提取到上一章鏈接: ${prevChapterUrl}`);
          result.prevChapterUrl = prevChapterUrl;
        }
      }
      
      // 提取目錄
      try {
        const chapters = await extractChapters($, url);
        if (chapters && chapters.length > 0) {
          result.chapters = chapters;
          console.log(`✓ 成功提取目錄，共 ${chapters.length} 個章節`);
        }
      } catch (error) {
        console.log('提取目錄失敗（不影響主流程）:', error);
      }
      
      const processed = postProcessResult(result, url);
      console.log(`✓ 成功抓取完整內容：標題「${processed.title}」，內容長度 ${processed.content.length} 字，下一章: ${processed.nextChapterUrl || '無'}，上一章: ${processed.prevChapterUrl || '無'}`);
      return processed;
    }

    throw new Error(`無法從網頁中提取足夠的小說內容（僅提取到 ${result?.content.length || 0} 字，可能是摘要或抓取失敗）`);
  } catch (error: any) {
    throw new Error(`Puppeteer 啟動或抓取失敗：${error?.message || '未知錯誤'}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

const fetchWithCheerio = async (url: string): Promise<NovelResult> => {
  // 起點桌面版常被反爬，優先改抓手機版
  const effectiveUrl = isQidianUrl(url) ? toQidianMobileChapterUrl(url) : url;
  const isQidianMobile = (() => {
    try {
      return new URL(effectiveUrl).hostname === 'm.qidian.com';
    } catch {
      return false;
    }
  })();

  const response = await fetch(effectiveUrl, {
    headers: {
      'User-Agent': isQidianMobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP 錯誤: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const result = extractContent($, effectiveUrl);
  if (!result || result.content.length < 200) {
    throw new Error(`無法從網頁中提取足夠的小說內容（僅提取到 ${result?.content.length || 0} 字，可能是摘要或抓取失敗）`);
  }
  
  // 提取目錄
  try {
    const chapters = await extractChapters($, effectiveUrl);
    if (chapters && chapters.length > 0) {
      result.chapters = chapters;
    }
  } catch (error) {
    console.log('提取目錄失敗（不影響主流程）:', error);
  }
  
  return postProcessResult(result, effectiveUrl);
};

export const fetchNovelFromUrl = async (url: string, currentTitle?: string): Promise<NovelResult> => {
  try {
    // 起點：直接抓手機版（避免桌面版 202 探針頁）
    if (isQidianUrl(url)) {
      const mobileUrl = toQidianMobileChapterUrl(url);
      const response = await fetch(mobileUrl, {
        headers: {
          // 用行動裝置 UA，回到含正文的 HTML
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          'Referer': 'https://m.qidian.com/',
        },
      });
      if (!response.ok) throw new Error(`HTTP 錯誤: ${response.status}`);

      const html = await response.text();
      const $ = cheerio.load(html);

      const title = $('h1').first().text().trim() || $('title').text().trim();
      const paragraphs = $('main p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(t => t.length > 0);
      const content = paragraphs.join('\n\n');
      if (content.length < 200) {
        throw new Error(`無法從網頁中提取足夠的小說內容（僅提取到 ${content.length} 字，可能是摘要或抓取失敗）`);
      }

      const nextChapterUrl = extractNextChapterUrl($, mobileUrl);
      const prevChapterUrl = extractPrevChapterUrl($, mobileUrl);
      let chapters: ChapterItem[] | undefined;
      try {
        chapters = await extractChapters($, mobileUrl);
      } catch (e) {
        // ignore
      }
      const processed = postProcessResult(
        { title, content, sourceUrl: url, nextChapterUrl, prevChapterUrl, chapters },
        mobileUrl
      );
      return processed;
    }

    if (!needsPuppeteer(url)) {
      try {
        return await fetchWithCheerio(url);
      } catch (error) {
        console.log('Cheerio 抓取失敗，嘗試使用 Puppeteer:', error);
      }
    }
    return await fetchWithPuppeteer(url);
  } catch (error: any) {
    throw new Error(`抓取失敗: ${error.message}`);
  }
};
