// Cloudflare Worker transport for the portfolio MCP server.
//
// Stateless streamable HTTP: a fresh McpServer + transport is built per request
// (the official MCP stateless pattern) so no state crosses requests. The shared
// server core (tools, resources, prompts) lives in ./server.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { corpus } from "./corpus";
import { buildServer } from "./server";

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
		if (request.method !== "POST") {
			return Response.json(
				{
					error: "Method not allowed",
					mcp_endpoint: "/mcp",
					allowed_methods: ["POST", "OPTIONS"],
				},
				{ status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } },
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
