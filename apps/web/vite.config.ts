import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // One .env at the repo root. Only VITE_* names reach the browser bundle —
  // the database URL and JWT secrets live in the same file and must not.
  const env = loadEnv(mode, '../../', 'VITE_');

  return {
    plugins: [react(), tailwindcss()],
    envDir: '../../',
    server: {
      port: 5173,
      strictPort: true,
    },
    define: {
      __API_URL__: JSON.stringify(env.VITE_API_URL ?? 'http://localhost:4000'),
    },
    build: {
      sourcemap: true,
    },
  };
});
