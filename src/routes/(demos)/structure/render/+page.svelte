<script lang="ts">
  import { DEFAULT_PNG_DPI } from '#lib/constants.js'
  import { open_material, type MaterialSource } from '#lib/file-viewer/open.js'
  import { DEFAULT_ISOSURFACE_SETTINGS } from '#lib/isosurface/types.js'
  import { canvas_to_png_blob, set_png_dpi } from '#lib/io/export.js'
  import {
    apply_structure_material,
    Structure,
    type AnyStructure,
    type StructureDocument,
  } from '#lib/structure/index.js'
  import {
    analyze_structure_symmetry,
    default_sym_settings,
    ensure_moyo_wasm_ready,
    transform_cell,
    type CellType,
    type SymmetrySettings,
  } from '#lib/symmetry/index.js'
  import { materialize_frame_result } from '#lib/trajectory/index.js'
  import type { ComponentProps } from 'svelte'

  type StructureProps = Partial<ComponentProps<typeof Structure>>
  const MIME_TYPES = { png: `image/png`, webp: `image/webp`, jpeg: `image/jpeg` } as const
  type ImageFormat = keyof typeof MIME_TYPES
  type SnapshotOptions = {
    png_dpi?: number
    format?: ImageFormat
    quality?: number // 0..1, for webp and jpeg
    frame?: number // trajectory frame to show
    hdf5_group_path?: string // for HDF5 files holding several trajectories
  }

  // Props an exported still never wants: controls, panes and overlays live outside the canvas
  const base_props: StructureProps = {
    show_controls: false,
    enable_info_pane: false,
    fullscreen_toggle: false,
    show_host_tool: false,
    site_sidebar: false, // it docks beside the canvas for sites with forces or moments
    background_opacity: 1, // a still's background_color is solid (the viewer's default is 0.1)
  }
  // One Structure per render ({#key}), so no state (camera, analysis, errors) carries over
  let material = $state.raw<StructureDocument>()
  let props = $state.raw<StructureProps>(base_props)
  let render_token = $state.raw<object>()
  let rendered_token: unknown // the last scene StructureScene acknowledged as drawn
  let viewer = $state<ReturnType<typeof Structure>>()
  let stage = $state<HTMLDivElement>()

  const until = async (ready: () => boolean, what: string, timeout_ms = 60_000) => {
    const deadline = performance.now() + timeout_ms
    while (!ready()) {
      if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
      await new Promise(requestAnimationFrame)
    }
  }

  // Whatever the viewer opens (any text, compressed or binary format) as the document it
  // would show: a structure, a volumetric file's structure with its fields and default
  // isosurfaces (the caller's layers win), or one trajectory frame
  async function load_material(
    source: MaterialSource,
    { frame = 0, hdf5_group_path }: SnapshotOptions,
    isosurface_settings: StructureProps[`isosurface_settings`],
  ): Promise<{ loaded: StructureDocument; filename: string }> {
    const opened = await open_material(source, { hdf5_group_path })
    const { filename } = opened.provenance
    const empty = {
      structure: undefined,
      volumetric_data: undefined,
      isosurface_settings: { ...DEFAULT_ISOSURFACE_SETTINGS, ...isosurface_settings },
      active_volume_id: undefined,
    }
    try {
      if (opened.type !== `trajectory`)
        return { loaded: apply_structure_material(empty, opened).document, filename }
      const { frame_count } = opened.data
      if (!Number.isInteger(frame) || frame < 0 || frame >= frame_count)
        throw new Error(`${frame_count} frames, no frame ${frame}`)
      const { structure } = await materialize_frame_result(opened.data.read_frame(frame))
      return { loaded: { ...empty, structure }, filename }
    } finally {
      opened.dispose()
    }
  }

  // The conventional or primitive cell, computed here rather than by Structure so a failed
  // analysis throws instead of quietly drawing the input cell (volumes keep their frame
  // either way)
  async function to_cell(
    structure: AnyStructure,
    cell_type: CellType = `original`,
    settings: Partial<SymmetrySettings> = {},
  ): Promise<AnyStructure> {
    if (cell_type === `original` || !(`lattice` in structure)) return structure
    await ensure_moyo_wasm_ready()
    const sym_data = await analyze_structure_symmetry(structure, {
      ...default_sym_settings,
      ...settings,
    })
    return transform_cell(structure, cell_type, sym_data)
  }

  // The canvas is transparent (Structure paints its background in CSS), so a background is
  // composited here; JPEG has no alpha, so it starts from white. A browser that cannot
  // encode a type returns PNG instead, which throws rather than mislabels the file.
  async function encode(
    png: Blob,
    format: ImageFormat,
    {
      quality,
      png_dpi,
      background,
    }: { quality: number; png_dpi: number; background?: string },
  ) {
    const fills = [format === `jpeg` && `#ffffff`, background].filter(Boolean)
    if (format === `png` && !fills.length) return png
    const bitmap = await createImageBitmap(png)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext(`2d`)
    if (!ctx) throw new Error(`Canvas 2D context not available`)
    for (const fill of fills) {
      ctx.fillStyle = String(fill)
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: MIME_TYPES[format], quality })
    if (blob.type !== MIME_TYPES[format])
      throw new Error(`This browser cannot encode ${format}`)
    // convertToBlob drops the pHYs chunk; restore the requested DPI on a composited PNG
    return format === `png` ? set_png_dpi(blob, png_dpi) : blob
  }

  // Automation entry point for `pnpm snapshot`: open a source (a File, URL or `{ data,
  // filename }` payload), show it with the given Structure props, wait for that exact scene
  // to render, then export the canvas at `png_dpi` through the export pane's own path (a
  // re-render at that pixel ratio). Returns the image and the drawn cell's site count.
  // Exposed as window.matterviz_snapshot.render(source, snapshot_options, structure_props) for
  // other automation; the render_token wait also covers isosurfaces meshed in a worker.
  async function render(
    source: MaterialSource,
    snapshot: SnapshotOptions = {},
    options: StructureProps = {},
  ) {
    const { png_dpi = DEFAULT_PNG_DPI, format = `png`, quality = 0.9 } = snapshot
    if (!(format in MIME_TYPES)) throw new Error(`Unknown image format ${format}`)
    // these show other panes or several views, not one exportable canvas
    if ((options.display_mode ?? `structure`) !== `structure` || options.multi_view)
      throw new Error(`Snapshots draw display_mode "structure" without multi_view`)
    const { loaded, filename } = await load_material(
      source,
      snapshot,
      options.isosurface_settings,
    )
    if (!loaded.structure?.sites.length) throw new Error(`no sites in ${filename}`)
    const structure = await to_cell(
      loaded.structure,
      options.cell_type,
      options.symmetry_settings,
    )
    const token = {}
    material = { ...loaded, structure }
    props = {
      ...base_props,
      ...options,
      cell_type: `original`,
      scene_props: { gizmo: false, ...options.scene_props },
    }
    render_token = token
    await until(() => rendered_token === token, `${filename} to render`)
    const isosurface_error = viewer?.analysis.isosurface_error
    if (isosurface_error) throw new Error(isosurface_error)
    const canvas = stage?.querySelector(`canvas`)
    const wrapper = stage?.querySelector(`[aria-label="Structure viewer"]`)
    if (!canvas || !wrapper) throw new Error(`Structure canvas not found`)
    const png = await canvas_to_png_blob(canvas, png_dpi)
    // resolved by the browser as Structure styled it (any CSS color, with its opacity)
    const background = options.background_color
      ? getComputedStyle(wrapper).backgroundColor
      : undefined
    const blob = await encode(png, format, { quality, png_dpi, background })
    const data_url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.addEventListener(`load`, () => resolve(String(reader.result)))
      reader.addEventListener(`error`, () => reject(reader.error))
      reader.readAsDataURL(blob)
    })
    return { data_url, sites: structure.sites.length }
  }

  $effect(() => {
    const host = window as typeof window & { matterviz_snapshot?: { render: typeof render } }
    host.matterviz_snapshot = { render }
    return () => {
      delete host.matterviz_snapshot
    }
  })
</script>

<svelte:head><title>Structure snapshot renderer</title></svelte:head>
<!-- the CLI attaches local files here by path (setInputFiles), so none is copied into JS -->
<input id="snapshot-source" type="file" hidden aria-label="Snapshot structure file" />
<div class="snapshot-stage" bind:this={stage}>
  {#key render_token}
    {#if material}
      <Structure
        bind:this={viewer}
        {...props}
        {...material}
        {render_token}
        on_rendered={(token) => (rendered_token = token)}
        style="width: 100%; height: 100%; --struct-height: 100%; --struct-min-width: 0; --struct-border-radius: 0"
      />
    {/if}
  {/key}
</div>

<style>
  .snapshot-stage {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--page-bg);
  }
</style>
