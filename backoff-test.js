console.log(`[${new Date().toISOString()}] Backoff test started`);

// Crash after 2 seconds
setTimeout(() => {
  console.log(`[${new Date().toISOString()}] Crashing intentionally...`);
  throw new Error('Testing exponential backoff');
}, 2000);