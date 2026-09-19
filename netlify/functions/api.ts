import type { Config, Context } from '@netlify/functions';
import { handler } from '../../backend/index';

export default async (request: Request, _context: Context) => handler(request);

export const config: Config = {
  path: '/api/*',
};
