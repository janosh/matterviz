/**
 * Three.js Global Installation
 *
 * Some MatterViz dependencies (e.g., older three.js addons, certain controls)
 * expect THREE classes to be available on the global `window` object rather than
 * imported as ES modules. This module installs three.js globally before any
 * MatterViz components are loaded.
 *
 * This is imported early in the bundle entry point (index.js) to ensure globals
 * are available before downstream imports that may depend on them.
 *
 * Note: This is a compatibility shim. Newer three.js ecosystem code uses ES imports
 * directly, but we maintain this for backward compatibility with MatterViz internals.
 */
import * as THREE from 'three'

if (typeof window !== `undefined`) {
  // Install the THREE namespace if not already present
  if (!globalThis.THREE) globalThis.THREE = THREE

  // Also install individual exports (Vector3, Matrix4, etc.) for legacy code
  // that accesses them directly on window
  for (const [key, val] of Object.entries(THREE)) {
    if (!globalThis[key]) {
      globalThis[key] = val
    }
  }
}
