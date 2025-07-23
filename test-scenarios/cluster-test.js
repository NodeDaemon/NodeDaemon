const http = require('http');
const process = require('process');

// Get instance ID from environment or generate one
const instanceId = process.env.INSTANCE_ID || Math.random().toString(36).substring(7);
const port = parseInt(process.env.PORT || '3000') + (process.env.NODE_APP_INSTANCE ? parseInt(process.env.NODE_APP_INSTANCE) : 0);

console.log(`Instance ${instanceId} starting on port ${port}...`);
console.log('Environment:', {
  NODE_ENV: process.env.NODE_ENV,
  LOG_LEVEL: process.env.LOG_LEVEL,
  INSTANCE: process.env.NODE_APP_INSTANCE
});

const server = http.createServer((req, res) => {
  console.log(`[${instanceId}] ${req.method} ${req.url}`);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    instance: instanceId,
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  }, null, 2));
});

server.listen(port, () => {
  console.log(`Instance ${instanceId} listening on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(`Instance ${instanceId} received SIGTERM, shutting down gracefully...`);
  server.close(() => {
    console.log(`Instance ${instanceId} HTTP server closed`);
    process.exit(0);
  });
  
  // Force exit after 5 seconds
  setTimeout(() => {
    console.error(`Instance ${instanceId} forced exit`);
    process.exit(1);
  }, 5000);
});

process.on('SIGINT', () => {
  console.log(`Instance ${instanceId} received SIGINT`);
  process.exit(0);
});