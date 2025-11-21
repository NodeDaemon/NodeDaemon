export interface ProcessConfig {
  script: string;
  name?: string;
  instances?: number | 'max';
  watch?: boolean | string[];
  env?: Record<string, string>;
  envFile?: string;
  cwd?: string;
  args?: string[];
  interpreter?: string;
  maxMemory?: string;
  maxRestarts?: number;
  restartDelay?: number;
  maxRestartDelay?: number;
  minUptime?: number;
  autoRestartOnCrash?: boolean;
  autoRestartOnHighMemory?: boolean;
  autoRestartOnHighCpu?: boolean;
  memoryThreshold?: string; // e.g., "512MB"
  cpuThreshold?: number; // percentage, e.g., 80
}

export interface ProcessInfo {
  id: string;
  name: string;
  script: string;
  pid?: number;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'errored' | 'crashed' | 'reloading';
  uptime?: number;
  restarts: number;
  memory?: number;
  cpu?: number;
  instances: ProcessInstance[];
  config: ProcessConfig;
  createdAt: number;
  updatedAt: number;
}

export interface ProcessInstance {
  id: string;
  pid?: number;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'errored' | 'crashed';
  memory?: number;
  cpu?: number;
  uptime?: number;
  restarts: number;
  lastRestart?: number;
}

export interface IPCMessage {
  id: string;
  type: 'start' | 'stop' | 'restart' | 'list' | 'logs' | 'status' | 'ping' | 'shutdown' | 'webui';
  data?: any;
  timestamp: number;
}

export interface IPCResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
  timestamp: number;
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  processId?: string;
  processName?: string;
  message: string;
  data?: any;
}

export interface DaemonState {
  processes: Map<string, ProcessInfo>;
  version: string;
  startedAt: number;
  pid: number;
  webUIConfig?: WebUIConfig;
}

export interface FileWatchEvent {
  type: 'add' | 'change' | 'unlink';
  filename: string;
  path: string;
  stats?: any;
}

export interface HealthCheckResult {
  processId: string;
  memory: number;
  cpu: number;
  uptime: number;
  healthy: boolean;
  issues?: string[];
}

export type ProcessStrategy = 'fork' | 'spawn' | 'cluster';

export interface ClusterOptions {
  instances: number;
  strategy: ProcessStrategy;
}

export interface WebUIConfig {
  enabled: boolean;
  port: number;
  host: string;
  auth?: {
    username: string;
    password: string;
  };
}

export interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'command' | 'event';
  action?: string;
  processId?: string;
  data?: any;
}

export interface WebSocketEvent {
  type: 'process_update' | 'log' | 'metric' | 'status' | 'connected';
  data?: any;
  timestamp: number;
  clientId?: string; // For 'connected' event
  csrfToken?: string; // Security: CSRF token sent with 'connected' event
}