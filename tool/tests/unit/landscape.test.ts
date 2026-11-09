import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contextFor } from '../../src/lib/landscape/context';
import { loadStrings } from './helpers';

const { model } = loadStrings({
	'model/landscape.model.yaml': readFileSync(
		new URL('../../../examples/three-systems/model/landscape.model.yaml', import.meta.url),
		'utf8'
	)
});
const visible = (...ids: string[]) => new Set(['shop', 'crm', 'erp', ...ids]);
const pairs = (focus: string | undefined, vis: Set<string>) =>
	contextFor(model, focus, vis)
		.edges.map((e) => `${e.source}->${e.target}`)
		.sort();

describe('landscape context', () => {
	it('rolls everything up to systems without a focus', () => {
		expect(pairs(undefined, visible())).toEqual(['erp->crm', 'shop->crm', 'shop->erp']);
	});

	it('shows the specific APIs a focused consumer calls', () => {
		const vis = visible('shop-web', 'shop-db', 'crm-api', 'crm-db', 'erp-api', 'erp-db');
		expect(pairs('shop', vis)).toEqual([
			'shop-web->customer-api',
			'shop-web->loyalty-api',
			'shop-web->order-api',
			'shop-web->shop-db',
			'shop-web->stock-api'
		]);
	});

	it('stops consumers of a focused provider at their system', () => {
		const vis = visible('crm-api', 'crm-db', 'customer-api', 'loyalty-api');
		expect(pairs('crm-api', vis)).toEqual([
			'customer-api->crm-db',
			'erp->customer-api',
			'loyalty-api->crm-db',
			'shop->customer-api',
			'shop->loyalty-api'
		]);
	});

	it('fades everything outside the focus except connection ends', () => {
		const ctx = contextFor(model, 'shop', visible('shop-web', 'shop-db'));
		expect(ctx.relevant.has('order-api')).toBe(true);
		expect(ctx.relevant.has('erp-db')).toBe(false);
		expect(ctx.framing.has('erp')).toBe(true);
	});
});
