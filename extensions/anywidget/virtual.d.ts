// Served by vite.config.ts's widget_components: each registry component's lazy loader, keyed
// by widget_type
declare module 'virtual:matterviz-widget-components' {
  import type { Component } from 'svelte'

  const load_component: Record<
    string,
    () => Promise<{ default: Component<Record<string, unknown>> }>
  >
  export default load_component
}
