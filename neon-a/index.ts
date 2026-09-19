import { handler } from './core.ts';
export default { fetch: (request: Request) => handler(request) };
