<script lang="ts">
  import type { FileInfo, PymatgenStructure } from '$lib'
  import { FilePicker } from '$lib'
  import { PLOT_COLORS } from '$lib/colors'
  import { get_electro_neg_formula } from '$lib/composition'
  import { Structure } from '$lib/structure'
  import type { XrdPattern } from '$lib/xrd'
  import { compute_xrd_pattern, XrdPlot } from '$lib/xrd'
  import { structures } from '$site/structures'
  import { SvelteMap } from 'svelte/reactivity'

  // Auto-discover XRD data files from static/xrd/ using Vite's import.meta.glob
  // Files are picked up at build time; restart dev server to see new files
  const xrd_file_modules = import.meta.glob(`/static/xrd/*.{xy,xye,xrdml,brml}`, {
    query: `?url`,
    eager: true,
    import: `default`,
  }) as Record<string, string>

  // Convert glob results to FileInfo array
  const xrd_data_files: FileInfo[] = Object.entries(xrd_file_modules).map(
    ([path, url]) => {
      const name = path.split(`/`).pop() || path
      const ext = name.split(`.`).pop()?.toLowerCase() || ``
      // Categorize by format type
      const category = ext === `brml` ? `HRXRD` : `Powder XRD`
      const category_icon = ext === `brml` ? `🔬` : `📊`
      return { name, url, type: ext, category, category_icon }
    },
  )

  // Custom colors for XRD data file types
  const xrd_file_colors: Record<string, string> = {
    xy: `rgba(50, 205, 50, 0.8)`,
    xye: `rgba(34, 139, 34, 0.8)`, // Darker green for XYE (with errors)
    xrdml: `rgba(70, 130, 180, 0.8)`, // Steel blue for PANalytical
    brml: `rgba(255, 140, 0, 0.8)`,
  }

  // Cache computed XRD patterns to avoid recomputation when navigating structures
  const xrd_cache = new SvelteMap<string, XrdPattern>()
  const get_struct_id = (struct: PymatgenStructure): string =>
    struct.id || JSON.stringify(struct)

  // Map structures by id for O(1) lookup
  const structures_by_id = $derived<Record<string, PymatgenStructure>>(
    Object.fromEntries(structures.map((struct) => [get_struct_id(struct), struct])),
  )

  // Helper: convert #rrggbb to #rrggbbaa
  function hex_with_alpha(hex_color: string, alpha_frac: number): string {
    const clamped = Math.max(0, Math.min(1, alpha_frac))
    const alpha_byte = Math.round(clamped * 255)
    const alpha_hex = alpha_byte.toString(16).padStart(2, `0`)
    return hex_color.length === 7 ? `${hex_color}${alpha_hex}` : hex_color
  }

  // On-the-fly computed patterns
  const compute_ids = structures.map(get_struct_id)
  let compute_id = $state<string>(compute_ids[0] || ``)
  const computed_struct = $derived<PymatgenStructure | null>(
    structures_by_id[compute_id] ?? null,
  )
  let compute_error = $state<string | null>(null)
  let computed_pattern = $state<XrdPattern | null>(null)
  $effect(() => {
    const struct = computed_struct
    if (!struct) {
      computed_pattern = null
      return
    }
    try {
      compute_error = null
      const cached = xrd_cache.get(get_struct_id(struct))
      if (cached) computed_pattern = cached
      else {
        const result = compute_xrd_pattern(struct)
        xrd_cache.set(get_struct_id(struct), result)
        computed_pattern = result
      }
    } catch (exc) {
      compute_error = exc instanceof Error ? exc.message : String(exc)
      computed_pattern = null
    }
  })

  // Multi-select demo: allow overlaying multiple structures
  let selected_ids = $state<string[]>(compute_ids.slice(0, 4))
  function toggle_select(struct_id: string) {
    selected_ids = selected_ids.includes(struct_id)
      ? selected_ids.filter((x) => x !== struct_id)
      : [...selected_ids, struct_id]
  }
  // Fill cache for all selected structures (side-effect done outside of $derived)
  $effect(() => {
    for (const id of selected_ids) {
      const struct = structures_by_id[id]
      if (!struct) continue
      const struct_id = get_struct_id(struct)
      if (!xrd_cache.has(struct_id)) {
        try {
          const pat = compute_xrd_pattern(struct)
          xrd_cache.set(struct_id, pat)
        } catch (exc) {
          console.error(`Failed to compute XRD for ${struct_id}`, exc)
        }
      }
    }
  })
  let selected_patterns = $derived.by(() => {
    const out: { label: string; pattern: XrdPattern }[] = []
    for (const id of selected_ids) {
      const struct = structures_by_id[id]
      if (!struct) continue
      const sid = get_struct_id(struct)
      const pat = xrd_cache.get(sid)
      if (pat) out.push({ label: `${sid} ${formula_for(sid)}`, pattern: pat })
    }
    return out
  })

  // Precomputed carousel removed; computing on the fly below

  function formula_for(id: string): string {
    const struct = structures_by_id[id]
    if (!struct) return ``
    try {
      return get_electro_neg_formula(struct, false)
    } catch {
      return ``
    }
  }
</script>

<h1>XRD Patterns</h1>

<div class="bleed-1400">
  <nav>
    {#each structures as struct (get_struct_id(struct))}
      {@const struct_id = get_struct_id(struct)}
      <button
        class:selected={struct_id === compute_id}
        onclick={() => (compute_id = struct_id)}
        title={struct_id}
      >
        <span class="id">{struct_id}</span>
        <span class="formula">{@html formula_for(struct_id)}</span>
      </button>
    {/each}
  </nav>
  <section>
    <XrdPlot
      patterns={computed_pattern
      ? [{
        label: `${compute_id} ${formula_for(compute_id)}`,
        pattern: computed_pattern,
      }]
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

  <h2>Overlay multiple structures</h2>
  <p>Click on a structure to add it to the overlay.</p>
  <nav>
    {#each structures as struct (get_struct_id(struct))}
      {@const struct_id = get_struct_id(struct)}
      {@const sel_idx = selected_ids.indexOf(struct_id)}
      {@const series_color = sel_idx >= 0
        ? PLOT_COLORS[sel_idx % PLOT_COLORS.length]
        : null}
      {@const btn_bg = series_color ? hex_with_alpha(series_color, 0.15) : null}
      <button
        class:active={sel_idx >= 0}
        onclick={() => toggle_select(struct_id)}
        title={struct_id}
        style:background-color={btn_bg}
      >
        <span class="id">{struct_id}</span>
        <span class="formula">{@html formula_for(struct_id)}</span>
      </button>
    {/each}
  </nav>
  <section>
    <XrdPlot
      patterns={selected_patterns}
      annotate_peaks={3}
      hkl_format="compact"
      style="height: 400px"
    />
    <div class="selected-structures-grid">
      {#each selected_ids as struct_id, idx (struct_id)}
        {@const struct_obj = structures_by_id[struct_id]}
        {@const series_color = PLOT_COLORS[idx % PLOT_COLORS.length]}
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
    Drag and drop <code>.xy</code> (two-column text) or <code>.brml</code> (Bruker) files
    directly onto the XRD plot. Drop a local file from your computer or drag one of these
    sample files:
  </p>
  <section>
    <FilePicker
      files={xrd_data_files}
      file_type_colors={xrd_file_colors}
      show_category_filters
    />
    <XrdPlot
      patterns={[]}
      annotate_peaks={5}
      hkl_format="compact"
      style="height: 500px; flex: 1"
    />
  </section>
</div>

<style>
  .bleed-1400 > section {
    display: grid;
    gap: 1em;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    place-content: center;
    gap: 6px;
    margin: 1em;
  }
  nav button {
    font-size: 0.8em;
    flex: 0 0 auto;
    padding: 6px 8px 3px;
    border: 1px dotted var(--text-color-muted);
    background: transparent;
  }
  nav button.selected {
    outline: 2px solid var(--accent-color, #4e79a7);
  }
  nav .id {
    font-weight: 500;
  }
  nav .formula {
    color: var(--text-color-muted);
    font-size: 0.9em;
  }
  .bleed-1400 > section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1em;
  }
  .selected-structures-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
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
