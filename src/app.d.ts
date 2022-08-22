/// <reference types="@sveltejs/kit" />

declare module '*periodic-table-data.ts' {
  const elements: import('./lib/types').ChemicalElement[]
  export default elements
}
