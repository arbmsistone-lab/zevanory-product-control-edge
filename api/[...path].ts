import { handler } from '../backend/index.ts';

export default async function portableApi(request: Request) {
  return handler(request);
}
