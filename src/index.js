const express = require('express');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const TurndownService = require('turndown');
const cors = require('cors');
const { performance } = require('perf_hooks');
const path = require('path');
const stream = require('stream');
const { promisify } = require('util');

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors());
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const pipeline = promisify(stream.pipeline);
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Initialize TurndownService with improved rules
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
  strongDelimiter: '**',
});

// Add improved rules for links, blockquotes, and images
turndownService.addRule('links', {
  filter: 'a',
  replacement: (content, node) => {
    const href = node.getAttribute('href');
    return href ? `[${content}](${href})` : content;
  }
});

turndownService.addRule('blockquotes', {
  filter: 'blockquote',
  replacement: (content) => {
    return `> ${content.trim().replace(/\n/g, '\n> ')}`;
  }
});

turndownService.addRule('images', {
  filter: 'img',
  replacement: (content, node) => {
    const alt = node.getAttribute('alt') || '';
    const src = node.getAttribute('src') || '';
    return `![${alt}](${src})`;
  }
});

async function fetchWithTimeout(url, timeout = 8000) {
  const source = axios.CancelToken.source();
  const timer = setTimeout(() => source.cancel('Request timed out'), timeout);

  try {
    const response = await axios.get(url, {
      cancelToken: source.token,
      responseType: 'stream',
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

async function scrapeUrl(url) {
  const startTime = performance.now();

  try {
    const response = await fetchWithTimeout(url);
    const html = await new Promise((resolve, reject) => {
      const chunks = [];
      pipeline(
        response.data,
        new stream.Writable({
          write(chunk, encoding, callback) {
            chunks.push(chunk);
            callback();
          },
          final(callback) {
            resolve(Buffer.concat(chunks).toString('utf8'));
            callback();
          }
        })
      ).catch(reject);
    });

    const dom = new JSDOM(html);
    const { document } = dom.window;

    // Remove unnecessary elements
    const tagsToRemove = ['script', 'style', 'iframe', 'noscript'];
    tagsToRemove.forEach(tag => {
      document.querySelectorAll(tag).forEach(el => el.remove());
    });

    // Improved content selection to handle diverse structures
    const mainContent = document.querySelector('main, article, section, .content, .post, .entry') || document.body;

    // Sanitize the extracted content
    const sanitizedContent = DOMPurify.sanitize(mainContent.innerHTML, {
      ALLOWED_TAGS: ['p', 'a', 'strong', 'em', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img'],
      ALLOWED_ATTR: ['href', 'src', 'alt']
    });

    // Convert to markdown with improved formatting
    const markdown = turndownService.turndown(sanitizedContent);

    // Extract title, description, and main heading for better markdown structure
    const title = document.querySelector('title')?.textContent.trim() || '';
    const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    const h1 = document.querySelector('h1')?.textContent.trim() || '';

    // Clean markdown with enhanced formatting
    const cleanedMarkdown = `# ${title}\n\n${metaDescription ? `*${metaDescription}*\n\n` : ''}${h1 && h1 !== title ? `## ${h1}\n\n` : ''}${markdown}`
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const endTime = performance.now();
    const executionTime = `${(endTime - startTime).toFixed(2)} ms`;

    return { markdown: cleanedMarkdown, executionTime };
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

app.listen(port, () => {
  console.log(`Optimized Scraper listening at http://localhost:${port}`);
});
