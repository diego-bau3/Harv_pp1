import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outfile = "dist/reliability-tests/reliability-flow-tests.mjs";

await mkdir("dist/reliability-tests", { recursive: true });

await build({
  entryPoints: ["scripts/reliability-flow-tests.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent"
});

await import(pathToFileURL(`${process.cwd()}/${outfile}`).href);
