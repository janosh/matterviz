<script lang="ts">
  // Measurement overlays for the picked sites: selection-order badges (1, 2, 3, ...) and, per
  // measure mode, distance lines with PBC/direct lengths, the picked triangle with an arc and
  // value at each of its angles, or the torsion chain. Angle and torsion edges run between the
  // nearest images the values are measured from (see measure.pick_displacement).
  import { format_num } from '#lib/labels.js'
  import type { Matrix3x3, Vec3 } from '#lib/math.js'
  import * as math from '#lib/math.js'
  import { SceneLabel } from '#lib/scene/index.js'
  import type { BondPair, MeasureMode, Site } from '#lib/structure/index.js'
  import { T } from '@threlte/core'
  import { dispose_on_change } from '#lib/scene/geometry.svelte.js'
  import { CatmullRomCurve3, Quaternion, TubeGeometry, Vector3 } from 'three/webgpu'
  import { bond_strand_matrices, UNIT_CYLINDER } from './bond-mesh'
  import { bond_at, bond_site_1, bond_site_2, type BondData } from './bond-rendering'
  import Cylinder from './Cylinder.svelte'
  import * as measure from './measure'
  import type { Pbc } from './pbc'

  let {
    sites,
    measured_sites,
    measure_mode,
    lattice,
    label_offset,
    line_color,
    bonds,
    bond_thickness,
    pulse_opacity,
    site_radius,
  }: {
    sites: readonly Site[]
    measured_sites: readonly number[] // in pick order
    measure_mode: MeasureMode
    lattice: { matrix: Matrix3x3; pbc?: Pbc } | null // minimum-image convention when set
    label_offset: Vec3 // site label offset; badges sit half an Å below it
    line_color: string
    bonds: BondData // drawn bonds: a bonded pair is tinted strand by strand, others get a line
    bond_thickness: number
    pulse_opacity: number // the selected atoms' pulse, which a measured bond's tint follows
    site_radius: (site_idx: number) => number // drawn atom radius, which an angle's arc clears
  } = $props()

  const fmt = (value: number) => format_num(value, `.3~f`)
  const fmt_deg = (value: number) => format_num(value, `.1~f`)
  const LINE_THICKNESS = 0.035
  type PairEnd = { site_idx: number; position: Vec3 }
  // the drawn bond joining exactly these two sites at these points, either way round: a periodic
  // bond runs to an image of its partner, and small cells hold several bonds per site pair.
  // Site indices first, so a trajectory frame's bonds aren't all expanded into records. The
  // prop is read once: its getter crosses three components, 35 ms per scan of 110k bonds.
  const pair_bond = (end_i: PairEnd, end_j: PairEnd): BondPair | undefined => {
    const drawn = bonds
    for (let idx = 0; idx < drawn.length; idx++) {
      const [site_1, site_2] = [bond_site_1(drawn, idx), bond_site_2(drawn, idx)]
      const forward = site_1 === end_i.site_idx && site_2 === end_j.site_idx
      if (!forward && !(site_1 === end_j.site_idx && site_2 === end_i.site_idx)) continue
      const bond = bond_at(drawn, idx)
      const [start, end] = forward ? [end_i, end_j] : [end_j, end_i]
      if (
        math.same_position(bond.pos_1, start.position) &&
        math.same_position(bond.pos_2, end.position)
      )
        return bond
    }
  }
  // A measured bond's strands (1-3 by order) as drawn, as threlte transform props
  const strand_poses = (bond: BondPair) =>
    bond_strand_matrices(bond, bond_thickness).map((matrix) => {
      const [position, quaternion, scale] = [new Vector3(), new Quaternion(), new Vector3()]
      matrix.decompose(position, quaternion, scale)
      return {
        position: position.toArray(),
        quaternion: quaternion.toArray(),
        scale: scale.toArray(),
      }
    })
  // Angle and torsion modes: the full ordered tuple of picks, unwrapped into the chain both
  // the drawing and the values use, placed on as many picked atoms as possible
  let chain = $derived.by(() => {
    const size = measure.max_measured_sites(measure_mode)
    if (!measure.rolls_measured_sites(measure_mode) || measured_sites.length !== size)
      return null
    const positions = measured_sites.flatMap((idx) => (sites[idx] ? [sites[idx].xyz] : []))
    if (positions.length !== size) return null
    return measure.pbc_chain_positions(positions, lattice?.matrix, lattice?.pbc)
  })
  // consecutive picks, closed into a triangle in angle mode
  let chain_edges = $derived.by((): [PairEnd, PairEnd][] => {
    if (!chain) return []
    const ends = chain.map((position, pick) => ({ site_idx: measured_sites[pick], position }))
    const pairs = ends.slice(1).map((end, idx): [PairEnd, PairEnd] => [ends[idx], end])
    return measure_mode === `angle` ? [...pairs, [ends[0], ends[2]]] : pairs
  })
  // every angle of the triangle, each arced between the edges to its other two corners
  let angle_markers = $derived(
    (measure_mode === `angle` && chain ? chain : []).flatMap((center, pick_idx, corners) => {
      const [end_1, end_2] = corners.filter((_pos, other_pick) => other_pick !== pick_idx)
      const arc = measure.angle_arc(
        center,
        math.subtract(end_1, center),
        math.subtract(end_2, center),
        { atom_radius: site_radius(measured_sites[pick_idx]) },
      )
      // a collinear triangle's end corners are 0°: only its 180° vertex is worth a label
      if (!arc || arc.degrees < 0.05) return []
      const tube =
        arc.points.length > 0
          ? new TubeGeometry(
              new CatmullRomCurve3(arc.points.map((point) => new Vector3(...point))),
              24,
              LINE_THICKNESS / 2,
              6,
            )
          : null
      return [{ key: pick_idx, tube, ...arc }]
    }),
  )
  // threlte only disposes geometries on unmount, so each frame of a played trajectory would
  // leave its arcs behind
  dispose_on_change(() => angle_markers.map(({ tube }) => tube))
</script>

<!-- a pair joined by a drawn bond tints its strands, keeping a double or triple bond's look;
  any other pair gets a thin line -->
{#snippet pair_link(end_i: PairEnd, end_j: PairEnd)}
  {@const bond = pair_bond(end_i, end_j)}
  {#if bond}
    {#each strand_poses(bond) as { position, quaternion, scale }, strand_idx (strand_idx)}
      <!-- a translucent tint on the bond's own surface, pulled toward the camera by a polygon
        offset so the coincident faces don't z-fight -->
      <T.Mesh {position} {quaternion} {scale} geometry={UNIT_CYLINDER}>
        <T.MeshBasicMaterial
          color={line_color}
          transparent
          opacity={2 * pulse_opacity}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </T.Mesh>
    {/each}
  {:else}
    <Cylinder
      from={end_i.position}
      to={end_j.position}
      thickness={LINE_THICKNESS}
      color={line_color}
    />
  {/if}
{/snippet}

<!-- selection order labels (1, 2, 3, ...) for measurements and bond editing -->
{#if measure_mode !== `edit-atoms`}
  {#each measured_sites as site_index, loop_idx (site_index)}
    {@const site = sites[site_index]}
    {#if site}
      <!-- shift selected site labels down to avoid overlapping regular site labels-->
      <SceneLabel
        center
        position={math.add<Vec3>(site.xyz, math.add(label_offset, [0, -0.5, 0]))}
      >
        <span class="selection-label">{loop_idx + 1}</span>
      </SceneLabel>
    {/if}
  {/each}
{/if}

{#if measure_mode === `distance`}
  {#each measured_sites as idx_i, loop_idx (idx_i)}
    {#each measured_sites.slice(loop_idx + 1) as idx_j (idx_i + `-` + idx_j)}
      {@const [site_i, site_j] = [sites[idx_i], sites[idx_j]]}
      <!-- indices can outlive their sites (image atoms toggled off, supercell
        shrunk); skip rather than throw mid-render like the angle/dihedral branches -->
      {#if site_i && site_j}
        {@const [pos_i, pos_j] = [site_i.xyz, site_j.xyz]}
        {@render pair_link(
          { site_idx: idx_i, position: pos_i },
          { site_idx: idx_j, position: pos_j },
        )}
        {@const direct = math.euclidean_dist(pos_i, pos_j)}
        <!-- the nearest image, unless the drawn pair already is one (an image atom's own
          lattice vector included) -->
        {@const pbc = Math.hypot(
          ...measure.pick_displacement(pos_i, pos_j, lattice?.matrix, undefined, lattice?.pbc),
        )}
        <SceneLabel center position={math.lerp_vec3(pos_i, pos_j, 0.5)}>
          <span class="measure-label">
            {#if Math.abs(pbc - direct) > 1e-6}
              PBC: {fmt(pbc)} Å<br /><small> Direct: {fmt(direct)} Å</small>
            {:else}
              {fmt(pbc)} Å
            {/if}
          </span>
        </SceneLabel>
      {/if}
    {/each}
  {/each}
{:else if chain}
  <!-- the picked triangle or torsion chain (nearest images, like the values), then each angle's
    arc from edge to edge just outside its atom (depth-tested, so the bonds hide its ends) with
    its value between atom and arc, or the torsion on the central bond it's measured about -->
  {#each chain_edges as [end_i, end_j], edge_idx (edge_idx)}
    {@render pair_link(end_i, end_j)}
  {/each}
  {#each angle_markers as { key, tube, label_position, degrees } (key)}
    {#if tube}
      <T.Mesh geometry={tube}>
        <T.MeshBasicMaterial color={line_color} />
      </T.Mesh>
    {/if}
    <SceneLabel center position={label_position}>
      <span class="measure-label">{fmt_deg(degrees)}°</span>
    </SceneLabel>
  {/each}
  {#if measure_mode === `dihedral`}
    {@const [pos_1, pos_2, pos_3, pos_4] = chain}
    <SceneLabel center position={math.lerp_vec3(pos_2, pos_3, 0.5)}>
      <span class="measure-label">
        {fmt_deg(measure.dihedral_angle(pos_1, pos_2, pos_3, pos_4, null))}°
      </span>
    </SceneLabel>
  {/if}
{/if}

<style>
  .measure-label {
    background: var(--measure-label-bg, var(--surface-bg));
    color: var(--measure-label-color, var(--text-color));
    border-radius: var(--border-radius, 3pt);
    padding: 0 5px;
    user-select: none;
    white-space: pre;
    display: grid;
    place-items: center;
    line-height: 1.2;
    font-size: var(--measure-label-font-size, clamp(8pt, 2cqmin, 14px));
    box-shadow: var(--measure-label-shadow, 0 1px 6px rgba(0, 0, 0, 0.2));
  }
  .selection-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.2em;
    height: 1.2em;
    padding: 0 0.25em;
    border-radius: 999px;
    background: var(--btn-bg-hover);
    color: var(--text-color);
    font-size: 0.85em;
    line-height: 1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
</style>
