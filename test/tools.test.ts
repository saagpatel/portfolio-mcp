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
	it("filters the full ranking before applying the result limit", () => {
		const distractors = Array.from({ length: 60 }, (_, n) => ({
			id: `notes/decoy-${n}`,
			slug: `decoy-${n}`,
			type: "note" as const,
			title: `Flywheel ${n}`,
			description: "",
			url: `https://x.dev/notes/decoy-${n}`,
			date: null,
			word_count: 12,
			body_markdown: "flywheel flywheel flywheel flywheel flywheel",
		}));
		const essay = {
			...fixture.documents["writing/a"],
			description: "flywheel",
			body_markdown: "flywheel",
		};
		const manyHits: Corpus = {
			...fixture,
			index: {
				...fixture.index,
				documents: [...fixture.index.documents, ...distractors],
			},
			documents: {
				...fixture.documents,
				[essay.id]: essay,
				...Object.fromEntries(distractors.map((doc) => [doc.id, doc])),
			},
		};
		const result = createTools(manyHits).search("flywheel", {
			section: "essay",
		});

		expect(result.results).toHaveLength(1);
		expect(result.results[0]?.id).toBe("writing/a");
	});
});

describe("getDocument", () => {
	it("returns the full doc by id", () => {
		const d = tools.getDocument("writing/a");
		expect("body_markdown" in d).toBe(true);
	});
	it("errors for an unknown id", () => {
		expect("error" in tools.getDocument("nope")).toBe(true);
		expect("error" in tools.getDocument("__proto__")).toBe(true);
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
		expect("error" in tools.getRepoProfile("__proto__")).toBe(true);
	});
});

describe("app views", () => {
	// A fixture variant where one curated project has a public repo profile and
	// the archive aggregates carry a malformed row the builder must drop.
	const githubProfile = fixture.repoProfiles?.profiles.githubrepoauditor;
	if (!githubProfile) throw new Error("fixture needs a repo profile");
	const withProfiles = createTools({
		...fixture,
		projects: {
			...fixture.projects,
			curated: {
				...fixture.projects.curated,
				githubrepoauditor: {
					stack: ["TypeScript"],
					status: "active",
					lifecycle: "active",
					last_active: "2026-06-21",
					tests: true,
					ci: false,
				},
				undated: {
					stack: [],
					status: null,
					lifecycle: null,
					last_active: null,
					tests: false,
					ci: false,
				},
			},
			archive: {
				...fixture.projects.archive,
				stacks: [["TypeScript", 9], ["bad"], 3],
				lifecycle: [
					["active", 100],
					["archived", 20],
				],
			},
		},
		repoProfiles: fixture.repoProfiles && {
			...fixture.repoProfiles,
			profiles: {
				githubrepoauditor: {
					...githubProfile,
					public_reference: "https://github.com/saagpatel/GithubRepoAuditor",
				},
				mcpforge: {
					...githubProfile,
					repo_id: "mcpforge",
					display_name: "MCPForge",
					public_reference: "javascript:alert(1)",
					summary: { ...githubProfile.summary, purpose: "unknown" },
				},
			},
		},
	});

	it("builds gallery cards joined with public profiles, newest first", () => {
		const view = withProfiles.projectGallery();
		expect(view.view).toBe("gallery");
		expect(view.cards.map((c) => c.slug)).toEqual([
			"githubrepoauditor",
			"mcpforge",
			"ghostroutes",
			"undated",
		]);
		const [auditor, forge, ghost] = view.cards;
		expect(auditor).toMatchObject({
			name: "GithubRepoAuditor",
			category: "infrastructure",
			purpose: "repo truth",
			url: "https://github.com/saagpatel/GithubRepoAuditor",
		});
		// "unknown" purpose is dropped and a non-https reference never becomes a link.
		expect(forge).toMatchObject({ name: "MCPForge", purpose: null, url: null });
		// No profile: fall back to the slug, no link.
		expect(ghost).toMatchObject({ name: "ghostroutes", url: null });
		expect(view.archive.stacks).toEqual([["TypeScript", 9]]);
	});

	it("filters the gallery by status and lifecycle", () => {
		expect(withProfiles.projectGallery({ lifecycle: "active" }).count).toBe(2);
		const archived = withProfiles.projectGallery({ status: "archived" });
		expect(archived.cards.map((c) => c.slug)).toEqual(["ghostroutes"]);
		expect(archived.filters).toEqual({ status: "archived", lifecycle: null });
		// Empty strings are no filter; "none" selects projects with no lifecycle.
		const unfiltered = withProfiles.projectGallery({
			status: "",
			lifecycle: "",
		});
		expect(unfiltered.count).toBe(4);
		expect(unfiltered.filters).toEqual({ status: null, lifecycle: null });
		const none = withProfiles.projectGallery({ lifecycle: "none" });
		expect(none.cards.map((c) => c.slug)).toEqual(["undated"]);
	});

	it("groups the timeline by last-active month and lists undated projects", () => {
		const view = withProfiles.projectTimeline();
		expect(view.view).toBe("timeline");
		expect(view.months.map((m) => m.month)).toEqual(["2026-06", "2026-01"]);
		expect(view.months[0]?.events.map((e) => e.slug)).toEqual([
			"githubrepoauditor",
			"mcpforge",
		]);
		expect(view.count).toBe(3);
		expect(view.undated).toEqual(["undated"]);
		expect(view.archive.lifecycle).toEqual([
			["active", 100],
			["archived", 20],
		]);
	});
});
