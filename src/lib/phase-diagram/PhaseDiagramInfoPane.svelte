<script lang="ts">
  import { DraggablePane } from '$lib'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import PhaseDiagramStats from './PhaseDiagramStats.svelte'
  import type { PhaseStats, PlotEntry3D } from './types'

  let {
    phase_stats,
    stable_entries,
    unstable_entries,
    max_hull_dist_show_phases,
    max_hull_dist_show_labels,
    label_threshold,
    pane_open = $bindable(false),
    toggle_props = $bindable({}),
    pane_props = $bindable({}),
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `onclose`> & {
    phase_stats: PhaseStats | null
    stable_entries: PlotEntry3D[]
    unstable_entries: PlotEntry3D[]
    max_hull_dist_show_phases: number
    max_hull_dist_show_labels: number
    label_threshold: number
    pane_open?: boolean
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  } = $props()
</script>

<DraggablePane
  bind:show={pane_open}
  max_width="24em"
  toggle_props={{
    title: pane_open ? `` : `Phase diagram info`,
    class: `phase-diagram-info-toggle`,
    ...toggle_props,
  }}
  open_icon="Cross"
  closed_icon="Info"
  pane_props={{
    ...pane_props,
    class: `phase-diagram-info-pane ${pane_props?.class ?? ``}`,
  }}
  {...rest}
>
  <PhaseDiagramStats
    {phase_stats}
    {stable_entries}
    {unstable_entries}
    style="padding: 3pt; background: var(--pane-bg)"
  />

  <section class="vis-settings">
    <h5>Visualization Settings</h5>
    <div class="setting-item" data-testid="pd-visible-stable">
      <span>Visible stable:</span>
      <span>{stable_entries.filter((entry) => entry.visible).length} / {
          stable_entries.length
        }</span>
    </div>
    <div class="setting-item" data-testid="pd-visible-unstable">
      <span>Visible unstable:</span>
      <span>{unstable_entries.filter((entry) => entry.visible).length} / {
          unstable_entries.length
        }</span>
    </div>
    <div class="setting-item" data-testid="pd-show-threshold">
      <span>Points threshold:</span>
      <span>{max_hull_dist_show_phases.toFixed(3)} eV/atom</span>
    </div>
    <div class="setting-item" data-testid="pd-label-threshold">
      <span>Label threshold:</span>
      <span>{max_hull_dist_show_labels.toFixed(3)} eV/atom</span>
    </div>
    <div class="setting-item" data-testid="pd-entry-limit-labels">
      <span>Entry limit for labels:</span>
      <span>{label_threshold} entries</span>
    </div>
  </section>

  <section class="usage-tips">
    <h5>Usage Tips</h5>
    <div class="tips-item"><span>Single click:</span><span>Select point</span></div>
    <div class="tips-item"><span>Double click:</span><span>Copy info</span></div>
    <div class="tips-item"><span>Drag:</span><span>Rotate view</span></div>
    <div class="tips-item"><span>Scroll:</span><span>Zoom in/out</span></div>
    <div class="tips-item"><span>Key 'r':</span><span>Reset camera</span></div>
    <div class="tips-item"><span>Key 'b':</span><span>Toggle color mode</span></div>
    <div class="tips-item"><span>Key 's':</span><span>Toggle stable points</span></div>
    <div class="tips-item"><span>Key 'u':</span><span>Toggle unstable points</span></div>
    <div class="tips-item"><span>Key 'l':</span><span>Toggle labels</span></div>
  </section>
</DraggablePane>

<style>
  .vis-settings, .usage-tips {
    padding: 3pt;
    background: var(--pane-bg, white);
  }
  .vis-settings h5, .usage-tips h5 {
    margin: 0 0 6px 0;
  }
  .setting-item, .tips-item {
    display: flex;
    justify-content: space-between;
    gap: 6pt;
    padding: 1pt;
    line-height: 1.5;
  }
  .setting-item span:first-child, .tips-item span:first-child {
    color: var(--text-color-muted, #666);
  }
</style>
