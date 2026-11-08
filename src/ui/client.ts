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
	OperantView,
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
	type OperantState,
	operantBody,
	type RenderOptions,
	timelineBody,
} from "./render";

const PROTOCOL_VERSION = "2026-01-26";
// Requests never time out: a host may be slow to start or wait on a consent
// dialog, and a late reply must still land. After SLOW_MS the clicked control
// says it is waiting, so the button never looks silently dead.
const SLOW_MS = 10_000;
const NOTE_MS = 6_000;
const WAITING_TEXT = "Waiting for the host…";
const SLOW_INIT_TEXT = "Still waiting for the host to start the app…";
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

/** A host's JSON-RPC error as text; the shape is only a cast over postMessage
 * data, so tolerate missing or odd fields. */
function rpcErrorText(error: unknown): string {
	if (!isRecord(error)) return "the host returned an error";
	const message =
		typeof error.message === "string" && error.message
			? error.message
			: "the host returned an error";
	return typeof error.code === "number"
		? `${message} (${error.code})`
		: message;
}

/** Attach the app to the current document and start the host handshake. */
export function startApp(): () => void {
	const root = document.getElementById("app");
	const viewKind = document.documentElement.dataset.view ?? "gallery";
	let capabilities: HostCapabilities = {};
	let nextId = 1;
	let stopped = false;
	let slowInit: ReturnType<typeof setTimeout> | undefined;
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

	// What #app shows: the page's initial "Loading…", the slow-handshake
	// status, or content (any other status, or a view). The watchdog only
	// replaces "loading"; a finished handshake only puts "loading" back over
	// "slow-init", so neither ever overwrites content.
	let shown: "loading" | "slow-init" | "content" = "loading";
	const loadingHtml =
		root?.innerHTML.trim() || '<p class="loading">Loading…</p>';

	function setStatus(
		text: string,
		kind: "slow-init" | "content" = "content",
	): void {
		shown = kind;
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
		shown = "content";
		gallery.view = view;
		// Each tool result starts fresh: a host may send a second result to the same
		// frame, and filters left over from the first would hide its cards. Any
		// server-side filter is already applied to view.cards.
		gallery.state = { query: "", lifecycle: "all", sort: "recent" };
		root.innerHTML = `${galleryHeader(view)}${galleryControls(view, gallery.state)}<p class="shown" aria-live="polite">Showing <span id="shown"></span></p><div id="grid"></div>`;
		renderGalleryGrid();
	}

	function renderTimeline(view: ProjectTimelineView): void {
		shown = "content";
		if (root) root.innerHTML = timelineBody(view, options());
	}

	// OPERANT: a new tool result resets the demo; clicks re-render the view.
	const operant: { view: OperantView | null; state: OperantState } = {
		view: null,
		state: { tab: "profiles", index: 0, answers: {} },
	};

	/** Re-render the OPERANT view. A click redraw replaces the focused control,
	 * so move focus to the first of `focus` that exists (the next sensible
	 * control) instead of letting it fall back to <body>. */
	function drawOperant(...focus: string[]): void {
		if (!root || !operant.view) return;
		root.innerHTML = operantBody(operant.view, operant.state);
		for (const selector of focus) {
			const el = root.querySelector<HTMLElement>(selector);
			if (el) {
				el.focus();
				break;
			}
		}
	}

	function renderOperant(view: OperantView): void {
		shown = "content";
		operant.view = view;
		operant.state = {
			tab: view.available ? view.section : "profiles",
			index: 0,
			answers: {},
		};
		drawOperant();
	}

	/** Demo and tab clicks; returns true when the click was an OPERANT control. */
	function operantClick(target: Element | null): boolean {
		const view = operant.view;
		if (!view?.available) return false;
		const tab = target?.closest<HTMLElement>("[data-operant-tab]");
		const next = tab?.dataset.operantTab;
		if (next === "profiles" || next === "demo") {
			operant.state.tab = next;
			drawOperant(`[data-operant-tab="${next}"]`);
			return true;
		}
		const scenario = view.demo.scenarios[operant.state.index];
		const choice = target?.closest<HTMLElement>("[data-demo-choice]");
		if (choice?.dataset.demoChoice && scenario) {
			if (operant.state.answers[scenario.id] === undefined) {
				operant.state.answers[scenario.id] = choice.dataset.demoChoice;
				drawOperant("[data-demo-next]");
			}
			return true;
		}
		if (target?.closest("[data-demo-next]") && scenario) {
			operant.state.index += 1;
			drawOperant("[data-demo-choice]", "[data-demo-restart]");
			return true;
		}
		if (target?.closest("[data-demo-restart]")) {
			operant.state = { tab: "demo", index: 0, answers: {} };
			drawOperant("[data-demo-choice]");
			return true;
		}
		return false;
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
		} else if (
			data.view === "operant" &&
			(data.available === false ||
				(data.available === true &&
					Array.isArray(data.decision) &&
					isRecord(data.demo)))
		) {
			renderOperant(data as OperantView);
		} else {
			setStatus("This tool result is not a view this app knows.");
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

	const errorText = (error: unknown): string =>
		error instanceof Error ? error.message : String(error);

	const hostDeclined = (result: unknown): boolean =>
		isRecord(result) && result.isError === true;

	// One note per control, so two requests from the same card (Ask and
	// Repository) never clear each other's status.
	const notes = new WeakMap<HTMLElement, HTMLElement>();

	function dropNote(anchor: HTMLElement, el: HTMLElement): void {
		if (notes.get(anchor) !== el) return;
		el.remove();
		notes.delete(anchor);
	}

	/** Show the outcome of a host request beside the control that started it.
	 * The frame can be taller than the visible chat, so a page-level toast could
	 * land off-screen; next to the button is where the user is looking. */
	function note(
		anchor: HTMLElement,
		text: string,
		tone: "ok" | "error",
		sticky = false,
	): HTMLElement {
		notes.get(anchor)?.remove();
		const el = document.createElement("span");
		el.className = "note-inline";
		el.dataset.tone = tone;
		el.setAttribute("role", "status");
		el.textContent = text;
		anchor.insertAdjacentElement("afterend", el);
		notes.set(anchor, el);
		if (!sticky) setTimeout(() => dropNote(anchor, el), NOTE_MS);
		return el;
	}

	/** Run a host request for a clicked control: after SLOW_MS without a reply,
	 * say so (and keep waiting); the settled outcome replaces that note. */
	function hostRequest(
		anchor: HTMLElement,
		method: string,
		params: unknown,
	): Promise<unknown> {
		let waiting: HTMLElement | undefined;
		const slow = setTimeout(() => {
			waiting = note(anchor, WAITING_TEXT, "ok", true);
		}, SLOW_MS);
		// Runs before the caller's handlers: drop this request's waiting note so
		// a success that shows nothing (an opened link) does not leave it behind.
		return request(method, params).finally(() => {
			clearTimeout(slow);
			if (waiting) dropNote(anchor, waiting);
		});
	}

	function openLink(url: string, anchor: HTMLElement): void {
		if (!capabilities.openLinks) {
			window.open(url, "_blank", "noopener,noreferrer");
			return;
		}
		hostRequest(anchor, "ui/open-link", { url })
			.then((result) => {
				if (hostDeclined(result)) {
					note(anchor, "The host didn't open the link.", "error");
				}
			})
			.catch((error: unknown) => {
				console.error("ui/open-link failed", error);
				note(anchor, `Couldn't open the link: ${errorText(error)}`, "error");
			});
	}

	/** Ask the host to put a question in the chat. Hosts decide how: Claude
	 * stages it in the chat box (with a caution banner) for the user to send. */
	function ask(name: string, anchor: HTMLElement): void {
		hostRequest(anchor, "ui/message", {
			role: "user",
			content: [
				{
					type: "text",
					text: `Tell me about the ${name} project from Saagar's portfolio.`,
				},
			],
		})
			.then((result) => {
				if (hostDeclined(result)) {
					note(anchor, "The host declined to post the question.", "error");
				} else {
					note(anchor, "Sent — check the chat box.", "ok");
				}
			})
			.catch((error: unknown) => {
				console.error("ui/message failed", error);
				note(anchor, `Couldn't ask in the chat: ${errorText(error)}`, "error");
			});
	}

	const onClick = (event: MouseEvent): void => {
		const target = event.target instanceof Element ? event.target : null;
		const link = target?.closest<HTMLElement>("[data-open-link]");
		if (link?.dataset.openLink) {
			event.preventDefault();
			openLink(link.dataset.openLink, link);
			return;
		}
		const askButton = target?.closest<HTMLElement>("[data-ask]");
		if (askButton?.dataset.ask) {
			ask(askButton.dataset.ask, askButton);
			return;
		}
		if (operantClick(target)) return;
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
			if (error) waiter.reject(new Error(rpcErrorText(error)));
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
		// No timeout here either, but a host that is slow to answer the handshake
		// gets a visible status instead of an indefinite "Loading…".
		slowInit = setTimeout(() => {
			if (shown === "loading") setStatus(SLOW_INIT_TEXT, "slow-init");
		}, SLOW_MS);
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
				// The host has started the app: drop the slow-start status, but
				// never a status or view that arrived meanwhile.
				if (shown === "slow-init") {
					shown = "loading";
					if (root) root.innerHTML = loadingHtml;
				}
				notify("ui/notifications/initialized", {});
			})
			.finally(() => clearTimeout(slowInit))
			.catch((error: unknown) => {
				if (stopped) return; // stop() rejected the handshake; the DOM is no longer ours
				console.error("ui/initialize failed", error);
				setStatus("The host did not finish the MCP Apps handshake.");
			});
	}

	return () => {
		stopped = true;
		document.removeEventListener("click", onClick);
		document.removeEventListener("input", onInput);
		document.removeEventListener("change", onChange);
		window.removeEventListener("message", onMessage);
		resizeObserver.disconnect();
		clearTimeout(slowInit);
		for (const waiter of pending.values())
			waiter.reject(new Error("app stopped"));
		pending.clear();
	};
}
