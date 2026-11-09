/**
 * View include/exclude patterns:
 *   "order-service"   exact id
 *   "shop.*"          direct children of shop
 *   "shop.**"         all descendants of shop
 *   "order-*"         glob over ids ("*" matches within an id)
 *   "tag:internal"    everything tagged "internal"
 *   "*" / "**"        top-level entities / everything
 */

export interface Selectable {
	id: string;
	tags?: string[];
	parentId?: string;
	childIds?: string[];
}

export function globToRegExp(glob: string): RegExp {
	const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*');
	return new RegExp(`^${escaped}$`);
}

function descendants(items: Map<string, Selectable>, id: string, deep: boolean, out: Set<string>) {
	for (const child of items.get(id)?.childIds ?? []) {
		out.add(child);
		if (deep) descendants(items, child, true, out);
	}
}

/** Resolves one pattern to the matching ids. */
export function matchPattern(items: Map<string, Selectable>, pattern: string): Set<string> {
	const out = new Set<string>();
	if (pattern.startsWith('tag:')) {
		const tag = pattern.slice(4);
		for (const item of items.values()) if (item.tags?.includes(tag)) out.add(item.id);
		return out;
	}
	if (pattern === '**') {
		for (const id of items.keys()) out.add(id);
		return out;
	}
	if (pattern === '*') {
		for (const item of items.values()) if (!item.parentId) out.add(item.id);
		return out;
	}
	const deep = pattern.endsWith('.**');
	if (deep || pattern.endsWith('.*')) {
		const base = pattern.slice(0, deep ? -3 : -2);
		for (const id of matchPattern(items, base)) descendants(items, id, deep, out);
		return out;
	}
	if (pattern.includes('*')) {
		const re = globToRegExp(pattern);
		for (const id of items.keys()) if (re.test(id)) out.add(id);
		return out;
	}
	if (items.has(pattern)) out.add(pattern);
	return out;
}

export interface Selection {
	ids: Set<string>;
	/** Patterns that matched nothing. */
	unmatched: string[];
}

export function select(
	items: Map<string, Selectable>,
	include: string[] | undefined,
	exclude: string[] | undefined,
	/** Used when include is omitted. */
	defaults: Iterable<string>
): Selection {
	const unmatched: string[] = [];
	let ids: Set<string>;
	if (include) {
		ids = new Set();
		for (const p of include) {
			const m = matchPattern(items, p);
			if (!m.size) unmatched.push(p);
			for (const id of m) ids.add(id);
		}
	} else ids = new Set(defaults);
	for (const p of exclude ?? []) {
		const m = matchPattern(items, p);
		if (!m.size) unmatched.push(p);
		for (const id of m) {
			ids.delete(id);
			// Excluding an entity also hides everything nested in it.
			const nested = new Set<string>();
			descendants(items, id, true, nested);
			for (const n of nested) ids.delete(n);
		}
	}
	return { ids, unmatched };
}
