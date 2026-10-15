/// <reference types="@sveltejs/kit" />
/// <reference types="svelte-widgets/source-links/virtual" />

// Served by prop_docs_plugin (src/scripts/prop-docs.ts): one lazy loader per src/lib component
declare module 'virtual:prop-docs' {
  import type { PropDoc } from '#root/src/scripts/prop-docs.ts'

  const loaders: Record<string, () => Promise<{ default: PropDoc[] }>>
  export default loaders
}
