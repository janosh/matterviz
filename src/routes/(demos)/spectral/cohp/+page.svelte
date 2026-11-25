<script lang="ts">
  import { ColorBar, type ColorScaleConfig } from '#lib/plot/index.js'
  import { resolve_color_scale } from '#lib/plot/core/scales.js'
  import { Cohp } from '#lib/spectral/index.js'
  import {
    bonding_strength,
    icohp_bond_colors,
    type LobsterKind,
    lobster_quantity_label,
    orbital_key,
    parse_lobster_files,
  } from '#lib/spectral/lobster.js'
  import { plot_color } from '#lib/colors/index.js'
  import { as_text, decompress_file } from '#lib/io/decompress.js'
  import { Structure } from '#lib/structure/index.js'
  import FilePicker from '#lib/FilePicker.svelte'
  import { sanitize_html } from '#lib/sanitize.js'
  import { format_num } from 'svelte-widgets/format'
  import { hover_links, join_hover_link } from '#lib/tooltip/hover-link.svelte.js'
  import { type LobsterSample, lobster_samples } from '#site/electronic/lobster/index.js'
  import { url_selection } from '#site/state.svelte.js'

  const DROPPED = `your files`
  // the bundled sample in ?sample=; dropped files show instead while `show_dropped`
  const sample_key = url_selection(`sample`, Object.keys(lobster_samples))
  let show_dropped = $state(false)
  // raw: a deep proxy would wrap the parsed structure, read on every frame
  let dropped = $state.raw<LobsterSample | null>(null)
  let drop_error = $state<string | null>(null)
  const sample = $derived<LobsterSample>(
    show_dropped && dropped ? dropped : lobster_samples[sample_key.value],
  )
  // COHP, COOP or COBI, among those the sample has (it has at least one)
  const kinds = $derived([...sample.by_kind.keys()])
  let chosen_kind = $state<LobsterKind>(`COHP`)
  const kind = $derived(kinds.includes(chosen_kind) ? chosen_kind : kinds[0])
  const { cohp, icohp } = $derived(sample.by_kind.get(kind) ?? [...sample.by_kind.values()][0])
  const structure = $derived(sample.structure)

  let show_average = $state(false)
  // LOBSTER lists symmetry-equivalent pairs separately; show the first of each group (same
  // atoms and length) by default. Writable: the table's checkboxes edit it until the data changes
  let hidden_bonds = $derived.by(() => {
    const groups = new Set<string>()
    return cohp.bonds.flatMap(({ label, atoms, length }) => {
      const key = `${atoms[0].label}-${atoms[1].label}-${Math.round(length * 1e3)}`
      if (groups.has(key)) return [label]
      groups.add(key)
      return []
    })
  })
  // orbital-resolved curves (Cohp `bonds` keys) checked in the table, none for new data
  let shown_orbitals = $derived.by((): string[] => (void cohp, []))
  // pairs (or orbital pairs, by key) pinned by clicking their curve or table row
  let picked_bonds = $state<string[]>([])
  let hovered_bond = $state<string | null>(null)
  // Atoms hovered in the structure arrive as unit-cell site indices (image atoms resolve to the
  // site they copy) over a hover-link channel the Structure joins
  hover_links()
  const atom_link = join_hover_link(() => `cohp-atoms`, `number`)

  const pair_by_label = $derived(
    new Map(icohp ? icohp.entries.map((entry) => [entry.label, entry]) : []),
  )
  // LOBSTER 2 lists carry no translations: their column would be a dash in every row
  const has_translations = $derived(
    icohp?.entries.some(({ translation }) => translation !== null) ?? false,
  )
  // pairs of the atom hovered in the structure
  const site_bonds = $derived(
    cohp.bonds
      .filter(({ atoms }) => atoms.some((atom) => atom.site_idx === atom_link.linked))
      .map(({ label }) => label),
  )
  // the Average curve has no bonds, so hovering it highlights none
  const highlighted_set = $derived(
    new Set([
      ...picked_bonds,
      ...site_bonds,
      ...(hovered_bond && hovered_bond !== `average` ? [hovered_bond] : []),
    ]),
  )

  // atoms of the highlighted pairs and orbital pairs (keys `<pair>:<orbitals>`)
  const highlighted_pairs = $derived(
    new Set([...highlighted_set].map((key) => key.split(`:`)[0])),
  )
  const highlighted_atoms = $derived(
    cohp.bonds
      .filter(({ label }) => highlighted_pairs.has(label))
      .flatMap(({ atoms }) => atoms),
  )
  // DOSCAR.lobster beside the curves: the total DOS and the highlighted pairs' atoms' DOS
  const dos = $derived(sample.dos)
  const doses = $derived(
    dos
      ? {
          Total: dos.total,
          ...Object.fromEntries(
            highlighted_atoms.map(
              ({ label, site_idx }) => [label, dos.atoms[site_idx].total] as const,
            ),
          ),
        }
      : undefined,
  )
  // bonding strength (-ICOHP for COHP) color scale over the pairs' range
  const strength_range = $derived.by((): [number, number] => {
    const values = icohp?.entries.map((entry) => bonding_strength(entry, kind)) ?? []
    if (values.length === 0) return [0, 1]
    const [lo, hi] = [Math.min(...values), Math.max(...values)]
    return lo === hi ? [lo - 0.5, hi + 0.5] : [lo, hi]
  })
  const color_scale = $derived<ColorScaleConfig>({
    scheme: `interpolatePlasma`,
    value_range: strength_range,
  })
  const { color_fn } = $derived(resolve_color_scale(color_scale, strength_range))
  const strength_label = $derived(lobster_quantity_label(kind, true))
  // One callback per dataset: highlighting re-runs only the bond recoloring that reads
  // highlighted_set inside it, never the bond matching set up here. Other pairs' bonds fade to
  // gray while some pair is highlighted.
  const bond_colors = $derived(
    icohp && structure
      ? icohp_bond_colors(icohp, structure, (strength, { label }) =>
          highlighted_pairs.size > 0 && !highlighted_pairs.has(label)
            ? `#c8c8c8`
            : color_fn(strength),
        )
      : undefined,
  )
  // changes per dataset only (hover-driven recoloring happens inside bond_colors), so Structure
  // isn't handed a new settings object on every hover
  const scene_props = $derived({ show_bonds: `always` as const, bond_colors })
  const hidden_set = $derived(new Set(hidden_bonds))
  const drawn_keys = $derived([
    ...cohp.bonds.map(({ label }) => label).filter((label) => !hidden_set.has(label)),
    ...shown_orbitals,
  ])
  // Cohp colors the drawn curves by position
  const drawn_idx_of = $derived(new Map(drawn_keys.map((key, idx) => [key, idx])))

  const toggle = (list: string[], label: string): string[] =>
    list.includes(label) ? list.filter((item) => item !== label) : [...list, label]
  const reset_picks = () => {
    picked_bonds = []
    hovered_bond = null
    drop_error = null
  }

  async function load_files(files: FileList | File[]) {
    try {
      const loaded = await Promise.all([...files].map(decompress_file))
      const texts = loaded.map(({ filename, content }) => [filename, as_text(content)])
      dropped = {
        ...parse_lobster_files(Object.fromEntries(texts)),
        name: loaded.map(({ filename }) => filename).join(`, `),
        source: null,
      }
      show_dropped = true
      reset_picks()
    } catch (error) {
      drop_error = error instanceof Error ? error.message : String(error)
    }
  }
</script>

<h1 id="cohp">COHP / COOP / COBI Bonding Analysis</h1>

<p>
  Crystal orbital Hamilton populations (COHP) from <a href="http://www.cohp.de">LOBSTER</a>
  split the band energy into bonding and antibonding contributions per atom pair. The plot shows
  −COHP so bonding states point right; −ICOHP, the integral up to the Fermi level, colors the bonds
  in the structure. Switch to COOP (overlap populations) or COBI (bond indices), both bonding positive
  as-is, where the files include them. Click a curve or a pair below to highlight its bond, hover
  atoms to highlight their pairs, and expand a pair to plot its orbital-resolved curves. Drop your
  own <code>COHPCAR.lobster</code>, <code>ICOHPLIST.lobster</code>, <code>POSCAR</code> and
  <code>DOSCAR.lobster</code> (or a whole LOBSTER output folder) anywhere on the page: the DOS then
  shows beside the curves on their energy axis, with the highlighted pairs' atoms.
</p>

<svelte:window
  ondragover={(event) => event.preventDefault()}
  ondrop={(event) => {
    event.preventDefault()
    if (event.dataTransfer?.files.length) void load_files(event.dataTransfer.files)
  }}
/>

<div class="demo-controls">
  <FilePicker
    files={[...Object.keys(lobster_samples), ...(dropped ? [DROPPED] : [])].map((name) => ({
      name,
      url: ``,
      type: `lobster`,
    }))}
    active_files={[show_dropped ? DROPPED : sample_key.value]}
    on_click={({ name }) => {
      show_dropped = name === DROPPED
      if (!show_dropped) sample_key.value = name
      reset_picks()
    }}
  />
  <!-- a compact button, not the wide native file input (files also drop anywhere) -->
  <label class="open-files">
    Open files…
    <input
      type="file"
      multiple
      hidden
      aria-label="LOBSTER files"
      onchange={(event) => {
        const { files } = event.currentTarget
        if (files?.length) void load_files(files)
      }}
    />
  </label>
  {#if kinds.length > 1}
    <label>
      Quantity
      <select bind:value={chosen_kind}>
        {#each kinds as option (option)}<option value={option}>{option}</option>{/each}
      </select>
    </label>
  {/if}
  <label><input type="checkbox" bind:checked={show_average} /> Average</label>
</div>
{#if drop_error}
  <p style="color: light-dark(#c62828, #ff8a80); text-align: center">{drop_error}</p>
{/if}
<p class="source">
  {#if sample.source}
    <!-- SOURCE.txt is bundled site data; its markdown links become anchors -->
    Data: {@html sanitize_html(
      sample.source.replaceAll(/\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/g, `<a href="$2">$1</a>`),
    )}
  {:else}
    Your files: {sample.name}
  {/if}
  {#if sample.ignored.length > 0}(ignored: {sample.ignored.join(`, `)}){/if}
</p>

<div class="bleed-1400 cohp-demo">
  <section>
    {#if structure}
      <Structure
        {structure}
        link_hover="cohp-atoms"
        highlighted_sites={highlighted_atoms.map(({ site_idx }) => site_idx)}
        {scene_props}
        style="height: 460px"
      />
      {#if icohp}
        <ColorBar
          title={strength_label}
          {color_scale}
          tick_labels={5}
          snap_ticks={false}
          wrapper_style="margin: 1em auto; width: 70%"
        />
      {/if}
    {:else}
      <p>No structure: drop a POSCAR with the LOBSTER files to see ICOHP-colored bonds.</p>
    {/if}
  </section>
  <Cohp
    {cohp}
    bonds={drawn_keys}
    {doses}
    {show_average}
    highlighted_bonds={[...highlighted_set]}
    bind:hovered_bond
    on_bond_click={(label) => (picked_bonds = toggle(picked_bonds, label))}
    style="height: 560px"
  />
</div>

<table class="pairs">
  <thead>
    <tr>
      <th>Show</th>
      <th>#</th>
      <th>Pair</th>
      <th>Length (Å)</th>
      {#if has_translations}<th>Translation</th>{/if}
      <th>{strength_label}</th>
    </tr>
  </thead>
  <tbody>
    {#each cohp.bonds as bond (bond.label)}
      {@const pair = pair_by_label.get(bond.label)}
      {@const strength = pair && bonding_strength(pair, kind)}
      {@const drawn_idx = drawn_idx_of.get(bond.label)}
      <tr
        class={{ highlighted: highlighted_set.has(bond.label) }}
        onclick={(event) => {
          // clicks in a pair's orbital list don't pick the pair
          if (!(event.target instanceof Element && event.target.closest(`details`)))
            picked_bonds = toggle(picked_bonds, bond.label)
        }}
        onmouseenter={() => (hovered_bond = bond.label)}
        onmouseleave={() => (hovered_bond = null)}
      >
        <td>
          <input
            type="checkbox"
            checked={!hidden_set.has(bond.label)}
            onclick={(event) => event.stopPropagation()}
            onchange={() => (hidden_bonds = toggle(hidden_bonds, bond.label))}
            aria-label="Show pair {bond.label}"
          />
        </td>
        <td style:color={drawn_idx === undefined ? null : plot_color(drawn_idx)}>
          {drawn_idx === undefined ? `□` : `■`}
          {bond.label}
        </td>
        <td>
          {#if bond.orbitals.length > 0}
            <!-- orbital pairs: checking one plots its curve -->
            <details>
              <summary>{bond.atoms[0].label}–{bond.atoms[1].label}</summary>
              {#each bond.orbitals as { key, orbitals } (key)}
                {@const value = pair?.orbitals.find(
                  (row) => orbital_key(bond.label, row.orbitals) === key,
                )}
                {@const idx = drawn_idx_of.get(key)}
                <label style:display="block">
                  <input
                    type="checkbox"
                    checked={idx !== undefined}
                    onchange={() => (shown_orbitals = toggle(shown_orbitals, key))}
                  />
                  <span style:color={idx === undefined ? null : plot_color(idx)}
                    >{orbitals.join(`–`)}</span
                  >
                  {#if value}{format_num(bonding_strength(value, kind), `.4~f`)}{/if}
                </label>
              {/each}
            </details>
          {:else}{bond.atoms[0].label}–{bond.atoms[1].label}{/if}
        </td>
        <td>{format_num(bond.length, `.4~f`)}</td>
        {#if has_translations}
          <td>{pair?.translation ? `[${pair.translation.join(` `)}]` : `–`}</td>
        {/if}
        <td>
          {#if strength !== undefined}
            <span style:color={color_fn(strength)}>■</span> {format_num(strength, `.4~f`)}
          {:else}–{/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .open-files {
    padding: 2pt 8pt;
    border-radius: var(--border-radius, 4px);
    background: var(--btn-bg);
    cursor: pointer;
    &:hover {
      background: var(--btn-bg-hover);
    }
  }
  .cohp-demo {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 500px), 1fr));
    gap: 1em;
    align-items: start;
  }
  table.pairs {
    margin: 1em auto;
    border-collapse: collapse;
    td,
    th {
      padding: 2px 10px;
      text-align: left;
    }
    tbody tr {
      cursor: pointer;
      &:hover,
      &.highlighted {
        background: light-dark(#eef4ff, #1e2a40);
      }
    }
  }
  .source {
    max-width: 60em;
    margin: 0.5em auto;
    font-size: 0.9em;
    text-align: center;
  }
</style>
