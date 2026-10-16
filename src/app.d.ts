/// <reference types="@sveltejs/kit" />
/// <reference types="svelte-widgets/source-links/virtual" />

// Served by prop_docs_plugin (src/scripts/prop-docs.ts)
declare module 'virtual:prop-docs' {
  import type { PropDoc } from '#root/src/scripts/prop-docs.ts'

  const docs: Record<string, PropDoc[]>
  export default docs
}
