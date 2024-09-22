const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs').promises;
const workerPool = require('workerpool');

// Create a worker pool
const pool = workerPool.pool(path.join(__dirname, 'worker.js'), {
  minWorkers: 2,
  maxWorkers: 4,
  workerType: 'thread',
  workerTerminateTimeout: 60000, // 60 seconds to avoid premature termination
  maxQueueSize: 1000 // Queue size to avoid too many requests overloading the workers
});

// Serve index.html
fastify.get('/', async (request, reply) => {
  const indexPath = path.join(__dirname, 'index.html');
  try {
    const content = await fs.readFile(indexPath, 'utf8');
    reply.type('text/html').send(content);
  } catch (error) {
    reply.code(500).send('Error loading index.html');
  }
});

// Scraping route
fastify.post('/scrape', async (request, reply) => {
  const { url } = request.body;
  
  // Validate URL using try-catch block and URL constructor
  try {
    new URL(url);
  } catch (e) {
    reply.code(400).send({ error: 'Invalid URL format' });
    return;
  }

  try {
    const result = await pool.exec('scrapeUrl', [url]);
    reply.send(result);
  } catch (error) {
    fastify.log.error(`Error scraping URL ${url}:`, error);
    reply.code(500).send({ error: `Failed to scrape URL: ${error.message}` });
  }
});

// Start the server
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    fastify.log.info(`Server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully.');
  await pool.terminate(); // Terminate the worker pool
  await fastify.close(); // Close the Fastify server
  process.exit(0);
});

start();
