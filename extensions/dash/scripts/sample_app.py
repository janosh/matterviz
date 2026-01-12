"""Minimal Dash app to exercise matterviz-dash-components."""

from __future__ import annotations

import gzip
import json
import os
from pathlib import Path
from typing import Any, Callable

import dash
import matterviz_dash_components as mvc
from dash import Input, Output, dcc, html

# Path to the matterviz root directory (scripts/ -> dash/ -> extensions/ -> root)
# Override with MATTERVIZ_ROOT env var if script is run from a different location
_env_root = os.environ.get("MATTERVIZ_ROOT")
MATTERVIZ_ROOT = (
    Path(_env_root) if _env_root else Path(__file__).parent.parent.parent.parent
)


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
        for raw_line in fh:
            line = raw_line.strip()
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


def _discover_files(directory: Path, pattern: str = "*.json*") -> list[str]:
    """Discover available demo files by scanning a directory."""
    if not directory.exists():
        return []
    seen: set[str] = set()
    names = []
    for path in sorted(directory.glob(pattern)):
        # Strip compound extensions like .json.gz or .xy.gz
        name = path.stem
        for ext in (".json", ".xy"):
            if name.endswith(ext):
                name = name[: -len(ext)]
                break
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


# Dynamically discover available demo files from the site directory
_SITE_DIR = MATTERVIZ_ROOT / "src" / "site"

# Fallback defaults for each data category (used when discovery finds nothing)
_FALLBACK_STRUCTURE = "mp-1234"
_FALLBACK_PHASE_DIAGRAM = "Al-Cu"
_FALLBACK_PHONON = "mp-2667-Cs1Au1-pbe"
_FALLBACK_DOS = "dos-spin-polarization-mp-865805"
_FALLBACK_BANDS = "cao-2605-bands"
_FALLBACK_XRD = "synthetic-quartz-xrd"

# Exclude "A-B" (generic test file) and use real phase diagrams
_all_phase_diagrams = _discover_files(_SITE_DIR / "phase-diagrams" / "binary")
AVAILABLE_PHASE_DIAGRAMS = [p for p in _all_phase_diagrams if p != "A-B"] or [
    _FALLBACK_PHASE_DIAGRAM
]
AVAILABLE_STRUCTURES = _discover_files(_SITE_DIR / "structures") or [_FALLBACK_STRUCTURE]
AVAILABLE_PHONONS = _discover_files(_SITE_DIR / "phonons") or [_FALLBACK_PHONON]
AVAILABLE_DOS = _discover_files(_SITE_DIR / "electronic" / "dos") or [_FALLBACK_DOS]
AVAILABLE_BANDS = _discover_files(_SITE_DIR / "electronic" / "bands") or [_FALLBACK_BANDS]
AVAILABLE_XRD = _discover_files(MATTERVIZ_ROOT / "static" / "xrd", "*.xy*") or [
    _FALLBACK_XRD
]


def _safe_first(lst: list[str], fallback: str) -> str:
    """Safely get the first element of a list, returning fallback if empty."""
    return lst[0] if lst else fallback

# Caches for loaded data (not thread-safe; fine for demo app)
_cache: dict[str, Any] = {}


def get_cached(key: str, loader: Callable[[str], Any]) -> Any:
    """Load data via loader(key), caching the result."""
    if key not in _cache:
        data = loader(key)
        if data is not None:
            _cache[key] = data
    return _cache.get(key)


# Note: WASM MIME type is set in matterviz_dash_components/__init__.py

# Simple demo structure for Trajectory and BrillouinZone demos
# (real pymatgen JSON has complex format that requires conversion)
_DEMO_STRUCTURE: dict = {
    "lattice": {
        "matrix": [[5.43, 0, 0], [0, 5.43, 0], [0, 0, 5.43]],
        "pbc": [True, True, True],
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
            "species": [{"element": "Si", "occu": 1}],
            "label": "Si",
        },
        {
            "abc": [0.25, 0.25, 0.25],
            "xyz": [1.3575, 1.3575, 1.3575],
            "species": [{"element": "Si", "occu": 1}],
            "label": "Si",
        },
    ],
}

# Simple 2-frame trajectory for demo
_DEMO_TRAJECTORY_FRAMES: list[dict] = [
    {"structure": _DEMO_STRUCTURE, "step": 0},
    {
        "structure": {
            **_DEMO_STRUCTURE,
            "sites": [
                {
                    **_DEMO_STRUCTURE["sites"][0],
                    "abc": [0.02, 0, 0],
                    "xyz": [0.11, 0, 0],
                },
                {
                    **_DEMO_STRUCTURE["sites"][1],
                    "abc": [0.27, 0.25, 0.25],
                    "xyz": [1.47, 1.36, 1.36],
                },
            ],
        },
        "step": 1,
    },
]

# Simple convex hull entries for 2D binary demo (Li-Co system)
_DEMO_HULL_ENTRIES: list[dict] = [
    # Pure elements (endpoints)
    {"composition": {"Li": 1}, "energy": -1.9, "entry_id": "Li", "e_above_hull": 0},
    {"composition": {"Co": 1}, "energy": -7.1, "entry_id": "Co", "e_above_hull": 0},
    # Binary compounds (on the tie-line)
    {
        "composition": {"Li": 1, "Co": 1},
        "energy": -4.6,
        "entry_id": "LiCo",
        "e_above_hull": 0,
    },
    {
        "composition": {"Li": 2, "Co": 1},
        "energy": -3.9,
        "entry_id": "Li2Co",
        "e_above_hull": 0.02,
    },
    {
        "composition": {"Li": 1, "Co": 2},
        "energy": -5.3,
        "entry_id": "LiCo2",
        "e_above_hull": 0.01,
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

    # Initial data loading (use first discovered file for each category)
    # Use _safe_first to guard against empty discovery lists
    initial_structure_key = _safe_first(AVAILABLE_STRUCTURES, _FALLBACK_STRUCTURE)
    initial_phase_key = _safe_first(AVAILABLE_PHASE_DIAGRAMS, _FALLBACK_PHASE_DIAGRAM)
    initial_phonon_key = _safe_first(AVAILABLE_PHONONS, _FALLBACK_PHONON)
    initial_dos_key = _safe_first(AVAILABLE_DOS, _FALLBACK_DOS)
    initial_bands_key = _safe_first(AVAILABLE_BANDS, _FALLBACK_BANDS)
    initial_xrd_key = _safe_first(AVAILABLE_XRD, _FALLBACK_XRD)

    initial_structure = get_cached(initial_structure_key, load_structure)
    initial_phase = get_cached(initial_phase_key, load_phase_diagram) or {}
    initial_phonon = get_cached(initial_phonon_key, load_phonon_bands)
    initial_dos = get_cached(initial_dos_key, load_electronic_dos)
    initial_bands = get_cached(initial_bands_key, load_electronic_bands)
    initial_xrd = get_cached(initial_xrd_key, load_xrd_pattern)

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
                            "border": "1px solid var(--mv-border, #ddd)",
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
                                value=initial_structure_key,
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
                            "border": "1px solid var(--mv-border, #ddd)",
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
                                    "border": "1px solid var(--mv-border, #ddd)",
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
                                    "border": "1px solid var(--mv-border, #ddd)",
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
                                    "border": "1px solid var(--mv-border, #ddd)",
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
                                    "border": "1px solid var(--mv-border, #ddd)",
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
            # Trajectory (using simple 2-frame demo)
            html.Div(
                [
                    html.H4("Trajectory (2-frame demo)"),
                    mvc.MatterViz(
                        id="trajectory",
                        component="trajectory/Trajectory",
                        mv_props={
                            "trajectory": {"frames": _DEMO_TRAJECTORY_FRAMES},
                            "show_controls": True,
                            "fps": 1,
                            "height": 360,
                        },
                        style={
                            "minHeight": "380px",
                            "border": "1px solid var(--mv-border, #ddd)",
                        },
                    ),
                ],
                id="trajectory-section",
            ),
            # Brillouin Zone (using simple cubic demo structure)
            html.Div(
                [
                    html.H4("Brillouin Zone (Simple Cubic)"),
                    mvc.MatterViz(
                        id="brillouin",
                        component="brillouin/BrillouinZone",
                        mv_props={
                            "structure": _DEMO_STRUCTURE,
                            "height": 360,
                        },
                        style={
                            "minHeight": "380px",
                            "border": "1px solid var(--mv-border, #ddd)",
                        },
                    ),
                ],
                id="brillouin-section",
            ),
            # Convex Hull
            html.Div(
                [
                    html.H4("Convex Hull (Li-Co demo)"),
                    mvc.MatterViz(
                        id="convex-2d",
                        component="convex-hull/ConvexHull2D",
                        mv_props={
                            "entries": _DEMO_HULL_ENTRIES,
                            "height": 400,
                        },
                        style={
                            "minHeight": "470px",
                            "border": "1px solid var(--mv-border, #ddd)",
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
                                value=initial_phase_key,
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
                            "border": "1px solid var(--mv-border, #ddd)",
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
                                value=initial_phonon_key,
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
                            "band_structs": initial_phonon,
                            "height": 400,
                        },
                        style={
                            "minHeight": "420px",
                            "border": "1px solid var(--mv-border, #ddd)",
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
                                value=initial_dos_key,
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
                            "doses": initial_dos,
                            "height": 350,
                        },
                        style={
                            "minHeight": "370px",
                            "border": "1px solid var(--mv-border, #ddd)",
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
                                value=initial_bands_key,
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
                            "band_structs": initial_bands,
                            "height": 400,
                        },
                        style={
                            "minHeight": "420px",
                            "border": "1px solid var(--mv-border, #ddd)",
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
                            "border": "1px solid var(--mv-border, #ddd)",
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
                        "Click on elements or hull points to see callbacks in action.",
                        style={
                            "marginBottom": "12px",
                            "color": "var(--mv-text-muted, #666)",
                        },
                    ),
                    # Output panel (at top for visibility)
                    html.Div(
                        [
                            html.H5("Last Clicked", style={"marginTop": "0"}),
                            html.Pre(
                                id="callback-output",
                                children="Click an element or hull point...",
                                style={
                                    "padding": "12px",
                                    "borderRadius": "6px",
                                    "background": "var(--mv-surface, #f5f5f5)",
                                    "border": "1px solid var(--mv-border, #ddd)",
                                    "overflow": "auto",
                                    "maxHeight": "150px",
                                    "fontSize": "13px",
                                    "margin": "0 0 16px 0",
                                },
                            ),
                        ],
                    ),
                    # Periodic Table (clickable via tile_props.onclick)
                    html.Div(
                        [
                            html.H5(
                                "Periodic Table (click elements)",
                                style={"marginTop": "0"},
                            ),
                            mvc.MatterViz(
                                id="callback-periodic-table",
                                component="periodic-table/PeriodicTable",
                                mv_props={"show_color_bar": False},
                                # Use dot notation for nested event props
                                event_props=["tile_props.onclick"],
                                style={
                                    "border": "1px solid var(--mv-border, #ddd)",
                                },
                            ),
                        ],
                        style={"marginBottom": "16px"},
                    ),
                    # Convex Hull (clickable with callback)
                    html.Div(
                        [
                            html.H5(
                                "Convex Hull (click points)", style={"marginTop": "0"}
                            ),
                            mvc.MatterViz(
                                id="callback-convex-hull",
                                component="convex-hull/ConvexHull2D",
                                mv_props={
                                    "entries": _DEMO_HULL_ENTRIES,
                                    "height": 280,
                                },
                                event_props=["on_point_click"],
                                style={
                                    "border": "1px solid var(--mv-border, #ddd)",
                                    "maxWidth": "500px",
                                },
                            ),
                        ],
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
    # Theme styles with CSS variables (mv- prefixed to avoid collisions)
    app.index_string = """<!DOCTYPE html>
<html>
    <head>
        {%metas%}
        <title>{%title%}</title>
        {%favicon%}
        {%css%}
        <style>
            :root {
                --mv-bg: #fff;
                --mv-text: #222;
                --mv-text-muted: #666;
                --mv-border: #ddd;
                --mv-surface: #f8f9fa;
                --mv-nav-bg: #f5f5f5;
                --mv-nav-link: #1a56db;
                /* Plot components use these variables */
                --text-color: #222;
                --border-color: #ccc;
            }
            [data-theme="dark"] {
                --mv-bg: #1a1a2e;
                --mv-text: #e8e8e8;
                --mv-text-muted: #a0a0a0;
                --mv-border: #444;
                --mv-surface: #252540;
                --mv-nav-bg: #2d2d44;
                --mv-nav-link: #6ea8fe;
                /* Plot components use these variables */
                --text-color: #e8e8e8;
                --border-color: #555;
            }
            html, body {
                background: var(--mv-bg);
                color: var(--mv-text);
                margin: 0;
                overflow-x: hidden;
                transition: background 0.3s, color 0.3s;
            }
            #main-container {
                background: var(--mv-bg);
                color: var(--mv-text);
            }
            .nav-link {
                background: var(--mv-nav-bg) !important;
                color: var(--mv-nav-link) !important;
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
                background: var(--mv-surface);
                border-color: var(--mv-border);
                color: var(--mv-text);
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
            fallback_key = _safe_first(AVAILABLE_PHASE_DIAGRAMS, _FALLBACK_PHASE_DIAGRAM)
            data = get_cached(fallback_key, load_phase_diagram) or {}
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
            fallback_key = _safe_first(AVAILABLE_STRUCTURES, _FALLBACK_STRUCTURE)
            data = get_cached(fallback_key, load_structure)
        return {"structure": data, "show_controls": True, "height": 400}

    # Phonon bands callback
    @app.callback(
        Output("phonon-bands", "mv_props"),
        Input("phonon-selector", "value"),
    )
    def update_phonon_bands(selected: str) -> dict:
        """Update phonon bands when dropdown selection changes."""
        return {"band_structs": get_cached(selected, load_phonon_bands), "height": 400}

    # DOS callback
    @app.callback(
        Output("electronic-dos", "mv_props"),
        Input("dos-selector", "value"),
    )
    def update_dos(selected: str) -> dict:
        """Update DOS when dropdown selection changes."""
        return {"doses": get_cached(selected, load_electronic_dos), "height": 350}

    # Electronic bands callback
    @app.callback(
        Output("electronic-bands", "mv_props"),
        Input("bands-selector", "value"),
    )
    def update_bands(selected: str) -> dict:
        """Update electronic bands when dropdown selection changes."""
        return {
            "band_structs": get_cached(selected, load_electronic_bands),
            "height": 400,
        }

    # Callback demo - display clicked phase entry
    @app.callback(
        Output("callback-output", "children"),
        Input("callback-periodic-table", "last_event"),
        Input("callback-convex-hull", "last_event"),
    )
    def display_clicked_entry(
        ptable_event: dict | None, hull_event: dict | None
    ) -> str:
        """Display the last clicked entry from periodic table or convex hull."""
        # Find most recent event by timestamp
        events = [
            (ptable_event, "Periodic Table"),
            (hull_event, "Convex Hull"),
        ]
        latest = None
        latest_source = None
        for event, source in events:
            if event and event.get("timestamp"):
                if not latest or event["timestamp"] > latest.get("timestamp", 0):
                    latest = event
                    latest_source = source
        if not latest:
            return "Click an element or hull point..."
        return f"Source: {latest_source}\n{json.dumps(latest, indent=2)}"

    return app


if __name__ == "__main__":
    debug_mode = os.environ.get("DASH_DEBUG", "1").lower() in ("1", "true", "yes")
    port = int(os.environ.get("DASH_PORT", "8050"))
    create_app().run(debug=debug_mode, port=port)
