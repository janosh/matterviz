/* eslint-disable no-undef */

// Dash injects configuration into window.__dash_config__.
// We use requests_pathname_prefix so this component library works when the app is
// mounted under a URL prefix (e.g. /myapp/).
if (typeof window !== 'undefined' && window.__dash_config__) {
  const prefix = window.__dash_config__.requests_pathname_prefix || '/';
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;

  // Dash serves component library assets from:
  //   <requests_pathname_prefix>_dash-component-suites/<namespace>/
  __webpack_public_path__ = `${normalized}_dash-component-suites/matterviz_dash_components/`;
}
