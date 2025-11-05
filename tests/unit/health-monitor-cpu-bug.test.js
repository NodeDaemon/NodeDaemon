#!/usr/bin/env node

/**
 * Test for Windows CPU Metrics Bug
 *
 * This test verifies that the HealthMonitor does not use Math.random()
 * for CPU metrics on Windows, which would result in incorrect and
 * non-deterministic CPU percentage values.
 */

const { TestFramework } = require('../framework');
const { execSync } = require('child_process');
const { join } = require('path');
const { existsSync } = require('fs');

const framework = new TestFramework({ verbose: true });

framework.describe('HealthMonitor - Windows CPU Metrics Bug', () => {
  let HealthMonitor;
  let LogManager;

  framework.beforeAll(() => {
    // Build the project first if needed
    const distPath = join(__dirname, '../../dist/core/HealthMonitor.js');
    if (!existsSync(distPath)) {
      console.log('Building project...');
      try {
        execSync('npm run build', { cwd: join(__dirname, '../..'), stdio: 'inherit' });
      } catch (error) {
        console.warn('Build failed, attempting to continue with existing build');
      }
    }

    // Load the built modules
    try {
      HealthMonitor = require('../../dist/core/HealthMonitor.js').HealthMonitor;
      LogManager = require('../../dist/core/LogManager.js').LogManager;
    } catch (error) {
      console.error('Failed to load modules:', error.message);
      throw error;
    }
  });

  framework.it('should not use random values for CPU metrics on Windows', async () => {
    // Create a mock LogManager
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    };

    const healthMonitor = new HealthMonitor(mockLogger);

    // Access the private getWindowsMetrics method through the prototype
    // We need to test that it doesn't return random values
    const getWindowsMetrics = healthMonitor['getWindowsMetrics'].bind(healthMonitor);

    // Test with current process PID (should exist)
    const currentPid = process.pid;

    // Call getWindowsMetrics multiple times
    const cpuValues = [];
    const iterations = 5;

    for (let i = 0; i < iterations; i++) {
      try {
        const metrics = await new Promise((resolve, reject) => {
          getWindowsMetrics(currentPid, (error, metrics) => {
            if (error) {
              // On non-Windows systems or if wmic fails, this is expected
              resolve({ cpu: { percent: 0 } });
            } else {
              resolve(metrics);
            }
          });
        });

        cpuValues.push(metrics.cpu.percent);
      } catch (error) {
        // If there's an error, push 0 (expected behavior on non-Windows)
        cpuValues.push(0);
      }
    }

    // Check that all values are the same (not random)
    // If Math.random() is used, values will be different
    // If fixed to 0, all values will be 0
    const allSame = cpuValues.every(val => val === cpuValues[0]);

    // The bug causes random values, so we expect them to be different
    // After fix, they should all be 0
    if (process.platform === 'win32') {
      // On Windows, if the bug exists, values will be random and different
      // After fix, values should all be 0
      framework.expect(allSame).toBeTruthy();

      // All values should be 0 (can't determine CPU) not random
      cpuValues.forEach(val => {
        framework.expect(val).toBe(0);
      });
    } else {
      // On non-Windows, should return 0 or handle gracefully
      framework.expect(allSame).toBeTruthy();
    }
  });

  framework.it('should return consistent CPU values for same process', async () => {
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    };

    const healthMonitor = new HealthMonitor(mockLogger);
    const getWindowsMetrics = healthMonitor['getWindowsMetrics'].bind(healthMonitor);

    const currentPid = process.pid;

    // Get metrics twice in quick succession
    const getMetrics = () => new Promise((resolve) => {
      getWindowsMetrics(currentPid, (error, metrics) => {
        if (error) {
          resolve({ cpu: { percent: 0 } });
        } else {
          resolve(metrics);
        }
      });
    });

    const [metrics1, metrics2] = await Promise.all([
      getMetrics(),
      getMetrics()
    ]);

    // CPU values should be consistent (not random)
    // With the bug (Math.random), these would be different
    // After fix, both should be 0
    framework.expect(metrics1.cpu.percent).toBe(metrics2.cpu.percent);
  });

  framework.it('should verify CPU percentage is not between 0-10 random range', async () => {
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    };

    const healthMonitor = new HealthMonitor(mockLogger);
    const getWindowsMetrics = healthMonitor['getWindowsMetrics'].bind(healthMonitor);

    const currentPid = process.pid;

    // Collect multiple samples
    const samples = [];
    const sampleCount = 10;

    for (let i = 0; i < sampleCount; i++) {
      const metrics = await new Promise((resolve) => {
        getWindowsMetrics(currentPid, (error, metrics) => {
          if (error) {
            resolve({ cpu: { percent: 0 } });
          } else {
            resolve(metrics);
          }
        });
      });

      samples.push(metrics.cpu.percent);
    }

    // Calculate variance
    const mean = samples.reduce((sum, val) => sum + val, 0) / samples.length;
    const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length;

    // If using Math.random(), variance would be significant (around 8.33 for uniform [0,10])
    // After fix, all values are 0, so variance should be 0
    framework.expect(variance).toBe(0);

    // All samples should be exactly 0
    samples.forEach(sample => {
      framework.expect(sample).toBe(0);
    });
  });
});

// Run tests if called directly
if (require.main === module) {
  framework.run().then(results => {
    console.log(framework.formatResults());

    if (results.failed === 0) {
      console.log('\n✅ Windows CPU Metrics Bug Test: PASSED');
    } else {
      console.log('\n❌ Windows CPU Metrics Bug Test: FAILED');
      console.log('The bug still exists - CPU metrics use random values!');
    }

    process.exit(results.failed > 0 ? 1 : 0);
  });
}

module.exports = framework;
