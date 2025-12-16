/**
 * IPC Protocol between MCP Sidecar and Arduino IDE
 *
 * The sidecar (MCP server) communicates with the IDE backend via:
 * - Unix sockets on Linux/macOS
 * - Named pipes on Windows
 *
 * This ensures the stdio channel remains pure JSON-RPC for MCP.
 */

import * as os from 'os';
import * as path from 'path';

/**
 * Get the platform-appropriate socket/pipe path for IPC
 * Windows: Named pipes (\\.\pipe\arduino-mcp-ipc)
 * Unix: Socket file in temp directory
 */
export function getSocketPath(): string {
  if (process.platform === 'win32') {
    // Windows uses named pipes
    return '\\\\.\\pipe\\arduino-mcp-ipc';
  }
  // Unix (Linux, macOS) uses socket files
  return path.join(os.tmpdir(), 'arduino-mcp-ipc.sock');
}

/**
 * IPC Channel identifier
 */
export const IPC_CHANNEL = 'arduino-mcp';

/**
 * Request from sidecar to IDE
 */
export interface IPCRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * Response from IDE to sidecar
 */
export interface IPCResponse {
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Event notification from IDE to sidecar (no response expected)
 */
export interface IPCEvent {
  event: string;
  data: unknown;
}

/**
 * Supported IPC methods
 */
export type IPCMethod =
  // Sketch operations
  | 'sketch/create'
  | 'sketch/open'
  | 'sketch/save'
  | 'sketch/getContent'
  | 'sketch/setContent'
  | 'sketch/list'
  | 'sketch/getCurrent'
  | 'sketch/getFiles'
  // Build operations
  | 'build/compile'
  | 'build/upload'
  | 'build/getOutput'
  | 'build/getErrors'
  // Board operations
  | 'board/listConnected'
  | 'board/select'
  | 'board/getSelected'
  | 'board/search'
  | 'board/installCore'
  // Serial operations
  | 'serial/connect'
  | 'serial/disconnect'
  | 'serial/read'
  | 'serial/write'
  | 'serial/listPorts'
  | 'serial/getConfig'
  | 'serial/setConfig'
  // Library operations
  | 'library/search'
  | 'library/install'
  | 'library/remove'
  | 'library/list'
  | 'library/getInfo'
  // Context operations
  | 'context/getState'
  // MCP 2025 capabilities
  | 'roots/list'
  | 'task/create'
  | 'task/get'
  | 'task/cancel';

/**
 * Progress notification for Tasks capability (MCP 2025 spec)
 */
export interface ProgressNotification {
  taskId: string;
  progress: number;
  total: number;
  message: string;
}

/**
 * Root for workspace security (MCP 2025 spec)
 */
export interface Root {
  uri: string;
  name: string;
  isReadOnly: boolean;
}

/**
 * Task status for async operations
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  status: TaskStatus;
  tool: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  progress?: number;
  progressMessage?: string;
}
