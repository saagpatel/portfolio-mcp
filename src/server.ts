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
	"projects, and OPERANT benchmark results, served from saagarpatel.dev. Start " +
	"with get_profile or list_corpus to orient, search to find by topic, and " +
	"get_document to read full text.";

const jsonResult = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
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
				"Full-text (BM25) search across all essays, book chapters, and field notes. " +
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
				const doc = corpus.documents[`${idPrefix}/${first(slug)}`];
				return {
					contents: doc
						? [
								{
									uri: uri.href,
									text: doc.body_markdown,
									mimeType: "text/markdown",
								},
							]
						: [],
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
