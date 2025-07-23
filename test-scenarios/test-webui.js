const http = require('http');

console.log('Testing NodeDaemon Web UI...\n');

// Test 1: Check if daemon is running
console.log('1. Checking daemon status...');
const { execSync } = require('child_process');
try {
  const result = execSync('node dist/cli/index.js status', { encoding: 'utf8' });
  console.log('✅ Daemon is running');
  console.log(result);
} catch (e) {
  console.log('❌ Daemon is not running');
  process.exit(1);
}

// Test 2: Try to start Web UI
console.log('\n2. Starting Web UI...');
try {
  execSync('node dist/cli/index.js webui start -p 8080', { encoding: 'utf8' });
  console.log('✅ Web UI started');
} catch (e) {
  console.log('❌ Failed to start Web UI');
  console.log('Error:', e.message);
  
  // Try to get more info
  console.log('\n3. Checking Web UI status...');
  try {
    const status = execSync('node dist/cli/index.js webui status', { encoding: 'utf8' });
    console.log(status);
  } catch (e2) {
    console.log('Status check also failed:', e2.message);
  }
}

// Test 3: Check if web server is responding
setTimeout(() => {
  console.log('\n4. Testing HTTP connection...');
  http.get('http://localhost:8080', (res) => {
    console.log(`✅ Web server responded with status: ${res.statusCode}`);
    
    // Test API endpoint
    http.get('http://localhost:8080/api/processes', (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        console.log('✅ API responded:', data.substring(0, 100) + '...');
      });
    }).on('error', (err) => {
      console.log('❌ API request failed:', err.message);
    });
  }).on('error', (err) => {
    console.log('❌ Web server not responding:', err.message);
  });
}, 2000);