/**
 * MCP Preferences
 *
 * Defines the MCP-related settings that appear in Arduino IDE preferences.
 */

import {
  PreferenceContribution,
  PreferenceProxy,
  PreferenceSchema,
  PreferenceService,
  createPreferenceProxy,
} from '@theia/core/lib/browser/preferences';
import { nls } from '@theia/core/lib/common/nls';
import { interfaces } from '@theia/core/shared/inversify';

/**
 * MCP Configuration interface
 */
export interface MCPConfiguration {
  'arduino.mcp.enabled': boolean;
  'arduino.mcp.autoConnect': boolean;
  'arduino.mcp.logLevel': 'none' | 'error' | 'info' | 'debug';
}

/**
 * Preference schema for MCP settings
 */
export const mcpPreferenceSchema: PreferenceSchema = {
  type: 'object',
  properties: {
    'arduino.mcp.enabled': {
      type: 'boolean',
      description: nls.localize(
        'arduino/mcp/preferences.enabled',
        'Enable MCP (Model Context Protocol) server integration. When enabled, AI assistants like Claude Code can interact with the IDE programmatically.'
      ),
      default: true,
    },
    'arduino.mcp.autoConnect': {
      type: 'boolean',
      description: nls.localize(
        'arduino/mcp/preferences.autoConnect',
        'Automatically start the MCP server when Arduino IDE launches. When disabled, the MCP server can be started manually.'
      ),
      default: true,
    },
    'arduino.mcp.logLevel': {
      type: 'string',
      enum: ['none', 'error', 'info', 'debug'],
      description: nls.localize(
        'arduino/mcp/preferences.logLevel',
        'Log level for MCP server messages. "none" disables logging, "debug" shows all messages.'
      ),
      default: 'info',
    },
  },
};

export const MCPPreferences = Symbol('MCPPreferences');
export type MCPPreferences = PreferenceProxy<MCPConfiguration>;

/**
 * Create the preference proxy for MCP settings
 */
export function createMCPPreferences(
  preferences: PreferenceService,
  schema: PreferenceSchema = mcpPreferenceSchema
): MCPPreferences {
  return createPreferenceProxy(preferences, schema);
}

/**
 * Bind MCP preferences to the DI container
 */
export function bindMCPPreferences(bind: interfaces.Bind): void {
  bind(MCPPreferences).toDynamicValue((ctx) => {
    const preferences = ctx.container.get<PreferenceService>(PreferenceService);
    const contribution = ctx.container.get<PreferenceContribution>(
      MCPPreferenceContribution
    );
    return createMCPPreferences(preferences, contribution.schema);
  }).inSingletonScope();

  bind(MCPPreferenceContribution).toConstantValue({
    schema: mcpPreferenceSchema,
  });

  bind(PreferenceContribution).toService(MCPPreferenceContribution);
}

export const MCPPreferenceContribution = Symbol('MCPPreferenceContribution');
export interface MCPPreferenceContribution extends PreferenceContribution {}
