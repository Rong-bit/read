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

const needsPuppeteer = (url: string): boolean => {
  const urlLower = url.toLowerCase();
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
    console.log(`找到 ${footNavLinks.length} 個底部導航鏈接`);
    for (const link of footNavLinks) {
      const $link = $(link);
      const text = $link.text().trim();
      const href = $link.attr('href');
      console.log(`檢查鏈接: 文字="${text}", href="${href}"`);
      if (text && (text.includes('下一章') || text.includes('下一頁'))) {
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

// 提取章節目錄
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
        return { title, content, sourceUrl: url, nextChapterUrl };
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
        .filter(text => text.length > 0 && !text.includes('溫馨提示'))
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
      
      console.log(`✓ 成功抓取完整內容：標題「${result.title}」，內容長度 ${result.content.length} 字，下一章: ${result.nextChapterUrl || '無'}，上一章: ${result.prevChapterUrl || '無'}`);
      return result;
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
  
  // 提取目錄
  try {
    const chapters = await extractChapters($, url);
    if (chapters && chapters.length > 0) {
      result.chapters = chapters;
    }
  } catch (error) {
    console.log('提取目錄失敗（不影響主流程）:', error);
  }
  
  return result;
};

export const fetchNovelFromUrl = async (url: string, currentTitle?: string): Promise<NovelResult> => {
  try {
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
