import { cpus } from 'os';

interface CpuUsage {
  user: number;
  system: number;
  idle: number;
  total: number;
}

const cpuUsageCache = new Map<number, { lastCpuUsage: CpuUsage; lastCheck: number }>();

function getCpuUsage(): CpuUsage {
  const cpuList = cpus();
  let user = 0;
  let system = 0;
  let idle = 0;
  let total = 0;

  cpuList.forEach(cpu => {
    user += cpu.times.user;
    system += cpu.times.sys;
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  });

  return { user, system, idle, total };
}

export function calculateCpuPercentage(pid?: number): number {
  if (!pid) return 0;

  const now = Date.now();
  const currentCpuUsage = getCpuUsage();
  
  const cached = cpuUsageCache.get(pid);
  
  if (!cached) {
    cpuUsageCache.set(pid, { lastCpuUsage: currentCpuUsage, lastCheck: now });
    return 0;
  }

  const timeDiff = now - cached.lastCheck;
  if (timeDiff < 1000) {
    return 0; // Need at least 1 second between measurements
  }

  const totalDiff = currentCpuUsage.total - cached.lastCpuUsage.total;
  const idleDiff = currentCpuUsage.idle - cached.lastCpuUsage.idle;
  
  if (totalDiff === 0) return 0;
  
  const usage = 100 - (100 * idleDiff / totalDiff);
  
  cpuUsageCache.set(pid, { lastCpuUsage: currentCpuUsage, lastCheck: now });
  
  return Math.max(0, Math.min(100, usage));
}

export function getProcessCpuUsage(pid: number): Promise<number> {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        // Windows: Use wmic command
        const { exec } = require('child_process');
        exec(`wmic process where ProcessId=${pid} get PercentProcessorTime`, (error: any, stdout: string) => {
          if (error) {
            resolve(0);
            return;
          }
          const lines = stdout.trim().split('\n');
          const cpu = parseFloat(lines[1]) || 0;
          resolve(cpu);
        });
      } else {
        // Unix/Linux: Use ps command
        const { exec } = require('child_process');
        exec(`ps -p ${pid} -o %cpu`, (error: any, stdout: string) => {
          if (error) {
            resolve(0);
            return;
          }
          const lines = stdout.trim().split('\n');
          const cpu = parseFloat(lines[1]) || 0;
          resolve(cpu);
        });
      }
    } catch {
      resolve(0);
    }
  });
}

export function clearCpuCache(pid: number): void {
  cpuUsageCache.delete(pid);
}