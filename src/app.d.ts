/// <reference types="@sveltejs/kit" />
/// <reference types="svelte-widgets/source-links/virtual" />

// Served by prop_docs_plugin (src/scripts/prop-docs.ts)
declare module 'virtual:prop-docs' {
  import type { PropDoc } from '#root/src/scripts/prop-docs.ts'

  const docs: Record<string, PropDoc[]>
  export default docs
}

// Served by src/elements/vite.config.ts: each custom element's lazy component, settable prop
// names, bindable ones and those without a default, and the stylesheet the elements share
declare module 'virtual:matterviz-elements' {
  import type { Component } from 'svelte'

  const elements: Record<
    string,
    {
      load: () => Promise<{ default: Component<Record<string, unknown>> }>
      props: string[]
      bindable: string[]
      seeded: string[]
    }
  >
  export default elements
  export const css: string
}
