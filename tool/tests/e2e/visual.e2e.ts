import { expect, test } from '@playwright/test';
import { openView, resetDesign } from './helpers';

// Pixel snapshots of every fixture view in both themes. Regenerate with
// `npx playwright test visual --update-snapshots` after intentional visual changes.
const VIEWS = [
	'system-context',
	'shop-containers',
	'order-components',
	'order-domain',
	'example-order',
	'checkout-flow',
	'ci-pipeline',
	'place-order',
	'payment'
];

test.beforeAll(() => resetDesign());

for (const theme of ['light', 'dark'] as const) {
	for (const id of VIEWS) {
		test(`${id} (${theme})`, async ({ page }) => {
			await page.addInitScript((t) => localStorage.setItem('sdv-theme', t), theme);
			await openView(page, id);
			await page.waitForTimeout(300);
			const area = id === 'place-order' ? page.getByTestId('sequence') : page.getByTestId('canvas');
			await expect(area).toHaveScreenshot(`${id}-${theme}.png`);
		});
	}
}
