// Watch Mode Test
// This file will be modified to test file watching

let counter = 4;

console.log(`[${new Date().toISOString()}] Watch mode test started - Version ${counter} - CHANGED AGAIN!`);

// Keep process alive
setInterval(() => {
  console.log(`[${new Date().toISOString()}] Process running... (v${counter})`);
}, 5000);

// Handle termination gracefully
process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] Received SIGTERM, shutting down gracefully...`);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] Received SIGINT`);
  process.exit(0);
});

// Current timestamp: 1753276876558
// Modified at: 1753276920000 - This should trigger restart!