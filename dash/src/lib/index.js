// IMPORTANT: set Webpack public path before anything else so that emitted assets
// (e.g. .wasm) are fetched from the correct Dash component-suites URL.
import './publicPath';
import './threeGlobals';

// Register the Svelte custom element and global MatterViz CSS.
import './registerCustomElements';

export { default as MatterViz } from './components/MatterViz.react';
