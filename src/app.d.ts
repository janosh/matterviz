/// <reference types="@sveltejs/kit" />

declare module '*element-data.yml' {
  const elements: import('./lib/types').ChemicalElement[]
  export default elements
}
