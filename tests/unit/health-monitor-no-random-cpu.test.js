#!/usr/bin/env node

/**
 * Test for Windows CPU Metrics Bug - Source Code Verification
 *
 * This test verifies that the HealthMonitor source code does not use
 * Math.random() for CPU metrics, which would result in incorrect and
 * non-deterministic CPU percentage values.
 *
 * Bug: HealthMonitor.ts line 375 used Math.random() * 10 instead of 0
 * Fix: Replaced with 0 (accurate representation of "unable to determine")
 */

const { TestFramework } = require('../framework');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const framework = new TestFramework({ verbose: true });

framework.describe('HealthMonitor - No Random CPU Values', () => {
  const projectRoot = join(__dirname, '../..');
  const sourceFile = join(projectRoot, 'src/core/HealthMonitor.ts');

  framework.it('should not contain Math.random() in getWindowsMetrics', () => {
    framework.expect(existsSync(sourceFile)).toBeTruthy();

    const sourceCode = readFileSync(sourceFile, 'utf8');

    // Find the getWindowsMetrics function
    const getWindowsMetricsMatch = sourceCode.match(/getWindowsMetrics[\s\S]*?(?=private\s+|public\s+|$)/);

    framework.expect(getWindowsMetricsMatch).not.toBeNull();

    const getWindowsMetricsCode = getWindowsMetricsMatch[0];

    // Verify it does NOT contain Math.random()
    framework.expect(getWindowsMetricsCode.includes('Math.random')).toBeFalsy();
  });

  framework.it('should use deterministic CPU value in getWindowsMetrics', () => {
    const sourceCode = readFileSync(sourceFile, 'utf8');

    // Check that the getWindowsMetrics function exists
    framework.expect(sourceCode.includes('getWindowsMetrics')).toBeTruthy();

    // Verify Math.random is not used anywhere in the file for CPU metrics
    const lines = sourceCode.split('\n');
    const randomLines = lines.filter(line =>
      line.includes('Math.random') && line.includes('cpu')
    );

    framework.expect(randomLines.length).toBe(0);
  });

  framework.it('should document the CPU parsing TODO or use 0', () => {
    const sourceCode = readFileSync(sourceFile, 'utf8');

    // Find lines near typeperf command
    const lines = sourceCode.split('\n');
    let foundTypePerfSection = false;
    let hasTodoOrZero = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('typeperf')) {
        foundTypePerfSection = true;
      }
      if (foundTypePerfSection && i < lines.length - 20) {
        const section = lines.slice(i, i + 20).join('\n');
        if (section.includes('TODO') || section.includes('cpuPercent = 0')) {
          hasTodoOrZero = true;
          break;
        }
      }
    }

    framework.expect(hasTodoOrZero).toBeTruthy();
  });

  framework.it('should initialize cpuPercent to 0 by default', () => {
    const sourceCode = readFileSync(sourceFile, 'utf8');

    // Simpler check: just verify cpuPercent is set to 0 in the file
    const hasCpuPercentZero =
      sourceCode.includes('let cpuPercent = 0') ||
      sourceCode.includes('cpuPercent = 0');

    framework.expect(hasCpuPercentZero).toBeTruthy();
  });

  framework.it('should not use any random values in HealthMonitor', () => {
    const sourceCode = readFileSync(sourceFile, 'utf8');

    // Count occurrences of Math.random in the entire file
    const randomMatches = sourceCode.match(/Math\.random/g);
    const randomCount = randomMatches ? randomMatches.length : 0;

    // There should be NO Math.random() calls in HealthMonitor
    framework.expect(randomCount).toBe(0);
  });
});

// Run tests if called directly
if (require.main === module) {
  framework.run().then(results => {
    console.log(framework.formatResults());

    if (results.failed === 0) {
      console.log('\n✅ HealthMonitor Source Code Verification: PASSED');
      console.log('   - No Math.random() found in getWindowsMetrics');
      console.log('   - CPU metrics use deterministic values');
      console.log('   - Bug is fixed!');
    } else {
      console.log('\n❌ HealthMonitor Source Code Verification: FAILED');
      console.log('   - Math.random() still present in CPU metrics code');
      console.log('   - Bug NOT fixed!');
    }

    process.exit(results.failed > 0 ? 1 : 0);
  });
}

module.exports = framework;
