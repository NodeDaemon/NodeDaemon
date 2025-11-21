import { createServer, Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';
import { readFileSync, existsSync, realpathSync } from 'fs';
import { join, extname, resolve } from 'path';
import { randomUUID } from 'crypto';
import { SimpleWebSocket, SimpleWebSocketServer } from './WebSocketServer';
import { LogEntry, ProcessInfo, WebSocketMessage, WebSocketEvent, WebUIConfig } from '../types';
import { DEFAULT_WEB_UI_CONFIG, NODEDAEMON_DIR } from '../utils/constants';

export class WebUIServer extends EventEmitter {
  private httpServer: HttpServer | null = null;
  private wsServer: SimpleWebSocketServer | null = null;
  private config: WebUIConfig;
  private clients: Map<string, SimpleWebSocket> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map(); // clientId -> processIds
  private staticPath: string;

  constructor(config: Partial<WebUIConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WEB_UI_CONFIG, ...config };
    // Try multiple paths to find web directory
    const possiblePaths = [
      join(__dirname, '..', 'web'),
      join(__dirname, '..', '..', 'web'),
      join(process.cwd(), 'dist', 'web'),
      join(process.cwd(), 'web')
    ];
    
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        this.staticPath = path;
        break;
      }
    }
    
    if (!this.staticPath) {
      this.staticPath = possiblePaths[0]; // fallback
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.config.enabled) {
        resolve();
        return;
      }

      this.httpServer = createServer(this.handleHttpRequest.bind(this));
      
      this.wsServer = new SimpleWebSocketServer();

      // Handle WebSocket upgrade requests
      this.httpServer.on('upgrade', (request, socket, head) => {
        if (request.url === '/ws') {
          this.wsServer!.handleUpgrade(request, socket, head);
        } else {
          socket.destroy();
        }
      });

      this.wsServer.on('connection', this.handleWebSocketConnection.bind(this));

      this.httpServer.listen(this.config.port, this.config.host, () => {
        console.log(`Web UI server listening on http://${this.config.host}:${this.config.port}`);
        console.log(`Serving static files from: ${this.staticPath}`);
        this.emit('started');
        resolve();
      });

      this.httpServer.on('error', (error) => {
        console.error('Web UI server error:', error);
        reject(error);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wsServer) {
        this.clients.forEach(client => client.close());
        this.wsServer.close();
      }

      if (this.httpServer) {
        this.httpServer.close(() => {
          this.emit('stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';
    
    // Basic authentication check
    if (this.config.auth && !this.checkAuth(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="NodeDaemon Web UI"' });
      res.end('Unauthorized');
      return;
    }

    // Route handling
    if (url === '/') {
      this.serveStaticFile('/index.html', res);
    } else if (url.startsWith('/api/')) {
      this.handleApiRequest(url, req, res);
    } else {
      this.serveStaticFile(url, res);
    }
  }

  private checkAuth(req: IncomingMessage): boolean {
    if (!this.config.auth) return true;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) return false;

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    return username === this.config.auth.username && password === this.config.auth.password;
  }

  private handleApiRequest(url: string, req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('Content-Type', 'application/json');

    const path = url.substring(5); // Remove /api/

    if (req.method === 'GET') {
      if (path === 'processes') {
        this.emit('api:list', (processes: ProcessInfo[]) => {
          res.writeHead(200);
          res.end(JSON.stringify(processes));
        });
      } else if (path === 'status') {
        this.emit('api:status', (status: any) => {
          res.writeHead(200);
          res.end(JSON.stringify(status));
        });
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          this.handleApiCommand(path, data, res);
        } catch (error) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } else {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  }

  private handleApiCommand(path: string, data: any, res: ServerResponse): void {
    const [resource, action] = path.split('/');

    if (resource === 'process' && data.processId) {
      this.emit(`api:${action}`, data.processId, (result: any) => {
        if (result.error) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: result.error }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, data: result }));
        }
      });
    } else {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
  }


  private serveStaticFile(urlPath: string, res: ServerResponse): void {
    // Sanitize path
    const normalizedPath = urlPath.replace(/^\/+/, '');
    const filePath = join(this.staticPath, normalizedPath);

    // Fix BUG-004: Proper path traversal protection using realpath
    // Check if file exists first
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    try {
      // Resolve to real absolute path (follows symlinks)
      const realFilePath = realpathSync(filePath);
      const realStaticPath = realpathSync(this.staticPath);

      // Security: Ensure we're not serving files outside static directory
      if (!realFilePath.startsWith(realStaticPath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
    } catch (error) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = this.getContentType(ext);

    try {
      const content = readFileSync(filePath);
      // Fix BUG-030: Add Content-Length header for HTTP/1.1 compliance
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length
      });
      res.end(content);
    } catch (error) {
      res.writeHead(500);
      res.end('Internal server error');
    }
  }

  private getContentType(ext: string): string {
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };
    return types[ext] || 'application/octet-stream';
  }

  private handleWebSocketConnection(ws: SimpleWebSocket, req: IncomingMessage): void {
    const clientId = this.generateClientId();
    this.clients.set(clientId, ws);
    this.subscriptions.set(clientId, new Set());

    ws.on('message', (data) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        this.handleWebSocketMessage(clientId, message);
      } catch (error) {
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      this.subscriptions.delete(clientId);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Send initial connection confirmation
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      timestamp: Date.now()
    }));
  }

  private handleWebSocketMessage(clientId: string, message: WebSocketMessage): void {
    const ws = this.clients.get(clientId);
    if (!ws) return;

    switch (message.type) {
      case 'subscribe':
        if (message.processId) {
          const subs = this.subscriptions.get(clientId) || new Set();
          subs.add(message.processId);
          this.subscriptions.set(clientId, subs);
        }
        break;

      case 'unsubscribe':
        if (message.processId) {
          const subs = this.subscriptions.get(clientId);
          if (subs) {
            subs.delete(message.processId);
          }
        }
        break;

      case 'command':
        this.emit(`ws:${message.action}`, message.data, (result: any) => {
          ws.send(JSON.stringify({
            type: 'response',
            action: message.action,
            data: result,
            timestamp: Date.now()
          }));
        });
        break;
    }
  }

  broadcastProcessUpdate(processInfo: ProcessInfo): void {
    // Transform process data to include aggregated values
    // Fix BUG-021: Safe array access - instances array could be empty during startup
    const mainInstance = processInfo.instances.length > 0 ? processInfo.instances[0] : null;
    const totalMemory = processInfo.instances.reduce((sum, i) => sum + (i.memory || 0), 0);
    const totalCpu = processInfo.instances.reduce((sum, i) => sum + (i.cpu || 0), 0);
    const uptime = mainInstance && mainInstance.uptime ?
      Math.floor((Date.now() - mainInstance.uptime) / 1000) : 0;
    
    const transformedProcess = {
      ...processInfo,
      memory: totalMemory,
      cpu: totalCpu,
      uptime: uptime
    };
    
    const event: WebSocketEvent = {
      type: 'process_update',
      data: transformedProcess,
      timestamp: Date.now()
    };

    this.broadcast(event, (clientId) => {
      const subs = this.subscriptions.get(clientId);
      return !subs || subs.size === 0 || subs.has(processInfo.id);
    });
  }

  broadcastLog(log: LogEntry): void {
    const event: WebSocketEvent = {
      type: 'log',
      data: log,
      timestamp: Date.now()
    };

    this.broadcast(event, (clientId) => {
      if (!log.processId) return true;
      const subs = this.subscriptions.get(clientId);
      return !subs || subs.size === 0 || subs.has(log.processId);
    });
  }

  broadcastMetric(processId: string, metric: { cpu: number; memory: number }): void {
    const event: WebSocketEvent = {
      type: 'metric',
      data: { processId, ...metric },
      timestamp: Date.now()
    };

    this.broadcast(event, (clientId) => {
      const subs = this.subscriptions.get(clientId);
      return !subs || subs.size === 0 || subs.has(processId);
    });
  }

  private broadcast(event: WebSocketEvent, filter?: (clientId: string) => boolean): void {
    const message = JSON.stringify(event);

    this.clients.forEach((ws, clientId) => {
      if (ws.readyState === 1) { // OPEN state
        if (!filter || filter(clientId)) {
          ws.send(message);
        }
      }
    });
  }

  private generateClientId(): string {
    // Fix BUG-025: Use cryptographically secure randomUUID instead of MD5 hash
    return randomUUID();
  }

  isRunning(): boolean {
    return this.httpServer !== null && this.httpServer.listening;
  }

  getConfig(): WebUIConfig {
    return { ...this.config };
  }
}