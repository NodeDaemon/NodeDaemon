# NodeDaemon - Staging Deployment Checklist
## Bug Fix Release - v1.1.1 (17 Critical & High Bugs Fixed)

**Date**: 2025-11-17
**Branch**: `claude/repo-bug-analysis-fixes-01BdAMnXESBbYRHsFwFiRPzj`
**Target Environment**: Staging
**Deployment Type**: Bug fix release (17 bugs fixed)

---

## 📋 Pre-Deployment Checklist

### 1. Code Verification

- [ ] **Pull latest changes**
  ```bash
  git checkout claude/repo-bug-analysis-fixes-01BdAMnXESBbYRHsFwFiRPzj
  git pull origin claude/repo-bug-analysis-fixes-01BdAMnXESBbYRHsFwFiRPzj
  ```

- [ ] **Verify build passes**
  ```bash
  npm run build
  # Expected: ✅ Build completed successfully
  ```

- [ ] **Run test suite**
  ```bash
  npm test
  # Expected: All tests pass
  ```

- [ ] **Check for TypeScript errors**
  ```bash
  npx tsc --noEmit
  # Expected: No errors
  ```

- [ ] **Review changes**
  ```bash
  git log --oneline origin/main..HEAD
  # Should show 2 commits:
  # - Phase 1: 13 bugs fixed
  # - Phase 2: 4 bugs fixed (BUG-009 to BUG-013)
  ```

### 2. Environment Preparation

- [ ] **Backup current staging deployment**
  ```bash
  # Backup current version
  cp -r /path/to/staging/nodedaemon /path/to/backup/nodedaemon-$(date +%Y%m%d-%H%M%S)

  # Backup state files
  cp -r ~/.nodedaemon ~/.nodedaemon-backup-$(date +%Y%m%d-%H%M%S)
  ```

- [ ] **Set environment variables** (BREAKING CHANGE - BUG-011)
  ```bash
  # For Web UI authentication (if used)
  export NODEDAEMON_WEBUI_PASSWORD=your_secure_password

  # Add to systemd service or environment file
  echo 'Environment="NODEDAEMON_WEBUI_PASSWORD=your_secure_password"' >> /etc/systemd/system/nodedaemon.service.d/override.conf
  ```

- [ ] **Review configuration files**
  ```bash
  # Check if any configs use --password flag (now deprecated)
  grep -r "\-\-password" /path/to/configs/
  # Update any found to use environment variable instead
  ```

### 3. Dependency Check

- [ ] **Verify Node.js version**
  ```bash
  node --version
  # Expected: >= 20.0.0
  ```

- [ ] **Install/update dependencies**
  ```bash
  npm ci --production
  # Uses package-lock.json for exact versions
  ```

- [ ] **Verify @types/node installed**
  ```bash
  npm list @types/node
  # Should show version installed
  ```

---

## 🚢 Deployment Steps

### Step 1: Stop Current Daemon (if running)

```bash
# Check if daemon is running
nodedaemon status

# Stop daemon gracefully
nodedaemon shutdown

# Wait for shutdown to complete (max 30 seconds)
# Verify daemon stopped
ps aux | grep nodedaemon

# Force kill if necessary (only if graceful shutdown failed)
# pkill -9 nodedaemon
```

### Step 2: Deploy New Version

```bash
# Option A: Direct deployment
cd /path/to/NodeDaemon
git checkout claude/repo-bug-analysis-fixes-01BdAMnXESBbYRHsFwFiRPzj
npm ci --production
npm run build

# Option B: Deploy from dist
cd /path/to/NodeDaemon
npm run build
cp -r dist/* /path/to/staging/nodedaemon/

# Make executables
chmod +x /path/to/staging/nodedaemon/bin/nodedaemon
```

### Step 3: Start Daemon

```bash
# Start daemon in foreground (for initial verification)
nodedaemon daemon

# OR start in background
nodedaemon daemon --detach

# Verify startup
nodedaemon status
```

### Step 4: Verify Deployment

```bash
# Check daemon status
nodedaemon status

# Check version
nodedaemon --version

# Verify IPC socket exists
ls -la ~/.nodedaemon/nodedaemon.sock
# Should show: srw------- (permissions = 0600) - BUG-009 fix

# Check logs
tail -f ~/.nodedaemon/daemon.log
```

---

## ✅ Post-Deployment Verification

### Critical Bug Fixes Verification

#### 1. BUG-001 & BUG-002: Memory Leak Fixes (CRITICAL)

**Test watch mode interval cleanup**:
```bash
# Start watch mode
nodedaemon list -w

# Let it run for 10 seconds
sleep 10

# Press Ctrl+C to exit

# Check if intervals are cleaned up (should not see lingering node processes)
ps aux | grep nodedaemon | grep -v grep
# Should only show main daemon, not multiple CLI processes

# Repeat for follow mode
nodedaemon logs test-app -f
# Wait 10 seconds, then Ctrl+C
```

**Expected**: No memory leaks, clean exit

#### 2. BUG-003: Command Injection Fix (CRITICAL)

**Test process metrics collection**:
```bash
# Start a test process
nodedaemon start test-app.js

# Wait for health monitoring to collect metrics
sleep 60

# Check daemon logs for any command injection errors
grep -i "error\|injection" ~/.nodedaemon/daemon.log
```

**Expected**: No errors, metrics collected successfully

#### 3. BUG-004: Path Traversal Fix (CRITICAL)

**Test Web UI file serving**:
```bash
# Start Web UI (if applicable)
export NODEDAEMON_WEBUI_PASSWORD=test123
nodedaemon webui start -u admin -p 3000

# Try to access files
curl http://localhost:3000/index.html  # Should work
curl http://localhost:3000/../../../etc/passwd  # Should return 403 Forbidden

# Check logs
grep "403\|Forbidden" ~/.nodedaemon/logs/webui.log
```

**Expected**: Path traversal blocked, only static files served

#### 4. BUG-005: State File Corruption Fix (CRITICAL)

**Test concurrent state writes**:
```bash
# Start multiple processes rapidly
for i in {1..10}; do
  nodedaemon start test-app-$i.js &
done
wait

# Check state file integrity
cat ~/.nodedaemon/state.json | jq .
# Should parse successfully without errors

# Verify all processes recorded
nodedaemon list
```

**Expected**: State file valid JSON, all processes tracked

#### 5. BUG-007: IPC Message Fragmentation Fix (HIGH)

**Test large message handling**:
```bash
# Send large list request
nodedaemon list --json > /dev/null

# Send multiple rapid requests
for i in {1..20}; do
  nodedaemon status &
done
wait

# Check for parsing errors
grep -i "invalid json\|parse error" ~/.nodedaemon/daemon.log
```

**Expected**: No parsing errors, all messages handled correctly

#### 6. BUG-009: Async chmod Fix (HIGH)

**Test daemon startup performance**:
```bash
# Stop daemon
nodedaemon shutdown

# Measure startup time
time nodedaemon daemon --detach
# Should complete in < 2 seconds on normal filesystem

# Verify socket permissions
ls -la ~/.nodedaemon/nodedaemon.sock
# Should show: srw------- (0600 permissions)
```

**Expected**: Fast startup, no blocking

#### 7. BUG-010: Timer Leak Fix (HIGH)

**Test process startup timer cleanup**:
```bash
# Start many processes
for i in {1..20}; do
  nodedaemon start test-app-$i.js
  sleep 1
done

# Check for timer leaks (monitor memory over 5 minutes)
ps aux | grep "nodedaemon daemon" | awk '{print $6}'
# Note the RSS memory, wait 5 minutes, check again
# Should not grow significantly

# Stop all processes
nodedaemon stop --all
```

**Expected**: No memory growth from accumulated timers

#### 8. BUG-011: Password Security Fix (HIGH) ⚠️ BREAKING CHANGE

**Test new password handling**:
```bash
# OLD METHOD (should fail if attempted)
# nodedaemon webui start -u admin --password secret
# Expected: Error - flag not recognized

# NEW METHOD (correct)
export NODEDAEMON_WEBUI_PASSWORD=test123
nodedaemon webui start -u admin -p 3000

# Verify password not in process args
ps aux | grep nodedaemon | grep -v grep
# Should NOT show password in output

# Verify Web UI works
curl -u admin:test123 http://localhost:3000/api/processes
# Should return 200 OK
```

**Expected**: Password secure, not visible in ps

#### 9. BUG-013: Cluster Race Condition Fix (HIGH)

**Test cluster mode**:
```bash
# Start cluster process
nodedaemon start test-cluster.js -i 4

# Start another cluster process rapidly
nodedaemon start test-cluster2.js -i 4

# Verify all workers started correctly
nodedaemon status
# Should show 8 total workers (4 per app)

# Check logs for configuration errors
grep -i "cluster\|configuration" ~/.nodedaemon/daemon.log
```

**Expected**: No cluster configuration conflicts

---

## 📊 Monitoring Plan

### 1. Real-time Monitoring (First 30 minutes)

Monitor these metrics immediately after deployment:

```bash
# Watch daemon logs
tail -f ~/.nodedaemon/daemon.log

# Monitor memory usage
watch -n 10 'ps aux | grep "nodedaemon daemon" | awk "{print \$6/1024 \" MB\"}"'

# Monitor process list
watch -n 5 'nodedaemon list'

# Check error rate
watch -n 30 'grep -c ERROR ~/.nodedaemon/daemon.log'
```

### 2. Short-term Monitoring (First 24 hours)

**Metrics to track**:
- Memory usage (should be stable, no leaks)
- Process restart count (should be normal)
- IPC connection errors (should be zero)
- State file corruption (should be zero)

**Alert thresholds**:
- Memory growth > 10% per hour → Investigate
- Process restart rate > 5 per hour → Investigate
- Any state file errors → Immediate rollback

### 3. Medium-term Monitoring (24-48 hours)

**Soak testing metrics**:
- Total daemon uptime
- Peak memory usage
- Number of process starts/stops
- Web UI authentication success rate

---

## 🔍 Health Checks

### Automated Health Check Script

Create `/tmp/health-check.sh`:

```bash
#!/bin/bash

echo "=== NodeDaemon Health Check ==="
echo "Date: $(date)"
echo ""

# Check daemon running
echo "1. Daemon Status:"
nodedaemon status > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "   ✅ Daemon is running"
else
    echo "   ❌ Daemon is not running"
    exit 1
fi

# Check memory usage
echo "2. Memory Usage:"
MEM=$(ps aux | grep "nodedaemon daemon" | grep -v grep | awk '{print $6/1024}')
echo "   Current: ${MEM} MB"
if (( $(echo "$MEM > 500" | bc -l) )); then
    echo "   ⚠️  High memory usage detected"
fi

# Check state file
echo "3. State File Integrity:"
cat ~/.nodedaemon/state.json | jq . > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "   ✅ State file valid"
else
    echo "   ❌ State file corrupted"
    exit 1
fi

# Check IPC socket
echo "4. IPC Socket:"
if [ -S ~/.nodedaemon/nodedaemon.sock ]; then
    PERMS=$(stat -c "%a" ~/.nodedaemon/nodedaemon.sock 2>/dev/null || stat -f "%OLp" ~/.nodedaemon/nodedaemon.sock)
    if [ "$PERMS" = "600" ]; then
        echo "   ✅ Socket exists with correct permissions (600)"
    else
        echo "   ⚠️  Socket permissions incorrect: $PERMS"
    fi
else
    echo "   ❌ IPC socket not found"
    exit 1
fi

# Check process count
echo "5. Managed Processes:"
PROC_COUNT=$(nodedaemon list --json | jq '.processes | length')
echo "   Currently managing: $PROC_COUNT processes"

# Check error rate
echo "6. Error Rate:"
ERROR_COUNT=$(grep -c ERROR ~/.nodedaemon/daemon.log 2>/dev/null || echo 0)
echo "   Total errors in log: $ERROR_COUNT"

echo ""
echo "=== Health Check Complete ==="
```

**Run health checks**:
```bash
chmod +x /tmp/health-check.sh
/tmp/health-check.sh
```

**Schedule periodic checks**:
```bash
# Run every 5 minutes for first hour
watch -n 300 /tmp/health-check.sh
```

---

## 🔄 Rollback Plan

### When to Rollback

Rollback immediately if any of these occur:
- ❌ Daemon fails to start
- ❌ State file corruption detected
- ❌ Memory leak observed (>20% growth in 1 hour)
- ❌ Multiple process crashes
- ❌ IPC communication failures

### Rollback Steps

```bash
# 1. Stop new version
nodedaemon shutdown

# 2. Restore backup
rm -rf /path/to/staging/nodedaemon
cp -r /path/to/backup/nodedaemon-TIMESTAMP /path/to/staging/nodedaemon

# 3. Restore state
rm -rf ~/.nodedaemon
cp -r ~/.nodedaemon-backup-TIMESTAMP ~/.nodedaemon

# 4. Start old version
cd /path/to/staging/nodedaemon
./bin/nodedaemon daemon --detach

# 5. Verify rollback
nodedaemon status
nodedaemon list

# 6. Report issue
echo "Rollback completed at $(date)" >> /tmp/rollback-log.txt
```

---

## 📝 Post-Deployment Checklist

### Immediate (< 1 hour)

- [ ] All health checks passing
- [ ] No errors in daemon log
- [ ] Memory usage stable
- [ ] All critical bug fixes verified
- [ ] Web UI accessible (if applicable)
- [ ] Password authentication working with env variable

### Short-term (< 24 hours)

- [ ] No state file corruption
- [ ] No memory leaks detected
- [ ] Process restarts within normal range
- [ ] IPC communication stable
- [ ] Cluster mode working correctly

### Medium-term (24-48 hours)

- [ ] System stability confirmed
- [ ] Performance metrics acceptable
- [ ] No regression issues found
- [ ] Ready for production promotion

---

## 📞 Contacts & Escalation

### Issue Severity Levels

**P0 (Critical)**: Daemon crash, data loss
- Action: Immediate rollback
- Contact: On-call engineer

**P1 (High)**: Memory leak, high error rate
- Action: Investigate, prepare rollback
- Contact: Development team lead

**P2 (Medium)**: Performance degradation
- Action: Monitor closely, investigate
- Contact: Development team

**P3 (Low)**: Minor issues, cosmetic bugs
- Action: Log for future fix
- Contact: Standard bug tracker

---

## ✅ Sign-off

**Deployment Approved By**: _________________
**Date**: _________________
**Deployment Executed By**: _________________
**Date**: _________________
**Post-Deployment Verification**: _________________
**Date**: _________________

---

## 📚 Related Documents

- `BUG_FIX_REPORT.md` - Complete bug fix documentation
- `README.md` - Project documentation
- `CLAUDE.md` - Development guidelines

---

**Version**: 1.1.1-staging
**Last Updated**: 2025-11-17
**Status**: Ready for Deployment
