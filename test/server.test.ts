// End-to-end test of the actual Worker fetch handler driving the MCP protocol
// (stateless streamable HTTP, JSON responses). Verifies the transport wiring, the
// 8 tools, and the resources against the baked corpus.

import { describe, expect, it } from "vitest";
import handler from "../src/index";

const ENDPOINT = "http://localhost/mcp";
const HEADERS = {
	"Content-Type": "application/json",
	Accept: "application/json, text/event-stream",
};

async function rpc(body: unknown): Promise<{ status: number; json: any }> {
	const res = await handler.fetch(
		new Request(ENDPOINT, {
			method: "POST",
			headers: HEADERS,
			body: JSON.stringify(body),
		}),
	);
	const text = await res.text();
	return { status: res.status, json: text ? JSON.parse(text) : null };
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
		expect(json.result.serverInfo.name).toBe("saagarpatel-portfolio");
	});

	it("lists the 8 read-only tools", async () => {
		const { json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		const names = (
			json.result.tools as Array<{
				name: string;
				annotations?: { readOnlyHint?: boolean };
			}>
		)
			.map((t) => t.name)
			.sort();
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
		expect(
			json.result.tools.every((t: any) => t.annotations?.readOnlyHint === true),
		).toBe(true);
	});

	it("calls list_corpus and returns documents", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "list_corpus", arguments: {} },
		});
		const payload = JSON.parse(json.result.content[0].text);
		expect(payload.count).toBeGreaterThan(0);
		expect(payload.documents[0]).toHaveProperty("id");
	});

	it("calls search and returns ranked hits with snippets", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "search", arguments: { query: "verification" } },
		});
		const payload = JSON.parse(json.result.content[0].text);
		expect(payload.results.length).toBeGreaterThan(0);
		expect(payload.results[0]).toHaveProperty("snippet");
	});

	it("lists resources", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 5,
			method: "resources/list",
		});
		expect(Array.isArray(json.result.resources)).toBe(true);
	});

	it("calls get_operant_results and reports availability", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 6,
			method: "tools/call",
			params: { name: "get_operant_results", arguments: {} },
		});
		const payload = JSON.parse(json.result.content[0].text);
		expect(payload).toHaveProperty("available");
	});

	it("calls list_repo_profiles and get_repo_profile", async () => {
		const listed = await rpc({
			jsonrpc: "2.0",
			id: 10,
			method: "tools/call",
			params: { name: "list_repo_profiles", arguments: {} },
		});
		const listPayload = JSON.parse(listed.json.result.content[0].text);
		expect(listPayload).toHaveProperty("available");

		const repoId = listPayload.profiles?.[0]?.repo_id ?? "githubrepoauditor";
		const fetched = await rpc({
			jsonrpc: "2.0",
			id: 11,
			method: "tools/call",
			params: { name: "get_repo_profile", arguments: { repoId } },
		});
		const profilePayload = JSON.parse(fetched.json.result.content[0].text);
		expect(profilePayload.repo_id ?? profilePayload.error).toBeTruthy();
	});

	it("lists the two prompts", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 7,
			method: "prompts/list",
		});
		const names = (json.result.prompts as Array<{ name: string }>)
			.map((p) => p.name)
			.sort();
		expect(names).toEqual(["introduce_saagar", "summarize_writing_on"]);
	});

	it("gets the introduce_saagar prompt", async () => {
		const { json } = await rpc({
			jsonrpc: "2.0",
			id: 8,
			method: "prompts/get",
			params: { name: "introduce_saagar", arguments: {} },
		});
		expect(json.result.messages[0].content.text).toContain("Saagar Patel");
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
		expect(json.result.messages[0].content.text.toLowerCase()).toContain(
			"verification",
		);
	});
});
