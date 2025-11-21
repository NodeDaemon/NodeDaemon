import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { MAX_WEBSOCKET_FRAME_SIZE } from '../utils/constants';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WebSocketFrame {
  fin: boolean;
  opcode: number;
  masked: boolean;
  payload: Buffer;
}

export class SimpleWebSocket extends EventEmitter {
  private socket: Duplex;
  private isConnected: boolean = true;

  constructor(socket: Duplex) {
    super();
    this.socket = socket;
    this.socket.on('data', this.handleData.bind(this));
    this.socket.on('close', () => {
      this.isConnected = false;
      this.emit('close');
    });
    this.socket.on('error', (err) => this.emit('error', err));
  }

  private handleData(data: Buffer): void {
    try {
      const frames = this.parseFrames(data);
      for (const frame of frames) {
        this.handleFrame(frame);
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  private parseFrames(buffer: Buffer): WebSocketFrame[] {
    const frames: WebSocketFrame[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      if (buffer.length - offset < 2) break;

      const firstByte = buffer[offset];
      const secondByte = buffer[offset + 1];

      const fin = !!(firstByte & 0x80);
      const opcode = firstByte & 0x0f;
      const masked = !!(secondByte & 0x80);
      let payloadLength = secondByte & 0x7f;

      offset += 2;

      if (payloadLength === 126) {
        if (buffer.length - offset < 2) break;
        payloadLength = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (buffer.length - offset < 8) break;
        // Fix SECURITY-002: Validate 64-bit payload length
        const high32 = buffer.readUInt32BE(offset);
        offset += 4;
        const low32 = buffer.readUInt32BE(offset);
        offset += 4;

        // Reject if high 32 bits are non-zero (payload > 4GB)
        if (high32 !== 0) {
          this.emit('error', new Error('WebSocket frame too large: payload exceeds 4GB'));
          return frames;
        }

        payloadLength = low32;
      }

      // Fix SECURITY-002: Enforce maximum frame size
      if (payloadLength > MAX_WEBSOCKET_FRAME_SIZE) {
        this.emit('error', new Error(`WebSocket frame too large: ${payloadLength} bytes exceeds maximum ${MAX_WEBSOCKET_FRAME_SIZE} bytes`));
        return frames;
      }

      // Fix SECURITY-002: Validate payload length is within safe integer range
      if (!Number.isSafeInteger(payloadLength) || payloadLength < 0) {
        this.emit('error', new Error('Invalid WebSocket frame: payload length out of safe range'));
        return frames;
      }

      let maskKey: Buffer | null = null;
      if (masked) {
        if (buffer.length - offset < 4) break;
        maskKey = buffer.slice(offset, offset + 4);
        offset += 4;
      }

      // Fix SECURITY-002: Prevent integer overflow in offset calculation
      if (offset < 0 || offset + payloadLength < 0) {
        this.emit('error', new Error('Invalid WebSocket frame: integer overflow detected'));
        return frames;
      }

      if (buffer.length - offset < payloadLength) break;

      let payload = buffer.slice(offset, offset + payloadLength);
      offset += payloadLength;

      if (masked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      // Fix SECURITY-002: Reject fragmented frames (fin=false) for now
      // TODO: Implement proper fragmentation support
      if (!fin && opcode !== 0x0) {
        this.emit('error', new Error('Fragmented WebSocket frames are not supported'));
        return frames;
      }

      frames.push({ fin, opcode, masked, payload });
    }

    return frames;
  }

  private handleFrame(frame: WebSocketFrame): void {
    switch (frame.opcode) {
      case 0x1: // Text frame
        this.emit('message', frame.payload.toString('utf8'));
        break;
      case 0x2: // Binary frame
        this.emit('message', frame.payload);
        break;
      case 0x8: // Close frame
        this.close();
        break;
      case 0x9: // Ping frame
        this.pong(frame.payload);
        break;
      case 0xa: // Pong frame
        this.emit('pong', frame.payload);
        break;
    }
  }

  send(data: string | Buffer): void {
    if (!this.isConnected) return;

    const isBuffer = Buffer.isBuffer(data);
    const payload = isBuffer ? data : Buffer.from(data, 'utf8');
    const opcode = isBuffer ? 0x2 : 0x1;

    this.sendFrame(opcode, payload);
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    const payloadLength = payload.length;

    let frame: Buffer;
    if (payloadLength < 126) {
      frame = Buffer.allocUnsafe(2);
      frame[0] = 0x80 | opcode; // FIN = 1
      frame[1] = payloadLength;
    } else if (payloadLength < 65536) {
      frame = Buffer.allocUnsafe(4);
      frame[0] = 0x80 | opcode;
      frame[1] = 126;
      frame.writeUInt16BE(payloadLength, 2);
    } else {
      frame = Buffer.allocUnsafe(10);
      frame[0] = 0x80 | opcode;
      frame[1] = 127;
      frame.writeUInt32BE(0, 2); // High 32 bits
      frame.writeUInt32BE(payloadLength, 6);
    }

    this.socket.write(Buffer.concat([frame, payload]));
  }

  ping(data?: Buffer): void {
    this.sendFrame(0x9, data || Buffer.alloc(0));
  }

  pong(data?: Buffer): void {
    this.sendFrame(0xa, data || Buffer.alloc(0));
  }

  close(): void {
    if (!this.isConnected) return;
    this.isConnected = false;
    this.sendFrame(0x8, Buffer.alloc(0));
    this.socket.end();
  }

  get readyState(): number {
    return this.isConnected ? 1 : 3; // OPEN : CLOSED
  }
}

export class SimpleWebSocketServer extends EventEmitter {
  private clients: Set<SimpleWebSocket> = new Set();

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    const acceptKey = createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      ''
    ].join('\r\n');

    socket.write(responseHeaders);

    const ws = new SimpleWebSocket(socket);
    this.clients.add(ws);

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    this.emit('connection', ws, req);
  }

  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
  }
}