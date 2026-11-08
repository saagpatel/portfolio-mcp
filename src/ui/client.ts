// The in-iframe side of the MCP Apps protocol (ui/* JSON-RPC over postMessage),
// written against the 2026-01-26 apps spec without the ext-apps SDK so the
// bundle stays small and dependency-free. scripts/build-ui.mjs bundles this
// file (through src/ui/main.ts) into src/ui/app.generated.ts; the server
// inlines it into the app HTML. startApp() returns a stop function so tests can
// run it repeatedly against a fresh document.
//
// Flow: ui/initialize -> host context (theme, styles, capabilities) ->
// ui/notifications/initialized -> host sends ui/notifications/tool-result with
// the tool's structuredContent -> render. The app makes no network requests.

import type {
	GalleryCard,
	ProjectGalleryView,
	ProjectTimelineView,
} from "../types";
import {
	filterCards,
	type GallerySort,
	type GalleryState,
	galleryCards,
	galleryControls,
	galleryHeader,
	type RenderOptions,
	timelineBody,
} from "./render";

const PROTOCOL_VERSION = "2026-01-26";
const APP_INFO = { name: "portfolio-explorer", version: "0.1.0" };

type JsonRpcMessage = {
	jsonrpc?: string;
	id?: string | number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
};

type HostContext = {
	theme?: unknown;
	styles?: { variables?: Record<string, unknown>; css?: { fonts?: unknown } };
	displayMode?: unknown;
};

type HostCapabilities = {
	openLinks?: object;
	message?: object;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Attach the app to the current document and start the host handshake. */
export function startApp(): () => void {
	const root = document.getElementById("app");
	const viewKind = document.documentElement.dataset.view ?? "gallery";
	let capabilities: HostCapabilities = {};
	let nextId = 1;
	const pending = new Map<
		string | number,
		{ resolve: (v: unknown) => void; reject: (e: Error) => void }
	>();

	function post(message: JsonRpcMessage): void {
		window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
	}

	function request(method: string, params: unknown): Promise<unknown> {
		const id = nextId++;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			post({ id, method, params });
		});
	}

	function notify(method: string, params: unknown): void {
		post({ method, params });
	}

	// ---- theming ----

	function applyContext(ctx: unknown): void {
		if (!isRecord(ctx)) return;
		const { theme, styles, displayMode } = ctx as HostContext;
		const el = document.documentElement;
		if (theme === "light" || theme === "dark") {
			el.dataset.theme = theme;
			el.style.colorScheme = theme;
		}
		if (typeof displayMode === "string") el.dataset.display = displayMode;
		if (isRecord(styles?.variables)) {
			for (const [key, value] of Object.entries(styles.variables)) {
				if (key.startsWith("--") && typeof value === "string") {
					el.style.setProperty(key, value);
				}
			}
		}
		const fonts = styles?.css?.fonts;
		if (typeof fonts === "string" && fonts) {
			let tag = document.getElementById("host-fonts");
			if (!tag) {
				tag = document.createElement("style");
				tag.id = "host-fonts";
				document.head.append(tag);
			}
			tag.textContent = fonts;
		}
	}

	// ---- size reporting ----

	let lastHeight = 0;
	// Measure <body>, not <html>: the html box never shrinks below the iframe the
	// host already sized, so a shorter filtered gallery would never be reported.
	function reportSize(): void {
		const height = Math.ceil(document.body.getBoundingClientRect().height);
		if (height === lastHeight) return;
		lastHeight = height;
		notify("ui/notifications/size-changed", { height });
	}
	const resizeObserver = new ResizeObserver(() =>
		requestAnimationFrame(reportSize),
	);
	resizeObserver.observe(document.body);

	// ---- rendering ----

	const options = (): RenderOptions => ({
		canAsk: Boolean(capabilities.message),
	});

	function setStatus(text: string): void {
		if (root) root.innerHTML = `<p class="loading">${text}</p>`;
	}

	const gallery: { view: ProjectGalleryView | null; state: GalleryState } = {
		view: null,
		state: { query: "", lifecycle: "all", sort: "recent" },
	};

	function renderGalleryGrid(): void {
		const grid = document.getElementById("grid");
		if (!grid || !gallery.view) return;
		const cards: GalleryCard[] = filterCards(gallery.view.cards, gallery.state);
		grid.innerHTML = galleryCards(cards, options());
		const shown = document.getElementById("shown");
		if (shown) shown.textContent = `${cards.length} of ${gallery.view.count}`;
	}

	function renderGallery(view: ProjectGalleryView): void {
		if (!root) return;
		gallery.view = view;
		// Each tool result starts fresh: a host may send a second result to the same
		// frame, and filters left over from the first would hide its cards. Any
		// server-side filter is already applied to view.cards.
		gallery.state = { query: "", lifecycle: "all", sort: "recent" };
		root.innerHTML = `${galleryHeader(view)}${galleryControls(view, gallery.state)}<p class="shown" aria-live="polite">Showing <span id="shown"></span></p><div id="grid"></div>`;
		renderGalleryGrid();
	}

	function renderTimeline(view: ProjectTimelineView): void {
		if (root) root.innerHTML = timelineBody(view, options());
	}

	function render(data: unknown): void {
		if (!isRecord(data)) {
			setStatus("This tool result has no data to show.");
			return;
		}
		if (data.view === "gallery" && Array.isArray(data.cards)) {
			renderGallery(data as ProjectGalleryView);
		} else if (data.view === "timeline" && Array.isArray(data.months)) {
			renderTimeline(data as ProjectTimelineView);
		} else {
			setStatus("This tool result is not a gallery or timeline.");
		}
	}

	/** structuredContent first; the JSON text block is the fallback. */
	function dataFromToolResult(params: unknown): unknown {
		if (!isRecord(params)) return null;
		if (isRecord(params.structuredContent)) return params.structuredContent;
		const content = Array.isArray(params.content) ? params.content : [];
		for (const block of content) {
			if (
				isRecord(block) &&
				block.type === "text" &&
				typeof block.text === "string"
			) {
				try {
					return JSON.parse(block.text);
				} catch {
					// not JSON; keep looking
				}
			}
		}
		return null;
	}

	// ---- interaction ----

	function openLink(url: string): void {
		if (capabilities.openLinks) {
			request("ui/open-link", { url }).catch((error: unknown) =>
				console.error("ui/open-link failed", error),
			);
		} else {
			window.open(url, "_blank", "noopener,noreferrer");
		}
	}

	function ask(name: string): void {
		request("ui/message", {
			role: "user",
			content: [
				{
					type: "text",
					text: `Tell me about the ${name} project from Saagar's portfolio.`,
				},
			],
		}).catch((error: unknown) => console.error("ui/message failed", error));
	}

	const onClick = (event: MouseEvent): void => {
		const target = event.target instanceof Element ? event.target : null;
		const link = target?.closest<HTMLElement>("[data-open-link]");
		if (link?.dataset.openLink) {
			event.preventDefault();
			openLink(link.dataset.openLink);
			return;
		}
		const askButton = target?.closest<HTMLElement>("[data-ask]");
		if (askButton?.dataset.ask) {
			ask(askButton.dataset.ask);
			return;
		}
		const chip = target?.closest<HTMLElement>("[data-lifecycle]");
		if (chip?.dataset.lifecycle) {
			gallery.state.lifecycle = chip.dataset.lifecycle;
			for (const el of document.querySelectorAll("[data-lifecycle]")) {
				el.setAttribute("aria-pressed", String(el === chip));
			}
			renderGalleryGrid();
		}
	};

	const onInput = (event: Event): void => {
		const target = event.target;
		if (target instanceof HTMLInputElement && target.id === "q") {
			gallery.state.query = target.value;
			renderGalleryGrid();
		}
	};

	const onChange = (event: Event): void => {
		const target = event.target;
		if (target instanceof HTMLSelectElement && target.id === "sort") {
			gallery.state.sort = target.value as GallerySort;
			renderGalleryGrid();
		}
	};

	// ---- protocol ----

	function respond(id: string | number, result: unknown): void {
		post({ id, result });
	}

	const onMessage = (event: MessageEvent): void => {
		if (event.source !== window.parent) return;
		const msg: unknown = event.data;
		if (!isRecord(msg) || msg.jsonrpc !== "2.0") return;
		const { id, method, params, result, error } = msg as JsonRpcMessage;

		if (method === undefined && id !== undefined) {
			const waiter = pending.get(id);
			if (!waiter) return;
			pending.delete(id);
			if (error) waiter.reject(new Error(error.message));
			else waiter.resolve(result);
			return;
		}

		switch (method) {
			case "ui/notifications/tool-result":
				render(dataFromToolResult(params));
				break;
			case "ui/notifications/tool-cancelled":
				setStatus("The tool call was cancelled.");
				break;
			case "ui/notifications/host-context-changed":
				applyContext(params);
				break;
			case "ui/resource-teardown":
			case "ping":
				if (id !== undefined) respond(id, {});
				break;
			default:
				// Requests we don't implement get a JSON-RPC error; notifications are ignored.
				if (id !== undefined) {
					post({
						id,
						error: { code: -32601, message: `Method not found: ${method}` },
					});
				}
		}
	};

	document.addEventListener("click", onClick);
	document.addEventListener("input", onInput);
	document.addEventListener("change", onChange);
	window.addEventListener("message", onMessage);

	if (window.parent === window) {
		setStatus(
			`This is the portfolio ${viewKind} app. It renders inside an MCP host that supports MCP Apps.`,
		);
	} else {
		request("ui/initialize", {
			appInfo: APP_INFO,
			appCapabilities: { availableDisplayModes: ["inline"] },
			protocolVersion: PROTOCOL_VERSION,
		})
			.then((res) => {
				if (isRecord(res)) {
					if (isRecord(res.hostCapabilities)) {
						capabilities = res.hostCapabilities as HostCapabilities;
					}
					applyContext(res.hostContext);
				}
				notify("ui/notifications/initialized", {});
			})
			.catch((error: unknown) => {
				console.error("ui/initialize failed", error);
				setStatus("The host did not finish the MCP Apps handshake.");
			});
	}

	return () => {
		document.removeEventListener("click", onClick);
		document.removeEventListener("input", onInput);
		document.removeEventListener("change", onChange);
		window.removeEventListener("message", onMessage);
		resizeObserver.disconnect();
		for (const waiter of pending.values())
			waiter.reject(new Error("app stopped"));
		pending.clear();
	};
}
