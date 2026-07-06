import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  base: '/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 5333,
    proxy: {
      '/api': 'http://localhost:5332',
      '/dl': 'http://localhost:5332',
      '/preview': 'http://localhost:5332'
    }
  }
});
