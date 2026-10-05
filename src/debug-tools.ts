import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { GdbProtocol } from './gdb-protocol.js';
import { readBitmap } from './bitmap.js';
import { searchMemory } from './memory-search.js';
import { captureSnapshot, postmortem } from './diagnostics.js';

export const debugTools: Tool[] = [
  { name: 'winuae_bitmap', description: 'Decode an indexed planar bitmap to a PNG image. Supply explicit plane addresses (least significant first), row stride and RGB palette. Supports separate or interleaved planes; HAM, EHB and display-mode inference are not supported. Maximum 262144 pixels and 2 MiB read. Leaves execution paused.',
    inputSchema: { type: 'object', properties: {
      width: { type: 'integer', minimum: 1, maximum: 2048 }, height: { type: 'integer', minimum: 1, maximum: 2048 },
      planes: { type: 'array', minItems: 1, maxItems: 8, items: { type: ['integer', 'string'] } },
      row_stride: { type: 'integer', minimum: 1, maximum: 65536, description: 'Bytes between rows of the same plane; defaults to word-aligned row width' },
      palette: { type: 'array', minItems: 2, maxItems: 256, items: { type: ['integer', 'string'] }, description: 'Exactly 2^planes RGB values, e.g. 0xff8800' }
    }, required: ['width', 'height', 'planes', 'palette'] } },
  { name: 'winuae_memory_search', description: 'Search an explicit memory range for exact hex bytes, including overlapping and chunk-boundary matches. Maximum 16 MiB scanned and 4096 results. Leaves the CPU paused. Alignment is relative to absolute addresses; next_address permits continuation after reaching the result limit.',
    inputSchema: { type: 'object', properties: {
      address: { type: ['string', 'integer'] }, length: { type: 'integer', minimum: 1, maximum: 16777216 },
      hex: { type: 'string', description: 'Even-length hexadecimal bytes, at most 4096 bytes' },
      max_matches: { type: 'integer', minimum: 1, maximum: 4096, default: 256 },
      alignment: { type: 'integer', minimum: 1, maximum: 4096, default: 1 }
    }, required: ['address', 'length', 'hex'] } },
  { name: 'winuae_snapshot', description: 'Capture registers, stop reason and up to 256 KiB of explicit memory ranges while stopped. Leaves execution paused. Returns the complete snapshot.',
    inputSchema: { type: 'object', properties: { ranges: { type: 'array', maxItems: 16, items: {
      type: 'object', properties: { address: { type: ['string', 'integer'] }, length: { type: 'integer', minimum: 1, maximum: 262144 } }, required: ['address', 'length']
    } } } } },
  { name: 'winuae_postmortem', description: 'Capture a bounded crash report: fault-time and current registers, instruction disassembly, stack bytes, loaded segments and guest output. Uses fault context only when it matches the current exception stop. Leaves execution paused; optional unavailable data is reported explicitly.',
    inputSchema: { type: 'object', properties: {} } },
];
export async function handleDebugTool(name: string, args: Record<string, unknown>, gdb: GdbProtocol): Promise<CallToolResult> {
  let result: unknown;
  switch (name) {
    case 'winuae_bitmap': {
      const bitmap = await readBitmap(gdb, args);
      return { content: [{ type: 'text', text: JSON.stringify({ width: bitmap.width, height: bitmap.height }) },
        { type: 'image', mimeType: 'image/png', data: bitmap.png.toString('base64') }] };
    }
    case 'winuae_memory_search': result = await searchMemory(gdb, args); break;
    case 'winuae_snapshot': result = await captureSnapshot(gdb, args.ranges); break;
    case 'winuae_postmortem': result = await postmortem(gdb); break;
    default: throw new Error(`Unknown debug tool: ${name}`);
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
