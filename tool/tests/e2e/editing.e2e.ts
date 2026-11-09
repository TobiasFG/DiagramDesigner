import { expect, test } from '@playwright/test';
import {
	dragBy,
	idle,
	lineDiff,
	openView,
	readFixture,
	readWork,
	resetDesign,
	workExists,
	writeWork
} from './helpers';

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

test.beforeEach(async ({ page }) => {
	resetDesign();
	// Give the watcher a moment so reset events do not race the page load.
	await page.waitForTimeout(150);
});

test('lists every view and opens each without errors', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	await page.goto('/');
	for (const id of VIEWS) await expect(page.getByTestId(`view-link-${id}`)).toBeVisible();
	for (const id of VIEWS) {
		await openView(page, id);
		if (id === 'place-order') await expect(page.getByTestId('message-0')).toBeVisible();
		else expect(await page.locator('.svelte-flow__node').count()).toBeGreaterThan(1);
	}
	expect(errors).toEqual([]);
});

test('dragging a node pins it in the layout file', async ({ page }) => {
	await openView(page, 'shop-containers');
	expect(workExists('layout/shop-containers.layout.json')).toBe(false);
	await dragBy(page, '[data-testid="node-customer"]', 0, 160);
	await idle(page);
	const layout = JSON.parse(readWork('layout/shop-containers.layout.json'));
	expect(Object.keys(layout.nodes)).toEqual(['customer']);
	const entry = layout.nodes.customer;
	expect(entry.pinned).toBe(true);
	expect(entry.x % 10).toBe(0);
	expect(entry.y % 10).toBe(0);
	// One line per node keeps diffs minimal.
	expect(readWork('layout/shop-containers.layout.json')).toMatch(
		/^ {4}"customer": \{ "x": -?\d+, "y": -?\d+, "pinned": true \}$/m
	);
	await expect(page.locator('[data-testid="node-customer"]')).toHaveAttribute(
		'data-pinned',
		'true'
	);

	await page.getByTestId('reset-layout').click();
	await idle(page);
	expect(workExists('layout/shop-containers.layout.json')).toBe(false);
});

test('renaming an element changes exactly one YAML line; undo and redo write too', async ({
	page
}) => {
	await openView(page, 'shop-containers');
	await page.locator('[data-testid="node-storefront"]').dblclick();
	const input = page.getByTestId('inline-edit');
	await expect(input).toHaveValue('Storefront');
	await input.fill('Web Storefront');
	await input.press('Enter');
	await idle(page);
	const original = readFixture('model/shop.model.yaml');
	expect(lineDiff(original, readWork('model/shop.model.yaml'))).toEqual({
		removed: ['        name: Storefront'],
		added: ['        name: Web Storefront']
	});
	// Comments survive.
	expect(readWork('model/shop.model.yaml')).toContain(
		'description: Card and wallet payments # third party'
	);

	await page.getByTestId('undo').click();
	await idle(page);
	expect(readWork('model/shop.model.yaml')).toBe(original);
	await page.getByTestId('redo').click();
	await idle(page);
	expect(readWork('model/shop.model.yaml')).toContain('        name: Web Storefront');
	await expect(page.locator('[data-testid="node-storefront"]')).toContainText('Web Storefront');
});

test('drawing between handles adds a relationship', async ({ page }) => {
	await openView(page, 'shop-containers');
	const from = page.locator('[data-testid="node-storefront"]');
	const to = page.locator('[data-testid="node-order-db"]');
	await from.hover();
	const handle = (await from.locator('.svelte-flow__handle.bottom').boundingBox())!;
	const targetHandle = (await to.locator('.svelte-flow__handle.left').boundingBox())!;
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(targetHandle.x - 20, targetHandle.y, { steps: 10 });
	// Svelte Flow resolves the handle under the pointer on animation frames.
	await page.waitForTimeout(100);
	await page.mouse.move(
		targetHandle.x + targetHandle.width / 2,
		targetHandle.y + targetHandle.height / 2,
		{ steps: 5 }
	);
	await page.waitForTimeout(100);
	await page.mouse.up();
	await expect
		.poll(() => readWork('model/shop.model.yaml'))
		.toContain('    sync: false\n  - from: storefront\n    to: order-db\n');
	expect(
		lineDiff(readFixture('model/shop.model.yaml'), readWork('model/shop.model.yaml')).removed
	).toEqual([]);
	await expect(page.getByTestId('edge-storefront->order-db#0')).toBeAttached();
});

test('dragging a sequence message reorders the steps', async ({ page }) => {
	await openView(page, 'place-order');
	const second = page.getByTestId('message-1');
	const first = page.getByTestId('message-0');
	const a = (await second.boundingBox())!;
	const b = (await first.boundingBox())!;
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(a.x + a.width / 2, b.y - 4, { steps: 8 });
	await page.mouse.up();
	await idle(page);
	const text = readWork('model/interactions.model.yaml');
	expect(text.indexOf('msg: validate()')).toBeLessThan(text.indexOf('msg: POST /orders'));
	expect(lineDiff(readFixture('model/interactions.model.yaml'), text).removed).toEqual([]);
});

test('an external file edit refreshes the open view', async ({ page }) => {
	await openView(page, 'shop-containers');
	const text = readWork('model/shop.model.yaml').replace('name: Payment Provider', 'name: Stripe');
	const start = Date.now();
	writeWork('model/shop.model.yaml', text);
	await expect(page.locator('[data-testid="node-payments"]')).toContainText('Stripe', {
		timeout: 3000
	});
	const ms = Date.now() - start;
	test.info().annotations.push({ type: 'hot-reload-ms', description: String(ms) });
	expect(ms).toBeLessThan(1500);
});

test('a stale write gets 409, reloads and re-applies the edit', async ({ page, request }) => {
	await openView(page, 'shop-containers');
	// The API rejects a write based on an outdated hash.
	const stale = await request.post('/api/write', {
		data: { changes: [{ path: 'model/shop.model.yaml', baseHash: 'stale', patches: [] }] }
	});
	expect(stale.status()).toBe(409);
	expect((await stale.json()).conflicts[0].path).toBe('model/shop.model.yaml');

	// Hold back change events so the client still has the old hash when it writes.
	await page.evaluate(() => {
		(
			window as unknown as { __sdv: { onExternalChange: () => Promise<void> } }
		).__sdv.onExternalChange = () => Promise.resolve();
	});
	writeWork(
		'model/shop.model.yaml',
		readWork('model/shop.model.yaml').replace('Buys products through the web shop', 'Shops online')
	);
	await page.waitForTimeout(300);
	await page.locator('[data-testid="node-storefront"]').dblclick();
	await page.getByTestId('inline-edit').fill('Shop Front');
	await page.getByTestId('inline-edit').press('Enter');
	await idle(page);
	const final = readWork('model/shop.model.yaml');
	expect(final).toContain('Shops online');
	expect(final).toContain('name: Shop Front');
	await expect(page.getByTestId('notice-info').filter({ hasText: 're-applied' })).toBeVisible();
});

test('deleting an element asks for confirmation and removes its references', async ({ page }) => {
	await openView(page, 'shop-containers');
	await page.locator('[data-testid="node-warehouse"]').click();
	await page.getByTestId('delete-selected').click();
	const dialog = page.getByTestId('confirm-delete');
	await expect(dialog).toContainText('model/shop.model.yaml');
	await expect(dialog).toContainText('views/views.view.yaml');
	await page.getByTestId('confirm-delete-ok').click();
	await idle(page);
	const model = readWork('model/shop.model.yaml');
	expect(model).not.toContain('id: warehouse');
	expect(model).not.toContain('to: warehouse');
	expect(readWork('views/views.view.yaml')).not.toMatch(/include: \[.*warehouse/);
});

test('class members can be edited inline', async ({ page }) => {
	await openView(page, 'order-domain');
	const node = page.locator('[data-testid="node-order-line"]');
	await node.click();
	await node.getByTitle('Add attribute').click();
	const input = page.getByTestId('inline-edit');
	await input.fill('+ discount: Percent');
	await input.press('Enter');
	await idle(page);
	expect(readWork('model/domain.model.yaml')).toContain(
		'      - { name: discount, type: Percent, visibility: "+" }'
	);
});
