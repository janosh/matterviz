<script lang="ts">
  import type { ShowControlsState } from '$lib/controls'
  import { format_num } from '$lib/labels'
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-widgets/attachments'
  import type { create_sequence_player } from './sequence-player.svelte'

  let {
    controls_config,
    index,
    count,
    playback,
    step_label_positions = [],
    item_name = `step`,
    previous_title,
    play_title,
    next_title,
    aria_label,
    aria_valuetext,
    disable_step_while_playing = true,
    on_index_input = playback.go_to,
    on_number_input = on_index_input,
    on_index_commit = on_index_input,
    children,
  }: {
    controls_config: ShowControlsState
    index: number
    count: number
    playback: ReturnType<typeof create_sequence_player>
    step_label_positions?: number[]
    item_name?: string
    previous_title?: string
    play_title?: string
    next_title?: string
    aria_label?: string
    aria_valuetext?: string
    disable_step_while_playing?: boolean
    on_number_input?: (index: number) => void
    on_index_input?: (index: number) => void
    on_index_commit?: (index: number) => void
    children?: Snippet
  } = $props()
</script>

<div class="sequence-controls">
  {#if controls_config.visible(`nav`)}
    <div class="nav-section">
      <button
        type="button"
        onclick={playback.previous}
        disabled={index === 0 || (playback.is_playing && disable_step_while_playing)}
        title={previous_title ?? `Previous ${item_name}`}
        aria-label={`Previous ${item_name}`}
      >
        ⏮
      </button>
      <button
        type="button"
        onclick={playback.toggle}
        disabled={count <= 1}
        title={play_title ?? (playback.is_playing ? `Pause` : `Play`)}
        aria-label={playback.is_playing ? `Pause` : `Play`}
        class="play-button"
        class:playing={playback.is_playing}
      >
        {playback.is_playing ? `⏸` : `▶`}
      </button>
      <button
        type="button"
        onclick={playback.next}
        disabled={index === count - 1 || (playback.is_playing && disable_step_while_playing)}
        title={next_title ?? `Next ${item_name}`}
        aria-label={`Next ${item_name}`}
      >
        ⏭
      </button>
    </div>
  {/if}

  {#if controls_config.visible(`step`)}
    {@const formatted_count = format_num(count, `.3~s`)}
    <div class="step-section">
      <input
        type="number"
        min="0"
        max={Math.max(count - 1, 0)}
        value={index}
        oninput={(event) => on_number_input(event.currentTarget.valueAsNumber)}
        onchange={({ currentTarget }) =>
          queueMicrotask(() => (currentTarget.value = String(index)))}
        class="step-input"
        title={`Enter ${item_name} number to jump to`}
        aria-label={`${item_name} input`}
        {@attach tooltip()}
      />
      <span aria-label={`${formatted_count} total ${item_name}s`}>/ {formatted_count}</span>
      <div class="slider-container">
        <input
          type="range"
          min="0"
          max={Math.max(count - 1, 0)}
          value={index}
          oninput={(event) => on_index_input(event.currentTarget.valueAsNumber)}
          onchange={(event) => on_index_commit(event.currentTarget.valueAsNumber)}
          class="step-slider"
          title={`Drag to navigate ${item_name}s`}
          aria-label={aria_label ?? item_name}
          aria-valuetext={aria_valuetext}
        />
        {#if step_label_positions.length > 0}
          <div class="step-labels">
            {#each step_label_positions as step_idx (step_idx)}
              {@const position_percent = count > 1 ? (step_idx / (count - 1)) * 100 : 0}
              {@const adjusted_position = 1.5 + (position_percent * (100 - 2)) / 100}
              <div class="step-tick" style:left="{adjusted_position}%"></div>
              <div class="step-label" style:left="{adjusted_position}%">
                {format_num(step_idx, `.3~s`)}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if count > 1 && controls_config.visible(`fps`)}
    <label class="fps-section" title="Frame rate: {format_num(playback.fps, `.2~s`)} fps">
      FPS
      <input
        type="number"
        min={playback.fps_min}
        max={playback.fps_max}
        step={playback.fps_step}
        value={playback.fps}
        oninput={(event) => {
          const value = event.currentTarget.valueAsNumber
          if (Number.isFinite(value)) playback.fps = value
        }}
        onchange={({ currentTarget }) => (currentTarget.value = String(playback.fps))}
      />
    </label>
  {/if}
  {@render children?.()}
</div>

<style>
  /* Let all sections participate directly in the parent toolbar's flex layout. */
  .sequence-controls {
    display: contents;
  }
  button {
    background: var(--btn-bg);
    font-size: inherit;
    line-height: 1;
  }
  button:hover:not(:disabled) {
    background: var(--btn-bg-hover, var(--border-color));
  }
  button:disabled {
    color: var(--text-color-muted);
    cursor: not-allowed;
  }
  .nav-section {
    display: flex;
    align-items: center;
    gap: 3pt;
  }
  .step-section {
    display: flex;
    flex: 1;
    align-items: center;
    gap: clamp(0.25rem, 1.5cqw, 0.5rem);
    min-width: 0;
  }
  .step-section > span {
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .step-input {
    min-width: 3.5em;
    margin: 0 -5px 0 0;
    border: 1px solid rgba(99, 179, 237, 0.3);
    text-align: center;
  }
  .step-input,
  .fps-section input[type='number'] {
    padding: 1px 3px;
    font: inherit;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }
  .step-input::-webkit-outer-spin-button,
  .step-input::-webkit-inner-spin-button,
  .fps-section input[type='number']::-webkit-outer-spin-button,
  .fps-section input[type='number']::-webkit-inner-spin-button {
    margin: 0;
    -webkit-appearance: none;
  }
  .slider-container {
    position: relative;
    flex: 1;
    min-width: var(--sequence-slider-min-width, var(--trajectory-slider-min-width, 100px));
  }
  .step-slider {
    position: relative;
    z-index: 1;
    width: 100%;
  }
  .step-labels {
    position: absolute;
    top: 50%;
    right: 0;
    left: 0;
  }
  .step-tick {
    position: absolute;
    top: var(--sequence-step-tick-offset, var(--trajectory-step-tick-offset, 5px));
    width: var(--sequence-step-tick-width, var(--trajectory-step-tick-width, 1px));
    height: var(--sequence-step-tick-height, var(--trajectory-step-tick-height, 3px));
    transform: translateX(-50%);
    background: var(--text-color-muted);
  }
  .step-label {
    position: absolute;
    top: calc(
      var(--sequence-step-tick-offset, var(--trajectory-step-tick-offset, 5px)) +
        var(--sequence-step-tick-height, var(--trajectory-step-tick-height, 3px)) + 1px
    );
    transform: translateX(-50%);
    color: var(--text-color-muted);
    font-size: clamp(0.5em, 1.2cqw, 0.65em);
    text-align: center;
    white-space: nowrap;
  }
  .fps-section {
    display: flex;
    align-items: center;
    gap: 5pt;
    margin-inline: 6pt;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    input[type='number'] {
      min-width: 2ch;
      max-width: 4ch;
      border: var(--tooltip-border);
      field-sizing: content;
      text-align: center;
    }
  }
  .play-button {
    min-width: clamp(32px, 4cqw, 36px);
  }
  .play-button:hover:not(:disabled) {
    background: var(--traj-play-btn-bg-hover, var(--btn-bg-hover, rgba(0, 0, 0, 0.2)));
  }
  .play-button.playing {
    background: var(--traj-pause-btn-bg, var(--btn-bg, rgba(0, 0, 0, 0.1)));
  }
  .play-button.playing:hover:not(:disabled) {
    background: var(--traj-pause-btn-bg-hover, var(--btn-bg-hover, rgba(0, 0, 0, 0.1)));
  }
</style>
