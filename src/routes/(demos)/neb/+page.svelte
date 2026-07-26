<script lang="ts">
  import {
    analyze_barrier,
    NebPlot,
    NebViewer,
    path_spline,
    reaction_coordinate,
  } from '$lib/neb'
  import { format_num } from '$lib/labels'
  import { LI_MGO_HOP_FILENAME, li_mgo_hop_json, reaction_paths } from '$site/neb'

  let coord_mode = $state<`arc_length` | `image_index`>(`arc_length`)
  let energy_reference = $state<`absolute` | `initial`>(`initial`)
  let show_spline = $state(true)
  let active_path_key = $state(`direct hop`)
  let active_image_idx = $state(0)

  const direct = reaction_paths[`direct hop`]
  const analysis = analyze_barrier(direct)
  const spline = path_spline(direct)

  // Same path measured both ways — the gap is the whole point of the minimum-image convention
  const min_image_coords = reaction_coordinate(direct)
  const cartesian_coords = reaction_coordinate(direct, { metric: `cartesian` })
  const min_image_length = min_image_coords.at(-1) as number
  const cartesian_length = cartesian_coords.at(-1) as number

  // The step where the Li leaves the cell: the one raw subtraction gets most wrong
  const crossing = min_image_coords
    .slice(1)
    .map((coord, idx) => ({
      short: coord - min_image_coords[idx],
      long: cartesian_coords[idx + 1] - cartesian_coords[idx],
    }))
    .reduce((worst, step) =>
      step.long / step.short > worst.long / worst.short ? step : worst,
    )

  const download_fixture = () => {
    const url = URL.createObjectURL(new Blob([li_mgo_hop_json], { type: `application/json` }))
    const link = Object.assign(document.createElement(`a`), {
      href: url,
      download: LI_MGO_HOP_FILENAME,
    })
    link.click()
    URL.revokeObjectURL(url)
  }
</script>

<h1>Reaction Paths (NEB)</h1>

<p>
  A nudged-elastic-band calculation produces an ordered chain of images between two minima.
  Unlike a trajectory these are not frames in time: the x-axis is a reaction coordinate, and
  the quantities of interest are the forward and reverse barriers, the reaction energy, and the
  location of the saddle.
</p>
<p class="fixture-note">
  The path shown below is <strong>synthetic</strong>: no DFT, NEB or MD code produced it. The
  geometries are an ideal rocksalt MgO cell with one Li interstitial walked along a hand-chosen
  route, the energies come from
  <code>E(u) = A·sin²(πu) + 0.18·u</code> eV shifted by a constant &minus;284.317 eV so they read
  like VASP totals, and the forces are that expression's analytic &minus;dE/ds. Every number on this
  page exercises the viewer; none of them describes Li migration in MgO.
</p>

<div class="bleed-1400">
  <NebViewer
    paths={reaction_paths}
    bind:coord_mode
    bind:energy_reference
    bind:show_spline
    bind:active_path_key
    bind:active_image_idx
  />

  <h2>Why the reaction coordinate must be minimum-image</h2>
  <p>
    The migrating Li leaves the cell through the +z face and re-enters at &minus;z. Taking raw
    coordinate differences turns that one {format_num(crossing.short, `.3~`)} Å step into a
    {format_num(crossing.long, `.3~`)} Å jump across almost the whole cell, and inflates the path
    with it:
  </p>
  <dl class="metric-compare">
    <dt>Minimum-image arc length</dt>
    <dd>{format_num(min_image_length, `.4~`)} Å</dd>
    <dt>Raw coordinate subtraction</dt>
    <dd>{format_num(cartesian_length, `.4~`)} Å</dd>
    <dt>Inflation factor</dt>
    <dd>{format_num(cartesian_length / min_image_length, `.3~`)}×</dd>
  </dl>

  <h2>Fitted saddle versus highest image</h2>
  <p>
    The highest computed image is #{analysis.ts_image_idx}, at
    {format_num(analysis.forward_barrier, `.4~`)} eV above the initial state. The
    {spline.method} fit places the saddle
    {format_num(spline.fitted_max.energy - analysis.ts_energy, `.3~`)} eV higher, between images
    #{spline.fitted_max.between_images[0]} and #{spline.fitted_max.between_images[1]}. Quoting
    the fitted value as if an image sat there is a real reporting error, so the two are always
    reported separately.
  </p>

  <h2>Comparing mechanisms</h2>
  <p>
    Both paths in this fixture connect the same endpoints, so they must share a reaction energy
    of +0.18 eV; only the barrier distinguishes them. The direct hop carries forces and is
    fitted with the force-projected spline, the curved hop has energies only and falls back to
    a natural cubic.
  </p>
  <NebPlot paths={reaction_paths} energy_reference="initial" style="height: 420px" />

  <h2>Input format</h2>
  <p>
    Reaction paths are read from <code>matterviz-reaction-path</code> JSON. Drop a file onto
    the viewer above, or drop a multi-frame extended-XYZ file (what
    <code>ase.io.write("neb.xyz", images)</code> writes) — energies come from the
    <code>energy=</code> key on each comment line and forces from a
    <code>forces</code> block in <code>Properties=</code>. Loose single-structure files dropped
    together are assembled into one path in drop order and must each carry a numeric
    <code>properties.energy</code>.
  </p>
  <pre><code
      >{`{
  "format": "matterviz-reaction-path",
  "version": 1,
  "energy_unit": "eV",
  "paths": {
    "direct hop": {
      "label": "direct hop",
      "images": [
        {
          "energy": -284.317,
          "label": "image 0",
          "forces": [[0.0, 0.0, -0.09], ...],
          "structure": { "lattice": { "matrix": [[4.21, 0, 0], ...] }, "sites": [...] }
        }
      ]
    }
  }
}`}</code
    ></pre>
  <p>
    A single path may replace <code>paths</code> with a top-level <code>images</code> array. A
    browser cannot read a directory from a plain drop, so a VASP <code>00/</code>,
    <code>01/</code> … layout has to be converted to one of these formats first.
  </p>
  <button onclick={download_fixture}>Download the synthetic demo fixture</button>
</div>

<style>
  h2,
  p {
    text-align: center;
    max-width: 60em;
    margin-inline: auto;
  }
  h2 {
    margin-top: 2em;
  }
  .fixture-note {
    border-left: 3px solid var(--warning-color, #d08770);
    padding-left: 1em;
    text-align: left;
    font-size: 0.9em;
  }
  .metric-compare {
    display: grid;
    grid-template-columns: auto auto;
    gap: 2pt 16pt;
    width: max-content;
    margin: 1em auto;
    font-variant-numeric: tabular-nums;
    dt {
      color: var(--text-color-muted, #888);
    }
    dd {
      margin: 0;
    }
  }
  pre {
    max-width: 60em;
    margin: 1em auto;
    overflow-x: auto;
  }
  button {
    display: block;
    margin: 1em auto 3em;
    padding: 4pt 12pt;
    cursor: pointer;
    border: 1px solid var(--border-color, #999);
    border-radius: var(--border-radius, 3pt);
    background: var(--surface-bg-hover, rgba(255, 255, 255, 0.1));
  }
</style>
