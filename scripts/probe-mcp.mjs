#!/usr/bin/env node
// Probe the live MCP endpoint: the shared protocol assertions (initialize,
// tools/list, read-only annotations) come from saagar-mcp-kit's driver; this
// script keeps only what is portfolio-specific — the expected tool set, the
// server name, and the two domain calls (search + get_operant_results).
import { parseToolPayload, probeHttpServer, rpc } from "saagar-mcp-kit/http-probe";

const DEFAULT_ENDPOINT = "https://portfolio-mcp.saagar210.workers.dev/mcp";
const SERVER_NAME = "saagarpatel-portfolio";
const EXPECTED_TOOLS = [
	"get_document",
	"get_operant_results",
	"get_profile",
	"get_repo_profile",
	"list_corpus",
	"list_projects",
	"list_repo_profiles",
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

export async function probeEndpoint(endpoint = DEFAULT_ENDPOINT, options = {}) {
	const query = options.query || "verification";
	const limit = options.limit || 2;

	const shared = await probeHttpServer(endpoint, {
		serverName: SERVER_NAME,
		tools: EXPECTED_TOOLS,
		clientName: "portfolio-mcp-probe",
	});

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
		...shared,
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
