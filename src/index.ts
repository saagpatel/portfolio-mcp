// MCP server for saagarpatel.dev, hosted as a stateless Cloudflare Worker.
//
// Transport: WebStandardStreamableHTTPServerTransport (fetch-native, runs on
// Workers) in STATELESS mode (sessionIdGenerator: undefined) with JSON responses.
// A fresh McpServer + transport is built per request so no state crosses requests;
// the BM25 index lives at module scope (in `tools`), so it is built once per isolate.
//
// Read-only by design: every tool is annotated readOnlyHint, none takes a URL or
// filesystem path, and the corpus is baked into the bundle (zero runtime egress).

import {
	McpServer,
	ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { corpus } from "./corpus";
import { createTools } from "./tools";
import type { DocType } from "./types";

const tools = createTools(corpus); // builds the BM25 index once per isolate

const SERVER_INFO = { name: "saagarpatel-portfolio", version: "0.1.0" };
const SECTIONS = [
	"essay",
	"chapter",
	"note",
	"page",
] as const satisfies readonly DocType[];

const INSTRUCTIONS =
	"Read-only access to Saagar Patel's writing (essays, a book, field notes) and " +
	"projects, served from saagarpatel.dev. Start with get_profile or list_corpus to " +
	"orient, search to find by topic, and get_document to read full text.";

const jsonResult = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const first = (v: string | string[]): string =>
	Array.isArray(v) ? (v[0] ?? "") : v;

function buildServer(): McpServer {
	const server = new McpServer(SERVER_INFO, {
		capabilities: { tools: {}, resources: {} },
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

	return server;
}

const CORS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers":
		"Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Accept",
	"Access-Control-Expose-Headers": "Mcp-Session-Id",
};

export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS });
		}
		if (url.pathname !== "/mcp") {
			return Response.json(
				{
					error: "Not found",
					mcp_endpoint: "/mcp",
					site: corpus.index.site || "https://saagarpatel.dev",
				},
				{ status: 404, headers: CORS },
			);
		}

		const server = buildServer();
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined, // stateless
			enableJsonResponse: true,
		});
		await server.connect(transport);

		const res = await transport.handleRequest(request);
		const headers = new Headers(res.headers);
		for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers,
		});
	},
} satisfies ExportedHandler;
