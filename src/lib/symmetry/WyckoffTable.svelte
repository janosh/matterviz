<script lang="ts">
  import { contrast_color } from '$lib/colors'
  import { format_fractional } from '$lib/labels'
  import { colors } from '$lib/state.svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { WyckoffPos } from '.'

  let {
    wyckoff_positions,
    on_hover,
    on_click,
    active_color = `#2563eb`,
    ...rest
  }: HTMLAttributes<HTMLTableElement> & {
    wyckoff_positions: WyckoffPos[]
    on_hover?: (site_indices: number[] | null) => void
    on_click?: (site_indices: number[] | null) => void
    active_color?: string
  } = $props()

  let selected_key = $state<string | null>(null)

  const get_row_key = (wyckoff_pos: WyckoffPos, row_idx: number) =>
    `${wyckoff_pos.wyckoff}-${wyckoff_pos.elem}-${
      wyckoff_pos.site_indices?.join(`,`) ?? `none`
    }-${row_idx}`
</script>

{#if wyckoff_positions && wyckoff_positions.length > 0}
  <table {...rest} class="wyckoff-table {rest.class ?? ``}">
    <thead>
      <tr>
        {#each [
          [`Wyckoff`, `Wyckoff position: Multiplicity + Letter`],
          [`Element`, `Chemical element symbol`],
          [`Fractional Coords`, `Fractional coordinates within the unit cell`],
        ] as
          [col, title]
          (col)
        }
          <th {title}>{col}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each wyckoff_positions as
        wyckoff_pos,
        row_idx
        (get_row_key(wyckoff_pos, row_idx))
      }
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
</style>
