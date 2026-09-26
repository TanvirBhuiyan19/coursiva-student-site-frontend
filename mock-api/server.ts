import { serve } from '@hono/node-server';
import { app } from './app';

const port = Number(process.env.MOCK_API_PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`Mock API (Laravel stand-in) → http://127.0.0.1:${port}`);
});
