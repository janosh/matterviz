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

export interface FileInfo {
  name: string
  url: string
  type?: string
  category?: string
  category_icon?: string
}

// Helper function to escape HTML special characters to prevent XSS
export const escape_html = (unsafe_string: string): string =>
  unsafe_string
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`<`, `&lt;`)
    .replaceAll(`>`, `&gt;`)
    .replaceAll(`"`, `&quot;`)
    .replaceAll(`'`, `&#39;`)

// Simplified binary detection
export const is_binary = (content: string): boolean =>
  content.includes(`\0`) ||
  // deno-lint-ignore no-control-regex
  (content.match(/[\u0000-\u0008\u000E-\u001F\u007F-\u00FF]/g) || []).length /
        content.length > 0.1 ||
  (content.match(/[\u0020-\u007E]/g) || []).length / content.length < 0.7

export async function toggle_fullscreen(wrapper?: HTMLDivElement): Promise<void> {
  if (!wrapper) return
  try {
    if (!document.fullscreenElement) {
      await wrapper.requestFullscreen()
    } else if (document.fullscreenElement === wrapper) {
      await document.exitFullscreen()
    } else {
      await document.exitFullscreen()
      await wrapper.requestFullscreen()
    }
  } catch (error) {
    console.error(`Fullscreen operation failed:`, error)
  }
}

export type InfoItem = Readonly<{
  label: string
  value: string | number
  key?: string
  tooltip?: string
}>
