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
// Dash injects configuration into `globalThis.__dash_config__` including:
//   - requests_pathname_prefix: The URL prefix for all Dash requests

// Get the base URL for loading assets in a Dash context.
// Call this function where needed rather than caching the result,
// since __dash_config__ may not be available at module load time.
export function get_dash_asset_base_path() {
  if (typeof globalThis !== `undefined` && globalThis.__dash_config__) {
    const prefix = globalThis.__dash_config__.requests_pathname_prefix || `/`
    const normalized = prefix.endsWith(`/`) ? prefix : `${prefix}/`
    return `${normalized}_dash-component-suites/matterviz_dash_components/`
  }
  return `/`
}
