"""matterviz_dash_components

Dash wrapper for MatterViz (Svelte) components.

Public API
----------
- MatterViz: generic Dash component that renders any MatterViz component by name/path
- Typed wrappers: Structure, PeriodicTable, Trajectory, ... (generated from MatterViz .d.ts)
- component(name, **mv_props): small factory helper
"""

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

from .MatterViz import MatterViz  # noqa: F401,E402
from .typed import *  # noqa: F403,E402
from .typed import __all__ as _typed_all  # noqa: E402

__version__ = "0.0.2"

__all__ = ["MatterViz", "component", "_js_dist", "_css_dist", *_typed_all]

# Ensure wasm is served with the correct MIME type when hosted via Dash Flask.
try:  # pragma: no cover
    import mimetypes

    if mimetypes.guess_type("file.wasm")[0] != "application/wasm":
        mimetypes.add_type("application/wasm", ".wasm")
except Exception:
    pass


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

    This is kept for advanced / experimental components that aren't in the curated
    typed wrapper list. If the attribute name starts with an uppercase letter,
    we return a factory function that builds ``MatterViz(component=name, mv_props=...)``.

    Example:
        import matterviz_dash_components as mvc
        custom = mvc.MyNewComponent(foo=123)  # becomes MatterViz(component="MyNewComponent", mv_props={...})
    """
    if name and name[0].isupper():

        def _factory(
            id: str | None = None,
            className: str | None = None,
            style: dict | None = None,
            set_props: list[str] | None = None,
            float32_props: list[str] | None = None,
            event_props: list[str] | None = None,
            last_event: dict | None = None,
            **mv_props,
        ) -> MatterViz:
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

        _factory.__name__ = name
        _factory.__doc__ = (
            f"Factory for MatterViz component '{name}'.\n\n"
            "This is syntactic sugar for:\n"
            "    MatterViz(component=..., mv_props={...})\n\n"
            "Supports id, className, style, set_props, float32_props, and event_props."
        )
        return _factory

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
