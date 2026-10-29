import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_PORT = '24287';

export default defineConfig(() => {
  let apiProcess: ChildProcess | null = null;

  function cleanup() {
    if (apiProcess && apiProcess.exitCode === null) {
      apiProcess.kill('SIGTERM');
    }
    apiProcess = null;
  }

  return {
    plugins: [
      vue(),
      tailwindcss(),
      {
        name: 'serve-api',
        apply: 'serve' as const,
        configureServer(server: {
          httpServer?: { on: (e: string, fn: () => void) => void } | null;
        }) {
          cleanup();
          apiProcess = spawn('node', ['server/index.mjs'], {
            cwd: __dirname,
            stdio: 'inherit',
            env: { ...process.env, PORT: API_PORT },
          });
          apiProcess.on('error', (err) => {
            console.error(`[serve-api] Failed to start API server: ${err.message}`);
          });
          server.httpServer?.on('close', cleanup);
          process.on('SIGINT', cleanup);
          process.on('SIGTERM', cleanup);
        },
      },
    ],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    build: { outDir: 'dist', assetsDir: 'assets' },
    server: {
      host: '127.0.0.1',
      port: 24288,
      proxy: {
        '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
      },
    },
  };
});
