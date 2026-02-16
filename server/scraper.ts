import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

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
  chapters?: ChapterItem[];
}

// 判斷是否需要使用 Puppeteer（JavaScript 渲染）
const needsPuppeteer = (url: string): boolean => {
  const urlLower = url.toLowerCase();
  // 大部分小說網站都是靜態 HTML，但有些可能需要 JS
  return urlLower.includes('qidian.com') || urlLower.includes('webnovel.com');
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
        if (nextUrl.startsWith('http')) return nextUrl;
        if (nextUrl.startsWith('/')) return baseUrl + nextUrl;
        try {
          return new URL(nextUrl, url).href;
        } catch {
          return baseUrl + nextUrl;
        }
      }
    }
    
    // 从底部导航中提取
    const footNavLinks = $('.foot-nav a').toArray();
    for (const link of footNavLinks) {
      const $link = $(link);
      const text = $link.text().trim();
      if (text.includes('下一章') || text.includes('下一頁')) {
        const href = $link.attr('href');
        if (href) {
          console.log('從底部導航提取到下一章:', href);
          if (href.startsWith('http')) return href;
          if (href.startsWith('/')) return baseUrl + href;
          try {
            return new URL(href, url).href;
          } catch {
            return baseUrl + href;
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
      if (nextBtnLink.startsWith('http')) return nextBtnLink;
      if (nextBtnLink.startsWith('/')) return baseUrl + nextBtnLink;
      return new URL(nextBtnLink, url).href;
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
  const commonNextSelectors = [
    'a:contains("下一章")',
    'a:contains("下一頁")',
    'a:contains("下一页")',
    'a:contains("Next")',
    'a.next',
    'a.next-chapter',
    '.next-chapter a',
    '.nextBtn a',
    '.nextBtn'
  ];
  
  for (const selector of commonNextSelectors) {
    try {
      const $link = $(selector).first();
      if ($link.length > 0) {
        const href = $link.attr('href') || $link.find('a').attr('href');
        if (href && !href.includes('javascript:') && !href.includes('#')) {
          if (href.startsWith('http')) return href;
          if (href.startsWith('/')) return baseUrl + href;
          return new URL(href, url).href;
        }
      }
    } catch (e) {
      // 某些选择器可能不支持，继续尝试下一个
      continue;
    }
  }
  
  // 从文本内容中查找链接
  const allLinks = $('a').toArray();
  for (const link of allLinks) {
    const $link = $(link);
    const text = $link.text().trim().toLowerCase();
    const href = $link.attr('href');
    if (href && (text.includes('下一章') || text.includes('下一頁') || text.includes('下一页'))) {
      console.log('從通用鏈接提取到下一章:', href);
      if (href.startsWith('http')) return href;
      if (href.startsWith('/')) return baseUrl + href;
      try {
        return new URL(href, url).href;
      } catch {
        return baseUrl + href;
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
  
  // 稷下書院 / twword.com - 从脚本变量中提取
  if (urlLower.includes('twword.com')) {
    const scripts = $('script').toArray();
    for (const script of scripts) {
      const scriptText = $(script).html() || $(script).text() || '';
      let prevUrlMatch = scriptText.match(/var\s+prevUrl\s*=\s*['"]([^'"]+)['"]/);
      if (!prevUrlMatch) {
        prevUrlMatch = scriptText.match(/prevUrl\s*=\s*['"]([^'"]+)['"]/);
      }
      if (!prevUrlMatch) {
        prevUrlMatch = scriptText.match(/["']prevUrl["']\s*:\s*["']([^"']+)["']/);
      }
      if (prevUrlMatch && prevUrlMatch[1]) {
        const prevUrl = prevUrlMatch[1];
        console.log('從腳本變量提取到上一章:', prevUrl);
        if (prevUrl.startsWith('http')) return prevUrl;
        if (prevUrl.startsWith('/')) return baseUrl + prevUrl;
        try {
          return new URL(prevUrl, url).href;
        } catch {
          return baseUrl + prevUrl;
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
          if (href.startsWith('http')) return href;
          if (href.startsWith('/')) return baseUrl + href;
          try {
            return new URL(href, url).href;
          } catch {
            return baseUrl + href;
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
      if (prevBtnLink.startsWith('http')) return prevBtnLink;
      if (prevBtnLink.startsWith('/')) return baseUrl + prevBtnLink;
      return new URL(prevBtnLink, url).href;
    }
    
    // URL 模式推断上一章（最後手段）
    console.log('嘗試從 URL 模式推斷上一章...');
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
  
  // 通用提取：查找包含"上一章"、"上一頁"等文字的链接
  const allLinks = $('a').toArray();
  for (const link of allLinks) {
    const $link = $(link);
    const text = $link.text().trim().toLowerCase();
    const href = $link.attr('href');
    if (href && (text.includes('上一章') || text.includes('上一頁') || text.includes('上一页'))) {
      console.log('從通用鏈接提取到上一章:', href);
      if (href.startsWith('http')) return href;
      if (href.startsWith('/')) return baseUrl + href;
      try {
        return new URL(href, url).href;
      } catch {
        return baseUrl + href;
      }
    }
  }
  
  console.log('未找到上一章鏈接');
  return undefined;
};

// 提取章節目錄（目前支援 twword.com / zongheng.com）
const extractChapters = async ($: cheerio.CheerioAPI, url: string): Promise<ChapterItem[] | undefined> => {
  const urlLower = url.toLowerCase();
  let baseUrl: string;
  try {
    baseUrl = new URL(url).origin;
  } catch {
    return undefined;
  }

  // 稷下書院 / twword.com
  if (urlLower.includes('twword.com')) {
    try {
      let tocUrl: string | undefined;

      // 查找目錄鏈接
      const tocLinks = $('a').toArray();
      for (const link of tocLinks) {
        const $link = $(link);
        const text = $link.text().trim().toLowerCase();
        const href = $link.attr('href');
        if (href && (text.includes('目錄') || text.includes('章節目錄') || text.includes('章節列表'))) {
          if (href.startsWith('http')) tocUrl = href;
          else if (href.startsWith('/')) tocUrl = baseUrl + href;
          else {
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
        const urlMatch = url.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
        if (urlMatch) {
          const [, bookId] = urlMatch;
          tocUrl = `${baseUrl}/${bookId}/`;
          console.log('從 URL 推斷目錄頁:', tocUrl);
        }
      }

      if (!tocUrl) return undefined;

      const response = await fetch(tocUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        }
      });

      if (!response.ok) return undefined;
      const html = await response.text();
      const $toc = cheerio.load(html);

      const chapters: ChapterItem[] = [];
      const selectors = [
        'a[href*=".html"]',
        '.chapter-list a',
        '.chapter-item a',
        'ul.chapter-list a',
        'div.chapter-list a'
      ];

      for (const selector of selectors) {
        const links = $toc(selector).toArray();
        if (links.length === 0) continue;
        for (const link of links) {
          const $link = $toc(link);
          const href = $link.attr('href');
          const title = ($link.text() || '').trim();
          if (!href || !href.includes('.html') || !title) continue;

          let fullUrl: string;
          if (href.startsWith('http')) fullUrl = href;
          else if (href.startsWith('/')) fullUrl = baseUrl + href;
          else {
            try {
              fullUrl = new URL(href, tocUrl).href;
            } catch {
              fullUrl = baseUrl + href;
            }
          }

          // 過濾只保留符合章節URL模式的鏈接（例如：/0315678038/8096_XXX.html）
          if (!fullUrl.match(/\/(\d+)\/(\d+)_(\d+)\.html/)) continue;

          // 避免重複
          if (!chapters.find(ch => ch.url === fullUrl)) {
            chapters.push({ title, url: fullUrl });
          }
        }

        if (chapters.length > 0) {
          // 按章節號排序
          chapters.sort((a, b) => {
            const matchA = a.url.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
            const matchB = b.url.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
            if (matchA && matchB) return parseInt(matchA[3], 10) - parseInt(matchB[3], 10);
            return 0;
          });
          console.log(`從目錄頁提取到 ${chapters.length} 個章節`);
          return chapters;
        }
      }
    } catch (error) {
      console.error('提取目錄失敗:', error);
    }
  }

  // 縱橫中文網 zongheng.com / read.zongheng.com
  if (urlLower.includes('zongheng.com')) {
    try {
      const match = url.match(/\/chapter\/(\d+)\//);
      const bookId = match?.[1];
      if (!bookId) return undefined;

      const tocUrl = `https://www.zongheng.com/detail/${bookId}?tabsName=catalogue`;
      const response = await fetch(tocUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        }
      });
      if (!response.ok) return undefined;
      const html = await response.text();
      const $toc = cheerio.load(html);

      const chapters: ChapterItem[] = [];
      const linkEls = $toc(`a[href*="/chapter/${bookId}/"], a[href*="read.zongheng.com/chapter/${bookId}/"]`).toArray();
      for (const el of linkEls) {
        const $a = $toc(el);
        const rawHref = ($a.attr('href') || '').trim();
        if (!rawHref) continue;

        let fullUrl: string | null = null;
        if (rawHref.startsWith('//')) fullUrl = `https:${rawHref}`;
        else if (rawHref.startsWith('http')) fullUrl = rawHref;
        else if (rawHref.startsWith('/chapter/')) fullUrl = `https://read.zongheng.com${rawHref}`;
        else {
          try {
            fullUrl = new URL(rawHref, tocUrl).href;
          } catch {
            fullUrl = null;
          }
        }

        if (!fullUrl) continue;
        if (!fullUrl.includes(`/chapter/${bookId}/`)) continue;

        // 只收章節頁
        const m = fullUrl.match(/\/chapter\/\d+\/(\d+)\.html/);
        if (!m) continue;

        const title = (($a.text() || $a.attr('title') || '').trim());
        if (!title) continue;

        if (!chapters.find(ch => ch.url === fullUrl)) {
          chapters.push({ title, url: fullUrl.endsWith('?') ? fullUrl : fullUrl + (fullUrl.includes('?') ? '' : '?') });
        }
      }

      if (chapters.length > 0) {
        chapters.sort((a, b) => {
          const ma = a.url.match(/\/chapter\/\d+\/(\d+)\.html/);
          const mb = b.url.match(/\/chapter\/\d+\/(\d+)\.html/);
          if (ma && mb) return parseInt(ma[1], 10) - parseInt(mb[1], 10);
          return 0;
        });
        console.log(`✓ 成功提取縱橫目錄，共 ${chapters.length} 章`);
        return chapters;
      }
    } catch (error) {
      console.log('提取縱橫目錄失敗（不影響主流程）:', error);
    }
  }

  return undefined;
};

// 通用內容提取函數
const extractContent = ($: cheerio.CheerioAPI, url: string): NovelResult | null => {
  const urlLower = url.toLowerCase();
  
  // 番茄小說 (fanqienovel.com)
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
  
  // 起點中文網 (qidian.com)
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
  
  // 晉江文學城 (jjwxc.net)
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
  
  // 縱橫中文網 (zongheng.com)
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
  
  // 黃金屋 (hjwzw.com / tw.hjwzw.com)
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
        return { title, content, sourceUrl: url };
      }
    }
  }

  // 稷下書院 / twword.com (look.twword.com)
  if (urlLower.includes('twword.com')) {
    const title = $('.chapter-content h1').first().text().trim() ||
                  $('h1').first().text().trim() ||
                  $('title').text().trim();
    const $content = $('.chapter-content .content').first();
    
    // 先提取下一章 / 上一章链接（无论内容是否足够）
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
        .filter(text => text.length > 0 && !text.includes('溫馨提示'))
        .join('\n\n');
      if (content.length > 100) {
        return { title, content, sourceUrl: url, nextChapterUrl, prevChapterUrl };
      }
    }
    
    // 即使内容不够，也返回结果（包含上下章链接）
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

  // 通用提取：嘗試常見的內容選擇器
  console.log('開始通用內容提取...');
  const commonSelectors = [
    '.chapter-content',
    '.content',
    '#chaptercontent',
    '.chapter-body',
    '.read-content',
    'article',
    '.noveltext',
    '#noveltext',
    '.text-content',
    'main',
    '.main-content',
    '#main-content',
    '.post-content',
    '.entry-content'
  ];
  
  for (const selector of commonSelectors) {
    const $content = $(selector).first();
    if ($content.length > 0) {
      console.log(`嘗試通用選擇器 "${selector}"，找到元素`);
      
      // 移除廣告和無關元素
      $content.find('script, style, .ad, .advertisement, .ads, ins, iframe, .gadBlock, .adBlock').remove();
      
      const title = $('h1, .chapter-title, .title, .entry-title, .post-title').first().text().trim() || 
                    $('title').text().trim();
      
      // 先嘗試提取段落
      const paragraphs = $content
        .find('p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => {
          // 過濾掉明顯不是正文的內容
          const textLower = text.toLowerCase();
          return text.length > 10 && 
                 !textLower.includes('copyright') &&
                 !textLower.includes('版權') &&
                 !textLower.includes('本章完') &&
                 !textLower.includes('下一章') &&
                 !textLower.includes('廣告') &&
                 !textLower.includes('advertisement');
        });
      
      let content = '';
      if (paragraphs.length > 0) {
        content = paragraphs.join('\n\n');
        console.log(`從 "${selector}" 提取到 ${paragraphs.length} 個段落，內容長度: ${content.length}`);
      }
      
      // 如果段落提取失敗或內容太少，嘗試直接提取文本
      if (content.length < 200) {
        const directText = $content.text().trim();
        const lines = directText.split('\n')
          .map(line => line.trim())
          .filter(line => {
            const textLower = line.toLowerCase();
            return line.length > 20 && 
                   !textLower.includes('copyright') &&
                   !textLower.includes('版權') &&
                   !textLower.includes('廣告') &&
                   !textLower.includes('advertisement') &&
                   !textLower.includes('本章完') &&
                   !textLower.includes('下一章');
          });
        content = lines.join('\n\n');
        console.log(`從 "${selector}" 直接提取文本，內容長度: ${content.length}`);
      }
      
      if (content.length > 200) {
        const nextChapterUrl = extractNextChapterUrl($, url);
        const prevChapterUrl = extractPrevChapterUrl($, url);
        console.log(`✓ 通用提取成功：標題「${title}」，內容長度 ${content.length}`);
        return { title: title || '小說章節', content, sourceUrl: url, nextChapterUrl, prevChapterUrl };
      }
    }
  }
  
  // 最後嘗試：直接提取所有段落
  console.log('嘗試從所有段落提取內容...');
  const title = $('h1, .chapter-title, .title, .entry-title, .post-title').first().text().trim() || 
                $('title').text().trim();
  console.log('提取到的標題:', title || '(未找到)');
  
  // 移除無關元素
  $('script, style, .ad, .advertisement, .ads, ins, iframe, nav, header, footer').remove();
  
  const paragraphs = $('p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(text => {
      const textLower = text.toLowerCase();
      return text.length > 20 && 
             !textLower.includes('copyright') &&
             !textLower.includes('版權') &&
             !textLower.includes('廣告') &&
             !textLower.includes('advertisement') &&
             !textLower.includes('本章完') &&
             !textLower.includes('下一章');
    });
  
  console.log(`找到 ${paragraphs.length} 個有效段落`);
  
  if (paragraphs.length > 3) {
    const content = paragraphs.join('\n\n');
    if (content.length > 200) {
      const nextChapterUrl = extractNextChapterUrl($, url);
      const prevChapterUrl = extractPrevChapterUrl($, url);
      console.log(`✓ 從段落提取成功：標題「${title}」，內容長度 ${content.length}`);
      return { title: title || '小說章節', content, sourceUrl: url, nextChapterUrl, prevChapterUrl };
    }
  }
  
  // 如果還是沒有內容，至少返回標題和上下章鏈接（如果有）
  const nextChapterUrl = extractNextChapterUrl($, url);
  const prevChapterUrl = extractPrevChapterUrl($, url);
  if (title || nextChapterUrl || prevChapterUrl) {
    console.log('⚠️ 無法提取足夠內容，但返回標題和/或下一章鏈接');
    return {
      title: title || '小說章節',
      content: '',
      sourceUrl: url,
      nextChapterUrl,
      prevChapterUrl
    };
  }
  
  console.log('✗ 通用提取失敗，無法提取任何內容');
  return null;
};

// 使用 Puppeteer 抓取（處理 JavaScript 渲染）
const fetchWithPuppeteer = async (url: string): Promise<NovelResult> => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // 等待內容載入（Puppeteer v22+ 已移除 waitForTimeout，改用 Promise + setTimeout）
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const html = await page.content();
    const $ = cheerio.load(html);
    
    const result = extractContent($, url);
    if (result && result.content.length >= 200) {
      // 確保返回結果包含下一章鏈接（即使 extractContent 沒有提取到）
      if (!result.nextChapterUrl) {
        // 如果沒有下一章鏈接，嘗試再次提取
        const nextChapterUrl = extractNextChapterUrl($, url);
        if (nextChapterUrl) {
          console.log(`✓ 從 Puppeteer HTML 中提取到下一章鏈接: ${nextChapterUrl}`);
          result.nextChapterUrl = nextChapterUrl;
        }
      }
      // 確保返回結果包含上一章鏈接
      if (!result.prevChapterUrl) {
        const prevChapterUrl = extractPrevChapterUrl($, url);
        if (prevChapterUrl) {
          console.log(`✓ 從 Puppeteer HTML 中提取到上一章鏈接: ${prevChapterUrl}`);
          result.prevChapterUrl = prevChapterUrl;
        }
      }

      // 提取目錄（不影響主流程）
      try {
        const chapters = await extractChapters($, url);
        if (chapters && chapters.length > 0) {
          result.chapters = chapters;
        }
      } catch (error) {
        console.log('提取目錄失敗（不影響主流程）:', error);
      }
      // 記錄抓取的內容長度（用於調試）
      console.log(`✓ 成功抓取完整內容：標題「${result.title}」，內容長度 ${result.content.length} 字，下一章: ${result.nextChapterUrl || '無'}，上一章: ${result.prevChapterUrl || '無'}`);
      return result;
    }
    
    throw new Error(`無法從網頁中提取足夠的小說內容（僅提取到 ${result?.content.length || 0} 字，可能是摘要或抓取失敗）`);
  } catch (error: any) {
    // 如果 Puppeteer 失敗，嘗試從 Cheerio 獲取的 HTML 中至少提取下一章鏈接
    try {
      console.log('Puppeteer 失敗，嘗試從 Cheerio 獲取的 HTML 中提取下一章鏈接...');
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
        }
      });
      
      if (response.ok) {
        const html = await response.text();
        const $ = cheerio.load(html);
        const nextChapterUrl = extractNextChapterUrl($, url);
        const prevChapterUrl = extractPrevChapterUrl($, url);
        
        if (nextChapterUrl || prevChapterUrl) {
          // 嘗試從 URL 中提取章節號作為標題
          const urlMatch = url.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
          const title = urlMatch ? `第${urlMatch[3]}章` : $('title').text().trim() || '小說章節';
          
          if (nextChapterUrl) console.log(`✓ 從 Cheerio HTML 中提取到下一章鏈接: ${nextChapterUrl}`);
          if (prevChapterUrl) console.log(`✓ 從 Cheerio HTML 中提取到上一章鏈接: ${prevChapterUrl}`);
          return {
            title,
            content: '',
            sourceUrl: url,
            nextChapterUrl,
            prevChapterUrl
          };
        }
      }
    } catch (fallbackError: any) {
      console.log('備用提取也失敗:', fallbackError.message);
    }
    
    // 重新拋出原始錯誤
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

// 使用 fetch + cheerio 抓取（靜態 HTML）
// 參考可工作版本的簡單實現
const fetchWithCheerio = async (url: string): Promise<NovelResult> => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP 錯誤: ${response.status}`);
  }
  
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const result = extractContent($, url);
  if (!result || result.content.length < 200) {
    throw new Error(`無法從網頁中提取足夠的小說內容（僅提取到 ${result?.content.length || 0} 字，可能是摘要或抓取失敗）`);
  }
  
  // 提取目錄（不影響主流程）
  try {
    const chapters = await extractChapters($, url);
    if (chapters && chapters.length > 0) {
      result.chapters = chapters;
    }
  } catch (error) {
    console.log('提取目錄失敗（不影響主流程）:', error);
  }

  // 記錄抓取的內容長度（用於調試）
  console.log(`✓ 成功抓取完整內容：標題「${result.title}」，內容長度 ${result.content.length} 字`);
  
  return result;
};

// 主函數：根據 URL 決定使用哪種方式抓取
export const fetchNovelFromUrl = async (
  url: string, 
  currentTitle?: string
): Promise<NovelResult> => {
  try {
    // 先嘗試使用 cheerio（更快）
    if (!needsPuppeteer(url)) {
      try {
        return await fetchWithCheerio(url);
      } catch (error) {
        console.log('Cheerio 抓取失敗，嘗試使用 Puppeteer:', error);
        // 如果失敗，降級到 Puppeteer
      }
    }
    
    // 使用 Puppeteer 抓取
    return await fetchWithPuppeteer(url);
  } catch (error: any) {
    throw new Error(`抓取失敗: ${error.message}`);
  }
};
