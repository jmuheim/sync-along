const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  use: {
    headless: true,
    baseURL: 'http://localhost:3001',
  },
});
