/**
 * Arduino MCP Extension - Backend Module
 *
 * This module registers the MCP server components with Theia's DI container.
 * The actual MCP server runs as a sidecar process, communicating via IPC.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  BackendApplicationContribution,
} from '@theia/core/lib/node/backend-application';
import { ArduinoIPCServer } from './ipc-server';
import { SidecarLauncher } from './sidecar-launcher';
import { MCPContribution } from './mcp-contribution';

export default new ContainerModule((bind) => {
  // Bind IPC Server as a singleton
  bind(ArduinoIPCServer).toSelf().inSingletonScope();

  // Bind Sidecar Launcher
  bind(SidecarLauncher).toSelf().inSingletonScope();

  // Bind the MCP contribution that manages startup
  bind(MCPContribution).toSelf().inSingletonScope();
  bind(BackendApplicationContribution).toService(MCPContribution);

  console.log('[arduino-mcp] Backend module loaded');
});
