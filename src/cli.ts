// agentic-browser CLI.
//   tsx src/cli.ts mcp                         MCP server on stdio (default)
//   tsx src/cli.ts open <url> [--find <regex>] print the page view an agent would get
// Flags: --headed (show the browser), --allow-private (open localhost and
// private-network pages; also AGENTIC_BROWSER_ALLOW_PRIVATE=1).
import { parseArgs } from "node:util";
import { Engine } from "./engine.ts";
import { serveMcp } from "./mcp.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    find: { type: "string" },
    headed: { type: "boolean", default: false },
    "allow-private": { type: "boolean", default: false },
  },
});
const engineOptions = {
  headless: !values.headed,
  allowPrivate: values["allow-private"] || /^(1|true)$/i.test(process.env.AGENTIC_BROWSER_ALLOW_PRIVATE ?? ""),
};
const [command = "mcp", url] = positionals;

if (command === "mcp") {
  await serveMcp(new Engine(engineOptions));
} else if (command === "open" && url) {
  const engine = new Engine(engineOptions);
  try {
    console.log(await engine.open(url));
    if (values.find) console.log(`\n${engine.find(values.find)}`);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await engine.close();
  }
} else {
  console.error("usage: agentic-browser mcp | agentic-browser open <url> [--find <regex>] [--headed] [--allow-private]");
  process.exit(1);
}
