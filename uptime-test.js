let runCount = parseInt(process.env.RUN_COUNT || '0');
runCount++;
process.env.RUN_COUNT = runCount.toString();

console.log(`[${new Date().toISOString()}] Uptime test started - Run #${runCount}`);

if (runCount <= 2) {
  // Crash quickly on first 2 runs
  setTimeout(() => {
    console.log(`[${new Date().toISOString()}] Crashing after 3 seconds (run #${runCount})`);
    process.exit(1);
  }, 3000);
} else {
  // Run for 15 seconds on 3rd run to test restart counter reset
  console.log('Running for longer to test restart counter reset...');
  let counter = 0;
  const timer = setInterval(() => {
    counter++;
    console.log(`Running for ${counter} seconds...`);
    
    if (counter === 15) {
      console.log('Successfully ran for 15 seconds! Now crashing to test if counter was reset...');
      clearInterval(timer);
      process.exit(1);
    }
  }, 1000);
}