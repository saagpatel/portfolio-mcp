#!/usr/bin/env node
const DEFAULT_ENDPOINT = "https://portfolio-mcp.saagar210.workers.dev/mcp";
const EXPECTED_TOOLS = [
	"get_document",
	"get_operant_results",
	"get_profile",
	"list_corpus",
	"list_projects",
	"search",
];

function parseArgs(argv) {
	const out = {
		endpoint: globalThis.process?.env?.PORTFOLIO_MCP_ENDPOINT || DEFAULT_ENDPOINT,
		query: "verification",
		limit: 2,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const [key, inlineValue] = arg.split("=", 2);
		const value = inlineValue ?? argv[i + 1];
		if (arg.startsWith("--") && (value === undefined || value.startsWith("--"))) {
			throw new Error(`missing value for ${key}`);
		}
		if (inlineValue === undefined && arg.startsWith("--")) i += 1;
		if (key === "--endpoint") out.endpoint = value;
		else if (key === "--query") out.query = value;
		else if (key === "--limit") out.limit = Number(value);
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (!Number.isFinite(out.limit) || out.limit < 1) {
		throw new Error("--limit must be a positive number");
	}
	return out;
}

async function rpc(endpoint, id, method, params) {
	const res = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id,
			method,
			...(params === undefined ? {} : { params }),
		}),
	});
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch (err) {
		throw new Error(
			`${method} returned non-JSON HTTP ${res.status}: ${text.slice(0, 300)}`,
			{ cause: err },
		);
	}
	if (res.status !== 200) {
		throw new Error(`${method} returned HTTP ${res.status}: ${text.slice(0, 300)}`);
	}
	if (json.error) {
		throw new Error(`${method} JSON-RPC error: ${JSON.stringify(json.error)}`);
	}
	return {
		status: res.status,
		contentType: res.headers.get("content-type"),
		allowOrigin: res.headers.get("access-control-allow-origin"),
		json,
	};
}

function assertSame(actual, expected, label) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${label} mismatch: expected ${e}, got ${a}`);
}

function parseToolPayload(result, label) {
	const text = result?.content?.[0]?.text;
	if (typeof text !== "string") throw new Error(`${label} returned no text payload`);
	return JSON.parse(text);
}

export async function probeEndpoint(endpoint = DEFAULT_ENDPOINT, options = {}) {
	const query = options.query || "verification";
	const limit = options.limit || 2;

	const initialize = await rpc(endpoint, 1, "initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "portfolio-mcp-probe", version: "1.0.0" },
	});
	if (initialize.json.result?.serverInfo?.name !== "saagarpatel-portfolio") {
		throw new Error("initialize did not return the expected server name");
	}

	const toolsList = await rpc(endpoint, 2, "tools/list");
	const tools = toolsList.json.result?.tools || [];
	const toolNames = tools.map((tool) => tool.name).sort();
	assertSame(toolNames, EXPECTED_TOOLS, "tools/list");
	if (!tools.every((tool) => tool.annotations?.readOnlyHint === true)) {
		throw new Error("not every tool is annotated readOnlyHint=true");
	}

	const search = await rpc(endpoint, 3, "tools/call", {
		name: "search",
		arguments: { query, limit },
	});
	const searchPayload = parseToolPayload(search.json.result, "search");
	if (!Array.isArray(searchPayload.results) || searchPayload.results.length === 0) {
		throw new Error("search returned no results");
	}

	const operant = await rpc(endpoint, 4, "tools/call", {
		name: "get_operant_results",
		arguments: {},
	});
	const operantPayload = parseToolPayload(operant.json.result, "get_operant_results");
	if (typeof operantPayload.available !== "boolean") {
		throw new Error("get_operant_results did not return an availability flag");
	}

	return {
		endpoint,
		initialize: {
			status: initialize.status,
			contentType: initialize.contentType,
			allowOrigin: initialize.allowOrigin,
			serverInfo: initialize.json.result.serverInfo,
			protocolVersion: initialize.json.result.protocolVersion,
		},
		toolsList: {
			status: toolsList.status,
			contentType: toolsList.contentType,
			allowOrigin: toolsList.allowOrigin,
			count: tools.length,
			tools: tools.map((tool) => ({
				name: tool.name,
				readOnly: tool.annotations?.readOnlyHint === true,
			})),
		},
		searchCall: {
			status: search.status,
			contentType: search.contentType,
			allowOrigin: search.allowOrigin,
			query,
			count: searchPayload.count,
			firstIds: searchPayload.results.slice(0, limit).map((result) => result.id),
		},
		operantCall: {
			status: operant.status,
			contentType: operant.contentType,
			allowOrigin: operant.allowOrigin,
			available: operantPayload.available,
		},
	};
}

async function main() {
	const argv = globalThis.process?.argv?.slice(2) || [];
	const options = parseArgs(argv);
	const summary = await probeEndpoint(options.endpoint, options);
	console.log(JSON.stringify(summary, null, 2));
}

if (globalThis.process?.argv?.[1]?.endsWith("/probe-mcp.mjs")) {
	main().catch((err) => {
		console.error(err?.stack || err?.message || String(err));
		globalThis.process.exitCode = 1;
	});
}
