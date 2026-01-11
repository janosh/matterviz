// Dynamic Base URL Configuration for Dash
//
// Dash applications can be mounted under URL prefixes (e.g., /myapp/ instead of /).
// When this happens, dynamically loaded assets (WASM files, etc.) must be fetched
// from the correct prefixed URL.
//
// Unlike Webpack which uses __webpack_public_path__, Vite handles this differently:
// - Static assets are inlined or use relative paths by default
// - For dynamic imports, we set import.meta.env.BASE_URL at build time
// - For runtime needs, we provide a helper function
//
// Dash injects configuration into `window.__dash_config__` including:
//   - requests_pathname_prefix: The URL prefix for all Dash requests

// Get the base URL for loading assets in a Dash context.
// Returns the base URL path for component assets.
export function getDashAssetBasePath() {
  if (typeof window !== `undefined` && globalThis.__dash_config__) {
    const prefix = globalThis.__dash_config__.requests_pathname_prefix || `/`
    const normalized = prefix.endsWith(`/`) ? prefix : `${prefix}/`
    return `${normalized}_dash-component-suites/matterviz_dash_components/`
  }
  // Fallback for non-Dash environments
  return `/`
}

// Export the base path for use in dynamic imports if needed
export const DASH_ASSET_BASE = getDashAssetBasePath()
