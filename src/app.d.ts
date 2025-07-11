/// <reference types="@sveltejs/kit" />

declare module 'mp-*.json' {
  const content: import('$lib/structure').PymatgenStructure
  export default content
}

declare module '*-colors.yml' {
  const content: import('$lib/colors').ElementColorScheme
  export default content
}

// type mdsvex markdown files as Svelte components
declare module '*.md' {
  const component: import('svelte').Component
  export default component
}
