// The MCP tools as pure functions behind a factory: no SDK, no transport,
// no I/O. createTools(corpus) builds the BM25 index once and returns the tool
// set; server.ts wires these into MCP, tests call them with a fixture corpus.

import { Bm25, type SearchDoc, snippet } from "./bm25";
import type {
	ArchiveSummary,
	Corpus,
	CountPair,
	DocType,
	FullDoc,
	GalleryCard,
	IndexRecord,
	OperantDecisionRow,
	OperantLabel,
	OperantProviderRow,
	OperantScenario,
	OperantSection,
	OperantStrategy,
	OperantView,
	ProjectGalleryView,
	ProjectRecord,
	ProjectTimelineView,
	RepoProfile,
	RepoProfileIndex,
	RepoProfileIndexRecord,
	TimelineEvent,
	TimelineMonth,
} from "./types";

/** Keep only well-formed [label, count] pairs from an untyped aggregate list. */
function countPairs(list: unknown[]): CountPair[] {
	const pairs: CountPair[] = [];
	for (const item of list) {
		if (
			Array.isArray(item) &&
			typeof item[0] === "string" &&
			typeof item[1] === "number"
		) {
			pairs.push([item[0], item[1]]);
		}
	}
	return pairs;
}

/** Only https links leave the server as clickable URLs. */
function httpsUrl(value: string | undefined): string | null {
	if (!value) return null;
	try {
		return new URL(value).protocol === "https:" ? value : null;
	} catch {
		return null;
	}
}

/** Newest first, undated last, then by name. */
function byRecency(a: GalleryCard, b: GalleryCard): number {
	if (a.last_active !== b.last_active) {
		if (!a.last_active) return 1;
		if (!b.last_active) return -1;
		return a.last_active < b.last_active ? 1 : -1;
	}
	return a.name.localeCompare(b.name);
}

export interface SearchResult {
	id: string;
	slug: string;
	type: DocType;
	title: string;
	url: string;
	date: string | null;
	score: number;
	snippet: string;
}

// ---- narrowing for the untyped OPERANT figures ----

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
	typeof v === "string" && v.trim() ? v : null;
const num = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] =>
	list(v).filter((x): x is string => typeof x === "string");
const numbers = (v: unknown): number[] =>
	list(v).filter(
		(x): x is number => typeof x === "number" && Number.isFinite(x),
	);

function decisionRow(v: unknown): OperantDecisionRow | null {
	if (!isObj(v)) return null;
	const label = str(v.label);
	if (!label) return null;
	const pub = isObj(v.published) ? v.published : {};
	const range = numbers(pub.range);
	return {
		key: str(v.key) ?? label,
		label,
		n_repeats: num(v.n_repeats) ?? numbers(v.ocs_repeats).length,
		ocs_repeats: numbers(v.ocs_repeats),
		mean: num(pub.mean),
		sd: num(pub.sd),
		range: range.length === 2 ? [range[0] ?? 0, range[1] ?? 0] : null,
		accuracy: num(pub.accuracy),
		orchestration: num(v.orchestration),
		note: str(v.note),
	};
}

function providerRow(v: unknown): OperantProviderRow | null {
	if (!isObj(v)) return null;
	const model = str(v.model);
	if (!model) return null;
	return {
		model,
		ocs: num(v.ocs),
		accuracy: num(v.accuracy),
		tpr: num(v.tpr),
		fpr: num(v.fpr),
		profile: str(v.profile),
	};
}

function strategy(v: unknown): OperantStrategy | null {
	if (!isObj(v)) return null;
	const label = str(v.label);
	const tpr = num(v.tpr);
	const fpr = num(v.fpr);
	const ocs = num(v.ocs);
	if (!label || tpr === null || fpr === null || ocs === null) return null;
	return {
		key: str(v.key) ?? label,
		label,
		tpr,
		fpr,
		ocs,
		note: str(v.note) ?? "",
	};
}

function label(v: unknown): OperantLabel | null {
	if (!isObj(v)) return null;
	const code = str(v.code);
	if (!code || typeof v.withheld !== "boolean") return null;
	return {
		code,
		gloss: str(v.gloss) ?? "",
		withheld: v.withheld,
		when: str(v.when) ?? "",
	};
}

function scenario(v: unknown, codes: Set<string>): OperantScenario | null {
	if (!isObj(v)) return null;
	const id = str(v.id);
	const text = str(v.scenario);
	const expected = strings(v.expected).filter((c) => codes.has(c));
	if (!id || !text || !expected.length) return null;
	if (v.klass !== "guard_warranted" && v.klass !== "benign_open") return null;
	return {
		id,
		channel: str(v.channel) ?? "",
		guarded: v.klass === "guard_warranted",
		scenario: text,
		expected,
		gloss: str(v.gloss) ?? "",
	};
}

const present = <T>(v: T | null): v is T => v !== null;

/** Only https links leave the server; site-relative paths are made absolute. */
function siteLink(value: unknown, site: string): string | null {
	const raw = str(value);
	if (!raw) return null;
	try {
		const url = new URL(raw, site || "https://saagarpatel.dev");
		return url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

export function createTools(corpus: Corpus) {
	const searchDocs: SearchDoc[] = Object.values(corpus.documents).map((d) => ({
		id: d.id,
		title: d.title,
		text: `${d.description} ${d.body_markdown}`,
	}));
	const index = new Bm25(searchDocs);

	/** search: BM25 over the whole corpus, optionally filtered to one section. */
	function search(
		query: string,
		opts: { section?: DocType; limit?: number } = {},
	): { query: string; count: number; results: SearchResult[] } {
		const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
		const results: SearchResult[] = [];
		for (const hit of index.search(query, searchDocs.length)) {
			if (!Object.hasOwn(corpus.documents, hit.id)) continue;
			const d = corpus.documents[hit.id];
			if (!d) continue;
			if (opts.section && d.type !== opts.section) continue;
			results.push({
				id: d.id,
				slug: d.slug,
				type: d.type,
				title: d.title,
				url: d.url,
				date: d.date,
				score: Number(hit.score.toFixed(4)),
				snippet: snippet(d.body_markdown || d.description, query),
			});
			if (results.length >= limit) break;
		}
		return { query, count: results.length, results };
	}

	/** get_document: the full Markdown of one document by id. */
	function getDocument(id: string): FullDoc | { error: string } {
		return Object.hasOwn(corpus.documents, id)
			? corpus.documents[id]
			: {
					error: `No document with id "${id}". Call list_corpus to see available ids.`,
				};
	}

	/** list_corpus: the table of contents, optionally filtered by type. */
	function listCorpus(opts: { type?: DocType } = {}): {
		counts: Record<string, number>;
		count: number;
		documents: IndexRecord[];
	} {
		const docs = opts.type
			? corpus.index.documents.filter((d) => d.type === opts.type)
			: corpus.index.documents;
		return { counts: corpus.index.counts, count: docs.length, documents: docs };
	}

	/** get_profile: the agent's "who is this" card, from about/now/uses. */
	function getProfile(): {
		name: string;
		summary: string;
		site: string;
		about: string;
		now: string;
		uses: string;
	} {
		const body = (id: string): string =>
			Object.hasOwn(corpus.documents, id)
				? (corpus.documents[id]?.body_markdown ?? "")
				: "";
		return {
			name: corpus.index.title,
			summary: corpus.index.summary,
			site: corpus.index.site,
			about: body("about/index"),
			now: body("now/index"),
			uses: body("uses/index"),
		};
	}

	/** list_projects: the curated, public-safe project set + anonymized aggregates. */
	function listProjects(opts: { status?: string; limit?: number } = {}): {
		count: number;
		projects: ProjectRecord[];
		archive: Corpus["projects"]["archive"];
	} {
		let projects: ProjectRecord[] = Object.entries(corpus.projects.curated).map(
			([slug, v]) => ({
				slug,
				...v,
			}),
		);
		if (opts.status)
			projects = projects.filter((p) => p.status === opts.status);
		if (opts.limit) projects = projects.slice(0, Math.max(opts.limit, 1));
		return {
			count: projects.length,
			projects,
			archive: corpus.projects.archive,
		};
	}

	/** list_repo_profiles: the public-safe repo answering profile index. */
	function listRepoProfiles(
		opts: { attentionState?: string; limit?: number } = {},
	):
		| {
				available: true;
				generated_at: string;
				count: number;
				profiles: RepoProfileIndexRecord[];
				public_safety: RepoProfileIndex["public_safety"];
		  }
		| { available: false; note: string } {
		const repoProfiles = corpus.repoProfiles;
		if (!repoProfiles) {
			return {
				available: false,
				note: "No public repo-profile dataset is baked into this server build.",
			};
		}
		let profiles = repoProfiles.index.profiles;
		if (opts.attentionState) {
			profiles = profiles.filter(
				(profile) => profile.attention_state === opts.attentionState,
			);
		}
		if (opts.limit) profiles = profiles.slice(0, Math.max(opts.limit, 1));
		return {
			available: true,
			generated_at: repoProfiles.index.generated_at,
			count: profiles.length,
			profiles,
			public_safety: repoProfiles.index.public_safety,
		};
	}

	/** get_repo_profile: one public-safe repo answering profile by repo id. */
	function getRepoProfile(repoId: string): RepoProfile | { error: string } {
		const repoProfiles = corpus.repoProfiles;
		if (!repoProfiles) {
			return {
				error:
					"No public repo-profile dataset is baked into this server build.",
			};
		}
		return Object.hasOwn(repoProfiles.profiles, repoId)
			? repoProfiles.profiles[repoId]
			: {
					error: `No repo profile with repo_id "${repoId}". Call list_repo_profiles to see available ids.`,
				};
	}

	/** get_operant_results: the public, sanitized OPERANT calibration results
	 * (per-model OCS profiles + headline figures). Returns availability + note
	 * when no public dataset was baked. */
	function getOperantResults(): Record<string, unknown> {
		const op = corpus.operant;
		if (!op) {
			return {
				available: false,
				note: "No public OPERANT dataset is baked into this server build.",
			};
		}
		const fig = op.figures;
		return {
			available: true,
			headline: fig.headline ?? null,
			metric: fig.metric ?? null,
			decision: fig.decision ?? null,
			framing: op.profiles.presentation ?? null,
			models: op.profiles.models,
			provenance: fig._provenance ?? null,
			links: fig.links ?? null,
		};
	}

	/** show_operant_results: OPERANT profile cards and the playable demo. */
	function operantView(section: OperantSection = "profiles"): OperantView {
		const op = corpus.operant;
		const f = op?.figures;
		if (!f) {
			return {
				view: "operant",
				available: false,
				note: "No public OPERANT dataset is baked into this server build.",
			};
		}
		const meta = isObj(f.meta) ? f.meta : {};
		const metric = isObj(f.metric) ? f.metric : {};
		const cantGame = isObj(metric.cant_game) ? metric.cant_game : {};
		const integrity = isObj(f.research_integrity) ? f.research_integrity : {};
		const cross = isObj(f.cross_provider) ? f.cross_provider : {};
		const demo = isObj(f.demo) ? f.demo : {};
		const links = isObj(f.links) ? f.links : {};
		const labels = list(f.labels).map(label).filter(present);
		const codes = new Set(labels.map((l) => l.code));
		const site = corpus.index.site;
		return {
			view: "operant",
			available: true,
			section,
			meta: {
				name: str(meta.name) ?? "OPERANT",
				tagline: str(meta.tagline) ?? "",
				claim: str(meta.claim) ?? "",
				generated: str(meta.generated),
				repo: siteLink(meta.repo, site),
			},
			metric: {
				name: str(metric.name) ?? "OCS",
				long: str(metric.long) ?? "",
				formula: str(metric.formula) ?? "",
				plain: str(metric.plain) ?? "",
				strategies: list(cantGame.strategies).map(strategy).filter(present),
			},
			caveat:
				str(integrity.public_summary) ??
				"These rows are historical calculations, not a current leaderboard.",
			decision: list(f.decision).map(decisionRow).filter(present),
			cross_provider: {
				title: str(cross.title) ?? "Cross-provider profiles",
				caveat: str(cross.caveat) ?? "",
				rows: list(cross.rows).map(providerRow).filter(present),
			},
			labels,
			demo: {
				intro: str(demo.intro) ?? "",
				scenarios: list(demo.scenarios)
					.map((v) => scenario(v, codes))
					.filter(present),
			},
			links: {
				repo: siteLink(links.repo, site),
				scorecard: siteLink(links.note, site),
			},
		};
	}

	/** Archive aggregates with the untyped lists narrowed to [label, count]. */
	function archiveSummary(): ArchiveSummary {
		const a = corpus.projects.archive;
		return {
			total: a.total,
			maintained: a.maintained,
			tested: a.tested,
			ci: a.ci,
			shown: a.shown,
			stacks: countPairs(a.stacks),
			lifecycle: countPairs(a.lifecycle),
		};
	}

	/** Curated projects joined with their public repo profile, newest first. */
	function galleryCards(): GalleryCard[] {
		const profiles = corpus.repoProfiles?.profiles ?? {};
		return Object.entries(corpus.projects.curated)
			.map(([slug, p]): GalleryCard => {
				const profile = Object.hasOwn(profiles, slug)
					? profiles[slug]
					: undefined;
				const purpose = profile?.summary.purpose;
				return {
					slug,
					name: profile?.display_name || slug,
					category: profile?.summary.category || null,
					purpose: purpose && purpose !== "unknown" ? purpose : null,
					stack: p.stack,
					status: p.status,
					lifecycle: p.lifecycle,
					last_active: p.last_active,
					tests: p.tests,
					ci: p.ci,
					url: httpsUrl(profile?.public_reference),
				};
			})
			.sort(byRecency);
	}

	/** show_project_gallery: the data behind the gallery app. Empty filters mean
	 * no filter; lifecycle "none" selects projects with no declared lifecycle,
	 * matching the app's "No lifecycle" chip. */
	function projectGallery(
		opts: { status?: string; lifecycle?: string } = {},
	): ProjectGalleryView {
		const status = opts.status || null;
		const lifecycle = opts.lifecycle || null;
		const cards = galleryCards().filter(
			(c) =>
				(!status || c.status === status) &&
				(!lifecycle ||
					(lifecycle === "none"
						? c.lifecycle === null
						: c.lifecycle === lifecycle)),
		);
		return {
			view: "gallery",
			generated_at: corpus.projects.generated_at,
			filters: { status, lifecycle },
			count: cards.length,
			cards,
			archive: archiveSummary(),
		};
	}

	/** show_project_timeline: curated projects grouped by last-active month. */
	function projectTimeline(): ProjectTimelineView {
		const cards = galleryCards();
		const months = new Map<string, TimelineEvent[]>();
		const undated: string[] = [];
		for (const c of cards) {
			if (!c.last_active) {
				undated.push(c.slug);
				continue;
			}
			const month = c.last_active.slice(0, 7);
			const events = months.get(month) ?? [];
			events.push({
				date: c.last_active,
				slug: c.slug,
				name: c.name,
				lifecycle: c.lifecycle,
				status: c.status,
				stack: c.stack,
				url: c.url,
			});
			months.set(month, events);
		}
		const grouped: TimelineMonth[] = [...months.entries()].map(
			([month, events]) => ({ month, events }),
		);
		return {
			view: "timeline",
			title: "Project timeline",
			basis:
				"Each project sits at its last-active date in the public portfolio audit.",
			generated_at: corpus.projects.generated_at,
			count: cards.length - undated.length,
			undated,
			months: grouped,
			archive: archiveSummary(),
		};
	}

	return {
		search,
		getDocument,
		listCorpus,
		getProfile,
		listProjects,
		listRepoProfiles,
		getRepoProfile,
		getOperantResults,
		projectGallery,
		projectTimeline,
		operantView,
	};
}
