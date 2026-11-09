import {
	isCollection,
	isMap,
	isNode,
	isScalar,
	isSeq,
	parseDocument,
	type Document,
	type Node,
	type Pair,
	type YAMLMap,
	type YAMLSeq
} from 'yaml';

/**
 * Updates a YAML Document so it represents `value`, touching as little as possible:
 * unchanged subtrees are left alone, changed scalars keep their node (and so their comments
 * and quoting), list items are matched by `id` or content so comments move with their item,
 * and new keys/items are appended. Comments on removed nodes go with them.
 */
export function reconcileDocument(doc: Document, value: unknown): void {
	doc.contents = reconcile(doc, doc.contents, value) as Document['contents'];
}

const STRINGIFY = { lineWidth: 0 };

/**
 * Applies `value` to YAML text. The yaml library normalises a few layouts when printing
 * (e.g. a comment after a block key moves to the next line), so the edit is computed as a
 * diff between the library's print of the original and of the edited document, and only
 * those hunks are spliced into the original text. Falls back to the full print when a hunk
 * cannot be anchored.
 */
export function editYamlText(text: string, value: unknown): string {
	const doc = parseDocument(text);
	const baseline = doc.toString(STRINGIFY);
	reconcileDocument(doc, value);
	const modified = doc.toString(STRINGIFY);
	if (baseline === modified) return text;
	if (baseline === text) return modified;
	return spliceHunks(text, baseline, modified) ?? modified;
}

/** Matched line index pairs between a and b (common prefix/suffix trimmed before the LCS). */
function lineMatches(a: string[], b: string[]): [number, number][] {
	let pre = 0;
	while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
	let suf = 0;
	while (
		suf < a.length - pre &&
		suf < b.length - pre &&
		a[a.length - 1 - suf] === b[b.length - 1 - suf]
	)
		suf++;
	const mid = lcs(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf)).map(
		([i, j]): [number, number] => [i + pre, j + pre]
	);
	const out: [number, number][] = [];
	for (let i = 0; i < pre; i++) out.push([i, i]);
	out.push(...mid);
	for (let k = suf; k > 0; k--) out.push([a.length - k, b.length - k]);
	return out;
}

/** Pairs up unmatched lines positionally where both sides have equally long gaps. */
function fillGaps(matches: [number, number][], aLen: number, bLen: number): Map<number, number> {
	const out = new Map<number, number>();
	let pa = 0;
	let pb = 0;
	for (const [a, b] of [...matches, [aLen, bLen] as [number, number]]) {
		if (a - pa === b - pb) for (let k = 0; k < a - pa; k++) out.set(pa + k, pb + k);
		if (a < aLen) out.set(a, b);
		pa = a + 1;
		pb = b + 1;
	}
	return out;
}

/** Removes padding inside [ ] or { } outside quoted strings. */
function unpad(line: string, open: string, close: string): string {
	let out = '';
	let quote = '';
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quote) {
			if (c === quote && line[i - 1] !== '\\') quote = '';
			out += c;
			continue;
		}
		if (c === '"' || c === "'") quote = c;
		if (c === ' ' && line[i - 1] === open) continue;
		if (c === ' ' && line[i + 1] === close) continue;
		out += c;
	}
	return out;
}

const STYLES = [
	(l: string) => unpad(l, '[', ']'),
	(l: string) => unpad(l, '{', '}'),
	(l: string) => unpad(unpad(l, '[', ']'), '{', '}')
];

/** An edited line keeps the flow-collection padding its original line had. */
function restyle(printed: string, original: string, edited: string): string {
	if (printed === original) return edited;
	const style = STYLES.find((f) => f(printed) === original);
	return style ? style(edited) : edited;
}

function spliceHunks(original: string, baseline: string, modified: string): string | undefined {
	const O = original.split('\n');
	const B = baseline.split('\n');
	const M = modified.split('\n');
	const bToO = fillGaps(lineMatches(B, O), B.length, O.length);
	const bm = lineMatches(B, M);
	// Hunks: replace B[bStart, bEnd) by M[mStart, mEnd).
	const hunks: { bStart: number; bEnd: number; mStart: number; mEnd: number }[] = [];
	let bi = 0;
	let mi = 0;
	for (const [b, m] of [...bm, [B.length, M.length] as [number, number]]) {
		if (b > bi || m > mi) hunks.push({ bStart: bi, bEnd: b, mStart: mi, mEnd: m });
		bi = b + 1;
		mi = m + 1;
	}
	const out = [...O];
	for (const h of hunks.reverse()) {
		// Every replaced line, or for insertions the line before, must map onto the original.
		let oStart: number | undefined;
		if (h.bStart < h.bEnd) {
			oStart = bToO.get(h.bStart);
			for (let k = h.bStart; k < h.bEnd; k++)
				if (bToO.get(k) !== (oStart ?? NaN) + (k - h.bStart)) return undefined;
		} else if (h.bStart === 0) oStart = 0;
		else {
			const prev = bToO.get(h.bStart - 1);
			oStart = prev === undefined ? undefined : prev + 1;
		}
		if (oStart === undefined) return undefined;
		const lines = M.slice(h.mStart, h.mEnd);
		// Line-for-line edits keep the original line's style.
		if (h.bEnd - h.bStart === lines.length) {
			for (let k = 0; k < lines.length; k++)
				lines[k] = restyle(B[h.bStart + k], O[oStart + k], lines[k]);
		}
		out.splice(oStart, h.bEnd - h.bStart, ...lines);
	}
	return out.join('\n');
}

function toJS(doc: Document, node: unknown): unknown {
	return isNode(node) ? node.toJS(doc) : node;
}

export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) {
		const bb = b as unknown[];
		return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
	}
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	return (
		ka.length === kb.length &&
		ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
	);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function create(doc: Document, value: unknown, flow: boolean): Node {
	const node = doc.createNode(value) as Node;
	if (flow && isCollection(node)) node.flow = true;
	return node;
}

function reconcile(doc: Document, node: unknown, value: unknown, flow = false): unknown {
	if (node !== null && node !== undefined && deepEqual(toJS(doc, node), value)) return node;
	if (isPlainObject(value) && isMap(node)) {
		reconcileMap(doc, node, value);
		return node;
	}
	if (Array.isArray(value) && isSeq(node)) {
		reconcileSeq(doc, node, value);
		return node;
	}
	if (isScalar(node) && (value === null || typeof value !== 'object')) {
		// Numbers turning into strings (or back) must not keep a style that no longer fits.
		if (
			typeof node.value !== typeof value &&
			node.type !== 'QUOTE_DOUBLE' &&
			node.type !== 'QUOTE_SINGLE'
		)
			node.type = undefined;
		node.value = value;
		return node;
	}
	const created = create(doc, value, flow);
	if (isNode(node) && isNode(created)) {
		created.commentBefore = node.commentBefore;
		created.comment = node.comment;
		created.spaceBefore = node.spaceBefore;
	}
	return created;
}

function keyOf(pair: Pair): unknown {
	return isScalar(pair.key) ? pair.key.value : pair.key;
}

function reconcileMap(doc: Document, node: YAMLMap, value: Record<string, unknown>) {
	node.items = node.items.filter((pair) => Object.hasOwn(value, String(keyOf(pair))));
	for (const [key, v] of Object.entries(value)) {
		if (v === undefined) continue;
		const pair = node.items.find((p) => String(keyOf(p)) === key);
		if (pair) pair.value = reconcile(doc, pair.value, v, node.flow) as Node;
		else node.items.push(doc.createPair(key, create(doc, v, !!node.flow)) as Pair);
	}
}

/** Identity used to match list items: `id` when present, otherwise the full content. */
function identity(v: unknown): { key: string; hasId: boolean } {
	if (isPlainObject(v) && typeof v.id === 'string') return { key: `id:${v.id}`, hasId: true };
	return { key: `json:${JSON.stringify(v)}`, hasId: false };
}

function lcs(a: string[], b: string[]): [number, number][] {
	const n = a.length;
	const m = b.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--)
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	}
	const out: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			out.push([i, j]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
		else j++;
	}
	return out;
}

/** New list items copy their neighbour's layout: flow style, quoting of same-named keys, blank lines. */
function adoptStyle(node: Node, like: unknown) {
	if (!isCollection(like)) return;
	if (like.flow && isCollection(node)) node.flow = true;
	if (isNode(like) && like.spaceBefore) node.spaceBefore = true;
	if (!isMap(node) || !isMap(like)) return;
	for (const pair of node.items) {
		const twin = like.items.find((p) => String(keyOf(p)) === String(keyOf(pair)));
		if (
			isScalar(pair.value) &&
			isScalar(twin?.value) &&
			typeof pair.value.value === 'string' &&
			typeof twin.value.value === 'string'
		) {
			pair.value.type = twin.value.type;
		}
	}
}

function reconcileSeq(doc: Document, node: YAMLSeq, value: unknown[]) {
	const oldItems = node.items;
	const oldIds = oldItems.map((it) => identity(toJS(doc, it)));
	const newIds = value.map(identity);
	const matches = lcs(
		oldIds.map((x) => x.key),
		newIds.map((x) => x.key)
	);
	// Items that moved (not part of the LCS) keep their node, and so their comments and style.
	const matchedOld = new Set(matches.map(([mi]) => mi));
	const matchedNew = new Set(matches.map(([, mj]) => mj));
	const movable = new Map<string, number[]>();
	oldIds.forEach((id, k) => {
		if (matchedOld.has(k)) return;
		if (!movable.has(id.key)) movable.set(id.key, []);
		movable.get(id.key)!.push(k);
	});
	const moved = new Map<number, number>();
	newIds.forEach((id, k) => {
		const from = matchedNew.has(k) ? undefined : movable.get(id.key)?.shift();
		if (from !== undefined) moved.set(k, from);
	});
	const movedOld = new Set(moved.values());
	const items: unknown[] = [];
	let i = 0;
	let j = 0;
	for (const [mi, mj] of [...matches, [oldItems.length, value.length] as [number, number]]) {
		const oldGap = mi - i;
		const newGap = mj - j;
		for (let k = 0; k < newGap; k++) {
			const v = value[j + k];
			const from = moved.get(j + k);
			// Otherwise pair edits in place: equal-sized gaps, or items without ids (content changed).
			const inPlace =
				k < oldGap &&
				!movedOld.has(i + k) &&
				(oldGap === newGap || (!oldIds[i + k].hasId && !newIds[j + k].hasId));
			if (from !== undefined) items.push(oldItems[from]);
			else if (inPlace) items.push(reconcile(doc, oldItems[i + k], v, node.flow));
			else {
				const created = create(doc, v, !!node.flow);
				adoptStyle(created, items[items.length - 1] ?? oldItems[0]);
				items.push(created);
			}
		}
		if (mi < oldItems.length) items.push(reconcile(doc, oldItems[mi], value[mj], node.flow));
		i = mi + 1;
		j = mj + 1;
	}
	node.items = items;
}
