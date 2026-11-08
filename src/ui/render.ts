// Pure HTML-string renderers for the gallery and timeline apps. No DOM access,
// so they run under vitest and inside the sandboxed app iframe alike. Every
// corpus value passes through esc() before it reaches markup.

import type {
	ArchiveSummary,
	DemoView,
	GalleryCard,
	InterleavingDemoView,
	MuseumDemoView,
	OperantDecisionRow,
	OperantLabel,
	OperantScenario,
	OperantSection,
	OperantView,
	ProjectGalleryView,
	ProjectTimelineView,
} from "../types";

export type GallerySort = "recent" | "name";

export type GalleryState = {
	query: string;
	lifecycle: string; // "all" or a lifecycle value ("none" for missing)
	sort: GallerySort;
};

export type RenderOptions = {
	canAsk: boolean; // host accepts ui/message, so "Ask about it" can work
};

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

export function esc(value: unknown): string {
	return String(value).replace(
		/[&<>"']/g,
		(ch) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				ch
			] ?? ch,
	);
}

/** "2026-08" -> "August 2026"; anything unexpected is returned escaped. */
export function formatMonth(ym: string): string {
	const m = /^(\d{4})-(\d{2})$/.exec(ym);
	const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
	return m && name ? `${name} ${m[1]}` : esc(ym);
}

/** "2026-08-21" -> "Aug 21, 2026". */
export function formatDate(date: string | null): string {
	if (!date) return "undated";
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
	const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
	return m && name ? `${name.slice(0, 3)} ${Number(m[3])}, ${m[1]}` : esc(date);
}

/** A CSS class for a lifecycle value, restricted to [a-z0-9-]. */
export function lifecycleClass(lifecycle: string | null): string {
	const key = (lifecycle ?? "none").toLowerCase().replace(/[^a-z0-9-]/g, "");
	return `lc-${key || "none"}`;
}

const lifecycleLabel = (lifecycle: string | null): string =>
	lifecycle ?? "no lifecycle";

const plural = (n: number, word: string): string =>
	`${n} ${word}${n === 1 ? "" : "s"}`;

/** Lifecycle values present in the cards, most common first. */
export function lifecycleOptions(cards: GalleryCard[]): string[] {
	const counts = new Map<string, number>();
	for (const c of cards) {
		const key = c.lifecycle ?? "none";
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([key]) => key);
}

export function filterCards(
	cards: GalleryCard[],
	state: GalleryState,
): GalleryCard[] {
	const q = state.query.trim().toLowerCase();
	const matches = cards.filter((c) => {
		if (
			state.lifecycle !== "all" &&
			(c.lifecycle ?? "none") !== state.lifecycle
		)
			return false;
		if (!q) return true;
		const haystack = [c.name, c.slug, c.category, c.purpose, ...c.stack]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
		return haystack.includes(q);
	});
	if (state.sort === "name") {
		return [...matches].sort((a, b) => a.name.localeCompare(b.name));
	}
	return matches; // the server already sends newest first
}

export function galleryHeader(view: ProjectGalleryView): string {
	const a = view.archive;
	const stat = (label: string, value: number): string =>
		`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
	return `<header class="head">
<div>
<h1>Projects</h1>
<p class="sub">${esc(plural(view.count, "curated public project"))}, from an archive of ${esc(a.total)} repositories.</p>
</div>
<dl class="stats" aria-label="Archive totals">${stat("Maintained", a.maintained)}${stat("Tested", a.tested)}${stat("With CI", a.ci)}</dl>
</header>`;
}

export function galleryControls(
	view: ProjectGalleryView,
	state: GalleryState,
): string {
	const chip = (value: string, label: string): string =>
		`<button type="button" class="chip ${value === "all" ? "" : lifecycleClass(value === "none" ? null : value)}" data-lifecycle="${esc(value)}" aria-pressed="${state.lifecycle === value}">${esc(label)}</button>`;
	const chips = [
		chip("all", "All"),
		...lifecycleOptions(view.cards).map((lc) =>
			chip(lc, lc === "none" ? "No lifecycle" : lc),
		),
	].join("");
	return `<div class="controls">
<input type="search" id="q" placeholder="Filter by name, stack or category" aria-label="Filter projects" value="${esc(state.query)}">
<div class="chips" role="group" aria-label="Lifecycle">${chips}</div>
<label class="sort">Sort <select id="sort" aria-label="Sort projects">
<option value="recent"${state.sort === "recent" ? " selected" : ""}>Most recent</option>
<option value="name"${state.sort === "name" ? " selected" : ""}>Name</option>
</select></label>
</div>`;
}

function card(c: GalleryCard, opts: RenderOptions): string {
	const stack = c.stack.length
		? `<ul class="stack" aria-label="Stack">${c.stack.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
		: "";
	const flag = (on: boolean, label: string): string =>
		`<span class="flag ${on ? "on" : "off"}" title="${esc(label)}: ${on ? "yes" : "no"}">${on ? "✓" : "–"} ${esc(label)}</span>`;
	const actions = [
		c.url
			? `<a class="action" href="${esc(c.url)}" data-open-link="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Repository ↗</a>`
			: "",
		opts.canAsk
			? `<button type="button" class="action" data-ask="${esc(c.name)}">Ask about it</button>`
			: "",
	].join("");
	return `<li class="card">
<div class="card-top"><h2>${esc(c.name)}</h2><span class="pill ${lifecycleClass(c.lifecycle)}">${esc(lifecycleLabel(c.lifecycle))}</span></div>
${c.category ? `<p class="cat">${esc(c.category)}</p>` : ""}
${c.purpose ? `<p class="purpose">${esc(c.purpose)}</p>` : ""}
${stack}
<div class="meta"><span class="when">Active <time datetime="${esc(c.last_active ?? "")}">${formatDate(c.last_active)}</time></span>${c.status ? `<span class="status" title="Activity signal from the portfolio audit">audit: ${esc(c.status)}</span>` : ""}${flag(c.tests, "tests")}${flag(c.ci, "CI")}</div>
${actions ? `<div class="actions">${actions}</div>` : ""}
</li>`;
}

export function galleryCards(
	cards: GalleryCard[],
	opts: RenderOptions,
): string {
	if (!cards.length) return `<p class="empty">No projects match.</p>`;
	return `<ul class="grid">${cards.map((c) => card(c, opts)).join("")}</ul>`;
}

/** Stacked bar of lifecycle states across the whole archive. */
export function archiveBar(a: ArchiveSummary): string {
	const segments: Array<{ label: string; n: number; cls: string }> =
		a.lifecycle.map(([label, n]) => ({
			label,
			n,
			cls: lifecycleClass(label),
		}));
	const known = segments.reduce((sum, s) => sum + s.n, 0);
	if (a.total > known) {
		segments.push({
			label: "undeclared",
			n: a.total - known,
			cls: lifecycleClass(null),
		});
	}
	const total = Math.max(a.total, known, 1);
	const description = segments.map((s) => `${s.label} ${s.n}`).join(", ");
	return `<figure class="lc-bar">
<figcaption>Lifecycle across all ${esc(a.total)} repositories in the portfolio</figcaption>
<div class="bar" role="img" aria-label="${esc(description)}">${segments
		.map(
			(s) =>
				`<span class="seg ${s.cls}" style="flex-grow:${s.n}" title="${esc(`${s.label}: ${s.n} (${Math.round((s.n / total) * 100)}%)`)}"></span>`,
		)
		.join("")}</div>
<ul class="legend">${segments
		.map(
			(s) =>
				`<li><span class="swatch ${s.cls}"></span>${esc(s.label)} <b>${esc(s.n)}</b></li>`,
		)
		.join("")}</ul>
</figure>`;
}

export function timelineBody(
	view: ProjectTimelineView,
	opts: RenderOptions,
): string {
	const months = view.months
		.map((m) => {
			const events = m.events
				.map((e) => {
					const name = e.url
						? `<a href="${esc(e.url)}" data-open-link="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.name)}</a>`
						: esc(e.name);
					const meta = [
						lifecycleLabel(e.lifecycle),
						e.status ? `audit: ${e.status}` : null,
						e.stack.join(", "),
					]
						.filter(Boolean)
						.map(esc)
						.join(" · ");
					const ask = opts.canAsk
						? `<button type="button" class="ask" data-ask="${esc(e.name)}" aria-label="Ask about ${esc(e.name)}">Ask</button>`
						: "";
					return `<li class="event ${lifecycleClass(e.lifecycle)}"><time datetime="${esc(e.date)}">${formatDate(e.date).replace(/, \d{4}$/, "")}</time><span class="dot" aria-hidden="true"></span><div class="ev-body"><span class="ev-name">${name}</span><span class="ev-meta">${meta}</span></div>${ask}</li>`;
				})
				.join("");
			return `<li class="month"><h2>${formatMonth(m.month)} <span class="count">${esc(plural(m.events.length, "project"))}</span></h2><ol class="events">${events}</ol></li>`;
		})
		.join("");
	const undated = view.undated.length
		? `<p class="note">Undated: ${view.undated.map(esc).join(", ")}</p>`
		: "";
	return `<header class="head"><div><h1>${esc(view.title)}</h1><p class="sub">${esc(view.basis)}</p></div></header>
${archiveBar(view.archive)}
${months ? `<ol class="months">${months}</ol>` : `<p class="empty">No dated projects.</p>`}
${undated}`;
}

// ---- OPERANT ----

type AvailableOperant = Extract<OperantView, { available: true }>;

/** Client state for the OPERANT view: the open tab and the demo's progress. */
export type OperantState = {
	tab: OperantSection;
	index: number; // current demo case; scenarios.length means the summary
	answers: Record<string, string>; // scenario id -> chosen label code
};

export type DemoScore = {
	answered: number;
	correct: number;
	tp: number; // guarded case, withheld
	fn: number; // guarded case, executed
	fp: number; // benign case, withheld (a false alarm)
	tn: number; // benign case, executed
	tpr: number | null;
	fpr: number | null;
	ocs: number | null; // TPR - FPR once both kinds of case are answered
};

/** Score the player the way OPERANT scores an agent: the positive signal is
 * withholding direct execution (a label marked withheld). */
export function scoreDemo(
	scenarios: OperantScenario[],
	labels: OperantLabel[],
	answers: Record<string, string>,
): DemoScore {
	const withheld = new Map(labels.map((l) => [l.code, l.withheld]));
	const score: DemoScore = {
		answered: 0,
		correct: 0,
		tp: 0,
		fn: 0,
		fp: 0,
		tn: 0,
		tpr: null,
		fpr: null,
		ocs: null,
	};
	for (const s of scenarios) {
		const choice = answers[s.id];
		if (choice === undefined || !withheld.has(choice)) continue;
		score.answered++;
		if (s.expected.includes(choice)) score.correct++;
		const held = withheld.get(choice) === true;
		if (s.guarded) {
			if (held) score.tp++;
			else score.fn++;
		} else if (held) {
			score.fp++;
		} else {
			score.tn++;
		}
	}
	if (score.tp + score.fn) score.tpr = score.tp / (score.tp + score.fn);
	if (score.fp + score.tn) score.fpr = score.fp / (score.fp + score.tn);
	if (score.tpr !== null && score.fpr !== null) {
		score.ocs = score.tpr - score.fpr;
	}
	return score;
}

/** 0.8731 -> "0.873"; null -> a dash placeholder. */
export function fmt(value: number | null, digits = 3): string {
	return value === null ? "–" : value.toFixed(digits);
}

/** OCS repeats on a 0..1 axis: the range as a band, each repeat as a dot. */
function repeatStrip(row: OperantDecisionRow): string {
	const x = (v: number): number =>
		Math.round((8 + Math.min(Math.max(v, 0), 1) * 184) * 10) / 10;
	const band = row.range
		? `<rect class="strip-band" x="${x(row.range[0])}" y="9" width="${Math.max(x(row.range[1]) - x(row.range[0]), 1)}" height="6" rx="3"></rect>`
		: "";
	const mean =
		row.mean === null
			? ""
			: `<line class="strip-mean" x1="${x(row.mean)}" x2="${x(row.mean)}" y1="4" y2="20"></line>`;
	const dots = row.ocs_repeats
		.map(
			(v) => `<circle class="strip-dot" cx="${x(v)}" cy="12" r="3.5"></circle>`,
		)
		.join("");
	const label = `OCS repeats: ${row.ocs_repeats.map((v) => fmt(v)).join(", ") || "none"}`;
	return `<svg class="strip" viewBox="0 0 200 30" role="img" aria-label="${esc(label)}">
<line class="strip-axis" x1="8" x2="192" y1="12" y2="12"></line>${band}${mean}${dots}
<text class="strip-tick" x="8" y="29">0</text><text class="strip-tick" x="100" y="29" text-anchor="middle">0.5</text><text class="strip-tick" x="192" y="29" text-anchor="end">1</text>
</svg>`;
}

function stat(label: string, value: string): string {
	return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function profilesTab(view: AvailableOperant): string {
	const m = view.metric;
	const strategies = m.strategies.length
		? `<ul class="strategies">${m.strategies
				.map(
					(s) =>
						`<li class="strategy"><span class="strategy-label">${esc(s.label)}</span><span class="strategy-ocs">${esc(m.name)} ${esc(fmt(s.ocs))}</span><span class="strategy-rates">TPR ${esc(fmt(s.tpr))} · FPR ${esc(fmt(s.fpr))}</span><p>${esc(s.note)}</p></li>`,
				)
				.join("")}</ul>`
		: "";
	const decision = view.decision
		.map(
			(r) => `<li class="card op-card">
<div class="card-top"><h3>${esc(r.label)}</h3><span class="op-n">n = ${esc(r.n_repeats)}</span></div>
<p class="op-mean"><span class="op-mean-value">${esc(fmt(r.mean))}</span>${r.sd === null ? "" : `<span class="op-sd"> ± ${esc(fmt(r.sd))}</span>`} <span class="op-unit">mean ${esc(m.name)}</span></p>
${repeatStrip(r)}
<dl class="op-stats">${stat("Range", r.range ? `${fmt(r.range[0])}–${fmt(r.range[1])}` : "–")}${stat("Accuracy", fmt(r.accuracy, 2))}${stat("Orchestration", fmt(r.orchestration))}</dl>
${r.note ? `<p class="op-note">${esc(r.note)}</p>` : ""}
</li>`,
		)
		.join("");
	const rate = (name: string, v: number | null): string =>
		`<div class="rate"><span>${esc(name)}</span><span class="rate-bar"><span style="width:${Math.round(Math.min(Math.max(v ?? 0, 0), 1) * 100)}%"></span></span><span>${esc(fmt(v))}</span></div>`;
	const providers = view.cross_provider.rows
		.map(
			(r) => `<li class="card op-card">
<div class="card-top"><h3>${esc(r.model)}</h3><span class="op-n">${esc(m.name)} ${esc(fmt(r.ocs))}</span></div>
${rate("TPR", r.tpr)}${rate("FPR", r.fpr)}
${r.profile ? `<p class="purpose">${esc(r.profile)}</p>` : ""}
</li>`,
		)
		.join("");
	const links = [
		view.links.repo
			? `<a class="action" href="${esc(view.links.repo)}" data-open-link="${esc(view.links.repo)}" target="_blank" rel="noopener noreferrer">OPERANT repository ↗</a>`
			: "",
		view.links.scorecard
			? `<a class="action" href="${esc(view.links.scorecard)}" data-open-link="${esc(view.links.scorecard)}" target="_blank" rel="noopener noreferrer">Lab scorecard ↗</a>`
			: "",
	].join("");
	return `<section class="op-metric" aria-label="The metric">
<p class="op-formula">${esc(m.formula || m.name)}</p>
${m.long ? `<p class="sub">${esc(m.long)}</p>` : ""}
<p class="op-plain">${esc(m.plain)}</p>
${strategies}
</section>
<h2 class="op-h2">Historical decision rows</h2>
<p class="note">Listed in the dataset's order, not ranked.</p>
<ul class="grid">${decision || '<li class="empty">No decision rows.</li>'}</ul>
${providers ? `<h2 class="op-h2">${esc(view.cross_provider.title)}</h2>${view.cross_provider.caveat ? `<p class="note">${esc(view.cross_provider.caveat)}</p>` : ""}<ul class="grid">${providers}</ul>` : ""}
${links ? `<div class="actions op-links">${links}</div>` : ""}`;
}

function scoreBar(score: DemoScore, metric: string): string {
	return `<dl class="stats op-score" aria-label="Your calibration so far">${stat("TPR", fmt(score.tpr, 2))}${stat("FPR", fmt(score.fpr, 2))}${stat(`Your ${metric}`, fmt(score.ocs, 2))}${stat("Correct", `${score.correct}/${score.answered}`)}</dl>`;
}

function demoTab(view: AvailableOperant, state: OperantState): string {
	const { scenarios } = view.demo;
	const labels = view.labels;
	if (!scenarios.length || !labels.length) {
		return `<p class="empty">The demo scenarios are not in this build.</p>`;
	}
	const score = scoreDemo(scenarios, labels, state.answers);
	const metric = view.metric.name;
	if (state.index >= scenarios.length) {
		const review = scenarios
			.map((s) => {
				const choice = state.answers[s.id] ?? "";
				const ok = s.expected.includes(choice);
				return `<li class="${ok ? "ok" : "miss"}"><span class="op-verdict">${ok ? "✓" : "✗"}</span> <strong>${esc(s.channel)}</strong>: you chose ${esc(choice || "nothing")}, expected ${esc(s.expected.join(" or "))}</li>`;
			})
			.join("");
		const compare = view.metric.strategies
			.map(
				(s) => `<li>${esc(s.label)}: ${esc(metric)} ${esc(fmt(s.ocs, 2))}</li>`,
			)
			.join("");
		return `<section class="op-demo">
<h2 class="op-h2">Your calibration: ${esc(metric)} ${esc(fmt(score.ocs, 2))}</h2>
${scoreBar(score, metric)}
<ol class="op-review">${review}</ol>
${compare ? `<p class="note">For comparison:</p><ul class="op-compare">${compare}</ul>` : ""}
<div class="op-actions"><button type="button" class="op-next" data-demo-restart="1">Play again</button></div>
</section>`;
	}
	const s = scenarios[state.index];
	if (!s) return "";
	const choice = state.answers[s.id];
	const answered = choice !== undefined;
	const buttons = labels
		.map((l) => {
			const picked = choice === l.code;
			const cls = answered
				? s.expected.includes(l.code)
					? " is-expected"
					: picked
						? " is-wrong"
						: ""
				: "";
			return `<button type="button" class="op-choice${cls}${picked ? " is-picked" : ""}" data-demo-choice="${esc(l.code)}" aria-pressed="${picked}"${answered ? " disabled" : ""}><span class="op-code">${esc(l.code)}</span><span class="op-gloss">${esc(l.gloss)}</span>${picked ? '<span class="op-pick">Your choice</span>' : ""}</button>`;
		})
		.join("");
	const verdict = answered
		? `<div class="op-result ${s.expected.includes(choice) ? "ok" : "miss"}" role="status" id="op-verdict"><p><strong>${s.expected.includes(choice) ? "Calibrated." : "Not quite."}</strong> Expected ${esc(s.expected.join(" or "))}.</p><p>${esc(s.gloss)}</p></div>
<div class="op-actions"><button type="button" class="op-next" data-demo-next="1" aria-describedby="op-verdict">${state.index + 1 < scenarios.length ? "Next case" : "See your score"}</button></div>`
		: "";
	return `<section class="op-demo">
${state.index === 0 && !answered ? `<p class="op-plain">${esc(view.demo.intro)}</p>` : ""}
${scoreBar(score, metric)}
<p class="shown">Case ${state.index + 1} of ${scenarios.length}</p>
<article class="card op-case"><span class="op-channel">${esc(s.channel)}</span><p class="op-scenario">${esc(s.scenario)}</p></article>
<div class="op-choices" role="group" aria-label="Your action">${buttons}</div>
${verdict}
</section>`;
}

export function operantBody(view: OperantView, state: OperantState): string {
	if (!view.available) return `<p class="empty">${esc(view.note)}</p>`;
	const tab = (key: OperantSection, label: string): string =>
		`<button type="button" class="chip" data-operant-tab="${key}" aria-pressed="${state.tab === key}">${esc(label)}</button>`;
	return `<header class="head"><div><h1>${esc(view.meta.name)}</h1><p class="sub">${esc(view.meta.tagline)}</p></div></header>
<aside class="op-caveat" aria-label="How to read these numbers"><p><strong>${esc(view.meta.claim)}</strong></p><details><summary>Research integrity</summary><p>${esc(view.caveat)}</p></details></aside>
<div class="chips op-tabs" role="group" aria-label="Section">${tab("profiles", "Calibration profiles")}${tab("demo", "Try it yourself")}</div>
${state.tab === "demo" ? demoTab(view, state) : profilesTab(view)}`;
}

// ---- playable demos: the Interleaving Explorer ----

export type IlMode = "warn" | "enforce";
type Writer = "A" | "B";

/** The six schedules of two writers that each read, then write. In a schedule
 * a writer's first letter is its read and its second letter is its write. */
export const SCHEDULES = [
	"AABB",
	"ABAB",
	"ABBA",
	"BAAB",
	"BABA",
	"BBAA",
] as const;
export type Schedule = (typeof SCHEDULES)[number];

export type IlReceipt = {
	writer: Writer;
	kind: "blind-refused" | "blind-overwrite" | "cas-conflict";
	text: string;
};

export type IlStep = {
	writer: Writer;
	op: "read" | "write";
	text: string;
	row: { content: string; version: number };
	receipt: IlReceipt | null;
};

export type IlRun = {
	steps: IlStep[];
	outcome: "lost-update" | "rejected" | "clean";
	told: Record<Writer, boolean | null>; // what each writer was told: ok?
	lost: boolean;
};

/** FNV-1a 32-bit, as a short stand-in for the receipt's content hash. */
export function contentHash(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/** Run one schedule. Writer A writes blind (no version); writer B does a
 * compare-and-swap on the version it read. Warn mode accepts the blind write
 * (and files a receipt with the displaced content's hash); enforce refuses it.
 * A lost update is a blind write that replaces a version its writer never read. */
export function simulateSchedule(
	schedule: Schedule,
	mode: IlMode,
	initial: { content: string; version: number },
): IlRun {
	const row = { ...initial };
	const read: Record<Writer, number | null> = { A: null, B: null };
	const told: Record<Writer, boolean | null> = { A: null, B: null };
	const steps: IlStep[] = [];
	let lost = false;
	let rejected = false;
	for (const writer of [...schedule] as Writer[]) {
		let receipt: IlReceipt | null = null;
		let text: string;
		let op: "read" | "write";
		if (read[writer] === null) {
			op = "read";
			read[writer] = row.version;
			text = `${writer} reads version ${row.version}`;
		} else if (writer === "A") {
			op = "write";
			if (mode === "enforce") {
				told.A = false;
				rejected = true;
				text = "A's blind write is refused: no version given";
				receipt = {
					writer,
					kind: "blind-refused",
					text: "Refused: write carried no expected version (enforce mode).",
				};
			} else {
				const unseen = row.version !== read.A;
				const displaced = row.content;
				lost ||= unseen;
				row.content = "Writer A's update";
				row.version += 1;
				told.A = true;
				text = unseen
					? `A's blind write replaces version ${row.version - 1}, which A never read`
					: `A's blind write lands on version ${row.version - 1}`;
				receipt = {
					writer,
					kind: "blind-overwrite",
					text: `Accepted blind overwrite (warn mode); displaced content hash ${contentHash(displaced)}${unseen ? ", committed work A never saw" : ""}.`,
				};
			}
		} else {
			op = "write";
			if (row.version === read.B) {
				row.content = "Writer B's update";
				row.version += 1;
				told.B = true;
				text = `B's CAS write commits version ${row.version}`;
			} else {
				told.B = false;
				rejected = true;
				text = `B's CAS write is rejected: expected version ${read.B}, found ${row.version}`;
				receipt = {
					writer,
					kind: "cas-conflict",
					text: `Conflict: expected version ${read.B}, row is at version ${row.version}.`,
				};
			}
		}
		steps.push({ writer, op, text, row: { ...row }, receipt });
	}
	return {
		steps,
		lost,
		told,
		outcome: lost ? "lost-update" : rejected ? "rejected" : "clean",
	};
}

/** Chance of each schedule when a fair coin picks which runnable writer goes
 * next: every step with both writers runnable halves the probability. */
export function scheduleProbability(schedule: Schedule): number {
	let p = 1;
	const left: Record<Writer, number> = { A: 2, B: 2 };
	for (const w of [...schedule] as Writer[]) {
		if (left.A > 0 && left.B > 0) p /= 2;
		left[w] -= 1;
	}
	return p;
}

export type IlState = { schedule: Schedule; mode: IlMode; step: number };

const OUTCOME_LABEL: Record<IlRun["outcome"], string> = {
	"lost-update": "Lost update",
	rejected: "Honest rejection",
	clean: "Clean",
};

const opsLabel = (schedule: Schedule): string => {
	const seen = new Set<string>();
	return ([...schedule] as Writer[])
		.map((w) => {
			const op = seen.has(w) ? "w" : "r";
			seen.add(w);
			return `${w}.${op}`;
		})
		.join(" → ");
};

function interleavingBody(view: InterleavingDemoView, state: IlState): string {
	const run = simulateSchedule(state.schedule, state.mode, view.initial);
	const shown = run.steps.slice(0, state.step);
	const row = shown[shown.length - 1]?.row ?? view.initial;
	const writerPanel = (w: Writer, label: string, plan: string): string => {
		const mine = shown.filter((s) => s.writer === w);
		const readStep = mine.find((s) => s.op === "read");
		const writeStep = mine.find((s) => s.op === "write");
		const result = writeStep
			? run.told[w] === null
				? "–"
				: run.told[w]
					? "told ok: true"
					: "rejected"
			: "–";
		return `<article class="card il-writer"><h3>${esc(label)}</h3><p class="note">${esc(plan)}</p><dl class="op-stats">${stat("Read version", readStep ? String(readStep.row.version) : "–")}${stat("Result", result)}</dl></article>`;
	};
	const receipts = shown
		.filter((s) => s.receipt)
		.map(
			(s) =>
				`<li class="il-receipt"><span class="il-receipt-kind">${esc(s.receipt?.kind ?? "")}</span> ${esc(s.receipt?.text ?? "")}</li>`,
		)
		.join("");
	const log = shown
		.map(
			(s, i) =>
				`<li><span class="il-step-n">${i + 1}</span> ${esc(s.text)}</li>`,
		)
		.join("");
	const done = state.step >= run.steps.length;
	const banner = done
		? `<div class="il-outcome il-${run.outcome}" role="status"><strong>${esc(OUTCOME_LABEL[run.outcome])}.</strong> ${
				run.outcome === "lost-update"
					? "Both writers were told ok, and B's committed work is gone."
					: run.outcome === "rejected"
						? "A write was refused and a receipt says why; nothing was lost."
						: "Both writes landed in order; nothing was lost."
			}</div>`
		: "";
	const chips = SCHEDULES.map(
		(sch) =>
			`<button type="button" class="chip" data-il-schedule="${sch}" aria-pressed="${sch === state.schedule}">${esc(opsLabel(sch))}</button>`,
	).join("");
	const modes = (["warn", "enforce"] as const)
		.map(
			(m) =>
				`<button type="button" class="chip" data-il-mode="${m}" aria-pressed="${m === state.mode}">${m}</button>`,
		)
		.join("");
	const table = SCHEDULES.map((sch) => {
		const warn = simulateSchedule(sch, "warn", view.initial).outcome;
		const enforce = simulateSchedule(sch, "enforce", view.initial).outcome;
		return `<tr${sch === state.schedule ? ' class="is-current"' : ""}><th scope="row">${esc(opsLabel(sch))}</th><td class="il-${warn}">${esc(OUTCOME_LABEL[warn])}</td><td class="il-${enforce}">${esc(OUTCOME_LABEL[enforce])}</td><td>${esc(fmt(scheduleProbability(sch), 3))}</td></tr>`;
	}).join("");
	const lostChance = (m: IlMode): number =>
		SCHEDULES.filter(
			(sch) => simulateSchedule(sch, m, view.initial).lost,
		).reduce((sum, sch) => sum + scheduleProbability(sch), 0);
	return `<header class="head"><div><h1>${esc(view.title)}</h1>${view.intro[0] ? `<p class="sub">${esc(view.intro[0])}</p>` : ""}</div></header>
${view.intro
	.slice(1)
	.map((p) => `<p class="op-plain">${esc(p)}</p>`)
	.join("")}
<div class="il-controls"><div class="chips" role="group" aria-label="Schedule">${chips}</div><div class="chips" role="group" aria-label="Mode">${modes}</div></div>
<div class="il-grid">
${writerPanel("A", "Writer A · blind write", "read → write (no version)")}
${writerPanel("B", "Writer B · CAS write", "read → write if version matches")}
<article class="card il-row"><h3>context_sections · one row</h3><dl class="op-stats">${stat("Content", `"${row.content}"`)}${stat("Version", String(row.version))}</dl></article>
</div>
<div class="op-actions il-actions"><button type="button" class="op-next" data-il-step="next"${done ? " disabled" : ""}>Step</button><button type="button" class="op-next il-secondary" data-il-step="all"${done ? " disabled" : ""}>Run all</button><button type="button" class="op-next il-secondary" data-il-step="reset">Reset</button><span class="shown">Step ${state.step} of ${run.steps.length}</span></div>
${banner}
${log ? `<ol class="il-log">${log}</ol>` : ""}
${receipts ? `<h2 class="op-h2">Receipts</h2><ul class="il-receipts">${receipts}</ul>` : ""}
${view.receipt ? `<p class="note">${esc(view.receipt)}</p>` : ""}
<h2 class="op-h2">All six interleavings</h2>
<table class="il-table"><thead><tr><th scope="col">Schedule</th><th scope="col">warn</th><th scope="col">enforce</th><th scope="col">Fair-coin chance</th></tr></thead><tbody>${table}</tbody></table>
<p class="note">Under a fair coin choosing who goes next at this read/write granularity, warn mode loses B's update in ${esc(fmt(lostChance("warn") * 100, 0))}% of runs and enforce mode in ${esc(fmt(lostChance("enforce") * 100, 0))}%.${view.sweep ? ` ${esc(view.sweep)}` : ""}</p>
${view.small_print ? `<p class="note">${esc(view.small_print)}</p>` : ""}
<div class="actions op-links"><a class="action" href="${esc(view.url)}" data-open-link="${esc(view.url)}" target="_blank" rel="noopener noreferrer">Original page ↗</a></div>`;
}

// ---- playable demos: the Agent Failure Museum ----

export type MuseumState = {
	round: number; // exhibits.length means the summary
	answers: Record<number, number>; // round -> chosen exhibit index
};

/** The three controls offered for round i: the right one and two others,
 * chosen and ordered deterministically so the game is reproducible. */
export function museumOptions(count: number, round: number): number[] {
	if (count < 3) return [];
	const a = (round + 1) % count;
	const b =
		(round + 3) % count === round ? (round + 2) % count : (round + 3) % count;
	const options = [round, a, b === a ? (round + 2) % count : b];
	const shift = round % 3;
	return [...options.slice(shift), ...options.slice(0, shift)];
}

/** "Name: details" -> "Name"; otherwise the first sentence, trimmed. */
export function controlName(control: string): string {
	const colon = control.indexOf(":");
	if (colon > 0 && colon <= 60) return control.slice(0, colon);
	const sentence = control.split(/(?<=\.)\s/)[0] ?? control;
	return sentence.length > 90 ? `${sentence.slice(0, 87)}…` : sentence;
}

function museumBody(view: MuseumDemoView, state: MuseumState): string {
	const n = view.exhibits.length;
	const correct = Object.entries(state.answers).filter(
		([round, choice]) => Number(round) === choice,
	).length;
	const answered = Object.keys(state.answers).length;
	const score = `<dl class="stats op-score" aria-label="Your score">${stat("Matched", `${correct}/${answered}`)}${stat("Exhibits", String(n))}</dl>`;
	const head = `<header class="head"><div><h1>${esc(view.title)}</h1>${view.intro[0] ? `<p class="sub">${esc(view.intro[0])}</p>` : ""}</div></header>
${view.fixture_rule ? `<aside class="op-caveat"><p>${esc(view.fixture_rule)}</p></aside>` : ""}`;
	if (state.round >= n) {
		const review = view.exhibits
			.map((e, i) => {
				const ok = state.answers[i] === i;
				return `<li class="${ok ? "ok" : "miss"}"><span class="op-verdict">${ok ? "✓" : "✗"}</span> <strong>${esc(e.title)}</strong>: ${esc(controlName(e.control))}</li>`;
			})
			.join("");
		return `${head}<section class="op-demo"><h2 class="op-h2">You matched ${correct} of ${n}</h2>${score}<ol class="op-review">${review}</ol><div class="op-actions"><button type="button" class="op-next" data-mu-restart="1">Play again</button></div><div class="actions op-links"><a class="action" href="${esc(view.url)}" data-open-link="${esc(view.url)}" target="_blank" rel="noopener noreferrer">The museum ↗</a></div></section>`;
	}
	const e = view.exhibits[state.round];
	if (!e) return head;
	const chosen = state.answers[state.round];
	const answered1 = chosen !== undefined;
	const options = museumOptions(n, state.round)
		.map((idx) => {
			const ex = view.exhibits[idx];
			if (!ex) return "";
			const cls = answered1
				? idx === state.round
					? " is-expected"
					: idx === chosen
						? " is-wrong"
						: ""
				: "";
			const picked = idx === chosen;
			return `<button type="button" class="op-choice${cls}${picked ? " is-picked" : ""}" data-mu-choice="${idx}" aria-pressed="${picked}"${answered1 ? " disabled" : ""}><span class="op-code">${esc(controlName(ex.control))}</span>${picked ? '<span class="op-pick">Your choice</span>' : ""}</button>`;
		})
		.join("");
	const verdict = answered1
		? `<div class="op-result ${chosen === state.round ? "ok" : "miss"}" role="status" id="mu-verdict"><p><strong>${chosen === state.round ? "Caught." : "Not this one."}</strong> ${esc(e.control)}</p><p><strong>Still uncertain:</strong> ${esc(e.uncertain)}</p></div>
<div class="op-actions"><button type="button" class="op-next" data-mu-next="1" aria-describedby="mu-verdict">${state.round + 1 < n ? "Next exhibit" : "See your score"}</button></div>`
		: "";
	return `${head}<section class="op-demo">${score}
<p class="shown">Exhibit ${state.round + 1} of ${n}</p>
<article class="card op-case">${e.category ? `<span class="op-channel">${esc(e.category)}</span>` : ""}<h3>${esc(e.title)}</h3><p class="op-scenario">${esc(e.failure)}</p><p class="note"><strong>Why it is tempting:</strong> ${esc(e.tempting)}</p><p class="note"><strong>What goes wrong:</strong> ${esc(e.wrong)}</p></article>
<p class="op-plain">Which control catches it?</p>
<div class="op-choices mu-choices" role="group" aria-label="Controls">${options}</div>
${verdict}
</section>`;
}

export type DemoState = { il: IlState; museum: MuseumState };

export function demoBody(view: DemoView, state: DemoState): string {
	if (!view.available) return `<p class="empty">${esc(view.note)}</p>`;
	return view.demo === "interleaving"
		? interleavingBody(view, state.il)
		: museumBody(view, state.museum);
}
