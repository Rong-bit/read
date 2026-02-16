import * as cheerio from 'cheerio';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error opencc-js 無型別宣告
import * as OpenCC from 'opencc-js';

const s2tConverter = OpenCC.Converter({ from: 'cn', to: 'tw' });
const isLikelySimplified = (text: string): boolean =>
  /[国语这说们会时发无为经过还与来对]/u.test(text);
const toTraditional = (text: string): string => s2tConverter(text);

// 清理正文中被「當成文字」插入的廣告/樣式/腳本片段（例如 ttks.tw 章節頁）
const looksLikeInjectedCodeLine = (line: string, urlLower: string): boolean => {
  const t = line.trim();
  if (!t) return false;
  const tl = t.toLowerCase();

  if (/^loadadv\(\s*\d+\s*,\s*\d+\s*\)\s*;?$/i.test(t)) return true;
  if (tl.includes('.bg-container-') || tl.includes('.bg-ssp-')) return true;
  if (tl.includes('z-index: 2147483647')) return true;

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
      if (emptyStreak <= 2) out.push('');
      continue;
    }

    emptyStreak = 0;

    if (looksLikeInjectedCodeLine(trimmed, urlLower)) continue;
    if (trimmed === prevNonEmpty) continue;

    out.push(trimmed);
    prevNonEmpty = trimmed;
  }

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

const applySimplifiedToTraditional = (result: NovelResult): NovelResult => {
  if (!result.content || !isLikelySimplified(result.content)) return result;
  return {
    ...result,
    title: toTraditional(result.title),
    content: toTraditional(result.content),
  };
};

export interface NovelResult {
  title: string;
  content: string;
  sourceUrl?: string;
  nextChapterUrl?: string;
  prevChapterUrl?: string;
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
  if (u.hostname === 'm.qidian.com') return u.toString();
  if (u.hostname.endsWith('qidian.com') && u.pathname.startsWith('/chapter/')) {
    const mobile = new URL(`https://m.qidian.com${u.pathname}`);
    mobile.search = u.search;
    mobile.hash = u.hash;
    return mobile.toString();
  }
  if (u.hostname.endsWith('qidian.com')) {
    const mobile = new URL(`https://m.qidian.com${u.pathname}`);
    mobile.search = u.search;
    mobile.hash = u.hash;
    return mobile.toString();
  }
  return input;
};

// 判斷是否需要使用 Puppeteer（JavaScript 渲染）
const needsPuppeteer = (url: string): boolean => {
  const urlLower = url.toLowerCase();
  // 大部分小說網站都是靜態 HTML，但有些可能需要 JS
  // 起點桌面版常回 202 探針頁（反爬），改抓 m.qidian.com 不需要 Puppeteer
  return urlLower.includes('webnovel.com');
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
      return { title, content, sourceUrl: url, nextChapterUrl };
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
    
    // 先提取下一章链接（无论内容是否足够）
    const nextChapterUrl = extractNextChapterUrl($, url);
    console.log('twword.com 提取到的下一章链接:', nextChapterUrl);
    
    if ($content.length > 0) {
      $content.find('.gadBlock, .adBlock, ins, script, iframe, ad').remove();
      const content = $content
        .find('p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => text.length > 0 && !text.includes('溫馨提示'))
        .join('\n\n');
      if (content.length > 100) {
        return { title, content, sourceUrl: url, nextChapterUrl };
      }
    }
    
    // 即使内容不够，也返回结果（包含下一章链接）
    if (nextChapterUrl) {
      return { 
        title, 
        content: '', 
        sourceUrl: url, 
        nextChapterUrl 
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
        console.log(`✓ 通用提取成功：標題「${title}」，內容長度 ${content.length}`);
        return { title: title || '小說章節', content, sourceUrl: url, nextChapterUrl };
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
      console.log(`✓ 從段落提取成功：標題「${title}」，內容長度 ${content.length}`);
      return { title: title || '小說章節', content, sourceUrl: url, nextChapterUrl };
    }
  }
  
  // 如果還是沒有內容，至少返回標題和下一章鏈接（如果有）
  const nextChapterUrl = extractNextChapterUrl($, url);
  if (title || nextChapterUrl) {
    console.log('⚠️ 無法提取足夠內容，但返回標題和/或下一章鏈接');
    return {
      title: title || '小說章節',
      content: '',
      sourceUrl: url,
      nextChapterUrl
    };
  }
  
  console.log('✗ 通用提取失敗，無法提取任何內容');
  return null;
};

// 使用 Puppeteer 抓取（處理 JavaScript 渲染）
const fetchWithPuppeteer = async (url: string): Promise<NovelResult> => {
  const chromium = (await import('@sparticuz/chromium')).default as any;
  const puppeteer = (await import('puppeteer-core')).default as any;

  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: executablePath || undefined,
    headless: chromium.headless,
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
      // 記錄抓取的內容長度（用於調試）
      console.log(`✓ 成功抓取完整內容：標題「${result.title}」，內容長度 ${result.content.length} 字，下一章: ${result.nextChapterUrl || '無'}`);
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
        
        if (nextChapterUrl) {
          // 嘗試從 URL 中提取章節號作為標題
          const urlMatch = url.match(/\/(\d+)\/(\d+)_(\d+)\.html/);
          const title = urlMatch ? `第${urlMatch[3]}章` : $('title').text().trim() || '小說章節';
          
          console.log(`✓ 從 Cheerio HTML 中提取到下一章鏈接: ${nextChapterUrl}`);
          return {
            title,
            content: '',
            sourceUrl: url,
            nextChapterUrl
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
    // 起點：直接抓手機版（避免桌面版 202 探針頁）
    if (isQidianUrl(url)) {
      const mobileUrl = toQidianMobileChapterUrl(url);
      const response = await fetch(mobileUrl, {
        headers: {
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

      const pathMatch = mobileUrl.match(/\/chapter\/(\d+)\/(\d+)\//);
      const bookId = pathMatch?.[1];
      const scriptsText = $('script')
        .toArray()
        .map(s => ($(s).html() || $(s).text() || '').toString())
        .join('\n');
      const nextIdMatch =
        scriptsText.match(/"next"\s*:\s*(\d{6,})/) ||
        scriptsText.match(/\bnext\s*[:=]\s*(\d{6,})/);
      const prevIdMatch =
        scriptsText.match(/"prev"\s*:\s*(\d{6,})/) ||
        scriptsText.match(/\bprev\s*[:=]\s*(\d{6,})/);

      const nextHref =
        $('a')
          .toArray()
          .map(a => ({ t: $(a).text().trim(), h: $(a).attr('href') }))
          .find(x => x.h && x.t.includes('下一章'))?.h || undefined;

      let nextChapterUrl = nextHref
        ? (nextHref.startsWith('//')
            ? `https:${nextHref}`
            : new URL(nextHref, mobileUrl).href)
        : undefined;

      if (!nextChapterUrl && bookId && nextIdMatch?.[1]) {
        nextChapterUrl = `https://m.qidian.com/chapter/${bookId}/${nextIdMatch[1]}/`;
      }

      const prevChapterUrl =
        bookId && prevIdMatch?.[1] ? `https://m.qidian.com/chapter/${bookId}/${prevIdMatch[1]}/` : undefined;

      // 先清理垃圾行，再做簡轉繁（避免把垃圾行也「轉換」成正文的一部分）
      return applySimplifiedToTraditional(
        postProcessResult({ title, content, sourceUrl: url, nextChapterUrl, prevChapterUrl }, mobileUrl)
      );
    }

    let result: NovelResult;
    if (!needsPuppeteer(url)) {
      try {
        result = await fetchWithCheerio(url);
      } catch (error) {
        console.log('Cheerio 抓取失敗，嘗試使用 Puppeteer:', error);
        result = await fetchWithPuppeteer(url);
      }
    } else {
      result = await fetchWithPuppeteer(url);
    }
    // 先清理垃圾行，再做簡轉繁（避免把垃圾行也「轉換」成正文的一部分）
    return applySimplifiedToTraditional(postProcessResult(result, url));
  } catch (error: any) {
    throw new Error(`抓取失敗: ${error.message}`);
  }
};
