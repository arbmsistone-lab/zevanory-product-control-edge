import type { IncomingMessage, ServerResponse } from 'node:http';
export function voiceEncodeHandler(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
