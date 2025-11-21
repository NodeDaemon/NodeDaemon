#!/usr/bin/env node

import { spawn } from 'child_process';
import { resolve } from 'path';
import { NodeDaemonCore } from '../daemon/NodeDaemonCore';
import { IPCClient } from './IPCClient';
import { CommandParser } from './CommandParser';
import { Formatter } from './Formatter';

class NodeDaemonCLI {
  private client: IPCClient = new IPCClient();
  private parser: CommandParser = new CommandParser();
  private watchInterval: NodeJS.Timeout | null = null;
  private followInterval: NodeJS.Timeout | null = null;

  public async run(argv: string[]): Promise<void> {
    try {
      const parsed = this.parser.parse(argv);
      
      switch (parsed.command) {
        case 'daemon':
          await this.handleDaemon(parsed.options);
          break;
        case 'start':
          await this.handleStart(parsed.options);
          break;
        case 'stop':
          await this.handleStop(parsed.options);
          break;
        case 'restart':
          await this.handleRestart(parsed.options);
          break;
        case 'list':
          await this.handleList(parsed.options);
          break;
        case 'status':
          await this.handleStatus(parsed.options);
          break;
        case 'logs':
          await this.handleLogs(parsed.options);
          break;
        case 'shutdown':
          await this.handleShutdown(parsed.options);
          break;
        case 'webui':
          await this.handleWebUI(parsed.options);
          break;
        case 'help':
          this.showHelp();
          break;
        case 'version':
          this.showVersion();
          break;
        default:
          throw new Error(`Unknown command: ${parsed.command}`);
      }
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  private async handleDaemon(options: any): Promise<void> {
    if (options.detach) {
      // Start daemon in background
      const daemonScript = resolve(__dirname, '../daemon/index.js');
      const child = spawn(process.execPath, [daemonScript], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...options }
      });

      child.unref();
      
      // Wait a moment to verify daemon started
      setTimeout(async () => {
        try {
          const client = new IPCClient();
          await client.connect();
          await client.disconnect();
          console.log(Formatter.formatSuccess(`Daemon started with PID ${child.pid}`));
        } catch (error) {
          console.log(Formatter.formatError('Daemon failed to start properly'));
          console.log(Formatter.formatInfo('Check daemon logs for details'));
        }
      }, 1000);
    } else {
      // Start daemon in foreground
      console.log(Formatter.formatInfo('Starting NodeDaemon...'));
      const daemon = new NodeDaemonCore();
      
      daemon.on('started', () => {
        console.log(Formatter.formatSuccess('NodeDaemon started successfully'));
      });

      daemon.on('shutdown', () => {
        console.log(Formatter.formatInfo('NodeDaemon shutdown complete'));
        process.exit(0);
      });

      await daemon.start();
      
      // Keep process running
      process.on('SIGINT', () => {
        console.log(Formatter.formatInfo('Shutting down daemon...'));
        daemon.gracefulShutdown('SIGINT');
      });
      
      process.on('SIGTERM', () => {
        console.log(Formatter.formatInfo('Shutting down daemon...'));
        daemon.gracefulShutdown('SIGTERM');
      });
    }
  }

  private async handleStart(options: any): Promise<void> {
    // Auto-start daemon if not running and not explicitly disabled
    if (!options.noDaemon) {
      await this.ensureDaemonRunning();
    }

    try {
      await this.client.connect();
      const result = await this.client.start(options.config);
      
      console.log(Formatter.formatSuccess(`Process started successfully`));
      console.log(`Process ID: ${result.processId}`);
      console.log(`Name: ${options.config?.name || 'unnamed'}`);
      console.log(`Script: ${options.config?.script}`);
      
      if (options.config?.instances && options.config.instances > 1) {
        console.log(`Instances: ${options.config.instances}`);
      }
      
      if (options.config?.watch) {
        console.log(`Watch: enabled`);
      }
      
    } finally {
      this.client.disconnect();
    }
  }

  private async handleStop(options: any): Promise<void> {
    try {
      await this.client.connect();
      
      const stopOptions: any = { force: options.force };
      if (options.byName) {
        stopOptions.name = options.target;
      } else {
        stopOptions.processId = options.target;
      }
      
      await this.client.stop(stopOptions);
      console.log(Formatter.formatSuccess(`Process stopped successfully`));
      
    } finally {
      this.client.disconnect();
    }
  }

  private async handleRestart(options: any): Promise<void> {
    try {
      await this.client.connect();
      
      const restartOptions: any = {};
      if (options.byName) {
        restartOptions.name = options.target;
      } else {
        restartOptions.processId = options.target;
      }
      
      if (options.graceful) {
        restartOptions.graceful = true;
      }
      
      await this.client.restart(restartOptions);
      console.log(Formatter.formatSuccess(
        options.graceful ? 'Process gracefully reloaded successfully' : 'Process restarted successfully'
      ));
      
    } finally {
      this.client.disconnect();
    }
  }

  private async handleList(options: any): Promise<void> {
    try {
      await this.client.connect();
      const result = await this.client.list();
      
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      
      console.log(Formatter.formatProcessList(result.processes));
      
      if (result.stats) {
        console.log('\nDaemon Stats:');
        console.log(`  Uptime: ${Formatter.formatUptime(result.stats.uptime || 0)}`);
        console.log(`  Total Processes: ${result.stats.processCount}`);
        console.log(`  Running: ${result.stats.runningProcesses}`);
        console.log(`  Stopped: ${result.stats.stoppedProcesses}`);
        console.log(`  Errored: ${result.stats.erroredProcesses}`);
      }
      
      if (options.watch) {
        console.log(Formatter.formatInfo('Watching for changes... (Press Ctrl+C to exit)'));

        // Clear any existing watch interval
        if (this.watchInterval) {
          clearInterval(this.watchInterval);
        }

        this.watchInterval = setInterval(async () => {
          try {
            const updated = await this.client.list();
            console.clear();
            console.log(Formatter.formatProcessList(updated.processes));
          } catch (error: any) {
            console.error(Formatter.formatError('Failed to update list'));
          }
        }, 2000);

        // Clear interval on exit
        process.once('SIGINT', () => {
          if (this.watchInterval) {
            clearInterval(this.watchInterval);
            this.watchInterval = null;
          }
          this.client.disconnect();
          process.exit(0);
        });
      }

    } finally {
      if (!options.watch) {
        this.client.disconnect();
      }
    }
  }

  private async handleStatus(options: any): Promise<void> {
    try {
      await this.client.connect();
      
      let statusOptions;
      if (options.target) {
        statusOptions = {};
        if (options.byName) {
          statusOptions.name = options.target;
        } else {
          statusOptions.processId = options.target;
        }
      }
      
      const result = await this.client.status(statusOptions);
      
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      
      if (result.daemon) {
        // Daemon status
        console.log(Formatter.formatDaemonStatus(result));
      } else {
        // Process status
        console.log(Formatter.formatProcessStatus(result));
      }
      
    } finally {
      this.client.disconnect();
    }
  }

  private async handleLogs(options: any): Promise<void> {
    try {
      await this.client.connect();
      
      const logsOptions: any = { lines: options.lines };
      if (options.target) {
        if (options.byName) {
          logsOptions.name = options.target;
        } else {
          logsOptions.processId = options.target;
        }
      }
      
      const result = await this.client.logs(logsOptions);
      
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      
      if (result.logs && result.logs.length > 0) {
        console.log(Formatter.formatLogs(result.logs));
      } else {
        console.log(Formatter.formatInfo('No logs available'));
      }
      
      if (options.follow) {
        console.log(Formatter.formatInfo('Following logs... (Press Ctrl+C to exit)'));

        // Fix BUG-014: Handle empty array case for Math.max
        let lastTimestamp = result.logs.length > 0
          ? Math.max(...result.logs.map((log: any) => log.timestamp))
          : 0;

        // Clear any existing follow interval
        if (this.followInterval) {
          clearInterval(this.followInterval);
        }

        this.followInterval = setInterval(async () => {
          try {
            const updated = await this.client.logs(logsOptions);
            const newLogs = updated.logs.filter((log: any) => log.timestamp > lastTimestamp);

            if (newLogs.length > 0) {
              console.log(Formatter.formatLogs(newLogs));
              lastTimestamp = Math.max(...newLogs.map((log: any) => log.timestamp));
            }
          } catch (error: any) {
            console.error(Formatter.formatError('Failed to fetch logs'));
          }
        }, 1000);

        // Clear interval on exit
        process.once('SIGINT', () => {
          if (this.followInterval) {
            clearInterval(this.followInterval);
            this.followInterval = null;
          }
          this.client.disconnect();
          process.exit(0);
        });
      }

    } finally {
      if (!options.follow) {
        this.client.disconnect();
      }
    }
  }

  private async handleShutdown(options: any): Promise<void> {
    try {
      await this.client.connect();
      
      if (options.force) {
        console.log(Formatter.formatWarning('Force shutdown requested'));
      } else {
        console.log(Formatter.formatInfo('Gracefully shutting down daemon...'));
      }
      
      await this.client.shutdown();
      console.log(Formatter.formatSuccess('Daemon shutdown initiated'));

    } catch (error) {
      // Fix BUG-022: Check if error is Error object before accessing .message
      if (error instanceof Error && error.message.includes('not running')) {
        console.log(Formatter.formatInfo('Daemon is not running'));
      } else {
        throw error;
      }
    } finally {
      this.client.disconnect();
    }
  }

  private async handleWebUI(options: any): Promise<void> {
    try {
      await this.client.connect();
      
      switch (options.action) {
        case 'start':
          const config: any = {
            enabled: true
          };
          
          if (options.port) {
            config.port = parseInt(options.port);
            if (isNaN(config.port)) {
              throw new Error('Invalid port number');
            }
          }
          
          if (options.host) {
            config.host = options.host;
          }

          // Fix BUG-011: Read password from environment variable instead of command-line
          const password = process.env.NODEDAEMON_WEBUI_PASSWORD;

          if (options.username && password) {
            config.auth = {
              username: options.username,
              password: password
            };
          } else if (options.username && !password) {
            throw new Error('Username provided but NODEDAEMON_WEBUI_PASSWORD environment variable is not set.\nSet it with: export NODEDAEMON_WEBUI_PASSWORD=your_password');
          } else if (!options.username && password) {
            throw new Error('Password provided via environment variable but username is missing.\nProvide username with: nodedaemon webui start -u your_username');
          }
          
          const startResult = await this.client.sendMessage('webui', { action: 'set', config });
          
          if (startResult.success) {
            const webConfig = startResult.data;
            console.log(Formatter.formatSuccess('Web UI started'));
            console.log(Formatter.formatInfo(`URL: http://${webConfig.host}:${webConfig.port}`));
            if (webConfig.auth) {
              console.log(Formatter.formatWarning('Authentication enabled'));
            }
          } else {
            throw new Error(startResult.error || 'Failed to start Web UI');
          }
          break;
          
        case 'stop':
          const stopResult = await this.client.sendMessage('webui', { 
            action: 'set', 
            config: { enabled: false } 
          });
          
          if (stopResult.success) {
            console.log(Formatter.formatSuccess('Web UI stopped'));
          } else {
            throw new Error(stopResult.error || 'Failed to stop Web UI');
          }
          break;
          
        case 'status':
          const statusResult = await this.client.sendMessage('webui', { action: 'status' });
          
          if (statusResult.success) {
            const config = statusResult.data;
            if (config && config.enabled) {
              console.log(Formatter.formatSuccess('Web UI is running'));
              console.log(Formatter.formatInfo(`URL: http://${config.host}:${config.port}`));
              if (config.auth) {
                console.log(Formatter.formatInfo('Authentication: Enabled'));
              } else {
                console.log(Formatter.formatInfo('Authentication: Disabled'));
              }
            } else {
              console.log(Formatter.formatInfo('Web UI is not running'));
            }
          } else {
            throw new Error(statusResult.error || 'Failed to get Web UI status');
          }
          break;
          
        default:
          throw new Error(`Unknown webui action: ${options.action}`);
      }

    } catch (error) {
      // Fix BUG-022: Check if error is Error object before accessing .message
      if (error instanceof Error && error.message.includes('not running')) {
        console.log(Formatter.formatError('Daemon is not running'));
        console.log(Formatter.formatInfo('Start the daemon first: nodedaemon daemon'));
      } else {
        throw error;
      }
    } finally {
      this.client.disconnect();
    }
  }

  private async ensureDaemonRunning(): Promise<void> {
    try {
      await this.client.connect();
      await this.client.ping();
      this.client.disconnect();
    } catch (error) {
      if (error.message.includes('not running')) {
        console.log(Formatter.formatInfo('Starting daemon...'));
        
        // Start daemon in background
        const daemonScript = resolve(__dirname, '../daemon/index.js');
        const child = spawn(process.execPath, [daemonScript], {
          detached: true,
          stdio: 'ignore'
        });

        child.unref();
        
        // Wait for daemon to be ready
        let retries = 0;
        const maxRetries = 30;
        
        while (retries < maxRetries) {
          try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.client.connect();
            await this.client.ping();
            this.client.disconnect();
            console.log(Formatter.formatSuccess('Daemon started successfully'));
            return;
          } catch {
            retries++;
          }
        }
        
        throw new Error('Failed to start daemon - timeout');
      } else {
        throw error;
      }
    }
  }

  private showHelp(): void {
    console.log(this.parser.getHelp());
  }

  private showVersion(): void {
    console.log(`NodeDaemon v${this.parser.getVersion()}`);
  }

  private handleError(error: any): void {
    const message = error?.message || String(error);
    console.error(Formatter.formatError(message));
    
    if (process.env.NODE_ENV === 'development') {
      console.error(error?.stack || error);
    }
    
    process.exit(1);
  }
}

// Entry point
if (require.main === module) {
  const cli = new NodeDaemonCLI();
  cli.run(process.argv).catch((error: any) => {
    const message = error?.message || String(error);
    console.error(Formatter.formatError(`Unexpected error: ${message}`));
    process.exit(1);
  });
}

export { NodeDaemonCLI };