/** Minimal SVG tree with deterministic serialisation (attribute order as given, rounded numbers). */
export interface SvgNode {
	tag: string;
	attrs?: Record<string, string | number | undefined | null | false>;
	children?: (SvgNode | string | null | undefined | false)[];
}

export function el(
	tag: string,
	attrs?: SvgNode['attrs'],
	...children: (SvgNode | string | null | undefined | false)[]
): SvgNode {
	return { tag, attrs, children };
}

export function num(n: number): string {
	const r = Math.round(n * 100) / 100;
	return Object.is(r, -0) ? '0' : String(r);
}

export function escapeXml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);
}

export function toSvgString(node: SvgNode | string, indent = -1, depth = 0): string {
	if (typeof node === 'string') return escapeXml(node);
	const entries = Object.entries(node.attrs ?? {}).filter(
		([, v]) => v !== undefined && v !== null && v !== false
	);
	// CSS variables are only reliable in `style`, not in presentation attributes.
	const styled = entries.filter(([, v]) => typeof v === 'string' && v.startsWith('var('));
	const plain = entries.filter(([, v]) => !(typeof v === 'string' && v.startsWith('var(')));
	if (styled.length) plain.push(['style', styled.map(([k, v]) => `${k}:${v}`).join(';')]);
	const attrs = plain
		.map(([k, v]) => ` ${k}="${escapeXml(typeof v === 'number' ? num(v) : String(v))}"`)
		.join('');
	const kids = (node.children ?? []).filter((c): c is SvgNode | string => !!c || c === '');
	const close = indent >= 0 ? '\n' + ' '.repeat(indent * depth) : '';
	const open = depth > 0 ? close : '';
	if (!kids.length) return `${open}<${node.tag}${attrs}/>`;
	// Text content stays inline so whitespace is preserved exactly.
	if (kids.every((k) => typeof k === 'string')) {
		return `${open}<${node.tag}${attrs}>${kids.map((k) => escapeXml(k as string)).join('')}</${node.tag}>`;
	}
	const inner = kids.map((k) => toSvgString(k, indent, depth + 1)).join('');
	return `${open}<${node.tag}${attrs}>${inner}${close}</${node.tag}>`;
}

/** Builds an SVG path `d` from commands with rounded numbers. */
export function pathD(...parts: (string | number)[]): string {
	return parts.map((p) => (typeof p === 'number' ? num(p) : p)).join(' ');
}
