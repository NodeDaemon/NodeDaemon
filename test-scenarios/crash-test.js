// Crash Test - Tests auto-restart on crash
console.log(`[${new Date().toISOString()}] Crash test started`);

let crashCount = 0;

// Log every 2 seconds
const logInterval = setInterval(() => {
  console.log(`[${new Date().toISOString()}] Process running for ${process.uptime().toFixed(1)}s`);
}, 2000);

// Crash after 10 seconds
setTimeout(() => {
  console.log(`[${new Date().toISOString()}] Crashing intentionally!`);
  clearInterval(logInterval);
  throw new Error('Intentional crash for testing auto-restart');
}, 10000);

process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] Received SIGTERM`);
  clearInterval(logInterval);
  process.exit(0);
});