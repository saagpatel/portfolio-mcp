#!/usr/bin/env node
// Probe the live MCP endpoint: the shared protocol assertions (initialize,
// tools/list, read-only annotations) come from saagar-mcp-kit's driver; this
// script keeps only what is portfolio-specific — the expected tool set, the
// server name, and the two domain calls (search + get_operant_results).
//
// By default tools/list must match EXPECTED_TOOLS exactly, which is what the
// local smoke run and the post-deploy readback want. A branch that adds a tool
// is ahead of the live Worker until it deploys, so --allow-pending-tools lets
// expected tools be missing from the endpoint (reported as pendingTools) while
// still failing on any tool the checkout does not expect.
import {
	parseToolPayload,
	probeHttpServer,
	rpc,
} from "saagar-mcp-kit/http-probe";

const DEFAULT_ENDPOINT = "https://portfolio-mcp.saagar210.workers.dev/mcp";
const SERVER_NAME = "saagarpatel-portfolio";
export const EXPECTED_TOOLS = [
	"get_document",
	"get_operant_results",
	"get_profile",
	"get_repo_profile",
	"list_corpus",
	"list_projects",
	"list_repo_profiles",
	"play_demo",
	"search",
	"show_operant_results",
	"show_project_gallery",
	"show_project_timeline",
];

export function parseArgs(argv) {
	const out = {
		endpoint:
			globalThis.process?.env?.PORTFOLIO_MCP_ENDPOINT || DEFAULT_ENDPOINT,
		query: "verification",
		limit: 2,
		allowPendingTools: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--allow-pending-tools") {
			out.allowPendingTools = true;
			continue;
		}
		const [key, inlineValue] = arg.split("=", 2);
		const value = inlineValue ?? argv[i + 1];
		if (
			arg.startsWith("--") &&
			(value === undefined || value.startsWith("--"))
		) {
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

// Domain calls below need these live even when other tools are pending.
const REQUIRED_LIVE_TOOLS = ["search", "get_operant_results"];

/** Expected tools absent from `liveNames`; throws on unexpected or required. */
export function checkPendingTools(liveNames) {
	const live = new Set(liveNames);
	if (live.size !== liveNames.length) {
		const duplicates = liveNames.filter(
			(name, index) => liveNames.indexOf(name) !== index,
		);
		throw new Error(
			`tools/list has duplicate tool names: ${JSON.stringify([
				...new Set(duplicates),
			])}`,
		);
	}
	const unexpected = [...live].filter((name) => !EXPECTED_TOOLS.includes(name));
	if (unexpected.length > 0) {
		throw new Error(
			`tools/list has tools this checkout does not expect: ${JSON.stringify(
				unexpected.sort(),
			)}`,
		);
	}
	const pending = EXPECTED_TOOLS.filter((name) => !live.has(name));
	const missingRequired = REQUIRED_LIVE_TOOLS.filter((name) =>
		pending.includes(name),
	);
	if (missingRequired.length > 0) {
		throw new Error(
			`tools/list is missing tools the probe calls: ${JSON.stringify(
				missingRequired,
			)}`,
		);
	}
	return pending;
}

export async function probeEndpoint(endpoint = DEFAULT_ENDPOINT, options = {}) {
	const query = options.query || "verification";
	const limit = options.limit || 2;
	const allowPendingTools = options.allowPendingTools === true;

	const shared = await probeHttpServer(endpoint, {
		serverName: SERVER_NAME,
		tools: allowPendingTools ? undefined : EXPECTED_TOOLS,
		clientName: "portfolio-mcp-probe",
	});
	const pendingTools = allowPendingTools
		? checkPendingTools(shared.toolsList.tools.map((tool) => tool.name))
		: [];

	const search = await rpc(endpoint, 3, "tools/call", {
		name: "search",
		arguments: { query, limit },
	});
	const searchPayload = parseToolPayload(search.json.result, "search");
	if (
		!Array.isArray(searchPayload.results) ||
		searchPayload.results.length === 0
	) {
		throw new Error("search returned no results");
	}

	const operant = await rpc(endpoint, 4, "tools/call", {
		name: "get_operant_results",
		arguments: {},
	});
	const operantPayload = parseToolPayload(
		operant.json.result,
		"get_operant_results",
	);
	if (typeof operantPayload.available !== "boolean") {
		throw new Error("get_operant_results did not return an availability flag");
	}

	return {
		...shared,
		...(allowPendingTools ? { pendingTools } : {}),
		searchCall: {
			status: search.status,
			contentType: search.contentType,
			allowOrigin: search.allowOrigin,
			query,
			count: searchPayload.count,
			firstIds: searchPayload.results
				.slice(0, limit)
				.map((result) => result.id),
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
	if (summary.pendingTools?.length) {
		console.error(
			`note: ${summary.pendingTools.length} expected tool(s) not live yet: ${summary.pendingTools.join(", ")}`,
		);
	}
}

if (globalThis.process?.argv?.[1]?.endsWith("/probe-mcp.mjs")) {
	main().catch((err) => {
		console.error(err?.stack || err?.message || String(err));
		globalThis.process.exitCode = 1;
	});
}
