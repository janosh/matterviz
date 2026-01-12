"""matterviz_dash_components

Dash wrapper for MatterViz (Svelte) components.

Public API
----------
- MatterViz: generic Dash component that renders any MatterViz component by name/path
- Typed wrappers: Structure, PeriodicTable, Trajectory, ... (generated from MatterViz .d.ts)
- component(name, **mv_props): small factory helper
"""

import mimetypes

from .MatterViz import MatterViz
from .typed import (  # noqa: F401
    Bands,
    BrillouinZone,
    Composition,
    ConvexHull2D,
    ConvexHull3D,
    ConvexHull4D,
    Dos,
    Histogram,
    IsobaricBinaryPhaseDiagram,
    IsobaricTernaryPhaseDiagram,
    PeriodicTable,
    RdfPlot,
    ScatterPlot,
    Structure,
    Trajectory,
    XrdPlot,
)

_namespace = "matterviz_dash_components"

# Asset definitions (served via Dash component suites)
# Vite bundles everything into a single UMD file plus assets.
_js_dist = [
    {
        "relative_package_path": "matterviz_dash_components.min.js",
        "namespace": _namespace,
    },
]

# Note: WASM files are loaded dynamically by the JS bundle when needed,
# not as script tags. They should still be included in the package data.

_css_dist = [
    {
        "relative_package_path": "matterviz_dash_components.css",
        "namespace": _namespace,
    }
]

__version__ = "0.0.2"

if mimetypes.guess_type("x.wasm")[0] != "application/wasm":
    mimetypes.add_type("application/wasm", ".wasm")


def component(
    name: str,
    id: str | None = None,
    className: str | None = None,
    style: dict | None = None,
    set_props: list[str] | None = None,
    float32_props: list[str] | None = None,
    event_props: list[str] | None = None,
    last_event: dict | None = None,
    **mv_props,
) -> MatterViz:
    """Create a MatterViz component by name/path (generic API).

    Equivalent to:
        MatterViz(component=name, mv_props=mv_props, ...)

    Args:
        name: Component identifier (e.g. "Structure" or "structure/Structure").
        id: Dash component id.
        className: CSS class name.
        style: Inline styles dict.
        set_props: Props to convert from list to Set on JS side.
        float32_props: Props to convert from list to Float32Array on JS side.
        event_props: Callback prop names to inject.
        last_event: Updated whenever any injected callback fires.
        **mv_props: Props forwarded to the MatterViz component.
    """
    return MatterViz(
        id=id,
        component=name,
        mv_props=mv_props,
        className=className,
        style=style,
        set_props=set_props,
        float32_props=float32_props,
        event_props=event_props,
        last_event=last_event,
    )


def __getattr__(name: str):
    """Fallback factory for arbitrary MatterViz components.

    Returns a factory that calls component(name, **kwargs).

    Example:
        import matterviz_dash_components as mvc
        mvc.MyNewComponent(foo=123)  # -> MatterViz(component="MyNewComponent", ...)
    """
    if name and name[0].isupper():

        def _factory(**kwargs) -> MatterViz:
            return component(name, **kwargs)

        _factory.__name__ = name
        _factory.__doc__ = f"Factory for MatterViz component '{name}'."
        return _factory

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
