import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

export interface NovelResult {
  title: string;
  content: string;
  sourceUrl?: string;
}

// 判斷是否需要使用 Puppeteer（JavaScript 渲染）
const needsPuppeteer = (url: string): boolean => {
  const urlLower = url.toLowerCase();
  // 大部分小說網站都是靜態 HTML，但有些可能需要 JS
  return urlLower.includes('qidian.com') || urlLower.includes('webnovel.com');
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
      return { title, content, sourceUrl: url };
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
      return { title, content, sourceUrl: url };
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
      return { title, content, sourceUrl: url };
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
      return { title, content, sourceUrl: url };
    }
  }
  
  // 通用提取：嘗試常見的內容選擇器
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
          // 過濾掉明顯不是正文的內容
          const textLower = text.toLowerCase();
          return text.length > 10 && 
                 !textLower.includes('copyright') &&
                 !textLower.includes('版權') &&
                 !textLower.includes('本章完') &&
                 !textLower.includes('下一章');
        })
        .join('\n\n');
      
      if (content.length > 200) {
        return { title, content, sourceUrl: url };
      }
    }
  }
  
  // 最後嘗試：直接提取所有段落
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
      return { title, content, sourceUrl: url };
    }
  }
  
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
    
    // 等待內容載入
    await page.waitForTimeout(2000);
    
    const html = await page.content();
    const $ = cheerio.load(html);
    
    const result = extractContent($, url);
    if (result && result.content.length >= 200) {
      // 記錄抓取的內容長度（用於調試）
      console.log(`✓ 成功抓取完整內容：標題「${result.title}」，內容長度 ${result.content.length} 字`);
      return result;
    }
    
    throw new Error(`無法從網頁中提取足夠的小說內容（僅提取到 ${result?.content.length || 0} 字，可能是摘要或抓取失敗）`);
  } finally {
    await browser.close();
  }
};

// 使用 fetch + cheerio 抓取（靜態 HTML）
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
