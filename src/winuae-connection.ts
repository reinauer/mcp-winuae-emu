/** WinUAE process ownership and cross-platform GDB connection management. */

import { spawn, ChildProcess } from 'child_process';
import { GdbProtocol } from './gdb-protocol.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface WinUAEConfig {
  winuaePath: string;
  configFile: string;
  gdbPort: number;
}

export class WinUAEConnection {
  private config: WinUAEConfig;
  private process: ChildProcess | null = null;
  private protocol: GdbProtocol | null = null;
  private isConnected = false;
  private logFilePath: string | null = null;
  private floppies: Map<number, string> = new Map();

  constructor(config: WinUAEConfig) {
    this.config = config;
  }

  /** Launch WinUAE without modifying the user configuration. */
  async connect(): Promise<void> {
    if (this.isConnected) {
      throw new Error('Already connected to WinUAE');
    }

    // WINUAE_PATH accepts an executable, an application bundle, or a directory.
    const configuredPath = path.resolve(this.config.winuaePath);
    const candidates = [configuredPath,
      path.join(configuredPath, process.platform === 'win32' ? 'winuae.exe' : 'winuae'),
      path.join(configuredPath, 'winuae64.exe'),
      path.join(configuredPath, 'Contents', 'MacOS', 'WinUAE'),
      path.join(configuredPath, 'WinUAE.app', 'Contents', 'MacOS', 'WinUAE')];
    const exePath = candidates.find(candidate => {
      try { return fs.statSync(candidate).isFile(); } catch { return false; }
    });
    if (!exePath) throw new Error(`WinUAE executable not found at ${configuredPath}`);
    if (!this.config.configFile || !fs.existsSync(this.config.configFile)) {
      throw new Error('Set WINUAE_CONFIG to an existing .uae configuration');
    }
    if (!Number.isInteger(this.config.gdbPort) || this.config.gdbPort < 1 || this.config.gdbPort > 65535) {
      throw new Error('Invalid WINUAE_GDB_PORT');
    }

    // Create log file
    const logDir = path.join(os.tmpdir(), 'winuae-mcp');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFilePath = path.join(logDir, `winuae-${Date.now()}.log`);
    const logFd = fs.openSync(this.logFilePath, 'w');
    let logOpen = true;
    const closeLog = () => {
      if (logOpen) { logOpen = false; fs.closeSync(logFd); }
    };

    const args = [
      '-f', path.resolve(this.config.configFile),
      '-s', 'use_gui=no',
      '-s', 'debugging_features=gdbserver',
      '-s', `gdb_port=${this.config.gdbPort}`,
    ];

    if (process.platform === 'win32') {
      for (const key of ['active_not_captured_pause', 'inactive_pause', 'iconified_pause']) {
        args.push('-s', `win32.${key}=no`);
      }
    }

    // Inject floppy disk settings as CLI overrides
    for (const [drive, diskPath] of this.floppies) {
      args.push('-s', `floppy${drive}=${diskPath}`);
    }

    console.error(`[WinUAE] Launching ${exePath} ${args.join(' ')}`);
    console.error(`[WinUAE] GDB port: ${this.config.gdbPort}`);
    console.error(`[WinUAE] Log file: ${this.logFilePath}`);

    this.process = spawn(exePath, args, {
      stdio: ['ignore', logFd, logFd],
      detached: false,
      cwd: path.dirname(exePath),
    });

    this.process.on('error', (err) => {
      console.error('[WinUAE] Process error:', err);
      try { closeLog(); } catch {}
    });

    const child = this.process;
    this.process.on('exit', (code) => {
      console.error(`[WinUAE] Process exited with code ${code}`);
      try { closeLog(); } catch {}
      if (this.process === child) { this.process = null; void this.cleanup(); }
    });

    // Wait for GDB server to become available
    try {
      await this.waitForGdb();
    } catch (err) {
      // Close log fd and clean up if GDB connection fails after launch
      try { closeLog(); } catch {}
      await this.cleanup();
      throw err;
    }
  }

  /**
   * Connect to an already-running WinUAE instance (no process spawn)
   */
  async connectExisting(): Promise<void> {
    if (this.isConnected) {
      throw new Error('Already connected to WinUAE');
    }

    console.error(`[WinUAE] Connecting to existing instance on port ${this.config.gdbPort}`);
    await this.waitForGdb();
  }

  /**
   * Try to quickly connect to an existing GDB server (fast, 2 attempts).
   * Returns true if connected, false if no server found.
   */
  private async tryQuickConnect(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.protocol = new GdbProtocol();
        await this.protocol.connect('127.0.0.1', this.config.gdbPort);
        this.isConnected = true;
        console.error('[WinUAE] Connected to existing GDB server');
        return true;
      } catch {
        if (this.protocol) {
          this.protocol.disconnect();
          this.protocol = null;
        }
        if (attempt < 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }
    return false;
  }

  /**
   * Smart connect: try existing GDB server first, then launch WinUAE if needed.
   * Returns a status message describing what happened.
   */
  async connectSmart(): Promise<string> {
    if (this.isConnected && !this.protocol?.connected) await this.cleanup();
    if (this.isConnected) {
      throw new Error('Already connected to WinUAE');
    }

    // Try quick connect to an already-running instance
    if (await this.tryQuickConnect()) {
      return `Connected to existing WinUAE GDB server on port ${this.config.gdbPort}`;
    }

    // No existing server -- launch WinUAE
    console.error('[WinUAE] No existing GDB server found, launching WinUAE...');
    await this.connect();
    return `Launched WinUAE and connected to GDB server on port ${this.config.gdbPort}`;
  }

  /**
   * Wait for GDB server with retry logic
   */
  private async waitForGdb(): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        this.protocol = new GdbProtocol();
        await this.protocol.connect('127.0.0.1', this.config.gdbPort);

        this.isConnected = true;
        console.error('[WinUAE] Connected to GDB server');
        return;
      } catch (err) {
        if (this.protocol) {
          this.protocol.disconnect();
          this.protocol = null;
        }

        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new Error(`Failed to connect to WinUAE GDB server on port ${this.config.gdbPort} after ${maxAttempts} attempts`);
  }

  /**
   * Restart WinUAE with updated configuration (preserves floppy state).
   */
  async restart(): Promise<string> {
    if (this.isConnected && !this.process) {
      throw new Error('Restart requires an instance launched by this MCP server');
    }
    console.error('[WinUAE] Restarting with updated configuration...');
    await this.cleanup();
    await this.connect();
    return `Restarted WinUAE and connected to GDB server on port ${this.config.gdbPort}`;
  }

  /**
   * Disconnect and kill WinUAE
   */
  async disconnect(): Promise<void> {

    await this.cleanup();
    if (this.logFilePath) {
      console.error(`[WinUAE] Log file saved: ${this.logFilePath}`);
    }
    console.error('[WinUAE] Disconnected');
  }

  private async cleanup(): Promise<void> {
    this.isConnected = false;

    if (this.protocol) {
      this.protocol.disconnect();
      this.protocol = null;
    }

    const child = this.process;
    this.process = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGINT');
      });
    }
  }

  /**
   * Get the GDB protocol handler
   */
  getProtocol(): GdbProtocol {
    if (!this.protocol || !this.isConnected) {
      throw new Error('Not connected to WinUAE');
    }
    return this.protocol;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected && !!this.protocol?.connected;
  }

  /**
   * Health check: try reading registers
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isConnected || !this.protocol) {
      return false;
    }
    try {
      await this.protocol.readRegisters();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Set or clear a floppy disk image for a drive (0-3).
   * Takes effect on next connect() or restart().
   */
  setFloppy(drive: number, filePath: string | null): void {
    if (drive < 0 || drive > 3) throw new Error('Drive must be 0-3');
    if (filePath) {
      this.floppies.set(drive, filePath);
    } else {
      this.floppies.set(drive, ''); // Override disks present in the base configuration.
    }
  }

  getFloppies(): Map<number, string> {
    return new Map(this.floppies);
  }
}
