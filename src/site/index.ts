export { default as DemoNav } from './DemoNav.svelte'
export { default as FileCarousel } from './FileCarousel.svelte'
export { default as Footer } from './Footer.svelte'
export { default as PeriodicTableControls } from './PeriodicTableControls.svelte'
export { default as PeriodicTableDemo } from './PeriodicTableDemo.svelte'

export interface FileInfo {
  name: string
  content: string | ArrayBuffer // Direct binary support - no more data URLs!
  formatted_name: string
  type: string
  structure_type?: `crystal` | `molecule` | `unknown`
  content_type?: `text` | `binary` // Indicates if content is text or binary ArrayBuffer
}
