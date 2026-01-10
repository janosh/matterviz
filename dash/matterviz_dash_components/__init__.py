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
_js_dist = [
    {
        "relative_package_path": "matterviz_dash_components.min.js",
        "namespace": _namespace,
    },
    {
        "relative_package_path": "155.matterviz_dash_components.min.js",
        "namespace": _namespace,
    },
    {
        "relative_package_path": "210.matterviz_dash_components.min.js",
        "namespace": _namespace,
    },
    {
        "relative_package_path": "861.matterviz_dash_components.min.js",
        "namespace": _namespace,
    },
    {
        # WebAssembly asset emitted by webpack (required for symmetry, etc.)
        # Stable filename is configured in webpack.config.js (generator.filename).
        "relative_package_path": "matterviz_wasm.wasm",
        "namespace": _namespace,
    },
]

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


def component(name: str, **mv_props):
    """Create a MatterViz component by name/path (generic API).

    Equivalent to:
        MatterViz(component=name, mv_props=mv_props)
    """
    return MatterViz(component=name, mv_props=mv_props)


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
        def _factory(**mv_props):
            return MatterViz(component=name, mv_props=mv_props)

        _factory.__name__ = name
        _factory.__doc__ = (
            f"Factory for MatterViz component '{name}'.\n\n"
            "This is syntactic sugar for:\n"
            "    MatterViz(component=..., mv_props={...})"
        )
        return _factory

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
