<script lang="ts">
  import { analyze_barrier, NebPlot, NebViewer, path_spline } from '$lib/neb'
  import { download } from '$lib/io'
  import { format_num } from '$lib/labels'
  import { LI_MGO_HOP_FILENAME, li_mgo_hop_json, reaction_paths } from '$site/neb'
  import InputFormat from './input-format.md'

  let coord_mode = $state<`arc_length` | `image_index`>(`arc_length`)
  let energy_reference = $state<`absolute` | `initial`>(`initial`)
  let show_spline = $state(true)
  let active_path_key = $state(`direct hop`)
  let active_image_idx = $state(0)

  const direct = reaction_paths[`direct hop`]
  const analysis = analyze_barrier(direct)
  const spline = path_spline(direct)

  // $lib/io's download attaches the anchor before clicking it, which the hand-rolled
  // detached-anchor version here did not; Firefox ignores a click on a detached <a>
  const download_fixture = () =>
    download(li_mgo_hop_json, LI_MGO_HOP_FILENAME, `application/json`)
</script>

<h1>Reaction Paths (NEB)</h1>

<p class="fixture-note">
  This demo uses synthetic Li-in-MgO geometries, energies, and forces to exercise the viewer;
  none of the values are physical predictions.
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

  <p>Arc length uses minimum-image displacements across periodic boundaries.</p>

  <h2>Discrete and fitted barriers</h2>
  <p>
    The highest computed image is #{analysis.ts_image_idx}, at
    {format_num(analysis.forward_barrier, `.4~`)} eV. The {spline.method} fit peaks
    {format_num(spline.fitted_max.energy - analysis.ts_energy, `.3~`)} eV higher between images #{spline
      .fitted_max.between_images[0]} and #{spline.fitted_max.between_images[1]}; the viewer
    reports both values explicitly.
  </p>

  <h2>Comparing mechanisms</h2>
  <p>
    Both paths share endpoints, hence the same reaction energy; only the route and the barrier
    differ. The direct hop demonstrates force-projected fitting; the curved hop demonstrates
    the energy-only cubic fallback.
  </p>
  <NebPlot paths={reaction_paths} energy_reference="initial" style="height: 420px" />

  <h2>Input format</h2>
  <p>
    Drop <code>matterviz-reaction-path</code> JSON, multi-frame extended XYZ from
    <code>ase.io.write("neb.xyz", images)</code>, or loose single-structure files onto the
    viewer above. Extended XYZ uses <code>energy=</code> and
    <code>Properties=...:forces:...</code>; loose structures are assembled into one path in
    drop order and each requires a numeric <code>properties.energy</code>.
  </p>
  <div class="code-fence"><InputFormat /></div>
  <p>
    A single path may use a top-level <code>images</code> array. Convert VASP
    <code>00/</code>, <code>01/</code> … directories first because browsers cannot ingest an ordered
    directory layout.
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
  .code-fence {
    max-width: 60em;
    margin: 1em auto;
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
