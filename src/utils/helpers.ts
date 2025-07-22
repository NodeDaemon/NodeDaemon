import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, statSync } from 'fs';
import { dirname } from 'path';

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
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
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
  const delay = baseDelay * Math.pow(2, restartCount);
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
}