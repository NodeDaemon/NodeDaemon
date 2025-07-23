// CPU Intensive Test - Tests auto-restart on high CPU
console.log(`[${new Date().toISOString()}] CPU intensive test started`);

let running = true;

// CPU intensive calculation
function calculatePrimes(max) {
  const primes = [];
  for (let i = 2; i <= max; i++) {
    let isPrime = true;
    for (let j = 2; j <= Math.sqrt(i); j++) {
      if (i % j === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) primes.push(i);
  }
  return primes;
}

// Run CPU intensive work
const cpuWork = () => {
  if (!running) return;
  
  const start = Date.now();
  const primes = calculatePrimes(50000);
  const duration = Date.now() - start;
  
  console.log(`[${new Date().toISOString()}] Found ${primes.length} primes in ${duration}ms`);
  
  // Small delay to allow monitoring
  setTimeout(cpuWork, 100);
};

cpuWork();

// Also log periodically
setInterval(() => {
  console.log(`[${new Date().toISOString()}] CPU test still running...`);
}, 5000);

process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] Received SIGTERM`);
  running = false;
  process.exit(0);
});