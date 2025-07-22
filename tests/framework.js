#!/usr/bin/env node

/**
 * Zero-dependency test framework for NodeDaemon
 * Provides comprehensive testing capabilities without external dependencies
 */

const { spawn } = require('child_process');
const { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } = require('fs');
const { join, dirname } = require('path');
const { EventEmitter } = require('events');

class TestFramework extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      timeout: 30000,
      verbose: false,
      coverage: false,
      parallel: false,
      ...options
    };
    
    this.tests = new Map();
    this.suites = new Map();
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      coverage: new Map()
    };
    
    this.currentSuite = null;
    this.hooks = {
      beforeAll: [],
      afterAll: [],
      beforeEach: [],
      afterEach: []
    };
  }

  // Test suite definition
  describe(name, fn) {
    const suite = {
      name,
      tests: [],
      hooks: {
        beforeAll: [],
        afterAll: [],
        beforeEach: [],
        afterEach: []
      }
    };
    
    this.suites.set(name, suite);
    this.currentSuite = suite;
    
    try {
      fn();
    } finally {
      this.currentSuite = null;
    }
  }

  // Test case definition
  it(name, fn, options = {}) {
    const test = {
      name,
      fn,
      suite: this.currentSuite?.name,
      timeout: options.timeout || this.options.timeout,
      skip: options.skip || false,
      only: options.only || false
    };
    
    const key = this.currentSuite ? `${this.currentSuite.name}::${name}` : name;
    this.tests.set(key, test);
    
    if (this.currentSuite) {
      this.currentSuite.tests.push(test);
    }
  }

  // Hook definitions
  beforeAll(fn) {
    if (this.currentSuite) {
      this.currentSuite.hooks.beforeAll.push(fn);
    } else {
      this.hooks.beforeAll.push(fn);
    }
  }

  afterAll(fn) {
    if (this.currentSuite) {
      this.currentSuite.hooks.afterAll.push(fn);
    } else {
      this.hooks.afterAll.push(fn);
    }
  }

  beforeEach(fn) {
    if (this.currentSuite) {
      this.currentSuite.hooks.beforeEach.push(fn);
    } else {
      this.hooks.beforeEach.push(fn);
    }
  }

  afterEach(fn) {
    if (this.currentSuite) {
      this.currentSuite.hooks.afterEach.push(fn);
    } else {
      this.hooks.afterEach.push(fn);
    }
  }

  // Assertion helpers
  expect(actual) {
    return {
      toBe: (expected) => {
        if (actual !== expected) {
          throw new Error(`Expected ${actual} to be ${expected}`);
        }
      },
      
      toEqual: (expected) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
        }
      },
      
      toBeNull: () => {
        if (actual !== null) {
          throw new Error(`Expected ${actual} to be null`);
        }
      },
      
      toBeUndefined: () => {
        if (actual !== undefined) {
          throw new Error(`Expected ${actual} to be undefined`);
        }
      },
      
      toBeTruthy: () => {
        if (!actual) {
          throw new Error(`Expected ${actual} to be truthy`);
        }
      },
      
      toBeFalsy: () => {
        if (actual) {
          throw new Error(`Expected ${actual} to be falsy`);
        }
      },
      
      toContain: (expected) => {
        if (!actual.includes(expected)) {
          throw new Error(`Expected ${actual} to contain ${expected}`);
        }
      },
      
      toThrow: (expectedError) => {
        let threw = false;
        let error;
        
        try {
          if (typeof actual === 'function') {
            actual();
          }
        } catch (e) {
          threw = true;
          error = e;
        }
        
        if (!threw) {
          throw new Error('Expected function to throw an error');
        }
        
        if (expectedError && !error.message.includes(expectedError)) {
          throw new Error(`Expected error to contain "${expectedError}", got "${error.message}"`);
        }
      },
      
      toBeInstanceOf: (expectedClass) => {
        if (!(actual instanceof expectedClass)) {
          throw new Error(`Expected ${actual} to be instance of ${expectedClass.name}`);
        }
      },
      
      toHaveProperty: (property, value) => {
        if (!(property in actual)) {
          throw new Error(`Expected object to have property ${property}`);
        }
        if (value !== undefined && actual[property] !== value) {
          throw new Error(`Expected property ${property} to be ${value}, got ${actual[property]}`);
        }
      },
      
      toBeGreaterThan: (expected) => {
        if (actual <= expected) {
          throw new Error(`Expected ${actual} to be greater than ${expected}`);
        }
      },
      
      toBeLessThan: (expected) => {
        if (actual >= expected) {
          throw new Error(`Expected ${actual} to be less than ${expected}`);
        }
      },
      
      toBeGreaterThanOrEqual: (expected) => {
        if (actual < expected) {
          throw new Error(`Expected ${actual} to be greater than or equal ${expected}`);
        }
      },
      
      toBeLessThanOrEqual: (expected) => {
        if (actual > expected) {
          throw new Error(`Expected ${actual} to be less than or equal ${expected}`);
        }
      },
      
      not: {
        toBe: (expected) => {
          if (actual === expected) {
            throw new Error(`Expected ${actual} not to be ${expected}`);
          }
        },
        toEqual: (expected) => {
          if (JSON.stringify(actual) === JSON.stringify(expected)) {
            throw new Error(`Expected ${JSON.stringify(actual)} not to equal ${JSON.stringify(expected)}`);
          }
        },
        toBeNull: () => {
          if (actual === null) {
            throw new Error(`Expected ${actual} not to be null`);
          }
        }
      }
    };
  }

  // Mock functionality
  mock(originalObject, methodName, mockImplementation) {
    const original = originalObject[methodName];
    originalObject[methodName] = mockImplementation || (() => {});
    
    return {
      restore: () => {
        originalObject[methodName] = original;
      },
      calls: mockImplementation?.calls || []
    };
  }

  // Spy functionality
  spy(object, methodName) {
    const original = object[methodName];
    const calls = [];
    
    object[methodName] = function(...args) {
      calls.push({ args, context: this });
      return original.apply(this, args);
    };
    
    return {
      calls,
      restore: () => {
        object[methodName] = original;
      }
    };
  }

  // Test execution
  async runTest(test) {
    if (test.skip) {
      this.results.skipped++;
      this.emit('testSkipped', test);
      return;
    }

    const startTime = Date.now();
    let error = null;
    
    try {
      // Run hooks
      await this.runHooks('beforeEach', test);
      
      // Run test with timeout
      await Promise.race([
        test.fn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Test timeout after ${test.timeout}ms`)), test.timeout)
        )
      ]);
      
      this.results.passed++;
      this.emit('testPassed', { ...test, duration: Date.now() - startTime });
      
    } catch (e) {
      error = e;
      this.results.failed++;
      this.emit('testFailed', { ...test, error, duration: Date.now() - startTime });
      if (this.options.verbose) {
        console.error(`❌ FAILED: ${test.name}`);
        console.error(`   Error: ${e.message}`);
      }
    } finally {
      try {
        await this.runHooks('afterEach', test);
      } catch (e) {
        if (!error) {
          error = e;
          this.results.failed++;
          this.results.passed--;
        }
      }
    }
  }

  async runHooks(type, test) {
    const globalHooks = this.hooks[type] || [];
    const suiteHooks = test.suite ? (this.suites.get(test.suite)?.hooks[type] || []) : [];
    
    for (const hook of [...globalHooks, ...suiteHooks]) {
      await hook();
    }
  }

  // Coverage tracking
  trackCoverage(filename, lines) {
    if (!this.options.coverage) return;
    
    if (!this.results.coverage.has(filename)) {
      this.results.coverage.set(filename, {
        total: 0,
        covered: new Set(),
        lines: {}
      });
    }
    
    const coverage = this.results.coverage.get(filename);
    lines.forEach(line => {
      coverage.covered.add(line);
      coverage.lines[line] = (coverage.lines[line] || 0) + 1;
    });
  }

  // Generate coverage report
  generateCoverageReport() {
    if (!this.options.coverage) return '';
    
    let report = '\n📊 Coverage Report\n';
    report += '='.repeat(50) + '\n';
    
    let totalLines = 0;
    let coveredLines = 0;
    
    for (const [filename, data] of this.results.coverage) {
      const fileTotal = data.total || Object.keys(data.lines).length;
      const fileCovered = data.covered.size;
      const percentage = fileTotal > 0 ? (fileCovered / fileTotal * 100).toFixed(2) : '0.00';
      
      report += `${filename}: ${percentage}% (${fileCovered}/${fileTotal} lines)\n`;
      
      totalLines += fileTotal;
      coveredLines += fileCovered;
    }
    
    const overallPercentage = totalLines > 0 ? (coveredLines / totalLines * 100).toFixed(2) : '0.00';
    report += '-'.repeat(50) + '\n';
    report += `Overall: ${overallPercentage}% (${coveredLines}/${totalLines} lines)\n`;
    
    return report;
  }

  // Run all tests
  async run() {
    this.startTime = Date.now();
    this.results.total = this.tests.size;
    this.emit('runStart', { total: this.results.total });
    
    try {
      // Run global beforeAll hooks
      await this.runHooks('beforeAll', {});
      
      // Run suite beforeAll hooks
      for (const suite of this.suites.values()) {
        for (const hook of suite.hooks.beforeAll) {
          await hook();
        }
      }
      
      // Run tests
      if (this.options.parallel) {
        await Promise.all(Array.from(this.tests.values()).map(test => this.runTest(test)));
      } else {
        for (const test of this.tests.values()) {
          await this.runTest(test);
        }
      }
      
      // Run suite afterAll hooks
      for (const suite of this.suites.values()) {
        for (const hook of suite.hooks.afterAll) {
          await hook();
        }
      }
      
      // Run global afterAll hooks
      await this.runHooks('afterAll', {});
      
    } catch (error) {
      this.emit('runError', error);
    }
    
    this.emit('runComplete', this.results);
    return this.results;
  }

  // Report formatting
  formatResults() {
    const { passed, failed, skipped, total } = this.results;
    const duration = this.startTime ? Date.now() - this.startTime : 0;
    
    let report = '\n🧪 Test Results\n';
    report += '='.repeat(50) + '\n';
    report += `Total: ${total}\n`;
    report += `✅ Passed: ${passed}\n`;
    report += `❌ Failed: ${failed}\n`;
    report += `⏭️  Skipped: ${skipped}\n`;
    report += `⏱️  Duration: ${duration}ms\n`;
    
    if (this.options.coverage) {
      report += this.generateCoverageReport();
    }
    
    return report;
  }
}

// Utility functions for testing
class TestUtils {
  static async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  static async runCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const cmd = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...options
      });
      
      let stdout = '';
      let stderr = '';
      
      cmd.stdout?.on('data', data => stdout += data);
      cmd.stderr?.on('data', data => stderr += data);
      
      cmd.on('close', code => {
        resolve({ code, stdout, stderr });
      });
      
      cmd.on('error', reject);
    });
  }
  
  static createTempFile(content, extension = '.js') {
    const tempDir = join(__dirname, 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
    
    const filename = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${extension}`;
    const filepath = join(tempDir, filename);
    writeFileSync(filepath, content);
    
    return {
      path: filepath,
      cleanup: () => {
        try {
          rmSync(filepath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }
  
  static async waitFor(condition, timeout = 5000, interval = 100) {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await this.sleep(interval);
    }
    
    throw new Error(`Condition not met within ${timeout}ms`);
  }
}

module.exports = { TestFramework, TestUtils };