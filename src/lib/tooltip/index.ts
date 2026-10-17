// Shared tooltip prop types
import type { Snippet } from 'svelte'

// Every hover-tooltip component's `tooltip` prop: false hides the tooltip, a snippet replaces
// its content, a config object (where defined) customizes the default and undefined shows it.
// Exceptions where a snippet adds to the default: Structure/StructureScene append it below
// the site info (Trajectory adds its field probe after), StructureBarPlot after metadata.
export type TooltipProp<SnippetArg, Config = never> = Snippet<[SnippetArg]> | Config | false

// Prefix/suffix around a default tooltip's content. Rendered via {@html}: ensure values are
// developer-defined, not user input
export type TooltipConfig<T> = {
  prefix?: string | ((data: T) => string)
  suffix?: string | ((data: T) => string)
}

export * from './hover-link.svelte'
export { default as KCoords } from './KCoords.svelte'
export { default as TooltipContent } from './TooltipContent.svelte'
export { default as TooltipValue } from './TooltipValue.svelte'
