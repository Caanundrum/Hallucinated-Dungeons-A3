import { defineConfig } from 'vite';

/**
 * Client build and Rapid Builder Mode dev server.
 *
 * In Rapid Builder Mode the dev server proxies `/api` to the application
 * server so the browser always sees one origin. In Frozen Local Certification
 * Mode there is no dev server: the application server serves the built bundle
 * from `dist/client` on a single origin.
 */
const serverPort = Number(process.env.HD_SERVER_PORT ?? 5174);

export default defineConfig({
  root: 'src/client',
  // Absolute base so hard navigation to /campaigns/:id, /invite/:code, etc.
  // still loads /assets/* from the application origin (Frozen Mode serves the
  // built index.html for every SPA route).
  base: '/',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    proxy: {
      // Anchored on the path segment: a bare `/api` prefix would also capture
      // client module requests such as `/api.ts` and break the dev server.
      '^/api/': {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: false,
      },
      // Legal routes are server-rendered documents, not part of the SPA
      // bundle Vite serves. Proxying them keeps Rapid Builder Mode behaving
      // the same as Frozen Certification Mode, where both are one origin.
      '^/legal/': {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: false,
      },
    },
  },
});
