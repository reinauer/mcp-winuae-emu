import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { GdbProtocol } from './gdb-protocol.js';
import { captureSnapshot, postmortem } from './diagnostics.js';

export const debugTools: Tool[] = [
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
    case 'winuae_snapshot': result = await captureSnapshot(gdb, args.ranges); break;
    case 'winuae_postmortem': result = await postmortem(gdb); break;
    default: throw new Error(`Unknown debug tool: ${name}`);
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
