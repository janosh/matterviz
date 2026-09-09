<script lang="ts">
  // Acquisition shell: pure Structure owns rendering and editing, this component owns files.
  import { Spinner, StatusMessage } from 'svelte-widgets'
  import { DEFAULTS } from '$lib/settings'
  import { DEFAULT_PNG_DPI } from '$lib/constants'
  import { DEFAULT_ATOM_COLOR_CONFIG } from './atom-properties'
  import { SvelteSet } from 'svelte/reactivity'
  import type { ElementSymbol } from '$lib/element'
  import {
    DEFAULT_ISOSURFACE_SETTINGS,
    type IsosurfaceSettings,
    type VolumetricData,
  } from '$lib/isosurface/types'
  import type { AnyStructure, StructureDisplayMode, StructureHandlerData } from './index'
  import type { StructureSettings } from './settings'
  import * as symmetry from '$lib/symmetry'
  import type { ComponentProps } from 'svelte'
  import type { FileLoadCallback } from '$lib/io'
  import type { MaterialPayload } from '$lib/file-viewer/open'
  import { create_material_loader } from '$lib/file-viewer/material-loader.svelte'
  import { apply_structure_material } from './material'
  import Structure from './Structure.svelte'

  let {
    structure = $bindable(),
    bonds = $bindable(),
    active_pane = $bindable(null),
    multi_view = $bindable(false),
    measure_mode = $bindable(`distance`),
    bond_edit_mode = $bindable(`add`),
    bond_edit_order = $bindable(1),
    background_color = $bindable(),
    background_opacity = $bindable(DEFAULTS.background_opacity),
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    width = $bindable(0),
    height = $bindable(0),
    color_scheme = $bindable(`Vesta`),
    atom_color_config = $bindable({ ...DEFAULT_ATOM_COLOR_CONFIG }),
    png_dpi = $bindable(DEFAULT_PNG_DPI),
    show_image_atoms = $bindable(true),
    highlighted_sites = $bindable([]),
    measured_sites = $bindable([]),
    hidden_elements = $bindable(new SvelteSet<ElementSymbol>()),
    slice_settings = $bindable({}),
    scene_props = $bindable<StructureSettings>(structuredClone(DEFAULTS.structure)),
    selected_sites = $bindable([]),
    hovered_site_idx = $bindable(null),
    supercell_scaling = $bindable(`1x1x1`),
    cell_type = $bindable(`original`),
    symmetry_settings = $bindable(symmetry.default_sym_settings),
    volumetric_data = $bindable<VolumetricData[] | undefined>(),
    isosurface_settings = $bindable<IsosurfaceSettings>({
      ...DEFAULT_ISOSURFACE_SETTINGS,
    }),
    display_mode = $bindable<StructureDisplayMode>(`structure`),
    active_volume_id = $bindable<string | undefined>(),
    source,
    prediction,
    children: content,
    allow_file_drop = true,
    on_file_drop,
    on_file_load,
    on_error,
    loading = $bindable(false),
    error_msg = $bindable(),
    dragover = $bindable(false),
    ...viewer_props
  }: ComponentProps<typeof Structure> & {
    source?: string | MaterialPayload
    allow_file_drop?: boolean
    on_file_drop?: FileLoadCallback
    on_file_load?: (data: StructureHandlerData) => void
    on_error?: (data: StructureHandlerData) => void
    loading?: boolean
    error_msg?: string
    dragover?: boolean
  } = $props()

  let viewer = $state<ReturnType<typeof Structure>>()
  let notice_message = $state<string>()
  export const analysis = {
    get displayed_structure() {
      return viewer?.analysis.displayed_structure
    },
    get wyckoff_positions() {
      return viewer?.analysis.wyckoff_positions ?? []
    },
    get sym_data() {
      return viewer?.analysis.sym_data ?? null
    },
    get displacement_rmsd() {
      return viewer?.analysis.displacement_rmsd
    },
  }

  const drop_zone = create_material_loader<AnyStructure>({
    data_url: () => (typeof source === `string` ? source : undefined),
    inline_source: () => (typeof source === `object` ? source : undefined),
    current_value: () => structure,
    allow_file_drop: () => allow_file_drop,
    on_file_drop: () => on_file_drop,
    set_loading: (value) => (loading = value),
    set_error: (message) => (error_msg = message),
    set_dragover: (over) => (dragover = over),
    commit: (opened) => {
      notice_message = undefined
      let loaded_structure: AnyStructure | undefined
      if (opened.type === `structure` && opened.prediction) {
        prediction = opened.prediction
        structure = prediction.input
        loaded_structure = structure
      } else {
        const { document, notice } = apply_structure_material(
          { structure, volumetric_data, isosurface_settings, active_volume_id },
          opened,
        )
        loaded_structure = document.structure
        // Avoid wrapping an unchanged plain input in a proxy during a same-geometry volume import.
        if (loaded_structure !== structure) structure = loaded_structure
        ;({ volumetric_data, isosurface_settings, active_volume_id } = document)
        if (notice) notice_message = notice
      }
      on_file_load?.({
        structure: loaded_structure,
        ...opened.provenance,
        total_atoms: loaded_structure?.sites.length ?? 0,
      })
    },
    report_error: (message, metadata) => {
      error_msg = message
      on_error?.({ error_msg: message, ...metadata })
    },
  })
</script>

<div class="structure-file-viewer" class:dragover {@attach drop_zone}>
  <Structure
    bind:this={viewer}
    {...viewer_props}
    {prediction}
    bind:structure={() => structure, (value) => (structure = value)}
    bind:bonds
    bind:active_pane
    bind:multi_view
    bind:measure_mode
    bind:bond_edit_mode
    bind:bond_edit_order
    bind:background_color
    bind:background_opacity
    bind:fullscreen
    bind:wrapper
    bind:width
    bind:height
    bind:color_scheme
    bind:atom_color_config
    bind:png_dpi
    bind:show_image_atoms
    bind:highlighted_sites
    bind:measured_sites
    bind:hidden_elements
    bind:slice_settings
    bind:selected_sites
    bind:hovered_site_idx
    bind:scene_props
    bind:supercell_scaling
    bind:cell_type
    bind:symmetry_settings
    bind:volumetric_data
    bind:isosurface_settings
    bind:display_mode
    bind:active_volume_id
  >
    {#snippet children(data)}
      {@render content?.(data)}
      {#if loading}<Spinner
          text="Loading structure..."
          style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)"
        />{/if}
      {#if error_msg}<StatusMessage bind:message={error_msg} type="error" dismissible />{/if}
      {#if notice_message}<StatusMessage bind:message={notice_message} dismissible />{/if}
    {/snippet}
  </Structure>
</div>

<style>
  .structure-file-viewer {
    display: contents;
    &.dragover > :global(.structure) {
      background: var(--struct-dragover-bg, var(--dragover-bg));
      border: var(--struct-dragover-border, var(--dragover-border));
    }
  }
</style>
