// Cluster Mode Test
const http = require('http');
const cluster = require('cluster');

const PORT = 4000;

if (cluster.isPrimary) {
  console.log(`[${new Date().toISOString()}] Master process started, PID: ${process.pid}`);
} else {
  // Worker process
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end(`Worker ${process.pid} responded at ${new Date().toISOString()}\n`);
  });

  server.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] Worker ${process.pid} listening on port ${PORT}`);
  });

  // Simulate some work
  setInterval(() => {
    console.log(`[${new Date().toISOString()}] Worker ${process.pid} is working...`);
  }, 10000);
}

process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] Process ${process.pid} received SIGTERM`);
  process.exit(0);
});