import { expect, type Page } from '@playwright/test';
import {
	cpSync,
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORK = fileURLToPath(new URL('./.work/design', import.meta.url));
export const FIXTURE = fileURLToPath(new URL('../../../design', import.meta.url));

function files(dir: string, base = dir): string[] {
	return readdirSync(dir).flatMap((name) => {
		const abs = path.join(dir, name);
		return statSync(abs).isDirectory() ? files(abs, base) : [path.relative(base, abs)];
	});
}

/** Restores the scratch design to the fixture without deleting the watched root. */
export function resetDesign() {
	for (const rel of files(WORK))
		if (!existsSync(path.join(FIXTURE, rel))) rmSync(path.join(WORK, rel));
	for (const rel of files(FIXTURE)) {
		const src = path.join(FIXTURE, rel);
		const dst = path.join(WORK, rel);
		if (!existsSync(dst) || readFileSync(dst, 'utf8') !== readFileSync(src, 'utf8'))
			cpSync(src, dst);
	}
}

export const readWork = (rel: string) => readFileSync(path.join(WORK, rel), 'utf8');
export const readFixture = (rel: string) => readFileSync(path.join(FIXTURE, rel), 'utf8');
export const writeWork = (rel: string, text: string) => writeFileSync(path.join(WORK, rel), text);
export const workExists = (rel: string) => existsSync(path.join(WORK, rel));

/** Waits until the store has no queued reads or writes. */
export async function idle(page: Page) {
	await page.waitForFunction(() => !!(window as unknown as { __sdv?: unknown }).__sdv);
	await page.evaluate(() =>
		(window as unknown as { __sdv: { idle(): Promise<void> } }).__sdv.idle()
	);
}

export async function openView(page: Page, id: string) {
	await page.goto(`/view/${id}`);
	await idle(page);
	const sequence = page.getByTestId('sequence');
	const canvas = page.locator('.svelte-flow__node').first();
	await expect(sequence.or(canvas)).toBeVisible();
	// Let ELK finish and the initial fit settle.
	await page.waitForTimeout(400);
}

/** Lines removed from `a` and added in `b`, counting repeated lines (multiset difference). */
export function lineDiff(a: string, b: string): { removed: string[]; added: string[] } {
	const minus = (x: string[], y: string[]) => {
		const left = [...y];
		return x.filter((l) => {
			const i = left.indexOf(l);
			if (i < 0) return true;
			left.splice(i, 1);
			return false;
		});
	};
	const la = a.split('\n');
	const lb = b.split('\n');
	return { removed: minus(la, lb), added: minus(lb, la) };
}

export async function dragBy(page: Page, selector: string, dx: number, dy: number) {
	const box = (await page.locator(selector).boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + Math.min(20, box.height / 2);
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
	await page.mouse.move(x + dx, y + dy, { steps: 5 });
	await page.mouse.up();
}
