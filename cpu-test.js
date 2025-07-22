console.log('CPU intensive test started');

// CPU intensive operation
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// Continuously use CPU
setInterval(() => {
  console.log('Computing fibonacci(40)...');
  const start = Date.now();
  const result = fibonacci(40);
  const elapsed = Date.now() - start;
  console.log(`Result: ${result}, Time: ${elapsed}ms`);
}, 100);

process.on('SIGTERM', () => {
  console.log('CPU test shutting down...');
  process.exit(0);
});