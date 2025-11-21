import { createServer, Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { readFile, realpath, access } from 'fs/promises';
import { join, extname, resolve } from 'path';
import { randomUUID } from 'crypto';
import { SimpleWebSocket, SimpleWebSocketServer } from './WebSocketServer';
import { LogEntry, ProcessInfo, WebSocketMessage, WebSocketEvent, WebUIConfig } from '../types';
import {
  DEFAULT_WEB_UI_CONFIG,
  NODEDAEMON_DIR,
  MAX_JSON_PAYLOAD_SIZE,
  MAX_REQUESTS_PER_MINUTE,
  MAX_WEBSOCKET_MESSAGES_PER_MINUTE
} from '../utils/constants';
import { RateLimiter } from './RateLimiter';

export class WebUIServer extends EventEmitter {
  private httpServer: HttpServer | null = null;
  private wsServer: SimpleWebSocketServer | null = null;
  private config: WebUIConfig;
  private clients: Map<string, SimpleWebSocket> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map(); // clientId -> processIds
  private staticPath: string;

  // Security: CSRF Protection
  private csrfTokens: Map<string, string> = new Map(); // clientId -> token

  // Security: Rate Limiting
  private httpRateLimiter: RateLimiter;
  private wsRateLimiter: RateLimiter;

  // Performance: Cache realStaticPath (doesn't change during runtime)
  private realStaticPath: string | null = null;

  constructor(config: Partial<WebUIConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WEB_UI_CONFIG, ...config };

    // Initialize rate limiters
    this.httpRateLimiter = new RateLimiter({
      maxRequests: MAX_REQUESTS_PER_MINUTE,
      windowMs: 60000 // 1 minute
    });

    this.wsRateLimiter = new RateLimiter({
      maxRequests: MAX_WEBSOCKET_MESSAGES_PER_MINUTE,
      windowMs: 60000 // 1 minute
    });

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

      // Fix SECURITY-003: Warn about insecure authentication
      if (this.config.auth && this.config.host !== '127.0.0.1' && this.config.host !== 'localhost') {
        console.warn('⚠️  WARNING: Web UI authentication is enabled without HTTPS!');
        console.warn('⚠️  Credentials will be transmitted in cleartext over the network.');
        console.warn('⚠️  It is STRONGLY RECOMMENDED to use a reverse proxy with HTTPS (nginx, Apache, Caddy).');
        console.warn('⚠️  Or bind to localhost only (127.0.0.1) and use SSH tunneling for remote access.');
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

      // Cleanup rate limiters
      this.httpRateLimiter.destroy();
      this.wsRateLimiter.destroy();
      this.csrfTokens.clear();

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

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '/';

    // Security: Add security headers to all HTTP responses
    this.addSecurityHeaders(res);

    // Security: Rate limiting - check before any processing
    const clientIp = this.getClientIdentifier(req);
    const rateLimitResult = this.httpRateLimiter.checkDetailed(clientIp);

    if (!rateLimitResult.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000).toString(),
        'X-RateLimit-Limit': MAX_REQUESTS_PER_MINUTE.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': rateLimitResult.resetAt.toString()
      });
      res.end(JSON.stringify({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)
      }));
      return;
    }

    // Add rate limit headers to response
    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS_PER_MINUTE.toString());
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
    res.setHeader('X-RateLimit-Reset', rateLimitResult.resetAt.toString());

    // Basic authentication check
    if (this.config.auth && !this.checkAuth(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="NodeDaemon Web UI"' });
      res.end('Unauthorized');
      return;
    }

    // Route handling - use async static file serving
    if (url === '/') {
      await this.serveStaticFile('/index.html', res);
    } else if (url.startsWith('/api/')) {
      this.handleApiRequest(url, req, res);
    } else {
      await this.serveStaticFile(url, res);
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
      // Security: CSRF Protection - validate token for state-changing operations
      if (!this.validateCsrfToken(req)) {
        res.writeHead(403);
        res.end(JSON.stringify({
          error: 'CSRF token validation failed',
          message: 'Missing or invalid X-CSRF-Token header'
        }));
        return;
      }

      let body = '';
      let bodySize = 0;

      req.on('data', chunk => {
        bodySize += chunk.length;

        // Fix SECURITY-005: Enforce maximum payload size
        if (bodySize > MAX_JSON_PAYLOAD_SIZE) {
          req.destroy();
          res.writeHead(413);
          res.end(JSON.stringify({ error: `Payload too large: exceeds ${MAX_JSON_PAYLOAD_SIZE} bytes` }));
          return;
        }

        body += chunk;
      });

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


  /**
   * Serve static files asynchronously
   * Uses async I/O to prevent blocking HTTP requests
   */
  private async serveStaticFile(urlPath: string, res: ServerResponse): Promise<void> {
    // Sanitize path
    const normalizedPath = urlPath.replace(/^\/+/, '');
    const filePath = join(this.staticPath, normalizedPath);

    // Fix SECURITY-001: Path traversal protection - validate BEFORE checking existence
    let realFilePath: string;
    let cachedRealStaticPath: string;

    try {
      // Performance: Cache realStaticPath (doesn't change during runtime)
      if (!this.realStaticPath) {
        this.realStaticPath = await realpath(this.staticPath);
      }
      cachedRealStaticPath = this.realStaticPath;

      // Check if requested file exists (async)
      try {
        await access(filePath);
      } catch {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // Resolve to real absolute path (follows symlinks) - async
      realFilePath = await realpath(filePath);

      // Security: Ensure we're not serving files outside static directory
      if (!realFilePath.startsWith(cachedRealStaticPath + '/') && realFilePath !== cachedRealStaticPath) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
    } catch (error) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Fix SECURITY-001: Use validated realFilePath for all operations
    const ext = extname(realFilePath).toLowerCase();
    const contentType = this.getContentType(ext);

    try {
      // Performance: Use async readFile instead of blocking readFileSync
      const content = await readFile(realFilePath);
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

    // Security: Generate CSRF token for this client
    const csrfToken = randomUUID();
    this.csrfTokens.set(clientId, csrfToken);

    ws.on('message', (data) => {
      try {
        // Fix SECURITY-005: Check message size before parsing
        const dataStr = data.toString();
        if (dataStr.length > MAX_JSON_PAYLOAD_SIZE) {
          ws.send(JSON.stringify({ error: `Message too large: exceeds ${MAX_JSON_PAYLOAD_SIZE} bytes` }));
          return;
        }

        // Security: Rate limiting for WebSocket messages
        const rateLimitResult = this.wsRateLimiter.checkDetailed(clientId);
        if (!rateLimitResult.allowed) {
          ws.send(JSON.stringify({
            error: 'Rate limit exceeded',
            retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
            rateLimitReset: rateLimitResult.resetAt
          }));
          return;
        }

        const message: WebSocketMessage = JSON.parse(dataStr);
        this.handleWebSocketMessage(clientId, message);
      } catch (error) {
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      this.subscriptions.delete(clientId);
      this.csrfTokens.delete(clientId); // Clean up CSRF token
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Send initial connection confirmation with CSRF token
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      csrfToken, // Security: Send CSRF token to client
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

  /**
   * Security: Validate CSRF token from request header
   *
   * For HTTP POST requests, validates the X-CSRF-Token header against
   * stored tokens from WebSocket connections.
   *
   * This prevents Cross-Site Request Forgery attacks where malicious
   * sites could trigger state-changing operations.
   */
  private validateCsrfToken(req: IncomingMessage): boolean {
    const token = req.headers['x-csrf-token'] as string;

    if (!token) {
      return false;
    }

    // Check if token exists in our stored tokens
    // We allow any valid token since we can't match to specific client ID from HTTP request
    for (const [clientId, storedToken] of this.csrfTokens.entries()) {
      if (token === storedToken) {
        return true;
      }
    }

    return false;
  }

  /**
   * Security: Add security headers to HTTP response
   *
   * Implements defense-in-depth security headers:
   * - X-Content-Type-Options: Prevents MIME-sniffing
   * - X-Frame-Options: Prevents clickjacking
   * - X-XSS-Protection: Enables browser XSS filter
   * - Referrer-Policy: Controls referrer information
   * - Content-Security-Policy: Restricts resource loading
   */
  private addSecurityHeaders(res: ServerResponse): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
  }

  /**
   * Security: Get unique identifier for client (for rate limiting)
   *
   * Uses IP address and port combination for HTTP requests.
   * Falls back to 'unknown' if socket information is unavailable.
   */
  private getClientIdentifier(req: IncomingMessage): string {
    const socket = req.socket;
    if (!socket) {
      return 'unknown';
    }

    const ip = socket.remoteAddress || 'unknown';
    const port = socket.remotePort || '0';

    return `${ip}:${port}`;
  }

  isRunning(): boolean {
    return this.httpServer !== null && this.httpServer.listening;
  }

  getConfig(): WebUIConfig {
    return { ...this.config };
  }
}