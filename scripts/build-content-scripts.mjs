import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "dist/content");
const providers = ["chatgpt", "gemini", "kimi", "doubao"];
const entryPoints = {
  chatgpt: "src/content/chatgpt.content.ts",
  gemini: "src/content/gemini-standalone.content.ts",
  kimi: "src/content/kimi.content.ts",
  doubao: "src/content/doubao.content.ts",
};

await mkdir(outputDirectory, { recursive: true });

for (const provider of providers) {
  await build({
    entryPoints: [resolve(root, entryPoints[provider])],
    outfile: resolve(outputDirectory, `${provider}.js`),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome114",
    minify: true,
    sourcemap: false,
    legalComments: "none",
  });
}

const manifestPath = resolve(root, "dist/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length !== providers.length) {
  throw new Error("Unexpected generated content_scripts layout; refusing to patch manifest.");
}

manifest.content_scripts.forEach((entry, index) => {
  entry.js = [`content/${providers[index]}.js`];
});

// CRXJS loader resources are no longer referenced by production Content Scripts.
delete manifest.web_accessible_resources;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
