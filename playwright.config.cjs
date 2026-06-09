const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  use: {
    headless: process.env.HEADED !== '1',
    launchOptions: { slowMo: process.env.HEADED === '1' ? 800 : 0 },
    baseURL: 'http://localhost:3001',
  },
});
