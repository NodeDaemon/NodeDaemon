// Debug script to test WebUI directly
const { WebUIServer } = require('./dist/core/WebUIServer');

console.log('Testing WebUI Server directly...\n');

const server = new WebUIServer({
  enabled: true,
  port: 8080,
  host: '127.0.0.1'
});

server.on('started', () => {
  console.log('✅ WebUI Server started successfully');
  console.log('Visit http://localhost:8080');
});

server.on('error', (err) => {
  console.error('❌ WebUI Server error:', err);
});

server.start().catch(err => {
  console.error('❌ Failed to start WebUI:', err);
  process.exit(1);
});

// Keep process alive
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await server.stop();
  process.exit(0);
});