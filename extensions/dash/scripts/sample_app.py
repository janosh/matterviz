"""Minimal Dash app to exercise matterviz-dash-components."""

from __future__ import annotations

import gzip
import json
import os
from pathlib import Path
from typing import Any, Callable

import dash
from dash import Input, Output, dcc, html

import matterviz_dash_components as mvc

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

# Empty phase diagram structure for when loading fails
_EMPTY_PHASE = {
    "components": ["", ""],
    "temperature_range": [0, 1000],
    "regions": [],
    "boundaries": [],
}
_FALLBACK_PHONON = "mp-2667-Cs1Au1-pbe"
_FALLBACK_DOS = "dos-spin-polarization-mp-865805"
_FALLBACK_BANDS = "cao-2605-bands"
_FALLBACK_XRD = "synthetic-quartz-xrd"

# Exclude "A-B" (generic test file) and use real phase diagrams
_all_phase_diagrams = _discover_files(_SITE_DIR / "phase-diagrams" / "binary")
AVAILABLE_PHASE_DIAGRAMS = [p for p in _all_phase_diagrams if p != "A-B"] or [
    _FALLBACK_PHASE_DIAGRAM
]
AVAILABLE_STRUCTURES = _discover_files(_SITE_DIR / "structures") or [
    _FALLBACK_STRUCTURE
]
AVAILABLE_PHONONS = _discover_files(_SITE_DIR / "phonons") or [_FALLBACK_PHONON]
AVAILABLE_DOS = _discover_files(_SITE_DIR / "electronic" / "dos") or [_FALLBACK_DOS]
AVAILABLE_BANDS = _discover_files(_SITE_DIR / "electronic" / "bands") or [
    _FALLBACK_BANDS
]
AVAILABLE_XRD = _discover_files(MATTERVIZ_ROOT / "static" / "xrd", "*.xy*") or [
    _FALLBACK_XRD
]


def _safe_first(lst: list[str], fallback: str) -> str:
    """Safely get the first element of a list, returning fallback if empty."""
    return lst[0] if lst else fallback


# Caches for loaded data (not thread-safe; fine for demo app)
_cache: dict[str, Any] = {}
_CACHE_MISS = object()  # Sentinel to cache None results


def get_cached(key: str, loader: Callable[[str], Any]) -> Any:
    """Load data via loader(key), caching the result (including None)."""
    if key not in _cache:
        data = loader(key)
        _cache[key] = data if data is not None else _CACHE_MISS
    cached = _cache.get(key)
    return None if cached is _CACHE_MISS else cached


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
        ("structure-section", "Structure"),
        ("trajectory-section", "Trajectory"),
        ("brillouin-section", "Brillouin Zone"),
        ("convex-2d-section", "Convex Hull"),
        ("phase-binary-section", "Phase Diagram"),
        ("phonon-section", "Phonon Bands"),
        ("dos-section", "Electronic DOS"),
        ("bands-section", "Electronic Bands"),
        ("xrd-section", "XRD Plot"),
        ("composition-section", "Composition"),
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
    initial_phase = get_cached(initial_phase_key, load_phase_diagram) or _EMPTY_PHASE
    initial_phonon = get_cached(initial_phonon_key, load_phonon_bands)
    initial_dos = get_cached(initial_dos_key, load_electronic_dos)
    initial_bands = get_cached(initial_bands_key, load_electronic_bands)
    initial_xrd = get_cached(initial_xrd_key, load_xrd_pattern)

    # Second structure: pick first one that differs from the primary
    initial_structure_key_2 = _safe_first(
        [s for s in AVAILABLE_STRUCTURES if s != initial_structure_key],
        initial_structure_key,
    )
    initial_structure_2 = get_cached(initial_structure_key_2, load_structure)

    _border = "1px solid var(--mv-border, #ddd)"
    _two_col = {
        "display": "grid",
        "gridTemplateColumns": "repeat(auto-fit, minmax(min(600px, 100%), 1fr))",
        "gap": "16px",
    }

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
                        "justifyContent": "center",
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
            # Structure (2-up)
            html.H4("Structure", id="structure-section"),
            html.Div(
                [
                    html.Div(
                        [
                            dcc.Dropdown(
                                id=sel_id,
                                clearable=False,
                                options=[
                                    {"label": s, "value": s}
                                    for s in AVAILABLE_STRUCTURES
                                ],
                                value=val,
                                style={"width": "200px", "marginBottom": "8px"},
                            ),
                            mvc.MatterViz(
                                id=mv_id,
                                component="structure/Structure",
                                mv_props={
                                    "structure": data,
                                    "show_controls": True,
                                },
                                style={"border": _border},
                            ),
                        ]
                    )
                    for sel_id, mv_id, val, data in [
                        (
                            "structure-selector",
                            "structure",
                            initial_structure_key,
                            initial_structure,
                        ),
                        (
                            "structure-selector-2",
                            "structure-2",
                            initial_structure_key_2,
                            initial_structure_2,
                        ),
                    ]
                ],
                style=_two_col,
            ),
            # Trajectory + Brillouin Zone (2-up)
            html.Div(
                [
                    html.Div(
                        [
                            html.H4("Trajectory"),
                            mvc.MatterViz(
                                id="trajectory",
                                component="trajectory/Trajectory",
                                mv_props={
                                    "trajectory": {"frames": _DEMO_TRAJECTORY_FRAMES},
                                    "show_controls": True,
                                    "fps": 1,
                                },
                                style={"border": _border},
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
                                    "structure": _DEMO_STRUCTURE,
                                },
                                style={"border": _border},
                            ),
                        ],
                        id="brillouin-section",
                    ),
                ],
                style=_two_col,
            ),
            # Convex Hull + Phase Diagram (2-up)
            html.Div(
                [
                    html.Div(
                        [
                            html.H4("Convex Hull"),
                            mvc.MatterViz(
                                id="convex-2d",
                                component="convex-hull/ConvexHull2D",
                                mv_props={
                                    "entries": _DEMO_HULL_ENTRIES,
                                },
                                style={"border": _border},
                            ),
                        ],
                        id="convex-2d-section",
                    ),
                    html.Div(
                        [
                            html.H4("Phase Diagram"),
                            dcc.Dropdown(
                                id="phase-diagram-selector",
                                options=[
                                    {"label": k, "value": k}
                                    for k in AVAILABLE_PHASE_DIAGRAMS
                                ],
                                value=initial_phase_key,
                                clearable=False,
                                style={"width": "200px", "marginBottom": "8px"},
                            ),
                            mvc.MatterViz(
                                id="phase-binary",
                                component="phase-diagram/IsobaricBinaryPhaseDiagram",
                                mv_props={
                                    "data": initial_phase,
                                },
                                style={"border": _border},
                            ),
                        ],
                        id="phase-binary-section",
                    ),
                ],
                style=_two_col,
            ),
            # Phonon Bands + Electronic DOS (2-up)
            html.Div(
                [
                    html.Div(
                        [
                            html.H4("Phonon Bands"),
                            dcc.Dropdown(
                                id="phonon-selector",
                                options=[
                                    {"label": s.replace("-pbe", ""), "value": s}
                                    for s in AVAILABLE_PHONONS
                                ],
                                value=initial_phonon_key,
                                clearable=False,
                                style={"width": "250px", "marginBottom": "8px"},
                            ),
                            mvc.MatterViz(
                                id="phonon-bands",
                                component="spectral/Bands",
                                mv_props={
                                    "band_structs": initial_phonon,
                                },
                                style={"border": _border},
                            )
                            if initial_phonon
                            else html.P("Phonon data not found"),
                        ],
                        id="phonon-section",
                    ),
                    html.Div(
                        [
                            html.H4("Electronic DOS"),
                            dcc.Dropdown(
                                id="dos-selector",
                                options=[
                                    {"label": s, "value": s} for s in AVAILABLE_DOS
                                ],
                                value=initial_dos_key,
                                clearable=False,
                                style={"width": "250px", "marginBottom": "8px"},
                            ),
                            mvc.MatterViz(
                                id="electronic-dos",
                                component="spectral/Dos",
                                mv_props={
                                    "doses": initial_dos,
                                },
                                style={"border": _border},
                            )
                            if initial_dos
                            else html.P("DOS data not found"),
                        ],
                        id="dos-section",
                    ),
                ],
                style=_two_col,
            ),
            # Electronic Bands + XRD (2-up)
            html.Div(
                [
                    html.Div(
                        [
                            html.H4("Electronic Bands"),
                            dcc.Dropdown(
                                id="bands-selector",
                                options=[
                                    {"label": s, "value": s} for s in AVAILABLE_BANDS
                                ],
                                value=initial_bands_key,
                                clearable=False,
                                style={"width": "250px", "marginBottom": "8px"},
                            ),
                            mvc.MatterViz(
                                id="electronic-bands",
                                component="spectral/Bands",
                                mv_props={
                                    "band_structs": initial_bands,
                                },
                                style={"border": _border},
                            )
                            if initial_bands
                            else html.P("Band structure data not found"),
                        ],
                        id="bands-section",
                    ),
                    html.Div(
                        [
                            html.H4("XRD Plot"),
                            dcc.Dropdown(
                                id="xrd-selector",
                                options=[
                                    {"label": s, "value": s} for s in AVAILABLE_XRD
                                ],
                                value=initial_xrd_key,
                                clearable=False,
                                style={"width": "250px", "marginBottom": "8px"},
                            ),
                            mvc.MatterViz(
                                id="xrd",
                                component="xrd/XrdPlot",
                                mv_props={
                                    "patterns": initial_xrd
                                    or {"x": [20, 30, 40], "y": [100, 50, 25]},
                                    "peak_width": 0.5,
                                    "annotate_peaks": 5,
                                },
                                style={"border": _border},
                            ),
                        ],
                        id="xrd-section",
                    ),
                ],
                style=_two_col,
            ),
            # Composition
            html.Div(
                [
                    html.H4("Composition"),
                    html.Div(
                        [
                            mvc.MatterViz(
                                id=f"comp-{idx}",
                                component=comp,
                                mv_props={
                                    "composition": formula,
                                    "size": 120,
                                    **({"mode": mode} if mode else {}),
                                    "color_scheme": scheme,
                                },
                                style={"border": _border, "padding": "4px"},
                            )
                            for idx, (comp, formula, mode, scheme) in enumerate(
                                [
                                    (
                                        "composition/Composition",
                                        "LiFePO4",
                                        "pie",
                                        "Vesta",
                                    ),
                                    (
                                        "composition/Composition",
                                        "BaTiO3",
                                        "bar",
                                        "Jmol",
                                    ),
                                    (
                                        "composition/BubbleChart",
                                        {"Sr": 2, "Fe": 1, "Mo": 1, "O": 6},
                                        None,
                                        "Vesta",
                                    ),  # noqa: E501
                                    (
                                        "composition/Composition",
                                        "CaTiO3",
                                        "pie",
                                        "Jmol",
                                    ),
                                    (
                                        "composition/Composition",
                                        {"Mg": 2, "Si": 1, "O": 4},
                                        "bar",
                                        "Vesta",
                                    ),
                                    (
                                        "composition/BubbleChart",
                                        {"La": 2, "Cu": 1, "O": 4},
                                        None,
                                        "Jmol",
                                    ),
                                    (
                                        "composition/BubbleChart",
                                        {"Y": 1, "Ba": 2, "Cu": 3, "O": 7},
                                        None,
                                        "Vesta",
                                    ),
                                    ("composition/Composition", "Fe2O3", "pie", "Jmol"),
                                    (
                                        "composition/Composition",
                                        "Na2SO4",
                                        "bar",
                                        "Vesta",
                                    ),
                                ]
                            )
                        ],
                        style={
                            "display": "grid",
                            "gridTemplateColumns": "repeat(auto-fill, minmax(140px, 1fr))",
                            "gap": "8px",
                        },
                    ),
                ],
                id="composition-section",
            ),
            # Callback Demo (bidirectional)
            html.Div(
                [
                    html.H4("Callback Demo (Click Detection)"),
                    html.Div(
                        [
                            # Periodic Table with callback output overlaid on inset area
                            html.Div(
                                [
                                    mvc.MatterViz(
                                        id="callback-periodic-table",
                                        component="periodic-table/PeriodicTable",
                                        mv_props={"show_color_bar": False},
                                        event_props=["tile_props.onclick"],
                                        style={"border": _border},
                                    ),
                                    html.Pre(
                                        id="callback-output",
                                        children="Click an element…",
                                        className="callback-output",
                                        style={
                                            "margin": "0",
                                            "padding": "6px 8px",
                                            "overflow": "auto",
                                            "fontSize": "10px",
                                            "lineHeight": "1.3",
                                            "boxSizing": "border-box",
                                        },
                                    ),
                                ],
                                style={"position": "relative"},
                            ),
                            # Convex Hull (clickable with callback)
                            html.Div(
                                [
                                    html.H5(
                                        "Convex Hull (click points)",
                                        style={"marginTop": "0"},
                                    ),
                                    mvc.MatterViz(
                                        id="callback-convex-hull",
                                        component="convex-hull/ConvexHull2D",
                                        mv_props={
                                            "entries": _DEMO_HULL_ENTRIES,
                                        },
                                        event_props=["on_point_click"],
                                        style={"border": _border},
                                    ),
                                ],
                            ),
                        ],
                        style=_two_col,
                    ),
                ],
                id="callback-section",
            ),
        ],
    )


def create_app() -> dash.Dash:
    """Create and configure the Dash application."""
    app = dash.Dash(
        __name__, suppress_callback_exceptions=True, title="MatterViz Dash Demo"
    )
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
                color-scheme: light;
                --mv-bg: #fff;
                --mv-text: #222;
                --mv-text-muted: #666;
                --mv-border: #ddd;
                --mv-surface: #f8f9fa;
                --mv-nav-bg: #d6dde6;
                --mv-nav-link: #1a56db;
                /* MatterViz component CSS variables (must match themes.js) */
                --text-color: #374151;
                --border-color: #d1d5db;
                --page-bg: #f1f3f5;
                --pane-bg: rgb(229, 231, 235);
                --pane-border: 1px solid rgba(0, 0, 0, 0.15);
                --struct-bg: rgba(0, 0, 0, 0.02);
                --accent-color: #4f46e5;
                --btn-bg: rgba(0, 0, 0, 0.12);
                --btn-bg-hover: rgba(0, 0, 0, 0.25);
            }
            [data-theme="dark"] {
                color-scheme: dark;
                --mv-bg: #1a1a2e;
                --mv-text: #e8e8e8;
                --mv-text-muted: #a0a0a0;
                --mv-border: #444;
                --mv-surface: #252540;
                --mv-nav-bg: #2d2d44;
                --mv-nav-link: #6ea8fe;
                /* MatterViz component CSS variables (must match themes.js) */
                --text-color: #eee;
                --border-color: #404040;
                --page-bg: #18171c;
                --pane-bg: rgb(28, 29, 33);
                --pane-border: 1px solid rgba(255, 255, 255, 0.15);
                --struct-bg: rgba(255, 255, 255, 0.07);
                --accent-color: cornflowerblue;
                --btn-bg: rgba(255, 255, 255, 0.3);
                --btn-bg-hover: rgba(255, 255, 255, 0.2);
            }
            html, body {
                background: var(--mv-bg);
                color: var(--mv-text);
                font-family: -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
                margin: 0;
                padding: 0;
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
                /* Inherit theme CSS variables for MatterViz components */
                color-scheme: inherit;
                --pane-bg: var(--pane-bg);
                --page-bg: var(--page-bg);
                --text-color: var(--text-color);
                --struct-bg: var(--struct-bg);
            }
            /* Force light theme colors on draggable panes in light mode */
            :root:not([data-theme="dark"]) .draggable-pane {
                background: rgb(229, 231, 235) !important;
                color: #374151 !important;
            }
            /* Dropdown styling for dark mode */
            [data-theme="dark"] .Select-control,
            [data-theme="dark"] .Select-menu-outer {
                background: var(--mv-surface);
                border-color: var(--mv-border);
                color: var(--mv-text);
            }
            .callback-output {
                padding: 12px;
                border-radius: 6px;
                background: var(--mv-surface);
                color: var(--mv-text);
                border: 1px solid var(--mv-border);
                overflow: auto;
                max-height: 150px;
                font-size: 13px;
                margin: 0 0 16px 0;
            }
            .text-muted {
                color: var(--mv-text-muted);
                margin-bottom: 12px;
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

    # Move callback output into periodic table grid inset area
    app.clientside_callback(
        """
        function(n_clicks) {
            const out = document.getElementById('callback-output');
            const grid = document.querySelector('#callback-periodic-table .ptable-grid');
            if (out && grid && out.parentNode !== grid) {
                Object.assign(out.style, {
                    gridRow: '1 / span 3',
                    gridColumn: '3 / span 10',
                    alignSelf: 'stretch',
                    zIndex: '1',
                });
                grid.appendChild(out);
            }
            return window.dash_clientside.no_update;
        }
        """,
        Output("callback-output", "id"),
        Input("callback-periodic-table", "id"),
    )

    # Data-driven callbacks: each entry is (input_id, output_id, loader, fallback_list,
    # fallback_default, props_builder). Eliminates repetitive load-fallback-return pattern.
    _data_callbacks: list[tuple[str, str, Callable, list[str], str, Callable]] = [
        (
            "structure-selector",
            "structure",
            load_structure,
            AVAILABLE_STRUCTURES,
            _FALLBACK_STRUCTURE,
            lambda d: {"structure": d, "show_controls": True},
        ),
        (
            "structure-selector-2",
            "structure-2",
            load_structure,
            AVAILABLE_STRUCTURES,
            _FALLBACK_STRUCTURE,
            lambda d: {"structure": d, "show_controls": True},
        ),
        (
            "phase-diagram-selector",
            "phase-binary",
            load_phase_diagram,
            AVAILABLE_PHASE_DIAGRAMS,
            _FALLBACK_PHASE_DIAGRAM,
            lambda d: {"data": d or _EMPTY_PHASE},
        ),
        (
            "phonon-selector",
            "phonon-bands",
            load_phonon_bands,
            AVAILABLE_PHONONS,
            _FALLBACK_PHONON,
            lambda d: {"band_structs": d},
        ),
        (
            "dos-selector",
            "electronic-dos",
            load_electronic_dos,
            AVAILABLE_DOS,
            _FALLBACK_DOS,
            lambda d: {"doses": d},
        ),
        (
            "bands-selector",
            "electronic-bands",
            load_electronic_bands,
            AVAILABLE_BANDS,
            _FALLBACK_BANDS,
            lambda d: {"band_structs": d},
        ),
        (
            "xrd-selector",
            "xrd",
            load_xrd_pattern,
            AVAILABLE_XRD,
            _FALLBACK_XRD,
            lambda d: {
                "patterns": d or {"x": [20, 30, 40], "y": [100, 50, 25]},
                "peak_width": 0.5,
                "annotate_peaks": 5,
            },
        ),
    ]
    for input_id, output_id, loader, avail, fallback, build_props in _data_callbacks:

        @app.callback(Output(output_id, "mv_props"), Input(input_id, "value"))
        def _update(
            selected: str,
            _loader: Callable = loader,
            _avail: list[str] = avail,
            _fb: str = fallback,
            _build: Callable = build_props,
        ) -> dict:
            data = get_cached(selected, _loader)
            if not data:
                data = get_cached(_safe_first(_avail, _fb), _loader)
            return _build(data)

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
    try:
        port = int(os.environ.get("DASH_PORT", "8050"))
    except ValueError:
        port = 8050
    # host="0.0.0.0" required for container deployments (Docker, HF Spaces)
    host = os.environ.get("DASH_HOST", "127.0.0.1")
    create_app().run(debug=debug_mode, port=port, host=host)
