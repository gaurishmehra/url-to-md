const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const cors = require('cors');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const path = require('path'); // Import the 'path' module

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors());

// Initialize JSDOM and DOMPurify only once
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Create a TurndownService instance
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
  strongDelimiter: '**',
  strikethroughDelimiter: '~~',
});

// Retain all links
turndownService.addRule('links', {
  filter: 'a',
  replacement: (content, node) => {
    const href = node.getAttribute('href');
    return href ? `[${content}](${href})` : content;
  }
});

// Preserve code blocks
turndownService.addRule('codeBlocks', {
  filter: node => ['pre', 'code'].includes(node.nodeName.toLowerCase()),
  replacement: (content, node) => {
    const language = (node.getAttribute('class') || '').match(/language-(\S+)/)?.[1] || '';
    return `\n\n\`\`\`${language}\n${content.trim()}\n\`\`\`\n\n`;
  }
});

// Cache with longer TTL for repeated requests
const cache = new NodeCache({ stdTTL: 600, checkperiod: 360 });

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.'
});

app.use(limiter);

// Dynamic Import of p-retry
async function fetchWithRetry(url) {
  const pRetry = await import('p-retry');
  return pRetry.default(() => axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    timeout: 5000,
  }), { retries: 2 });
}

// Optimized content extraction
function extractMainContent($) {
  let content = $('main, article, .content, #main, #content').first().html();
  if (!content) {
    content = $('body').html(); // Fallback to entire body
  }
  return content;
}

async function scrapeUrl(urlToScrape) {
  const startTime = process.hrtime();

  // Check cache for quick response
  const cachedResult = cache.get(urlToScrape);
  if (cachedResult) {
    return cachedResult;
  }

  try {
    // Use the dynamic import for p-retry
    const response = await fetchWithRetry(urlToScrape);

    const html = response.data;
    const $ = cheerio.load(html, { decodeEntities: false });

    // Minimal and fast DOM element removal
    $('script, style, iframe, noscript, .hidden, .sidebar, .ads, .comments, img').remove();

    const title = $('title').text().trim();
    const metaDescription = $('meta[name="description"]').attr('content') || '';
    const h1 = $('h1').first().text().trim();

    const mainContent = extractMainContent($);

    // DOMPurify sanitization (essential tags only)
    const sanitizedHtml = DOMPurify.sanitize(mainContent, {
      ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'a', 'pre', 'code', 'blockquote', 'strong', 'em', 'br', 'table', 'thead', 'tbody', 'tr', 'td', 'th'],
      ALLOWED_ATTR: ['href']
    });

    // Convert sanitized HTML to Markdown
    const markdown = turndownService.turndown(sanitizedHtml);

    // Clean up markdown
    const cleanedMarkdown = `# ${title}\n\n${metaDescription ? `*${metaDescription}*\n\n` : ''}${h1 !== title ? `## ${h1}\n\n` : ''}${markdown}`
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Measure execution time
    const endTime = process.hrtime(startTime);
    const executionTime = (endTime[0] * 1000 + endTime[1] / 1e6).toFixed(2);

    const result = { markdown: cleanedMarkdown, executionTime: `${executionTime} ms` };

    // Cache the result
    cache.set(urlToScrape, result);

    return result;
  } catch (error) {
    console.error('Error scraping URL:', error);
    throw new Error(`Error scraping URL: ${error.message}`);
  }
}

app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const result = await scrapeUrl(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve the index.html file 
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html')); 
});

app.listen(port, () => {
  console.log(`Optimized Scraper API listening at http://localhost:${port}`);
});