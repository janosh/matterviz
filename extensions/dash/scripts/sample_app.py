"""Minimal Dash app to exercise matterviz-dash-components."""

from __future__ import annotations

import gzip
import json
import math
import os
from pathlib import Path
from typing import Any, Callable

import dash
import matterviz_dash_components as mvc
from dash import Input, Output, dcc, html

# Path to the matterviz root directory (scripts/ -> dash/ -> extensions/ -> root)
# Override with MATTERVIZ_ROOT env var if script is run from a different location
MATTERVIZ_ROOT = Path(os.environ.get("MATTERVIZ_ROOT") or __file__).parent.parent.parent.parent


def load_json_file(file_path: Path) -> Any:
    """Load a JSON file, handling gzip compression if needed."""
    if not file_path.exists():
        print(f"File not found: {file_path}")
        return None

    if file_path.suffix == ".gz":
        with gzip.open(file_path, "rt", encoding="utf-8") as fh:
            return json.load(fh)
    with open(file_path, encoding="utf-8") as fh:
        return json.load(fh)


def load_xye_file(file_path: Path) -> dict | None:
    """Load XRD pattern from .xye or .xy file (2-column: 2theta, intensity)."""
    if not file_path.exists():
        return None

    x_vals: list[float] = []
    y_vals: list[float] = []

    with open(file_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) >= 2:
                try:
                    x_vals.append(float(parts[0]))
                    y_vals.append(float(parts[1]))
                except ValueError:
                    continue

    if not x_vals:
        return None
    return {"x": x_vals, "y": y_vals}


def _load_site_data(subpath: str, name: str, ext: str = ".json.gz") -> Any:
    """Load JSON data from src/site/{subpath}/{name}{ext}."""
    return load_json_file(MATTERVIZ_ROOT / "src" / "site" / subpath / f"{name}{ext}")


def load_phase_diagram(system: str) -> dict | None:
    """Load a binary phase diagram."""
    return _load_site_data("phase-diagrams/binary", system)


def load_structure(name: str) -> dict | None:
    """Load a structure file (tries .json then .json.gz)."""
    struct_dir = MATTERVIZ_ROOT / "src" / "site" / "structures"
    for ext in (".json", ".json.gz"):
        if (path := struct_dir / f"{name}{ext}").exists():
            return load_json_file(path)
    return None


def load_convex_hull_entries(system: str) -> list[dict] | None:
    """Load convex hull entries."""
    return _load_site_data("convex-hull/quaternaries", system)


def load_phonon_bands(name: str) -> dict | None:
    """Load phonon band structure."""
    return _load_site_data("phonons", name)


def load_electronic_dos(name: str) -> dict | None:
    """Load electronic DOS."""
    return _load_site_data("electronic/dos", name)


def load_electronic_bands(name: str) -> dict | None:
    """Load electronic band structure."""
    return _load_site_data("electronic/bands", name)


def load_xrd_pattern(name: str) -> dict | None:
    """Load XRD pattern from the static/xrd directory."""
    xrd_dir = MATTERVIZ_ROOT / "static" / "xrd"
    return load_xye_file(xrd_dir / f"{name}.xye")


# Available demo files
AVAILABLE_PHASE_DIAGRAMS = [
    "Al-Cu",
    "Al-Fe",
    "Al-Mg",
    "Al-Si",
    "Au-Sn",
    "Cu-Zn",
    "Fe-Ni",
    "Pb-Sn",
]

AVAILABLE_STRUCTURES = [
    "mp-1234",  # Lu3Al (garnet)
    "mp-2",  # Pd (FCC)
    "mp-1",  # Cs (BCC)
    "Cu-FCC",
    "Fe-BCC",
    "mp-12712",  # LiFePO4
]

AVAILABLE_CONVEX_HULLS = [
    "Li-Co-Ni-O",
    "Na-Fe-P-O",
]

AVAILABLE_PHONONS = [
    "mp-2667-Cs1Au1-pbe",
    "mp-2691-Cd4Se4-pbe",
    "mp-2758-Sr4Se4-pbe",
]

AVAILABLE_DOS = [
    "dos-spin-polarization-mp-865805",
    "lobster-complete-dos-spin",
]

AVAILABLE_BANDS = [
    "cao-2605-bands",
    "vbr2-971787-bands",
]

AVAILABLE_XRD = [
    "synthetic-quartz-xrd",
]

# Caches for loaded data (not thread-safe; fine for demo app)
_cache: dict[str, Any] = {}


def get_cached(key: str, loader: Callable[[str], Any]) -> Any:
    """Load data via loader(key), caching the result."""
    if key not in _cache:
        if data := loader(key):
            _cache[key] = data
    return _cache.get(key)


# Note: WASM MIME type is set in matterviz_dash_components/__init__.py

SILICON_STRUCTURE = {
    "lattice": {
        "matrix": [
            [5.43, 0, 0],
            [0, 5.43, 0],
            [0, 0, 5.43],
        ],
        "pbc": [True, True, True],
        "volume": 5.43 * 5.43 * 5.43,
        "a": 5.43,
        "b": 5.43,
        "c": 5.43,
        "alpha": 90,
        "beta": 90,
        "gamma": 90,
    },
    "sites": [
        {
            "abc": [0, 0, 0],
            "xyz": [0, 0, 0],
            "species": [{"element": "Si", "occu": 1, "oxidation_state": 0}],
            "label": "Si",
            "properties": {},
        },
        {
            "abc": [0.25, 0.25, 0.25],
            "xyz": [1.3575, 1.3575, 1.3575],
            "species": [{"element": "Si", "occu": 1, "oxidation_state": 0}],
            "label": "Si",
            "properties": {},
        },
    ],
}

# K-path for simple cubic BZ: Γ → X → M → Γ → R
# Reciprocal lattice constant: 2π/5.43 ≈ 1.157 Å⁻¹
_B = 2 * math.pi / 5.43  # reciprocal lattice constant


def _interp(start: list[float], end: list[float], n_pts: int = 10) -> list[list[float]]:
    """Interpolate n_pts between start and end (excluding end)."""
    return [
        [start[j] + (end[j] - start[j]) * idx / n_pts for j in range(3)]
        for idx in range(n_pts)
    ]


# High-symmetry points in Cartesian reciprocal coords
_GAMMA = [0, 0, 0]
_X = [0.5 * _B, 0, 0]
_M = [0.5 * _B, 0.5 * _B, 0]
_R = [0.5 * _B, 0.5 * _B, 0.5 * _B]

# Build k-path: Γ → X → M → Γ → R with interpolated points
KPATH_POINTS = (
    _interp(_GAMMA, _X, 8)
    + _interp(_X, _M, 8)
    + _interp(_M, _GAMMA, 12)
    + _interp(_GAMMA, _R, 10)
    + [_R]
)

KPATH_LABELS = [
    {"position": _GAMMA, "label": "Γ"},
    {"position": _X, "label": "X"},
    {"position": _M, "label": "M"},
    {"position": _GAMMA, "label": "Γ"},
    {"position": _R, "label": "R"},
]

TRAJECTORY_FRAMES = [
    {
        "structure": SILICON_STRUCTURE,
        "step": 0,
    },
    {
        "structure": {
            **SILICON_STRUCTURE,
            "sites": [
                {**SILICON_STRUCTURE["sites"][0], "abc": [0.02, 0.0, 0.0]},
                {**SILICON_STRUCTURE["sites"][1], "abc": [0.27, 0.25, 0.25]},
            ],
        },
        "step": 1,
    },
]


def layout() -> html.Div:
    """Build the main layout with demo sections for each MatterViz component."""
    sections: list[tuple[str, str]] = [
        ("periodic-table-section", "Periodic Table"),
        ("structure-section", "Structure"),
        ("composition-section", "Composition"),
        ("trajectory-section", "Trajectory"),
        ("brillouin-section", "Brillouin Zone"),
        ("convex-3d-section", "Convex Hull"),
        ("phase-binary-section", "Phase Diagram"),
        ("phonon-section", "Phonon Bands"),
        ("dos-section", "Electronic DOS"),
        ("bands-section", "Electronic Bands"),
        ("xrd-section", "XRD Plot"),
        ("callback-section", "Callback Demo"),
    ]

    # Initial data loading
    initial_structure = get_cached("mp-1234", load_structure) or SILICON_STRUCTURE
    initial_hull = get_cached("Li-Co-Ni-O", load_convex_hull_entries) or []
    initial_phase = get_cached("Al-Cu", load_phase_diagram) or {}
    initial_phonon = get_cached(AVAILABLE_PHONONS[0], load_phonon_bands)
    initial_dos = get_cached(AVAILABLE_DOS[0], load_electronic_dos)
    initial_bands = get_cached(AVAILABLE_BANDS[0], load_electronic_bands)
    initial_xrd = get_cached(AVAILABLE_XRD[0], load_xrd_pattern)

    # Get dark mode preference from localStorage via clientside callback
    return html.Div(
        id="main-container",
        style={
            "display": "grid",
            "gap": "16px",
            "padding": "12px",
            "minHeight": "100vh",
            "maxWidth": "100%",
            "overflowX": "hidden",
            "boxSizing": "border-box",
            "transition": "background 0.3s, color 0.3s",
        },
        children=[
            # Theme toggle
            html.Div(
                [
                    html.H1(
                        "MatterViz Dash demo",
                        style={
                            "textAlign": "center",
                            "fontSize": "2.5rem",
                            "margin": "0",
                            "flex": "1",
                        },
                    ),
                    html.Button(
                        "🌙 Dark",
                        id="theme-toggle",
                        n_clicks=0,
                        style={
                            "padding": "8px 16px",
                            "borderRadius": "6px",
                            "border": "1px solid #ccc",
                            "cursor": "pointer",
                            "fontSize": "14px",
                        },
                    ),
                ],
                style={
                    "display": "flex",
                    "alignItems": "center",
                    "justifyContent": "center",
                    "gap": "20px",
                    "marginBottom": "16px",
                },
            ),
            # Navigation
            html.Nav(
                html.Ul(
                    [
                        html.Li(
                            html.A(
                                title,
                                href=f"#{sid}",
                                style={
                                    "display": "inline-block",
                                    "padding": "4px 10px",
                                    "textDecoration": "none",
                                    "borderRadius": "4px",
                                    "fontSize": "13px",
                                },
                                className="nav-link",
                            ),
                        )
                        for sid, title in sections
                    ],
                    style={
                        "display": "flex",
                        "flexWrap": "wrap",
                        "listStyle": "none",
                        "padding": "0",
                        "margin": "0",
                        "gap": "6px",
                    },
                ),
            ),
            # Loading indicator (hidden by default)
            dcc.Loading(
                id="loading-indicator",
                type="circle",
                children=html.Div(id="loading-output", style={"display": "none"}),
            ),
            # Periodic Table
            html.Div(
                [
                    html.H4("Periodic Table"),
                    mvc.MatterViz(
                        id="periodic-table",
                        component="periodic-table/PeriodicTable",
                        mv_props={
                            "height": 480,
                            "show_color_bar": True,
                            "heatmap_values": {"Si": 1.0, "C": 0.7, "O": 0.5},
                        },
                        style={
                            "minHeight": "340px",
                            "border": "1px solid var(--border-color, #ddd)",
                        },
                    ),
                ],
                id="periodic-table-section",
            ),
            # Structure
            html.Div(
                [
                    html.H4("Structure"),
                    html.Div(
                        [
                            html.Label(
                                "Select structure: ",
                                style={"fontWeight": "500", "marginRight": "8px"},
                            ),
                            dcc.Dropdown(
                                id="structure-selector",
                                options=[
                                    {"label": s, "value": s}
                                    for s in AVAILABLE_STRUCTURES
                                ],
                                value="mp-1234",
                                clearable=False,
                                style={"width": "200px", "display": "inline-block"},
                            ),
                        ],
                        style={
                            "display": "flex",
                            "alignItems": "center",
                            "marginBottom": "12px",
                        },
                    ),
                    mvc.MatterViz(
                        id="structure",
                        component="structure/Structure",
                        mv_props={
                            "structure": initial_structure,
                            "show_controls": True,
                            "height": 400,
                        },
                        style={
                            "minHeight": "420px",
                            "border": "1px solid var(--border-color, #ddd)",
                        },
                    ),
                ],
                id="structure-section",
            ),
            # Composition
            html.Div(
                [
                    html.H4("Composition"),
                    html.Div(
                        [
                            mvc.MatterViz(
                                id="composition-1",
                                component="composition/Composition",
                                mv_props={
                                    "composition": "LiFePO4",
                                    "mode": "pie",
                                    "size": 180,
                                    "color_scheme": "vesta",
                                },
                                style={
                                    "border": "1px solid var(--border-color, #ddd)",
                                    "padding": "8px",
                                },
                            ),
                            mvc.MatterViz(
                                id="composition-2",
                                component="composition/Composition",
                                mv_props={
                                    "composition": "BaTiO3",
                                    "mode": "bar",
                                    "size": 180,
                                    "color_scheme": "jmol",
                                },
                                style={
                                    "border": "1px solid var(--border-color, #ddd)",
                                    "padding": "8px",
                                },
                            ),
                            mvc.MatterViz(
                                id="composition-3",
                                component="composition/Composition",
                                mv_props={
                                    "composition": "Sr2FeMoO6",
                                    "mode": "pie",
                                    "size": 180,
                                    "color_scheme": "vesta",
                                },
                                style={
                                    "border": "1px solid var(--border-color, #ddd)",
                                    "padding": "8px",
                                },
                            ),
                            mvc.MatterViz(
                                id="composition-4",
                                component="composition/Composition",
                                mv_props={
                                    "composition": {"Mg": 2, "Si": 1, "O": 4},
                                    "mode": "bar",
                                    "size": 180,
                                    "color_scheme": "jmol",
                                },
                                style={
                                    "border": "1px solid var(--border-color, #ddd)",
                                    "padding": "8px",
                                },
                            ),
                        ],
                        style={
                            "display": "grid",
                            "gridTemplateColumns": "repeat(auto-fit, minmax(200px, 1fr))",
                            "gap": "12px",
                        },
                    ),
                ],
                id="composition-section",
            ),
            # Trajectory
            html.Div(
                [
                    html.H4("Trajectory (2-frame toy)"),
                    mvc.MatterViz(
                        id="trajectory",
                        component="trajectory/Trajectory",
                        mv_props={
                            "trajectory": {"frames": TRAJECTORY_FRAMES},
                            "show_controls": True,
                            "fps": 1,
                            "height": 360,
                        },
                        style={
                            "minHeight": "380px",
                            "border": "1px solid var(--border-color, #ddd)",
                        },
                    ),
                ],
                id="trajectory-section",
            ),
            # Brillouin Zone
            html.Div(
                [
                    html.H4("Brillouin Zone"),
                    mvc.MatterViz(
                        id="brillouin",
                        component="brillouin/BrillouinZone",
                        mv_props={
                            "structure": SILICON_STRUCTURE,
                            "height": 360,
                            "k_path_points": KPATH_POINTS,
                            "k_path_labels": KPATH_LABELS,
                        },
                        style={
                            "minHeight": "380px",
                            "border": "1px solid var(--border-color, #ddd)",
                        },
                    ),
                ],
                id="brillouin-section",
            ),
            # Convex Hull
            html.Div(
                [
                    html.H4("Convex Hull (Quaternary)"),
                    html.Div(
                        [
                            html.Label(
                                "Select system: ",
                                style={"fontWeight": "500", "marginRight": "8px"},
                            ),
                            dcc.Dropdown(
                                id="convex-hull-selector",
                                options=[
                                    {"label": s, "value": s}
                                    for s in AVAILABLE_CONVEX_HULLS
                                ],
                                value="Li-Co-Ni-O",
                                clearable=False,
                                style={"width": "200px", "display": "inline-block"},
                            ),
                        ],
                        style={
                            "display": "flex",
                            "alignItems": "center",
                            "marginBottom": "12px",
                        },
                    ),
                    mvc.MatterViz(
                        id="convex-4d",
                        component="convex-hull/ConvexHull4D",
                        mv_props={
                            "entries": initial_hull,
                            "height": 450,
                        },
                        style={
                            "minHeight": "470px",
                            "border": "1px solid var(--border-color, #ddd)",
                        },
                    ),
                ],
                id="convex-3d-section",
            ),
            # Phase Diagram
            html.Div(
                [
                    html.H4("Binary Phase Diagram"),
                    html.Div(
                        [
                            html.Label(
                                "Select system: ",
                                style={"fontWeight": "500", "marginRight": "8px"},
                            ),
                            dcc.Dropdown(
                                id="phase-diagram-selector",
                                options=[
                                    {"label": k, "value": k}
                                    for k in AVAILABLE_PHASE_DIAGRAMS
                                ],
                                value="Al-Cu",
                                clearable=False,
                                style={"width": "200px", "display": "inline-block"},
                            ),
                        ],
                        style={
                            "display": "flex",
                            "alignItems": "center",
                            "marginBottom": "12px",
                        },
                    ),
                    mvc.MatterViz(
                        id="phase-binary",
                        component="phase-diagram/IsobaricBinaryPhaseDiagram",
                        mv_props={
                            "data": initial_phase,
                            "height": 500,
                        },
                        style={
                            "minHeight": "520px",
                            "border": "1px solid var(--border-color, #ddd)",
                        },
                    ),
                ],
                id="phase-binary-section",
            ),
            # Phonon Band Structure
            html.Div(
                [
                    html.H4("Phonon Band Structure"),
                    html.Div(
                        [
                            html.Label(
                                "Select material: ",
                                style={"fontWeight": "500", "marginRight": "8px"},
                            ),
                            dcc.Dropdown(
                                id="phonon-selector",
                                options=[
                                    {"label": s.replace("-pbe", ""), "value": s}
                                    for s in AVAILABLE_PHONONS
                                ],
                                value=AVAILABLE_PHONONS[0],
                                clearable=False,
                                style={"width": "250px", "display": "inline-block"},
                            ),
                        ],
                        style={
                            "display": "flex",
                            "alignItems": "center",
                            "marginBottom": "12px",
                        },
                    ),
                    mvc.MatterViz(
                        id="phonon-bands",
                        component="spectral/Bands",
                        mv_props={
                            "bands": initial_phonon,
                            "height": 400,
                        },
                        style={
                            "minHeight": "420px",
                            "border": "1px solid var(--border-color, #ddd)",
                        },
                    )
                    if initial_phonon
                    else html.P("Phonon data not found"),
                ],
                id="phonon-section",
            ),
            # Electronic DOS
            html.Div(
                [
                    html.H4("Electronic Density of States"),
                    html.Div(
                        [
                            html.Label(
                                "Select DOS: ",
                                style={"fontWeight": "500", "marginRight": "8px"},
                            ),
                            dcc.Dropdown(
                                id="dos-selector",
                                options=[
                                    {"label": s, "value": s} for s in AVAILABLE_DOS
                                ],
                                value=AVAILABLE_DOS[0],
                                clearable=False,
                                style={"width": "300px", "display": "inline-block"},
                            ),
                        ],
                        style={
                            "display": "flex",
                            "alignItems": "center",
                            "marginBottom": "12px",
                        },
                    ),
                    mvc.MatterViz(
                        id="electronic-dos",
                        component="spectral/Dos",
                        mv_props={
                            "dos": initial_dos,
                            "height": 350,
                        },
                        style={
                            "minHeight": "370px",
                            "border": "1px solid var(--border-color, #ddd)",
                        },
                    )
                    if initial_dos
                    else html.P("DOS data not found"),
                ],
                id="dos-section",
            ),
            # Electronic Band Structure
            html.Div(
                [
                    html.H4("Electronic Band Structure"),
                    html.Div(
                        [
                            html.Label(
                                "Select bands: ",
                                style={"fontWeight": "500", "marginRight": "8px"},
                            ),
                            dcc.Dropdown(
                                id="bands-selector",
                                options=[
                                    {"label": s, "value": s} for s in AVAILABLE_BANDS
                                ],
                                value=AVAILABLE_BANDS[0],
                                clearable=False,
                                style={"width": "250px", "display": "inline-block"},
                            ),
                        ],
                        style={
                            "display": "flex",
                            "alignItems": "center",
                            "marginBottom": "12px",
                        },
                    ),
                    mvc.MatterViz(
                        id="electronic-bands",
                        component="spectral/Bands",
                        mv_props={
                            "bands": initial_bands,
                            "height": 400,
                        },
                        style={
                            "minHeight": "420px",
                            "border": "1px solid var(--border-color, #ddd)",
                        },
                    )
                    if initial_bands
                    else html.P("Band structure data not found"),
                ],
                id="bands-section",
            ),
            # XRD Plot
            html.Div(
                [
                    html.H4("XRD Plot (Quartz)"),
                    mvc.MatterViz(
                        id="xrd",
                        component="xrd/XrdPlot",
                        mv_props={
                            "patterns": initial_xrd
                            or {"x": [20, 30, 40], "y": [100, 50, 25]},
                            "peak_width": 0.5,
                            "annotate_peaks": 5,
                            "height": 320,
                        },
                        style={
                            "minHeight": "340px",
                            "border": "1px solid var(--border-color, #ddd)",
                        },
                    ),
                ],
                id="xrd-section",
            ),
            # Callback Demo (bidirectional)
            html.Div(
                [
                    html.H4("Callback Demo (Click Detection)"),
                    html.P(
                        "Click on elements in the periodic table to see callbacks in action.",
                        style={
                            "marginBottom": "12px",
                            "color": "var(--text-muted, #666)",
                        },
                    ),
                    html.Div(
                        [
                            mvc.MatterViz(
                                id="callback-periodic-table",
                                component="periodic-table/PeriodicTable",
                                mv_props={
                                    "height": 400,
                                    "show_color_bar": False,
                                },
                                event_props=["on_element_click"],
                                style={
                                    "border": "1px solid var(--border-color, #ddd)",
                                    "flex": "1",
                                },
                            ),
                            html.Div(
                                [
                                    html.H5(
                                        "Last Clicked Element", style={"marginTop": "0"}
                                    ),
                                    html.Pre(
                                        id="callback-output",
                                        children="Click an element...",
                                        style={
                                            "padding": "12px",
                                            "borderRadius": "6px",
                                            "background": "var(--surface-bg, #f5f5f5)",
                                            "border": "1px solid var(--border-color, #ddd)",
                                            "overflow": "auto",
                                            "maxHeight": "300px",
                                            "fontSize": "13px",
                                        },
                                    ),
                                ],
                                style={"width": "300px", "flexShrink": "0"},
                            ),
                        ],
                        style={
                            "display": "flex",
                            "gap": "16px",
                            "alignItems": "flex-start",
                        },
                    ),
                ],
                id="callback-section",
            ),
        ],
    )


def create_app() -> dash.Dash:
    """Create and configure the Dash application."""
    app = dash.Dash(__name__, suppress_callback_exceptions=True)
    app.layout = layout
    # Theme styles with CSS variables
    app.index_string = """<!DOCTYPE html>
<html>
    <head>
        {%metas%}
        <title>{%title%}</title>
        {%favicon%}
        {%css%}
        <style>
            :root {
                --bg-color: #fff;
                --text-color: #222;
                --text-muted: #666;
                --border-color: #ddd;
                --surface-bg: #f8f9fa;
                --nav-bg: #f5f5f5;
                --nav-link: #1a56db;
            }
            [data-theme="dark"] {
                --bg-color: #1a1a2e;
                --text-color: #e8e8e8;
                --text-muted: #a0a0a0;
                --border-color: #444;
                --surface-bg: #252540;
                --nav-bg: #2d2d44;
                --nav-link: #6ea8fe;
            }
            html, body {
                background: var(--bg-color);
                color: var(--text-color);
                margin: 0;
                overflow-x: hidden;
                transition: background 0.3s, color 0.3s;
            }
            #main-container {
                background: var(--bg-color);
                color: var(--text-color);
            }
            .nav-link {
                background: var(--nav-bg) !important;
                color: var(--nav-link) !important;
            }
            mv-matterviz {
                display: block;
                max-width: 100%;
                overflow-x: auto;
                box-sizing: border-box;
            }
            /* Dropdown styling for dark mode */
            [data-theme="dark"] .Select-control,
            [data-theme="dark"] .Select-menu-outer {
                background: var(--surface-bg);
                border-color: var(--border-color);
                color: var(--text-color);
            }
        </style>
    </head>
    <body>
        {%app_entry%}
        <footer>
            {%config%}
            {%scripts%}
            {%renderer%}
        </footer>
    </body>
</html>"""

    # Theme toggle callback
    app.clientside_callback(
        """
        function(n_clicks) {
            const html = document.documentElement;
            const current = html.getAttribute('data-theme') || 'light';
            const next = current === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            return next === 'dark' ? '☀️ Light' : '🌙 Dark';
        }
        """,
        Output("theme-toggle", "children"),
        Input("theme-toggle", "n_clicks"),
        prevent_initial_call=True,
    )

    # Phase diagram callback
    @app.callback(
        Output("phase-binary", "mv_props"),
        Input("phase-diagram-selector", "value"),
    )
    def update_phase_diagram(selected_system: str) -> dict:
        """Update phase diagram when dropdown selection changes."""
        data = get_cached(selected_system, load_phase_diagram)
        if not data:
            data = get_cached(AVAILABLE_PHASE_DIAGRAMS[0], load_phase_diagram) or {}
        return {"data": data, "height": 500}

    # Structure callback
    @app.callback(
        Output("structure", "mv_props"),
        Input("structure-selector", "value"),
    )
    def update_structure(selected_structure: str) -> dict:
        """Update structure when dropdown selection changes."""
        data = get_cached(selected_structure, load_structure)
        if not data:
            data = (
                get_cached(AVAILABLE_STRUCTURES[0], load_structure) or SILICON_STRUCTURE
            )
        return {"structure": data, "show_controls": True, "height": 400}

    # Convex hull callback
    @app.callback(
        Output("convex-4d", "mv_props"),
        Input("convex-hull-selector", "value"),
    )
    def update_convex_hull(selected_system: str) -> dict:
        """Update convex hull when dropdown selection changes."""
        entries = get_cached(selected_system, load_convex_hull_entries)
        if not entries:
            entries = (
                get_cached(AVAILABLE_CONVEX_HULLS[0], load_convex_hull_entries) or []
            )
        return {"entries": entries, "height": 450}

    # Phonon bands callback
    @app.callback(
        Output("phonon-bands", "mv_props"),
        Input("phonon-selector", "value"),
    )
    def update_phonon_bands(selected: str) -> dict:
        """Update phonon bands when dropdown selection changes."""
        return {"bands": get_cached(selected, load_phonon_bands), "height": 400}

    # DOS callback
    @app.callback(
        Output("electronic-dos", "mv_props"),
        Input("dos-selector", "value"),
    )
    def update_dos(selected: str) -> dict:
        """Update DOS when dropdown selection changes."""
        return {"dos": get_cached(selected, load_electronic_dos), "height": 350}

    # Electronic bands callback
    @app.callback(
        Output("electronic-bands", "mv_props"),
        Input("bands-selector", "value"),
    )
    def update_bands(selected: str) -> dict:
        """Update electronic bands when dropdown selection changes."""
        return {"bands": get_cached(selected, load_electronic_bands), "height": 400}

    # Callback demo - display clicked element
    @app.callback(
        Output("callback-output", "children"),
        Input("callback-periodic-table", "last_event"),
    )
    def display_clicked_element(last_event: dict | None) -> str:
        """Display the last clicked element from the periodic table."""
        if not last_event:
            return "Click an element..."
        return json.dumps(last_event, indent=2)

    return app


if __name__ == "__main__":
    debug_mode = os.environ.get("DASH_DEBUG", "1").lower() in ("1", "true", "yes")
    port = int(os.environ.get("DASH_PORT", "8050"))
    create_app().run(debug=debug_mode, port=port)
