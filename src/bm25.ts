// Dependency-free BM25 over the corpus. The corpus is tiny (~48 docs) and the
// consumer is an LLM that supplies its own semantics, so lexical ranking is
// enough to narrow; the agent does the rest. Titles are boosted so a query that
// matches a title outranks an incidental body mention. No stemming in v1 (a
// documented Phase 3 enhancement); tokenization is lowercase alphanumerics.

const K1 = 1.5;
const B = 0.75;
const TITLE_BOOST = 3; // title terms counted this many times

export const tokenize = (s: string): string[] =>
	s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

export interface SearchDoc {
	id: string;
	title: string;
	text: string; // description + body
}

export interface SearchHit {
	id: string;
	score: number;
}

export class Bm25 {
	private postings = new Map<string, Map<string, number>>(); // term -> (docId -> tf)
	private docLen = new Map<string, number>();
	private avgdl = 0;
	private readonly N: number;

	constructor(docs: SearchDoc[]) {
		for (const d of docs) {
			const boostedTitle = Array<string>(TITLE_BOOST)
				.fill(d.title)
				.flatMap(tokenize);
			const tokens = [...boostedTitle, ...tokenize(d.text)];
			this.docLen.set(d.id, tokens.length);
			for (const t of tokens) {
				let m = this.postings.get(t);
				if (!m) {
					m = new Map();
					this.postings.set(t, m);
				}
				m.set(d.id, (m.get(d.id) ?? 0) + 1);
			}
		}
		this.N = docs.length;
		let total = 0;
		for (const l of this.docLen.values()) total += l;
		this.avgdl = this.N ? total / this.N : 0;
	}

	search(query: string, limit = 10): SearchHit[] {
		const terms = [...new Set(tokenize(query))];
		const scores = new Map<string, number>();
		for (const t of terms) {
			const m = this.postings.get(t);
			if (!m) continue;
			const df = m.size;
			const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
			for (const [id, tf] of m) {
				const dl = this.docLen.get(id) ?? 0;
				const denom = tf + K1 * (1 - B + (B * dl) / (this.avgdl || 1));
				scores.set(
					id,
					(scores.get(id) ?? 0) + idf * ((tf * (K1 + 1)) / (denom || 1)),
				);
			}
		}
		return [...scores.entries()]
			.map(([id, score]) => ({ id, score }))
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
	}
}

/** A query-centered excerpt of a body, with ellipses when trimmed. */
export const snippet = (body: string, query: string, radius = 160): string => {
	if (!body) return "";
	const lower = body.toLowerCase();
	let pos = -1;
	for (const t of tokenize(query)) {
		const i = lower.indexOf(t);
		if (i >= 0 && (pos < 0 || i < pos)) pos = i;
	}
	if (pos < 0) {
		const head = body.slice(0, radius * 2).trim();
		return body.length > radius * 2 ? `${head}…` : head;
	}
	const start = Math.max(0, pos - radius);
	const end = Math.min(body.length, pos + radius);
	return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
};
