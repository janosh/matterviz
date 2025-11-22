<script lang="ts">
  import type { AnyStructure } from '$lib'
  import { DraggablePane } from '$lib'
  import { export_canvas_as_png } from '$lib/io/export'
  import * as exports from '$lib/structure/export'
  import type { ComponentProps } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { Camera, Scene } from 'three'

  let {
    export_pane_open = $bindable(false),
    structure = undefined,
    wrapper = undefined,
    scene = undefined,
    camera = undefined,
    png_dpi = $bindable(150),
    pane_props = {},
    toggle_props = {},
    ...rest
  }: {
    export_pane_open?: boolean
    structure?: AnyStructure
    wrapper?: HTMLDivElement
    scene?: Scene
    camera?: Camera
    png_dpi?: number
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  } = $props()

  // Copy button feedback state
  let copy_status = $state<
    { json: boolean; xyz: boolean; cif: boolean; poscar: boolean }
  >({ json: false, xyz: false, cif: false, poscar: false })

  // Dynamic button text based on copy status
  const copy_confirm = `✅`

  const text_export_formats = [
    { label: `JSON`, format: `json` },
    { label: `XYZ`, format: `xyz` },
    { label: `CIF`, format: `cif` },
    { label: `POSCAR`, format: `poscar` },
  ] as const

  const model_3d_formats = [
    {
      label: `GLB`,
      format: `glb`,
      hint:
        `Export as GLB (binary GLTF) - preserves element colors and materials, ideal for visualization in Blender, Unity, web viewers`,
    },
    {
      label: `OBJ`,
      format: `obj`,
      hint:
        `Export as OBJ (Wavefront Object) - widely supported 3D format with material references, works in most 3D applications`,
    },
  ] as const

  // Helper function to export structure to file
  function export_structure(format: `json` | `xyz` | `cif` | `poscar`) {
    if (!structure) return
    const export_fns = {
      json: exports.export_structure_as_json,
      xyz: exports.export_structure_as_xyz,
      cif: exports.export_structure_as_cif,
      poscar: exports.export_structure_as_poscar,
    } as const
    export_fns[format](structure)
  }

  // Handle clipboard copy with user feedback
  async function handle_copy(format: `json` | `xyz` | `cif` | `poscar`) {
    if (!structure) {
      console.warn(`No structure available for copying`)
      return
    }

    try {
      let content: string
      if (format === `json`) content = exports.structure_to_json_str(structure)
      else if (format === `xyz`) content = exports.structure_to_xyz_str(structure)
      else if (format === `cif`) content = exports.structure_to_cif_str(structure)
      else if (format === `poscar`) {
        content = exports.structure_to_poscar_str(structure)
      } else throw new Error(`Invalid format: ${format}`)

      await navigator.clipboard.writeText(content)

      // Show temporary feedback in button text
      copy_status[format] = true
      setTimeout(() => {
        copy_status[format] = false
      }, 1000)
    } catch (error) {
      console.error(`Failed to copy ${format.toUpperCase()} to clipboard`, error)
    }
  }

  function handle_3d_export(format: `glb` | `obj`) {
    if (!scene) {
      console.warn(`No scene available for ${format.toUpperCase()} export`)
      return
    }

    try {
      if (format === `glb`) exports.export_structure_as_glb(scene, structure)
      else if (format === `obj`) exports.export_structure_as_obj(scene, structure)
    } catch (error) {
      console.error(`Failed to export ${format.toUpperCase()}:`, error)
    }
  }

  let has_canvas = $state(false)

  $effect(() => {
    if (!wrapper) {
      has_canvas = false
      return
    }
    const check = () => (has_canvas = Boolean(wrapper.querySelector(`canvas`)))
    check()
    const observer = new MutationObserver(check)
    observer.observe(wrapper, { childList: true, subtree: true })
    return () => observer.disconnect()
  })
</script>

<DraggablePane
  bind:show={export_pane_open}
  open_icon="Cross"
  closed_icon="Export"
  pane_props={{ ...pane_props, class: `export-pane ${pane_props?.class ?? ``}` }}
  toggle_props={{
    title: export_pane_open ? `` : `Export Structure`,
    ...toggle_props,
    class: `structure-export-toggle ${toggle_props?.class ?? ``}`,
  }}
  {...rest}
>
  <h4>Export as text</h4>
  <div class="export-buttons">
    {#each text_export_formats as { label, format } (format)}
      <div style="display: flex; align-items: center; gap: 4pt">
        {label}
        <button
          type="button"
          onclick={() => export_structure(format)}
          title="Download {label}"
        >
          ⬇
        </button>
        <button
          type="button"
          onclick={() => handle_copy(format)}
          title="Copy {label} to clipboard"
        >
          {copy_status[format] ? copy_confirm : `📋`}
        </button>
      </div>
    {/each}
  </div>

  <h4>Export as image</h4>
  <div class="export-buttons">
    <label>
      PNG
      <button
        type="button"
        disabled={!has_canvas}
        onclick={() => {
          const canvas = wrapper?.querySelector(`canvas`) as HTMLCanvasElement
          if (canvas) {
            export_canvas_as_png(
              canvas,
              structure,
              png_dpi,
              scene,
              camera,
            )
          } else console.warn(`Canvas element not found for PNG export`)
        }}
        title="PNG ({png_dpi} DPI)"
      >
        ⬇
      </button>
      &nbsp;(DPI: <input
        type="number"
        min={50}
        max={500}
        bind:value={png_dpi}
        title="Export resolution in dots per inch"
        style="margin: 0 0 0 2pt"
      />)
    </label>
  </div>

  <h4>Export as 3D model</h4>
  <div class="export-buttons">
    {#each model_3d_formats as { label, format, hint } (format)}
      <div style="display: flex; align-items: center; gap: 4pt">
        {label}
        <button
          type="button"
          onclick={() => handle_3d_export(format)}
          disabled={!scene}
          title="Download {label}"
          {@attach tooltip({ content: hint })}
        >
          ⬇
        </button>
      </div>
    {/each}
  </div>
</DraggablePane>

<style>
  .export-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 9pt;
    font-size: 0.95em;
  }
  .export-buttons button {
    min-width: 1.9em;
    height: 1.6em;
    padding: 0 4pt;
    margin: 0 0 0 4pt;
    box-sizing: border-box;
  }
</style>
