import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

export interface EnvConfig {
  [key: string]: string;
}

export function loadEnvFile(filePath: string): EnvConfig {
  const envConfig: EnvConfig = {};
  
  if (!existsSync(filePath)) {
    return envConfig;
  }
  
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Skip empty lines and comments
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }
      
      // Parse KEY=VALUE format
      const separatorIndex = trimmedLine.indexOf('=');
      if (separatorIndex > 0) {
        const key = trimmedLine.substring(0, separatorIndex).trim();
        const value = trimmedLine.substring(separatorIndex + 1).trim();
        
        // Remove surrounding quotes if present
        const unquotedValue = value.replace(/^["']|["']$/g, '');
        
        envConfig[key] = unquotedValue;
      }
    }
  } catch (error) {
    // Silently fail if env file cannot be read
  }
  
  return envConfig;
}

export function findEnvFile(scriptPath: string, envFile?: string): string | null {
  const scriptDir = dirname(scriptPath);
  
  // If specific env file is provided
  if (envFile) {
    const envPath = join(scriptDir, envFile);
    return existsSync(envPath) ? envPath : null;
  }
  
  // Look for common env file names in order of priority
  const envFiles = [
    '.env.local',
    '.env.development',
    '.env.production',
    '.env'
  ];
  
  // Check current directory first
  for (const file of envFiles) {
    const envPath = join(process.cwd(), file);
    if (existsSync(envPath)) {
      return envPath;
    }
  }
  
  // Then check script directory
  for (const file of envFiles) {
    const envPath = join(scriptDir, file);
    if (existsSync(envPath)) {
      return envPath;
    }
  }
  
  return null;
}

export function mergeEnvConfigs(...configs: EnvConfig[]): EnvConfig {
  const merged: EnvConfig = {};
  
  for (const config of configs) {
    Object.assign(merged, config);
  }
  
  return merged;
}