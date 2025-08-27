<script lang="ts">
  import { contrast_color, format_fractional } from '$lib'
  import { colors } from '$lib/state.svelte'
  import type { WyckoffPos } from '.'

  let { wyckoff_positions }: {
    wyckoff_positions: WyckoffPos[]
  } = $props()
</script>

{#if wyckoff_positions && wyckoff_positions.length > 0}
  <table class="wyckoff-table">
    <thead>
      <tr>
        {#each [`Wyckoff`, `Element`, `Fractional Coords`] as col (col)}
          <th
            title={col === `Wyckoff`
            ? `Wyckoff position: Multiplicity + Letter (e.g. 4a = 4 atoms at position 'a')`
            : col === `Element`
            ? `Chemical element symbol`
            : `Fractional coordinates within the unit cell (0-1 range)`}
          >
            {col}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each wyckoff_positions as { wyckoff, elem, abc } (`${wyckoff}-${elem}-${abc}`)}
        {@const style =
        `display: inline-block; padding: 0 6pt; border-radius: 3pt; line-height: 1.4`}
        <tr>
          <td>{wyckoff}</td>
          <td>
            <span
              style:background-color={colors.element[elem]}
              {style}
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
</style>
