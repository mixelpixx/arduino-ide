#!/usr/bin/env node
/**
 * Arduino MCP Sidecar Server
 *
 * This process handles the MCP protocol over stdio.
 * It communicates with the Arduino IDE via IPC (Unix socket / Windows named pipe).
 *
 * Why a sidecar? Electron pollutes stdout with GPU warnings and other noise,
 * breaking the pure JSON-RPC protocol that MCP requires.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import * as net from 'net';
import { getSocketPath, IPCRequest, IPCResponse, IPCEvent } from '../common/ipc-protocol';
import { ARDUINO_TOOLS, ToolDefinition } from '../common/mcp-tools';

// ============================================================
// IPC CLIENT - Communicates with IDE backend
// ============================================================

class IPCClient {
  private socket: net.Socket | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private requestCounter = 0;
  private buffer = '';

  async connect(): Promise<void> {
    const socketPath = getSocketPath();

    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(socketPath, () => {
        console.error('[arduino-mcp:sidecar] Connected to IDE backend');
        resolve();
      });

      this.socket.on('error', (err) => {
        console.error('[arduino-mcp:sidecar] IPC error:', err);
        reject(err);
      });

      this.socket.on('data', (data) => {
        this.handleData(data);
      });

      this.socket.on('close', () => {
        console.error('[arduino-mcp:sidecar] IPC connection closed');
        this.socket = null;
      });
    });
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);

        // Check if it's a response or an event
        if ('id' in message) {
          // Response
          const response = message as IPCResponse;
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } else if ('event' in message) {
          // Event notification
          const event = message as IPCEvent;
          this.handleEvent(event);
        }
      } catch (e) {
        console.error('[arduino-mcp:sidecar] Failed to parse IPC message:', line);
      }
    }
  }

  private handleEvent(event: IPCEvent): void {
    console.error(`[arduino-mcp:sidecar] Event: ${event.event}`, event.data);
    // TODO: Forward relevant events to MCP clients (e.g., roots changed)
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.socket) {
      throw new Error('IPC not connected');
    }

    const id = `req_${++this.requestCounter}`;
    const request: IPCRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.socket!.write(JSON.stringify(request) + '\n');

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('IPC request timeout'));
        }
      }, 30000);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

// ============================================================
// MCP SERVER
// ============================================================

async function main(): Promise<void> {
  console.error('[arduino-mcp:sidecar] Starting MCP server...');

  // Create IPC client to communicate with IDE
  const ipcClient = new IPCClient();

  // Try to connect to the IDE backend
  let ipcConnected = false;
  try {
    await ipcClient.connect();
    ipcConnected = true;
    console.error('[arduino-mcp:sidecar] IPC connected');
  } catch (err) {
    console.error('[arduino-mcp:sidecar] Warning: Could not connect to IDE backend');
    console.error('[arduino-mcp:sidecar] Make sure Arduino IDE is running with MCP enabled');
    // Continue anyway - we'll return errors for IDE-dependent operations
  }

  // Create MCP server
  const server = new Server(
    {
      name: 'arduino-mcp-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        // Note: roots capability will be added when SDK supports it
      },
    }
  );

  // Handler: List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error('[arduino-mcp:sidecar] tools/list requested');
    return {
      tools: ARDUINO_TOOLS.map((tool: ToolDefinition): Tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Tool['inputSchema'],
      })),
    };
  });

  // Handler: Execute tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.error(`[arduino-mcp:sidecar] tools/call: ${name}`);

    try {
      const result = await executeArduinoTool(ipcClient, ipcConnected, name, args || {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[arduino-mcp:sidecar] Tool error: ${errorMessage}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: errorMessage }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  // Note: roots/list handler will be added when MCP SDK supports it
  // The IPC protocol is ready to support it (see roots/list in ipc-server.ts)

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.connect(transport);

  console.error('[arduino-mcp:sidecar] MCP server running');

  // Handle shutdown
  process.on('SIGINT', () => {
    console.error('[arduino-mcp:sidecar] Shutting down...');
    ipcClient.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[arduino-mcp:sidecar] Shutting down...');
    ipcClient.disconnect();
    process.exit(0);
  });
}

// ============================================================
// TOOL EXECUTION
// ============================================================

async function executeArduinoTool(
  ipcClient: IPCClient,
  ipcConnected: boolean,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  // Ensure IPC is connected for most operations
  if (!ipcConnected && toolName !== 'arduino_context') {
    throw new Error(
      'Arduino IDE not connected. Please start Arduino IDE with MCP enabled.'
    );
  }

  switch (toolName) {
    // ----------------------------------------------------------
    // SKETCH TOOLS
    // ----------------------------------------------------------
    case 'arduino_sketch': {
      const action = args.action as string;
      switch (action) {
        case 'get_current':
          return ipcClient.request('sketch/getCurrent');
        case 'get_content':
          return ipcClient.request('sketch/getContent', { path: args.path });
        case 'set_content':
          return ipcClient.request('sketch/setContent', {
            path: args.path,
            content: args.content,
          });
        case 'list':
          return ipcClient.request('sketch/list');
        case 'create':
          return ipcClient.request('sketch/create', { name: args.name });
        case 'open':
          return ipcClient.request('sketch/open', { path: args.path });
        case 'save':
          return ipcClient.request('sketch/save', { path: args.path });
        case 'get_files':
          return ipcClient.request('sketch/getFiles', { path: args.path });
        case 'list_examples':
          return ipcClient.request('sketch/listExamples', { category: args.category });
        case 'from_example':
          return ipcClient.request('sketch/fromExample', { example_path: args.example_path });
        default:
          throw new Error(`Unknown sketch action: ${action}`);
      }
    }

    // ----------------------------------------------------------
    // COMPILE TOOL (Task-enabled)
    // ----------------------------------------------------------
    case 'arduino_compile': {
      // Create async task for compilation
      const result = (await ipcClient.request('task/create', {
        tool: 'arduino_compile',
        arguments: {
          sketch_path: args.sketch_path,
          fqbn: args.fqbn,
          verbose: args.verbose,
        },
      })) as { taskId: string };

      return {
        taskId: result.taskId,
        message: 'Compilation started. Use arduino_task_status to check progress.',
      };
    }

    // ----------------------------------------------------------
    // UPLOAD TOOL (Task-enabled, DESTRUCTIVE)
    // ----------------------------------------------------------
    case 'arduino_upload': {
      // Create async task for upload
      const result = (await ipcClient.request('task/create', {
        tool: 'arduino_upload',
        arguments: {
          sketch_path: args.sketch_path,
          fqbn: args.fqbn,
          port: args.port,
          verify: args.verify,
        },
      })) as { taskId: string };

      return {
        taskId: result.taskId,
        message:
          'Upload started. This will OVERWRITE firmware on the device. Use arduino_task_status to check progress.',
      };
    }

    // ----------------------------------------------------------
    // BUILD OUTPUT
    // ----------------------------------------------------------
    case 'arduino_build_output': {
      const type = (args.type as string) || 'all';
      switch (type) {
        case 'output':
        case 'errors':
        case 'warnings':
        case 'all':
          return ipcClient.request('build/getOutput', { type });
        default:
          throw new Error(`Unknown build output type: ${type}`);
      }
    }

    // ----------------------------------------------------------
    // BOARD TOOLS
    // ----------------------------------------------------------
    case 'arduino_board': {
      const action = args.action as string;
      switch (action) {
        case 'list_connected':
          return ipcClient.request('board/listConnected');
        case 'list_available':
          return ipcClient.request('board/listAvailable');
        case 'get_selected':
          return ipcClient.request('board/getSelected');
        case 'get_info':
          return ipcClient.request('board/getInfo', { fqbn: args.fqbn });
        case 'select':
          return ipcClient.request('board/select', {
            fqbn: args.fqbn,
            port: args.port,
          });
        case 'search':
          return ipcClient.request('board/search', { query: args.query });
        case 'install_core':
          return ipcClient.request('board/installCore', { core: args.core });
        default:
          throw new Error(`Unknown board action: ${action}`);
      }
    }

    // ----------------------------------------------------------
    // SERIAL TOOLS
    // ----------------------------------------------------------
    case 'arduino_serial': {
      const action = args.action as string;
      switch (action) {
        case 'connect':
          return ipcClient.request('serial/connect', {
            port: args.port,
            baud_rate: args.baud_rate,
          });
        case 'disconnect':
          return ipcClient.request('serial/disconnect');
        case 'read':
          return ipcClient.request('serial/read', {
            timeout_ms: args.timeout_ms,
            max_lines: args.max_lines,
          });
        case 'write':
          return ipcClient.request('serial/write', {
            data: args.data,
            line_ending: args.line_ending,
          });
        case 'clear':
          return ipcClient.request('serial/clear');
        case 'get_config':
          return ipcClient.request('serial/getConfig');
        case 'set_config':
          return ipcClient.request('serial/setConfig', {
            baud_rate: args.baud_rate,
          });
        case 'list_ports':
          return ipcClient.request('serial/listPorts');
        default:
          throw new Error(`Unknown serial action: ${action}`);
      }
    }

    // ----------------------------------------------------------
    // LIBRARY TOOLS
    // ----------------------------------------------------------
    case 'arduino_library': {
      const action = args.action as string;
      switch (action) {
        case 'search':
          return ipcClient.request('library/search', { query: args.query });
        case 'install':
          return ipcClient.request('library/install', {
            name: args.name,
            version: args.version,
          });
        case 'remove':
          return ipcClient.request('library/remove', { name: args.name });
        case 'list':
          return ipcClient.request('library/list');
        case 'get_info':
          return ipcClient.request('library/getInfo', { name: args.name });
        case 'get_examples':
          return ipcClient.request('library/getExamples', { name: args.name });
        default:
          throw new Error(`Unknown library action: ${action}`);
      }
    }

    // ----------------------------------------------------------
    // CONTEXT TOOL
    // ----------------------------------------------------------
    case 'arduino_context': {
      if (!ipcConnected) {
        // Return minimal context when not connected
        return {
          connected: false,
          message: 'Arduino IDE not connected',
          open_sketch: null,
          selected_board: null,
          connected_boards: [],
          serial_connected: false,
        };
      }
      const include = (args.include as string[]) || ['all'];
      return ipcClient.request('context/getState', { include });
    }

    // ----------------------------------------------------------
    // TASK STATUS
    // ----------------------------------------------------------
    case 'arduino_task_status': {
      const taskId = args.task_id as string;
      if (!taskId) {
        throw new Error('task_id is required');
      }
      return ipcClient.request('task/get', { taskId });
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Run main
main().catch((err) => {
  console.error('[arduino-mcp:sidecar] Fatal error:', err);
  process.exit(1);
});
