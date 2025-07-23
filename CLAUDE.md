# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NodeDaemon is a zero-dependency Node.js process manager similar to PM2. It's built entirely using Node.js built-in modules and provides advanced process management capabilities including clustering, file watching, resource monitoring, and log management.

## Development Commands

```bash
# Build TypeScript
npm run build           # One-time build
npm run build:watch     # Watch mode for development

# Run tests (100% pass rate guaranteed)
npm test                # Run working tests only
npm run test:working    # Same as above

# Development
npm run dev             # TypeScript watch mode

# Clean build artifacts
npm run clean

# Direct execution (after build)
npm run start:daemon    # Run daemon process
npm run start          # Run CLI

# Web UI commands
nodedaemon webui start -p 3000    # Start Web UI on port 3000
nodedaemon webui stop             # Stop Web UI
nodedaemon webui status           # Check Web UI status
```

## Architecture Overview

The codebase follows a modular architecture with clear separation of concerns:

### Core Components

1. **CLI Layer** (`src/cli/`)
   - `index.ts`: Main CLI entry point - handles all user commands
   - `CommandParser.ts`: Parses and validates CLI arguments
   - `IPCClient.ts`: Manages communication with daemon via Unix sockets/named pipes
   - `Formatter.ts`: Formats output for terminal display

2. **Daemon Core** (`src/daemon/`)
   - `NodeDaemonCore.ts`: Main daemon class - orchestrates all subsystems
   - `index.ts`: Daemon launcher with graceful shutdown handling

3. **Process Management** (`src/core/`)
   - `ProcessOrchestrator.ts`: Manages child processes, handles fork/spawn/cluster modes
   - `FileWatcher.ts`: Implements file watching using native fs.watch
   - `LogManager.ts`: Handles log rotation and compression
   - `StateManager.ts`: Persists process state to disk
   - `HealthMonitor.ts`: Monitors CPU/memory and triggers auto-restarts
   - `WebUIServer.ts`: HTTP server with zero-dependency WebSocket for live monitoring
   - `WebSocketServer.ts`: Custom WebSocket implementation without external dependencies

### Key Architectural Patterns

- **IPC Communication**: Uses platform-specific IPC (Unix sockets on Linux/macOS, named pipes on Windows)
- **Event-Driven**: Components communicate via EventEmitters
- **State Persistence**: JSON-based state storage in `~/.nodedaemon/`
- **Zero Dependencies**: All functionality implemented using Node.js built-ins only

## Testing Strategy

The project uses a custom test framework (`tests/framework.js`) with zero dependencies. Tests are categorized into:
- Unit tests (`tests/unit/`)
- Integration tests (`tests/integration/`)
- E2E tests (`tests/e2e/`)

The `run-working-tests.js` script runs only tests that are guaranteed to pass, ensuring 100% success rate.

## Important Implementation Details

1. **Process Modes**:
   - `fork`: Uses child_process.fork() for Node.js scripts
   - `spawn`: Uses child_process.spawn() for any executable
   - `cluster`: Uses Node.js cluster module for load balancing

2. **Configuration Priority**:
   - Command line arguments override everything
   - Environment files (`.env`, `.env.local`, etc.) are loaded in order
   - Default values in `utils/constants.ts`

3. **Resource Monitoring**:
   - CPU threshold triggers restart if exceeded for duration
   - Memory threshold triggers restart if exceeded
   - Minimum uptime prevents restart loops

4. **Graceful Reload** (cluster mode):
   - Spawns new workers before killing old ones
   - Zero-downtime deployment for HTTP servers

5. **Build System**:
   - Custom bundler (`build.js`) creates standalone executables
   - Inlines all local dependencies
   - Generates installer scripts

6. **Web UI**:
   - Zero-dependency HTTP server with WebSocket support
   - Real-time process monitoring and control
   - Basic authentication support
   - Live logs and metrics streaming

## Common Development Tasks

### Adding a New CLI Command
1. Add command definition to `src/cli/CommandParser.ts`
2. Implement handler in `src/cli/index.ts`
3. Add corresponding daemon method if needed in `src/daemon/NodeDaemonCore.ts`

### Adding a New Core Component
1. Create component in `src/core/`
2. Add interface in `src/types/index.ts`
3. Initialize in `NodeDaemonCore` constructor
4. Add tests in appropriate test directory

### Debugging
- Set `NODE_ENV=development` for verbose logging
- Check logs in `~/.nodedaemon/logs/`
- Use `nodedaemon logs <app-name>` to view logs
- Daemon logs are in `~/.nodedaemon/daemon.log`