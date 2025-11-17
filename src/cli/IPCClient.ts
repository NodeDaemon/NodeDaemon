import { Socket, connect } from 'net';
import { IPCMessage, IPCResponse } from '../types';
import { generateId } from '../utils/helpers';
import { IPC_SOCKET_PATH } from '../utils/constants';

export class IPCClient {
  private socket: Socket | null = null;
  private pendingRequests: Map<string, {
    resolve: (response: IPCResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private connected: boolean = false;
  private connectionTimeout: number = 5000;
  private requestTimeout: number = 30000;

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = new Socket();
      
      const connectionTimer = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error('Connection timeout'));
      }, this.connectionTimeout);

      this.socket.connect(IPC_SOCKET_PATH, () => {
        clearTimeout(connectionTimer);
        this.connected = true;
        this.setupSocketHandlers();
        resolve();
      });

      this.socket.on('error', (error) => {
        clearTimeout(connectionTimer);
        if (error.message.includes('ENOENT') || error.message.includes('ECONNREFUSED')) {
          reject(new Error('NodeDaemon is not running. Start it with: nodedaemon daemon'));
        } else {
          reject(new Error(`Connection failed: ${error.message}`));
        }
      });
    });
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return;

    let buffer = '';

    this.socket.on('data', (data) => {
      buffer += data.toString();
      
      // Process complete JSON messages (separated by newlines)
      const messages = buffer.split('\n');
      buffer = messages.pop() || ''; // Keep incomplete message in buffer
      
      messages.forEach(messageStr => {
        if (messageStr.trim()) {
          try {
            const response: IPCResponse = JSON.parse(messageStr);
            this.handleResponse(response);
          } catch (error) {
            console.error('Failed to parse response:', error);
          }
        }
      });
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error.message);
      this.handleDisconnection();
    });

    this.socket.on('close', () => {
      this.handleDisconnection();
    });

    this.socket.on('end', () => {
      this.handleDisconnection();
    });
  }

  private handleResponse(response: IPCResponse): void {
    const request = this.pendingRequests.get(response.id);
    if (request) {
      clearTimeout(request.timeout);
      this.pendingRequests.delete(response.id);
      
      if (response.success) {
        request.resolve(response);
      } else {
        const error = response.data?.error || 'Unknown error';
        request.reject(new Error(error));
      }
    }
  }

  private handleDisconnection(): void {
    this.connected = false;
    this.socket = null;
    
    // Reject all pending requests
    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection lost'));
    });
    this.pendingRequests.clear();
  }

  public async sendMessage(type: IPCMessage['type'], data?: any): Promise<any> {
    if (!this.connected || !this.socket) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const id = generateId();
      const message: IPCMessage = {
        id,
        type,
        data,
        timestamp: Date.now()
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for ${type}`));
      }, this.requestTimeout);

      this.pendingRequests.set(id, {
        resolve: (response) => resolve(response.data),
        reject,
        timeout
      });

      const messageData = JSON.stringify(message) + '\n';

      // Fix BUG-008: Re-check socket before write instead of using non-null assertion
      if (!this.socket) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error('Socket disconnected before sending message'));
        return;
      }

      this.socket.write(messageData, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to send message: ${error.message}`));
        }
      });
    });
  }

  public async ping(): Promise<any> {
    return this.sendMessage('ping');
  }

  public async start(config: any): Promise<any> {
    return this.sendMessage('start', config);
  }

  public async stop(options: { processId?: string; name?: string; force?: boolean }): Promise<any> {
    return this.sendMessage('stop', options);
  }

  public async restart(options: { processId?: string; name?: string }): Promise<any> {
    return this.sendMessage('restart', options);
  }

  public async list(): Promise<any> {
    return this.sendMessage('list');
  }

  public async status(options?: { processId?: string; name?: string }): Promise<any> {
    return this.sendMessage('status', options);
  }

  public async logs(options: { processId?: string; name?: string; lines?: number }): Promise<any> {
    return this.sendMessage('logs', options);
  }

  public async shutdown(): Promise<any> {
    return this.sendMessage('shutdown');
  }

  public disconnect(): void {
    if (this.socket) {
      // Fix BUG-015: Remove all event listeners before disconnecting
      this.socket.removeAllListeners();
      this.socket.end();
      this.socket = null;
    }
    this.connected = false;

    // Clear pending requests
    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error('Client disconnected'));
    });
    this.pendingRequests.clear();
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public setTimeout(connectionTimeout: number, requestTimeout: number): void {
    this.connectionTimeout = Math.max(1000, connectionTimeout);
    this.requestTimeout = Math.max(5000, requestTimeout);
  }
}