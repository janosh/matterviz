/// <reference types="@sveltejs/kit" />

declare module '*element-data.ts' {
  const elements: import('./lib/types').ChemicalElement[]
  export default elements
}
