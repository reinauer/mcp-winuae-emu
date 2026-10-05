import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { GdbProtocol } from './gdb-protocol.js';
import { integer } from './debug-validation.js';
import { requireCommand } from './target-info.js';

export const inputTools: Tool[] = [
  { name: 'winuae_input', description: 'Deliver guest input through WinUAE without stopping or resuming execution. Keys are Amiga raw codes, mouse motion is relative hardware counts (-127..127), ports are 0/1. Buttons 0/1/2 are left/right/middle or fire/second/third. Held inputs are released on disconnect/reset. Input recording/playback is unsupported. While paused, the guest cannot consume input; use frame sequences for taps.', inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['key','mouse','button','joystick','release','status'] },
    code: { type: ['integer','string'], description: 'Amiga raw key code, 0..0x67' },
    port: { type: 'integer', minimum: 0, maximum: 1, default: 0 },
    axis: { type: 'string', enum: ['x','y'] }, delta: { type: 'integer', minimum: -127, maximum: 127 },
    button: { type: 'integer', minimum: 0, maximum: 2 },
    direction: { type: 'string', enum: ['left','right','up','down'] },
    pressed: { type: 'boolean' }
  }, required: ['action'] } }
];
export function inputEvent(args: Record<string, unknown>): number[] {
  const port = integer(args.port ?? 0, 'port', 1);
  if (args.action === 'mouse') {
    if (!['x','y'].includes(args.axis as string) || typeof args.delta !== 'number' || !Number.isInteger(args.delta) || Math.abs(args.delta) > 127)
      throw new Error('Mouse requires axis x/y and integer delta -127..127');
    return [1, port, args.axis === 'x' ? 0 : 1, args.delta >>> 0];
  }
  if (typeof args.pressed !== 'boolean') throw new Error('pressed must be boolean');
  const state = args.pressed ? 1 : 0;
  if (args.action === 'key') {
    if (port !== 0) throw new Error('Keyboard does not take a port');
    return [0, 0, integer(args.code, 'code', 0x67), state];
  }
  if (args.action === 'button') return [2, port, 4 + integer(args.button, 'button', 2), state];
  const direction = ['left','right','up','down'].indexOf(args.direction as string);
  if (args.action === 'joystick' && direction >= 0) return [2, port, direction, state];
  throw new Error('Invalid input action or direction');
}
export async function handleInputTool(name: string, args: Record<string, unknown>, gdb?: GdbProtocol): Promise<CallToolResult> {
  if (!gdb?.connected) throw new Error('Not connected to WinUAE');
  if (name !== 'winuae_input') throw new Error('Unknown input tool');
  const command = args.action === 'status' || args.action === 'release' ? `input ${args.action}` :
    `input event ${inputEvent(args).map(n=>n.toString(16)).join(' ')}`;
  await requireCommand(gdb, 'input', true);
  return { content: [{ type: 'text', text: await gdb.sendMonitorCommand(command, true) }] };
}
