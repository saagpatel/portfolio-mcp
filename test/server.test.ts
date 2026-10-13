// End-to-end test of the actual Worker fetch handler driving the MCP protocol
// (stateless streamable HTTP, JSON responses). Verifies the transport wiring, the
// 8 tools, and the resources against the baked corpus.

import { describe, expect, it, vi } from "vitest";
import handler from "../src/index";

const ENDPOINT = "http://localhost/mcp";
const HEADERS = {
	"Content-Type": "application/json",
	Accept: "application/json, text/event-stream",
};

type RpcResponse = {
	result?: {
		serverInfo?: { name?: string };
		tools?: Array<{
			name: string;
			annotations?: { readOnlyHint?: boolean };
		}>;
		content?: Array<{ text: string }>;
		resources?: unknown[];
		prompts?: Array<{ name: string }>;
		messages?: Array<{ content: { text: string } }>;
	};
	error?: { code: number; message: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function resultOf(response: RpcResponse): NonNullable<RpcResponse["result"]> {
	if (!response.result) throw new Error("Expected a JSON-RPC result");
	return response.result;
}

function textPayload(response: RpcResponse): Record<string, unknown> {
	const text = resultOf(response).content?.[0]?.text;
	if (!text) throw new Error("Expected a text result");
	const parsed: unknown = JSON.parse(text);
	if (!isRecord(parsed)) throw new Error("Expected an object text result");
	return parsed;
}

async function rpc(
	body: unknown,
): Promise<{ status: number; json: RpcResponse }> {
	const res = await handler.fetch(
		new Request(ENDPOINT, {
			method: "POST",
			headers: HEADERS,
			body: JSON.stringify(body),
		}),
	);
	const text = await res.text();
	const parsed: unknown = text ? JSON.parse(text) : null;
	if (!isRecord(parsed)) throw new Error("Expected a JSON-RPC response object");
	return { status: res.status, json: parsed as RpcResponse };
}

const init = () =>
	rpc({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "test", version: "1" },
		},
	});

describe("MCP server over the Worker fetch handler", () => {
	it("rejects non-/mcp paths with 404", async () => {
		const res = await handler.fetch(
			new Request("http://localhost/", { method: "GET" }),
		);
		expect(res.status).toBe(404);
	});

	it("answers CORS preflight", async () => {
		const res = await handler.fetch(
			new Request(ENDPOINT, { method: "OPTIONS" }),
		);
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});

	it("rejects unsupported MCP methods without opening a stream", async () => {
		const res = await handler.fetch(
			new Request(ENDPOINT, {
				method: "GET",
				headers: { Accept: "text/event-stream" },
			}),
		);
		const json = (await res.json()) as { error?: string };

		expect(res.status).toBe(405);
		expect(res.headers.get("Allow")).toBe("POST, OPTIONS");
		expect(json.error).toBe("Method not allowed");
	});

	it("initializes and reports server info", async () => {
		const { status, json } = await init();
		expect(status).toBe(200);
		expect(resultOf(json).serverInfo?.name).toBe("saagarpatel-portfolio");
	});

	it("lists the 8 read-only tools", async () => {
		const { json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		const tools = json.result?.tools ?? [];
		const names = tools.map((t) => t.name).sort();
		expect(names).toEqual([
			"get_document",
			"get_operant_results",
			"get_profile",
			"get_repo_profile",
			"list_corpus",
			"list_projects",
			"list_repo_profiles",
			"search",
		]);
		expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
	});

	it("calls list_corpus and returns documents", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "list_corpus", arguments: {} },
		});
		const payload = textPayload(json);
		expect(payload.count).toBeGreaterThan(0);
		expect(Array.isArray(payload.documents)).toBe(true);
		if (!Array.isArray(payload.documents))
			throw new Error("Expected documents");
		expect(payload.documents[0]).toHaveProperty("id");
	});

	it("marks missing documents and repo profiles as tool errors", async () => {
		for (const [name, args] of [
			["get_document", { id: "__proto__" }],
			["get_repo_profile", { repoId: "__proto__" }],
		] as const) {
			const { json } = await rpc({
				jsonrpc: "2.0",
				id: 31,
				method: "tools/call",
				params: { name, arguments: args },
			});
			expect(json.result).toHaveProperty("isError", true);
		}
	});

	it("returns a protocol error for a missing resource", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 32,
			method: "resources/read",
			params: { uri: "portfolio://essays/__proto__" },
		});
		expect(json.error?.code).toBe(-32603);
	});

	it("logs unexpected Worker failures and returns a CORS JSON-RPC error", async () => {
		const error = new Error("request URL unavailable");
		const request = new Proxy(new Request(ENDPOINT), {
			get(target, property, receiver) {
				if (property === "url") throw error;
				return Reflect.get(target, property, receiver);
			},
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const response = await handler.fetch(request);
			const body = (await response.json()) as RpcResponse;
			expect(response.status).toBe(500);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
			expect(body.error?.code).toBe(-32603);
			expect(log).toHaveBeenCalledWith("MCP Worker request failed:", error);
		} finally {
			log.mockRestore();
		}
	});

	it("calls search and returns ranked hits with snippets", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "search", arguments: { query: "verification" } },
		});
		const payload = textPayload(json);
		expect(Array.isArray(payload.results)).toBe(true);
		if (!Array.isArray(payload.results))
			throw new Error("Expected search results");
		expect(payload.results.length).toBeGreaterThan(0);
		expect(payload.results[0]).toHaveProperty("snippet");
	});

	it("lists resources", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 5,
			method: "resources/list",
		});
		expect(Array.isArray(resultOf(json).resources)).toBe(true);
	});

	it("calls get_operant_results and reports availability", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 6,
			method: "tools/call",
			params: { name: "get_operant_results", arguments: {} },
		});
		const payload = textPayload(json);
		expect(payload).toHaveProperty("available");
	});

	it("calls list_repo_profiles and get_repo_profile", async () => {
		const listed = await rpc({
			jsonrpc: "2.0",
			id: 10,
			method: "tools/call",
			params: { name: "list_repo_profiles", arguments: {} },
		});
		const listPayload = textPayload(listed.json);
		expect(listPayload).toHaveProperty("available");

		const profiles = listPayload.profiles;
		const firstProfile = Array.isArray(profiles) ? profiles[0] : undefined;
		const repoId =
			isRecord(firstProfile) && typeof firstProfile.repo_id === "string"
				? firstProfile.repo_id
				: "githubrepoauditor";
		const fetched = await rpc({
			jsonrpc: "2.0",
			id: 11,
			method: "tools/call",
			params: { name: "get_repo_profile", arguments: { repoId } },
		});
		const profilePayload = textPayload(fetched.json);
		expect(profilePayload.repo_id ?? profilePayload.error).toBeTruthy();
	});

	it("lists the two prompts", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 7,
			method: "prompts/list",
		});
		const names = (resultOf(json).prompts ?? []).map((p) => p.name).sort();
		expect(names).toEqual(["introduce_saagar", "summarize_writing_on"]);
	});

	it("gets the introduce_saagar prompt", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 8,
			method: "prompts/get",
			params: { name: "introduce_saagar", arguments: {} },
		});
		expect(resultOf(json).messages?.[0]?.content.text).toContain(
			"Saagar Patel",
		);
	});

	it("gets the summarize_writing_on prompt with a topic argument", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 9,
			method: "prompts/get",
			params: {
				name: "summarize_writing_on",
				arguments: { topic: "verification" },
			},
		});
		expect(resultOf(json).messages?.[0]?.content.text.toLowerCase()).toContain(
			"verification",
		);
	});
});
