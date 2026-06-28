// Dogfood the shipped stdio artifact: spawn dist/stdio.js, speak MCP, ask real questions.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/stdio.js"] });
const client = new Client({ name: "dogfood", version: "1.0.0" }, { capabilities: {} });

const text = (r) => (r.content ?? []).map((c) => c.text ?? "").join("\n");

await client.connect(transport);
console.log("CONNECTED to saagar-portfolio-mcp (stdio)\n");

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "), "\n");

console.log("== get_profile ==");
console.log(text(await client.callTool({ name: "get_profile", arguments: {} })).slice(0, 600), "\n");

console.log('== search "MCP server" (limit 3) ==');
console.log(text(await client.callTool({ name: "search", arguments: { query: "MCP server", limit: 3 } })).slice(0, 700), "\n");

console.log("== list_projects ==");
console.log(text(await client.callTool({ name: "list_projects", arguments: {} })).slice(0, 500), "\n");

await client.close();
console.log("\nOK: clean disconnect.");
