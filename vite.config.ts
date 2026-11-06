import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
export default defineConfig({
  plugins: [react(), {
    name: 'market-snapshot',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0];
        if (!path || !/^\/data\/(market|SPY|QQQ|SMH)\.json$/.test(path)) return next();
        try {
          const body = await readFile(new URL(`./public${path}`, import.meta.url));
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-cache');
          response.end(body);
        } catch {
          response.statusCode = 503;
          response.end('Market snapshot unavailable');
        }
      });
    },
  }],
  server: {
    proxy: { '/api/': { target: 'http://127.0.0.1:8081' } },
    watch: { ignored: ['**/public/data/**'] },
  },
});
