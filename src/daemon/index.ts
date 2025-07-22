#!/usr/bin/env node

/**
 * Standalone daemon launcher for NodeDaemon
 * This file is used when starting the daemon in detached mode
 */

import { NodeDaemonCore } from './NodeDaemonCore';

async function startDaemon(): Promise<void> {
  const daemon = new NodeDaemonCore();
  
  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully');
    daemon.gracefulShutdown('SIGTERM');
  });
  
  process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully');
    daemon.gracefulShutdown('SIGINT');
  });
  
  process.on('SIGHUP', () => {
    console.log('Received SIGHUP, reloading processes');
    // Reload handled by daemon internally
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    daemon.gracefulShutdown('uncaughtException');
  });
  
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    daemon.gracefulShutdown('unhandledRejection');
  });
  
  try {
    console.log('Starting NodeDaemon...');
    await daemon.start();
    console.log('NodeDaemon started successfully');
  } catch (error) {
    console.error('Failed to start NodeDaemon:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startDaemon().catch((error) => {
    console.error('Failed to start daemon:', error);
    process.exit(1);
  });
}