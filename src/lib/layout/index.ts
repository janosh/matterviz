// SettingsSection, SettingsGroup, SettingsSearch, and NumberRangeInput now exist upstream.
// After svelte-widgets >1.4.0 is published, replace these local exports with package imports;
// NumberRangeInput setting-based calls additionally need the generic schema prop.
export * from './fullscreen'
export { sync_fullscreen } from 'svelte-widgets/fullscreen'
export { FullscreenButton } from 'svelte-widgets'
export { default as FullscreenToggle } from './FullscreenToggle.svelte'
export { default as InfoCard } from './InfoCard.svelte'
export { default as InfoTag } from './InfoTag.svelte'
export { default as NumberRangeInput } from './NumberRangeInput.svelte'
export * from './json-tree'
export { default as PropertyFilter } from './PropertyFilter.svelte'
export { default as SettingsGroup } from './SettingsGroup.svelte'
export { default as SettingsSearch } from './SettingsSearch.svelte'
export { default as SettingsSection } from './SettingsSection.svelte'
export { default as SubpageGrid } from './SubpageGrid.svelte'
export { default as ViewerChrome } from './ViewerChrome.svelte'

export type InfoTagVariant = `default` | `success` | `warning` | `error` | `info`
export type InfoTagSize = `sm` | `md` | `lg`
