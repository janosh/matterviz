<script lang="ts">
  import type { ShowControlsState } from '$lib/controls'
  import { format_num } from '$lib/labels'
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
    on_index_input?: (index: number) => void
  } = $props()

  let resume_after_slider_scrub = false
  const begin_slider_scrub = (): void => {
    resume_after_slider_scrub = playback.is_playing
    playback.pause()
  }
  const finish_slider_scrub = (next_index: number): void => {
    playback.seek(next_index)
    if (resume_after_slider_scrub) playback.play()
    resume_after_slider_scrub = false
  }
</script>

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
      class={['play-button', { playing: playback.is_playing }]}
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
  {@const max_index = Math.max(count - 1, 0)}
  <div class="step-section">
    <input
      type="number"
      min="0"
      max={max_index}
      value={index}
      oninput={(event) => playback.go_to(event.currentTarget.valueAsNumber)}
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
        max={max_index}
        value={index}
        onpointerdown={begin_slider_scrub}
        onpointerup={(event) => finish_slider_scrub(event.currentTarget.valueAsNumber)}
        onpointercancel={(event) => finish_slider_scrub(event.currentTarget.valueAsNumber)}
        oninput={(event) => {
          playback.pause()
          on_index_input(event.currentTarget.valueAsNumber)
        }}
        onchange={(event) => finish_slider_scrub(event.currentTarget.valueAsNumber)}
        onkeydown={(event) => {
          if (!playback.handle_keydown(event)) return
          event.preventDefault()
          event.stopPropagation()
        }}
        class="step-slider"
        title={`Drag to navigate ${item_name}s`}
        aria-label={aria_label ?? item_name}
        aria-valuetext={aria_valuetext}
      />
      {#if step_label_positions.length}
        <div class="step-labels">
          {#each step_label_positions as step_idx (step_idx)}
            {@const adjusted_position = count > 1 ? 1.5 + (step_idx / (count - 1)) * 98 : 1.5}
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
      min={playback.fps_limits[0]}
      max={playback.fps_limits[1]}
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

<style>
  button {
    background: var(--btn-bg);
    font-size: inherit;
    line-height: 1;
    &:hover:not(:disabled) {
      background: var(--btn-bg-hover, var(--border-color));
    }
    &:disabled {
      color: var(--text-color-muted);
      cursor: not-allowed;
    }
  }
  .nav-section {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 3pt;
  }
  .step-section {
    display: flex;
    flex: 1;
    align-items: center;
    gap: clamp(0.25rem, 1.5cqw, 0.5rem);
    min-width: 0;
    /* SequenceControlBar wraps at this width, but flex: 1 shrinks the slider to nothing
       instead of wrapping, so claim a whole row below the nav/fps/pane buttons */
    @container (max-width: 520px) {
      flex-basis: 100%;
      order: 1;
    }
    > span {
      opacity: 0.75;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  }
  .step-input {
    min-width: 3.5em;
    margin: 0 -5px 0 0;
    border: 1px solid rgba(99, 179, 237, 0.3);
    text-align: center;
  }
  input[type='number'] {
    padding: 1px 3px;
    font: inherit;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    &::-webkit-outer-spin-button,
    &::-webkit-inner-spin-button {
      margin: 0;
      -webkit-appearance: none;
    }
  }
  .slider-container {
    position: relative;
    flex: 1 1 var(--sequence-slider-min-width, 100px);
    min-width: 0;
    &:has(.step-labels) {
      inset-block-start: -4px;
    }
  }
  .step-slider {
    position: relative;
    z-index: 1;
    width: 100%;
  }
  .step-labels {
    position: absolute;
    top: 50%;
    inset-inline: 0;
    overflow: hidden;
  }
  .step-tick {
    position: absolute;
    top: var(--sequence-step-tick-offset, 3px);
    width: var(--sequence-step-tick-width, 1px);
    height: var(--sequence-step-tick-height, 3px);
    transform: translateX(-50%);
    background: var(--text-color-muted);
  }
  .step-label {
    position: absolute;
    top: calc(
      var(--sequence-step-tick-offset, 3px) + var(--sequence-step-tick-height, 3px) + 2px
    );
    transform: translateX(-50%);
    color: var(--text-color-muted);
    font-size: clamp(0.5em, 1.2cqw, 0.65em);
    line-height: 1;
    text-align: center;
    white-space: nowrap;
  }
  .fps-section {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 5pt;
    margin-inline: 6pt;
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
    &:hover:not(:disabled) {
      background: var(--btn-bg-hover, rgba(0, 0, 0, 0.2));
    }
    &.playing {
      background: var(--btn-bg, rgba(0, 0, 0, 0.1));
    }
    &.playing:hover:not(:disabled) {
      background: var(--btn-bg-hover, rgba(0, 0, 0, 0.1));
    }
  }
</style>
