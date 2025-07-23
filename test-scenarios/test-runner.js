// Test Runner - Shows real-time status of all tests
const { execSync } = require('child_process');

console.log('\n=== NodeDaemon Test Status Dashboard ===\n');

function getProcessList() {
  try {
    const output = execSync('node dist/cli/index.js list --json', { encoding: 'utf8' });
    return JSON.parse(output);
  } catch (e) {
    return [];
  }
}

function displayStatus() {
  console.clear();
  console.log('\n=== NodeDaemon Test Status Dashboard ===');
  console.log(`Time: ${new Date().toLocaleTimeString()}\n`);
  
  const processes = getProcessList();
  
  // Group by test type
  const tests = {
    watch: processes.find(p => p.name === 'watch-test'),
    cluster: processes.find(p => p.name === 'cluster-test'),
    memory: processes.find(p => p.name === 'memory-test'),
    cpu: processes.find(p => p.name === 'cpu-test'),
    crash: processes.find(p => p.name === 'crash-test')
  };
  
  // Display each test
  Object.entries(tests).forEach(([type, proc]) => {
    if (!proc) return;
    
    const status = proc.status === 'running' ? '🟢' : 
                   proc.status === 'errored' ? '🔴' : '🟡';
    
    console.log(`${status} ${type.toUpperCase()} TEST`);
    console.log(`  Status: ${proc.status}`);
    console.log(`  Instances: ${proc.instances.length}`);
    console.log(`  Restarts: ${proc.restarts}`);
    
    if (proc.instances[0]) {
      const inst = proc.instances[0];
      console.log(`  Memory: ${(inst.memory / 1024 / 1024).toFixed(1)} MB`);
      console.log(`  CPU: ${inst.cpu?.toFixed(1) || 0}%`);
    }
    console.log('');
  });
  
  console.log('\nWeb UI: http://localhost:9999');
  console.log('Press Ctrl+C to exit');
}

// Update every 2 seconds
setInterval(displayStatus, 2000);
displayStatus();