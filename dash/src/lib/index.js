// Three.js globals must be set up before importing MatterViz components
import './threeGlobals'

// Import public path utilities (for Dash asset resolution)
import './publicPath'

// Register the Svelte custom element and global MatterViz CSS.
import './registerCustomElements'

export { default as MatterViz } from './components/MatterViz.react'
