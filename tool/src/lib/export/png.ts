import type { Browser } from 'playwright';

/** Renders SVG documents to PNG at 2x device scale with headless Chromium. */
export async function svgToPngs(svgs: string[]): Promise<Buffer[]> {
	const { chromium } = await import('playwright');
	let browser: Browser;
	try {
		browser = await chromium.launch();
	} catch (e) {
		throw new Error(
			`PNG export needs Chromium: run "npx playwright install chromium" (${(e as Error).message.split('\n')[0]})`,
			{ cause: e }
		);
	}
	try {
		const out: Buffer[] = [];
		for (const svg of svgs) {
			const size = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
			const width = Math.ceil(Number(size?.[1] ?? 800));
			const height = Math.ceil(Number(size?.[2] ?? 600));
			const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width, height } });
			await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
			out.push(await page.locator('svg').first().screenshot({ type: 'png' }));
			await page.close();
		}
		return out;
	} finally {
		await browser.close();
	}
}
