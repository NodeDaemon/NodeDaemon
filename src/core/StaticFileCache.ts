/**
 * StaticFileCache - LRU cache for static file contents
 *
 * Reduces disk I/O by caching frequently accessed static files in memory.
 * Uses Least Recently Used (LRU) eviction policy to manage memory usage.
 *
 * Features:
 * - Maximum cache size limit (bytes)
 * - Maximum number of cached files
 * - LRU eviction policy
 * - Cache statistics (hits, misses, evictions)
 * - TTL (time-to-live) support
 * - Development mode support (disable cache)
 *
 * Zero-dependency implementation using Map
 */

export interface CacheEntry {
  content: Buffer;
  contentType: string;
  size: number;
  cachedAt: number;
  lastAccessedAt: number;
  accessCount: number;
}

export interface CacheOptions {
  /** Maximum total cache size in bytes (default: 50MB) */
  maxSize?: number;
  /** Maximum number of cached files (default: 100) */
  maxFiles?: number;
  /** Time-to-live in milliseconds (default: 5 minutes) */
  ttl?: number;
  /** Enable cache (default: true, set false for development) */
  enabled?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  currentSize: number;
  currentFiles: number;
  hitRate: number;
}

export class StaticFileCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private maxFiles: number;
  private ttl: number;
  private enabled: boolean;
  private currentSize: number = 0;

  // Statistics
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize || 50 * 1024 * 1024; // 50MB default
    this.maxFiles = options.maxFiles || 100;
    this.ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default
    this.enabled = options.enabled !== false;
  }

  /**
   * Get cached file content
   * Updates access time and count on hit
   */
  public get(path: string): CacheEntry | null {
    if (!this.enabled) {
      return null;
    }

    const entry = this.cache.get(path);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if entry has expired (TTL)
    const now = Date.now();
    if (now - entry.cachedAt > this.ttl) {
      // Entry expired, remove it
      this.remove(path);
      this.misses++;
      return null;
    }

    // Cache hit - update access metadata
    entry.lastAccessedAt = now;
    entry.accessCount++;
    this.hits++;

    // Move to end (most recently used) by re-inserting
    this.cache.delete(path);
    this.cache.set(path, entry);

    return entry;
  }

  /**
   * Set cached file content
   * Evicts least recently used entries if cache is full
   */
  public set(path: string, content: Buffer, contentType: string): void {
    if (!this.enabled) {
      return;
    }

    const size = content.length;
    const now = Date.now();

    // Check if file is too large to cache
    if (size > this.maxSize) {
      return;
    }

    // Remove existing entry if present
    if (this.cache.has(path)) {
      this.remove(path);
    }

    // Evict entries until there's space
    while (
      (this.currentSize + size > this.maxSize || this.cache.size >= this.maxFiles) &&
      this.cache.size > 0
    ) {
      this.evictLRU();
    }

    // Add new entry
    const entry: CacheEntry = {
      content,
      contentType,
      size,
      cachedAt: now,
      lastAccessedAt: now,
      accessCount: 0
    };

    this.cache.set(path, entry);
    this.currentSize += size;
  }

  /**
   * Remove entry from cache
   */
  public remove(path: string): boolean {
    const entry = this.cache.get(path);

    if (!entry) {
      return false;
    }

    this.cache.delete(path);
    this.currentSize -= entry.size;
    return true;
  }

  /**
   * Clear entire cache
   */
  public clear(): void {
    this.cache.clear();
    this.currentSize = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    // Map iteration order is insertion order
    // First entry is least recently used (oldest)
    const firstKey = this.cache.keys().next().value;

    if (firstKey) {
      this.remove(firstKey);
      this.evictions++;
    }
  }

  /**
   * Get cache statistics
   */
  public getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0;

    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      currentSize: this.currentSize,
      currentFiles: this.cache.size,
      hitRate: Math.round(hitRate * 100) / 100 // Round to 2 decimals
    };
  }

  /**
   * Reset statistics
   */
  public resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Enable or disable cache
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  /**
   * Check if cache is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Cleanup expired entries
   * Should be called periodically
   */
  public cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [path, entry] of this.cache.entries()) {
      if (now - entry.cachedAt > this.ttl) {
        this.remove(path);
        cleaned++;
      }
    }

    return cleaned;
  }
}
