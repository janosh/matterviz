/// <reference types="@sveltejs/kit" />
/// <reference types="svelte-widgets/source-links/virtual" />
/// <reference types="svelte-widgets/prop-docs/virtual" />

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
