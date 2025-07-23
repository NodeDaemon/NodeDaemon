#!/usr/bin/env node

// Simple test script for NodeDaemon Web UI
// Usage: node webui-test.js

const { spawn } = require('child_process');
const http = require('http');

console.log('NodeDaemon Web UI Test Script');
console.log('============================\n');

const testSteps = [
  { name: 'Start daemon', cmd: 'node', args: ['dist/cli/index.js', 'daemon'] },
  { name: 'Start test process', cmd: 'node', args: ['dist/cli/index.js', 'start', 'test-app.js', '-n', 'test-app'] },
  { name: 'Enable Web UI', cmd: 'node', args: ['dist/cli/index.js', 'webui', 'start', '-p', '8080'] },
  { name: 'Check Web UI', action: 'checkWebUI' },
  { name: 'Stop Web UI', cmd: 'node', args: ['dist/cli/index.js', 'webui', 'stop'] },
  { name: 'Shutdown daemon', cmd: 'node', args: ['dist/cli/index.js', 'shutdown'] }
];

let currentStep = 0;
let daemonProcess = null;

function runStep() {
  if (currentStep >= testSteps.length) {
    console.log('\n✅ All tests completed successfully!');
    process.exit(0);
  }

  const step = testSteps[currentStep];
  console.log(`\n[${currentStep + 1}/${testSteps.length}] ${step.name}...`);

  if (step.action === 'checkWebUI') {
    checkWebUI(() => {
      currentStep++;
      setTimeout(runStep, 1000);
    });
  } else {
    if (step.name === 'Start daemon') {
      // Keep daemon process reference
      daemonProcess = spawn(step.cmd, step.args, { 
        stdio: 'inherit',
        detached: false
      });
      
      // Wait for daemon to start
      setTimeout(() => {
        currentStep++;
        runStep();
      }, 3000);
    } else {
      const child = spawn(step.cmd, step.args, { stdio: 'inherit' });
      
      child.on('exit', (code) => {
        if (code === 0) {
          console.log(`✓ ${step.name} completed`);
          currentStep++;
          setTimeout(runStep, 1000);
        } else {
          console.error(`✗ ${step.name} failed with code ${code}`);
          cleanup();
        }
      });
    }
  }
}

function checkWebUI(callback) {
  console.log('Checking Web UI at http://localhost:8080...');
  
  http.get('http://localhost:8080', (res) => {
    console.log(`✓ Web UI responded with status ${res.statusCode}`);
    
    if (res.statusCode === 200) {
      console.log('✓ Web UI is accessible');
      
      // Test WebSocket endpoint
      http.get('http://localhost:8080/api/processes', (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          try {
            const processes = JSON.parse(data);
            console.log(`✓ API returned ${processes.length} process(es)`);
            callback();
          } catch (e) {
            console.error('✗ Failed to parse API response');
            cleanup();
          }
        });
      }).on('error', (err) => {
        console.error('✗ API request failed:', err.message);
        cleanup();
      });
    } else {
      console.error('✗ Unexpected status code');
      cleanup();
    }
  }).on('error', (err) => {
    console.error('✗ Web UI request failed:', err.message);
    cleanup();
  });
}

function cleanup() {
  console.log('\nCleaning up...');
  
  if (daemonProcess) {
    daemonProcess.kill();
  }
  
  // Try to shutdown daemon gracefully
  spawn('node', ['dist/cli/index.js', 'shutdown', '-f'], { stdio: 'inherit' });
  
  setTimeout(() => process.exit(1), 2000);
}

// Handle interrupts
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Create a test app if it doesn't exist
const fs = require('fs');
if (!fs.existsSync('test-app.js')) {
  fs.writeFileSync('test-app.js', `
console.log('Test app started');
setInterval(() => {
  console.log('Test app running...', new Date().toISOString());
}, 5000);

process.on('SIGTERM', () => {
  console.log('Test app received SIGTERM');
  process.exit(0);
});
`);
  console.log('Created test-app.js');
}

// Start the test
console.log('Starting Web UI test...');
runStep();