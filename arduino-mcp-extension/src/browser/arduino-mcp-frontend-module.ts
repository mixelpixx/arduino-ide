/**
 * Arduino MCP Extension - Frontend Module
 *
 * This module provides:
 * - MCP Enable/Disable setting in preferences
 * - MCP status indicator (future)
 * - MCP connection status widget (future)
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { bindMCPPreferences } from './mcp-preferences';

export default new ContainerModule((bind) => {
  // Bind MCP preferences to add settings to Arduino IDE preferences panel
  bindMCPPreferences(bind);

  console.log('[arduino-mcp] Frontend module loaded with MCP preferences');
});
