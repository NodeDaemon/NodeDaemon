// Test direct daemon WebUI command
const net = require('net');
const path = require('path');

const SOCKET_PATH = process.platform === 'win32' 
  ? '\\\\.\\pipe\\nodedaemon'
  : path.join(require('os').homedir(), '.nodedaemon', 'daemon.sock');

const client = net.createConnection(SOCKET_PATH);

client.on('connect', () => {
  console.log('Connected to daemon');
  
  const message = {
    id: Date.now().toString(),
    type: 'webui',
    data: {
      action: 'set',
      config: {
        enabled: true,
        port: 8080,
        host: '127.0.0.1'
      }
    },
    timestamp: Date.now()
  };
  
  console.log('Sending:', message);
  client.write(JSON.stringify(message) + '\n');
});

client.on('data', (data) => {
  console.log('Response:', data.toString());
  const response = JSON.parse(data.toString());
  
  if (response.success) {
    console.log('✅ WebUI command succeeded');
    console.log('Data:', response.data);
  } else {
    console.log('❌ WebUI command failed');
    console.log('Error:', response.error);
  }
  
  client.end();
});

client.on('error', (err) => {
  console.error('Connection error:', err.message);
});