import { createWriteStream, existsSync, readdirSync, statSync, unlinkSync, renameSync } from 'fs';
import { join } from 'path';
import { createGzip } from 'zlib';
import { WriteStream } from 'fs';
import { EventEmitter } from 'events';
import { LogEntry } from '../types';
import { ensureDir } from '../utils/helpers';
import { 
  LOG_DIR, 
  MAX_LOG_SIZE, 
  MAX_LOG_FILES, 
  LOG_BUFFER_SIZE,
  LOG_LEVELS 
} from '../utils/constants';

export class LogManager extends EventEmitter {
  private logStreams: Map<string, WriteStream> = new Map();
  private logBuffer: LogEntry[] = [];
  private bufferIndex: number = 0;
  private isShuttingDown: boolean = false;

  constructor() {
    super();
    ensureDir(LOG_DIR);
    this.setupMainLogStream();
  }

  private setupMainLogStream(): void {
    const mainLogPath = join(LOG_DIR, 'daemon.log');
    this.createLogStream('daemon', mainLogPath);
  }

  private createLogStream(name: string, filePath: string): WriteStream {
    if (this.logStreams.has(name)) {
      this.logStreams.get(name)?.end();
    }

    const stream = createWriteStream(filePath, { flags: 'a' });
    stream.on('error', (error) => {
      console.error(`Log stream error for ${name}:`, error);
    });

    this.logStreams.set(name, stream);
    return stream;
  }

  public log(entry: LogEntry): void {
    if (this.isShuttingDown) return;

    this.addToBuffer(entry);
    
    // Emit log event for WebUI
    this.emit('log', entry);
    
    const logLine = this.formatLogEntry(entry);
    const streamName = entry.processId || 'daemon';
    
    let stream = this.logStreams.get(streamName);
    if (!stream) {
      const logPath = join(LOG_DIR, `${streamName}.log`);
      stream = this.createLogStream(streamName, logPath);
    }

    stream.write(logLine + '\n', (error) => {
      if (error) {
        console.error(`Failed to write log for ${streamName}:`, error);
      }
    });

    this.checkLogRotation(streamName);
  }

  public info(message: string, data?: any, processId?: string): void {
    this.log({
      timestamp: Date.now(),
      level: 'info',
      processId,
      message,
      data
    });
  }

  public warn(message: string, data?: any, processId?: string): void {
    this.log({
      timestamp: Date.now(),
      level: 'warn', 
      processId,
      message,
      data
    });
  }

  public error(message: string, data?: any, processId?: string): void {
    this.log({
      timestamp: Date.now(),
      level: 'error',
      processId,
      message,
      data
    });
  }

  public debug(message: string, data?: any, processId?: string): void {
    this.log({
      timestamp: Date.now(),
      level: 'debug',
      processId,
      message,
      data
    });
  }

  private addToBuffer(entry: LogEntry): void {
    if (this.logBuffer.length < LOG_BUFFER_SIZE) {
      this.logBuffer.push(entry);
    } else {
      this.logBuffer[this.bufferIndex] = entry;
      this.bufferIndex = (this.bufferIndex + 1) % LOG_BUFFER_SIZE;
    }
  }

  public getRecentLogs(count: number = 100, processId?: string): LogEntry[] {
    let logs = [...this.logBuffer];
    
    if (processId) {
      logs = logs.filter(log => log.processId === processId);
    }
    
    return logs
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count);
  }

  private formatLogEntry(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toISOString();
    const level = entry.level.toUpperCase().padEnd(5);
    const processInfo = entry.processId ? `[${entry.processId}] ` : '';
    const dataInfo = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
    
    return `${timestamp} ${level} ${processInfo}${entry.message}${dataInfo}`;
  }

  private checkLogRotation(streamName: string): void {
    const logPath = join(LOG_DIR, `${streamName}.log`);
    
    if (!existsSync(logPath)) return;

    try {
      const stats = statSync(logPath);
      if (stats.size > MAX_LOG_SIZE) {
        this.rotateLog(streamName, logPath);
      }
    } catch (error) {
      console.error(`Failed to check log size for ${streamName}:`, error);
    }
  }

  private rotateLog(streamName: string, currentLogPath: string): void {
    try {
      const stream = this.logStreams.get(streamName);
      if (stream) {
        stream.end();
        this.logStreams.delete(streamName);
      }

      this.rotateLogFiles(currentLogPath);
      this.createLogStream(streamName, currentLogPath);
      
      this.info(`Log rotated for ${streamName}`);
    } catch (error) {
      console.error(`Failed to rotate log for ${streamName}:`, error);
    }
  }

  private rotateLogFiles(logPath: string): void {
    const basePath = logPath.replace('.log', '');
    
    for (let i = MAX_LOG_FILES - 1; i > 0; i--) {
      const oldPath = i === 1 ? logPath : `${basePath}.${i}.log.gz`;
      const newPath = `${basePath}.${i + 1}.log.gz`;
      
      if (existsSync(oldPath)) {
        if (i === MAX_LOG_FILES - 1) {
          unlinkSync(oldPath);
        } else if (i === 1) {
          this.compressAndMove(oldPath, newPath);
        } else {
          renameSync(oldPath, newPath);
        }
      }
    }
    
    if (existsSync(logPath)) {
      this.compressAndMove(logPath, `${basePath}.1.log.gz`);
    }
  }

  private compressAndMove(sourcePath: string, targetPath: string): void {
    try {
      const gzip = createGzip();
      const source = require('fs').createReadStream(sourcePath);
      const target = createWriteStream(targetPath);

      source.pipe(gzip).pipe(target);

      target.on('finish', () => {
        try {
          unlinkSync(sourcePath);
        } catch (error) {
          console.error(`Failed to remove source log file ${sourcePath}:`, error);
        }
      });

      target.on('error', (error) => {
        console.error(`Failed to compress log file ${sourcePath}:`, error);
      });
    } catch (error) {
      console.error(`Failed to compress and move log file:`, error);
    }
  }

  public cleanup(): void {
    const logDir = LOG_DIR;
    if (!existsSync(logDir)) return;

    try {
      const files = readdirSync(logDir);
      const logFiles = files.filter(file => file.endsWith('.log.gz'));
      
      logFiles.forEach(file => {
        const filePath = join(logDir, file);
        const match = file.match(/\.(\d+)\.log\.gz$/);
        
        if (match) {
          const index = parseInt(match[1], 10);
          if (index > MAX_LOG_FILES) {
            try {
              unlinkSync(filePath);
              this.debug(`Cleaned up old log file: ${file}`);
            } catch (error) {
              console.error(`Failed to cleanup log file ${file}:`, error);
            }
          }
        }
      });
    } catch (error) {
      console.error('Failed to cleanup old log files:', error);
    }
  }

  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    const closePromises = Array.from(this.logStreams.values()).map(stream => {
      return new Promise<void>((resolve) => {
        if (stream.writable) {
          stream.end(() => resolve());
        } else {
          resolve();
        }
      });
    });

    await Promise.all(closePromises);
    this.logStreams.clear();
  }

  public getTotalLogSize(): number {
    if (!existsSync(LOG_DIR)) return 0;

    try {
      const files = readdirSync(LOG_DIR);
      return files.reduce((total, file) => {
        const filePath = join(LOG_DIR, file);
        try {
          return total + statSync(filePath).size;
        } catch {
          return total;
        }
      }, 0);
    } catch {
      return 0;
    }
  }

  public getLogFiles(): string[] {
    if (!existsSync(LOG_DIR)) return [];

    try {
      return readdirSync(LOG_DIR)
        .filter(file => file.endsWith('.log') || file.endsWith('.log.gz'))
        .sort((a, b) => {
          const aTime = statSync(join(LOG_DIR, a)).mtime.getTime();
          const bTime = statSync(join(LOG_DIR, b)).mtime.getTime();
          return bTime - aTime;
        });
    } catch {
      return [];
    }
  }
}