import { parseArgs } from 'util';
import { ProcessConfig } from '../types';
import { isFile, validateProcessConfig } from '../utils/helpers';

export interface ParsedCommand {
  command: string;
  options: any;
  args: string[];
}

export class CommandParser {
  public parse(argv: string[]): ParsedCommand {
    if (argv.length < 3) {
      return { command: 'help', options: {}, args: [] };
    }

    const command = argv[2];
    const commandArgs = argv.slice(3);

    switch (command) {
      case 'daemon':
        return this.parseDaemonCommand(commandArgs);
      case 'start':
        return this.parseStartCommand(commandArgs);
      case 'stop':
        return this.parseStopCommand(commandArgs);
      case 'restart':
        return this.parseRestartCommand(commandArgs);
      case 'list':
      case 'ls':
        return this.parseListCommand(commandArgs);
      case 'status':
        return this.parseStatusCommand(commandArgs);
      case 'logs':
        return this.parseLogsCommand(commandArgs);
      case 'shutdown':
        return this.parseShutdownCommand(commandArgs);
      case 'webui':
        return this.parseWebUICommand(commandArgs);
      case 'help':
      case '--help':
      case '-h':
        return { command: 'help', options: {}, args: [] };
      case 'version':
      case '--version':
      case '-v':
        return { command: 'version', options: {}, args: [] };
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  private parseDaemonCommand(args: string[]): ParsedCommand {
    const { values, positionals } = parseArgs({
      args,
      options: {
        detach: { type: 'boolean', short: 'd' },
        'log-level': { type: 'string', default: 'info' },
        'socket-path': { type: 'string' }
      },
      allowPositionals: true
    });

    return {
      command: 'daemon',
      options: values,
      args: positionals
    };
  }

  private parseStartCommand(args: string[]): ParsedCommand {
    const { values, positionals } = parseArgs({
      args,
      options: {
        name: { type: 'string', short: 'n' },
        instances: { type: 'string', short: 'i' },
        watch: { type: 'boolean', short: 'w' },
        'watch-paths': { type: 'string', multiple: true },
        env: { type: 'string', multiple: true, short: 'e' },
        'env-file': { type: 'string' },
        cwd: { type: 'string' },
        args: { type: 'string', multiple: true },
        interpreter: { type: 'string' },
        'max-memory': { type: 'string' },
        'max-restarts': { type: 'string' },
        'restart-delay': { type: 'string' },
        'min-uptime': { type: 'string' },
        'auto-restart-memory': { type: 'boolean' },
        'auto-restart-cpu': { type: 'boolean' },
        'memory-threshold': { type: 'string' },
        'cpu-threshold': { type: 'string' },
        'no-daemon': { type: 'boolean' }
      },
      allowPositionals: true
    });

    if (positionals.length === 0) {
      throw new Error('Script path is required');
    }

    const script = positionals[0];
    if (!isFile(script)) {
      throw new Error(`Script file not found: ${script}`);
    }

    // Parse environment variables
    const env: Record<string, string> = {};
    if (values.env && Array.isArray(values.env)) {
      values.env.forEach(envVar => {
        const [key, value] = envVar.split('=', 2);
        if (key && value !== undefined) {
          env[key] = value;
        }
      });
    }

    // Parse instances
    let instances: number | 'max' = 1;
    if (values.instances) {
      if (values.instances === 'max') {
        instances = 'max';
      } else {
        const parsed = parseInt(values.instances, 10);
        if (isNaN(parsed) || parsed < 1) {
          throw new Error('instances must be a positive number or "max"');
        }
        instances = parsed;
      }
    }

    // Parse watch paths
    let watch: boolean | string[] = false;
    if (values.watch) {
      watch = true;
    }
    if (values['watch-paths']) {
      watch = values['watch-paths'];
    }

    const config: ProcessConfig = {
      script,
      name: values.name as string,
      instances,
      watch,
      env: Object.keys(env).length > 0 ? env : undefined,
      envFile: values['env-file'] as string,
      cwd: values.cwd as string,
      args: positionals.slice(1).concat(values.args || []),
      interpreter: values.interpreter as string,
      maxMemory: values['max-memory'] as string,
      maxRestarts: values['max-restarts'] ? parseInt(values['max-restarts'], 10) : undefined,
      restartDelay: values['restart-delay'] ? parseInt(values['restart-delay'], 10) : undefined,
      minUptime: values['min-uptime'] ? parseInt(values['min-uptime'], 10) : undefined,
      autoRestartOnHighMemory: values['auto-restart-memory'] as boolean,
      autoRestartOnHighCpu: values['auto-restart-cpu'] as boolean,
      memoryThreshold: values['memory-threshold'] as string,
      cpuThreshold: values['cpu-threshold'] ? parseInt(values['cpu-threshold'], 10) : undefined
    };

    // Validate config
    validateProcessConfig(config);

    return {
      command: 'start',
      options: {
        config,
        noDaemon: values['no-daemon']
      },
      args: positionals
    };
  }

  private parseStopCommand(args: string[]): ParsedCommand {
    const { values, positionals } = parseArgs({
      args,
      options: {
        force: { type: 'boolean', short: 'f' },
        name: { type: 'string', short: 'n' },
        id: { type: 'string' }
      },
      allowPositionals: true
    });

    const target = positionals[0] || values.name || values.id;
    if (!target) {
      throw new Error('Process name or ID is required');
    }

    return {
      command: 'stop',
      options: {
        target,
        force: values.force,
        byName: !values.id && (values.name || !target.includes('-'))
      },
      args: positionals
    };
  }

  private parseRestartCommand(args: string[]): ParsedCommand {
    const { values, positionals } = parseArgs({
      args,
      options: {
        name: { type: 'string', short: 'n' },
        id: { type: 'string' },
        graceful: { type: 'boolean', short: 'g' }
      },
      allowPositionals: true
    });

    const target = positionals[0] || values.name || values.id;
    if (!target) {
      throw new Error('Process name or ID is required');
    }

    return {
      command: 'restart',
      options: {
        target,
        byName: !values.id && (values.name || !target.includes('-')),
        graceful: values.graceful
      },
      args: positionals
    };
  }

  private parseListCommand(args: string[]): ParsedCommand {
    const { values } = parseArgs({
      args,
      options: {
        format: { type: 'string', short: 'f' },
        json: { type: 'boolean' },
        watch: { type: 'boolean', short: 'w' }
      },
      allowPositionals: false
    });

    return {
      command: 'list',
      options: {
        format: values.format || 'table',
        json: values.json,
        watch: values.watch
      },
      args: []
    };
  }

  private parseStatusCommand(args: string[]): ParsedCommand {
    const { values, positionals } = parseArgs({
      args,
      options: {
        name: { type: 'string', short: 'n' },
        id: { type: 'string' },
        json: { type: 'boolean' }
      },
      allowPositionals: true
    });

    const target = positionals[0] || values.name || values.id;

    return {
      command: 'status',
      options: {
        target,
        byName: target && !values.id && (values.name || !target.includes('-')),
        json: values.json
      },
      args: positionals
    };
  }

  private parseLogsCommand(args: string[]): ParsedCommand {
    const { values, positionals } = parseArgs({
      args,
      options: {
        name: { type: 'string', short: 'n' },
        id: { type: 'string' },
        lines: { type: 'string', short: 'l' },
        follow: { type: 'boolean', short: 'f' },
        json: { type: 'boolean' }
      },
      allowPositionals: true
    });

    const target = positionals[0] || values.name || values.id;
    const lines = values.lines ? parseInt(values.lines, 10) : 100;

    if (isNaN(lines) || lines < 1) {
      throw new Error('lines must be a positive number');
    }

    return {
      command: 'logs',
      options: {
        target,
        byName: target && !values.id && (values.name || !target.includes('-')),
        lines,
        follow: values.follow,
        json: values.json
      },
      args: positionals
    };
  }

  private parseShutdownCommand(args: string[]): ParsedCommand {
    const { values } = parseArgs({
      args,
      options: {
        force: { type: 'boolean', short: 'f' }
      },
      allowPositionals: false
    });

    return {
      command: 'shutdown',
      options: {
        force: values.force
      },
      args: []
    };
  }

  private parseWebUICommand(args: string[]): ParsedCommand {
    if (args.length === 0) {
      throw new Error('WebUI subcommand required: start, stop, status');
    }

    const subcommand = args[0];
    const subArgs = args.slice(1);

    switch (subcommand) {
      case 'start':
        const { values: startValues } = parseArgs({
          args: subArgs,
          options: {
            port: { type: 'string', short: 'p' },
            host: { type: 'string', short: 'h' },
            username: { type: 'string', short: 'u' },
            password: { type: 'string' }
          },
          allowPositionals: false
        });
        return {
          command: 'webui',
          options: {
            action: 'start',
            ...startValues
          },
          args: []
        };

      case 'stop':
        return {
          command: 'webui',
          options: { action: 'stop' },
          args: []
        };

      case 'status':
        return {
          command: 'webui',
          options: { action: 'status' },
          args: []
        };

      default:
        throw new Error(`Unknown webui subcommand: ${subcommand}`);
    }
  }

  public getHelp(): string {
    return `
NodeDaemon - Production-ready Node.js process manager

USAGE:
  nodedaemon <command> [options]

COMMANDS:
  daemon                    Start the daemon process
  start <script> [options]  Start a new process
  stop <name|id> [options]  Stop a process
  restart <name|id>         Restart a process  
  list|ls [options]         List all processes
  status [name|id]          Show process status
  logs <name|id> [options]  Show process logs
  webui <subcommand>        Manage Web UI
  shutdown                  Shutdown the daemon
  help                      Show this help
  version                   Show version

DAEMON OPTIONS:
  -d, --detach             Run daemon in background
  --log-level <level>      Set log level (debug, info, warn, error)
  --socket-path <path>     Custom IPC socket path

START OPTIONS:
  -n, --name <name>        Process name
  -i, --instances <count>  Number of instances (default: 1, or 'max' for CPU count)
  -w, --watch              Watch for file changes and restart
  --watch-paths <paths>    Specific paths to watch (comma-separated)
  -e, --env <KEY=VALUE>    Environment variables (can be used multiple times)
  --env-file <file>        Load environment from file (.env, .env.local, etc)
  --cwd <path>             Working directory
  --args <args>            Arguments to pass to script
  --interpreter <cmd>      Custom interpreter (default: node)
  --max-memory <size>      Maximum memory before restart (e.g., 512MB)
  --max-restarts <count>   Maximum restart attempts
  --restart-delay <ms>     Delay between restarts
  --min-uptime <ms>        Minimum uptime to reset restart counter
  --auto-restart-memory    Auto-restart on high memory usage
  --auto-restart-cpu       Auto-restart on high CPU usage
  --memory-threshold <size> Memory threshold for auto-restart (default: 512MB)
  --cpu-threshold <percent> CPU threshold for auto-restart (default: 80)
  --no-daemon              Don't start daemon if not running

STOP OPTIONS:
  -f, --force              Force kill process
  -n, --name <name>        Stop by process name
  --id <id>                Stop by process ID

LIST OPTIONS:
  -f, --format <format>    Output format (table, json)
  --json                   Output as JSON
  -w, --watch              Watch for changes

STATUS OPTIONS:
  -n, --name <name>        Show status by process name
  --id <id>                Show status by process ID
  --json                   Output as JSON

LOGS OPTIONS:
  -n, --name <name>        Show logs by process name
  --id <id>                Show logs by process ID
  -l, --lines <count>      Number of lines to show (default: 100)
  -f, --follow             Follow log output
  --json                   Output as JSON

WEBUI SUBCOMMANDS:
  start                    Start the Web UI server
  stop                     Stop the Web UI server
  status                   Show Web UI status

WEBUI START OPTIONS:
  -p, --port <port>        Port to listen on (default: 8080)
  -h, --host <host>        Host to bind to (default: 127.0.0.1)
  -u, --username <user>    Basic auth username
  --password <pass>        Basic auth password

EXAMPLES:
  nodedaemon daemon -d                           # Start daemon in background
  nodedaemon start app.js -n myapp -i 4 -w      # Start app with 4 instances and watch
  nodedaemon start server.js -e NODE_ENV=prod   # Start with environment variable
  nodedaemon list                                # List all processes
  nodedaemon stop myapp                          # Stop process by name
  nodedaemon logs myapp -l 50 -f                # Follow last 50 log lines
  nodedaemon status                              # Show daemon status
  nodedaemon webui start -p 3000                # Start Web UI on port 3000
  nodedaemon webui status                        # Check Web UI status
  nodedaemon shutdown                            # Shutdown daemon
`;
  }

  public getVersion(): string {
    return '1.0.2';
  }
}