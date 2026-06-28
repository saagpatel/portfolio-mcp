import { describe, expect, it } from "vitest";
import { createTools } from "../src/tools";
import type { Corpus } from "../src/types";

const fixture: Corpus = {
	index: {
		site: "https://x.dev",
		title: "Saagar",
		summary: "a workshop",
		generated: "2026-06-20",
		counts: { essay: 1, note: 1, page: 1 },
		documents: [
			{
				id: "writing/a",
				slug: "a",
				type: "essay",
				title: "Verification Capital",
				description: "d1",
				url: "https://x.dev/writing/a",
				date: "2026-06-01",
				word_count: 5,
			},
			{
				id: "notes/b",
				slug: "b",
				type: "note",
				title: "Flywheel",
				description: "d2",
				url: "https://x.dev/notes/b",
				date: null,
				word_count: 3,
			},
			{
				id: "about/index",
				slug: "index",
				type: "page",
				title: "About",
				description: "about me",
				url: "https://x.dev/about",
				date: "2026-06-01",
				word_count: 4,
			},
		],
	},
	documents: {
		"writing/a": {
			id: "writing/a",
			slug: "a",
			type: "essay",
			title: "Verification Capital",
			description: "d1",
			url: "https://x.dev/writing/a",
			date: "2026-06-01",
			word_count: 5,
			body_markdown: "verification is the scarce resource",
		},
		"notes/b": {
			id: "notes/b",
			slug: "b",
			type: "note",
			title: "Flywheel",
			description: "d2",
			url: "https://x.dev/notes/b",
			date: null,
			word_count: 3,
			body_markdown: "a build flywheel of checks",
		},
		"about/index": {
			id: "about/index",
			slug: "index",
			type: "page",
			title: "About",
			description: "about me",
			url: "https://x.dev/about",
			date: "2026-06-01",
			word_count: 4,
			body_markdown: "I build agent systems",
		},
	},
	projects: {
		generated_at: "t",
		source_schema_version: "0.6.0",
		public: true,
		curated: {
			mcpforge: {
				stack: ["python"],
				status: "active",
				lifecycle: "active",
				last_active: "2026-06-19",
				tests: true,
				ci: true,
			},
			ghostroutes: {
				stack: ["go"],
				status: "archived",
				lifecycle: "archived",
				last_active: "2026-01-01",
				tests: true,
				ci: true,
			},
		},
		archive: {
			total: 137,
			maintained: 117,
			tested: 110,
			ci: 103,
			shown: 32,
			stacks: [],
			lifecycle: [],
		},
	},
	repoProfiles: {
		index: {
			schema_version: "repo-profile-index/v0.1",
			generated_at: "2026-06-28T00:00:00Z",
			source: "fixture",
			profile_count: 1,
			profiles: [
				{
					repo_id: "githubrepoauditor",
					display_name: "GithubRepoAuditor",
					public_reference: "https://github.com/saagpatel/GithubRepoAuditor",
					attention_state: "active-infra",
					context_quality: "standard",
					freshness_status: "fresh",
					profile_json: "githubrepoauditor.json",
					receipt_count: 1,
					pending_proof_count: 0,
				},
			],
			public_safety: {
				policy: "Names only public-approved pilot repos.",
				excluded_categories: ["secrets"],
			},
		},
		profiles: {
			githubrepoauditor: {
				schema_version: "repo-profile/v0.1",
				repo_id: "githubrepoauditor",
				display_name: "GithubRepoAuditor",
				public_reference: "https://github.com/saagpatel/GithubRepoAuditor",
				visibility: { status: "public_allowlisted" },
				summary: {
					purpose: "repo truth",
					category: "infrastructure",
					attention_state: "active-infra",
					context_quality: "standard",
					risk_tier: "low",
				},
				owner_boundary: {},
				runbook: {},
				agent_surfaces: {},
				proof_refs: [{ status: "available", receipt_id: "tr_fixture" }],
				freshness: { status: "fresh" },
				excluded_data: [{ category: "secrets", reason: "not emitted" }],
				limitations: ["Not a live health guarantee."],
				integrity: { payload_sha256: "abc" },
			},
		},
	},
};

const tools = createTools(fixture);

describe("search", () => {
	it("finds the essay by body content, with a snippet", () => {
		const r = tools.search("verification");
		expect(r.results[0]?.id).toBe("writing/a");
		expect(r.results[0]?.snippet).toContain("verification");
	});
	it("filters by section", () => {
		const r = tools.search("flywheel", { section: "essay" });
		expect(r.results.every((x) => x.type === "essay")).toBe(true);
	});
});

describe("getDocument", () => {
	it("returns the full doc by id", () => {
		const d = tools.getDocument("writing/a");
		expect("body_markdown" in d).toBe(true);
	});
	it("errors for an unknown id", () => {
		expect("error" in tools.getDocument("nope")).toBe(true);
	});
});

describe("listCorpus", () => {
	it("lists all, then filters by type", () => {
		expect(tools.listCorpus().count).toBe(3);
		expect(tools.listCorpus({ type: "note" }).count).toBe(1);
	});
});

describe("getProfile", () => {
	it("pulls name + about body", () => {
		const p = tools.getProfile();
		expect(p.name).toBe("Saagar");
		expect(p.about).toContain("agent systems");
	});
});

describe("listProjects", () => {
	it("lists curated, filters by status, exposes archive aggregates", () => {
		expect(tools.listProjects().count).toBe(2);
		expect(tools.listProjects({ status: "archived" }).count).toBe(1);
		expect(tools.listProjects().archive.total).toBe(137);
	});
});

describe("repo profile tools", () => {
	it("lists repo profiles and filters by attention state", () => {
		const listed = tools.listRepoProfiles({ attentionState: "active-infra" });
		expect(listed.available).toBe(true);
		if (listed.available) {
			expect(listed.count).toBe(1);
			expect(listed.profiles[0]?.repo_id).toBe("githubrepoauditor");
			expect(listed.public_safety.excluded_categories).toContain("secrets");
		}
	});

	it("gets a repo profile by id and errors for an unknown id", () => {
		const profile = tools.getRepoProfile("githubrepoauditor");
		expect("repo_id" in profile && profile.repo_id).toBe("githubrepoauditor");
		expect("error" in tools.getRepoProfile("missing")).toBe(true);
	});
});
