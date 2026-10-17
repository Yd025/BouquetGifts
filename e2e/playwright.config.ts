import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', timeout: 240000, expect: { timeout: 8000 }, use: { actionTimeout: 15000, baseURL: process.env.BASE_URL ?? 'http://localhost:3000', viewport: { width: 1280, height: 860 } }, reporter: 'list' });
