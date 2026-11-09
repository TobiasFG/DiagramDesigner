import { defineConfig } from '@playwright/test';

const PORT = 5174;

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	// Tests share one design directory on disk, so they run one at a time.
	workers: 1,
	fullyParallel: false,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		viewport: { width: 1400, height: 900 },
		trace: 'retain-on-failure'
	},
	expect: {
		toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' }
	},
	snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
	webServer: {
		command: `node tests/e2e/prepare.mjs && npx vite dev --port ${PORT} --strictPort`,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		env: { SDV_ROOT: 'tests/e2e/.work/design' },
		timeout: 60_000
	}
});
