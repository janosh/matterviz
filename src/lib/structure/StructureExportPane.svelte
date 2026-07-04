<script lang="ts">
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import type { ExportSection } from '$lib/io'
  import ExportPane from '$lib/io/ExportPane.svelte'
  import { export_canvas_as_png, observe_canvas_presence } from '$lib/io/export'
  import type { AnyStructure } from '$lib/structure'
  import * as exports from '$lib/structure/export'
  import type { StructTextFormat } from '$lib/structure/export'
  import type { ComponentProps } from 'svelte'
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
    pane_props?: PaneProps
    toggle_props?: PaneToggleProps
  } = $props()

  const text_export_formats = [
    {
      label: `JSON`,
      format: `json`,
      hint: `<a href="https://pymatgen.org" target="_blank">Pymatgen</a> JSON format - Python Materials Genomics structure serialization, widely used in computational materials science`,
    },
    {
      label: `XYZ`,
      format: `xyz`,
      hint: `<a href="https://wiki.fysik.dtu.dk/ase" target="_blank">ASE</a> extended XYZ format - human-readable atomic coordinates used by the Atomic Simulation Environment`,
    },
    {
      label: `CIF`,
      format: `cif`,
      hint: `Crystallographic Information File - standard format from the <a href="https://iucr.org" target="_blank">IUCr</a> for crystal structure data exchange`,
    },
    {
      label: `POSCAR`,
      format: `poscar`,
      hint: `<a href="https://vasp.at" target="_blank">VASP</a> POSCAR format - input geometry file for the Vienna Ab initio Simulation Package`,
    },
  ] as const

  const model_3d_formats = [
    {
      label: `GLB`,
      format: `glb`,
      hint: `Export as GLB (binary GLTF) - preserves element colors and materials, ideal for visualization in Blender, Unity, web viewers`,
    },
    {
      label: `OBJ`,
      format: `obj`,
      hint: `Export as OBJ (Wavefront Object) - widely supported 3D format with material references, works in most 3D applications`,
    },
  ] as const

  // Clipboard content for a text format; must not throw (ExportPane evaluates on click)
  function get_text_content(format: StructTextFormat): string | null {
    if (!structure) return null
    try {
      return exports.STRUCT_TEXT_FORMATS[format].to_str(structure)
    } catch (error) {
      console.error(`Failed to copy ${format.toUpperCase()} to clipboard`, error)
      return null
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

  $effect(() => observe_canvas_presence(wrapper, (val) => (has_canvas = val)))

  const sections = $derived<ExportSection[]>([
    {
      title: `Export as text`,
      items: text_export_formats.map(({ label, format, hint }) => ({
        label,
        hint,
        disabled: !structure,
        on_download: () => structure && exports.export_structure_as(format, structure),
        copy_text: () => get_text_content(format),
      })),
    },
    {
      title: `Export as image`,
      items: [
        {
          label: `PNG`,
          disabled: !has_canvas,
          show_dpi: true,
          on_download: () => {
            const canvas = wrapper?.querySelector(`canvas`)
            if (canvas) export_canvas_as_png(canvas, structure, png_dpi, scene, camera)
            else console.warn(`Canvas element not found for PNG export`)
          },
        },
      ],
    },
    {
      title: `Export as 3D model`,
      items: model_3d_formats.map(({ label, format, hint }) => ({
        label,
        hint,
        disabled: !scene,
        on_download: () => handle_3d_export(format),
      })),
    },
  ])
</script>

<ExportPane
  bind:export_pane_open
  bind:png_dpi
  {sections}
  {pane_props}
  toggle_props={{
    title: export_pane_open ? `` : `Export Structure`,
    ...toggle_props,
    class: `structure-export-toggle ${toggle_props?.class ?? ``}`,
  }}
  {...rest}
/>
