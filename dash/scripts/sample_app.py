"""Minimal Dash app to exercise matterviz-dash-components."""

from __future__ import annotations

import gzip
import json
import math
import os
from pathlib import Path
from typing import Any

import matterviz_dash_components as mvc

import dash
from dash import Input, Output, dcc, html

# Path to the matterviz root directory (relative to this script)
MATTERVIZ_ROOT = Path(__file__).parent.parent.parent


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


def load_phase_diagram(system: str) -> dict | None:
    """Load a binary phase diagram from the gzipped JSON files."""
    pd_dir = MATTERVIZ_ROOT / "src" / "site" / "phase-diagrams" / "binary"
    return load_json_file(pd_dir / f"{system}.json.gz")


def load_structure(name: str) -> dict | None:
    """Load a structure file from the site/structures directory."""
    struct_dir = MATTERVIZ_ROOT / "src" / "site" / "structures"
    # Try .json first, then .json.gz
    for ext in [".json", ".json.gz"]:
        file_path = struct_dir / f"{name}{ext}"
        if file_path.exists():
            return load_json_file(file_path)
    return None


def load_convex_hull_entries(system: str) -> list[dict] | None:
    """Load convex hull entries from the site/convex-hull directory."""
    hull_dir = MATTERVIZ_ROOT / "src" / "site" / "convex-hull" / "quaternaries"
    file_path = hull_dir / f"{system}.json.gz"
    return load_json_file(file_path)


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

# Caches for loaded data
_phase_diagram_cache: dict[str, dict] = {}
_structure_cache: dict[str, dict] = {}
_convex_hull_cache: dict[str, list] = {}

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


def get_phase_diagram(system: str) -> dict | None:
    """Get a phase diagram, using cache if available."""
    if system not in _phase_diagram_cache:
        data = load_phase_diagram(system)
        if data:
            _phase_diagram_cache[system] = data
    return _phase_diagram_cache.get(system)


def get_structure(name: str) -> dict | None:
    """Get a structure, using cache if available."""
    if name not in _structure_cache:
        data = load_structure(name)
        if data:
            _structure_cache[name] = data
    return _structure_cache.get(name)


def get_convex_hull_entries(system: str) -> list | None:
    """Get convex hull entries, using cache if available."""
    if system not in _convex_hull_cache:
        data = load_convex_hull_entries(system)
        if data:
            _convex_hull_cache[system] = data
    return _convex_hull_cache.get(system)


# XRD pattern data - x is 2θ angles, y is intensities
XRD_PATTERN = {
    "x": [20.5, 24.2, 28.8, 32.1, 36.5, 42.3, 48.7, 54.2, 60.1, 65.8, 72.4],
    "y": [15, 35, 100, 45, 20, 55, 30, 25, 40, 18, 12],
}


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
        ("xrd-section", "XRD Plot"),
    ]

    return html.Div(
        style={
            "display": "grid",
            "gap": "16px",
            "padding": "12px",
            "background": "#fff",
            "color": "#222",
            "minHeight": "100vh",
            "maxWidth": "100%",
            "overflowX": "hidden",
            "boxSizing": "border-box",
            # CSS variables for MatterViz components (light theme)
            "--text-color": "#333",
            "--border-color": "#ccc",
            "--surface-bg": "#f8f9fa",
        },
        children=[
            html.H1(
                "MatterViz Dash demo",
                style={
                    "textAlign": "center",
                    "fontSize": "2.5rem",
                    "margin": "0 0 16px",
                },
            ),
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
                                    "background": "#f5f5f5",
                                    "color": "#1a56db",
                                    "textDecoration": "none",
                                    "borderRadius": "4px",
                                    "fontSize": "13px",
                                },
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
                        style={"minHeight": "340px", "border": "1px solid #ddd"},
                    ),
                ],
                id="periodic-table-section",
            ),
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
                            "structure": get_structure("mp-1234") or SILICON_STRUCTURE,
                            "show_controls": True,
                            "height": 400,
                        },
                        style={"minHeight": "420px", "border": "1px solid #ddd"},
                    ),
                ],
                id="structure-section",
            ),
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
                                style={"border": "1px solid #ddd", "padding": "8px"},
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
                                style={"border": "1px solid #ddd", "padding": "8px"},
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
                                style={"border": "1px solid #ddd", "padding": "8px"},
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
                                style={"border": "1px solid #ddd", "padding": "8px"},
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
                        style={"minHeight": "380px", "border": "1px solid #ddd"},
                    ),
                ],
                id="trajectory-section",
            ),
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
                        style={"minHeight": "380px", "border": "1px solid #ddd"},
                    ),
                ],
                id="brillouin-section",
            ),
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
                            "entries": get_convex_hull_entries("Li-Co-Ni-O") or [],
                            "height": 450,
                        },
                        style={"minHeight": "470px", "border": "1px solid #ddd"},
                    ),
                ],
                id="convex-3d-section",
            ),
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
                            "data": get_phase_diagram("Al-Cu") or {},
                            "height": 500,
                        },
                        style={"minHeight": "520px", "border": "1px solid #ddd"},
                    ),
                ],
                id="phase-binary-section",
            ),
            html.Div(
                [
                    html.H4("XRD Plot"),
                    mvc.MatterViz(
                        id="xrd",
                        component="xrd/XrdPlot",
                        mv_props={
                            "patterns": XRD_PATTERN,
                            "peak_width": 1.5,
                            "annotate_peaks": 5,
                            "height": 320,
                        },
                        style={
                            "minHeight": "340px",
                            "border": "1px solid #ddd",
                            "--text-color": "#333",
                            "--border-color": "#ccc",
                        },
                    ),
                ],
                id="xrd-section",
            ),
        ],
    )


def create_app() -> dash.Dash:
    """Create and configure the Dash application."""
    app = dash.Dash(__name__, suppress_callback_exceptions=True)
    app.layout = layout
    # Override MatterViz's dark theme on html/body
    app.index_string = """<!DOCTYPE html>
<html style="background: #fff; overflow-x: hidden;">
    <head>
        {%metas%}
        <title>{%title%}</title>
        {%favicon%}
        {%css%}
        <style>
            /* Allow horizontal scroll within component containers if needed */
            mv-matterviz {
                display: block;
                max-width: 100%;
                overflow-x: auto;
                box-sizing: border-box;
            }
        </style>
    </head>
    <body style="background: #fff; margin: 0; overflow-x: hidden;">
        {%app_entry%}
        <footer>
            {%config%}
            {%scripts%}
            {%renderer%}
        </footer>
    </body>
</html>"""

    @app.callback(
        Output("phase-binary", "mv_props"),
        Input("phase-diagram-selector", "value"),
    )
    def update_phase_diagram(selected_system: str) -> dict:
        """Update phase diagram when dropdown selection changes."""
        data = get_phase_diagram(selected_system)
        if not data:
            # Fallback to first available if loading fails
            data = get_phase_diagram(AVAILABLE_PHASE_DIAGRAMS[0]) or {}
        return {"data": data, "height": 500}

    @app.callback(
        Output("structure", "mv_props"),
        Input("structure-selector", "value"),
    )
    def update_structure(selected_structure: str) -> dict:
        """Update structure when dropdown selection changes."""
        data = get_structure(selected_structure)
        if not data:
            data = get_structure(AVAILABLE_STRUCTURES[0]) or SILICON_STRUCTURE
        return {"structure": data, "show_controls": True, "height": 400}

    @app.callback(
        Output("convex-4d", "mv_props"),
        Input("convex-hull-selector", "value"),
    )
    def update_convex_hull(selected_system: str) -> dict:
        """Update convex hull when dropdown selection changes."""
        entries = get_convex_hull_entries(selected_system)
        if not entries:
            entries = get_convex_hull_entries(AVAILABLE_CONVEX_HULLS[0]) or []
        return {"entries": entries, "height": 450}

    return app


if __name__ == "__main__":
    debug_mode = os.environ.get("DASH_DEBUG", "1").lower() in ("1", "true", "yes")
    port = int(os.environ.get("DASH_PORT", "8050"))
    create_app().run(debug=debug_mode, port=port)
