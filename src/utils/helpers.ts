import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, statSync } from 'fs';
import { dirname } from 'path';
import { MAX_PROCESS_ID_LENGTH, MAX_PROCESS_NAME_LENGTH } from './constants';

export function generateId(): string {
  return randomUUID();
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function ensureFileDir(filePath: string): void {
  ensureDir(dirname(filePath));
}

export function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function parseMemoryString(memory: string): number {
  if (!memory || typeof memory !== 'string') {
    throw new Error('Invalid memory format: must be a non-empty string');
  }

  const units: Record<string, number> = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024
  };

  const match = memory.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid memory format: ${memory}`);
  }

  const [, value, unit] = match;
  return Math.floor(parseFloat(value) * units[unit.toUpperCase()]);
}

export function formatMemory(bytes: number): string {
  // Handle negative and zero values
  if (bytes <= 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function calculateExponentialBackoff(
  restartCount: number,
  baseDelay: number,
  maxDelay: number
): number {
  // Validate delays are non-negative
  if (baseDelay < 0 || maxDelay < 0) {
    throw new Error('Delays must be non-negative');
  }

  // Fix BUG-012: Prevent integer overflow in exponential calculation
  const delay = baseDelay * Math.pow(2, restartCount);

  // Check for overflow (NaN or Infinity)
  if (!Number.isFinite(delay) || delay > Number.MAX_SAFE_INTEGER) {
    return maxDelay;
  }

  return Math.min(delay, maxDelay);
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    
    timeout = setTimeout(() => {
      timeout = null;
      func.apply(null, args);
    }, wait);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func.apply(null, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

export function sanitizeProcessName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_');
}

export function validateProcessId(processId: any): void {
  // Fix SECURITY-004: Validate process ID input
  if (!processId || typeof processId !== 'string') {
    throw new Error('Process ID must be a non-empty string');
  }

  if (processId.length > MAX_PROCESS_ID_LENGTH) {
    throw new Error(`Process ID exceeds maximum length of ${MAX_PROCESS_ID_LENGTH} characters`);
  }

  // Only allow alphanumeric characters, hyphens, and underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(processId)) {
    throw new Error('Process ID must contain only alphanumeric characters, hyphens, and underscores');
  }

  // Prevent prototype pollution attacks
  if (processId === '__proto__' || processId === 'constructor' || processId === 'prototype') {
    throw new Error('Invalid process ID: reserved keyword');
  }
}

export function validateProcessName(processName: any): void {
  // Fix SECURITY-004: Validate process name input
  if (!processName || typeof processName !== 'string') {
    throw new Error('Process name must be a non-empty string');
  }

  if (processName.length > MAX_PROCESS_NAME_LENGTH) {
    throw new Error(`Process name exceeds maximum length of ${MAX_PROCESS_NAME_LENGTH} characters`);
  }

  // More permissive than ID - allow spaces and common punctuation
  if (!/^[a-zA-Z0-9_\- .]+$/.test(processName)) {
    throw new Error('Process name contains invalid characters');
  }
}

export function getSafeEnvironmentVariables(): Record<string, string> {
  // Fix SECURITY-006: Only expose safe environment variables to child processes
  const safeEnvVars = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'TMPDIR',
    'TEMP',
    'TMP',
    'NODE_ENV',
    'NODE_OPTIONS'
  ];

  const safeEnv: Record<string, string> = {};

  for (const key of safeEnvVars) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key]!;
    }
  }

  return safeEnv;
}

export function validateProcessConfig(config: any): void {
  if (!config || typeof config !== 'object') {
    throw new Error('Process config must be an object');
  }

  if (!config.script || typeof config.script !== 'string') {
    throw new Error('Process config must have a script property');
  }

  if (!isFile(config.script)) {
    throw new Error(`Script file does not exist: ${config.script}`);
  }

  // Validate process name if provided
  if (config.name !== undefined) {
    validateProcessName(config.name);
  }

  if (config.instances !== undefined) {
    if (config.instances !== 'max' &&
        (!Number.isInteger(config.instances) || config.instances < 1)) {
      throw new Error('instances must be a positive integer or "max"');
    }
  }

  if (config.maxRestarts !== undefined) {
    if (!Number.isInteger(config.maxRestarts) || config.maxRestarts < 0) {
      throw new Error('maxRestarts must be a non-negative integer');
    }
  }

  // Validate timing parameters
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