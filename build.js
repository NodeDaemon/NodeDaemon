#!/usr/bin/env node

/**
 * Custom build script for NodeDaemon
 * Compiles TypeScript and creates single-file distributions
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIST_DIR = 'dist';
const SRC_DIR = 'src';
const BUILD_DIR = 'build';

class Builder {
  constructor() {
    this.startTime = Date.now();
  }

  log(message, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`, ...args);
  }

  error(message, ...args) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR: ${message}`, ...args);
  }

  success(message, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ ${message}`, ...args);
  }

  async build() {
    try {
      this.log('Starting NodeDaemon build...');

      // Clean previous builds
      await this.clean();

      // Compile TypeScript
      await this.compileTypeScript();

      // Create single file distributions
      await this.createDistributions();

      // Copy additional files
      await this.copyAssets();

      // Set executable permissions
      await this.setPermissions();

      const buildTime = Date.now() - this.startTime;
      this.success(`Build completed in ${buildTime}ms`);

    } catch (error) {
      this.error('Build failed:', error.message);
      process.exit(1);
    }
  }

  async clean() {
    this.log('Cleaning previous builds...');
    
    const dirs = [DIST_DIR, BUILD_DIR];
    
    dirs.forEach(dir => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    dirs.forEach(dir => {
      fs.mkdirSync(dir, { recursive: true });
    });

    this.success('Clean completed');
  }

  async compileTypeScript() {
    this.log('Compiling TypeScript...');

    try {
      execSync('npx tsc', { stdio: 'inherit' });
      this.success('TypeScript compilation completed');
    } catch (error) {
      throw new Error(`TypeScript compilation failed: ${error.message}`);
    }
  }

  async createDistributions() {
    this.log('Creating distributions...');

    // Create CLI distribution
    await this.createCLIDistribution();

    // Create daemon distribution  
    await this.createDaemonDistribution();

    this.success('Distributions created');
  }

  async createCLIDistribution() {
    this.log('Bundling CLI...');

    const cliEntryPoint = path.join(DIST_DIR, 'cli', 'index.js');
    const cliBundle = path.join(BUILD_DIR, 'nodedaemon.js');

    // Simple bundling - inline all requires
    const bundledCode = this.bundleFiles(cliEntryPoint, new Set());
    
    // Add shebang
    const finalCode = `#!/usr/bin/env node\n\n${bundledCode}`;
    
    fs.writeFileSync(cliBundle, finalCode, 'utf8');
    this.success('CLI bundle created');
  }

  async createDaemonDistribution() {
    this.log('Bundling daemon...');

    const daemonEntryPoint = path.join(DIST_DIR, 'daemon', 'index.js');
    const daemonBundle = path.join(BUILD_DIR, 'nodedaemon-daemon.js');

    // Simple bundling - inline all requires
    const bundledCode = this.bundleFiles(daemonEntryPoint, new Set());
    
    // Add shebang
    const finalCode = `#!/usr/bin/env node\n\n${bundledCode}`;
    
    fs.writeFileSync(daemonBundle, finalCode, 'utf8');
    this.success('Daemon bundle created');
  }

  bundleFiles(entryPoint, processed) {
    if (processed.has(entryPoint)) {
      return '';
    }

    processed.add(entryPoint);

    if (!fs.existsSync(entryPoint)) {
      this.error(`File not found: ${entryPoint}`);
      return '';
    }

    let content = fs.readFileSync(entryPoint, 'utf8');
    
    // Remove source map references
    content = content.replace(/\/\/# sourceMappingURL=.*$/gm, '');
    
    // Find require statements for local files
    const requireRegex = /require\(['"](\.[^'"]+)['"]\)/g;
    let match;
    
    while ((match = requireRegex.exec(content)) !== null) {
      const requiredPath = match[1];
      const resolvedPath = this.resolveRequire(path.dirname(entryPoint), requiredPath);
      
      if (resolvedPath && resolvedPath.includes(DIST_DIR)) {
        // This is a local file, inline it
        const inlinedContent = this.bundleFiles(resolvedPath, processed);
        
        // Replace the require with the inlined content wrapped in an IIFE
        const replacement = `(function() {
          const module = { exports: {} };
          const exports = module.exports;
          ${inlinedContent}
          return module.exports;
        })()`;
        
        content = content.replace(match[0], replacement);
      }
    }

    return content;
  }

  resolveRequire(fromDir, requirePath) {
    // Handle relative requires
    if (requirePath.startsWith('./') || requirePath.startsWith('../')) {
      let resolvedPath = path.resolve(fromDir, requirePath);
      
      // Try with .js extension
      if (fs.existsSync(resolvedPath + '.js')) {
        return resolvedPath + '.js';
      }
      
      // Try as directory with index.js
      if (fs.existsSync(path.join(resolvedPath, 'index.js'))) {
        return path.join(resolvedPath, 'index.js');
      }
      
      // Try as-is
      if (fs.existsSync(resolvedPath)) {
        return resolvedPath;
      }
    }
    
    return null;
  }

  async copyAssets() {
    this.log('Copying assets...');

    // Copy package.json for version info
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const slimPackage = {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      bin: packageJson.bin
    };
    
    fs.writeFileSync(
      path.join(BUILD_DIR, 'package.json'),
      JSON.stringify(slimPackage, null, 2),
      'utf8'
    );

    // Copy README
    if (fs.existsSync('README.md')) {
      fs.copyFileSync('README.md', path.join(BUILD_DIR, 'README.md'));
    }

    // Copy LICENSE if exists
    if (fs.existsSync('LICENSE')) {
      fs.copyFileSync('LICENSE', path.join(BUILD_DIR, 'LICENSE'));
    }

    this.success('Assets copied');
  }

  async setPermissions() {
    if (process.platform !== 'win32') {
      this.log('Setting executable permissions...');
      
      const executables = [
        path.join(BUILD_DIR, 'nodedaemon.js'),
        path.join(BUILD_DIR, 'nodedaemon-daemon.js')
      ];

      executables.forEach(file => {
        if (fs.existsSync(file)) {
          fs.chmodSync(file, 0o755);
        }
      });

      this.success('Permissions set');
    }
  }

  async createInstaller() {
    this.log('Creating installer script...');

    const installerScript = `#!/bin/bash
# NodeDaemon Installer

set -e

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

echo "Installing NodeDaemon..."
echo "OS: $OS"
echo "Architecture: $ARCH"

# Create installation directory
INSTALL_DIR="/usr/local/bin"
if [[ "$OS" == "Darwin" ]]; then
    INSTALL_DIR="/usr/local/bin"
elif [[ "$OS" == "Linux" ]]; then
    INSTALL_DIR="/usr/local/bin"
fi

echo "Installation directory: $INSTALL_DIR"

# Check for required permissions
if [[ ! -w "$INSTALL_DIR" ]]; then
    echo "Error: Cannot write to $INSTALL_DIR"
    echo "Please run with sudo or choose a different installation directory"
    exit 1
fi

# Copy binaries
cp nodedaemon.js "$INSTALL_DIR/nodedaemon"
cp nodedaemon-daemon.js "$INSTALL_DIR/nodedaemon-daemon"

# Set permissions
chmod +x "$INSTALL_DIR/nodedaemon"
chmod +x "$INSTALL_DIR/nodedaemon-daemon"

echo "✅ NodeDaemon installed successfully!"
echo "Run 'nodedaemon --help' to get started"
`;

    fs.writeFileSync(path.join(BUILD_DIR, 'install.sh'), installerScript, 'utf8');
    
    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(BUILD_DIR, 'install.sh'), 0o755);
    }

    this.success('Installer created');
  }

  async watch() {
    this.log('Starting watch mode...');
    
    const watcher = fs.watch(SRC_DIR, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.ts')) {
        this.log(`File changed: ${filename}, rebuilding...`);
        this.build().catch(error => {
          this.error('Rebuild failed:', error.message);
        });
      }
    });

    process.on('SIGINT', () => {
      this.log('Stopping watch mode...');
      watcher.close();
      process.exit(0);
    });

    this.success('Watch mode started. Press Ctrl+C to stop.');
  }
}

// CLI interface
async function main() {
  const builder = new Builder();
  const command = process.argv[2];

  switch (command) {
    case 'watch':
      await builder.build();
      await builder.watch();
      break;
    case 'installer':
      await builder.build();
      await builder.createInstaller();
      break;
    default:
      await builder.build();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Build script failed:', error);
    process.exit(1);
  });
}

module.exports = { Builder };