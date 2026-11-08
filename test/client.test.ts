// @vitest-environment happy-dom
// The iframe side of the MCP Apps protocol, driven the way a host drives it:
// postMessage JSON-RPC from window.parent. Type-checked by tsconfig.ui.json.

import { afterEach, describe, expect, it } from "vitest";
import type { GalleryCard, ProjectGalleryView } from "../src/types";
import { startApp } from "../src/ui/client";

type Sent = {
	jsonrpc: string;
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code: number; message: string };
};

const realParent = window.parent;
let stop: (() => void) | null = null;

afterEach(() => {
	stop?.();
	stop = null;
	Object.defineProperty(window, "parent", {
		value: realParent,
		configurable: true,
	});
});

const card = (slug: string, lifecycle: string | null): GalleryCard => ({
	slug,
	name: slug,
	category: null,
	purpose: null,
	stack: [],
	status: null,
	lifecycle,
	last_active: "2026-08-01",
	tests: true,
	ci: true,
	url: `https://github.com/example/${slug}`,
});

const galleryView = (cards: GalleryCard[]): ProjectGalleryView => ({
	view: "gallery",
	generated_at: "t",
	filters: { status: null, lifecycle: null },
	count: cards.length,
	cards,
	archive: {
		total: 10,
		maintained: 1,
		tested: 2,
		ci: 3,
		shown: cards.length,
		stacks: [],
		lifecycle: [],
	},
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Start the app inside a fake host frame and complete the handshake. */
async function boot(hostCapabilities: Record<string, unknown> = {}) {
	document.documentElement.removeAttribute("data-theme");
	document.body.innerHTML = '<main id="app"></main>';
	const sent: Sent[] = [];
	const parent = {
		postMessage: (message: Sent) => {
			sent.push(message);
		},
	};
	Object.defineProperty(window, "parent", {
		value: parent,
		configurable: true,
	});
	const fromHost = (data: unknown, source: unknown = parent) =>
		window.dispatchEvent(
			new MessageEvent("message", {
				data,
				source: source as MessageEventSource,
			}),
		);

	stop = startApp();
	const init = sent.find((m) => m.method === "ui/initialize");
	if (init?.id === undefined) throw new Error("no ui/initialize request");
	fromHost({
		jsonrpc: "2.0",
		id: init.id,
		result: {
			protocolVersion: "2026-01-26",
			hostInfo: { name: "test-host", version: "0" },
			hostCapabilities,
			hostContext: { theme: "dark" },
		},
	});
	await flush();
	return { sent, init, fromHost };
}

const toolResult = (structuredContent: unknown) => ({
	jsonrpc: "2.0",
	method: "ui/notifications/tool-result",
	params: { content: [], structuredContent },
});

const app = () => document.getElementById("app");

describe("MCP App client", () => {
	it("initializes with the spec version, applies the host theme, then reports initialized", async () => {
		const { sent, init } = await boot();
		expect(init.params?.protocolVersion).toBe("2026-01-26");
		expect(init.params?.appInfo).toEqual({
			name: "portfolio-explorer",
			version: "0.1.0",
		});
		expect(document.documentElement.dataset.theme).toBe("dark");
		expect(sent.some((m) => m.method === "ui/notifications/initialized")).toBe(
			true,
		);
	});

	it("renders a gallery from structuredContent", async () => {
		const { fromHost } = await boot();
		fromHost(toolResult(galleryView([card("ink", "dormant")])));
		expect(app()?.querySelector("h1")?.textContent).toBe("Projects");
		expect(document.getElementById("shown")?.textContent).toBe("1 of 1");
	});

	it("falls back to the JSON text block when structuredContent is missing", async () => {
		const { fromHost } = await boot();
		fromHost({
			jsonrpc: "2.0",
			method: "ui/notifications/tool-result",
			params: {
				content: [
					{ type: "text", text: "not json" },
					{
						type: "text",
						text: JSON.stringify(
							galleryView([card("a", null), card("b", null)]),
						),
					},
				],
			},
		});
		expect(document.getElementById("shown")?.textContent).toBe("2 of 2");
	});

	it("ignores messages that do not come from the parent frame", async () => {
		const { fromHost } = await boot();
		fromHost(toolResult(galleryView([card("ink", null)])), window);
		expect(app()?.querySelector("h1")).toBeNull();
	});

	it("answers ping, and rejects unknown requests with method-not-found", async () => {
		const { sent, fromHost } = await boot();
		fromHost({ jsonrpc: "2.0", id: 90, method: "ping" });
		fromHost({ jsonrpc: "2.0", id: 91, method: "ui/does-not-exist" });
		fromHost({ jsonrpc: "2.0", method: "ui/notifications/unknown" });
		expect(sent.find((m) => m.id === 90)?.result).toEqual({});
		expect(sent.find((m) => m.id === 91)?.error?.code).toBe(-32601);
		expect(sent.filter((m) => m.id === undefined && !m.method)).toHaveLength(0);
	});

	it("offers Ask only with the message capability, and sends ui/message", async () => {
		const plain = await boot({});
		plain.fromHost(toolResult(galleryView([card("ink", null)])));
		expect(document.querySelector("[data-ask]")).toBeNull();
		stop?.();

		const { sent, fromHost } = await boot({ message: { text: {} } });
		fromHost(toolResult(galleryView([card("ink", null)])));
		const askButton = document.querySelector<HTMLElement>("[data-ask]");
		askButton?.click();
		const message = sent.find((m) => m.method === "ui/message");
		expect(message?.params?.role).toBe("user");
		expect(JSON.stringify(message?.params?.content)).toContain("ink");
	});

	it("opens repository links through ui/open-link when the host supports it", async () => {
		const { sent, fromHost } = await boot({ openLinks: {} });
		fromHost(toolResult(galleryView([card("ink", null)])));
		document.querySelector<HTMLElement>("[data-open-link]")?.click();
		expect(sent.find((m) => m.method === "ui/open-link")?.params).toEqual({
			url: "https://github.com/example/ink",
		});
	});

	it("filters with chips, and a new tool result resets the filter", async () => {
		const { fromHost } = await boot();
		const cards = [
			card("a", "active"),
			card("b", "dormant"),
			card("c", "dormant"),
		];
		fromHost(toolResult(galleryView(cards)));
		document.querySelector<HTMLElement>('[data-lifecycle="dormant"]')?.click();
		expect(document.getElementById("shown")?.textContent).toBe("2 of 3");

		fromHost(toolResult(galleryView(cards)));
		expect(document.getElementById("shown")?.textContent).toBe("3 of 3");
		expect(
			document
				.querySelector('[data-lifecycle="all"]')
				?.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("applies host context changes after startup", async () => {
		const { fromHost } = await boot();
		fromHost({
			jsonrpc: "2.0",
			method: "ui/notifications/host-context-changed",
			params: {
				theme: "light",
				styles: {
					variables: {
						"--color-text-primary": "#123456",
						"not-a-var": "red",
					},
				},
			},
		});
		const root = document.documentElement;
		expect(root.dataset.theme).toBe("light");
		expect(root.style.getPropertyValue("--color-text-primary")).toBe("#123456");
		expect(root.style.getPropertyValue("not-a-var")).toBe("");
	});

	it("shows a note and sends nothing when opened outside a host frame", () => {
		document.body.innerHTML = '<main id="app"></main>';
		expect(window.parent).toBe(window);
		const posted: unknown[] = [];
		const realPost = window.postMessage;
		window.postMessage = ((message: unknown) => {
			posted.push(message);
		}) as typeof window.postMessage;
		try {
			stop = startApp();
		} finally {
			window.postMessage = realPost;
		}
		expect(app()?.textContent).toContain("renders inside an MCP host");
		expect(posted).toEqual([]);
	});

	it("leaves the document alone when stopped before the handshake finishes", async () => {
		document.body.innerHTML = '<main id="app"></main>';
		const parent = { postMessage: () => {} };
		Object.defineProperty(window, "parent", {
			value: parent,
			configurable: true,
		});
		const first = startApp();
		first(); // rejects the pending ui/initialize
		const appRoot = app();
		if (appRoot) appRoot.innerHTML = "<p>replacement</p>";
		await flush();
		expect(app()?.textContent).toBe("replacement");
	});
});
