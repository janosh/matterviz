import * as THREE from 'three';

// MatterViz (and some dependencies) expect three.js classes on the global object.
// Install THREE early so downstream imports can rely on it.
if (typeof window !== 'undefined') {
  if (!window.THREE) window.THREE = THREE;
  for (const [key, val] of Object.entries(THREE)) {
    if (!window[key]) {
      window[key] = val;
    }
  }
}

