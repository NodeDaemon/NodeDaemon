import { fork, spawn, ChildProcess } from 'child_process';
import cluster, { Worker } from 'cluster';
import { cpus } from 'os';
import { EventEmitter } from 'events';
import { ProcessConfig, ProcessInfo, ProcessInstance, ProcessStrategy, HealthCheckResult } from '../types';
import { LogManager } from './LogManager';
import { generateId, calculateExponentialBackoff, sanitizeProcessName, validateProcessConfig } from '../utils/helpers';
import { DEFAULT_CONFIG, GRACEFUL_SHUTDOWN_TIMEOUT, FORCE_KILL_TIMEOUT, SIGNALS } from '../utils/constants';

export class ProcessOrchestrator extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map();
  private childProcesses: Map<string, ChildProcess | Worker> = new Map();
  private restartTimers: Map<string, NodeJS.Timeout> = new Map();
  private logger: LogManager;
  private isShuttingDown: boolean = false;

  constructor(logger: LogManager) {
    super();
    this.logger = logger;
    this.setupClusterEventHandlers();
    this.setupProcessEventHandlers();
  }

  private setupClusterEventHandlers(): void {
    if (cluster.isPrimary) {
      cluster.on('exit', (worker, code, signal) => {
        this.handleWorkerExit(worker, code, signal);
      });

      cluster.on('disconnect', (worker) => {
        this.logger.warn(`Cluster worker ${worker.id} disconnected`, { workerId: worker.id });
      });
    }
  }

  private setupProcessEventHandlers(): void {
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
    process.on('SIGHUP', () => this.reloadAllProcesses());
  }

  public async startProcess(config: ProcessConfig): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Cannot start process during shutdown');
    }

    validateProcessConfig(config);

    const processId = generateId();
    const processName = config.name || sanitizeProcessName(config.script);
    const instanceCount = this.resolveInstanceCount(config.instances);
    const strategy = this.determineStrategy(config);

    const processInfo: ProcessInfo = {
      id: processId,
      name: processName,
      script: config.script,
      status: 'starting',
      restarts: 0,
      instances: [],
      config: { ...DEFAULT_CONFIG, ...config },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.processes.set(processId, processInfo);
    this.logger.info(`Starting process: ${processName}`, { processId, strategy, instances: instanceCount });

    try {
      if (strategy === 'cluster' && instanceCount > 1) {
        await this.startClusterProcess(processInfo, instanceCount);
      } else {
        await this.startSingleProcess(processInfo, strategy);
      }

      processInfo.status = 'running';
      processInfo.updatedAt = Date.now();
      this.emit('processStarted', processInfo);
      
      return processId;
    } catch (error) {
      processInfo.status = 'errored';
      processInfo.updatedAt = Date.now();
      this.logger.error(`Failed to start process ${processName}`, { error: error.message, processId });
      throw error;
    }
  }

  private resolveInstanceCount(instances?: number | 'max'): number {
    if (instances === 'max') {
      return cpus().length;
    }
    return (typeof instances === 'number') ? instances : DEFAULT_CONFIG.instances;
  }

  private determineStrategy(config: ProcessConfig): ProcessStrategy {
    if (config.instances && (config.instances === 'max' || config.instances > 1)) {
      return 'cluster';
    }

    if (config.script.endsWith('.js') || config.script.endsWith('.mjs')) {
      return 'fork';
    }

    return 'spawn';
  }

  private async startClusterProcess(processInfo: ProcessInfo, instanceCount: number): Promise<void> {
    if (!cluster.isPrimary) {
      throw new Error('Cluster processes can only be started from primary process');
    }

    const promises: Promise<void>[] = [];

    for (let i = 0; i < instanceCount; i++) {
      promises.push(this.startClusterInstance(processInfo, i));
    }

    await Promise.all(promises);
  }

  private startClusterInstance(processInfo: ProcessInfo, instanceIndex: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const instanceId = generateId();
      const instance: ProcessInstance = {
        id: instanceId,
        status: 'starting',
        restarts: 0
      };

      processInfo.instances.push(instance);

      cluster.setupPrimary({
        exec: processInfo.script,
        args: processInfo.config.args || [],
        cwd: processInfo.config.cwd
      });

      const worker = cluster.fork({ ...process.env, ...processInfo.config.env });
      this.childProcesses.set(instanceId, worker);

      worker.on('online', () => {
        instance.pid = worker.process.pid;
        instance.status = 'running';
        instance.uptime = Date.now();
        this.logger.info(`Cluster instance ${instanceIndex} started`, { 
          processId: processInfo.id, 
          instanceId, 
          pid: worker.process.pid 
        });
        resolve();
      });

      worker.on('exit', (code, signal) => {
        this.handleInstanceExit(processInfo, instance, code, signal);
      });

      worker.on('error', (error) => {
        this.logger.error(`Cluster instance error`, { 
          processId: processInfo.id, 
          instanceId, 
          error: error.message 
        });
        reject(error);
      });

      setTimeout(() => {
        if (instance.status === 'starting') {
          reject(new Error(`Cluster instance ${instanceIndex} failed to start within timeout`));
        }
      }, 30000);
    });
  }

  private async startSingleProcess(processInfo: ProcessInfo, strategy: ProcessStrategy): Promise<void> {
    const instanceId = generateId();
    const instance: ProcessInstance = {
      id: instanceId,
      status: 'starting',
      restarts: 0
    };

    processInfo.instances.push(instance);

    let childProcess: ChildProcess;

    if (strategy === 'fork') {
      childProcess = fork(processInfo.script, processInfo.config.args || [], {
        cwd: processInfo.config.cwd,
        env: { ...process.env, ...processInfo.config.env },
        silent: false
      });
    } else {
      const interpreter = processInfo.config.interpreter || 'node';
      childProcess = spawn(interpreter, [processInfo.script, ...(processInfo.config.args || [])], {
        cwd: processInfo.config.cwd,
        env: { ...process.env, ...processInfo.config.env },
        stdio: ['inherit', 'inherit', 'inherit']
      });
    }

    this.childProcesses.set(instanceId, childProcess);

    return new Promise((resolve, reject) => {
      childProcess.on('spawn', () => {
        instance.pid = childProcess.pid;
        instance.status = 'running';
        instance.uptime = Date.now();
        this.logger.info(`Process started`, { 
          processId: processInfo.id, 
          instanceId, 
          pid: childProcess.pid,
          strategy 
        });
        resolve();
      });

      childProcess.on('exit', (code, signal) => {
        this.handleInstanceExit(processInfo, instance, code, signal);
      });

      childProcess.on('error', (error) => {
        this.logger.error(`Process error`, { 
          processId: processInfo.id, 
          instanceId, 
          error: error.message 
        });
        reject(error);
      });

      setTimeout(() => {
        if (instance.status === 'starting') {
          reject(new Error('Process failed to start within timeout'));
        }
      }, 30000);
    });
  }

  private handleWorkerExit(worker: Worker, code: number, signal: string): void {
    const instanceId = this.findInstanceByPid(worker.process.pid);
    if (instanceId) {
      const processInfo = this.findProcessByInstanceId(instanceId);
      const instance = processInfo?.instances.find(i => i.id === instanceId);
      
      if (processInfo && instance) {
        this.handleInstanceExit(processInfo, instance, code, signal);
      }
    }
  }

  private handleInstanceExit(processInfo: ProcessInfo, instance: ProcessInstance, code: number | null, signal: string | null): void {
    instance.status = code === 0 ? 'stopped' : 'crashed';
    this.childProcesses.delete(instance.id);

    this.logger.info(`Process instance exited`, {
      processId: processInfo.id,
      instanceId: instance.id,
      pid: instance.pid,
      code,
      signal
    });

    if (processInfo.status !== 'stopping' && !this.isShuttingDown) {
      if (instance.restarts < processInfo.config.maxRestarts!) {
        this.scheduleRestart(processInfo, instance);
      } else {
        this.logger.error(`Process instance reached max restarts`, {
          processId: processInfo.id,
          instanceId: instance.id,
          maxRestarts: processInfo.config.maxRestarts
        });
        processInfo.status = 'errored';
      }
    }

    this.updateProcessStatus(processInfo);
    this.emit('instanceExit', processInfo, instance, code, signal);
  }

  private scheduleRestart(processInfo: ProcessInfo, instance: ProcessInstance): void {
    const delay = calculateExponentialBackoff(
      instance.restarts,
      processInfo.config.restartDelay!,
      processInfo.config.maxRestartDelay!
    );

    this.logger.info(`Scheduling restart in ${delay}ms`, {
      processId: processInfo.id,
      instanceId: instance.id,
      attempt: instance.restarts + 1
    });

    const timer = setTimeout(() => {
      this.restartInstance(processInfo, instance);
    }, delay);

    this.restartTimers.set(instance.id, timer);
  }

  private async restartInstance(processInfo: ProcessInfo, instance: ProcessInstance): Promise<void> {
    try {
      this.restartTimers.delete(instance.id);
      
      instance.restarts++;
      instance.lastRestart = Date.now();
      instance.status = 'starting';

      this.logger.info(`Restarting process instance`, {
        processId: processInfo.id,
        instanceId: instance.id,
        attempt: instance.restarts
      });

      const strategy = this.determineStrategy(processInfo.config);

      if (strategy === 'cluster') {
        await this.startClusterInstance(processInfo, 0);
      } else {
        await this.startSingleProcess(processInfo, strategy);
      }

      this.emit('instanceRestarted', processInfo, instance);
    } catch (error) {
      this.logger.error(`Failed to restart process instance`, {
        processId: processInfo.id,
        instanceId: instance.id,
        error: error.message
      });
      
      instance.status = 'errored';
      this.updateProcessStatus(processInfo);
    }
  }

  private updateProcessStatus(processInfo: ProcessInfo): void {
    const runningInstances = processInfo.instances.filter(i => i.status === 'running');
    const stoppedInstances = processInfo.instances.filter(i => i.status === 'stopped');
    const erroredInstances = processInfo.instances.filter(i => i.status === 'errored' || i.status === 'crashed');

    if (runningInstances.length > 0) {
      processInfo.status = 'running';
    } else if (erroredInstances.length > 0) {
      processInfo.status = 'errored';
    } else if (stoppedInstances.length === processInfo.instances.length) {
      processInfo.status = 'stopped';
    } else {
      processInfo.status = 'starting';
    }

    processInfo.updatedAt = Date.now();
    processInfo.restarts = processInfo.instances.reduce((sum, instance) => sum + instance.restarts, 0);
  }

  public async stopProcess(processId: string, force: boolean = false): Promise<void> {
    const processInfo = this.processes.get(processId);
    if (!processInfo) {
      throw new Error(`Process not found: ${processId}`);
    }

    processInfo.status = 'stopping';
    processInfo.updatedAt = Date.now();

    this.logger.info(`Stopping process: ${processInfo.name}`, { processId, force });

    const stopPromises = processInfo.instances.map(instance => 
      this.stopInstance(processInfo, instance, force)
    );

    await Promise.all(stopPromises);

    processInfo.status = 'stopped';
    processInfo.updatedAt = Date.now();

    this.emit('processStopped', processInfo);
  }

  private async stopInstance(processInfo: ProcessInfo, instance: ProcessInstance, force: boolean): Promise<void> {
    const childProcess = this.childProcesses.get(instance.id);
    if (!childProcess) return;

    return new Promise((resolve) => {
      const cleanup = () => {
        this.childProcesses.delete(instance.id);
        instance.status = 'stopped';
        resolve();
      };

      if (force) {
        childProcess.kill('SIGKILL');
        setTimeout(cleanup, 1000);
        return;
      }

      let killed = false;
      const killTimer = setTimeout(() => {
        if (!killed) {
          killed = true;
          childProcess.kill('SIGKILL');
          setTimeout(cleanup, FORCE_KILL_TIMEOUT);
        }
      }, GRACEFUL_SHUTDOWN_TIMEOUT);

      childProcess.once('exit', () => {
        if (!killed) {
          killed = true;
          clearTimeout(killTimer);
          cleanup();
        }
      });

      childProcess.kill('SIGTERM');
    });
  }

  public async restartProcess(processId: string): Promise<void> {
    await this.stopProcess(processId);
    
    const processInfo = this.processes.get(processId);
    if (!processInfo) {
      throw new Error(`Process not found after stop: ${processId}`);
    }

    processInfo.instances = [];
    const instanceCount = this.resolveInstanceCount(processInfo.config.instances);
    const strategy = this.determineStrategy(processInfo.config);

    processInfo.status = 'starting';
    processInfo.updatedAt = Date.now();

    if (strategy === 'cluster' && instanceCount > 1) {
      await this.startClusterProcess(processInfo, instanceCount);
    } else {
      await this.startSingleProcess(processInfo, strategy);
    }

    processInfo.status = 'running';
    processInfo.updatedAt = Date.now();

    this.emit('processRestarted', processInfo);
  }

  public deleteProcess(processId: string): void {
    const processInfo = this.processes.get(processId);
    if (!processInfo) {
      throw new Error(`Process not found: ${processId}`);
    }

    if (processInfo.status === 'running' || processInfo.status === 'starting') {
      throw new Error('Cannot delete running process. Stop it first.');
    }

    this.processes.delete(processId);
    this.logger.info(`Process deleted: ${processInfo.name}`, { processId });
    this.emit('processDeleted', processInfo);
  }

  public getProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  public getProcess(processId: string): ProcessInfo | undefined {
    return this.processes.get(processId);
  }

  public getProcessByName(name: string): ProcessInfo | undefined {
    return Array.from(this.processes.values()).find(p => p.name === name);
  }

  private findInstanceByPid(pid?: number): string | undefined {
    for (const processInfo of this.processes.values()) {
      for (const instance of processInfo.instances) {
        if (instance.pid === pid) {
          return instance.id;
        }
      }
    }
    return undefined;
  }

  private findProcessByInstanceId(instanceId: string): ProcessInfo | undefined {
    for (const processInfo of this.processes.values()) {
      if (processInfo.instances.some(i => i.id === instanceId)) {
        return processInfo;
      }
    }
    return undefined;
  }

  public async reloadAllProcesses(): Promise<void> {
    const runningProcesses = Array.from(this.processes.values())
      .filter(p => p.status === 'running');

    this.logger.info(`Reloading ${runningProcesses.length} processes`);

    const reloadPromises = runningProcesses.map(async (processInfo) => {
      try {
        await this.restartProcess(processInfo.id);
      } catch (error) {
        this.logger.error(`Failed to reload process ${processInfo.name}`, {
          processId: processInfo.id,
          error: error.message
        });
      }
    });

    await Promise.all(reloadPromises);
  }

  public async gracefulShutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    this.logger.info('Starting graceful shutdown');

    const runningProcesses = Array.from(this.processes.values())
      .filter(p => p.status === 'running' || p.status === 'starting');

    if (runningProcesses.length === 0) {
      this.logger.info('No running processes to stop');
      return;
    }

    this.logger.info(`Stopping ${runningProcesses.length} processes`);

    const stopPromises = runningProcesses.map(async (processInfo) => {
      try {
        await this.stopProcess(processInfo.id);
      } catch (error) {
        this.logger.error(`Failed to stop process ${processInfo.name}`, {
          processId: processInfo.id,
          error: error.message
        });
      }
    });

    await Promise.all(stopPromises);

    this.restartTimers.forEach(timer => clearTimeout(timer));
    this.restartTimers.clear();

    this.logger.info('Graceful shutdown completed');
  }

  public getHealthCheck(): HealthCheckResult[] {
    const results: HealthCheckResult[] = [];

    for (const processInfo of this.processes.values()) {
      for (const instance of processInfo.instances) {
        if (instance.status === 'running' && instance.pid) {
          try {
            const memUsage = process.memoryUsage();
            const uptime = instance.uptime ? Date.now() - instance.uptime : 0;

            results.push({
              processId: processInfo.id,
              memory: memUsage.rss,
              cpu: 0, // TODO: Implement CPU monitoring
              uptime,
              healthy: instance.status === 'running'
            });
          } catch (error) {
            results.push({
              processId: processInfo.id,
              memory: 0,
              cpu: 0,
              uptime: 0,
              healthy: false,
              issues: [`Health check failed: ${error.message}`]
            });
          }
        }
      }
    }

    return results;
  }
}