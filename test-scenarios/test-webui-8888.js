const http = require('http');

console.log('Testing Web UI on port 8888...\n');

// Test HTTP
http.get('http://localhost:8888/', (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers:`, res.headers);
  
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`Body: ${data}`);
    
    // Test API
    testAPI();
  });
}).on('error', (err) => {
  console.error('HTTP Error:', err.message);
});

function testAPI() {
  console.log('\nTesting API...');
  http.get('http://localhost:8888/api/processes', (res) => {
    console.log(`API Status: ${res.statusCode}`);
    
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log(`API Response:`, data);
      
      // Test WebSocket
      testWebSocket();
    });
  }).on('error', (err) => {
    console.error('API Error:', err.message);
  });
}

function testWebSocket() {
  console.log('\nTesting WebSocket...');
  const WebSocket = require('ws');
  
  try {
    const ws = new WebSocket('ws://localhost:8888/ws');
    
    ws.on('open', () => {
      console.log('WebSocket connected');
      ws.close();
    });
    
    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
    });
  } catch (e) {
    // No ws module, test with raw HTTP upgrade
    console.log('ws module not available, skipping WebSocket test');
  }
}