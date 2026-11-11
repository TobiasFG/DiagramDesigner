import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../../cli/sdv';
import { FIXTURE_ROOT } from './helpers';

/** A throwaway repository: sdv.config.ts + a copy of the fixture design. */
function repo() {
	const dir = mkdtempSync(path.join(tmpdir(), 'sdv-cli-'));
	cpSync(FIXTURE_ROOT, path.join(dir, 'design'), { recursive: true });
	writeFileSync(path.join(dir, 'sdv.config.ts'), "export default { root: 'design' };\n");
	return dir;
}

async function sdv(cwd: string, ...args: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(args, { log: (m) => out.push(m), error: (m) => err.push(m) }, cwd);
	return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('sdv validate', () => {
	it('passes on the fixture and fails with file:line:col on errors', async () => {
		const dir = repo();
		const ok = await sdv(dir, 'validate');
		expect(ok.code).toBe(0);
		expect(ok.out).toContain('0 error(s), 0 warning(s)');
		writeFileSync(
			path.join(dir, 'design/model/erp/broken.module.yaml'),
			'id: x\nparent: erp\nkind: db\n'
		);
		const bad = await sdv(dir, 'validate');
		expect(bad.code).toBe(1);
		expect(bad.err).toBe('model/erp/broken.module.yaml:3:1: error unknown field "kind" [schema]');
	});

	it('--root points at a design elsewhere', async () => {
		const dir = repo();
		expect((await sdv(tmpdir(), 'validate', '--root', path.join(dir, 'design'), '-q')).code).toBe(
			0
		);
	});
});

describe('sdv new', () => {
	it('creates an entity file with a generated id that validates', async () => {
		const dir = repo();
		const file = 'design/model/erp/billing.module.yaml';
		const res = await sdv(dir, 'new', file, '--parent', 'erp');
		expect(res.code).toBe(0);
		expect(res.out).toBe(`created ${file}`);
		expect(readFileSync(path.join(dir, file), 'utf8')).toMatch(
			/^id: [a-z][a-z0-9]{9}\nparent: erp\nname: billing\n$/
		);
		expect((await sdv(dir, 'validate', '-q')).code).toBe(0);
		expect((await sdv(dir, 'new', file)).code).toBe(1);
	});

	it('rejects file names without a known kind', async () => {
		const dir = repo();
		expect((await sdv(dir, 'new', 'x.planet.yaml')).code).toBe(2);
		expect((await sdv(dir, 'new')).code).toBe(2);
		expect(existsSync(path.join(dir, 'x.planet.yaml'))).toBe(false);
	});
});

describe('sdv schema', () => {
	it('writes the JSON Schema for entity files', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sdv-schema-'));
		expect((await sdv(dir, 'schema', '--out', dir)).code).toBe(0);
		const entity = JSON.parse(readFileSync(path.join(dir, 'entity.schema.json'), 'utf8'));
		expect(entity.title).toBe('System Design Viewer entity file');
		expect(Object.keys(entity.properties)).toEqual([
			'id',
			'parent',
			'ownedBy',
			'storedIn',
			'models',
			'fields',
			'indexes',
			'name',
			'tags',
			'links',
			'meta'
		]);
	});

	it('prints help and rejects unknown commands', async () => {
		expect((await sdv(tmpdir(), '--help')).out).toContain('sdv validate');
		expect((await sdv(tmpdir(), 'frobnicate')).code).toBe(2);
	});
});
