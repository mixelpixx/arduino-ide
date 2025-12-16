/**
 * MCP Tool Definitions for Arduino IDE
 *
 * 2025 MCP Spec Compliance:
 * - Tool Annotations for safety hints (destructiveHint, readOnlyHint, etc.)
 * - Task-enabled tools for async operations
 * - Grouped tools with action parameters to minimize tool count
 */

/**
 * Tool Annotations (2025 Spec)
 * These hints help Claude Code show appropriate warnings to users
 */
export interface ToolAnnotations {
  /** Tool only reads data, doesn't modify anything */
  readOnlyHint?: boolean;
  /** Tool makes destructive/irreversible changes */
  destructiveHint?: boolean;
  /** Tool has side effects outside the IDE */
  sideEffectHint?: boolean;
  /** Requires explicit user confirmation before execution */
  confirmationRequired?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: ToolAnnotations;
}

// ============================================================
// TOOL DEFINITIONS WITH 2025 ANNOTATIONS
// ============================================================

export const ARDUINO_TOOLS: ToolDefinition[] = [
  // ----------------------------------------------------------
  // SKETCH MANAGEMENT
  // ----------------------------------------------------------
  {
    name: 'arduino_sketch',
    description:
      'Manage Arduino sketches - create, open, save, and edit sketch files. Use get_content to read code, set_content to write code. Use list_examples to find built-in examples, from_example to create a sketch from an example.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'create',
            'open',
            'save',
            'list',
            'get_content',
            'set_content',
            'get_files',
            'get_current',
            'list_examples',
            'from_example',
          ],
          description: 'The sketch operation to perform',
        },
        path: {
          type: 'string',
          description:
            'Path to sketch file or directory (for open, save, get_content, set_content)',
        },
        name: {
          type: 'string',
          description: 'Name for new sketch (for create action)',
        },
        content: {
          type: 'string',
          description: 'Sketch content (for set_content action)',
        },
        example_path: {
          type: 'string',
          description: 'Path to example (for from_example). Use list_examples to find available examples.',
        },
        category: {
          type: 'string',
          description: 'Filter examples by category: "01.Basics", "02.Digital", "03.Analog", etc. (for list_examples)',
        },
      },
      required: ['action'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      sideEffectHint: false,
    },
  },

  // ----------------------------------------------------------
  // BUILD OPERATIONS (Task-enabled for async)
  // ----------------------------------------------------------
  {
    name: 'arduino_compile',
    description:
      'Compile the current sketch. Returns immediately with a task ID. Use arduino_task_status to check progress and get results.',
    inputSchema: {
      type: 'object',
      properties: {
        sketch_path: {
          type: 'string',
          description: 'Path to sketch (defaults to current sketch)',
        },
        fqbn: {
          type: 'string',
          description:
            'Fully Qualified Board Name (e.g., arduino:avr:uno). Uses selected board if not specified.',
        },
        verbose: {
          type: 'boolean',
          description: 'Show verbose compilation output (default: false)',
        },
      },
    },
    annotations: {
      readOnlyHint: true, // Doesn't modify hardware or files
      destructiveHint: false,
      sideEffectHint: false,
    },
  },

  {
    name: 'arduino_upload',
    description:
      'Upload compiled sketch to Arduino board. This OVERWRITES firmware on the device. Returns task ID for progress tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        sketch_path: {
          type: 'string',
          description: 'Path to sketch (defaults to current sketch)',
        },
        fqbn: {
          type: 'string',
          description: 'Fully Qualified Board Name. Uses selected board if not specified.',
        },
        port: {
          type: 'string',
          description:
            'Serial port (e.g., /dev/ttyUSB0, COM3). Will prompt if multiple detected.',
        },
        verify: {
          type: 'boolean',
          description: 'Verify upload after completion (default: true)',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true, // Overwrites firmware
      sideEffectHint: true, // Modifies external hardware
      confirmationRequired: true, // Force user approval
    },
  },

  {
    name: 'arduino_build_output',
    description:
      'Get compilation/upload output, errors, and warnings. Use format=explained for beginner-friendly error descriptions with fix suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['output', 'errors', 'warnings', 'all'],
          description: 'What to retrieve (default: all)',
        },
        format: {
          type: 'string',
          enum: ['raw', 'explained'],
          description: 'Output format. "explained" adds beginner-friendly descriptions and fix suggestions (default: raw)',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },

  // ----------------------------------------------------------
  // BOARD MANAGEMENT
  // ----------------------------------------------------------
  {
    name: 'arduino_board',
    description:
      'Manage Arduino boards - list connected devices, select board/port, get board details including pin capabilities. Use get_info for detailed specs like PWM pins, analog pins, memory size.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list_connected',
            'list_available',
            'select',
            'get_selected',
            'get_info',
            'search',
            'install_core',
          ],
          description: 'The board operation to perform',
        },
        fqbn: {
          type: 'string',
          description: 'Fully Qualified Board Name (for select, get_info). Example: arduino:avr:uno',
        },
        port: {
          type: 'string',
          description: 'Serial port to associate with board',
        },
        query: {
          type: 'string',
          description: 'Search query (for search action)',
        },
        core: {
          type: 'string',
          description: 'Core to install (e.g., arduino:avr, esp32:esp32)',
        },
      },
      required: ['action'],
    },
    annotations: {
      readOnlyHint: false, // install_core modifies system
      destructiveHint: false,
    },
  },

  // ----------------------------------------------------------
  // SERIAL MONITOR
  // ----------------------------------------------------------
  {
    name: 'arduino_serial',
    description:
      'Serial monitor operations - connect to board, read output, send data, configure baud rate.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'connect',
            'disconnect',
            'read',
            'write',
            'clear',
            'get_config',
            'set_config',
            'list_ports',
          ],
          description: 'The serial operation to perform',
        },
        port: {
          type: 'string',
          description: 'Serial port (e.g., /dev/ttyUSB0, COM3)',
        },
        baud_rate: {
          type: 'number',
          description: 'Baud rate (default: 9600)',
          enum: [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600],
        },
        data: {
          type: 'string',
          description: 'Data to send (for write action)',
        },
        line_ending: {
          type: 'string',
          enum: ['none', 'newline', 'carriage', 'both'],
          description: 'Line ending for write operations (default: newline)',
        },
        timeout_ms: {
          type: 'number',
          description: 'Read timeout in milliseconds (default: 1000)',
        },
        max_lines: {
          type: 'number',
          description: 'Maximum lines to return for read (default: 100)',
        },
      },
      required: ['action'],
    },
    annotations: {
      readOnlyHint: false, // write sends data to device
      sideEffectHint: true, // Communicates with external hardware
    },
  },

  // ----------------------------------------------------------
  // LIBRARY MANAGEMENT
  // ----------------------------------------------------------
  {
    name: 'arduino_library',
    description:
      'Manage Arduino libraries - search the library registry, install/remove libraries, list installed, get examples.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'install', 'remove', 'list', 'get_info', 'get_examples'],
          description: 'The library operation to perform',
        },
        query: {
          type: 'string',
          description: 'Search query',
        },
        name: {
          type: 'string',
          description: 'Library name (for install, remove, get_info, get_examples)',
        },
        version: {
          type: 'string',
          description: 'Specific version to install (defaults to latest)',
        },
      },
      required: ['action'],
    },
    annotations: {
      readOnlyHint: false,
      sideEffectHint: true, // Downloads from internet
      confirmationRequired: true, // For install action
    },
  },

  // ----------------------------------------------------------
  // CONTEXT & STATE
  // ----------------------------------------------------------
  {
    name: 'arduino_context',
    description:
      'Get current IDE state including open sketch, selected board, connected devices, serial monitor status.',
    inputSchema: {
      type: 'object',
      properties: {
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['sketch', 'board', 'serial', 'libraries', 'all'],
          },
          description: 'What to include in context (default: all)',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },

  // ----------------------------------------------------------
  // TASK STATUS (for async operations)
  // ----------------------------------------------------------
  {
    name: 'arduino_task_status',
    description:
      'Check status of async operations (compile, upload). Returns pending/running/completed/failed status and result.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID returned from arduino_compile or arduino_upload',
        },
      },
      required: ['task_id'],
    },
    annotations: {
      readOnlyHint: true,
    },
  },
];

// ============================================================
// TOOL SAFETY REFERENCE TABLE
// ============================================================
/**
 * Quick reference for tool safety levels:
 *
 * | Tool                 | Read-Only | Destructive | Side Effect | Confirmation |
 * |----------------------|-----------|-------------|-------------|--------------|
 * | arduino_sketch       | No        | No          | No          | No           |
 * | arduino_compile      | Yes       | No          | No          | No           |
 * | arduino_upload       | No        | Yes         | Yes         | Yes          |
 * | arduino_build_output | Yes       | No          | No          | No           |
 * | arduino_board        | No        | No          | No          | No           |
 * | arduino_serial       | No        | No          | Yes         | No           |
 * | arduino_library      | No        | No          | Yes         | Yes          |
 * | arduino_context      | Yes       | No          | No          | No           |
 * | arduino_task_status  | Yes       | No          | No          | No           |
 */
