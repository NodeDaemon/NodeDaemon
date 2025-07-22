import { EventEmitter } from 'events';
import { ProcessInfo, HealthCheckResult } from '../types';
import { LogManager } from './LogManager';
import { 
  HEALTH_CHECK_INTERVAL, 
  MEMORY_THRESHOLD, 
  CPU_THRESHOLD 
} from '../utils/constants';
import { formatMemory } from '../utils/helpers';

interface ProcessMetrics {
  pid: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  cpu: {
    user: number;
    system: number;
    percent: number;
  };
  uptime: number;
  timestamp: number;
}

export class HealthMonitor extends EventEmitter {
  private logger: LogManager;
  private processes: Map<string, ProcessInfo> = new Map();
  private metrics: Map<number, ProcessMetrics[]> = new Map(); // PID -> metrics history
  private monitorInterval: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;
  private checkInterval: number = HEALTH_CHECK_INTERVAL;

  constructor(logger: LogManager) {
    super();
    this.logger = logger;
  }

  public addProcess(processInfo: ProcessInfo): void {
    this.processes.set(processInfo.id, processInfo);
    
    processInfo.instances.forEach(instance => {
      if (instance.pid) {
        this.metrics.set(instance.pid, []);
      }
    });
    
    if (!this.isMonitoring) {
      this.startMonitoring();
    }
  }

  public removeProcess(processId: string): void {
    const processInfo = this.processes.get(processId);
    if (processInfo) {
      processInfo.instances.forEach(instance => {
        if (instance.pid) {
          this.metrics.delete(instance.pid);
        }
      });
      this.processes.delete(processId);
    }
    
    if (this.processes.size === 0) {
      this.stopMonitoring();
    }
  }

  public updateProcess(processInfo: ProcessInfo): void {
    this.processes.set(processInfo.id, processInfo);
    
    // Add metrics tracking for new instances
    processInfo.instances.forEach(instance => {
      if (instance.pid && !this.metrics.has(instance.pid)) {
        this.metrics.set(instance.pid, []);
      }
    });
    
    // Remove metrics for stopped instances
    const activePids = new Set(
      processInfo.instances
        .filter(i => i.pid)
        .map(i => i.pid!)
    );
    
    for (const pid of this.metrics.keys()) {
      if (!activePids.has(pid)) {
        this.metrics.delete(pid);
      }
    }
  }

  public startMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.logger.info('Health monitoring started');
    
    this.monitorInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.checkInterval);
  }

  public stopMonitoring(): void {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    this.logger.info('Health monitoring stopped');
  }

  private async performHealthCheck(): Promise<void> {
    const results: HealthCheckResult[] = [];
    
    for (const [processId, processInfo] of this.processes.entries()) {
      for (const instance of processInfo.instances) {
        if (instance.pid && instance.status === 'running') {
          try {
            const result = await this.checkInstanceHealth(processId, instance.pid);
            results.push(result);
            
            // Update instance metrics
            if (result.memory) {
              instance.memory = result.memory;
            }
            if (result.cpu !== undefined) {
              instance.cpu = result.cpu;
            }
            
          } catch (error) {
            const result: HealthCheckResult = {
              processId,
              memory: 0,
              cpu: 0,
              uptime: 0,
              healthy: false,
              issues: [`Health check failed: ${error.message}`]
            };
            results.push(result);
          }
        }
      }
    }
    
    this.emit('healthCheck', results);
    this.analyzeHealthTrends(results);
  }

  private async checkInstanceHealth(processId: string, pid: number): Promise<HealthCheckResult> {
    const metrics = await this.getProcessMetrics(pid);
    const issues: string[] = [];
    
    // Memory check
    if (metrics.memory.rss > MEMORY_THRESHOLD) {
      issues.push(`High memory usage: ${formatMemory(metrics.memory.rss)}`);
    }
    
    // CPU check  
    if (metrics.cpu.percent > CPU_THRESHOLD) {
      issues.push(`High CPU usage: ${metrics.cpu.percent.toFixed(1)}%`);
    }
    
    // Store metrics history
    const history = this.metrics.get(pid) || [];
    history.push(metrics);
    
    // Keep only last 100 measurements
    if (history.length > 100) {
      history.shift();
    }
    this.metrics.set(pid, history);
    
    // Check for memory leaks
    this.detectMemoryLeak(pid, history, issues);
    
    // Check for CPU spikes
    this.detectCPUSpikes(pid, history, issues);
    
    const healthy = issues.length === 0;
    
    return {
      processId,
      memory: metrics.memory.rss,
      cpu: metrics.cpu.percent,
      uptime: metrics.uptime,
      healthy,
      issues: issues.length > 0 ? issues : undefined
    };
  }

  private async getProcessMetrics(pid: number): Promise<ProcessMetrics> {
    return new Promise((resolve, reject) => {
      try {
        // Check if process is still running
        process.kill(pid, 0);
        
        // Use pidusage-like approach for cross-platform metrics
        this.getPlatformMetrics(pid, (error, metrics) => {
          if (error) {
            reject(error);
          } else {
            resolve(metrics!);
          }
        });
        
      } catch (error) {
        reject(new Error('Process not found'));
      }
    });
  }

  private getPlatformMetrics(pid: number, callback: (error?: Error, metrics?: ProcessMetrics) => void): void {
    const platform = process.platform;
    
    if (platform === 'linux') {
      this.getLinuxMetrics(pid, callback);
    } else if (platform === 'darwin') {
      this.getMacMetrics(pid, callback);
    } else if (platform === 'win32') {
      this.getWindowsMetrics(pid, callback);
    } else {
      callback(new Error(`Unsupported platform: ${platform}`));
    }
  }

  private getLinuxMetrics(pid: number, callback: (error?: Error, metrics?: ProcessMetrics) => void): void {
    const fs = require('fs');
    const path = `/proc/${pid}/stat`;
    
    fs.readFile(path, 'utf8', (error: any, data: string) => {
      if (error) {
        return callback(error);
      }
      
      try {
        const stats = data.split(' ');
        const utime = parseInt(stats[13], 10); // User time
        const stime = parseInt(stats[14], 10); // System time
        const startTime = parseInt(stats[21], 10); // Start time
        
        // Get memory info
        const statusPath = `/proc/${pid}/status`;
        fs.readFile(statusPath, 'utf8', (statusError: any, statusData: string) => {
          if (statusError) {
            return callback(statusError);
          }
          
          const vmRSSMatch = statusData.match(/VmRSS:\s*(\d+)\s*kB/);
          const vmSizeMatch = statusData.match(/VmSize:\s*(\d+)\s*kB/);
          
          const rss = vmRSSMatch ? parseInt(vmRSSMatch[1], 10) * 1024 : 0;
          const vsize = vmSizeMatch ? parseInt(vmSizeMatch[1], 10) * 1024 : 0;
          
          const uptime = Date.now() - (startTime * 10); // Approximate uptime
          
          const metrics: ProcessMetrics = {
            pid,
            memory: {
              rss,
              heapTotal: vsize,
              heapUsed: rss,
              external: 0
            },
            cpu: {
              user: utime,
              system: stime,
              percent: 0 // Will be calculated from history
            },
            uptime,
            timestamp: Date.now()
          };
          
          callback(undefined, metrics);
        });
        
      } catch (parseError) {
        callback(parseError as Error);
      }
    });
  }

  private getMacMetrics(pid: number, callback: (error?: Error, metrics?: ProcessMetrics) => void): void {
    const { exec } = require('child_process');
    
    const cmd = `ps -o pid,rss,vsz,%cpu,etime -p ${pid}`;
    exec(cmd, (error: any, stdout: string) => {
      if (error) {
        return callback(error);
      }
      
      try {
        const lines = stdout.trim().split('\n');
        if (lines.length < 2) {
          return callback(new Error('Invalid ps output'));
        }
        
        const data = lines[1].trim().split(/\s+/);
        const rss = parseInt(data[1], 10) * 1024; // Convert KB to bytes
        const vsz = parseInt(data[2], 10) * 1024; // Convert KB to bytes
        const cpuPercent = parseFloat(data[3]);
        
        const metrics: ProcessMetrics = {
          pid,
          memory: {
            rss,
            heapTotal: vsz,
            heapUsed: rss,
            external: 0
          },
          cpu: {
            user: 0,
            system: 0,
            percent: cpuPercent
          },
          uptime: Date.now(),
          timestamp: Date.now()
        };
        
        callback(undefined, metrics);
        
      } catch (parseError) {
        callback(parseError as Error);
      }
    });
  }

  private getWindowsMetrics(pid: number, callback: (error?: Error, metrics?: ProcessMetrics) => void): void {
    const { exec } = require('child_process');
    
    const cmd = `wmic process where processid=${pid} get WorkingSetSize,VirtualSize,PageFileUsage,PercentProcessorTime /format:csv`;
    exec(cmd, (error: any, stdout: string) => {
      if (error) {
        return callback(error);
      }
      
      try {
        const lines = stdout.trim().split('\n');
        const dataLine = lines.find(line => line.includes(','));
        
        if (!dataLine) {
          return callback(new Error('Process not found in wmic output'));
        }
        
        const data = dataLine.split(',');
        const workingSet = parseInt(data[4], 10) || 0; // Working set (RSS equivalent)
        const virtualSize = parseInt(data[3], 10) || 0;
        
        const metrics: ProcessMetrics = {
          pid,
          memory: {
            rss: workingSet,
            heapTotal: virtualSize,
            heapUsed: workingSet,
            external: 0
          },
          cpu: {
            user: 0,
            system: 0,
            percent: 0 // Windows CPU calculation is complex
          },
          uptime: Date.now(),
          timestamp: Date.now()
        };
        
        callback(undefined, metrics);
        
      } catch (parseError) {
        callback(parseError as Error);
      }
    });
  }

  private detectMemoryLeak(pid: number, history: ProcessMetrics[], issues: string[]): void {
    if (history.length < 10) return; // Need sufficient data
    
    // Check if memory is consistently growing
    const recent = history.slice(-10);
    let growthCount = 0;
    
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].memory.rss > recent[i - 1].memory.rss) {
        growthCount++;
      }
    }
    
    // If memory grew in 80% of recent measurements
    if (growthCount >= 8) {
      const firstMemory = recent[0].memory.rss;
      const lastMemory = recent[recent.length - 1].memory.rss;
      const growthPercent = ((lastMemory - firstMemory) / firstMemory) * 100;
      
      if (growthPercent > 20) { // More than 20% growth
        issues.push(`Possible memory leak detected: ${growthPercent.toFixed(1)}% growth`);
      }
    }
  }

  private detectCPUSpikes(pid: number, history: ProcessMetrics[], issues: string[]): void {
    if (history.length < 5) return;
    
    const recent = history.slice(-5);
    const avgCPU = recent.reduce((sum, m) => sum + m.cpu.percent, 0) / recent.length;
    
    if (avgCPU > CPU_THRESHOLD * 1.5) { // 1.5x the normal threshold
      issues.push(`Sustained high CPU usage: ${avgCPU.toFixed(1)}% average`);
    }
  }

  private analyzeHealthTrends(results: HealthCheckResult[]): void {
    const unhealthyProcesses = results.filter(r => !r.healthy);
    
    if (unhealthyProcesses.length > 0) {
      this.logger.warn('Health issues detected', {
        affectedProcesses: unhealthyProcesses.length,
        totalProcesses: results.length,
        issues: unhealthyProcesses.map(p => ({
          processId: p.processId,
          issues: p.issues
        }))
      });
      
      this.emit('healthIssues', unhealthyProcesses);
    }
    
    // Check system-wide metrics
    const totalMemory = results.reduce((sum, r) => sum + r.memory, 0);
    const avgCPU = results.reduce((sum, r) => sum + r.cpu, 0) / results.length;
    
    this.emit('systemMetrics', {
      totalProcesses: results.length,
      totalMemory,
      averageCPU: avgCPU,
      healthyProcesses: results.filter(r => r.healthy).length
    });
  }

  public getMetricsHistory(pid: number): ProcessMetrics[] {
    return this.metrics.get(pid) || [];
  }

  public getHealthSummary(): any {
    const summary = {
      monitoredProcesses: this.processes.size,
      isMonitoring: this.isMonitoring,
      checkInterval: this.checkInterval,
      metricsHistory: this.metrics.size
    };
    
    return summary;
  }

  public setCheckInterval(interval: number): void {
    this.checkInterval = Math.max(1000, interval); // Minimum 1 second
    
    if (this.isMonitoring) {
      this.stopMonitoring();
      this.startMonitoring();
    }
  }

  public clearMetrics(): void {
    this.metrics.clear();
    this.logger.info('Health metrics cleared');
  }
}