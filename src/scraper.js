const cheerio = require('cheerio');
const TurndownService = require('turndown');
const NodeCache = require('node-cache');
const https = require('https');
const http = require('http');

const cache = new NodeCache({ stdTTL: 3600 });
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
  strongDelimiter: '**',
});

const agents = {
  http: new http.Agent({ keepAlive: true }),
  https: new https.Agent({ keepAlive: true }),
};

function fetchWithTimeout(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const request = protocol.get(url, {
      timeout,
      agent: url.startsWith('https') ? agents.https : agents.http,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    }, (response) => {
      if (response.statusCode >= 400) {
        reject(new Error(`HTTP error! status: ${response.statusCode}`));
        return;
      }
      let data = '';
      response.setEncoding('utf8'); // Ensure faster parsing of incoming data
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve(data));
    });
    request.on('error', reject);
    request.on('timeout', () => {
      request.abort();
      reject(new Error('Request timed out'));
    });
  });
}

async function scrapeUrl(url) {
  const cachedResult = cache.get(url);
  if (cachedResult) return cachedResult;

  try {
    const html = await fetchWithTimeout(url);
    const $ = cheerio.load(html, { decodeEntities: false });

    // Remove unnecessary elements immediately
    $('script, style, iframe, noscript').remove();

    // Extract content fast using specific, common tags
    let mainContent = $('main, article, section, .content, .post, .entry').first().html();
    if (!mainContent) {
      mainContent = $('body').html(); // Fallback to body if not found
    }

    const sanitizedContent = sanitizeHtml(mainContent);
    const markdown = turndownService.turndown(sanitizedContent);

    // Metadata extraction (very fast as it's simple and direct)
    const title = $('title').text().trim();
    const metaDescription = $('meta[name="description"]').attr('content') || '';
    const h1 = $('h1').first().text().trim();

    // Construct final markdown efficiently
    const cleanedMarkdown = `# ${title}\n\n${metaDescription ? `*${metaDescription}*\n\n` : ''}${h1 && h1 !== title ? `## ${h1}\n\n` : ''}${markdown}`
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const result = { markdown: cleanedMarkdown };
    cache.set(url, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to scrape URL: ${error.message}`);
  }
}

// Faster, safer HTML sanitizer based on DOM traversal
function sanitizeHtml(html) {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
}

module.exports = { scrapeUrl };
