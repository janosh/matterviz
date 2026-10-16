// Shared tooltip prop types
import type { Snippet } from 'svelte'

// Every hover-tooltip component's `tooltip` prop: false hides the tooltip, a snippet replaces its
// content, a config object (on components that define one) customizes the default content and
// undefined shows the default. Exceptions where a snippet adds to the default instead:
// Structure/StructureScene append it below the built-in site info (Trajectory passes it on and
// appends its field probe after it), and StructureBarPlot renders it after the bar's string
// metadata fields (each as a `value —` prefix).
export type TooltipProp<SnippetArg, Config = never> = Snippet<[SnippetArg]> | Config | false

// Prefix/suffix around a default tooltip's content. Rendered via {@html}: ensure values are
// developer-defined, not user input
export type TooltipConfig<T> = {
  prefix?: string | ((data: T) => string)
  suffix?: string | ((data: T) => string)
}

export { default as KCoords } from './KCoords.svelte'
export { default as TooltipContent } from './TooltipContent.svelte'
export { default as TooltipValue } from './TooltipValue.svelte'
