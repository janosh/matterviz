<script lang="ts">
  import { contrast_color } from '$lib/colors'
  import { format_fractional } from '$lib/labels'
  import { colors } from '$lib/state.svelte'
  import type { MoyoWyckoffPosition } from '@spglib/moyo-wasm'
  import { SvelteSet } from 'svelte/reactivity'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { WyckoffPos } from '.'
  import { enrich_wyckoff_rows, wyckoff_letter } from '.'

  let {
    wyckoff_positions,
    // Full Wyckoff-position database of the space group (from
    // spacegroup_wyckoff_positions). When given, occupied rows gain an ITA coordinates
    // column and unoccupied positions can be listed via show_unoccupied.
    db_positions = [],
    show_unoccupied = false,
    on_hover,
    on_click,
    active_color = `#2563eb`,
    ...rest
  }: HTMLAttributes<HTMLTableElement> & {
    wyckoff_positions: WyckoffPos[]
    db_positions?: MoyoWyckoffPosition[]
    show_unoccupied?: boolean
    on_hover?: (site_indices: number[] | null) => void
    on_click?: (site_indices: number[] | null) => void
    active_color?: string
  } = $props()

  let selected_key = $state<string | null>(null)

  // Occupied orbits enriched with ITA representative coordinates + site symmetry
  const rows = $derived(enrich_wyckoff_rows(wyckoff_positions ?? [], db_positions))
  // Wyckoff positions of the space group not occupied by any atom, smallest
  // multiplicity first (matches the ascending sort of occupied rows)
  const unoccupied_rows = $derived.by(() => {
    if (!show_unoccupied) return []
    const occupied_letters = new SvelteSet(rows.map((row) => wyckoff_letter(row.wyckoff)))
    return db_positions
      .filter((pos) => !occupied_letters.has(pos.letter))
      .toSorted(
        (pos_1, pos_2) =>
          pos_1.multiplicity - pos_2.multiplicity || pos_1.letter.localeCompare(pos_2.letter),
      )
  })
  const has_ita_coords = $derived(
    rows.some((pos) => pos.coordinates) || unoccupied_rows.length > 0,
  )
  const has_site_symmetry = $derived(
    rows.some((pos) => pos.site_symmetry) || unoccupied_rows.length > 0,
  )

  const get_row_key = (wyckoff_pos: WyckoffPos, row_idx: number) =>
    `${wyckoff_pos.wyckoff}-${wyckoff_pos.elem}-${
      wyckoff_pos.site_indices?.join(`,`) ?? `none`
    }-${row_idx}`
  $effect(() => {
    if (!selected_key || rows.some((pos, idx) => get_row_key(pos, idx) === selected_key)) {
      return
    }
    selected_key = null
    on_click?.(null)
  })
</script>

{#if rows.length > 0 || unoccupied_rows.length > 0}
  <table {...rest} class={[`wyckoff-table`, rest.class]}>
    <thead>
      <tr>
        {#each [[`Wyckoff`, `Wyckoff position: Multiplicity + Letter`], [`Element`, `Chemical element symbol`], [`Fractional Coords`, `Fractional coordinates within the unit cell`], ...(has_ita_coords ? [[`ITA Coords`, `Representative coordinates from the International Tables: x/y/z mark free parameters, fractions mark symmetry-fixed coordinates`]] : []), ...(has_site_symmetry ? [[`Site Symm.`, `Site symmetry: point group of operations leaving the site invariant`]] : [])] as [col, title] (col)}
          <th {title}>{col}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as wyckoff_pos, row_idx (get_row_key(wyckoff_pos, row_idx))}
        {@const { wyckoff, elem, abc, site_indices } = wyckoff_pos}
        {@const row_key = get_row_key(wyckoff_pos, row_idx)}
        {@const is_selected = selected_key === row_key}
        <tr
          class="wyckoff-row"
          tabindex="0"
          class:selected={is_selected}
          style:--active-color={active_color}
          style:--hover-color="#6cf0ff"
          onmouseenter={() => on_hover?.(site_indices ?? null)}
          onmouseleave={() => on_hover?.(null)}
          onclick={() => {
            selected_key = is_selected ? null : row_key
            on_click?.(is_selected ? null : (wyckoff_pos.site_indices ?? null))
          }}
          onkeydown={(event) => {
            if ([`Enter`, ` `].includes(event.key)) {
              event.preventDefault()
              selected_key = is_selected ? null : row_key
              on_click?.(is_selected ? null : (wyckoff_pos.site_indices ?? null))
            }
          }}
        >
          <td>{wyckoff}</td>
          <td>
            <span
              style:background-color={colors.element[elem]}
              style="display: inline-block; padding: 0 6pt; border-radius: 3pt; line-height: 1.4"
              {@attach contrast_color()}
            >
              {elem}
            </span>
          </td>
          <td>({abc?.map(format_fractional).join(` , `) ?? `N/A`})</td>
          {#if has_ita_coords}
            <td>{wyckoff_pos.coordinates ? `(${wyckoff_pos.coordinates})` : ``}</td>
          {/if}
          {#if has_site_symmetry}
            <td>{wyckoff_pos.site_symmetry ?? ``}</td>
          {/if}
        </tr>
      {/each}
      {#each unoccupied_rows as db_pos (db_pos.letter)}
        <tr class="unoccupied" title="Wyckoff position not occupied in this structure">
          <td>{db_pos.multiplicity}{db_pos.letter}</td>
          <td>&mdash;</td>
          <td>&mdash;</td>
          {#if has_ita_coords}
            <td>({db_pos.coordinates})</td>
          {/if}
          {#if has_site_symmetry}
            <td>{db_pos.site_symmetry}</td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .wyckoff-table {
    margin-top: 1em;
  }
  .wyckoff-table :is(th, td) {
    padding: 2px 6px;
    text-align: center;
    vertical-align: middle;
  }
  .wyckoff-row {
    cursor: pointer;
    transition: background-color 0.2s ease;
  }
  .wyckoff-row:hover {
    background-color: color-mix(in srgb, var(--hover-color) 25%, transparent);
  }
  .wyckoff-row.selected {
    background-color: color-mix(in srgb, var(--active-color) 30%, transparent);
  }
  .wyckoff-row.selected:hover {
    background-color: color-mix(in srgb, var(--active-color) 35%, transparent);
  }
  .unoccupied {
    opacity: 0.5;
  }
</style>
