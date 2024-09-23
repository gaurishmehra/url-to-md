const { Parser } = require('htmlparser2');
const TurndownService = require('turndown');
const NodeCache = require('node-cache');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

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
  https: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
};

async function fetchWithTimeout(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const request = protocol.get(url, {
      timeout,
      agent: url.startsWith('https') ? agents.https : agents.http,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    }, (response) => {
      if (response.statusCode >= 400) {
        reject(new Error(`HTTP error! status: ${response.statusCode}`));
        return;
      }

      let data = '';
      const encoding = response.headers['content-encoding'];
      let stream = response;

      if (encoding === 'gzip') {
        stream = response.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = response.pipe(zlib.createInflate());
      }

      stream.setEncoding('utf8');
      stream.on('data', (chunk) => { data += chunk; });
      stream.on('end', () => resolve(data));
    });
    request.on('error', reject);
    request.on('timeout', () => {
      request.abort();
      reject(new Error('Request timed out'));
    });
  });
}

async function scrapeUrl(url) {
  const contentHash = crypto.createHash('md5').update(url).digest('hex');
  const cachedResult = cache.get(contentHash);
  if (cachedResult) return cachedResult;

  try {
    const html = await fetchWithTimeout(url);

    let extractedContent = '';
    const parser = new Parser({
      onopentag: (name, attributes) => {
        extractedContent += `<${name}`;
        for (const attr in attributes) {
          extractedContent += ` ${attr}="${attributes[attr]}"`;
        }
        extractedContent += '>';
      },
      ontext: (text) => {
        extractedContent += text;
      },
      onclosetag: (name) => {
        extractedContent += `</${name}>`;
      },
    }, { decodeEntities: true });

    parser.write(html);
    parser.end();

    const sanitizedContent = sanitizeHtml(extractedContent);
    const markdown = turndownService.turndown(sanitizedContent);

    // Metadata extraction (you might need to adjust this based on your needs)
    const title = extractMetadata(sanitizedContent, 'title') || ''; 
    const metaDescription = extractMetadata(sanitizedContent, 'description') || '';

    const cleanedMarkdown = `# ${title}\n\n${metaDescription ? `*${metaDescription}*\n\n` : ''}${markdown}`
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const result = { markdown: cleanedMarkdown };
    cache.set(contentHash, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to scrape URL: ${error.message}`);
  }
}

function sanitizeHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, (match) => {
      return match.replace(/\s+(?!(href|src|alt)=)[^\s>]+/g, '');
    });
}

// Helper function to extract metadata 
function extractMetadata(html, metaName) {
  const regex = new RegExp(`<meta\\s+[^>]*name="${metaName}"\\s+content="([^"]*)"[^>]*>`, 'i');
  const match = html.match(regex);
  return match ? match[1] : null; 
}

module.exports = { scrapeUrl };