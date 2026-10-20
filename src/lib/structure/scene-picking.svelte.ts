// Picking for StructureScene: hover and selection state plus the pure rules the pointer
// handlers apply. The scene owns the bindable props (hovered_idx, selected_sites, ...) and
// wires raycast hits to these; nothing here touches the canvas.
import type { HoverHandlers, TapEvent } from '#lib/scene/index.js'
import * as math from '#lib/math.js'
import type { Vec3 } from '#lib/math.js'
import type { BondEditMode, BondPair, MeasureMode, Site } from '#lib/structure/index.js'
import { toggle_item } from '#lib/utils.js'
import { Vector3, type Mesh, type Object3D } from 'three/webgpu'
import * as measure from './measure'

export const ATOM_HOVER_CLEAR_DELAY_MS = 200
// Instanced-atom raycasts do not always emit pointerdown, so edit-bonds also falls back to
// click. When pointerdown did fire, the matching click within this window is skipped once.
export const EDIT_BONDS_CLICK_DEDUPE_MS = 250

// Hover and edit-bonds press state. hovered_idx itself is a bindable scene prop, so it is
// reached through `hovered`; the tooltip flag and hovered bond are local to the scene.
export class ScenePointer {
  tooltip_active = $state(false)
  hovered_bond_key = $state<string | null>(null)
  #clear_timeout: ReturnType<typeof setTimeout> | undefined
  #pressed_site: number | null = null
  #pressed_timeout: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly hovered: {
      get: () => number | null
      set: (site_idx: number | null) => void
    },
  ) {}

  set_hover = (site_idx: number): void => {
    clearTimeout(this.#clear_timeout)
    if (this.hovered.get() !== site_idx) this.hovered.set(site_idx)
    if (!this.tooltip_active) this.tooltip_active = true
  }

  clear_hover = (site_idx: number): void => {
    clearTimeout(this.#clear_timeout)
    if (this.hovered.get() !== site_idx) return
    this.hovered.set(null)
    this.tooltip_active = false
  }

  // Delayed so the pointer crossing from one instance to the next doesn't flash the tooltip
  schedule_hover_clear = (site_idx: number): void => {
    clearTimeout(this.#clear_timeout)
    this.#clear_timeout = setTimeout(
      () => this.clear_hover(site_idx),
      ATOM_HOVER_CLEAR_DELAY_MS,
    )
  }

  // Drop the hover at once (camera moves, drags): no delayed clear may resurrect it
  drop_hover = (): void => {
    clearTimeout(this.#clear_timeout)
    this.hovered.set(null)
  }

  hover_props = (site_idx: number): HoverHandlers => ({
    onpointerenter: () => this.set_hover(site_idx),
    onpointermove: () => this.set_hover(site_idx),
    onpointerleave: () => this.schedule_hover_clear(site_idx),
  })

  remember_press = (site_idx: number): void => {
    this.#pressed_site = site_idx
    clearTimeout(this.#pressed_timeout)
    this.#pressed_timeout = setTimeout(() => {
      this.#pressed_site = null
    }, EDIT_BONDS_CLICK_DEDUPE_MS)
  }

  // True (once) when this click follows a pointerdown already handled for the same site
  skip_pressed_click = (site_idx: number): boolean => {
    if (this.#pressed_site !== site_idx) return false
    this.#pressed_site = null
    clearTimeout(this.#pressed_timeout)
    return true
  }

  dispose = (): void => {
    clearTimeout(this.#clear_timeout)
    clearTimeout(this.#pressed_timeout)
  }
}

// Display-only meshes (highlight shells, hovered bonds) must not shadow what they outline
export const disable_raycast = (mesh: Mesh): void => {
  mesh.raycast = () => undefined
}

// Pointer handlers for an instanced mesh: intersection events carry the hit `instanceId`,
// which indexes into the mesh's records. One handler set per mesh instead of one per atom.
export const instance_handlers = (
  instance_atoms: readonly { site_idx: number }[],
  handlers: Record<keyof HoverHandlers, (site_idx: number, event: TapEvent) => void>,
): HoverHandlers =>
  Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      (event: TapEvent) => {
        const site_idx = instance_atoms[event.instanceId ?? -1]?.site_idx
        if (site_idx != null) handler(site_idx, event)
      },
    ]),
  )

// The scene's interaction state that clicks and the cursor are judged against
export type PickState = {
  measure_mode: MeasureMode
  bond_edit_mode: BondEditMode
  bond_edits_enabled: boolean
  add_atom_mode: boolean
  interactive: boolean // false in inactive multi-view panes
  measured_sites: number[]
  selected_sites: number[]
  hovered_idx: number | null
  hovered_bond_key: string | null
  can_select_bond_site: (site_idx: number) => boolean
  is_image_site: (site_idx: number) => boolean
}
type SiteSelection = Pick<PickState, `measured_sites` | `selected_sites`>

// The selection a click on `site_idx` leaves; null = unchanged. In edit-bonds add mode a second
// pick completes `bond_pair`, which the caller adds or restores before clearing the selection.
export function next_site_selection(
  site_idx: number,
  state: PickState,
  shift_key: boolean,
): (SiteSelection & { bond_pair?: [number, number] }) | null {
  const { measure_mode, measured_sites, selected_sites } = state
  if (measure_mode === `edit-bonds`) {
    // Only the active pane edits: inactive panes keep selection/hover overlays visible
    // but must not change selection or add/restore bonds in shared state.
    if (!state.interactive) return null
    if (state.bond_edit_mode === `delete`) return { measured_sites: [], selected_sites: [] }
    if (!state.can_select_bond_site(site_idx)) return null
    // In Add mode, select atom pairs without making existing bonds destructive.
    const new_sites = toggle_item(measured_sites, site_idx)
    const bond_pair: [number, number] | undefined =
      new_sites.length === 2 ? [new_sites[0], new_sites[1]] : undefined
    return { measured_sites: new_sites, selected_sites: new_sites, bond_pair }
  }

  if (measure_mode === `edit-atoms`) {
    // Inactive panes don't drive edit-atoms selection (gizmo/add-plane are interactive-gated)
    // and viewer-generated image atoms can't be moved
    if (!state.interactive || state.is_image_site(site_idx)) return null
    // selected_sites and measured_sites stay in sync. Shift multi-selects; a plain click
    // replaces the selection (or deselects a selected site).
    const new_sites = shift_key
      ? toggle_item(selected_sites, site_idx)
      : selected_sites.includes(site_idx)
        ? []
        : [site_idx]
    return { measured_sites: new_sites, selected_sites: new_sites }
  }

  const site_cap = measure.max_measured_sites(measure_mode)
  if (!measured_sites.includes(site_idx) && measured_sites.length >= site_cap) {
    if (!measure.rolls_measured_sites(measure_mode)) {
      console.warn(
        `Selection size limit reached (${measure.MAX_SELECTED_SITES}). Deselect some sites first.`,
      )
      return null
    }
    const dropped = measured_sites[0]
    return {
      measured_sites: [...measured_sites.slice(1), site_idx],
      selected_sites: [...selected_sites.filter((idx) => idx !== dropped), site_idx],
    }
  }
  return {
    measured_sites: toggle_item(measured_sites, site_idx),
    selected_sites: toggle_item(selected_sites, site_idx),
  }
}

// Shift state of a click: threlte dispatches plain objects wrapping the DOM event, so read it
// from the native event (the wrapper itself is never a MouseEvent for 3D hits)
export const is_shift_click = (event?: Event | TapEvent): boolean => {
  const native_event = (event as { nativeEvent?: unknown } | undefined)?.nativeEvent ?? event
  return native_event instanceof MouseEvent && native_event.shiftKey
}

// Canvas cursor for the current mode and hover
export function scene_cursor(state: PickState): string {
  const { measure_mode, hovered_idx } = state
  if (!state.interactive) return `default`
  if (measure_mode === `edit-atoms` && state.add_atom_mode) return `crosshair`
  if (measure_mode === `edit-bonds` && state.hovered_bond_key != null) {
    return state.bond_edits_enabled ? `pointer` : `not-allowed`
  }
  if (hovered_idx != null) {
    if (measure_mode === `edit-bonds`) {
      return state.bond_edit_mode === `add` && state.can_select_bond_site(hovered_idx)
        ? `pointer`
        : `not-allowed`
    }
    if (measure_mode === `edit-atoms` && state.is_image_site(hovered_idx)) return `not-allowed`
    return `pointer`
  }
  return `default`
}

// A hit within this fraction of a bond's length from either end picks that end's atom
const BOND_ENDPOINT_HIT_FRACTION = 0.3
const BOND_ENDPOINT_SITE_MATCH_TOLERANCE = 1e-6
// scratch: the endpoint search below runs per pointer event over every site
const site_world_pos = new Vector3()

// The drawn site at a bond end: the bonded site itself, or the PBC image of it sitting there
function bond_endpoint_site_idx(
  sites: readonly Site[],
  site_idx: number,
  world_position: Vector3,
  parent: Object3D,
): number {
  const matches_world_position = (candidate_site: Site): boolean =>
    parent
      .localToWorld(site_world_pos.set(...candidate_site.xyz))
      .distanceTo(world_position) <= BOND_ENDPOINT_SITE_MATCH_TOLERANCE
  const site = sites[site_idx]
  if (!site || matches_world_position(site)) return site_idx
  const image_site_idx = sites.findIndex(
    (candidate_site) =>
      candidate_site.provenance?.image_of === site_idx &&
      matches_world_position(candidate_site),
  )
  return image_site_idx === -1 ? site_idx : image_site_idx
}

// Site picked by a hit at world `point` on a bond hit cylinder under `parent`, or null for a
// hit on the bond's middle stretch
export function bond_endpoint_hit_site_idx(
  bond: BondPair,
  point: Vector3 | undefined,
  parent: Object3D | null | undefined,
  sites: readonly Site[] | undefined,
): number | null {
  if (!point || !parent) return null
  const world_pos_1 = parent.localToWorld(new Vector3(...bond.pos_1))
  const world_pos_2 = parent.localToWorld(new Vector3(...bond.pos_2))
  const bond_vec = world_pos_2.clone().sub(world_pos_1)
  const length_sq = bond_vec.lengthSq()
  if (length_sq <= math.EPS) return null
  const bond_fraction = point.clone().sub(world_pos_1).dot(bond_vec) / length_sq
  const end =
    bond_fraction <= BOND_ENDPOINT_HIT_FRACTION
      ? ([bond.site_idx_1, world_pos_1] as const)
      : bond_fraction >= 1 - BOND_ENDPOINT_HIT_FRACTION
        ? ([bond.site_idx_2, world_pos_2] as const)
        : null
  if (!end) return null
  return sites ? bond_endpoint_site_idx(sites, end[0], end[1], parent) : end[0]
}

// Context-menu anchor in the bond's parent space: the hit point, else the bond midpoint
export function bond_menu_position(
  bond: BondPair,
  point?: Vector3,
  parent?: Object3D | null,
): Vec3 {
  if (!point || !parent) return math.lerp_vec3(bond.pos_1, bond.pos_2, 0.5)
  const local_point = parent.worldToLocal(point.clone())
  return [local_point.x, local_point.y, local_point.z]
}
