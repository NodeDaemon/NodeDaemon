# Changelog

All notable changes to NodeDaemon will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2025-07-23

### Fixed
- Fixed daemon startup issue where wrong script file was being executed
- Added daemon startup verification to ensure it's running before reporting success
- Improved error messages when daemon fails to start

### Changed
- Daemon now properly starts from `daemon/index.js` instead of `daemon/NodeDaemonCore.js`

## [1.0.0] - 2025-07-23

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