/**
 * MCP Contribution
 *
 * Manages the MCP server lifecycle based on user preferences.
 * Implements BackendApplicationContribution to hook into IDE startup.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { SidecarLauncher } from './sidecar-launcher';
import { ArduinoIPCServer } from './ipc-server';

@injectable()
export class MCPContribution implements BackendApplicationContribution {
  @inject(SidecarLauncher)
  private readonly sidecarLauncher!: SidecarLauncher;

  @inject(ArduinoIPCServer)
  private readonly ipcServer!: ArduinoIPCServer;

  // MCP is enabled by default - can be changed via preferences
  private mcpEnabled = true;

  async onStart(): Promise<void> {
    console.log('[arduino-mcp] MCP Contribution starting...');

    // Check environment variable / command line flag
    if (process.env.ARDUINO_MCP_DISABLED === '1') {
      console.log('[arduino-mcp] MCP disabled via environment');
      this.mcpEnabled = false;
      return;
    }

    // TODO: Phase 7 - Check user preferences for MCP enable/disable
    // For now, start the IPC server but don't auto-start sidecar
    // The sidecar will be started on-demand when Claude Code connects

    try {
      // Start only the IPC server - it listens for sidecar connections
      await this.ipcServer.start();
      console.log('[arduino-mcp] IPC Server ready for sidecar connections');

      // Don't auto-start sidecar - it will be started externally
      // This allows Claude Code to launch the sidecar directly
    } catch (error) {
      console.error('[arduino-mcp] Failed to start IPC server:', error);
    }
  }

  onStop(): void {
    console.log('[arduino-mcp] MCP Contribution stopping...');
    this.sidecarLauncher.stop().catch((err) => {
      console.error('[arduino-mcp] Error stopping sidecar:', err);
    });
  }

  /**
   * Enable or disable MCP functionality
   */
  setMCPEnabled(enabled: boolean): void {
    if (this.mcpEnabled === enabled) return;

    this.mcpEnabled = enabled;
    if (enabled) {
      this.ipcServer.start().catch(console.error);
    } else {
      this.sidecarLauncher.stop().catch(console.error);
    }
  }

  /**
   * Check if MCP is enabled
   */
  isMCPEnabled(): boolean {
    return this.mcpEnabled;
  }
}
