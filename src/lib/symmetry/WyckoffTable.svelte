<script lang="ts">
  import { contrast_color, format_fractional } from '$lib'
  import { colors } from '$lib/state.svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { WyckoffPos } from '.'

  interface Props extends HTMLAttributes<HTMLTableElement> {
    wyckoff_positions: WyckoffPos[]
    on_hover?: (site_indices: number[] | null) => void
    on_click?: (site_indices: number[] | null) => void
    active_color?: string
  }
  let {
    wyckoff_positions,
    on_hover,
    on_click,
    active_color = `#2563eb`,
    ...rest
  }: Props = $props()

  let selected_wyckoff = $state<WyckoffPos | null>(null)
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
      {#each wyckoff_positions as wyckoff_pos (JSON.stringify(wyckoff_pos))}
        {@const { wyckoff, elem, abc, site_indices } = wyckoff_pos}
        {@const is_selected =
        JSON.stringify(selected_wyckoff) === JSON.stringify(wyckoff_pos)}
        <tr
          class="wyckoff-row"
          class:selected={is_selected}
          tabindex="0"
          aria-selected={is_selected}
          style:--active-color={active_color}
          style:--hover-color="#6cf0ff"
          onmouseenter={() => on_hover?.(site_indices ?? null)}
          onmouseleave={() => on_hover?.(null)}
          onclick={() => {
            selected_wyckoff = is_selected ? null : wyckoff_pos
            on_click?.(selected_wyckoff?.site_indices ?? null)
          }}
          onkeydown={(event) => {
            if ([`Enter`, ` `].includes(event.key)) {
              event.preventDefault()
              const is_selected =
                JSON.stringify(selected_wyckoff) === JSON.stringify(wyckoff_pos)
              selected_wyckoff = is_selected ? null : wyckoff_pos
              on_click?.(selected_wyckoff?.site_indices ?? null)
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
          <td>({abc?.map((x) => format_fractional(x)).join(` , `) ?? `N/A`})</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .wyckoff-table {
    margin-top: 1em;
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
