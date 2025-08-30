<script lang="ts">
  import { contrast_color, format_fractional } from '$lib'
  import { colors } from '$lib/state.svelte'
  import type { WyckoffPos } from '.'

  interface Props {
    wyckoff_positions: WyckoffPos[]
    on_hover?: (site_indices: number[] | null) => void
    on_click?: (site_indices: number[] | null) => void
    [key: string]: unknown
  }
  let { wyckoff_positions, on_hover, on_click, ...rest }: Props = $props()

  let selected_wyckoff = $state<WyckoffPos | null>(null)
</script>

{#if wyckoff_positions && wyckoff_positions.length > 0}
  <table {...rest} class="wyckoff-table {rest.class ?? ``}">
    <thead>
      <tr>
        {#each [`Wyckoff`, `Element`, `Fractional Coords`] as col (col)}
          <th
            title={col === `Wyckoff`
            ? `Wyckoff position: Multiplicity + Letter`
            : col === `Element`
            ? `Chemical element symbol`
            : `Fractional coordinates within the unit cell`}
          >
            {col}
          </th>
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
          onmouseenter={() => on_hover?.(site_indices ?? null)}
          onmouseleave={() => on_hover?.(null)}
          onclick={() => {
            selected_wyckoff = is_selected ? null : wyckoff_pos
            on_click?.(selected_wyckoff ? site_indices ?? null : null)
          }}
          onkeydown={(event) => {
            if ([`Enter`, ` `].includes(event.key)) {
              event.preventDefault()
              const is_selected =
                JSON.stringify(selected_wyckoff) === JSON.stringify(wyckoff_pos)
              selected_wyckoff = is_selected ? null : wyckoff_pos
              on_click?.(selected_wyckoff ? site_indices ?? null : null)
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
    background-color: var(--surface-bg-hover, rgba(128, 128, 128, 0.1));
  }
  .wyckoff-row.selected {
    background-color: var(--primary-color, #007acc);
    color: white;
  }
  .wyckoff-row.selected:hover {
    background-color: var(--primary-color-hover, #005a9e);
  }
</style>
