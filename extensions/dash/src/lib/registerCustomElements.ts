// Global MatterViz styles. Shell-layer rules (body, main, headings) are in
// @layer matterviz-shell so host-dash-app unlayered CSS automatically wins.
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import -- side-effect only
import 'matterviz/app.css'

// this import defines the custom element <mv-matterviz>
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import -- side-effect only
import '../svelte/MatterViz.ce.svelte'
