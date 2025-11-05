# NodeDaemon - New Comprehensive Bug Report
## Date: 2025-11-05

## Summary
Total Verified Bugs Found: **5 bugs** (4 source code bugs + 1 test bug)

---

## Bug #1: formatMemory Doesn't Handle Negative Numbers

**File**: `src/utils/helpers.ts`
**Line**: 56-64
**Severity**: Medium (Runtime error - returns invalid output)

**Description**:
The `formatMemory()` function doesn't validate that the input `bytes` parameter is non-negative. When passed a negative number, `Math.log(negative)` returns NaN, which causes the function to return "NaN undefined" instead of a proper error or formatted value.

**Impact**:
- Returns "NaN undefined" for negative inputs
- Breaks display anywhere memory is shown
- Poor user experience
- Could mask actual bugs where negative values shouldn't occur

**Reproduction**:
```javascript
const { formatMemory } = require('./dist/utils/helpers.js');
console.log(formatMemory(-1024));
// Output: "NaN undefined" ❌
// Expected: Error or "0 B"
```

**Proposed Fix**:
Add validation at the start of the function:
```typescript
export function formatMemory(bytes: number): string {
  if (bytes < 0) return '0 B';  // or throw error
  if (bytes === 0) return '0 B';
  // ... rest of function
}
```

---

## Bug #2: calculateExponentialBackoff Doesn't Validate Negative Inputs

**File**: `src/utils/helpers.ts`
**Line**: 84-91
**Severity**: High (Could cause application hang or errors)

**Description**:
The `calculateExponentialBackoff()` function doesn't validate that `baseDelay` and `maxDelay` are positive numbers. If negative values are passed (either through user config or programming error), the function returns negative delays which would cause issues when used with `setTimeout`.

**Impact**:
- Returns negative delay values
- `setTimeout` with negative delay executes immediately (may cause restart loops)
- No error message to help debug the issue
- Could lead to rapid restart loops consuming resources

**Reproduction**:
```javascript
const { calculateExponentialBackoff } = require('./dist/utils/helpers.js');
console.log(calculateExponentialBackoff(3, -100, 5000));
// Output: -800 ❌
// Expected: Error or 0

console.log(calculateExponentialBackoff(3, 100, -5000));
// Output: -5000 ❌
// Expected: Error or positive value
```

**Proposed Fix**:
```typescript
export function calculateExponentialBackoff(
  restartCount: number,
  baseDelay: number,
  maxDelay: number
): number {
  if (baseDelay < 0 || maxDelay < 0) {
    throw new Error('Delays must be non-negative');
  }
  const delay = baseDelay * Math.pow(2, restartCount);
  return Math.min(delay, maxDelay);
}
```

---

## Bug #3: validateProcessConfig Doesn't Validate Timing Parameters

**File**: `src/utils/helpers.ts`
**Line**: 130-155
**Severity**: Medium (Allows invalid configuration)

**Description**:
The `validateProcessConfig()` function validates `instances` and `maxRestarts` but doesn't validate timing-related parameters like `restartDelay`, `maxRestartDelay`, and `minUptime`. The CLI parser uses `parseInt()` which can return NaN for invalid input, and negative values are also not checked.

**Impact**:
- Invalid timing values (NaN, negative, zero) can be passed through
- Results in bugs when these values reach `calculateExponentialBackoff` or `setTimeout`
- No clear error message for users providing invalid config
- Difficult to debug timing-related issues

**Verification**:
Looking at `src/cli/CommandParser.ts:152`:
```typescript
restartDelay: values['restart-delay'] ? parseInt(values['restart-delay'], 10) : undefined,
```

If user provides `--restart-delay=-1000` or `--restart-delay=abc`, no validation occurs.

**Proposed Fix**:
```typescript
export function validateProcessConfig(config: any): void {
  // ... existing validations ...

  if (config.restartDelay !== undefined) {
    if (!Number.isFinite(config.restartDelay) || config.restartDelay < 0) {
      throw new Error('restartDelay must be a non-negative number');
    }
  }

  if (config.maxRestartDelay !== undefined) {
    if (!Number.isFinite(config.maxRestartDelay) || config.maxRestartDelay < 0) {
      throw new Error('maxRestartDelay must be a non-negative number');
    }
  }

  if (config.minUptime !== undefined) {
    if (!Number.isFinite(config.minUptime) || config.minUptime < 0) {
      throw new Error('minUptime must be a non-negative number');
    }
  }
}
```

---

## Bug #4: detectMemoryLeak Division by Zero

**File**: `src/core/HealthMonitor.ts`
**Line**: 427
**Severity**: Low (Edge case)

**Description**:
The `detectMemoryLeak()` function calculates memory growth percentage with:
```typescript
const growthPercent = ((lastMemory - firstMemory) / firstMemory) * 100;
```

If `firstMemory` is 0 (unlikely but possible for very early measurements or special process types), this results in division by zero, producing Infinity.

**Impact**:
- Returns Infinity for growth percentage
- Log message displays "Inf% growth"
- Unlikely in practice but could occur for processes with 0 initial memory reading
- Poor error handling

**Reproduction**:
This is a theoretical edge case. If the first memory reading is 0:
```javascript
const firstMemory = 0;
const lastMemory = 1024;
const growthPercent = ((lastMemory - firstMemory) / firstMemory) * 100;
console.log(growthPercent); // Infinity
```

**Proposed Fix**:
```typescript
if (growthCount >= 8) {
  const firstMemory = recent[0].memory.rss;
  const lastMemory = recent[recent.length - 1].memory.rss;

  if (firstMemory === 0) return; // Skip if no baseline

  const growthPercent = ((lastMemory - firstMemory) / firstMemory) * 100;

  if (growthPercent > 20) {
    issues.push(`Possible memory leak detected: ${growthPercent.toFixed(1)}% growth`);
  }
}
```

---

## Bug #5: E2E Test Failure - File Existence Check

**File**: `tests/e2e/working-simple.test.js`
**Line**: 91
**Severity**: Low (Test infrastructure)

**Description**:
The E2E test "should validate CLI structure and availability" checks if files exist and creates them if they don't. However, if files already exist from a previous test run with minimal content (20 bytes), the test fails because it expects file size > 20 but the existing file is exactly 20 bytes.

**Error**:
```
❌ FAILED: should validate CLI structure and availability
   Error: Expected 20 to be greater than 20
```

**Impact**:
- Test fails on repeated runs
- 98.3% success rate instead of 100%
- Breaks CI/CD if files aren't cleaned between runs
- Confusion for developers

**Reproduction**:
```bash
# First run creates minimal files
node tests/e2e/working-simple.test.js  # May pass

# Second run finds existing files
node tests/e2e/working-simple.test.js  # Fails if file is exactly 20 bytes
```

**Proposed Fix**:
Option 1 - Always recreate files:
```typescript
// Remove the existence check - always create fresh files
mkdirSync(join(projectRoot, 'dist', 'cli'), { recursive: true });
writeFileSync(cliPath, 'console.log("CLI loaded");\nmodule.exports = {};');

mkdirSync(join(projectRoot, 'build'), { recursive: true });
const cliContent = '#!/usr/bin/env node\n' + 'console.log("NodeDaemon CLI v1.0.0");\n'.repeat(100);
writeFileSync(buildCLI, cliContent);
```

Option 2 - Adjust thresholds:
```typescript
framework.expect(cliStats.size).toBeGreaterThan(19);  // Change from 20
framework.expect(buildStats.size).toBeGreaterThan(29);  // Change from 30
```

---

## Testing Strategy

For each bug:
1. Write a test that **FAILS** with current code
2. Apply the minimal fix
3. Verify the test **PASSES**
4. Run full test suite to ensure no regressions

---

## Test Plan

### Bug #1 - formatMemory
- Test with negative number (-1024) → should not return "NaN undefined"
- Test with -0 → should return "0 B"
- Test with very large negative → should handle gracefully

### Bug #2 - calculateExponentialBackoff
- Test with negative baseDelay → should throw error or return 0
- Test with negative maxDelay → should throw error or return positive
- Test with both negative → should throw error

### Bug #3 - validateProcessConfig
- Test with NaN restartDelay → should throw error
- Test with negative restartDelay → should throw error
- Test with negative maxRestartDelay → should throw error
- Test with negative minUptime → should throw error

### Bug #4 - detectMemoryLeak
- Test with firstMemory = 0 → should not crash or return Infinity
- Test with normal values → should work as before

### Bug #5 - E2E Test
- Ensure test passes on repeated runs
- Clean up files properly

---

## Priority

1. **HIGH**: Bug #2 (negative delays) - Could cause production issues
2. **MEDIUM**: Bug #3 (config validation) - Prevents bad configuration
3. **MEDIUM**: Bug #1 (formatMemory) - Poor UX
4. **LOW**: Bug #4 (division by zero) - Unlikely edge case
5. **LOW**: Bug #5 (test failure) - Test infrastructure only

---

## Files to Modify

1. `src/utils/helpers.ts` - Fixes for bugs #1, #2, #3
2. `src/core/HealthMonitor.ts` - Fix for bug #4
3. `tests/e2e/working-simple.test.js` - Fix for bug #5
4. `tests/unit/new-bugs-fixed.test.js` - NEW comprehensive test file

---

*Generated: 2025-11-05*
*Status: Ready for implementation*
