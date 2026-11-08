import { afterEach, describe, expect, it, vi } from "vitest";
import {
	checkPendingTools,
	EXPECTED_TOOLS,
	parseArgs,
	probeEndpoint,
} from "../scripts/probe-mcp.mjs";

// Derived from the probe itself, so adding a tool never breaks these fixtures.
const ALL_TOOLS = [...EXPECTED_TOOLS];

function fakeEndpoint(liveTools) {
	return vi.fn(async (_url, init) => {
		const { id, method, params } = JSON.parse(init.body);
		let result;
		if (method === "initialize") {
			result = {
				serverInfo: { name: "saagarpatel-portfolio", version: "test" },
				protocolVersion: "2025-06-18",
			};
		} else if (method === "tools/list") {
			result = {
				tools: liveTools.map((name) => ({
					name,
					annotations: { readOnlyHint: true },
				})),
			};
		} else if (params?.name === "search") {
			result = {
				content: [
					{
						type: "text",
						text: JSON.stringify({ count: 1, results: [{ id: "a" }] }),
					},
				],
			};
		} else {
			result = {
				content: [{ type: "text", text: JSON.stringify({ available: true }) }],
			};
		}
		return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("probe-mcp", () => {
	it("parses --allow-pending-tools as a bare flag", () => {
		expect(parseArgs([]).allowPendingTools).toBe(false);
		const opts = parseArgs(["--allow-pending-tools", "--limit", "3"]);
		expect(opts.allowPendingTools).toBe(true);
		expect(opts.limit).toBe(3);
	});

	it("is strict by default, so a tool not deployed yet fails", async () => {
		vi.stubGlobal("fetch", fakeEndpoint(ALL_TOOLS.slice(0, -1)));
		await expect(probeEndpoint("http://probe.test/mcp")).rejects.toThrow(
			/tools\/list mismatch/,
		);
	});

	it("reports tools not deployed yet when pending tools are allowed", async () => {
		vi.stubGlobal("fetch", fakeEndpoint(ALL_TOOLS.slice(0, -1)));
		const summary = await probeEndpoint("http://probe.test/mcp", {
			allowPendingTools: true,
		});
		expect(summary.pendingTools).toEqual([ALL_TOOLS.at(-1)]);
		expect(summary.operantCall.available).toBe(true);
	});

	it("reports no pending tools when the live set is complete", async () => {
		vi.stubGlobal("fetch", fakeEndpoint(ALL_TOOLS));
		const summary = await probeEndpoint("http://probe.test/mcp", {
			allowPendingTools: true,
		});
		expect(summary.pendingTools).toEqual([]);
	});

	it("still fails on a live tool this checkout does not expect", () => {
		expect(() => checkPendingTools([...ALL_TOOLS, "drop_tables"])).toThrow(
			/does not expect: \["drop_tables"\]/,
		);
	});

	it("still fails when a tool the probe calls is missing", () => {
		expect(() =>
			checkPendingTools(ALL_TOOLS.filter((name) => name !== "search")),
		).toThrow(/missing tools the probe calls: \["search"\]/);
	});

	it("still fails when a live tool is listed twice", () => {
		expect(() => checkPendingTools([...ALL_TOOLS, "search"])).toThrow(
			/duplicate tool names: \["search"\]/,
		);
	});
});
