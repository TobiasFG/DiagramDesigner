import { expect, test } from '@playwright/test';
import {
	idle,
	lineDiff,
	openView,
	readFixture,
	readWork,
	resetDesign,
	workExists
} from './helpers';

test.beforeEach(async ({ page }) => {
	resetDesign();
	await page.waitForTimeout(150);
});

test('palette adds an element to the default file, the view include list and the layout', async ({
	page
}) => {
	await openView(page, 'system-context');
	await page.getByTestId('palette-container').click();
	await expect.poll(() => workExists('model/model.model.yaml')).toBe(true);
	await idle(page);
	expect(readWork('model/model.model.yaml')).toBe(
		'elements:\n  - id: new-container\n    kind: container\n    name: New Container\n'
	);
	expect(readWork('views/views.view.yaml')).toContain(
		'include: [customer, shop, payments, warehouse, new-container]'
	);
	expect(
		JSON.parse(readWork('layout/system-context.layout.json')).nodes['new-container'].pinned
	).toBe(true);
	await expect(page.locator('[data-testid="node-new-container"]')).toBeVisible();
});

test('collapsing a group stores it in the layout file and expanding restores it', async ({
	page
}) => {
	await openView(page, 'shop-containers');
	await page.getByTestId('collapse-shop').click();
	await idle(page);
	expect(JSON.parse(readWork('layout/shop-containers.layout.json')).nodes.shop).toEqual({
		collapsed: true
	});
	await expect(page.locator('[data-testid="node-storefront"]')).toHaveCount(0);
	await expect(page.locator('[data-testid="node-shop"]')).toContainText('+4 inside');
	await page.getByTestId('expand-shop').click();
	await idle(page);
	await expect(page.locator('[data-testid="node-storefront"]')).toBeVisible();
});

test('the properties form and the raw YAML tab edit the selected entity', async ({ page }) => {
	await openView(page, 'shop-containers');
	await page.locator('[data-testid="node-payments"]').click();
	const panel = page.getByTestId('properties');
	await expect(panel).toContainText('element · payments');
	await panel.getByLabel('technology').fill('Stripe API');
	await panel.getByLabel('technology').press('Tab');
	await idle(page);
	expect(lineDiff(readFixture('model/shop.model.yaml'), readWork('model/shop.model.yaml'))).toEqual(
		{ removed: [], added: ['    technology: Stripe API'] }
	);

	await panel.getByTestId('tab-yaml').click();
	const yaml = panel.getByTestId('entity-yaml');
	await expect(yaml).toHaveValue(/technology: Stripe API/);
	await yaml.fill((await yaml.inputValue()).replace('Payment Provider', 'Stripe'));
	await panel.getByRole('button', { name: 'Apply' }).click();
	await idle(page);
	expect(readWork('model/shop.model.yaml')).toContain('    name: Stripe\n');
	// Comment on the edited entity survives.
	expect(readWork('model/shop.model.yaml')).toContain(
		'description: Card and wallet payments # third party'
	);
});

test('remove from view edits only the view file', async ({ page }) => {
	await openView(page, 'shop-containers');
	await page.locator('[data-testid="node-order-db"]').click();
	await page.getByTestId('remove-from-view').click();
	await idle(page);
	expect(readWork('views/views.view.yaml')).toContain('exclude: ["tag:internal", order-db]');
	expect(readWork('model/shop.model.yaml')).toBe(readFixture('model/shop.model.yaml'));
	await expect(page.locator('[data-testid="node-order-db"]')).toHaveCount(0);
});

test('dragging between lifelines inserts a message at that row', async ({ page }) => {
	await openView(page, 'place-order');
	const from = (await page.getByTestId('lifeline-customer').boundingBox())!;
	const to = (await page.getByTestId('lifeline-payments').boundingBox())!;
	const firstMsg = (await page.getByTestId('message-0').boundingBox())!;
	const y = firstMsg.y + firstMsg.height + 8;
	await page.mouse.move(from.x + from.width / 2, y);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, y, { steps: 8 });
	await page.mouse.up();
	const input = page.getByTestId('message-edit');
	await input.fill('lookup()');
	await input.press('Enter');
	await idle(page);
	const text = readWork('model/interactions.model.yaml');
	expect(text).toMatch(
		/POST \/orders \}\n\s+- \{ from: customer, to: payments, msg: lookup\(\) \}\n\s+- \{ from: order-service, to: order-service, msg: validate\(\) \}/
	);
	await page.getByTestId('message-1').click();
	await page.getByTestId('message-kind').selectOption('async');
	await idle(page);
	expect(readWork('model/interactions.model.yaml')).toContain(
		'{ from: customer, to: payments, msg: lookup(), kind: async }'
	);
});

test('dragging a job into another stage moves it in the pipeline', async ({ page }) => {
	await openView(page, 'ci-pipeline');
	const job = page.locator('[data-testid="node-lint"]');
	const target = (await page.locator('[data-testid="node-deploy"]').boundingBox())!;
	const box = (await job.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(target.x + target.width / 2, target.y + target.height - 12, { steps: 12 });
	await page.mouse.up();
	await idle(page);
	const text = readWork('model/delivery.model.yaml');
	expect(text).toContain('jobs: [ { id: compile } ]');
	expect(text).toMatch(/- id: deploy[\s\S]*- \{ id: lint \}/);
});
