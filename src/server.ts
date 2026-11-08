// Shared MCP server core: builds the McpServer with all tools, resources, and
// prompts over the baked corpus. Transport-agnostic — index.ts wires it to a
// Cloudflare Worker (streamable HTTP) and stdio.ts wires it to a local stdio CLI.
//
// Read-only by design: every tool is annotated readOnlyHint, none takes a URL or
// filesystem path, and the corpus is baked into the bundle (zero runtime egress).

import {
	McpServer,
	ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { corpus } from "./corpus";
import { createTools } from "./tools";
import type { DocType } from "./types";
import { APP_MIME_TYPE, type AppView, appHtml } from "./ui/html";

const tools = createTools(corpus); // builds the BM25 index once per isolate

export const SERVER_INFO = { name: "saagarpatel-portfolio", version: "0.1.0" };

const SECTIONS = [
	"essay",
	"chapter",
	"note",
	"page",
] as const satisfies readonly DocType[];

const INSTRUCTIONS =
	"Read-only access to Saagar Patel's writing (essays, a book, field notes), " +
	"projects, public-safe repo profiles, and OPERANT benchmark results, served " +
	"from saagarpatel.dev. Start with get_profile or list_corpus to orient, " +
	"search to find by topic, and get_document to read full text. " +
	"show_project_gallery and show_project_timeline return the projects, and " +
	"show_operant_results the OPERANT calibration profiles with a playable demo, " +
	"as interactive views in hosts that support MCP Apps and as JSON elsewhere.";

// MCP Apps (UI extension): each app is a ui:// HTML resource; a tool points at
// it through _meta.ui.resourceUri (plus the legacy flat key older hosts read).
const APP_URIS: Record<AppView, string> = {
	gallery: "ui://portfolio/project-gallery.html",
	timeline: "ui://portfolio/project-timeline.html",
	operant: "ui://portfolio/operant-results.html",
};

// No csp domains: the apps make no network requests and load nothing remote.
const APP_RESOURCE_META = { ui: { prefersBorder: true } };

const appToolMeta = (view: AppView) => ({
	ui: { resourceUri: APP_URIS[view] },
	"ui/resourceUri": APP_URIS[view],
});

/** The same object as structuredContent (apps) and JSON text (everyone else). */
const appResult = (data: Record<string, unknown>) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	structuredContent: data,
});

const jsonResult = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	isError: typeof data === "object" && data !== null && "error" in data,
});

const first = (v: string | string[]): string =>
	Array.isArray(v) ? (v[0] ?? "") : v;

export function buildServer(): McpServer {
	const server = new McpServer(SERVER_INFO, {
		capabilities: { tools: {}, resources: {}, prompts: {} },
		instructions: INSTRUCTIONS,
	});

	// ---- tools (all read-only; no URL/path inputs) ----
	server.registerTool(
		"search",
		{
			title: "Search the writing corpus",
			description:
				"Full-text (BM25) search across essays, book chapters, field notes, and pages. " +
				"Returns ranked matches with a snippet, id, and canonical URL. Pass an id to get_document to read the full text.",
			inputSchema: {
				query: z.string().min(1).describe("Search terms"),
				section: z
					.enum(SECTIONS)
					.optional()
					.describe("Restrict to one content type"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(25)
					.optional()
					.describe("Max results (default 10)"),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ query, section, limit }) =>
			jsonResult(tools.search(query, { section, limit })),
	);

	server.registerTool(
		"get_document",
		{
			title: "Get a document",
			description:
				'Return the full Markdown of one document by id, e.g. "writing/the-handoff" or "book/preface". Get ids from search or list_corpus.',
			inputSchema: {
				id: z.string().min(1).describe('Document id, e.g. "book/preface"'),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ id }) => jsonResult(tools.getDocument(id)),
	);

	server.registerTool(
		"list_corpus",
		{
			title: "List the corpus",
			description:
				"List every document with its id, title, type, date, and word count, plus per-type counts. The table of contents for the whole site. Optionally filter by type.",
			inputSchema: {
				type: z.enum(SECTIONS).optional().describe("Filter by content type"),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ type }) => jsonResult(tools.listCorpus({ type })),
	);

	server.registerTool(
		"get_profile",
		{
			title: "Get profile",
			description:
				"Return Saagar Patel's profile: name, one-line summary, site, and the about / now / uses pages. Start here to understand who this is and what they work on.",
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async () => jsonResult(tools.getProfile()),
	);

	server.registerTool(
		"list_projects",
		{
			title: "List projects",
			description:
				"List the curated, public projects with stack, status, last-active date, and test/CI signals, plus anonymized portfolio-wide aggregates. Optionally filter by status.",
			inputSchema: {
				status: z
					.string()
					.optional()
					.describe('Filter by status, e.g. "active" or "archived"'),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Max projects"),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ status, limit }) =>
			jsonResult(tools.listProjects({ status, limit })),
	);

	server.registerTool(
		"list_repo_profiles",
		{
			title: "List repo profiles",
			description:
				"List public-safe repo answering profiles with repo id, attention state, freshness, " +
				"and proof counts. Profiles are static artifacts baked from saagarpatel.dev, not live repo health.",
			inputSchema: {
				attentionState: z
					.string()
					.optional()
					.describe(
						'Filter by attention state, e.g. "active-infra" or "decision-needed"',
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(25)
					.optional()
					.describe("Max profiles"),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ attentionState, limit }) =>
			jsonResult(tools.listRepoProfiles({ attentionState, limit })),
	);

	server.registerTool(
		"get_repo_profile",
		{
			title: "Get repo profile",
			description:
				"Return one public-safe repo answering profile by repo_id, including purpose, safe commands, " +
				"agent surfaces, proof refs, freshness, exclusions, limitations, and integrity metadata.",
			inputSchema: {
				repoId: z
					.string()
					.min(1)
					.describe('Repo profile id, e.g. "githubrepoauditor"'),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ repoId }) => jsonResult(tools.getRepoProfile(repoId)),
	);

	server.registerTool(
		"get_operant_results",
		{
			title: "Get OPERANT benchmark results",
			description:
				"Return the public, sanitized OPERANT results: per-model operator-calibration-score (OCS) " +
				"profiles, the headline figures, and the calibration-profiles (not a flat leaderboard) framing. " +
				"Sourced from the published OPERANT mirror. Returns availability=false if no dataset was baked.",
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async () => jsonResult(tools.getOperantResults()),
	);

	server.registerTool(
		"show_project_gallery",
		{
			title: "Show project gallery",
			description:
				"Show the curated public projects as a gallery of cards: name, category, stack, lifecycle, " +
				"last-active date, test/CI signals, and the public repository link, with archive-wide totals. " +
				"Hosts that support MCP Apps render it as an interactive gallery; others get the same data as JSON.",
			inputSchema: {
				status: z
					.string()
					.optional()
					.describe('Only projects with this status, e.g. "active" or "stale"'),
				lifecycle: z
					.string()
					.optional()
					.describe(
						'Only projects in this lifecycle, e.g. "active", "dormant" or "manual-only"; "none" for projects with no lifecycle',
					),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
			_meta: appToolMeta("gallery"),
		},
		async ({ status, lifecycle }) =>
			appResult(tools.projectGallery({ status, lifecycle })),
	);

	server.registerTool(
		"show_project_timeline",
		{
			title: "Show project timeline",
			description:
				"Show the curated public projects on a timeline grouped by last-active month, colored by " +
				"lifecycle, with the lifecycle breakdown of the whole archive. Hosts that support MCP Apps " +
				"render it as an interactive timeline; others get the same data as JSON.",
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: false },
			_meta: appToolMeta("timeline"),
		},
		async () => appResult(tools.projectTimeline()),
	);

	server.registerTool(
		"show_operant_results",
		{
			title: "Show OPERANT results",
			description:
				"Show the public OPERANT benchmark as calibration-profile cards (historical OCS repeats, " +
				"cross-provider TPR/FPR profiles, and the metric) with a playable demo: the reader acts as " +
				"the operator's agent on six cases and is scored with the real OCS = TPR - FPR. The rows are " +
				"historical calculations, not a leaderboard. Hosts that support MCP Apps render it as an " +
				"interactive view; others get the same data as JSON.",
			inputSchema: {
				section: z
					.enum(["profiles", "demo"])
					.optional()
					.describe('Tab to open first: "profiles" (default) or "demo"'),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
			_meta: appToolMeta("operant"),
		},
		async ({ section }) => appResult(tools.operantView(section)),
	);

	// ---- app resources: the HTML the show_* tools render in ----
	const APP_RESOURCES: Record<
		AppView,
		{ name: string; title: string; tool: string }
	> = {
		gallery: {
			name: "project-gallery-app",
			title: "Project gallery app",
			tool: "show_project_gallery",
		},
		timeline: {
			name: "project-timeline-app",
			title: "Project timeline app",
			tool: "show_project_timeline",
		},
		operant: {
			name: "operant-app",
			title: "OPERANT results app",
			tool: "show_operant_results",
		},
	};
	for (const view of ["gallery", "timeline", "operant"] as const) {
		const app = APP_RESOURCES[view];
		server.registerResource(
			app.name,
			APP_URIS[view],
			{
				title: app.title,
				description: `Interactive view for ${app.tool} (MCP Apps)`,
				mimeType: APP_MIME_TYPE,
				_meta: APP_RESOURCE_META,
			},
			async (uri) => ({
				contents: [
					{
						uri: uri.href,
						mimeType: APP_MIME_TYPE,
						text: appHtml(view),
						_meta: APP_RESOURCE_META,
					},
				],
			}),
		);
	}

	// ---- resources: each document type as a URI template, plus a profile resource ----
	const registerDocType = (
		uriPrefix: string,
		idPrefix: string,
		type: DocType,
	): void => {
		server.registerResource(
			`${type}-documents`,
			new ResourceTemplate(`portfolio://${uriPrefix}/{slug}`, {
				list: async () => ({
					resources: corpus.index.documents
						.filter((d) => d.type === type)
						.map((d) => ({
							uri: `portfolio://${uriPrefix}/${d.slug}`,
							name: d.title,
							description: d.description,
							mimeType: "text/markdown",
						})),
				}),
			}),
			{
				title: `${type} documents`,
				description: `Saagar's ${type} content as Markdown`,
			},
			async (uri, { slug }) => {
				const id = `${idPrefix}/${first(slug)}`;
				const doc = Object.hasOwn(corpus.documents, id)
					? corpus.documents[id]
					: undefined;
				if (!doc) throw new Error(`Resource not found: ${uri.href}`);
				return {
					contents: [
						{
							uri: uri.href,
							text: doc.body_markdown,
							mimeType: "text/markdown",
						},
					],
				};
			},
		);
	};
	registerDocType("essays", "writing", "essay");
	registerDocType("book", "book", "chapter");
	registerDocType("notes", "notes", "note");

	server.registerResource(
		"profile",
		"portfolio://profile",
		{
			title: "Profile",
			description: "Who Saagar is, and what he works on",
			mimeType: "application/json",
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					text: JSON.stringify(tools.getProfile(), null, 2),
					mimeType: "application/json",
				},
			],
		}),
	);

	// ---- prompts ----
	server.registerPrompt(
		"introduce_saagar",
		{
			title: "Introduce Saagar",
			description:
				"A ready-to-use prompt that introduces Saagar Patel, grounded in his profile.",
		},
		() => {
			const p = tools.getProfile();
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text:
								"Introduce Saagar Patel to someone encountering his work for the first time. " +
								"Be warm, concrete, and accurate; use only the facts below.\n\n" +
								`Name: ${p.name}\nSummary: ${p.summary}\nSite: ${p.site}\n\n` +
								`About:\n${p.about}\n\nNow:\n${p.now}`,
						},
					},
				],
			};
		},
	);

	server.registerPrompt(
		"summarize_writing_on",
		{
			title: "Summarize writing on a topic",
			description:
				"Gathers Saagar's most relevant writing on a topic and asks for a grounded, cited summary.",
			argsSchema: {
				topic: z.string().min(1).describe("The topic to summarize"),
			},
		},
		({ topic }) => {
			const found = tools.search(topic, { limit: 5 });
			const refs =
				found.results
					.map((r) => `- ${r.title} (${r.url}): ${r.snippet}`)
					.join("\n") || "(no matching pieces found)";
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text:
								`Summarize what Saagar Patel has written about "${topic}", grounded only in the ` +
								"pieces below. Cite the titles. If the topic is not covered, say so plainly.\n\n" +
								refs,
						},
					},
				],
			};
		},
	);

	return server;
}
