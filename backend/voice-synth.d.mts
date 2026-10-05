import type { IncomingMessage, ServerResponse } from 'node:http';
export function voiceSynthHandler(req: IncomingMessage, res: ServerResponse, opts?: { fetchImpl?: typeof fetch }): Promise<boolean>;
export function pcmToMp3(pcm: Buffer, rate: number, kbps?: number): Buffer;
