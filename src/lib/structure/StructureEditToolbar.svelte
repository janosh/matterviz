<script lang="ts">
  // Measure/edit mode picker plus the edit-atoms and edit-bonds toolbars (undo/redo, element
  // inputs, bond order and add/delete toggle). Every action goes through the session;
  // Structure.svelte keeps the keyboard shortcuts that drive the same operations.
  import { ToolbarMenu } from '$lib/overlays'
  import { Icon } from 'svelte-widgets'
  import { Angle, Edit, Link, Orbit, Redo, Reset, Ruler, Undo } from 'svelte-widgets/icons'
  import { BOND_ORDER_OPTIONS } from './bonding'
  import { MAX_SELECTED_SITES } from './measure'
  import type { StructureSession } from './session.svelte'

  // `as const` keeps the modes literal: the click handlers assign them to the mode props
  const MEASURE_MODES = [
    { mode: `distance`, icon: Ruler, label: `Distance`, scale: 1.1 },
    { mode: `angle`, icon: Angle, label: `Angle`, scale: 1.3 },
    { mode: `dihedral`, icon: Orbit, label: `Dihedral`, scale: 1.1 },
    { mode: `edit-atoms`, icon: Edit, label: `Edit Atoms`, scale: 1.0 },
    { mode: `edit-bonds`, icon: Link, label: `Edit Bonds`, scale: 1.0 },
  ] as const
  const BOND_EDIT_MODES = [
    { mode: `add`, label: `Add`, title: `Add: click two atoms` },
    { mode: `delete`, label: `Delete`, title: `Delete: click a bond` },
  ] as const

  const HISTORY_ACTIONS = [
    { action: `undo`, icon: Undo, label: `Undo`, shortcut: `Cmd/Ctrl+Z` },
    { action: `redo`, icon: Redo, label: `Redo`, shortcut: `Cmd/Ctrl+Y or Cmd+Shift+Z` },
  ] as const

  let {
    session,
    shortcut_style,
  }: {
    session: StructureSession
    shortcut_style: (control: string) => string
  } = $props()

  // Modes are the viewer's bindable props, read and written through the session's accessors
  let measure_mode = $derived(session.inputs.measure_mode())
  let bond_edit_mode = $derived(session.inputs.bond_edit_mode())
  let selected_count = $derived(session.selected_sites.length)
  let measured_count = $derived(session.measured_sites.length)
  let measure_menu_open = $state(false)
  let change_element_value = $state(``)
  let show_selection_reset = $derived(
    session.has_bond_edits ||
      ([`distance`, `angle`, `dihedral`].includes(measure_mode) && measured_count > 0) ||
      (measure_mode === `edit-atoms` && selected_count > 0),
  )
</script>

<ToolbarMenu
  bind:open={measure_menu_open}
  label="Measure / Edit"
  class="measure-mode-dropdown"
  button_style={shortcut_style(`measure`)}
>
  {#snippet button()}
    {#if measure_mode === `distance` && measured_count >= MAX_SELECTED_SITES}
      <span class="selection-limit-text">
        {measured_count}/{MAX_SELECTED_SITES}
      </span>
    {:else}
      <Icon icon={MEASURE_MODES.find(({ mode }) => mode === measure_mode)?.icon ?? Ruler} />
    {/if}
  {/snippet}
  {#snippet trailing()}
    {#if show_selection_reset}
      <button
        type="button"
        aria-label="Reset selection and bond edits"
        onclick={() => {
          session.clear_selection()
          session.clear_bond_edits()
        }}
      >
        <Icon icon={Reset} style="margin-left: -4px" />
      </button>
    {/if}
  {/snippet}
  {#each MEASURE_MODES as { mode, icon, label, scale } (mode)}
    {@const disabled = mode === `edit-bonds` && !session.bond_edits_enabled}
    <button
      class={['view-mode-option', { selected: measure_mode === mode }]}
      {disabled}
      title={disabled ? `Bond editing is only available for the original 1x1x1 cell` : label}
      onclick={() => {
        if (disabled) return
        session.inputs.set_measure_mode(mode)
        measure_menu_open = false
      }}
    >
      <Icon {icon} style="transform: scale({scale})" />
      <span>{label}</span>
    </button>
  {/each}
</ToolbarMenu>

{#snippet undo_redo_snippet(bond_edit = false)}
  {@const history = bond_edit ? session.bond_history : session.history}
  <div class="undo-redo-container" style="display: flex">
    {#each HISTORY_ACTIONS as { action, icon, label, shortcut } (action)}
      {@const title = `${label}${bond_edit ? ` bond edit` : ``} (${shortcut})`}
      {@const count = history[`${action}_stack`].length}
      <button
        type="button"
        aria-label={title}
        disabled={count === 0}
        onclick={bond_edit ? session[`${action}_bond_edit`] : session[action]}
        {title}
        class="undo-redo-btn"
        style={shortcut_style(action)}
      >
        <Icon {icon} />
        {#if count > 0}
          <span class="history-count">{count}</span>
        {/if}
      </button>
    {/each}
  </div>
{/snippet}

{#if measure_mode === `edit-atoms` && !measure_menu_open}
  <div class="edit-mode-toolbar" aria-label="Atom editing controls">
    {@render undo_redo_snippet()}
    {#if session.add_atom_mode}
      <div class="add-atom-input">
        <label>
          <span>Element:</span>
          <!-- svelte-ignore a11y_autofocus (keyboard-driven atom editing) -->
          <input
            type="text"
            autofocus
            bind:value={session.add_element}
            maxlength="2"
            placeholder="C"
            style="width: 3em; text-align: center"
            onkeydown={(event) => {
              if (event.defaultPrevented || event.isComposing || event.key !== `Escape`) return
              session.add_atom_mode = false
              event.preventDefault()
            }}
          />
        </label>
        <span style="font-size: 0.75em; opacity: 0.7">Click to place</span>
      </div>
    {/if}
    {#if session.change_element_mode && selected_count > 0}
      <div class="add-atom-input">
        <label>
          <span>New element:</span>
          <input
            type="text"
            bind:value={change_element_value}
            maxlength="2"
            placeholder="Fe"
            style="width: 3em; text-align: center"
            onkeydown={(event: KeyboardEvent) => {
              if (event.defaultPrevented || event.isComposing) return
              if (event.key === `Enter`) {
                if (session.change_element(change_element_value)) {
                  change_element_value = ``
                }
              } else if (event.key === `Escape`) session.change_element_mode = false
              event.stopPropagation()
            }}
            {@attach (node: HTMLInputElement) => node.focus()}
          />
        </label>
        <span style="font-size: 0.75em; opacity: 0.7">Enter to apply</span>
      </div>
    {/if}
  </div>
{/if}

{#if measure_mode === `edit-bonds` && !measure_menu_open}
  <div class="edit-mode-toolbar bond-edit-toolbar" aria-label="Bond editing controls">
    {#if bond_edit_mode === `add`}
      <label>
        <span>Bond order</span>
        <select
          bind:value={
            () => session.inputs.bond_edit_order(), session.inputs.set_bond_edit_order
          }
        >
          {#each BOND_ORDER_OPTIONS as { order, label } (label)}
            <option value={order}>{label}</option>
          {/each}
        </select>
      </label>
    {/if}
    <div class="bond-edit-mode-toggle">
      {#each BOND_EDIT_MODES as { mode, label, title } (mode)}
        <button
          type="button"
          class:selected={bond_edit_mode === mode}
          style={shortcut_style(`bond-${mode}`)}
          aria-pressed={bond_edit_mode === mode}
          title="{title} ({label[0]})"
          onclick={() => session.inputs.set_bond_edit_mode(mode)}
        >
          {label}
        </button>
      {/each}
    </div>
    {@render undo_redo_snippet(true)}
  </div>
{/if}

<style>
  .selection-limit-text {
    font-weight: bold;
    font-size: 0.9em;
    color: var(--accent-color, #ff6b6b);
    min-width: 2.5em;
    text-align: center;
  }
  .edit-mode-toolbar {
    position: absolute;
    top: calc(100% + 4pt);
    right: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0.4em;
    width: max-content;
    max-width: calc(100cqw - 2ex);
    box-sizing: border-box;
    padding: 0.25em;
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, var(--page-bg, Canvas) 85%, transparent);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  }
  .undo-redo-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .edit-mode-toolbar.bond-edit-toolbar {
    --bond-edit-control-height: 1.8em;
    font-size: 0.8em;
    label,
    .bond-edit-mode-toggle {
      display: flex;
      align-items: center;
    }
    label {
      gap: 0.25em;
    }
    select {
      max-width: 8em;
      font: inherit;
    }
    label,
    select,
    .bond-edit-mode-toggle button {
      height: var(--bond-edit-control-height);
      line-height: 1;
    }
    .bond-edit-mode-toggle {
      gap: 0.35em;
      button {
        min-width: 3.5em;
        font: inherit;
      }
      button.selected {
        background: var(--accent-color, #007acc);
        color: white;
      }
      button.selected:hover {
        background-color: color-mix(in srgb, var(--accent-color, #007acc) 70%, black);
      }
    }
  }
  .history-count {
    position: absolute;
    bottom: -2px;
    right: -2px;
    background: var(--accent-color, #007acc);
    color: white;
    border-radius: 50%;
    width: 12px;
    height: 12px;
    font-size: 8px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    pointer-events: none;
    z-index: 1;
  }
  .add-atom-input {
    display: flex;
    align-items: center;
    gap: 0.5em;
    color: var(--text-color, currentColor);
    font-size: 0.8rem;
    label {
      display: flex;
      align-items: center;
      gap: 0.3em;
    }
    input {
      background: color-mix(in srgb, currentColor 10%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      border-radius: 3px;
      color: inherit;
      font-size: 0.85rem;
      padding: 0.1em 0.3em;
    }
  }
</style>
