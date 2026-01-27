// Generic tooltip configuration types for prefix/suffix customization
// Prefix/suffix are rendered via {@html} - ensure values are developer-defined, not user input
import type { Snippet } from 'svelte'

export type TooltipConfig<T> = {
  prefix?: string | ((data: T) => string)
  suffix?: string | ((data: T) => string)
}

// Union type: snippet replaces content entirely, config adds prefix/suffix
export type TooltipProp<T, SnippetArgs extends unknown[] = [{ hover_data: T }]> =
  | Snippet<SnippetArgs>
  | TooltipConfig<T>
