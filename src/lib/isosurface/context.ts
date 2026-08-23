// Host hook for Isosurface geometry-worker failures. Structure registers it once as Svelte
// context so the scene/viewport layers between it and Isosurface carry no pass-through prop;
// Isosurface reads it when mounted without an explicit `on_error`.
import { getContext, setContext } from 'svelte'

export type IsosurfaceErrorHandler = (message: string) => void

export const ISOSURFACE_ERROR_CONTEXT: unique symbol = Symbol(`isosurface_error`)

export const set_isosurface_error_handler = (handler: IsosurfaceErrorHandler): void => {
  setContext(ISOSURFACE_ERROR_CONTEXT, handler)
}

// undefined outside a host that registered one (standalone Isosurface usage)
export const get_isosurface_error_handler = (): IsosurfaceErrorHandler | undefined =>
  getContext<IsosurfaceErrorHandler | undefined>(ISOSURFACE_ERROR_CONTEXT)
