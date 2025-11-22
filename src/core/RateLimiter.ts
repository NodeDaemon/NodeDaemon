/**
 * RateLimiter - Token bucket-based rate limiting for security
 *
 * Tracks request rates per client ID and enforces limits to prevent:
 * - DoS attacks
 * - Resource exhaustion
 * - Brute force attempts
 *
 * Zero-dependency implementation using Map and timestamps
 */

export interface RateLimiterOptions {
  /** Maximum requests allowed in the time window */
  maxRequests: number;
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  windowMs?: number;
  /** Enable cleanup of old entries (default: true) */
  enableCleanup?: boolean;
  /** Cleanup interval in milliseconds (default: 300000 = 5 minutes) */
  cleanupIntervalMs?: number;
}

export interface RateLimitInfo {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in current window */
  remaining: number;
  /** Timestamp when rate limit resets (ms since epoch) */
  resetAt: number;
  /** Current request count in window */
  current: number;
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly enableCleanup: boolean;
  private readonly cleanupIntervalMs: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs || 60000; // Default: 1 minute
    this.enableCleanup = options.enableCleanup !== false;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 300000; // Default: 5 minutes

    if (this.enableCleanup) {
      this.startCleanup();
    }
  }

  /**
   * Check if a request from the given client should be allowed
   *
   * @param clientId - Unique identifier for the client (IP, socket ID, etc)
   * @returns boolean - true if request is allowed, false if rate limit exceeded
   */
  public check(clientId: string): boolean {
    const result = this.checkDetailed(clientId);
    return result.allowed;
  }

  /**
   * Check rate limit with detailed information
   *
   * @param clientId - Unique identifier for the client
   * @returns RateLimitInfo with detailed rate limit status
   */
  public checkDetailed(clientId: string): RateLimitInfo {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get requests for this client
    let clientRequests = this.requests.get(clientId) || [];

    // Remove old requests outside the time window
    clientRequests = clientRequests.filter(time => time > windowStart);

    // Check if limit exceeded
    const allowed = clientRequests.length < this.maxRequests;
    const remaining = Math.max(0, this.maxRequests - clientRequests.length - (allowed ? 1 : 0));
    const resetAt = clientRequests.length > 0
      ? clientRequests[0] + this.windowMs
      : now + this.windowMs;

    if (allowed) {
      // Add current request timestamp
      clientRequests.push(now);
      this.requests.set(clientId, clientRequests);
    }

    return {
      allowed,
      remaining,
      resetAt,
      current: clientRequests.length + (allowed ? 1 : 0)
    };
  }

  /**
   * Reset rate limit for a specific client
   *
   * @param clientId - Client ID to reset
   */
  public reset(clientId: string): void {
    this.requests.delete(clientId);
  }

  /**
   * Reset all rate limits
   */
  public resetAll(): void {
    this.requests.clear();
  }

  /**
   * Get current request count for a client
   *
   * @param clientId - Client ID to check
   * @returns number of requests in current window
   */
  public getCount(clientId: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const clientRequests = this.requests.get(clientId) || [];
    return clientRequests.filter(time => time > windowStart).length;
  }

  /**
   * Start periodic cleanup of old entries
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);

    // Don't keep process alive for cleanup timer
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Clean up old entries that are outside any time window
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [clientId, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(time => time > windowStart);

      if (validTimestamps.length === 0) {
        // No valid timestamps, remove entry
        this.requests.delete(clientId);
      } else if (validTimestamps.length < timestamps.length) {
        // Some timestamps were removed, update entry
        this.requests.set(clientId, validTimestamps);
      }
    }
  }

  /**
   * Stop cleanup timer and clean up resources
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.requests.clear();
  }

  /**
   * Get statistics about the rate limiter
   */
  public getStats(): {
    totalClients: number;
    totalRequests: number;
    windowMs: number;
    maxRequests: number;
  } {
    let totalRequests = 0;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const timestamps of this.requests.values()) {
      totalRequests += timestamps.filter(time => time > windowStart).length;
    }

    return {
      totalClients: this.requests.size,
      totalRequests,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests
    };
  }
}
