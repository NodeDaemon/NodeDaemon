console.log('Test app started with args:', process.argv.slice(2));
console.log('Environment:', {
  NODE_ENV: process.env.NODE_ENV,
  CUSTOM_VAR: process.env.CUSTOM_VAR,
  FROM_ENV_FILE: process.env.FROM_ENV_FILE
});
console.log('Working directory:', process.cwd());

let counter = 0;
setInterval(() => {
  counter++;
  console.log(`Running for ${counter} seconds...`);
}, 1000);

process.on('SIGTERM', () => {
  console.log('Gracefully shutting down...');
  process.exit(0);
});