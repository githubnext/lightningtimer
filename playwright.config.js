import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'pnpm run build && node build',
    url: 'http://127.0.0.1:4173',
    env: {
      HOST: '127.0.0.1',
      PORT: '4173',
      ORIGIN: 'http://127.0.0.1:4173',
      DATABASE_PATH: `.svelte-kit/browser-test-${process.pid}.sqlite`,
      SHUTDOWN_TIMEOUT: '1'
    },
    reuseExistingServer: false
  }
});
