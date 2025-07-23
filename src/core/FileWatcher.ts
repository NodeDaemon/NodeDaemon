import { watch, FSWatcher, statSync, readFileSync } from 'fs';
import { join, resolve, relative } from 'path';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { FileWatchEvent } from '../types';
import { debounce, isDirectory, isFile } from '../utils/helpers';
import { FILE_WATCH_DEBOUNCE, FILE_WATCH_IGNORE } from '../utils/constants';

interface WatchedFile {
  path: string;
  hash: string;
  size: number;
  mtime: number;
}

export class FileWatcher extends EventEmitter {
  private watchers: Map<string, FSWatcher> = new Map();
  private watchedFiles: Map<string, WatchedFile> = new Map();
  private debouncedHandlers: Map<string, Function> = new Map();
  private ignorePatterns: RegExp[] = [];
  private isWatching: boolean = false;

  constructor() {
    super();
    this.setupIgnorePatterns();
  }

  private setupIgnorePatterns(): void {
    this.ignorePatterns = FILE_WATCH_IGNORE.map(pattern => {
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(regexPattern);
    });
  }

  public watch(paths: string | string[], options: {
    ignoreInitial?: boolean;
    recursive?: boolean;
    ignored?: string[];
  } = {}): void {
    // Don't unwatch existing paths, just add new ones
    // This was the bug - it was unwatching all previous paths!

    const pathsArray = Array.isArray(paths) ? paths : [paths];
    const { ignoreInitial = true, recursive = true, ignored = [] } = options;

    if (ignored.length > 0) {
      const additionalPatterns = ignored.map(pattern => {
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        return new RegExp(regexPattern);
      });
      this.ignorePatterns.push(...additionalPatterns);
    }

    pathsArray.forEach(watchPath => {
      this.watchPath(resolve(watchPath), recursive);
    });

    if (!ignoreInitial) {
      this.scanInitialFiles(pathsArray);
    }

    this.isWatching = true;
  }

  private watchPath(path: string, recursive: boolean): void {
    try {
      if (!isDirectory(path) && !isFile(path)) {
        return;
      }

      console.log(`[FileWatcher] Watching path: ${path} (recursive: ${recursive})`);
      
      const watcher = watch(path, { recursive }, (eventType, filename) => {
        if (!filename) return;
        
        const fullPath = resolve(path, filename);
        console.log(`[FileWatcher] Event: ${eventType} on ${fullPath}`);
        this.handleFileEvent(eventType, fullPath);
      });

      watcher.on('error', (error) => {
        this.emit('error', error);
      });

      this.watchers.set(path, watcher);
    } catch (error) {
      this.emit('error', new Error(`Failed to watch path ${path}: ${error}`));
    }
  }

  private handleFileEvent(eventType: string, filePath: string): void {
    if (this.shouldIgnore(filePath)) {
      return;
    }

    const debouncedHandler = this.getDebouncedHandler(filePath);
    debouncedHandler(eventType, filePath);
  }

  private getDebouncedHandler(filePath: string): Function {
    if (!this.debouncedHandlers.has(filePath)) {
      const handler = debounce((eventType: string, path: string) => {
        this.processFileChange(eventType, path);
      }, FILE_WATCH_DEBOUNCE);
      
      this.debouncedHandlers.set(filePath, handler);
    }

    return this.debouncedHandlers.get(filePath)!;
  }

  private processFileChange(eventType: string, filePath: string): void {
    try {
      const existingFile = this.watchedFiles.get(filePath);
      
      if (!isFile(filePath)) {
        if (existingFile) {
          this.watchedFiles.delete(filePath);
          this.emitFileEvent('unlink', filePath);
        }
        return;
      }

      const stats = statSync(filePath);
      const currentHash = this.calculateFileHash(filePath);
      const currentSize = stats.size;
      const currentMtime = stats.mtime.getTime();

      if (!existingFile) {
        this.watchedFiles.set(filePath, {
          path: filePath,
          hash: currentHash,
          size: currentSize,
          mtime: currentMtime
        });
        this.emitFileEvent('add', filePath, stats);
      } else {
        const hasChanged = 
          existingFile.hash !== currentHash ||
          existingFile.size !== currentSize ||
          existingFile.mtime !== currentMtime;

        if (hasChanged) {
          this.watchedFiles.set(filePath, {
            path: filePath,
            hash: currentHash,
            size: currentSize,
            mtime: currentMtime
          });
          this.emitFileEvent('change', filePath, stats);
        }
      }
    } catch (error) {
      this.emit('error', new Error(`Failed to process file change for ${filePath}: ${error}`));
    }
  }

  private calculateFileHash(filePath: string): string {
    try {
      const content = readFileSync(filePath);
      return createHash('md5').update(content).digest('hex');
    } catch (error) {
      return '';
    }
  }

  private shouldIgnore(filePath: string): boolean {
    const relativePath = relative(process.cwd(), filePath);
    return this.ignorePatterns.some(pattern => pattern.test(relativePath));
  }

  private scanInitialFiles(paths: string[]): void {
    paths.forEach(path => {
      this.scanDirectory(resolve(path));
    });
  }

  private scanDirectory(dirPath: string): void {
    try {
      if (!isDirectory(dirPath)) {
        if (isFile(dirPath) && !this.shouldIgnore(dirPath)) {
          this.processFileChange('add', dirPath);
        }
        return;
      }

      const fs = require('fs');
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      
      entries.forEach((entry: any) => {
        const entryPath = join(dirPath, entry.name);
        
        if (this.shouldIgnore(entryPath)) {
          return;
        }

        if (entry.isDirectory()) {
          this.scanDirectory(entryPath);
        } else if (entry.isFile()) {
          this.processFileChange('add', entryPath);
        }
      });
    } catch (error) {
      this.emit('error', new Error(`Failed to scan directory ${dirPath}: ${error}`));
    }
  }

  private emitFileEvent(type: 'add' | 'change' | 'unlink', filePath: string, stats?: any): void {
    const event: FileWatchEvent = {
      type,
      filename: require('path').basename(filePath),
      path: filePath,
      stats
    };

    this.emit('fileChange', event);
    this.emit(type, filePath, stats);
  }

  public unwatch(): void {
    this.watchers.forEach(watcher => {
      try {
        watcher.close();
      } catch (error) {
        this.emit('error', error);
      }
    });

    this.watchers.clear();
    this.watchedFiles.clear();
    this.debouncedHandlers.clear();
    this.isWatching = false;
  }

  public getWatchedFiles(): string[] {
    return Array.from(this.watchedFiles.keys());
  }

  public isFileWatched(filePath: string): boolean {
    return this.watchedFiles.has(resolve(filePath));
  }

  public getFileInfo(filePath: string): WatchedFile | undefined {
    return this.watchedFiles.get(resolve(filePath));
  }

  public addIgnorePattern(pattern: string): void {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    this.ignorePatterns.push(new RegExp(regexPattern));
  }

  public removeIgnorePattern(pattern: string): void {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(regexPattern);
    
    this.ignorePatterns = this.ignorePatterns.filter(existingPattern => 
      existingPattern.source !== regex.source
    );
  }

  public clearIgnorePatterns(): void {
    this.ignorePatterns = [];
    this.setupIgnorePatterns();
  }

  public getIgnorePatterns(): string[] {
    return this.ignorePatterns.map(pattern => pattern.source);
  }

  public pause(): void {
    this.watchers.forEach(watcher => {
      try {
        watcher.close();
      } catch (error) {
        this.emit('error', error);
      }
    });
    this.isWatching = false;
  }

  public resume(): void {
    if (!this.isWatching) {
      const watchedPaths = Array.from(this.watchers.keys());
      this.watchers.clear();
      
      watchedPaths.forEach(path => {
        this.watchPath(path, true);
      });
      
      this.isWatching = true;
    }
  }

  public getStats(): {
    watchedPaths: number;
    watchedFiles: number;
    isWatching: boolean;
    ignorePatterns: number;
  } {
    return {
      watchedPaths: this.watchers.size,
      watchedFiles: this.watchedFiles.size,
      isWatching: this.isWatching,
      ignorePatterns: this.ignorePatterns.length
    };
  }
}