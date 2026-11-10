import { nextAssetPublicPath } from "./lib/client-assets";

// Webpack replaces this identifier with its runtime's public-path property.
declare let __webpack_public_path__: string;

// Next runs this module before hydration starts loading RSC client chunks.
// The server's assetPrefix fixes HTML tags only; a reusable root build still
// embeds /_next/ in Webpack. Use this script's actual URL for lazy chunks too.
const source = document.currentScript?.getAttribute("src");
if (source) {
  const publicPath = nextAssetPublicPath(source, document.baseURI);
  if (publicPath && __webpack_public_path__ !== publicPath) __webpack_public_path__ = publicPath;
}
