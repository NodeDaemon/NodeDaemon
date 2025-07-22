# NodeDaemon API Documentation

## Table of Contents

- [CLI Commands](#cli-commands)
- [Configuration](#configuration)
- [Process Management](#process-management)
- [IPC Protocol](#ipc-protocol)
- [Environment Variables](#environment-variables)
- [Error Codes](#error-codes)

## CLI Commands

### daemon

Start the NodeDaemon background service.

```bash
nodedaemon daemon [options]
```

Options:
- `-d, --detach` - Run daemon in background (detached mode)
- `--log-level <level>` - Set logging level: debug, info, warn, error (default: info)
- `--socket-path <path>` - Custom IPC socket path (default: ~/.nodedaemon/daemon.sock)

Examples:
```bash
# Start daemon in foreground
nodedaemon daemon

# Start daemon in background
nodedaemon daemon -d

# Start with debug logging
nodedaemon daemon --log-level debug
```

### start

Start a new process managed by NodeDaemon.

```bash
nodedaemon start <script> [options]
```

Options:
- `-n, --name <name>` - Process name for identification
- `-i, --instances <count>` - Number of instances (1, 2, 4, or 'max' for CPU count)
- `-w, --watch` - Enable file watching for auto-restart
- `--watch-paths <paths>` - Specific paths to watch (comma-separated)
- `-e, --env <KEY=VALUE>` - Environment variables (can be used multiple times)
- `--env-file <file>` - Load environment from file (.env, .env.local, etc)
- `--cwd <path>` - Working directory for the process
- `--args <args>` - Arguments to pass to the script
- `--interpreter <cmd>` - Custom interpreter (default: node)
- `--max-memory <size>` - Memory limit before restart (e.g., 512MB, 1GB)
- `--max-restarts <count>` - Maximum restart attempts (default: 10)
- `--restart-delay <ms>` - Delay between restarts in milliseconds (default: 1000)
- `--min-uptime <ms>` - Minimum uptime to reset restart counter (default: 10000)
- `--auto-restart-memory` - Auto-restart on high memory usage
- `--auto-restart-cpu` - Auto-restart on high CPU usage
- `--memory-threshold <size>` - Memory threshold for auto-restart (default: 512MB)
- `--cpu-threshold <percent>` - CPU threshold for auto-restart (default: 80)
- `--no-daemon` - Don't auto-start daemon if not running

Examples:
```bash
# Basic start
nodedaemon start app.js --name myapp

# Start with 4 instances
nodedaemon start server.js --name api --instances 4

# Start with file watching
nodedaemon start app.js --name dev --watch

# Start with environment variables
nodedaemon start worker.js --env NODE_ENV=production --env PORT=3000

# Start with environment file
nodedaemon start app.js --env-file .env.production

# Start with memory limit
nodedaemon start app.js --max-memory 512MB --max-restarts 5

# Start with auto-restart on resource usage
nodedaemon start app.js --auto-restart-memory --memory-threshold 256MB

# Start with full production configuration
nodedaemon start api.js \
  --name prod-api \
  --instances 4 \
  --env-file .env.production \
  --auto-restart-memory \
  --auto-restart-cpu \
  --min-uptime 30000
```

### stop

Stop a running process.

```bash
nodedaemon stop <name|id> [options]
```

Options:
- `-f, --force` - Force kill the process (SIGKILL)
- `-n, --name <name>` - Stop by process name
- `--id <id>` - Stop by process ID

Examples:
```bash
# Stop by name
nodedaemon stop myapp

# Force stop
nodedaemon stop myapp --force

# Stop by ID
nodedaemon stop --id proc_abc123
```

### restart

Restart a process (stop then start).

```bash
nodedaemon restart <name|id> [options]
```

Options:
- `-g, --graceful` - Graceful reload for zero-downtime (cluster mode only)
- `-n, --name <name>` - Restart by process name
- `--id <id>` - Restart by process ID

Examples:
```bash
# Restart by name
nodedaemon restart myapp

# Graceful reload (zero-downtime)
nodedaemon restart myapp --graceful

# Restart by ID
nodedaemon restart proc_abc123
```

### list

List all managed processes.

```bash
nodedaemon list [options]
```

Options:
- `-f, --format <format>` - Output format: table, json (default: table)
- `--json` - Shorthand for --format json
- `-w, --watch` - Auto-refresh the list

Examples:
```bash
# List all processes
nodedaemon list

# List as JSON
nodedaemon list --json

# Watch process list
nodedaemon list --watch
```

### status

Show detailed status of a process or the daemon.

```bash
nodedaemon status [name|id] [options]
```

Options:
- `-n, --name <name>` - Status by process name
- `--id <id>` - Status by process ID
- `--json` - Output as JSON

Examples:
```bash
# Show daemon status
nodedaemon status

# Show process status
nodedaemon status myapp

# Show as JSON
nodedaemon status myapp --json
```

### logs

View process logs.

```bash
nodedaemon logs <name|id> [options]
```

Options:
- `-n, --name <name>` - Logs by process name
- `--id <id>` - Logs by process ID
- `-l, --lines <count>` - Number of lines to show (default: 100)
- `-f, --follow` - Follow log output in real-time
- `--json` - Output as JSON

Examples:
```bash
# Show last 100 lines
nodedaemon logs myapp

# Show last 50 lines
nodedaemon logs myapp --lines 50

# Follow logs
nodedaemon logs myapp --follow

# Logs as JSON
nodedaemon logs myapp --json
```

### shutdown

Gracefully shutdown the daemon and all processes.

```bash
nodedaemon shutdown
```

## Configuration

### Process Configuration Object

When starting processes, the following configuration is used:

```typescript
interface ProcessConfig {
  // Required
  name: string;           // Process identifier
  script: string;         // Script path to execute
  
  // Process options
  instances: number | 'max';  // Number of instances
  args: string[];            // Script arguments
  interpreter: string;       // Script interpreter (default: 'node')
  cwd: string;              // Working directory
  
  // Environment
  env: Record<string, string>;  // Environment variables
  
  // Auto-restart
  autorestart: boolean;      // Auto-restart on crash (default: true)
  maxRestarts: number;       // Max restart attempts (default: 15)
  restartDelay: number;      // Restart delay in ms (default: 1000)
  
  // File watching
  watch: boolean;            // Enable file watching
  watchPaths: string[];      // Paths to watch
  ignorePatterns: string[];  // Patterns to ignore
  
  // Resource limits
  maxMemory: string;         // Memory limit (e.g., '512MB')
  
  // Timeouts
  killTimeout: number;       // Force kill timeout (default: 1600ms)
}
```

### Configuration File

You can use a configuration file instead of CLI arguments:

```javascript
// nodedaemon.config.js
module.exports = {
  apps: [
    {
      name: 'web-server',
      script: 'server.js',
      instances: 4,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      maxMemory: '1GB',
      maxRestarts: 10
    },
    {
      name: 'worker',
      script: 'worker.js',
      instances: 2,
      autorestart: true,
      watch: true,
      watchPaths: ['src', 'lib'],
      ignorePatterns: ['*.log', 'node_modules']
    }
  ]
};
```

Start with configuration:
```bash
nodedaemon start nodedaemon.config.js
```

## Process Management

### Process States

Processes can be in the following states:

- `starting` - Process is being started
- `running` - Process is running normally
- `stopping` - Process is being stopped
- `stopped` - Process has been stopped
- `crashed` - Process crashed unexpectedly
- `errored` - Process encountered an error

### Process Lifecycle

1. **Start**: Process is spawned with specified configuration
2. **Running**: Process is active and monitored
3. **Health Check**: Memory and responsiveness monitored
4. **Restart**: Automatic restart on crash or file change
5. **Stop**: Graceful shutdown with SIGTERM, then SIGKILL if needed

### Cluster Mode

When `instances` > 1, NodeDaemon uses Node.js cluster module:

- Load balancing across worker processes
- Automatic respawn of crashed workers
- Zero-downtime restarts
- Shared server ports

## IPC Protocol

NodeDaemon uses a JSON-based IPC protocol over Unix sockets (or Windows named pipes).

### Message Format

Request:
```json
{
  "id": "unique-request-id",
  "type": "request",
  "command": "start|stop|list|status|logs|shutdown",
  "timestamp": 1234567890,
  "payload": {
    // Command-specific data
  }
}
```

Response:
```json
{
  "id": "unique-request-id",
  "type": "response",
  "command": "start|stop|list|status|logs|shutdown",
  "timestamp": 1234567890,
  "success": true,
  "data": {
    // Response data
  },
  "error": "Error message if success=false"
}
```

### Commands

#### start
```json
{
  "command": "start",
  "payload": {
    "name": "myapp",
    "script": "app.js",
    "instances": 4,
    "env": { "NODE_ENV": "production" }
  }
}
```

#### stop
```json
{
  "command": "stop",
  "payload": {
    "name": "myapp",
    "force": false
  }
}
```

#### list
```json
{
  "command": "list",
  "payload": {}
}
```

Response includes array of process info:
```json
{
  "data": {
    "processes": [
      {
        "id": "proc_abc123",
        "name": "myapp",
        "script": "app.js",
        "status": "running",
        "pid": 12345,
        "uptime": 3600000,
        "restarts": 0,
        "memory": 67108864,
        "cpu": 15.5
      }
    ]
  }
}
```

## Environment Variables

### NodeDaemon Environment Variables

- `NODEDAEMON_HOME` - Custom home directory (default: ~/.nodedaemon)
- `NODEDAEMON_SOCKET` - Custom socket path
- `NODEDAEMON_LOG_LEVEL` - Default log level
- `NODEDAEMON_NO_COLOR` - Disable colored output

### Process Environment Variables

All processes inherit the daemon's environment plus:

- `NODEDAEMON` - Set to '1' for managed processes
- `NODEDAEMON_PROCESS_ID` - Unique process ID
- `NODEDAEMON_PROCESS_NAME` - Process name
- `NODEDAEMON_INSTANCE_ID` - Instance ID (for cluster mode)

## Error Codes

NodeDaemon uses specific exit codes:

- `0` - Success
- `1` - General error
- `2` - Invalid arguments
- `3` - Daemon not running
- `4` - Process not found
- `5` - Permission denied
- `6` - Resource limit exceeded
- `7` - Timeout
- `8` - Configuration error

## Links

- Website: https://nodedaemon.com
- GitHub: https://github.com/nodedaemon/nodedaemon