#!/usr/bin/env node
// Entry point for `npx pagebrief`: the engine runs from TypeScript
// source, so register the tsx loader and hand over to the CLI.
import "tsx";

await import("../src/cli.ts");
