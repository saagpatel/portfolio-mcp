<!-- portfolio-context:start -->
# Portfolio Context

## What This Project Is

portfolio-mcp: The agent-native layer of [saagarpatel.dev](https://saagarpatel.dev): a Model.

## Current State

- **Built + locally verified:** Layers 0–2. Shared core + 8 tools + Resources + 2 prompts +
  `get_operant_results`. typecheck clean; test suite passes (incl. full MCP protocol via the
  fetch handler). Live Worker probe and deploy remain operator-gated. Public discovery
  advertises `mcp.saagarpatel.dev` with a valid Ed25519-signed manifest.
- **Gated / next:** publish the stdio package (`npm publish`, after removing
  `"private": true` by explicit operator approval only), glama.ai registry listing, and
  continued signed-manifest readback checks after website manifest changes.

## Stack

- Primary stack: Node.js, TypeScript
- JavaScript package manager: npm-compatible workflow

## How To Run

- Install dependencies with `npm install`.
- Start local development with `npm run dev`.
- Review the repo README for any required verification commands before shipping.

## Known Risks

- This repo only has minimum-viable recovery context today; deeper handoff details may still live in the README and supporting docs.

## Next Recommended Move

Use this context plus the README and supporting docs to resume the next active task, then promote the repo beyond minimum-viable by capturing a dedicated handoff, roadmap, or discovery artifact.

<!-- portfolio-context:end -->
