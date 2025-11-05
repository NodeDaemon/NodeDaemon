#!/usr/bin/env node

/**
 * Comprehensive Test Suite for All Bug Fixes
 *
 * This file contains tests for ALL bugs found and fixed in the comprehensive bug hunt.
 * Each test is designed to FAIL with the buggy code and PASS with the fixed code.
 */

const { TestFramework } = require('../framework');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const framework = new TestFramework({ verbose: true });

framework.describe('All Bugs Fixed - Comprehensive Test Suite', () => {
  let CommandParser, helpers;
  const projectRoot = join(__dirname, '../..');

  framework.beforeAll(() => {
    // Load modules
    try {
      const CommandParserModule = require('../../dist/cli/CommandParser.js');
      CommandParser = CommandParserModule.CommandParser;
      helpers = require('../../dist/utils/helpers.js');
    } catch (error) {
      console.error('Failed to load modules:', error.message);
      throw error;
    }
  });

  // ========================================================================
  // BUG #1: Version Mismatch in CommandParser
  // ========================================================================

  framework.describe('Bug #1: Version Mismatch in CommandParser', () => {
    framework.it('should return version matching package.json', () => {
      const packagePath = join(projectRoot, 'package.json');
      const packageData = JSON.parse(readFileSync(packagePath, 'utf8'));
      const expectedVersion = packageData.version;

      const parser = new CommandParser();
      const actualVersion = parser.getVersion();

      // This would FAIL with buggy code (returns '1.0.2')
      // This PASSES with fixed code (returns '1.1.0')
      framework.expect(actualVersion).toBe(expectedVersion);
    });

    framework.it('should have consistent version across package.json and CommandParser', () => {
      const packagePath = join(projectRoot, 'package.json');
      const packageData = JSON.parse(readFileSync(packagePath, 'utf8'));

      const parser = new CommandParser();

      framework.expect(parser.getVersion()).toBe(packageData.version);
      framework.expect(parser.getVersion()).toBe('1.1.0');
    });
  });

  // ========================================================================
  // BUG #2: Array Index Out of Bounds in formatMemory
  // ========================================================================

  framework.describe('Bug #2: Array Index Out of Bounds in formatMemory', () => {
    framework.it('should handle very large numbers without returning undefined', () => {
      // This would FAIL with buggy code (returns "8 undefined")
      // This PASSES with fixed code (returns "8192 PB" or similar)
      const result = helpers.formatMemory(Number.MAX_SAFE_INTEGER);

      // Check that result doesn't contain 'undefined'
      framework.expect(result.includes('undefined')).toBeFalsy();
      framework.expect(typeof result).toBe('string');
      framework.expect(result.length).toBeGreaterThan(0);
    });

    framework.it('should format MAX_SAFE_INTEGER correctly', () => {
      const result = helpers.formatMemory(Number.MAX_SAFE_INTEGER);

      // Should contain a number and a valid unit (not undefined)
      const match = result.match(/^[\d.]+ (B|KB|MB|GB|TB|PB)$/);
      framework.expect(match).not.toBeNull();
    });

    framework.it('should handle normal memory values correctly', () => {
      // Existing functionality should still work
      framework.expect(helpers.formatMemory(0)).toBe('0 B');
      framework.expect(helpers.formatMemory(1024)).toBe('1 KB');
      framework.expect(helpers.formatMemory(1048576)).toBe('1 MB');
      framework.expect(helpers.formatMemory(1073741824)).toBe('1 GB');
    });

    framework.it('should handle edge cases near array boundaries', () => {
      // Test values that might cause index issues
      const gb = 1024 * 1024 * 1024;
      const tb = gb * 1024;
      const pb = tb * 1024;

      const result1 = helpers.formatMemory(gb * 500);
      const result2 = helpers.formatMemory(tb * 5);
      const result3 = helpers.formatMemory(pb * 2);

      framework.expect(result1.includes('undefined')).toBeFalsy();
      framework.expect(result2.includes('undefined')).toBeFalsy();
      framework.expect(result3.includes('undefined')).toBeFalsy();
    });
  });

  // ========================================================================
  // BUG #3: Null/Undefined Handling in parseMemoryString
  // ========================================================================

  framework.describe('Bug #3: Null/Undefined Handling in parseMemoryString', () => {
    framework.it('should throw error for null input instead of crashing', () => {
      // This would FAIL with buggy code (throws TypeError: Cannot read properties of null)
      // This PASSES with fixed code (throws Error: Invalid memory format)
      framework.expect(() => {
        helpers.parseMemoryString(null);
      }).toThrow();

      try {
        helpers.parseMemoryString(null);
        framework.expect(true).toBeFalsy(); // Should not reach here
      } catch (error) {
        // Should be our custom error, not TypeError
        framework.expect(error.message.includes('Invalid memory format')).toBeTruthy();
        framework.expect(error.message.includes('Cannot read properties')).toBeFalsy();
      }
    });

    framework.it('should throw error for undefined input', () => {
      framework.expect(() => {
        helpers.parseMemoryString(undefined);
      }).toThrow();

      try {
        helpers.parseMemoryString(undefined);
        framework.expect(true).toBeFalsy();
      } catch (error) {
        framework.expect(error.message.includes('Invalid memory format')).toBeTruthy();
        framework.expect(error.message.includes('non-empty string')).toBeTruthy();
      }
    });

    framework.it('should throw error for empty string', () => {
      framework.expect(() => {
        helpers.parseMemoryString('');
      }).toThrow();

      try {
        helpers.parseMemoryString('');
      } catch (error) {
        framework.expect(error.message.includes('Invalid memory format')).toBeTruthy();
      }
    });

    framework.it('should throw error for non-string inputs', () => {
      const invalidInputs = [123, true, false, {}, [], NaN];

      invalidInputs.forEach(input => {
        framework.expect(() => {
          helpers.parseMemoryString(input);
        }).toThrow();
      });
    });

    framework.it('should still parse valid memory strings correctly', () => {
      // Existing functionality should still work
      framework.expect(helpers.parseMemoryString('100MB')).toBe(100 * 1024 * 1024);
      framework.expect(helpers.parseMemoryString('1GB')).toBe(1024 * 1024 * 1024);
      framework.expect(helpers.parseMemoryString('512MB')).toBe(512 * 1024 * 1024);
      framework.expect(helpers.parseMemoryString('1024KB')).toBe(1024 * 1024);
    });

    framework.it('should handle memory strings with spaces', () => {
      framework.expect(helpers.parseMemoryString('100 MB')).toBe(100 * 1024 * 1024);
      framework.expect(helpers.parseMemoryString('1 GB')).toBe(1024 * 1024 * 1024);
    });
  });

  // ========================================================================
  // Integration Tests - All Bugs Together
  // ========================================================================

  framework.describe('Integration: All Bugs Fixed Together', () => {
    framework.it('should have all fixes working in harmony', () => {
      // Version should be correct
      const parser = new CommandParser();
      const packageData = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
      framework.expect(parser.getVersion()).toBe(packageData.version);

      // formatMemory should handle large numbers
      const largeMemResult = helpers.formatMemory(Number.MAX_SAFE_INTEGER);
      framework.expect(largeMemResult.includes('undefined')).toBeFalsy();

      // parseMemoryString should handle null gracefully
      try {
        helpers.parseMemoryString(null);
        framework.expect(true).toBeFalsy();
      } catch (error) {
        framework.expect(error.message.includes('Invalid memory format')).toBeTruthy();
      }
    });

    framework.it('should maintain backward compatibility for valid use cases', () => {
      // All normal use cases should still work

      // CommandParser version
      const parser = new CommandParser();
      framework.expect(typeof parser.getVersion()).toBe('string');
      framework.expect(parser.getVersion().length).toBeGreaterThan(0);

      // formatMemory normal usage
      framework.expect(helpers.formatMemory(1024 * 1024)).toBe('1 MB');

      // parseMemoryString normal usage
      framework.expect(helpers.parseMemoryString('256MB')).toBe(256 * 1024 * 1024);
    });
  });
});

// Run tests if called directly
if (require.main === module) {
  framework.run().then(results => {
    console.log(framework.formatResults());

    if (results.failed === 0) {
      console.log('\n✅ ALL BUG FIXES VERIFIED!');
      console.log('   - Bug #1: Version mismatch - FIXED');
      console.log('   - Bug #2: formatMemory array bounds - FIXED');
      console.log('   - Bug #3: parseMemoryString null handling - FIXED');
      console.log('\n🎉 All tests passing - Zero regressions!');
    } else {
      console.log('\n❌ Some bug fixes need attention');
      console.log(`   ${results.failed} test(s) failing`);
    }

    process.exit(results.failed > 0 ? 1 : 0);
  });
}

module.exports = framework;
