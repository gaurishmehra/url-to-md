const { scrapeUrl } = require('./scraper'); // Assuming scrapeUrl is in 'scraper.js'
const workerpool = require('workerpool');

// Wrapper around scrapeUrl to add error handling
async function safeScrapeUrl(url) {
  try {
    return await scrapeUrl(url);
  } catch (error) {
    console.error(`Error in worker while scraping URL: ${url}`, error);
    throw new Error(`Worker failed to scrape URL: ${url}`);
  }
}

// Register the scraping function with the worker pool
workerpool.worker({
  scrapeUrl: safeScrapeUrl // Register the scrapeUrl function from your scraper module
});
