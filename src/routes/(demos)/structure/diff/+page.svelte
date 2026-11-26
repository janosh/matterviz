<script lang="ts">
  import { get_alphabetical_formula } from '#lib/composition/format'
  import { open_material } from '#lib/file-viewer/open'
  import FilePicker from '#lib/FilePicker.svelte'
  import { file_drop_zone } from '#lib/io/file-drop'
  import type { Matrix3x3, Vec3 } from '#lib/math'
  import {
    compute_lattice_params,
    create_cart_to_frac,
    create_frac_to_cart,
    mulberry32,
  } from '#lib/math'
  import type { AnyStructure, Crystal } from '#lib/structure/index'
  import { parse_structure_file } from '#lib/structure/parse'
  import { StructureDiff } from '#lib/structure-diff/index'
  import { materialize_frame } from '#lib/trajectory/frame'
  import type { TrajectoryRun } from '#lib/trajectory/run'
  import { latest_load, url_selection } from '#site/state.svelte'
  import {
    parse_structure_fixture,
    same_composition_pairs,
    structure_files,
    structure_map,
  } from '#site/structures'
  import { format_num } from 'svelte-widgets/format'
  import { tooltip } from 'svelte-widgets/attachments'
  import { clamp, to_error } from 'svelte-widgets/utils'

  type DiffRole = `reference` | `target`
  type Slot = { structure: AnyStructure; name: string; note?: string; frame?: number }
  const roles: DiffRole[] = [`reference`, `target`]

  // Every example compares like with like. Real relaxation and MD runs from the bundled
  // trajectories (their first and last frames by default), every pair of bundled structures
  // with equal composition, site count and periodicity, and one labeled illustrative pair.
  const TRAJECTORIES = [
    `ase-LiMnO2-chgnet-relax.traj`, // CHGNet relaxation
    `vasp-XDATCAR.MD.gz`, // VASP MD
    `vasp-XDATCAR-traj.gz`, // VASP MD, 100 frames
    `flame-gold-cluster-55-atoms.h5`, // FLAME Au55 cluster relaxation
  ]
  const pairs = same_composition_pairs(
    structure_files.map(({ name }) => ({ name, structure: parse_structure_fixture(name) })),
  )
  const pair_key = (pair: (typeof pairs)[number]) => pair.map(({ name }) => name).join(` vs `)
  const formula = (structure: AnyStructure) =>
    get_alphabetical_formula(structure, { plain_text: true, delim: `` })
  // name: the url_selection key, label: what the chip shows next to its type badge
  const examples = [
    ...TRAJECTORIES.map((name) => [name, name, `trajectory`]),
    ...pairs.map((pair) => [
      pair_key(pair),
      `${formula(pair[0].structure)}: ${pair.map(({ name }) => name.split(`.`)[0]).join(` vs `)}`,
      `same formula`,
    ]),
    [`illustrative`, `Ag13Bi14I56 seeded perturbation`, `illustrative`],
  ].map(([name, label, type]) => ({ name, label, url: name, type }))
  const example = url_selection(
    `example`,
    examples.map(({ name }) => name),
  )

  let slots = $state.raw<Record<DiffRole, Slot | null>>({ reference: null, target: null })
  let slot_errors = $state<Record<DiffRole, string | null>>({ reference: null, target: null })
  // the open trajectory and the frames its slots show (0-based)
  let run = $state.raw<TrajectoryRun | null>(null)
  let frames = $state<Record<DiffRole, number>>({ reference: 0, target: 0 })

  // Illustrative, not real data: a bundled triclinic cell with seeded random displacements
  // (uniform ±0.175 Å per Cartesian axis), a 1.5% stretch along a, re-wrapped into the cell,
  // and its sites shuffled so nearest-neighbor matching has to recover the order.
  const ILLUSTRATIVE_ID = `mp-686119-Ag13Bi14I56-triclinic`
  function make_illustrative(): Record<DiffRole, Slot> {
    const crystal = structure_map.get(ILLUSTRATIVE_ID)
    if (!crystal) throw new Error(`Missing bundled structure ${ILLUSTRATIVE_ID}`)
    const rand = mulberry32(7)
    const [vec_a, vec_b, vec_c] = crystal.lattice.matrix
    const matrix: Matrix3x3 = [vec_a.map((val) => val * 1.015) as Vec3, vec_b, vec_c]
    const to_cart = create_frac_to_cart(matrix)
    const to_frac = create_cart_to_frac(matrix)
    const sites = crystal.sites.map((site) => {
      const shift = [0, 0, 0].map(() => (rand() - 0.5) * 0.35)
      const cart = to_cart(site.abc).map((val, axis) => val + shift[axis]) as Vec3
      const abc = to_frac(cart).map((val) => val - Math.floor(val)) as Vec3
      return { ...site, abc, xyz: to_cart(abc) }
    })
    // Fisher-Yates shuffle with the same seeded generator
    for (let idx = sites.length - 1; idx > 0; idx--) {
      const swap = Math.floor(rand() * (idx + 1))
      ;[sites[idx], sites[swap]] = [sites[swap], sites[idx]]
    }
    const target: Crystal = {
      ...crystal,
      sites,
      lattice: { ...crystal.lattice, matrix, ...compute_lattice_params(matrix) },
    }
    return {
      reference: { structure: crystal, name: `${ILLUSTRATIVE_ID} (bundled)` },
      target: {
        structure: target,
        name: `Illustrative perturbation`,
        note: `Seeded random shifts of ±0.175 Å per axis, +1.5% a, shuffled order (not real data)`,
      },
    }
  }

  // An example switch supersedes loads still in flight; a slot the user filled with their own
  // file keeps it until they pick another example
  const example_load = latest_load()
  let user_roles = new Set<DiffRole>()
  $effect(() => {
    const current = example.value
    user_roles.clear()
    slot_errors = { reference: null, target: null }
    run = null
    if (current === `illustrative`) {
      example_load.cancel()
      slots = make_illustrative()
      return
    }
    const pair = pairs.find((candidate) => pair_key(candidate) === current)
    if (pair) {
      example_load.cancel()
      const [reference, target] = pair.map(({ name, structure }) => ({ structure, name }))
      slots = { reference, target }
      return
    }
    const is_current = example_load.start()
    open_material(`/trajectories/${current}`)
      .then((opened) => {
        if (opened.type !== `trajectory`) throw new Error(`${current} is not a trajectory`)
        if (!is_current()) return opened.dispose()
        frames = { reference: 0, target: opened.data.frame_count - 1 }
        run = opened.data
      })
      .catch((exc) => show_error(is_current, to_error(exc).message))
    return () => run?.dispose()
  })
  const show_error = (is_current: () => boolean, message: string) => {
    if (!is_current()) return
    for (const role of roles) {
      if (!user_roles.has(role)) slot_errors = { ...slot_errors, [role]: message }
    }
  }
  // the chosen frames of the open trajectory into the slots the user didn't fill
  const frame_load = latest_load()
  $effect(() => {
    const [current_run, picked] = [run, { ...frames }]
    if (!current_run) return
    const is_current = frame_load.start()
    const read = async (frame: number): Promise<Slot> => {
      const { structure, metadata } = materialize_frame(await current_run.read_frame(frame))
      const energy = Number(metadata?.energy)
      const note = Number.isFinite(energy) ? `E = ${format_num(energy, `.4~f`)} eV` : undefined
      return { structure, name: example.value, note, frame }
    }
    Promise.all(roles.map((role) => read(picked[role])))
      .then(([reference, target]) => {
        if (!is_current()) return
        const keep = (role: DiffRole, loaded: Slot) =>
          user_roles.has(role) ? slots[role] : loaded
        slots = { reference: keep(`reference`, reference), target: keep(`target`, target) }
      })
      .catch((exc) => show_error(is_current, to_error(exc).message))
  })

  const set_slot = (role: DiffRole) => (content: string | ArrayBuffer, filename: string) => {
    if (typeof content !== `string`) {
      throw new TypeError(
        `${filename} is binary; drop a text structure file (CIF, POSCAR, JSON, XYZ)`,
      )
    }
    user_roles.add(role)
    slots = {
      ...slots,
      [role]: { structure: parse_structure_file(content, filename), name: filename },
    }
    slot_errors = { ...slot_errors, [role]: null }
  }
  const swap_slots = () => {
    slots = { reference: slots.target, target: slots.reference }
    slot_errors = { reference: slot_errors.target, target: slot_errors.reference }
    frames = { reference: frames.target, target: frames.reference }
    user_roles = new Set(
      [...user_roles].map((role) => (role === `target` ? `reference` : `target`)),
    )
  }
</script>

<h1>Structure Diff</h1>

<p class="demo-intro">
  Atoms sit at the target positions, colored by how far they moved; faint ghosts and thin
  arrows show where they came from.
</p>

<div class="bleed-1400">
  <div class="input-bar">
    {#each roles as role (role)}
      {@const slot = slots[role]}
      {#if role === `target`}
        <button
          type="button"
          aria-label="Swap reference and target"
          style="font-size: 1.2em"
          {@attach tooltip()}
          onclick={swap_slots}>⇄</button
        >
      {/if}
      <div
        class="slot"
        title={[
          slot &&
            `${slot.name}: ${formula(slot.structure)}, ${slot.structure.sites.length} sites`,
          slot?.note,
          `Drop a structure file here`,
        ]
          .filter(Boolean)
          .join(` · `)}
        {@attach tooltip()}
        {@attach file_drop_zone({
          allow: () => true,
          max_files: 1,
          on_drop: set_slot(role),
          on_error: (msg) => (slot_errors = { ...slot_errors, [role]: msg }),
        })}
      >
        <small>{role}</small>
        {#if slot_errors[role]}
          <span style="color: var(--error-color, crimson)">{slot_errors[role]}</span>
        {:else}
          <span
            >{slot?.name ?? `Loading…`}{#if run && slot?.frame !== undefined}
              {` · `}frame
              <input
                type="number"
                min="1"
                max={run.frame_count}
                aria-label="{role} frame"
                bind:value={
                  () => frames[role] + 1,
                  (value) =>
                    (frames[role] =
                      clamp(Math.round(value ?? 1), 1, run?.frame_count ?? 1) - 1)
                }
              />
              of {run.frame_count}{/if}</span
          >
        {/if}
      </div>
    {/each}
  </div>

  <details style="margin-block: 4pt 1em">
    <summary>Examples: {examples.find(({ name }) => name === example.value)?.label}</summary>
    <p style="margin: 4pt 0">
      Trajectories load their first and last frames (pick others in the slots); structure pairs
      share composition and site count. Or drop your own files onto the slots.
    </p>
    <FilePicker
      files={examples}
      active_files={[example.value]}
      on_click={({ name }) => (example.value = name)}
    />
  </details>

  {#if slots.reference && slots.target}
    <StructureDiff
      reference={slots.reference.structure}
      target={slots.target.structure}
      structure_props={{ style: `height: 520px` }}
    />
  {/if}
</div>

<style>
  .input-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6pt 10pt;
    margin-block: 1em 4pt;
  }
  .slot {
    display: grid;
    min-width: 12em;
    padding: 3pt 9pt;
    border: 2px dashed var(--border-color, rgba(128, 128, 128, 0.4));
    border-radius: 6pt;
    &:global(.dragover) {
      border-color: var(--accent-color, cornflowerblue);
    }
    small {
      opacity: 0.6;
      text-transform: capitalize;
    }
    input {
      width: 4em;
    }
  }
</style>
