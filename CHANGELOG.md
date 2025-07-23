# Changelog

All notable changes to NodeDaemon will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2025-07-23

### Added
- **Web UI Dashboard** - Real-time process monitoring and control interface
  - Live CPU, memory, and uptime metrics with WebSocket updates
  - Interactive process control (start, stop, restart, reload)
  - Beautiful dark theme responsive design
  - Zero external dependencies - built-in HTTP and WebSocket servers
  - Authentication support with username/password
  - Configurable port and host binding
- New CLI commands for Web UI management:
  - `nodedaemon webui start` - Start the Web UI server
  - `nodedaemon webui stop` - Stop the Web UI server  
  - `nodedaemon webui status` - Check Web UI status
- WebSocket protocol implementation without external packages
- RESTful API endpoints for process management
- Real-time log streaming support (foundation laid)

### Fixed
- File watching now correctly detects changes and triggers restarts
  - Fixed path comparison issue (relative vs absolute paths)
  - Removed incorrect unwatch behavior in FileWatcher
- Memory usage reporting on Windows systems
  - Fixed WMIC output parsing for accurate memory metrics
  - Corrected array indices for memory data extraction
- Process metrics now properly aggregated at process level
  - CPU and memory data correctly summed across instances
  - Uptime calculated from instance start time

### Changed
- Enhanced API response format to include aggregated metrics
- Improved health monitoring with proper metric updates
- Better error handling in Web UI operations

## [1.0.2] - 2025-07-22

### Added
- Enhanced process health monitoring with more detailed metrics
- Improved daemon stability and performance
- Better error handling for edge cases
- Smart restart mechanism with exponential backoff
- Restart counter reset after successful minimum uptime
- Permanent stop after reaching max restart attempts
- New `--min-uptime` option to configure restart counter reset threshold
- Auto-restart on high memory/CPU usage with configurable thresholds
- New options: `--auto-restart-memory`, `--auto-restart-cpu`, `--memory-threshold`, `--cpu-threshold`
- Environment file support with `--env-file` option (supports .env, .env.local, etc.)
- Graceful reload for zero-downtime restarts in cluster mode with `--graceful` flag

### Fixed
- Minor bug fixes and improvements
- Memory usage optimization for long-running processes
- Prevented restart loops for processes with port conflicts or critical errors

### Changed
- Updated internal dependencies for better compatibility
- Improved logging for restart attempts with detailed backoff information
- Default minimum uptime set to 10 seconds for restart counter reset

## [1.0.1] - 2025-07-22

### Fixed
- Fixed daemon startup issue where wrong script file was being executed
- Added daemon startup verification to ensure it's running before reporting success
- Improved error messages when daemon fails to start

### Changed
- Daemon now properly starts from `daemon/index.js` instead of `daemon/NodeDaemonCore.js`

## [1.0.0] - 2025-07-22

### Added
- **Core Features**
  - Process management (start, stop, restart, list)
  - Cluster mode support with automatic load balancing
  - File watching with intelligent debouncing
  - Daemon mode for background operation
  - IPC communication via Unix sockets/Windows named pipes
  - State persistence across daemon restarts
  - Comprehensive logging with rotation and compression
  - Health monitoring with automatic restarts
  - Graceful shutdown handling

- **CLI Commands**
  - `daemon` - Start the daemon process
  - `start` - Start a new process
  - `stop` - Stop a process
  - `restart` - Restart a process
  - `list` - List all processes
  - `status` - Show process or daemon status
  - `logs` - View process logs
  - `shutdown` - Shutdown the daemon

- **Process Options**
  - `--name` - Custom process name
  - `--instances` - Number of instances (supports 'max')
  - `--watch` - Enable file watching
  - `--env` - Custom environment variables
  - `--cwd` - Working directory
  - `--max-memory` - Memory limit
  - `--max-restarts` - Maximum restart attempts
  - `--restart-delay` - Delay between restarts

- **Zero Dependencies**
  - Built entirely with Node.js built-in modules
  - No external npm packages required
  - Single-file executable distribution

- **Platform Support**
  - Full Windows support with named pipes
  - Linux/macOS support with Unix sockets
  - Cross-platform process management

- **Developer Experience**
  - TypeScript source with full type safety
  - Comprehensive test suite
  - Detailed API documentation
  - Example configurations

### Security
- Input validation on all IPC messages
- Path traversal protection
- Secure Unix socket permissions (0600)
- Process isolation

### Performance
- Sub-second startup for 100 processes
- Minimal memory footprint (<50MB daemon)
- Non-blocking I/O throughout
- Efficient file watching

## Links

- Website: https://nodedaemon.com
- GitHub: https://github.com/nodedaemon/nodedaemon
- Issues: https://github.com/nodedaemon/nodedaemon/issues