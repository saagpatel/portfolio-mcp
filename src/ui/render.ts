// Pure HTML-string renderers for the gallery and timeline apps. No DOM access,
// so they run under vitest and inside the sandboxed app iframe alike. Every
// corpus value passes through esc() before it reaches markup.

import type {
	ArchiveSummary,
	GalleryCard,
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
<div class="meta"><span class="when">Active <time datetime="${esc(c.last_active ?? "")}">${formatDate(c.last_active)}</time></span>${c.status ? `<span class="status">${esc(c.status)}</span>` : ""}${flag(c.tests, "tests")}${flag(c.ci, "CI")}</div>
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
<figcaption>Lifecycle across all ${esc(a.total)} archived repositories</figcaption>
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
						e.status,
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
