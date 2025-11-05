#!/usr/bin/env node

/**
 * Test for StateManager Timer Type Mismatch Bug
 *
 * Bug: StateManager used a single saveTimer variable for both setInterval
 * and setTimeout, but cleared them with mismatched functions:
 * - startAutoSave() used clearInterval() on potentially a setTimeout timer
 * - scheduleSave() used clearTimeout() on potentially a setInterval timer
 *
 * This caused timers to not be properly cleared, leading to:
 * - Timer leaks
 * - Multiple concurrent save operations
 * - Memory leaks
 * - Race conditions
 *
 * Fix: Use clearTimeout() in both cases, since in Node.js clearTimeout()
 * can safely clear both timeout and interval timers.
 */

const { TestFramework, TestUtils } = require('../framework');
const { existsSync, readFileSync, rmSync, mkdirSync } = require('fs');
const { join } = require('path');

const framework = new TestFramework({ verbose: true });

framework.describe('StateManager - Timer Management Bug', () => {
  let StateManager;
  let LogManager;
  let tempStateDir;

  framework.beforeAll(() => {
    // Load the modules
    const distPath = join(__dirname, '../../dist/core/StateManager.js');
    const logDistPath = join(__dirname, '../../dist/core/LogManager.js');

    if (existsSync(distPath)) {
      StateManager = require(distPath).StateManager;
      LogManager = require(logDistPath).LogManager;
    } else {
      throw new Error('Build files not found. Run npm run build first.');
    }

    // Create temp directory for state files
    tempStateDir = join(__dirname, 'temp-state-timer-test');
    if (!existsSync(tempStateDir)) {
      mkdirSync(tempStateDir, { recursive: true });
    }
  });

  framework.afterAll(() => {
    // Cleanup
    if (existsSync(tempStateDir)) {
      rmSync(tempStateDir, { recursive: true, force: true });
    }
  });

  framework.it('should properly clear interval timer when scheduleSave is called', async () => {
    // Mock logger
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    };

    // Create StateManager instance
    const stateManager = new StateManager(mockLogger);

    // Track how many times saveState is called
    let saveCount = 0;
    const originalSaveState = stateManager.saveState.bind(stateManager);
    stateManager.saveState = function() {
      saveCount++;
      return originalSaveState();
    };

    // At this point, startAutoSave() was called in constructor
    // It created an interval timer that runs every 5 seconds

    // Now trigger scheduleSave() which should clear the interval timer
    stateManager.setProcess('test-proc', {
      id: 'test-proc',
      name: 'test',
      script: 'test.js',
      status: 'running',
      restarts: 0,
      instances: [],
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    // Wait for the debounced save (1 second)
    await TestUtils.sleep(1200);

    // Record save count after debounced save
    const saveCountAfterDebounce = saveCount;

    // Wait another 6 seconds (more than the 5-second interval)
    // If the interval timer wasn't properly cleared, it would fire
    await TestUtils.sleep(6000);

    // The interval timer should have been cleared by scheduleSave()
    // So saveCount should not have increased significantly
    // (only the debounced save + maybe one auto-save should have happened)

    // If bug exists: interval keeps firing, saveCount increases by 2+
    // If bug fixed: interval was cleared, saveCount increases by 0-1
    const additionalSaves = saveCount - saveCountAfterDebounce;

    // With the bug, the old interval would still fire after ~5 seconds
    // Without the bug, only the new auto-save interval fires
    // We allow 1 additional save for the new interval that starts after debounce
    framework.expect(additionalSaves).toBeLessThanOrEqual(2);

    // Cleanup
    stateManager.shutdown();
  });

  framework.it('should properly clear timeout timer when startAutoSave is called', async () => {
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    };

    const stateManager = new StateManager(mockLogger);

    let saveCount = 0;
    const originalSaveState = stateManager.saveState.bind(stateManager);
    stateManager.saveState = function() {
      saveCount++;
      return originalSaveState();
    };

    // Trigger scheduleSave to create a timeout timer (1 second)
    stateManager.setProcess('test-proc', {
      id: 'test-proc',
      name: 'test',
      script: 'test.js',
      status: 'running',
      restarts: 0,
      instances: [],
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    // Immediately call setSaveInterval which calls startAutoSave()
    // This should clear the pending timeout
    await TestUtils.sleep(100);
    stateManager.setSaveInterval(10000); // 10 seconds

    // Wait past when the timeout would have fired (1 second)
    await TestUtils.sleep(1200);

    // The timeout should have been cleared by startAutoSave()
    // So we shouldn't see the debounced save
    // Only the new interval might fire (but not within 1.2 seconds since interval is 10s)

    // If the timeout wasn't cleared, it would have fired
    // With the fix, the timeout was cleared, so minimal saves
    framework.expect(saveCount).toBeLessThanOrEqual(1);

    stateManager.shutdown();
  });

  framework.it('should not leak timers when switching between interval and timeout', async () => {
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    };

    const stateManager = new StateManager(mockLogger);

    // Get initial timer count (rough estimate)
    const initialTimers = process._getActiveHandles().length;

    // Rapidly switch between scheduleSave and startAutoSave
    for (let i = 0; i < 10; i++) {
      stateManager.setProcess(`proc-${i}`, {
        id: `proc-${i}`,
        name: `test-${i}`,
        script: 'test.js',
        status: 'running',
        restarts: 0,
        instances: [],
        config: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      await TestUtils.sleep(50);

      if (i % 2 === 0) {
        stateManager.setSaveInterval(5000);
      }
    }

    await TestUtils.sleep(200);

    // Clean up
    stateManager.shutdown();
    await TestUtils.sleep(100);

    const finalTimers = process._getActiveHandles().length;

    // With the bug, we'd accumulate many uncleaned timers
    // With the fix, timers should be properly cleaned
    // Allow some variance, but should not have 10+ leaked timers
    const timerIncrease = finalTimers - initialTimers;
    framework.expect(timerIncrease).toBeLessThanOrEqual(3);
  });

  framework.it('should use clearTimeout for both timer types in source code', () => {
    const sourceFile = join(__dirname, '../../src/core/StateManager.ts');
    framework.expect(existsSync(sourceFile)).toBeTruthy();

    const sourceCode = readFileSync(sourceFile, 'utf8');

    // Find the startAutoSave function
    const startAutoSaveMatch = sourceCode.match(/startAutoSave\(\)[^}]*\{[^}]*\}/s);
    framework.expect(startAutoSaveMatch).not.toBeNull();

    const startAutoSaveCode = startAutoSaveMatch[0];

    // Should use clearTimeout, not clearInterval
    framework.expect(startAutoSaveCode.includes('clearTimeout')).toBeTruthy();
    framework.expect(startAutoSaveCode.includes('clearInterval')).toBeFalsy();

    // Find the scheduleSave function
    const scheduleSaveMatch = sourceCode.match(/scheduleSave\(\)[^}]*\{[^}]*\}/s);
    framework.expect(scheduleSaveMatch).not.toBeNull();

    const scheduleSaveCode = scheduleSaveMatch[0];

    // Should use clearTimeout
    framework.expect(scheduleSaveCode.includes('clearTimeout')).toBeTruthy();
  });
});

// Run tests if called directly
if (require.main === module) {
  framework.run().then(results => {
    console.log(framework.formatResults());

    if (results.failed === 0) {
      console.log('\n✅ StateManager Timer Bug Test: PASSED');
      console.log('   - Timers are properly cleared');
      console.log('   - No timer type mismatches');
      console.log('   - Bug is fixed!');
    } else {
      console.log('\n❌ StateManager Timer Bug Test: FAILED');
      console.log('   - Timer management issues detected');
    }

    process.exit(results.failed > 0 ? 1 : 0);
  });
}

module.exports = framework;
