import { formatMemory as utilFormatMemory, formatUptime as utilFormatUptime } from '../utils/helpers';

export class Formatter {
  public static formatTable(data: any[], columns: string[]): string {
    if (data.length === 0) {
      return 'No data to display';
    }

    // Calculate column widths
    const widths: Record<string, number> = {};
    
    columns.forEach(col => {
      let maxWidth = col.length;
      data.forEach(row => {
        const value = row[col] || '';
        const len = String(value).length;
        if (len > maxWidth) {
          maxWidth = len;
        }
      });
      widths[col] = maxWidth;
    });

    // Create header
    const header = columns.map(col => col.toUpperCase().padEnd(widths[col])).join('  ');
    const separator = columns.map(col => '-'.repeat(widths[col])).join('  ');

    // Create rows
    const rows = data.map(row => 
      columns.map(col => String(row[col] || '').padEnd(widths[col])).join('  ')
    );

    return [header, separator, ...rows].join('\n');
  }

  public static formatProcessList(processes: any[]): string {
    if (processes.length === 0) {
      return 'No processes running';
    }

    const formatted = processes.map(proc => ({
      NAME: proc.name,
      ID: proc.id.substring(0, 8),
      STATUS: this.formatStatus(proc.status),
      INSTANCES: proc.instances,
      RESTARTS: proc.restarts,
      UPTIME: utilFormatUptime(proc.uptime),
      MEMORY: utilFormatMemory(proc.memory),
      CPU: `${proc.cpu.toFixed(1)}%`
    }));

    return this.formatTable(formatted, [
      'NAME', 'ID', 'STATUS', 'INSTANCES', 'RESTARTS', 'UPTIME', 'MEMORY', 'CPU'
    ]);
  }

  public static formatProcessStatus(process: any): string {
    const lines: string[] = [];
    
    lines.push(`Process: ${process.name} (${process.id.substring(0, 8)})`);
    lines.push(`Script: ${process.script}`);
    lines.push(`Status: ${this.formatStatus(process.status)}`);
    lines.push(`Instances: ${process.instances.length}`);
    lines.push(`Restarts: ${process.restarts}`);
    lines.push(`Created: ${new Date(process.createdAt).toISOString()}`);
    lines.push(`Updated: ${new Date(process.updatedAt).toISOString()}`);
    
    if (process.instances.length > 0) {
      lines.push('\nInstances:');
      process.instances.forEach((instance: any, index: number) => {
        lines.push(`  ${index + 1}: PID ${instance.pid || 'N/A'} - ${this.formatStatus(instance.status)}`);
        if (instance.uptime) {
          lines.push(`     Uptime: ${utilFormatUptime(Date.now() - instance.uptime)}`);
        }
        if (instance.memory) {
          lines.push(`     Memory: ${utilFormatMemory(instance.memory)}`);
        }
        if (instance.restarts > 0) {
          lines.push(`     Restarts: ${instance.restarts}`);
        }
      });
    }
    
    lines.push('\nConfiguration:');
    if (process.config.instances) {
      lines.push(`  Instances: ${process.config.instances}`);
    }
    if (process.config.watch) {
      lines.push(`  Watch: ${Array.isArray(process.config.watch) ? process.config.watch.join(', ') : 'true'}`);
    }
    if (process.config.env) {
      lines.push(`  Environment: ${Object.keys(process.config.env).join(', ')}`);
    }
    if (process.config.cwd) {
      lines.push(`  Working Dir: ${process.config.cwd}`);
    }
    if (process.config.args && process.config.args.length > 0) {
      lines.push(`  Arguments: ${process.config.args.join(' ')}`);
    }
    if (process.config.maxMemory) {
      lines.push(`  Max Memory: ${process.config.maxMemory}`);
    }
    if (process.config.maxRestarts) {
      lines.push(`  Max Restarts: ${process.config.maxRestarts}`);
    }
    
    return lines.join('\n');
  }

  public static formatDaemonStatus(status: any): string {
    const lines: string[] = [];
    
    lines.push(`NodeDaemon Status`);
    lines.push(`================`);
    lines.push(`PID: ${status.daemon.pid}`);
    lines.push(`Version: ${status.daemon.version}`);
    lines.push(`Uptime: ${utilFormatUptime(status.daemon.uptime)}`);
    lines.push(`Processes: ${status.daemon.processCount}`);
    lines.push(`  Running: ${status.daemon.runningProcesses}`);
    lines.push(`  Stopped: ${status.daemon.stoppedProcesses}`);
    lines.push(`  Errored: ${status.daemon.erroredProcesses}`);
    
    if (status.health && status.health.length > 0) {
      lines.push('\nHealth Checks:');
      status.health.forEach((health: any) => {
        const healthStatus = health.healthy ? '✓ Healthy' : '✗ Unhealthy';
        lines.push(`  ${health.processId.substring(0, 8)}: ${healthStatus}`);
        if (health.memory) {
          lines.push(`    Memory: ${utilFormatMemory(health.memory)}`);
        }
        if (health.uptime) {
          lines.push(`    Uptime: ${utilFormatUptime(health.uptime)}`);
        }
        if (health.issues && health.issues.length > 0) {
          lines.push(`    Issues: ${health.issues.join(', ')}`);
        }
      });
    }
    
    return lines.join('\n');
  }

  public static formatLogs(logs: any[]): string {
    if (logs.length === 0) {
      return 'No logs available';
    }

    return logs
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(log => {
        const timestamp = new Date(log.timestamp).toISOString();
        const level = log.level.toUpperCase().padEnd(5);
        const processInfo = log.processId ? `[${log.processId.substring(0, 8)}]` : '[daemon]';
        const data = log.data ? ` ${JSON.stringify(log.data)}` : '';
        
        return `${timestamp} ${level} ${processInfo} ${log.message}${data}`;
      })
      .join('\n');
  }

  private static formatStatus(status: string): string {
    const colors: Record<string, string> = {
      running: '🟢',
      stopped: '🔴', 
      starting: '🟡',
      stopping: '🟡',
      errored: '🔴',
      crashed: '🔴'
    };

    const icon = colors[status] || '⚪';
    return `${icon} ${status.toUpperCase()}`;
  }

  public static formatSuccess(message: string): string {
    return `✅ ${message}`;
  }

  public static formatError(message: string): string {
    return `❌ ${message}`;
  }

  public static formatWarning(message: string): string {
    return `⚠️  ${message}`;
  }

  public static formatInfo(message: string): string {
    return `ℹ️  ${message}`;
  }

  public static colorize(text: string, color: 'red' | 'green' | 'yellow' | 'blue' | 'cyan' | 'white'): string {
    const colors = {
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
      white: '\x1b[37m'
    };
    
    const reset = '\x1b[0m';
    return `${colors[color]}${text}${reset}`;
  }

  public static bold(text: string): string {
    return `\x1b[1m${text}\x1b[0m`;
  }

  public static dim(text: string): string {
    return `\x1b[2m${text}\x1b[0m`;
  }

  // Re-export utility functions
  public static formatMemory = utilFormatMemory;
  public static formatUptime = utilFormatUptime;
}