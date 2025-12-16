/**
 * Sidecar Launcher
 *
 * Spawns and manages the MCP sidecar process.
 * The sidecar is a separate Node.js process that handles MCP communication
 * over stdio, keeping it clean of Electron's noise.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { ArduinoIPCServer } from './ipc-server';

@injectable()
export class SidecarLauncher {
  private sidecarProcess: ChildProcess | null = null;

  @inject(ArduinoIPCServer)
  private readonly ipcServer!: ArduinoIPCServer;

  /**
   * Start the MCP sidecar process
   */
  async start(): Promise<void> {
    if (this.sidecarProcess) {
      console.log('[arduino-mcp] Sidecar already running');
      return;
    }

    // First ensure IPC server is running
    await this.ipcServer.start();

    // Path to the sidecar server script
    const sidecarPath = path.join(__dirname, '..', 'sidecar', 'server.js');

    console.log(`[arduino-mcp] Starting sidecar: ${sidecarPath}`);

    this.sidecarProcess = spawn(process.execPath, [sidecarPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ARDUINO_MCP_SIDECAR: '1',
      },
    });

    this.sidecarProcess.stdout?.on('data', (data) => {
      // Forward sidecar stdout - this is the MCP JSON-RPC when connected
      console.log(`[arduino-mcp:sidecar:stdout] ${data.toString().trim()}`);
    });

    this.sidecarProcess.stderr?.on('data', (data) => {
      console.error(`[arduino-mcp:sidecar:stderr] ${data.toString().trim()}`);
    });

    this.sidecarProcess.on('error', (err) => {
      console.error('[arduino-mcp] Sidecar process error:', err);
      this.sidecarProcess = null;
    });

    this.sidecarProcess.on('exit', (code, signal) => {
      console.log(
        `[arduino-mcp] Sidecar exited with code ${code}, signal ${signal}`
      );
      this.sidecarProcess = null;
    });

    console.log('[arduino-mcp] Sidecar started');
  }

  /**
   * Stop the sidecar process
   */
  async stop(): Promise<void> {
    if (this.sidecarProcess) {
      console.log('[arduino-mcp] Stopping sidecar...');
      this.sidecarProcess.kill('SIGTERM');

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.sidecarProcess) {
            this.sidecarProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.sidecarProcess?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.sidecarProcess = null;
    }

    await this.ipcServer.stop();
  }

  /**
   * Get the PID of the sidecar process
   */
  getSidecarPid(): number | undefined {
    return this.sidecarProcess?.pid;
  }

  /**
   * Check if sidecar is running
   */
  isRunning(): boolean {
    return this.sidecarProcess !== null && !this.sidecarProcess.killed;
  }
}
