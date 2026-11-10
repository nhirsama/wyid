/**
 * Apply the runtime-only path to the standalone Next server config.
 * Next derives assetPrefix from basePath while loading next.config. Since this
 * app intentionally builds with an empty basePath, changing only basePath after
 * loading leaves generated stylesheet and script URLs at the site root.
 */
export function withRuntimeBasePath(config, basePath) {
  return { ...config, basePath, assetPrefix: basePath };
}
