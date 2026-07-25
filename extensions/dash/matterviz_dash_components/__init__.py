"""matterviz_dash_components - Dash wrapper for MatterViz (Svelte) components.

Usage:
    from matterviz_dash_components import Structure, PeriodicTable, MatterViz

    # Typed wrappers (recommended) - IDE autocompletion for all props
    Structure(structure=my_structure, show_controls=True)

    # Generic wrapper - for dynamic component selection
    MatterViz(component="structure/Structure", mv_props={"structure": my_structure})
"""

import mimetypes
from importlib.metadata import PackageNotFoundError, version

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
    PeriodicTable,
    RdfPlot,
    ScatterPlot,
    Structure,
    Trajectory,
    XrdPlot,
)

# Re-export asset definitions from MatterViz class for package-level discovery.
_js_dist = MatterViz._js_dist
_css_dist = MatterViz._css_dist

try:
    __version__ = version("matterviz-dash-components")
except PackageNotFoundError:
    # the flat layout makes this importable from a source checkout that was never installed
    __version__ = "0.0.0+unknown"

if mimetypes.guess_type("x.wasm")[0] != "application/wasm":
    mimetypes.add_type("application/wasm", ".wasm")
