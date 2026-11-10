import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

/**
 * Apply the runtime-only path to the standalone Next server config.
 * Next derives assetPrefix from basePath while loading next.config. Since this
 * app intentionally builds with an empty basePath, changing only basePath after
 * loading leaves generated stylesheet and script URLs at the site root.
 */
export function withRuntimeBasePath(config, basePath) {
  return { ...config, basePath, assetPrefix: basePath };
}

/** React's client-reference manifests also embed the build-time asset prefix. */
export function applyRuntimeAssetPrefix(directory, basePath) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      applyRuntimeAssetPrefix(path, basePath);
    } else if (entry.name.endsWith("_client-reference-manifest.js")) {
      const source = readFileSync(path, "utf8");
      const context = { process: { env: { NEXT_DEPLOYMENT_ID: process.env.NEXT_DEPLOYMENT_ID } } };
      runInNewContext(source, context);
      if (!context.__RSC_MANIFEST) throw new Error(`Invalid client reference manifest: ${path}`);
      const assignments = Object.entries(context.__RSC_MANIFEST).map(([route, manifest]) => {
        if (manifest.moduleLoading) manifest.moduleLoading.prefix = `${basePath}/_next/`;
        return `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}]=${JSON.stringify(manifest)};`;
      });
      const updated = `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});${assignments.join("")}`;
      if (updated !== source) writeFileSync(path, updated);
    }
  }
}
