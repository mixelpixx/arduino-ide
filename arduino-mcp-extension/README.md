# Arduino MCP Extension

MCP (Model Context Protocol) server integration for Arduino IDE 2.x, enabling AI assistants like Claude Code to programmatically interact with the IDE.

Designed with **STEM education** in mind - includes built-in example browsing, hardware reference data, and beginner-friendly error explanations.

## Architecture

The extension uses a **sidecar pattern** to maintain clean stdio communication:

```
+------------------+     stdio      +------------------+      IPC       +------------------+
|   Claude Code    |<-------------->|   MCP Sidecar    |<-------------->|   Arduino IDE    |
|   (AI Client)    |   JSON-RPC     |   (server.ts)    |  Unix Socket   |   (Theia/Node)   |
+------------------+                +------------------+                +------------------+
```

Why a sidecar? Electron pollutes stdout with GPU warnings and other noise, breaking the pure JSON-RPC protocol that MCP requires.

## Key Features

### Complete Arduino Workflow Support

The extension provides 9 tools covering the entire Arduino development workflow:

| Tool | Description |
|------|-------------|
| `arduino_sketch` | Create, open, edit sketches; browse and clone examples |
| `arduino_compile` | Asynchronous compilation with progress tracking |
| `arduino_upload` | Upload firmware to connected boards (destructive operation) |
| `arduino_board` | Board detection, selection, and hardware reference |
| `arduino_serial` | Serial monitor: connect, read, write |
| `arduino_library` | Search, install, and manage Arduino libraries |
| `arduino_context` | Query current IDE state |
| `arduino_task_status` | Monitor async operation progress |
| `arduino_build_output` | Retrieve build results with optional error explanations |

### NEW: STEM Education Enhancements

#### Built-in Example Browser

Access all Arduino built-in examples directly:

```
arduino_sketch action=list_examples
arduino_sketch action=list_examples category=01.Basics
```

Returns categorized examples with descriptions:
- 01.Basics: Blink, DigitalReadSerial, AnalogReadSerial, Fade
- 02.Digital: Button, Debounce, StateChangeDetection
- 03.Analog: AnalogInOutSerial, Calibration, Smoothing
- And more...

#### One-Click Example Projects

Create a new sketch from any example:

```
arduino_sketch action=from_example example_path=<path>
```

Copies the example to your sketch folder, ready for modification.

#### Hardware Reference Data

Query board specifications and pin capabilities:

```
arduino_board action=get_info fqbn=arduino:avr:uno
```

Returns:
```json
{
  "name": "Arduino Uno",
  "fqbn": "arduino:avr:uno",
  "pinInfo": {
    "digitalPins": 14,
    "analogPins": 6,
    "pwmPins": [3, 5, 6, 9, 10, 11],
    "i2cPins": {"sda": 18, "scl": 19},
    "spiPins": {"mosi": 11, "miso": 12, "sck": 13, "ss": 10},
    "ledPin": 13,
    "notes": "PWM pins are marked with ~ on the board. A4/A5 can also be used as analog inputs."
  }
}
```

Supported boards include Arduino Uno, Nano, Mega, Leonardo, and ESP32.

#### Beginner-Friendly Error Messages

Get compilation errors with explanations:

```
arduino_build_output format=explained
```

Transforms cryptic compiler output into understandable messages with suggested fixes.

### IDE Settings Integration

Access via **File > Preferences > Settings**, search for "MCP":

| Setting | Description | Default |
|---------|-------------|---------|
| `arduino.mcp.enabled` | Enable/disable MCP server | `true` |
| `arduino.mcp.autoConnect` | Auto-start on IDE launch | `true` |
| `arduino.mcp.logLevel` | Logging verbosity (none, error, info, debug) | `info` |

## Installation

### Prerequisites

- Node.js 18 or later
- Yarn 4.x
- Git

### Build from Source

```bash
# Clone the repository
git clone https://github.com/mixelpixx/arduino-ide.git
cd arduino-ide

# Install dependencies
yarn install

# Build all packages
yarn build:dev

# Start the IDE
cd electron-app
yarn start
```

### Configure Claude Code

Add the following to your MCP configuration file:

| Platform | Configuration Path |
|----------|-------------------|
| Linux | `~/.claude/claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "arduino": {
      "command": "node",
      "args": ["/path/to/arduino-ide/arduino-mcp-extension/lib/sidecar/server.js"]
    }
  }
}
```

## Usage

### Quick Start

1. Launch Arduino IDE
2. Restart Claude Code (required after configuration changes)
3. Begin interacting with Arduino through natural language

### Example Interactions

**Learning and exploration:**
- "List the basic Arduino examples"
- "Show me information about the Arduino Uno board"
- "What pins support PWM on the Mega?"

**Project development:**
- "Create a new sketch from the Blink example"
- "Read the current sketch content"
- "Compile the sketch and explain any errors"
- "Upload to the board on /dev/ttyUSB0"

**Library management:**
- "Search for WiFi libraries"
- "Install the ArduinoJson library"
- "Show examples from the Servo library"

## Tool Reference

### arduino_sketch

| Action | Parameters | Description |
|--------|------------|-------------|
| `create` | `name` | Create new empty sketch |
| `open` | `path` | Open existing sketch |
| `save` | `path` | Save current sketch |
| `list` | - | List user sketches |
| `get_current` | - | Get currently open sketch info |
| `get_content` | `path` | Read file content |
| `set_content` | `path`, `content` | Write file content |
| `get_files` | - | List files in current sketch |
| `list_examples` | `category` (optional) | **NEW** - List built-in examples |
| `from_example` | `example_path` | **NEW** - Create sketch from example |

### arduino_board

| Action | Parameters | Description |
|--------|------------|-------------|
| `list_connected` | - | List USB-connected boards |
| `list_available` | - | List installed board definitions |
| `get_selected` | - | Get currently selected board |
| `get_info` | `fqbn` | **NEW** - Get board specs and pin reference |
| `select` | `fqbn`, `port` | Select board and port |
| `search` | `query` | Search board registry |
| `install_core` | `core` | Install board support package |

### arduino_compile

| Parameter | Description |
|-----------|-------------|
| `sketch_path` | Path to sketch (defaults to current) |
| `fqbn` | Fully Qualified Board Name |
| `verbose` | Enable verbose output |

Returns a task ID. Use `arduino_task_status` to monitor progress.

### arduino_upload

| Parameter | Description |
|-----------|-------------|
| `sketch_path` | Path to sketch (defaults to current) |
| `fqbn` | Fully Qualified Board Name |
| `port` | Serial port (e.g., /dev/ttyUSB0, COM3) |
| `verify` | Verify after upload |

**Note:** This operation overwrites firmware on the target device.

### arduino_build_output

| Parameter | Description |
|-----------|-------------|
| `type` | What to retrieve: `output`, `errors`, `warnings`, `all` |
| `format` | **NEW** - `raw` or `explained` for beginner-friendly output |

### arduino_serial

| Action | Parameters | Description |
|--------|------------|-------------|
| `list_ports` | - | List available serial ports |
| `connect` | `port`, `baud_rate` | Open connection |
| `disconnect` | - | Close connection |
| `read` | `timeout_ms`, `max_lines` | Read incoming data |
| `write` | `data`, `line_ending` | Send data |

### arduino_library

| Action | Parameters | Description |
|--------|------------|-------------|
| `search` | `query` | Search library registry |
| `install` | `name`, `version` | Install library |
| `remove` | `name` | Uninstall library |
| `list` | - | List installed libraries |
| `get_info` | `name` | Get library details |
| `get_examples` | `name` | List library examples |

### arduino_context

Returns current IDE state including:
- Open sketch information
- Selected board and port
- Connected boards
- Serial monitor status

### arduino_task_status

| Parameter | Description |
|-----------|-------------|
| `task_id` | Task ID from compile or upload operation |

Returns task status: `pending`, `running`, `completed`, `failed`, or `cancelled`.

## Development

### Project Structure

```
arduino-mcp-extension/
├── src/
│   ├── common/
│   │   ├── ipc-protocol.ts      # Cross-platform IPC definitions
│   │   └── mcp-tools.ts         # MCP tool schemas and annotations
│   ├── node/
│   │   ├── arduino-mcp-backend-module.ts  # Inversify DI module
│   │   ├── ipc-server.ts        # IPC server implementation
│   │   ├── mcp-contribution.ts  # Backend lifecycle hooks
│   │   └── sidecar-launcher.ts  # Sidecar process management
│   ├── browser/
│   │   ├── arduino-mcp-frontend-module.ts
│   │   └── mcp-preferences.ts   # Settings UI
│   └── sidecar/
│       └── server.ts            # MCP stdio server
├── lib/                         # Compiled output
├── package.json
└── tsconfig.json
```

### Building

```bash
# Build the MCP extension only
cd arduino-mcp-extension
yarn build

# Build entire IDE with extension
cd ..
yarn build:dev
```

### IPC Protocol

The sidecar communicates with the IDE backend via:
- **Linux/macOS:** Unix domain socket at `/tmp/arduino-mcp-ipc.sock`
- **Windows:** Named pipe at `\\.\pipe\arduino-mcp-ipc`

Message format (newline-delimited JSON):

```json
{"id": "req_1", "method": "sketch/getCurrent", "params": {}}
```

```json
{"id": "req_1", "result": {"name": "Blink", "uri": "file:///home/user/Arduino/Blink"}}
```

### Extending

To add a new tool:

1. Define the tool schema in `src/common/mcp-tools.ts`
2. Implement the IPC handler in `src/node/ipc-server.ts`
3. Add tool routing in `src/sidecar/server.ts`
4. Rebuild and test

## Troubleshooting

### Connection Issues

**"IDE not connected"**

Verify:
- Arduino IDE is running
- MCP is enabled in IDE preferences
- Socket exists: `ls -la /tmp/arduino-mcp-ipc.sock`

**"Service not available"**

Some services initialize asynchronously. Wait a few seconds after IDE startup and retry. Check the IDE console for service status:

```
[arduino-mcp] Services available: { sketches: true, core: true, boards: true, library: true }
```

### Debugging

Enable verbose logging:
1. Open IDE preferences
2. Set `arduino.mcp.logLevel` to `debug`
3. Check IDE console (View > Toggle Developer Tools)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes
4. Verify build: `yarn build`
5. Submit pull request

## License

AGPL-3.0-or-later (consistent with Arduino IDE licensing)

## References

- [This Repository](https://github.com/mixelpixx/arduino-ide)
- [Arduino IDE (upstream)](https://github.com/arduino/arduino-ide)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Eclipse Theia](https://theia-ide.org/)
