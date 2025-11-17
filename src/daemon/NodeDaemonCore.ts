import { createServer, Server, Socket } from 'net';
import { unlink } from 'fs';
import { promisify } from 'util';
import { EventEmitter } from 'events';

import { IPCMessage, IPCResponse, ProcessConfig, WebUIConfig } from '../types';
import { ProcessOrchestrator } from '../core/ProcessOrchestrator';
import { FileWatcher } from '../core/FileWatcher';
import { LogManager } from '../core/LogManager';
import { StateManager } from '../core/StateManager';
import { HealthMonitor } from '../core/HealthMonitor';
import { WebUIServer } from '../core/WebUIServer';

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
  private webUIServer: WebUIServer;
  private clients: Set<Socket> = new Set();
  private isShuttingDown: boolean = false;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private watchedProcesses: Map<string, string[]> = new Map(); // processId -> watch paths
  private webUIConfig: WebUIConfig | null = null;
  // Fix BUG-007: Buffer for handling fragmented IPC messages
  private messageBuffers: Map<Socket, string> = new Map();

  constructor() {
    super();
    
    // Initialize core components
    this.logger = new LogManager();
    this.stateManager = new StateManager(this.logger);
    this.processOrchestrator = new ProcessOrchestrator(this.logger);
    this.fileWatcher = new FileWatcher();
    this.healthMonitor = new HealthMonitor(this.logger);
    this.webUIServer = new WebUIServer();
    
    // Create IPC server
    this.server = createServer();
    
    this.setupEventHandlers();
    this.setupFileWatchHandlers();
    this.setupProcessHandlers();
    this.setupHealthHandlers();
    this.setupWebUIHandlers();
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

    // Update process instance metrics when health monitor emits them
    this.healthMonitor.on('processMetrics', (processId, metrics) => {
      const processInfo = this.processOrchestrator.getProcess(processId);
      if (processInfo) {
        // Find the instance by PID
        for (const instance of processInfo.instances) {
          if (instance.pid) {
            // Update the instance metrics
            instance.memory = metrics.memory;
            instance.cpu = metrics.cpu;
          }
        }
      }
    });
  }

  private setupWebUIHandlers(): void {
    // API handlers
    this.webUIServer.on('api:list', (callback) => {
      const processes = this.processOrchestrator.getProcesses();
      // Transform processes to include aggregated data for frontend
      const transformedProcesses = processes.map(p => {
        const mainInstance = p.instances[0];
        const totalMemory = p.instances.reduce((sum, i) => sum + (i.memory || 0), 0);
        const totalCpu = p.instances.reduce((sum, i) => sum + (i.cpu || 0), 0);
        const uptime = mainInstance && mainInstance.uptime ? 
          Math.floor((Date.now() - mainInstance.uptime) / 1000) : 0;
        
        return {
          ...p,
          memory: totalMemory,
          cpu: totalCpu,
          uptime: uptime
        };
      });
      callback(transformedProcesses);
    });

    this.webUIServer.on('api:status', (callback) => {
      const status = {
        version: '1.0.2',
        uptime: process.uptime(),
        pid: process.pid,
        processCount: this.processOrchestrator.getProcesses().length,
        memory: process.memoryUsage()
      };
      callback(status);
    });

    this.webUIServer.on('api:start', async (processId, callback) => {
      try {
        await this.processOrchestrator.startProcess(processId);
        callback({ success: true });
      } catch (error) {
        callback({ error: error.message });
      }
    });

    this.webUIServer.on('api:stop', async (processId, callback) => {
      try {
        await this.processOrchestrator.stopProcess(processId);
        callback({ success: true });
      } catch (error) {
        callback({ error: error.message });
      }
    });

    this.webUIServer.on('api:restart', async (processId, callback) => {
      try {
        await this.processOrchestrator.restartProcess(processId);
        callback({ success: true });
      } catch (error) {
        callback({ error: error.message });
      }
    });

    this.webUIServer.on('api:reload', async (processId, callback) => {
      try {
        const processInfo = this.processOrchestrator.getProcess(processId);
        if (!processInfo) {
          throw new Error('Process not found');
        }
        if (!processInfo.config.instances || 
            (typeof processInfo.config.instances === 'number' && processInfo.config.instances <= 1)) {
          throw new Error('Reload is only available for cluster mode');
        }
        await this.processOrchestrator.gracefulReload(processInfo);
        callback({ success: true });
      } catch (error) {
        callback({ error: error.message });
      }
    });

    // WebSocket handlers
    this.webUIServer.on('ws:list', (data, callback) => {
      const processes = this.processOrchestrator.getProcesses();
      // Transform processes to include aggregated data for frontend
      const transformedProcesses = processes.map(p => {
        const mainInstance = p.instances[0];
        const totalMemory = p.instances.reduce((sum, i) => sum + (i.memory || 0), 0);
        const totalCpu = p.instances.reduce((sum, i) => sum + (i.cpu || 0), 0);
        const uptime = mainInstance && mainInstance.uptime ? 
          Math.floor((Date.now() - mainInstance.uptime) / 1000) : 0;
        
        return {
          ...p,
          memory: totalMemory,
          cpu: totalCpu,
          uptime: uptime
        };
      });
      callback(transformedProcesses);
    });

    // Process event forwarding
    this.processOrchestrator.on('processStarted', (processInfo) => {
      this.webUIServer.broadcastProcessUpdate(processInfo);
    });

    this.processOrchestrator.on('processStopped', (processInfo) => {
      this.webUIServer.broadcastProcessUpdate(processInfo);
    });

    this.processOrchestrator.on('processRestarted', (processInfo) => {
      this.webUIServer.broadcastProcessUpdate(processInfo);
    });

    // Log forwarding
    this.logger.on('log', (logEntry) => {
      this.webUIServer.broadcastLog(logEntry);
    });

    // Health metrics forwarding
    this.healthMonitor.on('processMetrics', (processId, metrics) => {
      this.webUIServer.broadcastMetric(processId, metrics);
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
    this.logger.info(`handleFileChange called`, {
      event,
      watchedProcesses: Array.from(this.watchedProcesses.entries())
    });
    
    // Find processes that should be restarted due to file changes
    const processesToRestart = new Set<string>();
    const path = require('path');
    
    for (const [processId, watchPaths] of this.watchedProcesses.entries()) {
      for (const watchPath of watchPaths) {
        // Resolve watch path to absolute path for comparison
        const absoluteWatchPath = path.resolve(watchPath);
        if (event.path.startsWith(absoluteWatchPath)) {
          this.logger.info(`File change matches watch path`, {
            processId,
            watchPath,
            absoluteWatchPath,
            eventPath: event.path
          });
          processesToRestart.add(processId);
          break;
        }
      }
    }
    
    this.logger.info(`Processes to restart`, {
      count: processesToRestart.size,
      processIds: Array.from(processesToRestart)
    });
    
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

    // Fix BUG-007: Initialize message buffer for this socket
    this.messageBuffers.set(socket, '');

    socket.on('data', (data) => this.handleClientMessage(socket, data));
    socket.on('error', (error) => {
      this.logger.error('Client socket error', { error: error.message });
      this.clients.delete(socket);
      // Fix BUG-007: Clean up message buffer
      this.messageBuffers.delete(socket);
    });

    socket.on('close', () => {
      this.logger.debug('Client disconnected');
      this.clients.delete(socket);
      // Fix BUG-007: Clean up message buffer
      this.messageBuffers.delete(socket);
    });
  }

  private handleClientMessage(socket: Socket, data: Buffer): void {
    // Fix BUG-007: Handle fragmented IPC messages properly
    try {
      // Get existing buffer or create new one
      const existingBuffer = this.messageBuffers.get(socket) || '';
      const combinedData = existingBuffer + data.toString();

      // Try to parse complete messages (newline delimited)
      const messages = combinedData.split('\n');

      // Last element might be incomplete, save it for next data event
      const incomplete = messages.pop() || '';
      this.messageBuffers.set(socket, incomplete);

      // Process all complete messages
      for (const messageStr of messages) {
        if (messageStr.trim()) {
          try {
            const message: IPCMessage = JSON.parse(messageStr);
            this.processIPCMessage(socket, message);
          } catch (parseError) {
            this.sendError(socket, '', 'Invalid JSON message');
          }
        }
      }
    } catch (error) {
      this.sendError(socket, '', 'Message processing error');
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
          
        case 'webui':
          responseData = await this.handleWebUI(data);
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
      this.logger.info(`Setting up file watching for process ${processId}`, {
        processId,
        watchPaths,
        scriptPath: config.script
      });
      this.watchedProcesses.set(processId, watchPaths);
      this.fileWatcher.watch(watchPaths, { recursive: true });
    } else if (Array.isArray(config.watch)) {
      // Watch specific paths
      this.logger.info(`Setting up file watching for process ${processId}`, {
        processId,
        watchPaths: config.watch
      });
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

  private async handleWebUI(data: any): Promise<any> {
    if (!data || !data.action) {
      throw new Error('WebUI action required');
    }

    switch (data.action) {
      case 'set':
        if (!data.config) {
          throw new Error('WebUI config required');
        }
        await this.setWebUIConfig(data.config);
        return this.getWebUIConfig();

      case 'status':
        return this.getWebUIConfig();

      default:
        throw new Error(`Unknown webui action: ${data.action}`);
    }
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
      
      // Start Web UI if configured
      await this.startWebUI();
      
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

  private async startWebUI(): Promise<void> {
    this.logger.debug('startWebUI called', { currentConfig: this.webUIConfig });
    
    // Don't reload config from state if we already have it
    // This was causing the issue - we were overwriting the config we just set!
    if (!this.webUIConfig) {
      // Load web UI config from state or use defaults
      const savedState = this.stateManager.getState();
      if (savedState.webUIConfig) {
        this.webUIConfig = savedState.webUIConfig;
      } else {
        // Use defaults from constants
        this.webUIConfig = {
          enabled: false,
          port: 8080,
          host: '127.0.0.1'
        };
      }
    }

    this.logger.debug('WebUI config after check', { config: this.webUIConfig });

    if (this.webUIConfig && this.webUIConfig.enabled) {
      try {
        // Update config if server already exists
        if (this.webUIServer.isRunning()) {
          await this.webUIServer.stop();
        }
        
        // Update config and restart
        this.webUIServer = new WebUIServer(this.webUIConfig);
        
        // Re-setup handlers (they were already setup in constructor)
        this.setupWebUIHandlers();
        
        await this.webUIServer.start();
        this.logger.info('Web UI started', {
          port: this.webUIConfig.port,
          host: this.webUIConfig.host
        });
      } catch (error) {
        this.logger.error('Failed to start Web UI', { 
          error: error.message,
          stack: error.stack 
        });
      }
    }
  }

  public async setWebUIConfig(config: Partial<WebUIConfig>): Promise<void> {
    const wasEnabled = this.webUIConfig?.enabled;
    
    // Ensure we have a base config
    if (!this.webUIConfig) {
      this.webUIConfig = {
        enabled: false,
        port: 8080,
        host: '127.0.0.1'
      };
    }
    
    this.webUIConfig = { ...this.webUIConfig, ...config };
    
    // Save config to state
    const state = this.stateManager.getState();
    state.webUIConfig = this.webUIConfig;
    this.stateManager.forceSave();

    // Handle enable/disable
    this.logger.debug('WebUI config change', { 
      wasEnabled, 
      isEnabled: this.webUIConfig.enabled,
      config: this.webUIConfig 
    });
    
    if (!wasEnabled && this.webUIConfig.enabled) {
      // Start Web UI
      this.logger.info('Starting Web UI...');
      await this.startWebUI();
    } else if (wasEnabled && !this.webUIConfig.enabled) {
      // Stop Web UI
      this.logger.info('Stopping Web UI...');
      await this.webUIServer.stop();
    } else if (wasEnabled && this.webUIConfig.enabled) {
      // Restart Web UI with new config
      this.logger.info('Restarting Web UI...');
      await this.webUIServer.stop();
      await this.startWebUI();
    }
  }

  public getWebUIConfig(): WebUIConfig | null {
    return this.webUIConfig;
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
      
      // Stop Web UI
      await this.webUIServer.stop();
      
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