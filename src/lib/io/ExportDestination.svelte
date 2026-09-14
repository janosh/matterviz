<script lang="ts">
  import type { FileExportState } from './file-export.svelte'
  import { to_error } from '$lib/utils'

  let {
    state: export_state,
    disabled = false,
  }: { state: FileExportState; disabled?: boolean } = $props()
  let choosing = $state(false)
  const directory_picker = (
    globalThis as typeof globalThis & {
      showDirectoryPicker?: (options: {
        id: string
        mode: `readwrite`
        startIn: FileSystemDirectoryHandle | `downloads`
      }) => Promise<FileSystemDirectoryHandle>
    }
  ).showDirectoryPicker

  async function choose_folder() {
    if (!directory_picker || choosing) return
    choosing = true
    export_state.error = ``
    try {
      export_state.directory = await directory_picker.call(globalThis, {
        id: `matterviz-export`,
        mode: `readwrite`,
        startIn: export_state.directory ?? `downloads`,
      })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === `AbortError`)) {
        export_state.error = to_error(error).message
        console.error(`Cannot choose export folder:`, error)
      }
    } finally {
      choosing = false
    }
  }
</script>

<fieldset class="export-destination" disabled={disabled || export_state.busy || choosing}>
  <label>
    File name
    <input
      type="text"
      bind:value={export_state.filename}
      aria-invalid={Boolean(export_state.filename_error)}
      title="Base file name; the selected format adds its extension"
    />
  </label>
  <div class="destination-row">
    <span>Save to</span>
    <span class="folder-name" title={export_state.directory?.name}>
      {export_state.directory ? `${export_state.directory.name}/` : `Browser downloads`}
    </span>
    <button
      type="button"
      aria-label="Choose export folder"
      onclick={choose_folder}
      disabled={!directory_picker}
      title={directory_picker
        ? `Choose a folder before exporting`
        : `Folder selection is not supported by this browser`}>Choose folder…</button
    >
    {#if export_state.directory}
      <button
        type="button"
        aria-label="Use browser downloads"
        onclick={() => (export_state.directory = null)}
      >
        Reset
      </button>
    {/if}
  </div>
</fieldset>
{#if export_state.filename_error || export_state.error}
  <div role="alert">{export_state.filename_error || export_state.error}</div>
{/if}

<style>
  .export-destination {
    display: grid;
    gap: 0.5em;
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
    width: 100%;
    label,
    .destination-row {
      display: flex;
      align-items: center;
      gap: 0.5em;
      flex-wrap: wrap;
    }
    input {
      flex: 1;
      min-width: 0;
      font: inherit;
    }
    .folder-name {
      flex: 1;
      overflow-wrap: anywhere;
    }
  }
</style>
