export * from './brillouin'
export * from './colors'
export * from './composition'
export * from './constants'
export * from './convex-hull'
export * from './coordination'
export * from './element'
export { default as EmptyState } from './EmptyState.svelte'
export * from './feedback'
export * from './fermi-surface'
export { default as FilePicker } from './FilePicker.svelte'
export { default as Icon } from './Icon.svelte'
export { ICON_DATA, type IconName } from './icons'
export * from './io'
export * from './labels'
export * from './layout'
export * from './math'
export * from './overlays'
export * from './periodic-table'
export * from './phase-diagram'
export * from './plot'
export * from './rdf'
export * from './settings'
export * from './spectral'
export * from './structure'
export * from './symmetry'
export * from './table'
export * from './theme'
export * from './time'
export { default as Trajectory } from './trajectory/Trajectory.svelte'
export * from './utils'
export * from './xrd'

// Helper function to escape HTML special characters to prevent XSS
export const escape_html = (unsafe_string: string): string =>
  unsafe_string
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`<`, `&lt;`)
    .replaceAll(`>`, `&gt;`)
    .replaceAll(`"`, `&quot;`)
    .replaceAll(`'`, `&#39;`)
