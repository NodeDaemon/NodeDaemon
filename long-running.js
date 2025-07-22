console.log('Long running process started');

let counter = 0;

// Run for a long time
setInterval(() => {
  counter++;
  console.log(`Still running... ${counter} seconds`);
  
  // Simulate work
  const arr = new Array(1000).fill(0).map(() => Math.random());
  const sum = arr.reduce((a, b) => a + b, 0);
  
  if (counter % 10 === 0) {
    console.log(`Checkpoint at ${counter} seconds, sum: ${sum}`);
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