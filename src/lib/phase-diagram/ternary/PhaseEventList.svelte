<script lang="ts">
  // Chronological list of hull-topology transitions with their balanced reactions. Clicking
  // an event moves the temperature just above it so the section shows the products; clicking
  // a formula selects that phase.
  import { get_formula_label_segments } from '$lib/composition/format'
  import { format_num } from '$lib/labels'
  import type { HTMLAttributes } from 'svelte/elements'
  import { tooltip } from 'svelte-widgets/attachments'
  import { format_reaction_coeff, reaction_phase_label } from './compute'
  import type { PhaseEventKind, Reaction, TernaryPhaseDiagram } from './types'

  let {
    diagram,
    temperature = $bindable(),
    selected_phase = $bindable(null),
    hovered_phase = $bindable(null),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    diagram: TernaryPhaseDiagram
    temperature: number
    selected_phase?: number | null
    hovered_phase?: number | null
  } = $props()

  const KINDS: Record<PhaseEventKind, [icon: string, title: string]> = {
    appear: [`▲`, `Phase becomes stable`],
    vanish: [`▼`, `Phase decomposes`],
    polymorph: [`⇅`, `Polymorph transition`],
    tie_line_flip: [`⤭`, `Tie-line flip (four-phase reaction)`],
  }
  // The last event at or below the current temperature is the one in effect
  const active_idx = $derived(
    diagram.events.findLastIndex((event) => event.temperature <= temperature),
  )
  const involves = (reaction: Reaction, phase: number | null) =>
    [...reaction.reactants, ...reaction.products].some((item) => item.phase === phase)
  // Formula segments plus any " (entry id)" disambiguation kept as plain text, so ids such
  // as mp-1234 don't get subscripted digits
  const terms = (reaction: Reaction, side: Reaction[`reactants`]) =>
    side.map(({ phase, coeff }) => {
      const full = reaction_phase_label(diagram, reaction, phase)
      const cut = full.indexOf(` (`)
      return {
        phase,
        coeff: format_reaction_coeff(coeff),
        segments: get_formula_label_segments(cut === -1 ? full : full.slice(0, cut)),
        suffix: cut === -1 ? `` : full.slice(cut),
      }
    })

  let list = $state<HTMLDivElement>()
  // Keep the active event in view once scrubbing pauses (scrollIntoView forces layout)
  $effect(() => {
    const [node, idx] = [list, active_idx]
    if (!node || idx === -1) return
    const timer = setTimeout(
      () =>
        node.querySelector(`[data-event-idx="${idx}"]`)?.scrollIntoView({ block: `nearest` }),
      150,
    )
    return () => clearTimeout(timer)
  })
</script>

<div {...rest} class={[`phase-event-list`, rest.class]} bind:this={list}>
  {#if diagram.events.length === 0}
    <p class="empty">
      No transitions between {format_num(diagram.t_range[0], `.0f`)} and {format_num(
        diagram.t_range[1],
        `.0f`,
      )} K
    </p>
  {/if}
  <ol>
    {#each diagram.events as event, idx (idx)}
      {@const [icon, title] = KINDS[event.kind]}
      <li
        data-event-idx={idx}
        class={[
          event.kind,
          {
            active: idx === active_idx,
            involved: event.reactions.some((rxn) => involves(rxn, selected_phase)),
          },
        ]}
      >
        <button
          type="button"
          onclick={() => (temperature = Math.min(diagram.t_range[1], event.temperature + 1))}
          {@attach tooltip({
            content: `${title}. Jump to ${format_num(event.temperature + 1, `.0f`)} K`,
          })}
        >
          <span class="icon" aria-hidden="true">{icon}</span>
          <span class="temp">{format_num(event.temperature, `.0f`)} K</span>
        </button>
        <span class="reactions">
          {#each event.reactions as reaction, rxn_idx (rxn_idx)}
            <span class="reaction">
              {#each [terms(reaction, reaction.reactants), terms(reaction, reaction.products)] as side, side_idx (side_idx)}
                {#if side_idx === 1}<span class="sep">→</span>{/if}
                {#each side as item, item_idx (item_idx)}
                  {#if item_idx > 0}<span class="sep">+</span>{/if}
                  <button
                    type="button"
                    class={[
                      `phase`,
                      {
                        selected: item.phase === selected_phase,
                        hovered: item.phase === hovered_phase,
                      },
                    ]}
                    onpointerenter={() => (hovered_phase = item.phase)}
                    onpointerleave={() => (hovered_phase = null)}
                    onclick={() =>
                      (selected_phase = selected_phase === item.phase ? null : item.phase)}
                    >{item.coeff}{#each item.segments as segment, seg_idx (seg_idx)}{#if segment.subscript}<sub
                          >{segment.text}</sub
                        >{:else}{segment.text}{/if}{/each}{item.suffix}</button
                  >
                {/each}
              {/each}
            </span>
          {:else}
            <span class="reaction"
              >{event.edges_removed.length} tie-line{event.edges_removed.length === 1
                ? ``
                : `s`} replaced</span
            >
          {/each}
        </span>
      </li>
    {/each}
  </ol>
</div>

<style>
  .phase-event-list {
    overflow-y: auto;
    font-size: 0.85em;
  }
  .empty {
    margin: 0.5em;
    opacity: 0.7;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    padding: 3px 6px;
    border-left: 3px solid transparent;
    &.active {
      border-left-color: var(--accent-color, #1976d2);
      background: color-mix(in srgb, var(--accent-color, #1976d2) 12%, transparent);
    }
    &.involved button {
      font-weight: 600;
    }
    &.appear .icon {
      color: #2e7d32;
    }
    &.vanish .icon {
      color: #c62828;
    }
    &.polymorph .icon {
      color: #6a1b9a;
    }
    &.tie_line_flip .icon {
      color: #ef6c00;
    }
  }
  li > button {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    flex: none;
    padding: 0;
    background: none;
    border: none;
    border-radius: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    &:hover {
      background: color-mix(in srgb, currentColor 8%, transparent);
    }
  }
  .icon {
    width: 1.1em;
    flex: none;
    text-align: center;
  }
  .temp {
    flex: none;
    min-width: 4.5em;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  .reactions {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .reaction {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sep {
    margin: 0 0.3em;
    opacity: 0.7;
  }
  .phase {
    padding: 0 2px;
    border: none;
    border-radius: 3px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    &:hover,
    &.hovered {
      background: color-mix(in srgb, #ff9800 25%, transparent);
    }
    &.selected {
      outline: 1px solid #66f0ff;
    }
  }
</style>
