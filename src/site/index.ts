export { default as CompositionDemo } from './CompositionDemo.svelte'
export { default as DemoNav } from './DemoNav.svelte'
export { default as FilePicker } from './FilePicker.svelte'
export { default as Footer } from './Footer.svelte'
export { default as PeriodicTableControls } from './PeriodicTableControls.svelte'
export { default as PeriodicTableDemo } from './PeriodicTableDemo.svelte'

export interface FileInfo {
  name: string
  url: string
  type?: string
  category?: string
}
