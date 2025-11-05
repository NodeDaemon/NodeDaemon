# NodeDaemon Comprehensive Bug Report

## Summary
Total Verified Bugs Found: 3

---

## Bug #1: Version Mismatch in CommandParser

**File**: `src/cli/CommandParser.ts`
**Line**: 465

**Description**:
The `getVersion()` method returns a hardcoded string '1.0.2', but the package.json file has version '1.1.0'. This causes version mismatch when users run `nodedaemon version` or `nodedaemon --version`.

**Impact**:
- Users see incorrect version information
- Confusion about which version is installed
- Version needs manual updates in multiple places

**Verification**:
```bash
# Current behavior (BUG)
node -e "const cp = require('./dist/cli/CommandParser.js'); console.log(new cp.CommandParser().getVersion())"
# Output: 1.0.2

# Package.json has:
grep version package.json
# Output: "version": "1.1.0"
```

**Proposed Fix**:
Read version from package.json or use a constant that's synced during build.

---

## Bug #2: Array Index Out of Bounds in formatMemory

**File**: `src/utils/helpers.ts`
**Line**: 57-59

**Description**:
The `formatMemory()` function calculates array index using `Math.floor(Math.log(bytes) / Math.log(k))` without bounds checking. For very large numbers (e.g., Number.MAX_SAFE_INTEGER), this can produce an index greater than the sizes array length (3), resulting in `undefined`.

**Impact**:
- Returns "X undefined" instead of proper formatted memory
- Breaks display for processes using very large memory
- Poor user experience

**Verification**:
```javascript
const helpers = require('./dist/utils/helpers.js');
console.log(helpers.formatMemory(Number.MAX_SAFE_INTEGER));
// Output: "8 undefined" (BUG)
// Expected: "8192 GB" or similar
```

**Proposed Fix**:
Add bounds checking: `const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);`

---

## Bug #3: Null/Undefined Handling in parseMemoryString

**File**: `src/utils/helpers.ts`
**Line**: 43-49

**Description**:
The `parseMemoryString()` function attempts to call `.match()` on the input string without checking if it's null or undefined first. This causes a runtime error.

**Impact**:
- Application crashes when null/undefined is passed
- No graceful error handling
- Potential security issue if input comes from user

**Verification**:
```javascript
const helpers = require('./dist/utils/helpers.js');
helpers.parseMemoryString(null);
// Throws: TypeError: Cannot read properties of null (reading 'match')
```

**Proposed Fix**:
Add validation at the start:
```typescript
if (!memory || typeof memory !== 'string') {
  throw new Error('Invalid memory format: must be a non-empty string');
}
```

---

## Testing Strategy

For each bug:
1. Write a test that FAILS with current code
2. Apply the fix
3. Verify the test PASSES
4. Run full test suite to ensure no regressions

---

## Note on Previously Fixed Bugs

The following bugs were already fixed in earlier commits:
- HealthMonitor: Random CPU metrics (Math.random())
- StateManager: Timer type mismatch
- LogManager: Log rotation archive loss

These are not included in this report as they're already resolved.
