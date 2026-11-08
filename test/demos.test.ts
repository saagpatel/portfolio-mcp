import { describe, expect, it } from "vitest";
import { corpus } from "../src/corpus";
import {
	demoView,
	parseExhibits,
	plain,
	sectionParagraphs,
} from "../src/demos";
import type { Corpus } from "../src/types";
import {
	contentHash,
	controlName,
	demoBody,
	museumOptions,
	SCHEDULES,
	scheduleProbability,
	simulateSchedule,
} from "../src/ui/render";

const initial = { content: "baseline content", version: 1 };

describe("Interleaving Explorer model", () => {
	it("reproduces the page's account of the six schedules", () => {
		const outcomes = (mode: "warn" | "enforce") =>
			Object.fromEntries(
				SCHEDULES.map((s) => [s, simulateSchedule(s, mode, initial).outcome]),
			);
		// Warn: both read the same version and the CAS writer commits first
		// (ABBA, BABA) -> lost update; the blind write lands first (ABAB, BAAB)
		// -> honest rejection by luck; sequential runs are clean.
		expect(outcomes("warn")).toEqual({
			AABB: "clean",
			ABAB: "rejected",
			ABBA: "lost-update",
			BAAB: "rejected",
			BABA: "lost-update",
			BBAA: "clean",
		});
		// Enforce: the blind write is always refused, so nothing is ever lost.
		expect(
			SCHEDULES.every((s) => !simulateSchedule(s, "enforce", initial).lost),
		).toBe(true);
	});

	it("tells both writers ok on a lost update and files a hash receipt", () => {
		const run = simulateSchedule("ABBA", "warn", initial);
		expect(run.told).toEqual({ A: true, B: true });
		const receipt = run.steps.find((s) => s.receipt)?.receipt;
		expect(receipt?.kind).toBe("blind-overwrite");
		// It displaced B's committed content, and names that content's hash.
		expect(receipt?.text).toContain(contentHash("Writer B's update"));
		expect(run.steps.at(-1)?.row).toEqual({
			content: "Writer A's update",
			version: 3,
		});
	});

	it("refuses the blind write in enforce mode and lets the CAS write commit", () => {
		const run = simulateSchedule("ABBA", "enforce", initial);
		expect(run.told).toEqual({ A: false, B: true });
		expect(run.steps.at(-1)?.row).toEqual({
			content: "Writer B's update",
			version: 2,
		});
	});

	it("weights schedules for a fair-coin scheduler", () => {
		const total = SCHEDULES.reduce((sum, s) => sum + scheduleProbability(s), 0);
		expect(total).toBeCloseTo(1);
		expect(scheduleProbability("AABB")).toBe(0.25);
		expect(scheduleProbability("ABBA")).toBe(0.125);
		const lostWarn = SCHEDULES.filter(
			(s) => simulateSchedule(s, "warn", initial).lost,
		).reduce((sum, s) => sum + scheduleProbability(s), 0);
		expect(lostWarn).toBe(0.25);
	});

	it("hashes content deterministically", () => {
		expect(contentHash("baseline content")).toBe(
			contentHash("baseline content"),
		);
		expect(contentHash("a")).not.toBe(contentHash("b"));
		expect(contentHash("x")).toMatch(/^[0-9a-f]{8}$/);
	});
});

describe("Interleaving Explorer rendering", () => {
	it("renders the run, its receipt, and all six schedules from the corpus page", () => {
		const view = demoView(corpus, "interleaving");
		const html = demoBody(view, {
			il: { schedule: "ABBA", mode: "warn", step: 4 },
			museum: { round: 0, answers: {} },
		});
		expect(html).toContain("Lost update.");
		expect(html).toContain("A.r → B.r → B.w → A.w");
		expect(html.match(/<tr[ >]/g)).toHaveLength(7); // header + six schedules
		expect(html).toContain("blind-overwrite");
		expect(html).toContain("warn mode loses B's update in 25% of runs");
		expect(html).toContain("seventeen of thirty seeds");
	});
});

describe("demo views from the corpus", () => {
	it("builds the Interleaving Explorer from its page text", () => {
		const view = demoView(corpus, "interleaving");
		if (!view.available || view.demo !== "interleaving") {
			throw new Error("expected the interleaving demo");
		}
		expect(view.url).toBe("https://saagarpatel.dev/interleaving-explorer");
		expect(view.intro[0]).toMatch(/^Two agents\. One database row\./);
		expect(view.sweep).toContain("seventeen of thirty seeds");
		expect(view.receipt).toContain("nothing loses quietly");
		expect(view.small_print).toContain("read/write granularity");
	});

	it("parses all seven museum exhibits with their categories", () => {
		const view = demoView(corpus, "failure-museum");
		if (!view.available || view.demo !== "failure-museum") {
			throw new Error("expected the museum demo");
		}
		expect(view.exhibits.map((e) => e.category)).toEqual([
			"Memory",
			"Tools",
			"Tools",
			"Calibration",
			"Evidence",
			"Privacy",
			"Evals",
		]);
		expect(view.exhibits[0]).toMatchObject({
			title: "Stale Handoff Accepted as Truth",
			control: expect.stringMatching(/^Freshness reconciliation: /),
		});
		expect(view.fixture_rule).toMatch(/^Fixture rule: every exhibit/);
	});

	it("reports missing pages instead of inventing a demo", () => {
		const empty: Corpus = { ...corpus, documents: {} };
		expect(demoView(empty, "interleaving")).toMatchObject({ available: false });
		expect(demoView(empty, "failure-museum")).toMatchObject({
			available: false,
		});
	});

	it("parses exhibit fields and sections from markdown", () => {
		const body = [
			"Lead paragraph with [a link](/x) and **bold**.",
			"",
			"Second lead.",
			"",
			" Memory",
			"",
			"## Exhibit one",
			"**Synthetic failure**",
			"It fails.",
			"### Why it is tempting",
			"It is easy.",
			"### What goes wrong",
			"It breaks.",
			"**Control that catches it**",
			"Check: look.",
			"**Still uncertain**",
			"Maybe.",
			"",
			"## Not an exhibit",
			"Prose only.",
		].join("\n");
		expect(sectionParagraphs(body, null)).toEqual([
			"Lead paragraph with a link and bold.",
			"Second lead.",
			"Memory",
		]);
		expect(sectionParagraphs(body, "Not an exhibit")).toEqual(["Prose only."]);
		expect(parseExhibits(body)).toEqual([
			{
				category: "Memory",
				title: "Exhibit one",
				failure: "It fails.",
				tempting: "It is easy.",
				wrong: "It breaks.",
				control: "Check: look.",
				uncertain: "Maybe.",
			},
		]);
		expect(plain("`x` *y*  z")).toBe("x y z");
		// CRLF, trailing spaces after a heading, and a heading on the first line.
		expect(
			sectionParagraphs(
				"## First\r\nOne.\r\n\r\n## Second  \r\nTwo.",
				"Second",
			),
		).toEqual(["Two."]);
		expect(sectionParagraphs("## First\nOne.", "First")).toEqual(["One."]);
	});
});

describe("museum game", () => {
	it("offers three distinct controls including the right one, every round", () => {
		for (const n of [3, 4, 7]) {
			for (let round = 0; round < n; round++) {
				const options = museumOptions(n, round);
				expect(new Set(options).size).toBe(3);
				expect(options).toContain(round);
				expect(options.every((i) => i >= 0 && i < n)).toBe(true);
			}
		}
		expect(museumOptions(2, 0)).toEqual([]);
	});

	it("names a control by its label or first sentence", () => {
		expect(controlName("Freshness reconciliation: compare things.")).toBe(
			"Freshness reconciliation",
		);
		expect(controlName("MCPAudit inventories surfaces. More here.")).toBe(
			"MCPAudit inventories surfaces.",
		);
	});

	it("renders a round, a verdict, and escapes corpus text", () => {
		const view = demoView(corpus, "failure-museum");
		const fresh = demoBody(view, {
			il: { schedule: "ABBA", mode: "warn", step: 0 },
			museum: { round: 0, answers: {} },
		});
		expect(fresh).toContain("Exhibit 1 of 7");
		expect(fresh.match(/data-mu-choice=/g)).toHaveLength(3);
		const answered = demoBody(view, {
			il: { schedule: "ABBA", mode: "warn", step: 0 },
			museum: { round: 0, answers: { 0: 0 } },
		});
		expect(answered).toContain("Caught.");
		expect(answered).toContain("Still uncertain:");
		expect(
			demoBody(
				{
					view: "demo",
					demo: "interleaving",
					available: false,
					note: "No <b>",
				},
				{
					il: { schedule: "ABBA", mode: "warn", step: 0 },
					museum: { round: 0, answers: {} },
				},
			),
		).toBe('<p class="empty">No &lt;b&gt;</p>');
	});
});
