<script lang="ts">
  import type { Crystal, FileInfo } from '$lib'
  import FilePicker from '$lib/FilePicker.svelte'
  import MillerIndexInput from '$lib/MillerIndexInput.svelte'
  import { plot_color, PLOT_COLORS } from '$lib/colors'
  import { file_type_paint } from '$lib/io'
  import { format_num } from '$lib/labels'
  import type { Vec3 } from '$lib/math'
  import { Structure } from '$lib/structure'
  import type { SaedOptions, SaedPatternData, XrdPattern } from '$lib/xrd'
  import {
    compute_saed_pattern,
    compute_xrd_pattern,
    electron_wavelength,
    SaedPattern,
    XrdPlot,
  } from '$lib/xrd'
  import { structure_map, structures } from '$site/structures'
  import { SvelteMap } from 'svelte/reactivity'
  import { to_error } from '$lib/utils'
  import { fixture_ext, site_file_info } from '$site/imports'
  import StructurePicker, { formula_for, hex_with_alpha } from '../../StructurePicker.svelte'

  // static/xrd symlinks these fixtures so the globbed files remain available at /xrd/<name>.
  const xrd_file_modules = import.meta.glob(
    `$site/xrd/*.{xy,xye,xrdml,brml,ras,uxd,UXD,gsas,gsa,gda,raw,dat,csv,asc,txt,fxye,xy.gz,xye.gz,xrdml.gz,brml.gz,ras.gz,uxd.gz,UXD.gz,gsas.gz,gsa.gz,gda.gz,raw.gz,dat.gz,csv.gz,asc.gz,txt.gz,fxye.gz}`,
    { query: `?url` },
  )

  // Extension -> how FilePicker groups, labels and tints that format; one table so category
  // and swatch color cannot drift apart. Unlisted extensions fall back to plain ASCII.
  type XrdFormat = { category: string; icon: string; color: string }
  const ascii = { category: `Powder XRD`, icon: `📊` }
  const gsas = { category: `GSAS/Rietveld`, icon: `🔬`, color: `rgba(255, 215, 0, 0.8)` }
  const xrd_formats: Record<string, XrdFormat> = {
    xy: { ...ascii, color: `rgba(50, 205, 50, 0.8)` },
    xye: { ...ascii, color: `rgba(34, 139, 34, 0.8)` }, // darker green: XY with errors
    csv: { ...ascii, color: `rgba(46, 139, 87, 0.8)` },
    dat: { ...ascii, color: `rgba(100, 149, 237, 0.8)` },
    asc: { ...ascii, color: `rgba(147, 112, 219, 0.8)` },
    txt: { ...ascii, color: `rgba(128, 128, 128, 0.8)` },
    gsas,
    gsa: gsas,
    gda: gsas,
    fxye: gsas,
    xrdml: { category: `PANalytical`, icon: `🇳🇱`, color: `rgba(70, 130, 180, 0.8)` },
    brml: { category: `Bruker HRXRD`, icon: `🔬`, color: `rgba(255, 140, 0, 0.8)` },
    raw: { category: `Bruker Binary`, icon: `📦`, color: `rgba(255, 99, 71, 0.8)` },
    ras: { category: `Rigaku`, icon: `🇯🇵`, color: `rgba(138, 43, 226, 0.8)` },
    uxd: { category: `Siemens`, icon: `🇩🇪`, color: `rgba(220, 20, 60, 0.8)` },
  }
  const xrd_file_paints = Object.fromEntries(
    Object.entries(xrd_formats).map(([ext, { color }]) => [ext, file_type_paint(color)]),
  )

  // Convert glob results to FileInfo array
  const xrd_data_files: FileInfo[] = Object.keys(xrd_file_modules).map((path) => {
    const ext = fixture_ext(path)
    const { category, icon } = xrd_formats[ext] ?? ascii
    return site_file_info(path, { type: ext, category, category_icon: icon })
  })

  // Cache computed XRD patterns to avoid recomputation when navigating structures. Writing
  // the cache is a side effect, so every caller runs inside an $effect, never a $derived.
  const xrd_cache = new SvelteMap<string, XrdPattern>()
  const ensure_pattern = (struct_id: string): XrdPattern | null => {
    const cached = xrd_cache.get(struct_id)
    if (cached) return cached
    const struct = structure_map.get(struct_id)
    if (!struct) return null
    const pattern = compute_xrd_pattern(struct)
    xrd_cache.set(struct_id, pattern)
    return pattern
  }

  // On-the-fly computed patterns
  const compute_ids = structures.map((struct) => struct.id ?? ``)
  let compute_id = $state<string>(compute_ids[0] || ``)
  const computed_struct = $derived<Crystal | null>(structure_map.get(compute_id) ?? null)
  let compute_error = $state<string | null>(null)
  let computed_pattern = $state<XrdPattern | null>(null)
  $effect(() => {
    try {
      computed_pattern = ensure_pattern(compute_id)
      compute_error = null
    } catch (exc) {
      compute_error = to_error(exc).message
      computed_pattern = null
    }
  })

  // Radiation comparison: the same structure probed with X-rays, neutrons and electrons.
  // XrdPlot already accepts an array of patterns, so overlaying them needs no plot changes.
  let probe_wavelength = $state(1.54184) // Å, shared so peak positions line up exactly
  let show_neutron = $state(true)
  let show_electron = $state(false)
  const radiation_overlay = $derived.by(() => {
    const struct = computed_struct
    const entries: { label: string; pattern: XrdPattern; color: string }[] = []
    const errors: string[] = []
    if (!struct) return { entries, errors }

    const requested = [
      [`xray`, `X-ray`, PLOT_COLORS[0], true],
      [`neutron`, `Neutron`, PLOT_COLORS[1], show_neutron],
      [`electron`, `Electron`, PLOT_COLORS[2], show_electron],
    ] as const
    for (const [radiation, label, color, enabled] of requested) {
      if (!enabled) continue
      try {
        const pattern = compute_xrd_pattern(struct, {
          radiation,
          wavelength: probe_wavelength,
          two_theta_range: [0, 90],
        })
        entries.push({ label: `${label} (λ = ${probe_wavelength} Å)`, pattern, color })
      } catch (exc) {
        errors.push(`${label}: ${to_error(exc).message}`)
      }
    }
    return { entries, errors }
  })

  // SAED: zone-axis electron diffraction for the currently selected structure
  let zone_axis = $state<Vec3>([0, 0, 1])
  let accelerating_voltage = $state(200)
  let max_g = $state(2)
  let crystal_thickness = $state(50)
  // compute_saed_pattern is synchronous and runs on the main thread, so recomputing on every
  // keystroke of these number inputs would freeze the page. Settle first, then compute.
  let saed_options = $state<SaedOptions>({})
  $effect(() => {
    const next: SaedOptions = {
      zone_axis: [...zone_axis],
      accelerating_voltage,
      max_g,
      crystal_thickness,
    }
    const timer = setTimeout(() => (saed_options = next), 250)
    return () => clearTimeout(timer)
  })
  const saed = $derived.by((): { pattern: SaedPatternData | null; error: string | null } => {
    const struct = computed_struct
    if (!struct) return { pattern: null, error: null }
    try {
      return { pattern: compute_saed_pattern(struct, saed_options), error: null }
    } catch (exc) {
      return { pattern: null, error: to_error(exc).message }
    }
  })

  // Multi-select demo: allow overlaying multiple structures
  let selected_ids = $state<string[]>(compute_ids.slice(0, 4))
  // Fill cache for all selected structures (side-effect done outside of $derived)
  $effect(() => {
    for (const struct_id of selected_ids) {
      try {
        ensure_pattern(struct_id)
      } catch (exc) {
        console.error(`Failed to compute XRD for ${struct_id}`, exc)
      }
    }
  })
  let selected_patterns = $derived(
    selected_ids.flatMap((struct_id) => {
      const pattern = xrd_cache.get(struct_id)
      return pattern ? [{ label: `${struct_id} ${formula_for(struct_id)}`, pattern }] : []
    }),
  )
</script>

<h1>XRD Patterns</h1>

<div class="bleed-1400">
  <StructurePicker bind:selected={compute_id} />
  <section>
    <XrdPlot
      patterns={computed_pattern
        ? [
            {
              label: `${compute_id} ${formula_for(compute_id)}`,
              pattern: computed_pattern,
            },
          ]
        : []}
      annotate_peaks={3}
      hkl_format="compact"
      style="height: 600px"
    />
    {#if compute_error}
      <p>Compute error: {compute_error}</p>
    {/if}
    {#if computed_struct}
      <Structure structure={computed_struct} style="height: 600px" />
    {/if}
  </section>

  <h2>X-ray vs neutron vs electron</h2>
  <p>
    Equal wavelengths keep peak positions aligned while probe-specific scattering factors
    change their intensities: the negative <code>b_coh</code> of H, Li, Ti, V and Mn can invert which
    reflection is strongest for neutrons, and electron factors come from Mott–Bethe. Electron wavelengths
    are normally much shorter; this comparison deliberately shares λ.
  </p>
  <div class="demo-controls">
    <label>
      λ (Å)
      <input type="number" min="0.1" max="5" step="0.001" bind:value={probe_wavelength} />
    </label>
    <label><input type="checkbox" bind:checked={show_neutron} /> Neutron</label>
    <label><input type="checkbox" bind:checked={show_electron} /> Electron</label>
  </div>
  {#each radiation_overlay.errors as message (message)}
    <p class="error">{message}</p>
  {/each}
  <XrdPlot
    patterns={radiation_overlay.entries}
    annotate_peaks={4}
    hkl_format="compact"
    style="height: 420px"
  />

  <h2>Electron diffraction (SAED)</h2>
  <p>
    {compute_id} viewed down [uvw] at {accelerating_voltage} kV (λ = {format_num(
      electron_wavelength(accelerating_voltage),
      `.4~`,
    )} Å).
  </p>
  <div class="demo-controls">
    <MillerIndexInput bind:value={zone_axis} />
    <label>
      kV
      <input type="number" min="10" max="1000" step="10" bind:value={accelerating_voltage} />
    </label>
    <label>
      max |g| (1/Å)
      <input type="number" min="0.5" max="5" step="0.25" bind:value={max_g} />
    </label>
    <label>
      thickness (Å)
      <input type="number" min="5" max="500" step="5" bind:value={crystal_thickness} />
    </label>
    {#each [[0, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0]] as const as preset (preset.join(``))}
      <button onclick={() => (zone_axis = [...preset])}>[{preset.join(``)}]</button>
    {/each}
  </div>
  {#if saed.error}
    <p class="error">SAED error: {saed.error}</p>
  {:else if saed.pattern}
    <section>
      <SaedPattern pattern={saed.pattern} style="height: 520px" />
      {#if computed_struct}
        <Structure structure={computed_struct} style="height: 520px" />
      {/if}
    </section>
  {/if}

  <h2>Overlay multiple structures</h2>
  <StructurePicker bind:selected={selected_ids} />
  <section>
    <XrdPlot
      patterns={selected_patterns}
      annotate_peaks={3}
      hkl_format="compact"
      style="height: 400px"
    />
    <div class="selected-structures-grid">
      {#each selected_ids as struct_id, idx (struct_id)}
        {@const struct_obj = structure_map.get(struct_id)}
        {@const series_color = plot_color(idx)}
        {#if struct_obj}
          <div
            class="structure-tile"
            style:background-color={hex_with_alpha(series_color, 0.15)}
          >
            <h3>{struct_id}</h3>
            <Structure
              structure={struct_obj}
              style="height: 180px; width: 100%"
              enable_info_pane={false}
              enable_measure_mode={false}
              scene_props={{ gizmo: false }}
            />
          </div>
        {/if}
      {/each}
    </div>
  </section>

  <h2>XRD File Drop Demo</h2>
  <p>
    Drag and drop XRD data files directly onto the plot. Supported formats include:
    <code>.xy</code>, <code>.xye</code>, <code>.csv</code>, <code>.dat</code>,
    <code>.asc</code>, <code>.txt</code> (ASCII),
    <code>.ras</code> (Rigaku), <code>.uxd</code> (Siemens), <code>.gsas</code>/<code
      >.gsa</code
    >
    (GSAS),
    <code>.xrdml</code> (PANalytical), <code>.brml</code>/<code>.raw</code> (Bruker). Gzipped
    versions (<code>.xy.gz</code>, etc.) are also supported.
  </p>
  <section>
    <FilePicker
      files={xrd_data_files}
      file_type_paints={xrd_file_paints}
      show_category_filters
    />
    <XrdPlot
      patterns={[]}
      annotate_peaks={5}
      hkl_format="compact"
      style="height: 500px; width: 100%; min-width: 0"
    />
  </section>
</div>

<style>
  .demo-controls {
    label {
      gap: 0.4em;
      font-size: 0.9em;
    }
    input[type='number'] {
      width: 6em;
      padding: 0.15em 0.3em;
      border: 1px solid var(--border-color, #ccc);
      border-radius: 4px;
      background: transparent;
      color: inherit;
    }
    button {
      font-size: 0.8em;
      padding: 4px 8px;
      border: 1px dotted var(--text-color-muted);
      background: transparent;
    }
  }
  .error {
    color: var(--error-color, crimson);
    text-align: center;
  }
  .bleed-1400 > section {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1em;
    /* Structure has a 300px floor, so two columns overflow phone widths */
    @media (max-width: 700px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .selected-structures-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
    gap: 0.5em;
    align-content: start;
  }
  .structure-tile {
    border-radius: 4px;
    position: relative;
    h3 {
      margin: 0;
      font-size: 14px;
      position: absolute;
      top: 3pt;
      left: 1ex;
    }
  }
</style>
