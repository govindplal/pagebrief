// agentic-browser CLI.
//   tsx src/cli.ts mcp                         MCP server on stdio (default)
//   tsx src/cli.ts open <url> [--find <regex>] print the page view an agent would get
import { parseArgs } from "node:util";
import { Engine } from "./engine.ts";
import { serveMcp } from "./mcp.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { find: { type: "string" }, headed: { type: "boolean", default: false } },
});
const [command = "mcp", url] = positionals;

if (command === "mcp") {
  await serveMcp(new Engine({ headless: !values.headed }));
} else if (command === "open" && url) {
  const engine = new Engine({ headless: !values.headed });
  try {
    console.log(await engine.open(url));
    if (values.find) console.log(`\n${engine.find(values.find)}`);
  } finally {
    await engine.close();
  }
} else {
  console.error("usage: agentic-browser mcp | agentic-browser open <url> [--find <regex>] [--headed]");
  process.exit(1);
}
