import { describe, expect, it } from 'vitest';
import { createNodeElk } from '../../src/lib/layout/elk-node';
import {
	renderedToMermaid,
	renderedToSvg,
	renderView,
	exportBaseName
} from '../../src/lib/export/render';
import { idSanitizer, mermaidFence, toMermaid } from '../../src/lib/export/mermaid';
import { project } from '../../src/lib/projections';
import { escapeXml, toSvgString, el } from '../../src/lib/render/svg';
import { textWidth, truncate, wrapText } from '../../src/lib/render/text';
import { loadFixture, loadStrings } from './helpers';

const elk = createNodeElk();
const { model } = loadFixture();
const VIEWS = [...model.views.keys()].sort();

describe('Mermaid generators', () => {
	for (const id of VIEWS) {
		it(`matches the snapshot for ${id}`, async () => {
			const r = (await renderView(model, id, elk))!;
			await expect(renderedToMermaid(r).text).toMatchFileSnapshot(
				`./__snapshots__/mermaid/${id}.mmd`
			);
		});
	}

	it('sanitises ids and avoids reserved words', () => {
		const id = idSanitizer();
		expect([
			id('order-service'),
			id('end'),
			id('1st'),
			id('order_service'),
			id('order-service')
		]).toEqual(['order_service', 'n_end', 'n_1st', 'order_service_2', 'order_service']);
	});

	it('escapes labels and lists dropped features as warnings', () => {
		const { model } = loadStrings({
			'model/a.model.yaml': [
				'elements:',
				'  - { id: a, kind: system, name: \'Say "hi"\' }',
				'interactions:',
				'  - id: i',
				'    participants: [a, b]',
				'    steps:',
				'      - { from: a, to: b, msg: "C# stuff; more" }',
				'      - group: loop',
				'        label: retry',
				'        steps: [ { from: b, to: a, kind: async } ]',
				'        else: [ { label: never, steps: [] } ]'
			].join('\n'),
			'views/v.view.yaml': 'views:\n  - { id: v, type: component }\n'
		});
		expect(toMermaid(project(model, 'v')!).text).toContain(
			'a["Say #quot;hi#quot;<br/>[Software System]"]'
		);
		const seq = toMermaid(project(model, 'i')!);
		expect(seq.text).toContain('a->>b: C#35; stuff#59; more');
		expect(seq.text).toContain('  loop retry\n    b-)a: \n  end');
		expect(seq.warnings).toEqual([
			'"loop" group cannot have else branches in Mermaid; branch 1 dropped'
		]);
		expect(mermaidFence('x\n')).toBe('```mermaid\nx\n```\n');
	});
});

describe('SVG renderer', () => {
	for (const id of VIEWS) {
		it(`matches the snapshot for ${id}`, async () => {
			const r = (await renderView(model, id, elk))!;
			await expect(renderedToSvg(r, 'light')).toMatchFileSnapshot(`./__snapshots__/svg/${id}.svg`);
		});
	}

	it('produces byte-identical output for an unchanged model', async () => {
		for (const id of VIEWS) {
			const again = loadFixture().model;
			const a = renderedToSvg((await renderView(model, id, elk))!, 'dark');
			const b = renderedToSvg((await renderView(again, id, createNodeElk()))!, 'dark');
			expect(a).toBe(b);
		}
	});

	it('is self-contained and accessible', async () => {
		const svg = renderedToSvg((await renderView(model, 'shop-containers', elk))!, 'light');
		expect(svg).toMatch(
			/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-?\d+ -?\d+ \d+ \d+"/
		);
		expect(svg).toContain('<title id="sdv-title">Web Shop — containers</title>');
		expect(svg).toContain(
			'<desc id="sdv-desc">Component diagram with 8 nodes and 7 connections.</desc>'
		);
		expect(svg).not.toMatch(/foreignObject|var\(--|<image|@import|https?:\/\/(?!www\.w3\.org)/);
		expect(svg).toContain('font-family="system-ui');
	});

	it('uses theme tokens for colours', async () => {
		const r = (await renderView(model, 'system-context', elk))!;
		expect(renderedToSvg(r, 'light')).toContain('fill="#ffffff"');
		expect(renderedToSvg(r, 'dark')).toContain('fill="#0d1117"');
	});

	it('names exports after the view export file or id', () => {
		expect(exportBaseName(model, 'shop-containers')).toBe('shop-containers');
		expect(exportBaseName(model, 'place-order')).toBe('place-order');
	});
});

describe('SVG and text primitives', () => {
	it('serialises deterministically with escaping and rounding', () => {
		expect(toSvgString(el('text', { x: 1.23456, y: -0, fill: 'var(--c)' }, 'a < b & "c"'))).toBe(
			'<text x="1.23" y="0" style="fill:var(--c)">a &lt; b &amp; &quot;c&quot;</text>'
		);
		expect(escapeXml("it's")).toBe('it&#39;s');
	});

	it('measures, wraps and truncates text', () => {
		expect(textWidth('', 12)).toBe(0);
		expect(textWidth('WWW', 12)).toBeGreaterThan(textWidth('iii', 12));
		expect(wrapText('one two three four five', 60, 12)).toEqual(['one two', 'three four', 'five']);
		const two = wrapText('one two three four five', 60, 12, 2);
		expect(two).toHaveLength(2);
		expect(two[1]).toMatch(/^three.*…$/);
		expect(truncate('A very long label indeed', 60, 12)).toMatch(/…$/);
		expect(wrapText('supercalifragilistic', 40, 12).length).toBeGreaterThan(1);
	});
});
