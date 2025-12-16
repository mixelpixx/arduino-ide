/**
 * Arduino MCP IPC Server
 *
 * Runs inside the Arduino IDE and handles requests from the MCP sidecar.
 * Bridges MCP tool calls to Arduino IDE services via Theia DI.
 */

import { injectable, inject, postConstruct, optional } from '@theia/core/shared/inversify';
import * as net from 'net';
import * as fs from 'fs';
import {
  getSocketPath,
  IPCRequest,
  IPCResponse,
  IPCEvent,
  Task,
  TaskStatus,
} from '../common/ipc-protocol';

// Arduino IDE service symbols - imported from compiled modules at runtime
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SketchesService } = require('arduino-ide-extension/lib/common/protocol/sketches-service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CoreService } = require('arduino-ide-extension/lib/common/protocol/core-service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BoardsService } = require('arduino-ide-extension/lib/common/protocol/boards-service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LibraryService } = require('arduino-ide-extension/lib/common/protocol/library-service');

// Service interfaces typed loosely for flexibility
interface Sketch {
  name: string;
  uri: string;
  mainFileUri: string;
  otherSketchFileUris: string[];
  additionalFileUris: string[];
  rootFolderFileUris: string[];
}

interface SketchRef {
  name: string;
  uri: string;
}

interface SketchContainer {
  label: string;
  children: SketchContainer[];
  sketches: SketchRef[];
}

interface DetectedPort {
  port: {
    address: string;
    protocol: string;
  };
  boards: Array<{
    name: string;
    fqbn?: string;
  }>;
}

type DetectedPorts = Record<string, DetectedPort>;

interface BoardWithPackage {
  name: string;
  fqbn?: string;
  packageName?: string;
}

interface LibraryPackage {
  name: string;
  author: string;
  installedVersion?: string;
  availableVersions: string[];
}

@injectable()
export class ArduinoIPCServer {
  private server: net.Server | null = null;
  private clients: Set<net.Socket> = new Set();
  private isRunning = false;

  // Task management for async operations (MCP 2025 Tasks capability)
  private tasks = new Map<string, Task>();
  private taskCounter = 0;

  // State tracking
  private lastBuildOutput: { stdout: string; stderr: string } | null = null;
  private currentSketch: Sketch | null = null;

  // Inject Arduino IDE services (all optional to handle load order issues)
  @inject(SketchesService) @optional()
  private readonly sketchesService?: any;

  @inject(CoreService) @optional()
  private readonly coreService?: any;

  @inject(BoardsService) @optional()
  private readonly boardsService?: any;

  @inject(LibraryService) @optional()
  private readonly libraryService?: any;

  @postConstruct()
  protected init(): void {
    console.log('[arduino-mcp] IPC Server initialized');
    console.log('[arduino-mcp] Services available:', {
      sketches: !!this.sketchesService,
      core: !!this.coreService,
      boards: !!this.boardsService,
      library: !!this.libraryService,
    });
  }

  /**
   * Helper to check if required services are available
   */
  private requireService(service: any, name: string): void {
    if (!service) {
      throw new Error(`${name} not available - IDE may still be loading`);
    }
  }

  /**
   * Start the IPC server on the platform-appropriate socket/pipe
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[arduino-mcp] IPC Server already running');
      return;
    }

    const socketPath = getSocketPath();

    // Clean up existing socket on Unix
    if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleClientConnection(socket);
      });

      this.server.on('error', (err) => {
        console.error('[arduino-mcp] IPC Server error:', err);
        reject(err);
      });

      this.server.listen(socketPath, () => {
        console.log(`[arduino-mcp] IPC Server listening on ${socketPath}`);
        this.isRunning = true;

        // Set permissions on Unix
        if (process.platform !== 'win32') {
          try {
            fs.chmodSync(socketPath, 0o777);
          } catch (e) {
            console.warn('[arduino-mcp] Could not set socket permissions:', e);
          }
        }

        resolve();
      });
    });
  }

  /**
   * Handle a new client connection
   */
  private handleClientConnection(socket: net.Socket): void {
    console.log('[arduino-mcp] Sidecar connected');
    this.clients.add(socket);

    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        await this.handleMessage(socket, line);
      }
    });

    socket.on('close', () => {
      console.log('[arduino-mcp] Sidecar disconnected');
      this.clients.delete(socket);
    });

    socket.on('error', (err) => {
      console.error('[arduino-mcp] Socket error:', err);
      this.clients.delete(socket);
    });
  }

  /**
   * Handle an incoming IPC message
   */
  private async handleMessage(socket: net.Socket, message: string): Promise<void> {
    let request: IPCRequest;

    try {
      request = JSON.parse(message);
    } catch (e) {
      console.error('[arduino-mcp] Invalid JSON:', message);
      return;
    }

    try {
      const result = await this.routeRequest(request);
      const response: IPCResponse = { id: request.id, result };
      socket.write(JSON.stringify(response) + '\n');
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : 'Unknown error';
      const response: IPCResponse = {
        id: request.id,
        error: { code: -1, message: errMessage },
      };
      socket.write(JSON.stringify(response) + '\n');
    }
  }

  /**
   * Route IPC requests to appropriate handlers
   */
  private async routeRequest(request: IPCRequest): Promise<unknown> {
    const { method, params } = request;
    console.log(`[arduino-mcp] Handling: ${method}`);

    // Route based on method prefix
    if (method.startsWith('context/')) return this.handleContext(method, params);
    if (method.startsWith('roots/')) return this.handleRoots(method, params);
    if (method.startsWith('task/')) return this.handleTask(method, params);
    if (method.startsWith('sketch/')) return this.handleSketch(method, params);
    if (method.startsWith('build/')) return this.handleBuild(method, params);
    if (method.startsWith('board/')) return this.handleBoard(method, params);
    if (method.startsWith('serial/')) return this.handleSerial(method, params);
    if (method.startsWith('library/')) return this.handleLibrary(method, params);

    throw new Error(`Unknown IPC method: ${method}`);
  }

  // ============================================================
  // CONTEXT HANDLERS
  // ============================================================

  private async handleContext(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (method === 'context/getState') {
      // Get connected boards
      let connectedBoards: Array<{ name: string; fqbn?: string; port: string }> = [];
      try {
        const detectedPorts = await this.boardsService.getDetectedPorts();
        connectedBoards = (Object.values(detectedPorts) as any[])
          .filter((dp: any) => dp.boards && dp.boards.length > 0)
          .map((dp: any) => ({
            name: dp.boards![0].name,
            fqbn: dp.boards![0].fqbn,
            port: dp.port.address,
          }));
      } catch (e) {
        console.error('[arduino-mcp] Error getting detected ports:', e);
      }

      return {
        open_sketch: this.currentSketch
          ? {
              name: this.currentSketch.name,
              uri: this.currentSketch.uri,
              mainFileUri: this.currentSketch.mainFileUri,
            }
          : null,
        selected_board: null, // TODO: Get from board manager state
        connected_boards: connectedBoards,
        serial_connected: false, // TODO: Get from monitor service
        mcp_version: '0.1.0',
      };
    }
    throw new Error(`Unknown context method: ${method}`);
  }

  // ============================================================
  // ROOTS HANDLERS (MCP 2025 Spec)
  // ============================================================

  private async handleRoots(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (method === 'roots/list') {
      if (this.currentSketch) {
        return [
          {
            uri: this.currentSketch.uri,
            name: this.currentSketch.name,
            isReadOnly: false,
          },
        ];
      }
      return [];
    }
    throw new Error(`Unknown roots method: ${method}`);
  }

  // ============================================================
  // TASK HANDLERS (MCP 2025 Spec - Async Operations)
  // ============================================================

  private async handleTask(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case 'task/create': {
        const taskId = `task_${++this.taskCounter}_${Date.now()}`;
        const tool = params.tool as string;
        const args = params.arguments as Record<string, unknown>;

        const task: Task = {
          id: taskId,
          status: 'pending',
          tool,
          arguments: args,
        };
        this.tasks.set(taskId, task);

        // Run task asynchronously
        setImmediate(() => this.runTask(taskId));

        return { taskId };
      }

      case 'task/get': {
        const taskId = params.taskId as string;
        const task = this.tasks.get(taskId);
        if (!task) throw new Error(`Task not found: ${taskId}`);
        return {
          status: task.status,
          result: task.result,
          error: task.error,
          progress: task.progress,
          progressMessage: task.progressMessage,
        };
      }

      case 'task/cancel': {
        const taskId = params.taskId as string;
        const task = this.tasks.get(taskId);
        if (task && (task.status === 'pending' || task.status === 'running')) {
          task.status = 'cancelled';
          task.error = 'Cancelled by user';
          return { cancelled: true };
        }
        return { cancelled: false };
      }
    }
    throw new Error(`Unknown task method: ${method}`);
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'running';
    this.emitProgress(taskId, 0, 'Starting...');

    try {
      if (task.tool === 'arduino_compile') {
        await this.runCompileTask(task, taskId);
      } else if (task.tool === 'arduino_upload') {
        await this.runUploadTask(task, taskId);
      } else {
        throw new Error(`Task not supported for tool: ${task.tool}`);
      }
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  private async runCompileTask(task: Task, taskId: string): Promise<void> {
    this.emitProgress(taskId, 10, 'Preparing compilation...');

    if (!this.currentSketch) {
      throw new Error('No sketch is currently open');
    }

    const fqbn = task.arguments.fqbn as string | undefined;
    if (!fqbn) {
      throw new Error('No board selected (fqbn required)');
    }

    this.emitProgress(taskId, 20, 'Compiling...');

    try {
      const result = await this.coreService.compile({
        sketch: this.currentSketch,
        fqbn,
        verbose: (task.arguments.verbose as boolean) || false,
        optimizeForDebug: false,
        sourceOverride: {},
      });

      task.result = {
        success: true,
        buildPath: result?.buildPath,
        executableSectionsSize: result?.executableSectionsSize,
      };
      task.status = 'completed';
      this.emitProgress(taskId, 100, 'Compilation complete');
    } catch (e) {
      throw new Error(`Compilation failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async runUploadTask(task: Task, taskId: string): Promise<void> {
    this.emitProgress(taskId, 10, 'Preparing upload...');

    if (!this.currentSketch) {
      throw new Error('No sketch is currently open');
    }

    const fqbn = task.arguments.fqbn as string | undefined;
    const port = task.arguments.port as string | undefined;

    if (!fqbn) {
      throw new Error('No board selected (fqbn required)');
    }
    if (!port) {
      throw new Error('No port specified');
    }

    this.emitProgress(taskId, 20, 'Compiling...');
    this.emitProgress(taskId, 50, 'Uploading to board...');

    try {
      const result = await this.coreService.upload({
        sketch: this.currentSketch,
        fqbn,
        port: { address: port, protocol: 'serial' },
        verbose: false,
        verify: (task.arguments.verify as boolean) ?? true,
        userFields: [],
      });

      task.result = {
        success: true,
        portAfterUpload: result.portAfterUpload,
      };
      task.status = 'completed';
      this.emitProgress(taskId, 100, 'Upload complete');
    } catch (e) {
      throw new Error(`Upload failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ============================================================
  // SKETCH HANDLERS
  // ============================================================

  private async handleSketch(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case 'sketch/getCurrent':
        return this.currentSketch
          ? {
              name: this.currentSketch.name,
              uri: this.currentSketch.uri,
              mainFileUri: this.currentSketch.mainFileUri,
              otherSketchFileUris: this.currentSketch.otherSketchFileUris,
              additionalFileUris: this.currentSketch.additionalFileUris,
            }
          : null;

      case 'sketch/getContent': {
        const path = params.path as string;
        if (!path) throw new Error('path is required');

        // Convert file:// URI to filesystem path if needed
        const fsPath = path.startsWith('file://')
          ? decodeURIComponent(path.replace('file://', ''))
          : path;

        const content = await fs.promises.readFile(fsPath, 'utf-8');
        return { content, path };
      }

      case 'sketch/setContent': {
        const path = params.path as string;
        const content = params.content as string;
        if (!path) throw new Error('path is required');
        if (content === undefined) throw new Error('content is required');

        const fsPath = path.startsWith('file://')
          ? decodeURIComponent(path.replace('file://', ''))
          : path;

        await fs.promises.writeFile(fsPath, content, 'utf-8');
        return { path, bytesWritten: content.length };
      }

      case 'sketch/list': {
        const container = await this.sketchesService.getSketches({});
        // Flatten the container to get all sketches
        const sketches: Array<{ name: string; uri: string }> = [];
        const collectSketches = (c: typeof container) => {
          sketches.push(...c.sketches.map(s => ({ name: s.name, uri: s.uri })));
          c.children.forEach(collectSketches);
        };
        collectSketches(container);
        return { sketches };
      }

      case 'sketch/create': {
        const sketch = await this.sketchesService.createNewSketch();
        return {
          name: sketch.name,
          uri: sketch.uri,
          mainFileUri: sketch.mainFileUri,
        };
      }

      case 'sketch/open': {
        const path = params.path as string;
        if (!path) throw new Error('path is required');

        const sketch = await this.sketchesService.loadSketch(path);
        this.setCurrentSketch(sketch);
        return {
          name: sketch.name,
          uri: sketch.uri,
          mainFileUri: sketch.mainFileUri,
          otherSketchFileUris: sketch.otherSketchFileUris,
          additionalFileUris: sketch.additionalFileUris,
        };
      }

      case 'sketch/getFiles': {
        if (!this.currentSketch) {
          throw new Error('No sketch is currently open');
        }
        return {
          mainFile: this.currentSketch.mainFileUri,
          otherSketchFiles: this.currentSketch.otherSketchFileUris,
          additionalFiles: this.currentSketch.additionalFileUris,
          rootFolderFiles: this.currentSketch.rootFolderFileUris,
        };
      }

      case 'sketch/save':
        // Save is handled by Theia's file system - files are auto-saved
        return { success: true };

      case 'sketch/listExamples': {
        // List built-in Arduino examples
        const category = params.category as string | undefined;
        const examples = await this.getBuiltInExamples(category);
        return { examples };
      }

      case 'sketch/fromExample': {
        const examplePath = params.example_path as string;
        if (!examplePath) throw new Error('example_path is required');

        // Copy example to a new sketch
        const exampleSketch = await this.sketchesService.loadSketch(examplePath);
        const newSketch = await this.sketchesService.copy(exampleSketch, {
          destinationUri: '', // Will create in default sketch folder
        });
        this.setCurrentSketch(newSketch);
        return {
          name: newSketch.name,
          uri: newSketch.uri,
          mainFileUri: newSketch.mainFileUri,
          message: `Created sketch from example: ${exampleSketch.name}`,
        };
      }
    }
    throw new Error(`Unknown sketch method: ${method}`);
  }

  /**
   * Get built-in Arduino examples
   */
  private async getBuiltInExamples(category?: string): Promise<Array<{
    name: string;
    path: string;
    category: string;
    description?: string;
  }>> {
    // Built-in examples are in the Arduino installation
    const examplesPath = require('path').join(
      __dirname, '..', '..', '..', 'arduino-ide-extension', 'lib', 'node', 'resources', 'Examples'
    );

    const examples: Array<{name: string; path: string; category: string; description?: string}> = [];

    try {
      const categories = await fs.promises.readdir(examplesPath);
      for (const cat of categories) {
        if (category && !cat.includes(category)) continue;

        const catPath = require('path').join(examplesPath, cat);
        const stat = await fs.promises.stat(catPath);
        if (!stat.isDirectory()) continue;

        const items = await fs.promises.readdir(catPath);
        for (const item of items) {
          const itemPath = require('path').join(catPath, item);
          const itemStat = await fs.promises.stat(itemPath);
          if (itemStat.isDirectory()) {
            // Check if it's a valid sketch (has .ino file)
            const files = await fs.promises.readdir(itemPath);
            if (files.some(f => f.endsWith('.ino'))) {
              examples.push({
                name: item,
                path: `file://${itemPath}`,
                category: cat,
                description: this.getExampleDescription(cat, item),
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('[arduino-mcp] Error reading examples:', e);
    }

    return examples;
  }

  /**
   * Get description for common Arduino examples
   */
  private getExampleDescription(category: string, name: string): string | undefined {
    const descriptions: Record<string, string> = {
      'Blink': 'Blink the built-in LED on and off - the "Hello World" of Arduino',
      'DigitalReadSerial': 'Read a digital input and print the state to Serial Monitor',
      'AnalogReadSerial': 'Read an analog sensor and print the value to Serial Monitor',
      'Fade': 'Fade an LED in and out using PWM (analogWrite)',
      'Button': 'Use a pushbutton to control an LED',
      'Debounce': 'Read a pushbutton with debouncing to avoid false triggers',
      'Sweep': 'Control a servo motor, sweeping back and forth',
      'Knob': 'Control a servo motor with a potentiometer',
      'ASCIITable': 'Print the ASCII table to the Serial Monitor',
      'ReadASCIIString': 'Parse integers from a comma-separated serial string',
    };
    return descriptions[name];
  }

  // ============================================================
  // BUILD HANDLERS
  // ============================================================

  private async handleBuild(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case 'build/compile':
        // Direct compile (not task-based) - immediate response
        if (!this.currentSketch) {
          throw new Error('No sketch is currently open');
        }
        const fqbn = params.fqbn as string;
        if (!fqbn) {
          throw new Error('No board selected (fqbn required)');
        }

        const result = await this.coreService.compile({
          sketch: this.currentSketch,
          fqbn,
          verbose: (params.verbose as boolean) || false,
          optimizeForDebug: false,
          sourceOverride: {},
        });

        return {
          success: true,
          buildPath: result?.buildPath,
          executableSectionsSize: result?.executableSectionsSize,
        };

      case 'build/upload':
        throw new Error('Use arduino_upload tool for uploads (task-based)');

      case 'build/getOutput':
        return this.lastBuildOutput || { stdout: '', stderr: '' };

      case 'build/getErrors': {
        if (!this.lastBuildOutput) return { errors: [], warnings: [] };
        const errors: string[] = [];
        const warnings: string[] = [];
        for (const line of this.lastBuildOutput.stderr.split('\n')) {
          if (line.includes('error:')) errors.push(line.trim());
          else if (line.includes('warning:')) warnings.push(line.trim());
        }
        return { errors, warnings };
      }
    }
    throw new Error(`Unknown build method: ${method}`);
  }

  // ============================================================
  // BOARD HANDLERS
  // ============================================================

  private async handleBoard(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case 'board/listConnected': {
        const detectedPorts = await this.boardsService.getDetectedPorts();
        const boards = (Object.values(detectedPorts) as any[])
          .filter((dp: any) => dp.boards && dp.boards.length > 0)
          .map((dp: any) => ({
            name: dp.boards![0].name,
            fqbn: dp.boards![0].fqbn,
            port: {
              address: dp.port.address,
              protocol: dp.port.protocol,
            },
          }));
        return { boards };
      }

      case 'board/listAvailable': {
        const boards = await this.boardsService.getInstalledBoards();
        return {
          boards: boards.map(b => ({
            name: b.name,
            fqbn: b.fqbn,
            packageName: b.packageName,
          })),
        };
      }

      case 'board/getSelected':
        // TODO: Get from board manager state
        return null;

      case 'board/getInfo': {
        const fqbn = params.fqbn as string;
        if (!fqbn) throw new Error('fqbn is required for get_info');

        try {
          const details = await this.boardsService.getBoardDetails({ fqbn });
          // Return board details with pin capabilities for STEM users
          return {
            name: details.name,
            fqbn: details.fqbn,
            package: details.package?.name,
            platform: details.platform?.name,
            // Add common board reference info
            pinInfo: this.getBoardPinInfo(fqbn),
          };
        } catch (e) {
          // If full details not available, return basic pin info
          return {
            fqbn,
            pinInfo: this.getBoardPinInfo(fqbn),
          };
        }
      }

      case 'board/select':
        // TODO: Implement board selection
        throw new Error('board/select not yet implemented');

      case 'board/search': {
        const query = params.query as string;
        const results = await this.boardsService.searchBoards({ query });
        return {
          boards: results.map(b => ({
            name: b.name,
            fqbn: b.fqbn,
            packageName: b.packageName,
          })),
        };
      }

      case 'board/installCore': {
        const core = params.core as string;
        // Need to find the package first
        const searchResults = await this.boardsService.search({ query: core });
        if (searchResults.length === 0) {
          throw new Error(`Core not found: ${core}`);
        }
        await this.boardsService.install({ item: searchResults[0] });
        return { success: true, core };
      }
    }
    throw new Error(`Unknown board method: ${method}`);
  }

  /**
   * Get pin information for common boards - helps STEM users understand hardware capabilities
   */
  private getBoardPinInfo(fqbn: string): {
    digitalPins: number;
    analogPins: number;
    pwmPins: number[];
    i2cPins?: { sda: number; scl: number };
    spiPins?: { mosi: number; miso: number; sck: number; ss: number };
    ledPin?: number;
    notes?: string;
  } | null {
    // Common board pin mappings for STEM education
    const boardPinInfo: Record<string, any> = {
      'arduino:avr:uno': {
        digitalPins: 14,
        analogPins: 6,
        pwmPins: [3, 5, 6, 9, 10, 11],
        i2cPins: { sda: 18, scl: 19 }, // A4, A5
        spiPins: { mosi: 11, miso: 12, sck: 13, ss: 10 },
        ledPin: 13,
        notes: 'PWM pins are marked with ~ on the board. A4/A5 can also be used as analog inputs.',
      },
      'arduino:avr:nano': {
        digitalPins: 14,
        analogPins: 8,
        pwmPins: [3, 5, 6, 9, 10, 11],
        i2cPins: { sda: 18, scl: 19 },
        spiPins: { mosi: 11, miso: 12, sck: 13, ss: 10 },
        ledPin: 13,
        notes: 'Same pinout as Uno but with extra analog pins A6, A7 (input only).',
      },
      'arduino:avr:mega': {
        digitalPins: 54,
        analogPins: 16,
        pwmPins: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46],
        i2cPins: { sda: 20, scl: 21 },
        spiPins: { mosi: 51, miso: 50, sck: 52, ss: 53 },
        ledPin: 13,
        notes: 'Multiple hardware serial ports: Serial1 (19,18), Serial2 (17,16), Serial3 (15,14).',
      },
      'arduino:avr:leonardo': {
        digitalPins: 20,
        analogPins: 12,
        pwmPins: [3, 5, 6, 9, 10, 11, 13],
        i2cPins: { sda: 2, scl: 3 },
        spiPins: { mosi: 16, miso: 14, sck: 15, ss: 17 },
        ledPin: 13,
        notes: 'Can act as USB HID device (keyboard/mouse). Pins 2,3 are also I2C.',
      },
      'esp32:esp32:esp32': {
        digitalPins: 34,
        analogPins: 18,
        pwmPins: [0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
        i2cPins: { sda: 21, scl: 22 },
        spiPins: { mosi: 23, miso: 19, sck: 18, ss: 5 },
        notes: 'WiFi and Bluetooth built-in. All PWM-capable pins support up to 16 channels.',
      },
    };

    return boardPinInfo[fqbn] || null;
  }

  // ============================================================
  // SERIAL HANDLERS
  // ============================================================

  private async handleSerial(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case 'serial/listPorts': {
        const detectedPorts = await this.boardsService.getDetectedPorts();
        const ports = (Object.values(detectedPorts) as any[]).map((dp: any) => ({
          address: dp.port.address,
          protocol: dp.port.protocol,
          boards: dp.boards?.map((b: any) => ({ name: b.name, fqbn: b.fqbn })) || [],
        }));
        return { ports };
      }

      case 'serial/connect':
      case 'serial/disconnect':
      case 'serial/read':
      case 'serial/write':
        // TODO: Implement with MonitorService
        throw new Error(`${method} not yet implemented - requires MonitorService integration`);
    }
    throw new Error(`Unknown serial method: ${method}`);
  }

  // ============================================================
  // LIBRARY HANDLERS
  // ============================================================

  private async handleLibrary(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.libraryService) {
      throw new Error('LibraryService not available');
    }

    switch (method) {
      case 'library/list': {
        const installed = await this.libraryService.list({});
        return {
          libraries: installed.map(lib => ({
            name: lib.name,
            version: lib.installedVersion,
            author: lib.author,
            summary: lib.summary,
          })),
        };
      }

      case 'library/search': {
        const query = params.query as string;
        const results = await this.libraryService.search({ query: query || '' });
        return {
          libraries: results.map(lib => ({
            name: lib.name,
            version: lib.availableVersions?.[0],
            author: lib.author,
            summary: lib.summary,
          })),
        };
      }

      case 'library/install': {
        const name = params.name as string;
        const version = params.version as string | undefined;

        // Search for the library first
        const results = await this.libraryService.search({ query: name });
        const library = results.find(lib => lib.name === name);
        if (!library) {
          throw new Error(`Library not found: ${name}`);
        }

        await this.libraryService.install({
          item: library,
          version: version || library.availableVersions?.[0],
        });
        return { success: true, name, version };
      }

      case 'library/remove': {
        const name = params.name as string;
        const installed = await this.libraryService.list({});
        const library = installed.find(lib => lib.name === name);
        if (!library) {
          throw new Error(`Library not installed: ${name}`);
        }

        await this.libraryService.uninstall({ item: library });
        return { success: true, name };
      }

      case 'library/getInfo': {
        const name = params.name as string;
        const results = await this.libraryService.search({ query: name });
        const library = results.find(lib => lib.name === name);
        if (!library) {
          throw new Error(`Library not found: ${name}`);
        }
        return library;
      }
    }
    throw new Error(`Unknown library method: ${method}`);
  }

  // ============================================================
  // EVENT EMISSION
  // ============================================================

  /**
   * Emit a progress notification to all connected clients
   */
  private emitProgress(taskId: string, progress: number, message: string): void {
    const event: IPCEvent = {
      event: 'task/progress',
      data: { taskId, progress, total: 100, message },
    };
    this.broadcast(event);
  }

  /**
   * Emit a roots changed notification
   */
  emitRootsChanged(): void {
    const event: IPCEvent = { event: 'roots/changed', data: {} };
    this.broadcast(event);
  }

  /**
   * Broadcast an event to all connected clients
   */
  private broadcast(event: IPCEvent): void {
    const message = JSON.stringify(event) + '\n';
    for (const client of this.clients) {
      try {
        client.write(message);
      } catch (e) {
        console.error('[arduino-mcp] Failed to send event:', e);
      }
    }
  }

  // ============================================================
  // PUBLIC METHODS FOR SERVICE INTEGRATION
  // ============================================================

  /**
   * Update the current sketch (called by IDE when sketch changes)
   */
  setCurrentSketch(sketch: Sketch | null): void {
    const changed = this.currentSketch?.uri !== sketch?.uri;
    this.currentSketch = sketch;
    if (changed) {
      this.emitRootsChanged();
    }
  }

  /**
   * Store build output (called after compile/upload)
   */
  setBuildOutput(stdout: string, stderr: string): void {
    this.lastBuildOutput = { stdout, stderr };
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================

  /**
   * Stop the IPC server
   */
  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          const socketPath = getSocketPath();
          if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
          }
          this.isRunning = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Check if server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }
}
