import { join } from 'path';
import { homedir } from 'os';

export const NODEDAEMON_DIR = join(homedir(), '.nodedaemon');
export const STATE_FILE = join(NODEDAEMON_DIR, 'state.json');
export const LOG_DIR = join(NODEDAEMON_DIR, 'logs');
export const DAEMON_LOG = join(LOG_DIR, 'daemon.log');

export const IPC_SOCKET_PATH = process.platform === 'win32' 
  ? '\\\\.\\pipe\\nodedaemon'
  : join(NODEDAEMON_DIR, 'daemon.sock');

export const DEFAULT_CONFIG = {
  instances: 1,
  maxRestarts: 10,
  restartDelay: 1000,
  maxRestartDelay: 30000,
  minUptime: 10000, // 10 seconds - minimum uptime to reset restart counter
  autoRestartOnCrash: true,
  autoRestartOnHighMemory: false,
  autoRestartOnHighCpu: false,
  memoryThreshold: '512MB',
  cpuThreshold: 80
} as const;

export const RESTART_STRATEGIES = {
  EXPONENTIAL_BACKOFF: 'exponential',
  FIXED_DELAY: 'fixed',
  LINEAR_BACKOFF: 'linear'
} as const;

export const PROCESS_EVENTS = {
  START: 'start',
  STOP: 'stop',
  RESTART: 'restart',
  CRASH: 'crash',
  EXIT: 'exit'
} as const;

export const LOG_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info', 
  WARN: 'warn',
  ERROR: 'error'
} as const;

export const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_LOG_FILES = 5;
export const LOG_BUFFER_SIZE = 1000;

export const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
export const MEMORY_THRESHOLD = 512 * 1024 * 1024; // 512MB
export const CPU_THRESHOLD = 80; // 80%

export const GRACEFUL_SHUTDOWN_TIMEOUT = 30000; // 30 seconds
export const FORCE_KILL_TIMEOUT = 5000; // 5 seconds

export const FILE_WATCH_DEBOUNCE = 100; // 100ms
export const FILE_WATCH_IGNORE = [
  'node_modules/**',
  '.git/**',
  '*.log',
  '*.tmp',
  '.DS_Store',
  'Thumbs.db'
];

export const SIGNALS = {
  SIGTERM: 'SIGTERM',
  SIGINT: 'SIGINT', 
  SIGKILL: 'SIGKILL',
  SIGHUP: 'SIGHUP'
} as const;