console.log('Environment Test');
console.log('================');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('FROM_ENV_FILE:', process.env.FROM_ENV_FILE);
console.log('DATABASE_URL:', process.env.DATABASE_URL);
console.log('SECRET_KEY:', process.env.SECRET_KEY);
console.log('CUSTOM_FROM_CLI:', process.env.CUSTOM_FROM_CLI);

// Keep running
setInterval(() => {
  console.log('Still running with env vars...');
}, 5000);