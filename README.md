# mcp-winuae-emu

An [MCP](https://modelcontextprotocol.io/) server that provides Amiga 68k debugging tools through the WinUAE emulator. It connects to [WinUAE](https://github.com/reinauer/WinUAE) via GDB Remote Serial Protocol (RSP), giving AI assistants direct read-write access to the emulated Amiga hardware.

## What it does

This server lets an AI assistant (Claude, etc.) launch WinUAE, connect to its GDB server, and then read/write memory, read/write registers, set breakpoints, single-step through code, disassemble Copper lists, and more -- all through MCP tool calls.

## Quick Start

### 1. Build WinUAE with GDB support

Use a build containing the optional GDB server from
[reinauer/WinUAE](https://github.com/reinauer/WinUAE). Older release binaries
may not include it. The same interface supports Windows, macOS and Linux.
macOS and Linux have been exercised end to end; native Windows validation
is still pending.

Set `WINUAE_PATH` to the executable, its directory, or a macOS `.app` bundle.
Use the normal WinUAE executable name. Set `WINUAE_CONFIG` explicitly to an
existing `.uae` file with a valid Kickstart ROM path.

### 2. Install the MCP server

```bash
git clone https://github.com/reinauer/mcp-winuae-emu.git
cd mcp-winuae-emu
npm ci
npm run build
```

### 3. Add to Claude Code

Add to your MCP settings (`~/.claude/claude_desktop_config.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "winuae-emu": {
      "command": "node",
      "args": ["C:/path/to/mcp-winuae-emu/dist/index.js"],
      "env": {
        "WINUAE_PATH": "C:/apps/winuae",
        "WINUAE_CONFIG": "C:/apps/winuae/Configurations/A500-Dev.uae"
      }
    }
  }
}
```

### 4. Provide a Kickstart ROM and config

You need a valid Amiga Kickstart ROM file (e.g., Kickstart 1.3 for A500) and a WinUAE `.uae` config file. A minimal config:

```ini
cpu_model=68000
chipset=ocs
chipmem_size=1
kickstart_rom_file=C:\path\to\kickstart.rom
```

The server passes your configuration to WinUAE and enables GDB with
command-line overrides. It does not modify the configuration file.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `WINUAE_PATH` | `C:\apps\winuae` | Executable, executable directory, or macOS app bundle |
| `WINUAE_CONFIG` | `<WINUAE_PATH>\Configurations\A500-Dev.uae` | Path to your `.uae` config file |
| `WINUAE_GDB_PORT` | `2345` | GDB server TCP port |
| `WINUAE_DEBUG` | `0` | Set to `1` to enable GDB protocol debug logging |

## Tools

### Connection

| Tool | Description |
|---|---|
| `winuae_connect` | Launch WinUAE and connect to GDB server |
| `winuae_disconnect` | Disconnect; stop only an emulator launched by this server |
| `winuae_status` | Check if connected and responsive |

### Memory

| Tool | Description |
|---|---|
| `winuae_memory_read` | Read memory bytes as hex |
| `winuae_memory_write` | Write hex bytes to memory |
| `winuae_memory_dump` | Hex + ASCII dump (like a hex editor) |
| `winuae_load` | Load a binary file into Amiga memory |

### CPU

| Tool | Description |
|---|---|
| `winuae_registers_get` | Read all m68k registers (D0-D7, A0-A7, SR, PC) |
| `winuae_registers_set` | Write registers (any subset of D0-D7, A0-A7, SR, PC) |
| `winuae_step` | Single-step N instructions |
| `winuae_continue` | Resume execution |
| `winuae_pause` | Pause execution and read registers |
| `winuae_reset` | Restart an owned emulator and read its registers |

### Breakpoints & Watchpoints

| Tool | Description |
|---|---|
| `winuae_breakpoint_set` | Set a software breakpoint at an address |
| `winuae_breakpoint_clear` | Remove a breakpoint |
| `winuae_watchpoint_set` | Break on memory read/write/access |
| `winuae_watchpoint_clear` | Remove a watchpoint |

### Amiga Hardware

| Tool | Description |
|---|---|
| `winuae_custom_registers` | Read and decode all custom chip registers ($DFF000-$DFF1FE) |
| `winuae_copper_disassemble` | Decode a Copper list (WAIT, MOVE, SKIP, END) |
| `winuae_disassemble` | Use WinUAE's m68k disassembler |
| `winuae_screenshot` | Save a PNG screenshot to a native host path |

## How it works

1. **Connect**: Try an existing server on `127.0.0.1:2345`, or the configured port.
2. **Launch**: If needed, launch WinUAE with `-f <config>`, `-s use_gui=no`,
   `-s debugging_features=gdbserver` and `-s gdb_port=<port>`. Windows launch
   overrides also disable focus/minimize pause for the owned process.
3. **Debug**: Use GDB RSP for registers, memory, breakpoints and execution
   control. Guest-state operations pause execution first. Tool calls are
   serialized so their pause/read/write sequences do not overlap.
4. **Shutdown**: Disconnect stops only a process this server launched.
   Restart waits for that child to exit before launching its replacement.
   Closing the MCP input stream also cleans up the owned process.

### Technical notes

- Both `OK` replies and hexadecimal `O` console-output packets are handled.
- Large memory reads and writes are split into bounded requests.
- SR is written before A7 because changing CPU privilege mode switches stacks.
- Custom registers use the emulator's saved snapshot; CIA reads are unsupported.
- Native screenshot paths support spaces and Unicode. Unix PNG output requires
  a WinUAE build with libpng.
- Reset and disk insertion/ejection restart an owned emulator. They cannot
  restart an externally launched instance.
- Release a host UI pause before connecting to an existing instance.
- Explicitly set both path variables on macOS/Linux and when using an
  executable or application-bundle path; defaults retain the Windows layout.

## Credits

- [WinUAE](https://www.winuae.net/) by Toni Wilen -- the Amiga emulator
- [BartmanAbyss WinUAE fork](https://github.com/BartmanAbyss/WinUAE) -- added the GDB server to WinUAE
- [vscode-amiga-debug](https://github.com/BartmanAbyss/vscode-amiga-debug) by BartmanAbyss -- the VSCode extension that pioneered Amiga GDB debugging, and the reference for this work
- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic

## Limitations

- Requires a WinUAE build containing the optional GDB server.
- Binary loading copies bytes into RAM; it does not relocate or execute
  Amiga Hunk files.
- CPU/DMA profiling and the debug overlay are not exposed.
- Memory addresses are physical; ROM writes and arbitrary I/O access fail.
- Watchpoints cover CPU data accesses, not DMA, and follow the emulator's
  documented range and MMU-debugger restrictions.
- The GDB server accepts one local client at a time.

## License

MIT

### AmigaDOS program entry

`winuae_process_breakpoint` sets, inspects or clears a one-shot entry stop.
Select a printable ASCII process/CLI command `name` or a Process `address`,
then continue execution and launch the program in the guest. This uses the
portable WinUAE debug branch and does not change console breakpoints.

`winuae_loaded_segments` returns current or selected AmigaDOS Process metadata
and loaded segment addresses in load order. Relocate a symbol's hunk-relative
offset by adding the corresponding segment address. Sizes describe allocated
payload bounds, including any padding; they are not exact code lengths.
The emulator validates bounded CLI and Workbench lists and rejects corrupt
metadata. It does not load host symbol files into the emulation core.

`winuae_exceptions` replaces the selected exception vectors (`action: set`,
`vectors: [2,3,4,5,6,7,8,10,11]`), disables them (`clear`), or queries the mask
and last captured fault (`status`). Masks are independent of console stops
and clear on disconnect. Execution stops after exception-frame construction;
inspect `last.instruction_pc` and the pre-frame register snapshot for fault
diagnosis, and normal register tools for the current handler-entry state.

`winuae_range_step` uses standard GDB range stepping with inclusive `start`
and exclusive `end`. It starts asynchronously and remains interruptible,
including when the guest loops inside the range. Use pause to inspect the
stop. Equal bounds perform one instruction. The client checks support
before resuming the target.

`winuae_dma_watchpoint` adds a read, write or access watchpoint with named
source groups: blitter, copper, disk, audio, bitplane and sprite. CPU accesses
are excluded. Keep the returned ID for `remove`, or use `list` to inspect
remote DMA entries. Stops include the actual source mask and custom register.
These entries are independent of standard GDB CPU watchpoints and are
removed on disconnect.

`winuae_guest_output` controls and reads guest diagnostics sent through the
existing uaelib function 86. Capture is opt-in, limited to 64 records and
4096 bytes, with individual messages capped at 1024 bytes. Record IDs and
truncation/eviction counters make data loss visible. Reads are nondestructive;
`off` retains records and `clear` preserves the enable setting. Disconnect
and reset disable and clear capture. This does not capture guest console or
serial output, and does not alter the emulator's host logging.
