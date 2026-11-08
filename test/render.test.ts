import { describe, expect, it } from "vitest";
import { corpus } from "../src/corpus";
import { createTools } from "../src/tools";
import type { GalleryCard, ProjectTimelineView } from "../src/types";
import { appHtml } from "../src/ui/html";
import {
	archiveBar,
	esc,
	filterCards,
	formatDate,
	formatMonth,
	galleryCards,
	galleryControls,
	galleryHeader,
	lifecycleClass,
	lifecycleOptions,
	timelineBody,
} from "../src/ui/render";

const card = (over: Partial<GalleryCard>): GalleryCard => ({
	slug: "x",
	name: "X",
	category: null,
	purpose: null,
	stack: [],
	status: null,
	lifecycle: null,
	last_active: null,
	tests: false,
	ci: false,
	url: null,
	...over,
});

const cards: GalleryCard[] = [
	card({
		slug: "mcp-trust",
		name: "mcp-trust",
		lifecycle: "active",
		stack: ["Python"],
		last_active: "2026-08-21",
	}),
	card({
		slug: "ink",
		name: "Ink",
		lifecycle: "dormant",
		stack: ["Swift"],
		category: "creative",
		last_active: "2026-08-11",
	}),
	card({ slug: "redact", name: "Redact", lifecycle: "dormant" }),
];

describe("escaping and formatting", () => {
	it("escapes every HTML-significant character", () => {
		expect(esc(`<img src=x onerror="a('b')">&`)).toBe(
			"&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;",
		);
	});

	it("formats months and dates, and escapes anything unexpected", () => {
		expect(formatMonth("2026-08")).toBe("August 2026");
		expect(formatMonth("<b>")).toBe("&lt;b&gt;");
		expect(formatDate("2026-08-01")).toBe("Aug 1, 2026");
		expect(formatDate(null)).toBe("undated");
		expect(formatDate("soon<")).toBe("soon&lt;");
	});

	it("restricts lifecycle classes to safe characters", () => {
		expect(lifecycleClass("manual-only")).toBe("lc-manual-only");
		expect(lifecycleClass(null)).toBe("lc-none");
		expect(lifecycleClass('x" onclick="y')).toBe("lc-xonclicky");
	});
});

describe("gallery rendering", () => {
	it("never emits corpus text as raw markup", () => {
		const html = galleryCards(
			[card({ name: "<script>alert(1)</script>", stack: ["<b>"] })],
			{ canAsk: true },
		);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<b>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("shows repository links and ask buttons only when available", () => {
		const linked = card({ url: "https://github.com/saagpatel/ink" });
		expect(galleryCards([linked], { canAsk: false })).toContain(
			'data-open-link="https://github.com/saagpatel/ink"',
		);
		expect(galleryCards([linked], { canAsk: false })).not.toContain("data-ask");
		expect(galleryCards([card({})], { canAsk: true })).toContain(
			'data-ask="X"',
		);
		expect(galleryCards([card({})], { canAsk: false })).not.toContain(
			"actions",
		);
		expect(galleryCards([], { canAsk: true })).toContain("No projects match");
	});

	it("filters by query and lifecycle, and sorts by name", () => {
		const base = { query: "", lifecycle: "all", sort: "recent" } as const;
		expect(
			filterCards(cards, { ...base, query: "swift" }).map((c) => c.slug),
		).toEqual(["ink"]);
		expect(filterCards(cards, { ...base, query: "CREATIVE" })).toHaveLength(1);
		expect(filterCards(cards, { ...base, lifecycle: "dormant" })).toHaveLength(
			2,
		);
		expect(filterCards(cards, { ...base, lifecycle: "none" })).toHaveLength(0);
		expect(
			filterCards(cards, { ...base, sort: "name" }).map((c) => c.name),
		).toEqual(["Ink", "mcp-trust", "Redact"]);
	});

	it("offers lifecycle chips most common first, with the active one pressed", () => {
		expect(lifecycleOptions(cards)).toEqual(["dormant", "active"]);
		const view = createTools(corpus).projectGallery();
		const controls = galleryControls(view, {
			query: "",
			lifecycle: "dormant",
			sort: "recent",
		});
		expect(controls).toMatch(/data-lifecycle="dormant" aria-pressed="true"/);
		expect(controls).toMatch(/data-lifecycle="all" aria-pressed="false"/);
		expect(galleryHeader(view)).toContain(`archive of ${view.archive.total}`);
	});
});

describe("timeline rendering", () => {
	it("adds an undeclared segment when lifecycle counts fall short of the total", () => {
		const html = archiveBar({
			total: 10,
			maintained: 0,
			tested: 0,
			ci: 0,
			shown: 0,
			stacks: [],
			lifecycle: [["active", 7]],
		});
		expect(html).toContain('style="flex-grow:7"');
		expect(html).toContain('style="flex-grow:3"');
		expect(html).toContain("undeclared <b>3</b>");
	});

	it("renders months, events and the undated list", () => {
		const view: ProjectTimelineView = {
			view: "timeline",
			title: "Project timeline",
			basis: "basis",
			generated_at: "t",
			count: 1,
			undated: ["ghost"],
			months: [
				{
					month: "2026-08",
					events: [
						{
							date: "2026-08-21",
							slug: "mcp-trust",
							name: "mcp-trust",
							lifecycle: "active",
							status: "active",
							stack: ["Python", "Rust"],
							url: null,
						},
					],
				},
			],
			archive: {
				total: 1,
				maintained: 0,
				tested: 0,
				ci: 0,
				shown: 1,
				stacks: [],
				lifecycle: [["active", 1]],
			},
		};
		const html = timelineBody(view, { canAsk: false });
		expect(html).toContain("August 2026");
		expect(html).toContain("1 project<");
		expect(html).toContain(">Aug 21<");
		expect(html).toContain("active · active · Python, Rust");
		expect(html).toContain("Undated: ghost");
	});

	it("renders the baked corpus without throwing", () => {
		const view = createTools(corpus).projectTimeline();
		expect(view.months.length).toBeGreaterThan(0);
		expect(timelineBody(view, { canAsk: true })).toContain('class="event lc-');
	});
});

describe("app HTML", () => {
	it("tags the document with its view and keeps inline code intact", () => {
		for (const view of ["gallery", "timeline"] as const) {
			const html = appHtml(view);
			expect(html).toContain(`data-view="${view}"`);
			expect(html.match(/<\/script>/g)).toHaveLength(1);
			expect(html.match(/<\/style>/g)).toHaveLength(1);
		}
	});
});
