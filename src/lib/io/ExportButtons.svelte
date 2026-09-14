<script lang="ts" generics="Format extends string">
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import type { FileExportContext, FileExportState } from './file-export.svelte'

  let {
    state,
    formats,
    on_export,
    label = (format) => format.toUpperCase(),
    button_props = () => ({}),
  }: {
    state: FileExportState
    formats: readonly Format[]
    on_export: (format: Format, context: FileExportContext) => unknown
    label?: (format: Format) => string
    button_props?: (format: Format) => HTMLButtonAttributes
  } = $props()
</script>

{#each formats as format (format)}
  <button
    type="button"
    {...button_props(format)}
    disabled={state.disabled}
    onclick={() => state.run((context) => on_export(format, context))}
  >
    {label(format)}
  </button>
{/each}
