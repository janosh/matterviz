// mdsvex compiles .md to Svelte components, so .svelte pages can import markdown partials and
// get build-time starry-night highlighting. Keep this file free of top-level imports: inside a
// module the wildcard would be a module augmentation and never match (hence not in app.d.ts).
declare module '*.md' {
  import type { Component } from 'svelte'
  const component: Component
  export default component
}
