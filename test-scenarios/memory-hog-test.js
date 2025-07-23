// Memory Hog Test - Tests auto-restart on high memory
console.log(`[${new Date().toISOString()}] Memory hog test started`);

const arrays = [];
let iteration = 0;

// Gradually increase memory usage
const memoryInterval = setInterval(() => {
  // Allocate 10MB per iteration
  const size = 10 * 1024 * 1024 / 8; // 10MB in 64-bit numbers
  const arr = new Array(size);
  
  for (let i = 0; i < size; i++) {
    arr[i] = Math.random();
  }
  
  arrays.push(arr);
  iteration++;
  
  const memUsage = process.memoryUsage();
  const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  
  console.log(`[${new Date().toISOString()}] Iteration ${iteration}: Heap ${heapMB}MB, RSS ${rssMB}MB`);
  
  // Stop at 600MB to avoid system issues
  if (rssMB > 600) {
    console.log(`[${new Date().toISOString()}] Reached memory limit, maintaining...`);
    clearInterval(memoryInterval);
  }
}, 2000);

process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] Received SIGTERM, cleaning up...`);
  clearInterval(memoryInterval);
  process.exit(0);
});