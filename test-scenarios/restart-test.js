console.log('Restart test started');

// Get restart count from environment or default to 0
const restartCount = parseInt(process.env.RESTART_COUNT || '0');
console.log(`This is restart #${restartCount}`);

let counter = 0;

const timer = setInterval(() => {
  counter++;
  console.log(`Running for ${counter} seconds (restart #${restartCount})...`);
  
  // Crash after 7 seconds on first 2 runs, run longer on 3rd run
  if (restartCount < 2 && counter >= 7) {
    console.log('Crashing to test restart...');
    clearInterval(timer);
    process.exit(1);
  }
  
  // On 3rd run, run for 15 seconds to test restart counter reset
  if (restartCount >= 2 && counter >= 15) {
    console.log('Running successfully for 15 seconds, restart counter should reset');
    // Keep running
  }
}, 1000);

// Track restart count in environment
process.env.RESTART_COUNT = String(restartCount + 1);