import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        editor: 'editor.html',
        terrain: 'terrain.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
