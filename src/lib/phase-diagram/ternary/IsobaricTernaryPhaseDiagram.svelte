<script lang="ts">
  // Isobaric ternary composition-temperature phase diagram: candidate phases with G(T) swept
  // over temperature. Linked views: the isothermal section (2D Gibbs triangle or 3D prism with a
  // draggable cutting plane), a phase × T stability map and the list of transitions with
  // balanced reactions.
  import { is_dark_mode, watch_dark_mode } from '$lib/colors'
  import { get_electro_neg_formula } from '$lib/composition'
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import { canvas_text_color } from '$lib/canvas-surface.svelte'
  import {
    DEFAULT_ELEMENT_TO_GAS,
    GAS_STOICHIOMETRY,
  } from '$lib/convex-hull/gas-thermodynamics'
  import type { GasSpecies, PhaseData } from '$lib/convex-hull/types'
  import { Spinner } from 'svelte-widgets'
  import { create_file_drop_handler, drag_over_handlers } from '$lib/io/file-drop'
  import { format_num } from '$lib/labels'
  import { ViewerChrome } from '$lib/layout'
  import { clamp, type Vec2 } from '$lib/math'
  import { PlotTooltip } from '$lib/plot'
  import { sanitize_html } from '$lib/sanitize'
  import { create_renderer, webgpu_available } from '$lib/scene'
  import { to_error } from '$lib/utils'
  import { is_modifier_chord } from 'svelte-widgets/utils'
  import { Canvas } from '@threlte/core'
  import type { Snippet } from 'svelte'
  import { onMount, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { tooltip as attach_tooltip } from 'svelte-widgets/attachments'
  import { compute_ternary_phase_diagram_async } from './async-compute.svelte'
  import {
    compute_section,
    create_section_evaluator,
    decompose_phase,
    DEFAULT_N_SAMPLES,
    prepare_diagram,
  } from './compute'
  import PhaseEventList from './PhaseEventList.svelte'
  import PhaseStabilityMap from './PhaseStabilityMap.svelte'
  import TernaryPhaseDiagramControls from './TernaryPhaseDiagramControls.svelte'
  import TernaryPrismScene from './TernaryPrismScene.svelte'
  import TernarySectionCanvas from './TernarySectionCanvas.svelte'
  import type {
    Decomposition,
    DiagramProgress,
    FreeEnergyMode,
    PhaseTemperatureHover,
    SectionHover,
    TernaryDisplay,
    TernaryPhaseDiagram,
    TernaryPhaseDiagramOptions,
  } from './types'
  import { TERNARY_DISPLAY_DEFAULTS } from './types'

  type Hover =
    | { kind: `section`; data: SectionHover }
    | { kind: `phase_t`; data: PhaseTemperatureHover }

  let {
    entries: entries_prop,
    options = {},
    temperature = $bindable(),
    selected_phase = $bindable(null),
    diagram = $bindable(null),
    display = $bindable({}),
    free_energy_mode = $bindable(`auto`),
    t_range = $bindable(),
    n_samples = $bindable(DEFAULT_N_SAMPLES),
    gas_enabled = $bindable(false),
    gas_pressures = $bindable({}),
    show_controls,
    controls_open = $bindable(false),
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    wrapper = $bindable(),
    on_file_drop,
    title,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `children`> & {
    entries?: PhaseData[]
    // Extra compute options (corner order, event_tolerance, explicit temperatures, ...); the
    // bindable compute props below override matching fields
    options?: TernaryPhaseDiagramOptions
    temperature?: number // K; defaults to the start of the sweep
    selected_phase?: number | null // index into diagram.phases
    diagram?: TernaryPhaseDiagram | null // computed result (read-only binding)
    display?: Partial<TernaryDisplay> // view settings, merged over TERNARY_DISPLAY_DEFAULTS
    free_energy_mode?: FreeEnergyMode
    t_range?: Vec2
    n_samples?: number
    // Treat O/N/H/F as diatomic gases at gas_pressures (bar)
    gas_enabled?: boolean
    gas_pressures?: Partial<Record<GasSpecies, number>>
    show_controls?: ShowControlsProp<`controls` | `fullscreen`>
    controls_open?: boolean
    fullscreen?: boolean
    fullscreen_toggle?: boolean
    wrapper?: HTMLDivElement
    on_file_drop?: (entries: PhaseData[], filename: string) => void
    title?: string
    children?: Snippet<[{ diagram: TernaryPhaseDiagram | null; temperature: number }]>
  } = $props()

  const settings = $derived<TernaryDisplay>({ ...TERNARY_DISPLAY_DEFAULTS, ...display })
  const set_display = (patch: Partial<TernaryDisplay>) => (display = { ...display, ...patch })
  const controls_config = $derived(normalize_show_controls(show_controls))
  let mounted = $state(false)
  onMount(() => (mounted = true))
  // Root guess before mount; once the wrapper is bound, read the scheme it inherits (a
  // widget's own color-scheme in a notebook) and follow changes to it
  let dark_mode = $state(is_dark_mode())
  $effect(() => {
    dark_mode = is_dark_mode(wrapper)
    return watch_dark_mode((dark) => (dark_mode = dark), wrapper)
  })
  let dropped_entries = $state.raw<PhaseData[] | null>(null)
  let hover = $state<Hover | null>(null)
  let hovered_phase = $state<number | null>(null)
  $effect(() => {
    if (entries_prop) dropped_entries = null
  })
  const entries = $derived(dropped_entries ?? entries_prop ?? [])
  // Phase indices belong to one entry set: a new dataset invalidates the selection. Hover
  // also ends whenever the view changes, since an unmounting view fires no pointerleave.
  let last_entries: PhaseData[] | null = null
  $effect(() => {
    void [settings.view, settings.show_map, settings.show_events]
    hovered_phase = null
    hover = null
    if (last_entries !== null && entries !== last_entries) selected_phase = null
    last_entries = entries
  })

  // === Model and sweep ===

  // Diatomic elemental gases of the elements present (the only atmospheres every free-energy
  // source can represent)
  const relevant_gases = $derived.by((): GasSpecies[] => {
    const present = new Set(entries.flatMap((entry) => Object.keys(entry.composition)))
    return [
      ...new Set(
        Object.entries(DEFAULT_ELEMENT_TO_GAS)
          .filter(
            ([el, gas]) => present.has(el) && Object.keys(GAS_STOICHIOMETRY[gas]).length === 1,
          )
          .map(([, gas]) => gas),
      ),
    ]
  })
  const compute_options = $derived<TernaryPhaseDiagramOptions>({
    ...options,
    ...(t_range && { t_range }),
    n_samples,
    free_energy: {
      ...options.free_energy,
      mode: free_energy_mode,
      gas_config:
        gas_enabled && relevant_gases.length > 0
          ? { ...options.free_energy?.gas_config, enabled_gases: relevant_gases }
          : options.free_energy?.gas_config,
      gas_pressures: { ...options.free_energy?.gas_pressures, ...gas_pressures },
    },
  })
  // Main-thread model: cheap, and what the live section at any T is evaluated from
  const model_result = $derived.by(() => {
    if (entries.length === 0) return { model: null, error: null }
    try {
      return { model: prepare_diagram(entries, compute_options), error: null }
    } catch (error) {
      return { model: null, error: to_error(error).message }
    }
  })
  const model = $derived(model_result.model)

  let computing = $state(false)
  let progress = $state<DiagramProgress | null>(null)
  let compute_error = $state<string | null>(null)
  // Unproxied result tagged with its inputs: consumers binding `diagram` into deep $state get
  // proxies back, and a stale sweep must never be paired with new entries/options
  let sweep = $state.raw<{
    diagram: TernaryPhaseDiagram
    entries: PhaseData[]
    options: TernaryPhaseDiagramOptions
  } | null>(null)
  $effect(() => {
    const [current_entries, current_options] = [entries, compute_options]
    computing = Boolean(model) // an aborted sweep never clears its own flag
    progress = null
    compute_error = null
    if (!model) {
      diagram = null
      sweep = null
      return
    }
    const controller = new AbortController()
    compute_ternary_phase_diagram_async(current_entries, current_options, {
      signal: controller.signal,
      on_progress: (update) => (progress = update),
    })
      .then((result) => {
        diagram = result
        sweep = { diagram: result, entries: current_entries, options: current_options }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) compute_error = to_error(error).message
      })
      .finally(() => {
        if (!controller.signal.aborted) computing = false
      })
    return () => controller.abort()
  })
  // Phase indices of a sweep over other entries mean nothing against the current model; a sweep
  // with stale options still shows the same phases while its replacement runs (dimmed, so
  // continuous option changes such as a pressure drag don't flicker the views)
  const diagram_raw = $derived(sweep?.entries === entries ? sweep.diagram : null)
  const fresh = $derived(diagram_raw !== null && sweep?.options === compute_options)

  // === Temperature ===

  const [t_min, t_max] = $derived<Vec2>(model?.t_range ?? [300, 1500])
  const current_t = $derived(
    Number.isFinite(temperature) ? clamp(temperature ?? t_min, t_min, t_max) : t_min,
  )
  $effect(() => {
    if (temperature !== current_t) temperature = current_t // keep the binding inside the sweep
  })
  // Pointer scrubbing (prism plane, stability map) outruns frames: apply once per frame; a
  // direct set (keyboard, buttons) cancels any scrub still queued
  let pending_t: number | null = null
  let scrub_frame = 0
  const set_temperature = (next: number) => {
    pending_t = null
    temperature = clamp(next, t_min, t_max)
  }
  const scrub_temperature = (next: number) => {
    if (pending_t === null) {
      scrub_frame = requestAnimationFrame(() => {
        if (pending_t !== null) set_temperature(pending_t)
      })
    }
    pending_t = next
  }
  $effect(() => () => cancelAnimationFrame(scrub_frame))

  // With the sweep in, a section at any T reuses the cached topology of its interval (no
  // hull recomputation); before that it is computed from scratch
  const evaluator = $derived(
    model && diagram_raw && fresh ? create_section_evaluator(model, diagram_raw) : null,
  )
  const section_at = (temp: number) =>
    evaluator ? evaluator.section_at(temp) : model ? compute_section(model, temp) : null
  const section = $derived(section_at(current_t))
  const events = $derived(diagram_raw?.events ?? [])
  const next_event = $derived(events.find((event) => event.temperature > current_t) ?? null)
  const prev_event = $derived(
    events.findLast((event) => event.temperature <= current_t) ?? null,
  )
  const emphasized_phases = $derived(
    settings.show_upcoming && next_event
      ? [...next_event.vanished, ...next_event.appeared]
      : [],
  )

  let playing = $state(false)
  $effect(() => {
    if (!playing) return
    let last = performance.now()
    let frame = requestAnimationFrame(function step(now: number) {
      const next = untrack(() => current_t) + (settings.play_speed * (now - last)) / 1000
      last = now
      temperature = clamp(next, t_min, t_max)
      if (next >= t_max) playing = false
      else frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  })
  const toggle_play = () => {
    if (!playing && current_t >= t_max) temperature = t_min
    playing = !playing
  }

  function handle_keydown(event: KeyboardEvent): void {
    // Focused controls keep their own keys (space activates a button, arrows move a slider)
    if ((event.target as Element).closest(`button, input, textarea, select`)) return
    // Shift+arrow jumps between transitions; Cmd/Ctrl/Alt chords stay the browser's
    if (is_modifier_chord(event)) return
    const dir = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (dir) {
      const target = dir > 0 ? next_event : prev_event
      if (!event.shiftKey) set_temperature(current_t + dir * (t_max - t_min) * 0.01)
      else if (target) set_temperature(target.temperature + dir)
    } else if (event.key === ` `) toggle_play()
    // only claim Escape when there is a selection to clear, else the host keeps the key
    else if (event.key === `Escape` && selected_phase !== null) selected_phase = null
    else return
    event.preventDefault()
  }

  // === Hover ===

  // The phase a tooltip is about (null for composition probes)
  const hover_phase = $derived(
    hover?.kind === `phase_t`
      ? hover.data.phase
      : hover?.data.kind === `phase`
        ? hover.data.phase.idx
        : null,
  )
  const formula_html = (phase: number) =>
    sanitize_html(get_electro_neg_formula(model?.phases[phase].label ?? ``, { delim: `` }))
  const windows_text = (phase: number) =>
    (diagram_raw?.stability_windows[phase] ?? [])
      .map(([lo, hi]) => `${format_num(lo, `.0f`)}–${format_num(hi, `.0f`)} K`)
      .join(`, `) || `never stable in range`
  const meV = (value: number) =>
    Number.isFinite(value)
      ? `${format_num(value * 1000, `.1f`)} meV/atom`
      : `no data at this T`

  // === File drop ===

  let dragover = $state(false)
  let drop_error = $state<string | null>(null)
  const handle_drop = create_file_drop_handler({
    allow: () => true,
    on_error: (message) => (drop_error = message),
    on_drop: (content, filename) => {
      try {
        const parsed: unknown = JSON.parse(
          typeof content === `string` ? content : new TextDecoder().decode(content),
        )
        if (!Array.isArray(parsed))
          throw new Error(`Expected a JSON array of convex-hull entries`)
        drop_error = null
        selected_phase = null
        if (on_file_drop) on_file_drop(parsed as PhaseData[], filename)
        else dropped_entries = parsed as PhaseData[]
      } catch (error) {
        drop_error = `${filename}: ${to_error(error).message}`
      }
    },
  })
</script>

{#snippet fractions(decomposition: Decomposition, digits: string)}
  {#each decomposition.phases as phase, idx (phase)}{#if idx > 0}
      +
    {/if}{format_num(decomposition.fractions[idx] * 100, digits)}% {@html formula_html(
      phase,
    )}{/each}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex -- the diagram itself handles arrow/space keys -->
<div
  {...rest}
  bind:this={wrapper}
  class={[`ternary-phase-diagram`, rest.class, { fullscreen, dragover }]}
  role="application"
  tabindex="0"
  aria-label="{model?.elements.join(`-`) ?? ``} ternary composition-temperature phase diagram"
  onkeydown={handle_keydown}
  ondrop={(event) => {
    dragover = false
    void handle_drop(event)
  }}
  {...drag_over_handlers({ set_dragover: (over) => (dragover = over) })}
>
  <ViewerChrome
    {controls_config}
    bind:fullscreen
    {fullscreen_toggle}
    {wrapper}
    fullscreen_bg_css_var="--phase-diagram-bg-fullscreen"
  >
    {#if controls_config.visible(`controls`)}
      <TernaryPhaseDiagramControls
        bind:controls_open
        display={settings}
        {set_display}
        bind:free_energy_mode
        bind:t_range={() => t_range ?? [t_min, t_max], (value) => (t_range = value)}
        bind:n_samples
        {relevant_gases}
        bind:gas_enabled
        bind:gas_pressures
        sources={diagram_raw?.sources ?? []}
        n_phases={diagram_raw?.phases.length ?? 0}
        n_events={events.length}
      />
    {/if}
  </ViewerChrome>

  {#if title}<h3 class="diagram-title">{@html sanitize_html(title)}</h3>{/if}
  {#if drop_error ?? model_result.error ?? compute_error}
    <div class="error" role="alert">{drop_error ?? model_result.error ?? compute_error}</div>
  {/if}

  {#if model && section}
    <div class={[`panels`, { 'with-side': settings.show_map || settings.show_events }]}>
      <div class="section-panel">
        <div class="view-toggle" role="group" aria-label="View mode">
          {#each [[`section`, `2D section`], [`prism`, `3D prism`]] as const as [mode, label] (mode)}
            <button
              type="button"
              class={{ active: settings.view === mode }}
              aria-pressed={settings.view === mode}
              onclick={() => set_display({ view: mode })}>{label}</button
            >
          {/each}
        </div>
        {#if settings.view === `section`}
          <TernarySectionCanvas
            {model}
            {section}
            {settings}
            bind:selected_phase
            highlighted_phases={hovered_phase === null ? [] : [hovered_phase]}
            {emphasized_phases}
            on_hover={(data) => (hover = data && { kind: `section`, data })}
          />
        {:else if !mounted || !webgpu_available()}
          <div class="prism-fallback">WebGPU is required for the 3D prism view.</div>
        {:else if diagram_raw}
          <div class={[`prism-canvas`, { stale: !fresh }]}>
            <Canvas createRenderer={create_renderer}>
              <TernaryPrismScene
                diagram={diagram_raw}
                {section}
                {settings}
                bind:temperature={() => current_t, scrub_temperature}
                bind:selected_phase
                bind:hovered_phase
                text_color={canvas_text_color(wrapper, dark_mode)}
                on_hover={(data) => (hover = data && { kind: `phase_t`, data })}
              />
            </Canvas>
          </div>
        {:else}
          <div class="prism-fallback"><Spinner /> Sweeping temperatures…</div>
        {/if}
        <div class="temperature-bar">
          <button
            type="button"
            class="play-btn"
            onclick={toggle_play}
            aria-label={playing ? `Pause heating` : `Play heating ramp`}
            {@attach attach_tooltip({
              content: `${playing ? `Pause` : `Heat`} at ${settings.play_speed} K/s (space)`,
            })}
          >
            {playing ? `⏸` : `▶`}
          </button>
          <div class="slider-wrap">
            <div class="event-ticks" aria-hidden="true">
              {#each events as event, idx (idx)}
                <span
                  class={[`tick`, event.kind]}
                  style="left: {((event.temperature - t_min) / (t_max - t_min)) * 100}%"
                ></span>
              {/each}
            </div>
            <input
              type="range"
              min={t_min}
              max={t_max}
              step={(t_max - t_min) / 2000}
              value={current_t}
              oninput={(evt) => set_temperature(evt.currentTarget.valueAsNumber)}
              aria-label="Temperature (K)"
            />
          </div>
          <label class="temp-input">
            <input
              type="number"
              min={t_min}
              max={t_max}
              step="1"
              value={Math.round(current_t)}
              onchange={(evt) => set_temperature(evt.currentTarget.valueAsNumber)}
              aria-label="Temperature in Kelvin"
            />
            <span>K</span>
          </label>
          <span class="stable-count">{section.stable.length} stable</span>
          {#if computing}
            <span class="progress">
              <Spinner style="--spinner-size: 0.9em; --spinner-border-width: 2px; margin: 0" />
              {progress ? `${progress.done}/${progress.total}` : `sweeping`}
            </span>
          {/if}
        </div>
        <div class="bracket">
          {#each [[prev_event, -1], [next_event, 1]] as const as [event, dir] (dir)}
            <button
              type="button"
              disabled={!event}
              onclick={() => event && set_temperature(event.temperature + dir)}
              {@attach attach_tooltip({
                content: `${dir > 0 ? `Next` : `Previous`} transition (shift+${dir > 0 ? `→` : `←`})`,
              })}
            >
              {#if event}{dir < 0 ? `← ` : ``}{format_num(event.temperature, `.0f`)} K{dir > 0
                  ? ` →`
                  : ``}{/if}
            </button>
          {/each}
        </div>
      </div>

      {#if (settings.show_map || settings.show_events) && diagram_raw}
        <div class={[`side-panel`, { stale: !fresh }]}>
          {#if settings.show_map}
            <PhaseStabilityMap
              diagram={diagram_raw}
              {settings}
              bind:temperature={() => current_t, scrub_temperature}
              bind:selected_phase
              bind:hovered_phase
              on_hover={(data) => (hover = data && { kind: `phase_t`, data })}
            />
          {/if}
          {#if settings.show_events}
            <PhaseEventList
              diagram={diagram_raw}
              bind:temperature={() => current_t, set_temperature}
              bind:selected_phase
              bind:hovered_phase
            />
          {/if}
        </div>
      {:else if (settings.show_map || settings.show_events) && computing}
        <div class="side-panel computing"><Spinner /> Sweeping temperatures…</div>
      {/if}
    </div>
  {:else if entries.length === 0}
    <div class="empty">
      Drop a JSON file of convex-hull entries (3 elements) to compute a ternary T–x diagram
    </div>
  {/if}

  {#if hover && model && section}
    <PlotTooltip
      x={hover.data.position[0]}
      y={hover.data.position[1]}
      fixed
      offset={{ x: 14, y: 10 }}
      class="ternary-tooltip"
      style="background: var(--tooltip-bg, rgba(20, 20, 30, 0.92)); color: var(--tooltip-text, #fff); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); z-index: 1000"
    >
      {#if hover.kind === `section` && hover.data.kind === `composition`}
        {@const { barycentric, decomposition } = hover.data}
        <div>
          {model.elements
            .map((el, idx) => `${el} ${format_num(barycentric[idx] * 100, `.1f`)}%`)
            .join(` · `)}
        </div>
        {#if decomposition}
          <div class="muted">{decomposition.phases.length}-phase region (atom fractions)</div>
          <div>{@render fractions(decomposition, `.1f`)}</div>
        {/if}
      {:else if hover_phase !== null}
        {@const phase = hover_phase}
        {@const at_t = hover.kind === `phase_t` ? hover.data.temperature : current_t}
        {@const e_hull = (hover.kind === `phase_t` ? (section_at(at_t) ?? section) : section)
          .e_above_hull[phase]}
        {@const decomposition =
          hover.kind === `section` ? decompose_phase(model, section, phase) : null}
        {@const entry_id = model.phases[phase].entry.entry_id}
        <strong>{@html formula_html(phase)}</strong>
        {#if hover.kind === `phase_t`}at {format_num(at_t, `.0f`)} K{:else if entry_id && !entry_id.startsWith(`synthetic`)}<span
            class="muted">{entry_id}</span
          >{/if}
        <div>
          E<sub>hull</sub>: {meV(e_hull)}
          {#if hover.kind === `section`}· ΔG<sub>f</sub>: {format_num(
              section.dg_form[phase],
              `.3f`,
            )} eV/atom{/if}
        </div>
        <div class="muted">Stable: {windows_text(phase)}</div>
        {#if decomposition && decomposition.phases[0] !== phase}
          <div>Decomposes to {@render fractions(decomposition, `.0f`)}</div>
        {/if}
        {#if hover.kind === `section`}<div class="muted">
            G(T): {model.phases[phase].source}
          </div>{/if}
      {/if}
    </PlotTooltip>
  {/if}

  {@render children?.({ diagram, temperature: current_t })}
</div>

<style>
  .ternary-phase-diagram {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 480px;
    container-type: inline-size;
    background: var(--pd-bg, transparent);
    outline: none;
    &.fullscreen {
      background: var(--phase-diagram-bg-fullscreen, var(--page-bg, #1a1a2e)) !important;
    }
    &.dragover {
      outline: 2px dashed var(--accent-color, #1976d2);
    }
  }
  .diagram-title {
    margin: 0 0 0.3em;
    text-align: center;
    font-weight: 600;
  }
  .panels {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    flex: 1;
    min-height: 0;
    &.with-side {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    }
  }
  @container (max-width: 760px) {
    .panels.with-side {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .section-panel,
  .side-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .section-panel :is(:global(.ternary-section), .prism-canvas, .prism-fallback) {
    flex: 1;
    min-height: 280px;
  }
  .prism-canvas,
  .side-panel {
    transition: opacity 0.2s ease;
    &.stale {
      opacity: 0.45;
    }
  }
  .prism-canvas {
    position: relative;
    :global(canvas) {
      display: block;
      width: 100%;
      height: 100%;
    }
  }
  .prism-fallback,
  .side-panel.computing {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
    opacity: 0.7;
  }
  .side-panel {
    gap: 6px;
    :global(.phase-stability-map) {
      flex: 0 1 auto;
      max-height: 60%;
    }
    :global(.phase-event-list) {
      flex: 1 1 0;
      min-height: 6em;
      border-top: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
    }
  }
  .view-toggle {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 3;
    display: flex;
    gap: 2px;
    font-size: 0.75em;
    button {
      padding: 2px 7px;
      border: 1px solid var(--border-color, rgba(128, 128, 128, 0.4));
      background: var(--btn-bg, transparent);
      color: inherit;
      cursor: pointer;
      border-radius: 3px;
      opacity: 0.75;
      &.active {
        opacity: 1;
        background: light-dark(rgba(25, 118, 210, 0.15), rgba(100, 180, 255, 0.2));
      }
    }
  }
  .temperature-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 0;
    font-size: 0.85em;
  }
  .play-btn {
    width: 2em;
    height: 2em;
    padding: 0;
    border: 1px solid var(--border-color, rgba(128, 128, 128, 0.4));
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
    line-height: 1;
  }
  .slider-wrap {
    position: relative;
    flex: 1;
    min-width: 80px;
    input {
      width: 100%;
      margin: 0;
    }
  }
  .event-ticks {
    position: absolute;
    inset: -4px 8px auto;
    height: 4px;
    pointer-events: none;
    .tick {
      position: absolute;
      width: 2px;
      height: 4px;
      transform: translateX(-1px);
      background: #ef6c00;
      &.appear {
        background: #2e7d32;
      }
      &.vanish {
        background: #c62828;
      }
      &.polymorph {
        background: #6a1b9a;
      }
    }
  }
  .temp-input {
    display: flex;
    align-items: center;
    gap: 2px;
    input {
      width: 4.5em;
      font: inherit;
      text-align: right;
    }
  }
  .stable-count,
  .progress {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    opacity: 0.8;
  }
  .bracket {
    display: flex;
    justify-content: space-between;
    padding: 2px 6px;
    font-size: 0.8em;
    button {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      opacity: 0.75;
      padding: 0 4px;
      &:hover:enabled {
        opacity: 1;
        text-decoration: underline;
      }
    }
  }
  .error {
    margin: 0.5em;
    padding: 0.4em 0.8em;
    border-radius: 4px;
    background: rgba(198, 40, 40, 0.15);
    color: #c62828;
  }
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    opacity: 0.7;
    text-align: center;
    padding: 1em;
  }
  .muted {
    opacity: 0.7;
    font-size: 0.9em;
  }
  :global(.ternary-tooltip) {
    max-width: 320px;
    font-size: 0.85em;
    line-height: 1.4;
  }
</style>
