// Compose the self-contained MCP App HTML document for one view. Script and
// styles are inlined (no network: the default app CSP denies all origins).

import { APP_CSS, APP_SCRIPT } from "./app.generated";

export type AppView = "gallery" | "timeline";

export const APP_MIME_TYPE = "text/html;profile=mcp-app";

const TITLES: Record<AppView, string> = {
	gallery: "Project gallery",
	timeline: "Project timeline",
};

/** Keep inline code from closing its own <script>/<style> element early. */
const inlineSafe = (code: string, tag: "script" | "style"): string =>
	code.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");

export function appHtml(view: AppView): string {
	return `<!doctype html>
<html lang="en" data-view="${view}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLES[view]}</title>
<style>${inlineSafe(APP_CSS, "style")}</style>
</head>
<body>
<main id="app"><p class="loading">Loading ${TITLES[view].toLowerCase()}…</p></main>
<script>${inlineSafe(APP_SCRIPT, "script")}</script>
</body>
</html>`;
}
