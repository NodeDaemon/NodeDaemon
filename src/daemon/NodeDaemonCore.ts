import { createServer, Server, Socket } from 'net';
import { unlink } from 'fs';
import { promisify } from 'util';
import { EventEmitter } from 'events';

import { IPCMessage, IPCResponse, ProcessConfig } from '../types';
import { ProcessOrchestrator } from '../core/ProcessOrchestrator';
import { FileWatcher } from '../core/FileWatcher';
import { LogManager } from '../core/LogManager';
import { StateManager } from '../core/StateManager';
import { HealthMonitor } from '../core/HealthMonitor';

import { generateId, ensureDir, parseMemoryString, formatMemory } from '../utils/helpers';
import { 
  IPC_SOCKET_PATH, 
  NODEDAEMON_DIR, 
  HEALTH_CHECK_INTERVAL,
  GRACEFUL_SHUTDOWN_TIMEOUT,
  DEFAULT_CONFIG
} from '../utils/constants';

const unlinkAsync = promisify(unlink);

export class NodeDaemonCore extends EventEmitter {
  private server: Server;
  private logger: LogManager;
  private stateManager: StateManager;
  private processOrchestrator: ProcessOrchestrator;
  private fileWatcher: FileWatcher;
  private healthMonitor: HealthMonitor;
  private clients: Set<Socket> = new Set();
  private isShuttingDown: boolean = false;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private watchedProcesses: Map<string, string[]> = new Map(); // processId -> watch paths

  constructor() {
    super();
    
    // Initialize core components
    this.logger = new LogManager();
    this.stateManager = new StateManager(this.logger);
    this.processOrchestrator = new ProcessOrchestrator(this.logger);
    this.fileWatcher = new FileWatcher();
    this.healthMonitor = new HealthMonitor(this.logger);
    
    // Create IPC server
    this.server = createServer();
    
    this.setupEventHandlers();
    this.setupFileWatchHandlers();
    this.setupProcessHandlers();
    this.setupHealthHandlers();
    this.setupSignalHandlers();
  }

  private setupEventHandlers(): void {
    this.server.on('connection', (socket) => this.handleClientConnection(socket));
    this.server.on('error', (error) => this.handleServerError(error));
    this.server.on('close', () => this.logger.info('IPC server closed'));
    
    // Logger error handling is built into LogManager
    // this.logger.on('error', (error) => {
    //   console.error('Logger error:', error);
    // });
  }

  private setupFileWatchHandlers(): void {
    this.fileWatcher.on('fileChange', (event) => {
      this.logger.debug(`File change detected: ${event.type} ${event.path}`);
      this.handleFileChange(event);
    });
    
    this.fileWatcher.on('error', (error) => {
      this.logger.error('File watcher error', { error: error.message });
    });
  }

  private setupProcessHandlers(): void {
    this.processOrchestrator.on('processStarted', (processInfo) => {
      this.stateManager.setProcess(processInfo.id, processInfo);
      this.healthMonitor.addProcess(processInfo);
      this.logger.info(`Process started: ${processInfo.name}`, { processId: processInfo.id });
    });

    this.processOrchestrator.on('processStopped', (processInfo) => {
      this.stateManager.updateProcess(processInfo.id, processInfo);
      this.healthMonitor.removeProcess(processInfo.id);
      this.stopWatchingProcess(processInfo.id);
      this.logger.info(`Process stopped: ${processInfo.name}`, { processId: processInfo.id });
    });

    this.processOrchestrator.on('processRestarted', (processInfo) => {
      this.stateManager.updateProcess(processInfo.id, processInfo);
      this.healthMonitor.updateProcess(processInfo);
      this.logger.info(`Process restarted: ${processInfo.name}`, { processId: processInfo.id });
    });

    this.processOrchestrator.on('instanceExit', (processInfo, instance, code, signal) => {
      this.stateManager.updateProcess(processInfo.id, processInfo);
      this.logger.info(`Process instance exited`, {
        processId: processInfo.id,
        instanceId: instance.id,
        code,
        signal
      });
    });

    this.processOrchestrator.on('maxRestartsReached', (processInfo, instance) => {
      this.logger.error(`Process ${processInfo.name} will not be restarted anymore`, {
        processId: processInfo.id,
        instanceId: instance.id,
        restarts: instance.restarts
      });
    });
  }

  private setupHealthHandlers(): void {
    this.healthMonitor.on('healthIssues', async (unhealthyProcesses) => {
      for (const result of unhealthyProcesses) {
        const processInfo = this.processOrchestrator.getProcess(result.processId);
        if (!processInfo) continue;

        const config = processInfo.config;
        
        // Check for high memory usage
        if (config.autoRestartOnHighMemory && result.issues) {
          const memoryIssue = result.issues.find(issue => issue.includes('High memory usage'));
          if (memoryIssue) {
            const threshold = config.memoryThreshold ? parseMemoryString(config.memoryThreshold) : parseMemoryString(DEFAULT_CONFIG.memoryThreshold);
            if (result.memory > threshold) {
              this.logger.warn(`Auto-restarting process due to high memory usage`, {
                processId: processInfo.id,
                processName: processInfo.name,
                memory: formatMemory(result.memory),
                threshold: config.memoryThreshold || DEFAULT_CONFIG.memoryThreshold
              });
              await this.processOrchestrator.restartProcess(processInfo.id);
            }
          }
        }

        // Check for high CPU usage
        if (config.autoRestartOnHighCpu && result.issues) {
          const cpuIssue = result.issues.find(issue => issue.includes('High CPU usage'));
          if (cpuIssue) {
            const threshold = config.cpuThreshold || DEFAULT_CONFIG.cpuThreshold;
            if (result.cpu > threshold) {
              this.logger.warn(`Auto-restarting process due to high CPU usage`, {
                processId: processInfo.id,
                processName: processInfo.name,
                cpu: `${result.cpu.toFixed(1)}%`,
                threshold: `${threshold}%`
              });
              await this.processOrchestrator.restartProcess(processInfo.id);
            }
          }
        }
      }
    });

    this.healthMonitor.on('systemMetrics', (metrics) => {
      this.logger.debug('System metrics update', metrics);
    });
  }

  private setupSignalHandlers(): void {
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => this.reload());
    
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      this.gracefulShutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection', { reason });
    });
  }

  private handleFileChange(event: any): void {
    // Find processes that should be restarted due to file changes
    const processesToRestart = new Set<string>();
    
    for (const [processId, watchPaths] of this.watchedProcesses.entries()) {
      for (const watchPath of watchPaths) {
        if (event.path.startsWith(watchPath)) {
          processesToRestart.add(processId);
          break;
        }
      }
    }
    
    // Restart affected processes
    for (const processId of processesToRestart) {
      const processInfo = this.processOrchestrator.getProcess(processId);
      if (processInfo && processInfo.status === 'running') {
        this.logger.info(`Restarting process due to file change: ${processInfo.name}`, {
          processId,
          changedFile: event.path
        });
        
        this.processOrchestrator.restartProcess(processId).catch(error => {
          this.logger.error(`Failed to restart process ${processInfo.name}`, {
            processId,
            error: error.message
          });
        });
      }
    }
  }

  private handleClientConnection(socket: Socket): void {
    this.clients.add(socket);
    this.logger.debug('Client connected');
    
    socket.on('data', (data) => this.handleClientMessage(socket, data));
    socket.on('error', (error) => {
      this.logger.error('Client socket error', { error: error.message });
      this.clients.delete(socket);
    });
    
    socket.on('close', () => {
      this.logger.debug('Client disconnected');
      this.clients.delete(socket);
    });
  }

  private handleClientMessage(socket: Socket, data: Buffer): void {
    try {
      const message: IPCMessage = JSON.parse(data.toString());
      this.processIPCMessage(socket, message);
    } catch (error) {
      this.sendError(socket, '', 'Invalid JSON message');
    }
  }

  private async processIPCMessage(socket: Socket, message: IPCMessage): Promise<void> {
    const { id, type, data } = message;
    
    try {
      let responseData: any = null;
      
      switch (type) {
        case 'ping':
          responseData = { status: 'ok', timestamp: Date.now() };
          break;
          
        case 'start':
          responseData = await this.handleStart(data);
          break;
          
        case 'stop':
          responseData = await this.handleStop(data);
          break;
          
        case 'restart':
          responseData = await this.handleRestart(data);
          break;
          
        case 'list':
          responseData = this.handleList();
          break;
          
        case 'status':
          responseData = this.handleStatus(data);
          break;
          
        case 'logs':
          responseData = this.handleLogs(data);
          break;
          
        case 'shutdown':
          responseData = await this.handleShutdown();
          break;
          
        default:
          throw new Error(`Unknown command: ${type}`);
      }
      
      this.sendResponse(socket, id, true, responseData);
      
    } catch (error) {
      this.sendError(socket, id, error.message);
    }
  }

  private async handleStart(data: ProcessConfig): Promise<any> {
    const processId = await this.processOrchestrator.startProcess(data);
    
    // Setup file watching if enabled
    if (data.watch) {
      this.setupFileWatching(processId, data);
    }
    
    return { processId };
  }

  private setupFileWatching(processId: string, config: ProcessConfig): void {
    if (config.watch === true) {
      // Watch the script directory
      const watchPaths = [require('path').dirname(config.script)];
      this.watchedProcesses.set(processId, watchPaths);
      this.fileWatcher.watch(watchPaths, { recursive: true });
    } else if (Array.isArray(config.watch)) {
      // Watch specific paths
      this.watchedProcesses.set(processId, config.watch);
      this.fileWatcher.watch(config.watch, { recursive: true });
    }
  }

  private stopWatchingProcess(processId: string): void {
    this.watchedProcesses.delete(processId);
    
    // If no more processes are being watched, stop file watching
    if (this.watchedProcesses.size === 0) {
      this.fileWatcher.unwatch();
    }
  }

  private async handleStop(data: { processId?: string; name?: string; force?: boolean }): Promise<any> {
    const { processId, name, force = false } = data;
    
    let targetProcess;
    if (processId) {
      targetProcess = this.processOrchestrator.getProcess(processId);
    } else if (name) {
      targetProcess = this.processOrchestrator.getProcessByName(name);
    } else {
      throw new Error('Either processId or name must be provided');
    }
    
    if (!targetProcess) {
      throw new Error('Process not found');
    }
    
    await this.processOrchestrator.stopProcess(targetProcess.id, force);
    return { success: true };
  }

  private async handleRestart(data: { processId?: string; name?: string; graceful?: boolean }): Promise<any> {
    const { processId, name, graceful } = data;
    
    let targetProcess;
    if (processId) {
      targetProcess = this.processOrchestrator.getProcess(processId);
    } else if (name) {
      targetProcess = this.processOrchestrator.getProcessByName(name);
    } else {
      throw new Error('Either processId or name must be provided');
    }
    
    if (!targetProcess) {
      throw new Error('Process not found');
    }
    
    await this.processOrchestrator.restartProcess(targetProcess.id, graceful || false);
    return { success: true };
  }

  private handleList(): any {
    const processes = this.processOrchestrator.getProcesses();
    const stats = this.stateManager.getStats();
    
    return {
      processes: processes.map(p => ({
        id: p.id,
        name: p.name,
        script: p.script,
        status: p.status,
        instances: p.instances.length,
        restarts: p.restarts,
        uptime: p.instances[0]?.uptime ? Date.now() - p.instances[0].uptime : 0,
        memory: p.instances.reduce((sum, i) => sum + (i.memory || 0), 0),
        cpu: p.instances.reduce((sum, i) => sum + (i.cpu || 0), 0)
      })),
      stats
    };
  }

  private handleStatus(data?: { processId?: string; name?: string }): any {
    if (!data || (!data.processId && !data.name)) {
      // Return daemon status
      return {
        daemon: {
          pid: process.pid,
          uptime: Date.now() - this.stateManager.getState().startedAt,
          version: this.stateManager.getState().version,
          ...this.stateManager.getStats()
        },
        health: this.processOrchestrator.getHealthCheck()
      };
    }
    
    const { processId, name } = data;
    let targetProcess;
    
    if (processId) {
      targetProcess = this.processOrchestrator.getProcess(processId);
    } else if (name) {
      targetProcess = this.processOrchestrator.getProcessByName(name);
    }
    
    if (!targetProcess) {
      throw new Error('Process not found');
    }
    
    return targetProcess;
  }

  private handleLogs(data: { processId?: string; name?: string; lines?: number }): any {
    const { processId, name, lines = 100 } = data;
    
    let targetProcessId = processId;
    if (!targetProcessId && name) {
      const process = this.processOrchestrator.getProcessByName(name);
      targetProcessId = process?.id;
    }
    
    const logs = this.logger.getRecentLogs(lines, targetProcessId);
    return { logs };
  }

  private async handleShutdown(): Promise<any> {
    setImmediate(() => {
      this.gracefulShutdown('api');
    });
    return { success: true };
  }

  private sendResponse(socket: Socket, id: string, success: boolean, data?: any): void {
    const response: IPCResponse = {
      id,
      success,
      data,
      timestamp: Date.now()
    };
    
    const responseData = JSON.stringify(response) + '\n';
    socket.write(responseData);
  }

  private sendError(socket: Socket, id: string, error: string): void {
    this.sendResponse(socket, id, false, { error });
  }

  private handleServerError(error: any): void {
    if (error.code === 'EADDRINUSE') {
      this.logger.error('IPC socket already in use - another daemon may be running');
      process.exit(1);
    } else {
      this.logger.error('IPC server error', { error: error.message });
    }
  }

  public async start(): Promise<void> {
    try {
      // Ensure daemon directory exists
      ensureDir(NODEDAEMON_DIR);
      
      // Clean up existing socket file on Unix systems
      if (process.platform !== 'win32') {
        try {
          await unlinkAsync(IPC_SOCKET_PATH);
        } catch {
          // Socket file doesn't exist, ignore
        }
      }
      
      // Start IPC server
      await new Promise<void>((resolve, reject) => {
        this.server.listen(IPC_SOCKET_PATH, () => {
          this.logger.info('NodeDaemon started', {
            pid: process.pid,
            socketPath: IPC_SOCKET_PATH
          });
          resolve();
        });
        
        this.server.on('error', reject);
      });
      
      // Set proper permissions on Unix socket
      if (process.platform !== 'win32') {
        const fs = require('fs');
        fs.chmodSync(IPC_SOCKET_PATH, 0o600);
      }
      
      // Start health check timer
      this.startHealthCheck();
      
      // Start health monitoring
      this.healthMonitor.startMonitoring();
      
      // Restore any previously running processes
      await this.restoreProcesses();
      
      this.emit('started');
      
    } catch (error) {
      this.logger.error('Failed to start daemon', { error: error.message });
      throw error;
    }
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      if (!this.isShuttingDown) {
        this.performHealthCheck();
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  private performHealthCheck(): void {
    try {
      const healthResults = this.processOrchestrator.getHealthCheck();
      
      healthResults.forEach(result => {
        if (!result.healthy && result.issues) {
          this.logger.warn('Process health check failed', {
            processId: result.processId,
            issues: result.issues
          });
        }
      });
      
      // Log system stats periodically
      const stats = this.stateManager.getStats();
      this.logger.debug('Health check completed', { stats });
      
    } catch (error) {
      this.logger.error('Health check failed', { error: error.message });
    }
  }

  private async restoreProcesses(): Promise<void> {
    try {
      const processes = this.stateManager.getProcessesByStatus('running');
      
      if (processes.length === 0) {
        this.logger.info('No processes to restore');
        return;
      }
      
      this.logger.info(`Restoring ${processes.length} processes`);
      
      const restorePromises = processes.map(async (processInfo) => {
        try {
          // Reset instances since we're starting fresh
          processInfo.instances = [];
          await this.processOrchestrator.startProcess(processInfo.config);
          
          if (processInfo.config.watch) {
            this.setupFileWatching(processInfo.id, processInfo.config);
          }
          
        } catch (error) {
          this.logger.error(`Failed to restore process ${processInfo.name}`, {
            processId: processInfo.id,
            error: error.message
          });
        }
      });
      
      await Promise.all(restorePromises);
      
    } catch (error) {
      this.logger.error('Failed to restore processes', { error: error.message });
    }
  }

  private async reload(): Promise<void> {
    this.logger.info('Reloading daemon configuration');
    
    try {
      await this.processOrchestrator.reloadAllProcesses();
      this.logger.info('Daemon reload completed');
    } catch (error) {
      this.logger.error('Daemon reload failed', { error: error.message });
    }
  }

  public async gracefulShutdown(reason: string = 'unknown'): Promise<void> {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    this.logger.info(`Starting graceful shutdown (reason: ${reason})`);
    
    try {
      // Stop health checks
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
      }
      
      // Close IPC server
      this.server.close();
      
      // Disconnect all clients
      this.clients.forEach(client => {
        client.end();
      });
      this.clients.clear();
      
      // Stop file watcher
      this.fileWatcher.unwatch();
      
      // Stop health monitoring
      this.healthMonitor.stopMonitoring();
      
      // Stop all processes
      await this.processOrchestrator.gracefulShutdown();
      
      // Save final state
      this.stateManager.forceSave();
      
      // Shutdown components
      await this.logger.shutdown();
      this.stateManager.shutdown();
      
      this.logger.info('Graceful shutdown completed');
      
      // Clean up socket file on Unix systems
      if (process.platform !== 'win32') {
        try {
          await unlinkAsync(IPC_SOCKET_PATH);
        } catch {
          // Ignore cleanup errors
        }
      }
      
      this.emit('shutdown');
      
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
    
    process.exit(0);
  }

  public getStats(): any {
    return {
      daemon: this.stateManager.getStats(),
      processes: this.processOrchestrator.getProcesses().length,
      clients: this.clients.size,
      uptime: Date.now() - this.stateManager.getState().startedAt
    };
  }
}