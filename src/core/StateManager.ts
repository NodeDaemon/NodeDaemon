import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { writeFile, rename } from 'fs/promises';
import { DaemonState, ProcessInfo } from '../types';
import { LogManager } from './LogManager';
import { ensureFileDir } from '../utils/helpers';
import { STATE_FILE } from '../utils/constants';

export class StateManager {
  private logger: LogManager;
  private state: DaemonState;
  private saveTimer: NodeJS.Timeout | null = null;
  private saveInterval: number = 5000; // 5 seconds
  private isSaving: boolean = false; // Fix BUG-005: Prevent concurrent saves

  constructor(logger: LogManager) {
    this.logger = logger;
    this.state = this.createInitialState();
    this.loadState();
    this.startAutoSave();
  }

  private createInitialState(): DaemonState {
    return {
      processes: new Map(),
      version: '1.1.0',
      startedAt: Date.now(),
      pid: process.pid
    };
  }

  public loadState(): void {
    try {
      if (!existsSync(STATE_FILE)) {
        this.logger.info('No existing state file found, starting fresh');
        return;
      }

      const stateData = readFileSync(STATE_FILE, 'utf8');
      const parsedState = JSON.parse(stateData);
      
      // Convert processes array back to Map
      if (parsedState.processes && Array.isArray(parsedState.processes)) {
        this.state.processes = new Map(parsedState.processes);
      }
      
      this.state.version = parsedState.version || this.state.version;
      this.state.startedAt = parsedState.startedAt || Date.now();
      
      // Update PID to current process
      this.state.pid = process.pid;
      
      this.logger.info(`State loaded successfully`, {
        processCount: this.state.processes.size,
        version: this.state.version,
        originalStartedAt: parsedState.startedAt
      });
      
      // Clean up orphaned processes
      this.cleanupOrphanedProcesses();
      
    } catch (error) {
      this.logger.error(`Failed to load state: ${error.message}`, { error });
      this.state = this.createInitialState();
    }
  }

  private cleanupOrphanedProcesses(): void {
    let cleanedCount = 0;
    
    for (const [processId, processInfo] of this.state.processes.entries()) {
      let hasRunningInstances = false;
      
      // Check if any instances are still running
      for (const instance of processInfo.instances) {
        if (instance.pid && this.isProcessRunning(instance.pid)) {
          hasRunningInstances = true;
          instance.status = 'running';
        } else {
          instance.status = 'stopped';
          instance.pid = undefined;
        }
      }
      
      if (!hasRunningInstances && processInfo.status === 'running') {
        processInfo.status = 'stopped';
        processInfo.updatedAt = Date.now();
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      this.logger.info(`Cleaned up ${cleanedCount} orphaned processes`);
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Save state asynchronously (fire-and-forget)
   * Prevents blocking the event loop during file writes
   */
  public saveState(): void {
    // Fire and forget - async save without blocking
    this.saveStateAsync().catch(error => {
      this.logger.error(`Failed to save state: ${error.message}`, { error });
    });
  }

  /**
   * Async state save implementation
   * Uses atomic write (temp file + rename) to prevent corruption
   */
  private async saveStateAsync(): Promise<void> {
    // Fix BUG-005: Prevent concurrent saves with locking
    if (this.isSaving) {
      this.logger.debug('Save already in progress, skipping');
      return;
    }

    this.isSaving = true;

    try {
      ensureFileDir(STATE_FILE);

      const stateToSave = {
        ...this.state,
        processes: Array.from(this.state.processes.entries()),
        savedAt: Date.now()
      };

      const stateData = JSON.stringify(stateToSave, null, 2);

      // Fix BUG-005: Atomic write using temporary file and rename
      const tempFile = `${STATE_FILE}.tmp.${process.pid}`;

      try {
        // Write to temporary file first (async)
        await writeFile(tempFile, stateData, 'utf8');

        // Atomic rename (async) - this is atomic on most filesystems
        await rename(tempFile, STATE_FILE);

        this.logger.debug('State saved successfully', {
          processCount: this.state.processes.size,
          filePath: STATE_FILE
        });
      } catch (writeError) {
        // Clean up temp file if it exists
        try {
          if (existsSync(tempFile)) {
            unlinkSync(tempFile);
          }
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        throw writeError;
      }

    } finally {
      this.isSaving = false;
    }
  }

  public setProcess(processId: string, processInfo: ProcessInfo): void {
    this.state.processes.set(processId, processInfo);
    this.scheduleSave();
  }

  public deleteProcess(processId: string): boolean {
    const deleted = this.state.processes.delete(processId);
    if (deleted) {
      this.scheduleSave();
    }
    return deleted;
  }

  public getProcess(processId: string): ProcessInfo | undefined {
    return this.state.processes.get(processId);
  }

  public getAllProcesses(): ProcessInfo[] {
    return Array.from(this.state.processes.values());
  }

  public getProcessCount(): number {
    return this.state.processes.size;
  }

  public updateProcess(processId: string, updates: Partial<ProcessInfo>): boolean {
    const process = this.state.processes.get(processId);
    if (!process) {
      return false;
    }

    Object.assign(process, updates, { updatedAt: Date.now() });
    this.scheduleSave();
    return true;
  }

  public getState(): DaemonState {
    return {
      ...this.state,
      processes: new Map(this.state.processes)
    };
  }

  public getStats(): {
    processCount: number;
    runningProcesses: number;
    stoppedProcesses: number;
    erroredProcesses: number;
    uptime: number;
    version: string;
  } {
    const processes = Array.from(this.state.processes.values());
    
    return {
      processCount: processes.length,
      runningProcesses: processes.filter(p => p.status === 'running').length,
      stoppedProcesses: processes.filter(p => p.status === 'stopped').length,
      erroredProcesses: processes.filter(p => p.status === 'errored').length,
      uptime: Date.now() - this.state.startedAt,
      version: this.state.version
    };
  }

  public findProcessByName(name: string): ProcessInfo | undefined {
    return Array.from(this.state.processes.values()).find(p => p.name === name);
  }

  public findProcessesByScript(script: string): ProcessInfo[] {
    return Array.from(this.state.processes.values()).filter(p => p.script === script);
  }

  public getProcessesByStatus(status: ProcessInfo['status']): ProcessInfo[] {
    return Array.from(this.state.processes.values()).filter(p => p.status === status);
  }

  private startAutoSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setInterval(() => {
      this.saveState();
    }, this.saveInterval);
  }

  private scheduleSave(): void {
    // Debounced save - will save after a short delay if no more changes come in
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveState();
      this.startAutoSave();
    }, 1000);
  }

  public setSaveInterval(interval: number): void {
    this.saveInterval = Math.max(1000, interval); // Minimum 1 second
    this.startAutoSave();
  }

  public forceSave(): void {
    this.saveState();
  }

  public backup(backupPath?: string): void {
    const targetPath = backupPath || `${STATE_FILE}.backup.${Date.now()}`;
    
    try {
      ensureFileDir(targetPath);
      
      const currentState = {
        ...this.state,
        processes: Array.from(this.state.processes.entries()),
        backedUpAt: Date.now()
      };
      
      const stateData = JSON.stringify(currentState, null, 2);
      writeFileSync(targetPath, stateData, 'utf8');
      
      this.logger.info(`State backed up successfully`, { backupPath: targetPath });
      
    } catch (error) {
      this.logger.error(`Failed to backup state: ${error.message}`, { error, backupPath: targetPath });
      throw error;
    }
  }

  public restore(backupPath: string): void {
    try {
      if (!existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`);
      }

      const backupData = readFileSync(backupPath, 'utf8');
      const parsedBackup = JSON.parse(backupData);
      
      // Validate backup data
      if (!parsedBackup.processes || !Array.isArray(parsedBackup.processes)) {
        throw new Error('Invalid backup data: missing processes');
      }

      // Create new state from backup
      const restoredState: DaemonState = {
        processes: new Map(parsedBackup.processes),
        version: parsedBackup.version || this.state.version,
        startedAt: Date.now(), // Use current time as new start time
        pid: process.pid
      };

      this.state = restoredState;
      this.saveState();
      
      this.logger.info(`State restored successfully`, {
        processCount: this.state.processes.size,
        backupPath,
        originalBackupTime: parsedBackup.backedUpAt
      });
      
      // Clean up any processes that are no longer running
      this.cleanupOrphanedProcesses();
      
    } catch (error) {
      this.logger.error(`Failed to restore state: ${error.message}`, { error, backupPath });
      throw error;
    }
  }

  public reset(): void {
    this.logger.warn('Resetting daemon state - all process information will be lost');
    
    this.state = this.createInitialState();
    this.saveState();
    
    this.logger.info('Daemon state reset completed');
  }

  public shutdown(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    
    // Final save on shutdown
    this.saveState();
    this.logger.info('StateManager shutdown completed');
  }

  public validate(): boolean {
    try {
      // Validate state structure
      if (!this.state || typeof this.state !== 'object') {
        return false;
      }

      if (!(this.state.processes instanceof Map)) {
        return false;
      }

      // Validate each process
      for (const [processId, processInfo] of this.state.processes.entries()) {
        if (!processId || typeof processId !== 'string') {
          return false;
        }

        if (!processInfo || typeof processInfo !== 'object') {
          return false;
        }

        if (!processInfo.id || !processInfo.name || !processInfo.script) {
          return false;
        }

        if (!Array.isArray(processInfo.instances)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.error(`State validation failed: ${error.message}`, { error });
      return false;
    }
  }
}