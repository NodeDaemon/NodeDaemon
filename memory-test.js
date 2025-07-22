console.log('Memory test script started');

// Array to hold memory
const memoryHog = [];

// Allocate memory gradually
setInterval(() => {
  // Allocate ~10MB per second
  const chunk = new Array(1024 * 1024).fill('x'.repeat(10));
  memoryHog.push(chunk);
  
  const usedMemory = process.memoryUsage().rss / 1024 / 1024; // MB
  console.log(`Current memory usage: ${usedMemory.toFixed(2)} MB`);
  
  // Simulate some work
  if (usedMemory > 100) {
    console.log('Working with high memory...');
  }
}, 1000);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});