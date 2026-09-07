<script lang="ts">
  import { DEFAULT_PNG_DPI } from '$lib/constants'
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import type { ExportSection } from '$lib/io'
  import ExportPane from '$lib/io/ExportPane.svelte'
  import { export_canvas_as_png, observe_canvas_presence } from '$lib/io/export'
  import { export_scene_as } from '$lib/scene'
  import type { AnyStructure } from '$lib/structure'
  import * as exports from '$lib/structure/export'
  import type { StructTextFormat } from '$lib/structure/export'
  import { download } from '$lib/io/fetch'
  import { prediction_to_json, type StructureToolPrediction } from './host-tool.svelte'
  import type { ComponentProps } from 'svelte'
  import type { Camera, Scene } from 'three/webgpu'

  let {
    export_pane_open = $bindable(false),
    structure = undefined,
    prediction,
    on_clear_prediction,
    on_reset_prediction_surfaces,
    wrapper = undefined,
    scene = undefined,
    camera = undefined,
    image_canvas = undefined,
    image_filename = undefined,
    enable_3d_export = true,
    png_dpi = $bindable(DEFAULT_PNG_DPI),
    pane_props = {},
    toggle_props = {},
    ...rest
  }: {
    export_pane_open?: boolean
    structure?: AnyStructure
    prediction?: StructureToolPrediction
    on_clear_prediction?: () => void
    on_reset_prediction_surfaces?: () => void
    wrapper?: HTMLDivElement
    scene?: Scene
    camera?: Camera
    image_canvas?: HTMLCanvasElement
    image_filename?: string
    enable_3d_export?: boolean
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

  async function handle_3d_export(format: `glb` | `obj`) {
    if (!scene) {
      console.warn(`No scene available for ${format.toUpperCase()} export`)
      return
    }
    try {
      await export_scene_as(scene, format, exports.create_structure_filename(structure))
    } catch (error) {
      console.error(`Failed to export ${format.toUpperCase()}:`, error)
    }
  }

  let wrapper_has_canvas = $state(false)

  $effect(() => observe_canvas_presence(wrapper, (val) => (wrapper_has_canvas = val)))
  let has_canvas = $derived(Boolean(image_canvas) || wrapper_has_canvas)

  const fractional_reason = $derived(exports.fractional_export_unavailable_reason(structure))
  const xyz_reason = $derived(exports.xyz_export_unavailable_reason(structure))

  function handle_text_export(format: StructTextFormat) {
    if (!structure) return
    try {
      exports.export_structure_as(format, structure)
    } catch (error) {
      console.error(`Failed to export ${format.toUpperCase()}:`, error)
    }
  }

  let prediction_error = $state(``)
  function prediction_text(): string | null {
    prediction_error = ``
    try {
      return prediction ? prediction_to_json(prediction) : null
    } catch (error) {
      prediction_error = `Export failed: ${String(error)}. Correct the prediction metadata and retry.`
      return null
    }
  }

  const sections = $derived<ExportSection[]>([
    ...(prediction
      ? [
          {
            title: `Prediction`,
            items: [
              {
                label: `Export prediction`,
                hint: `JSON with input structure, site properties, density grids, model/version, units and calculation settings`,
                on_download: () => {
                  const content = prediction_text()
                  if (prediction && content)
                    download(
                      content,
                      `prediction-${prediction.run_id}.json`,
                      `application/json`,
                    )
                },
                copy_text: prediction_text,
              },
            ],
          },
        ]
      : []),
    {
      title: `Export as text`,
      items: text_export_formats.map(({ label, format, hint }) => {
        const disabled_reason = !structure
          ? `No structure loaded`
          : format === `xyz`
            ? xyz_reason
            : format === `json`
              ? undefined
              : fractional_reason
        return {
          label,
          hint,
          disabled: Boolean(disabled_reason),
          disabled_reason,
          on_download: () => handle_text_export(format),
          copy_text: () => get_text_content(format),
        }
      }),
    },
    {
      title: `Export as image`,
      items: [
        {
          label: `PNG`,
          disabled: !has_canvas,
          disabled_reason: has_canvas ? undefined : `Waiting for the 3D view to render`,
          show_dpi: true,
          on_download: () => {
            const canvas = image_canvas ?? wrapper?.querySelector(`canvas`)
            if (canvas) {
              export_canvas_as_png(
                canvas,
                image_filename ?? structure,
                png_dpi,
                image_canvas ? null : scene,
                image_canvas ? null : camera,
              )
            } else console.warn(`Canvas element not found for PNG export`)
          },
        },
      ],
    },
    ...(enable_3d_export
      ? [
          {
            title: `Export as 3D model`,
            items: model_3d_formats.map(({ label, format, hint }) => ({
              label,
              hint,
              disabled: !scene,
              disabled_reason: scene ? undefined : `Waiting for the 3D view to render`,
              on_download: () => handle_3d_export(format),
            })),
          },
        ]
      : []),
  ])
</script>

{#if prediction_error}<p role="alert">{prediction_error}</p>{/if}

<ExportPane
  bind:export_pane_open
  bind:png_dpi
  {sections}
  {pane_props}
  toggle_props={{
    title: export_pane_open ? `` : enable_3d_export ? `Export Structure` : `Export Slice`,
    ...toggle_props,
    class: [`structure-export-toggle`, toggle_props?.class],
  }}
  {...rest}
>
  {#if prediction && (on_reset_prediction_surfaces || on_clear_prediction)}
    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap">
      {#if on_reset_prediction_surfaces}
        <button onclick={on_reset_prediction_surfaces}>Reset prediction surfaces</button>
      {/if}
      {#if on_clear_prediction}
        <button onclick={on_clear_prediction}>Clear prediction</button>
      {/if}
    </div>
  {/if}
</ExportPane>
