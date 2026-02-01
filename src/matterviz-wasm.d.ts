// Type declarations for optional matterviz-wasm dependency
// This allows TypeScript to resolve the dynamic imports without having the package installed

declare module 'matterviz-wasm' {
  const init: (opts?: { module_or_path?: string }) => Promise<unknown>
  export default init
}
