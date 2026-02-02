"""Simplified MatterViz Dash demo for HuggingFace Spaces.

Uses embedded demo data to avoid file loading issues.
"""

from __future__ import annotations

import json
import os

import dash
import matterviz_dash_components as mvc
from dash import Input, Output, html

# Simple demo structure (Silicon)
DEMO_STRUCTURE = {
    "lattice": {
        "matrix": [[5.43, 0, 0], [0, 5.43, 0], [0, 0, 5.43]],
        "pbc": [True, True, True],
    },
    "sites": [
        {"abc": [0, 0, 0], "species": [{"element": "Si", "occu": 1}]},
        {"abc": [0.25, 0.25, 0.25], "species": [{"element": "Si", "occu": 1}]},
        {"abc": [0.5, 0.5, 0], "species": [{"element": "Si", "occu": 1}]},
        {"abc": [0.75, 0.75, 0.25], "species": [{"element": "Si", "occu": 1}]},
        {"abc": [0.5, 0, 0.5], "species": [{"element": "Si", "occu": 1}]},
        {"abc": [0.75, 0.25, 0.75], "species": [{"element": "Si", "occu": 1}]},
        {"abc": [0, 0.5, 0.5], "species": [{"element": "Si", "occu": 1}]},
        {"abc": [0.25, 0.75, 0.75], "species": [{"element": "Si", "occu": 1}]},
    ],
}

# 2-frame trajectory demo
DEMO_TRAJECTORY = {
    "frames": [
        {"structure": DEMO_STRUCTURE, "step": 0},
        {
            "structure": {
                **DEMO_STRUCTURE,
                "sites": [
                    {**s, "abc": [s["abc"][0] + 0.02, s["abc"][1], s["abc"][2]]}  # type: ignore[arg-type,call-overload]
                    for s in DEMO_STRUCTURE["sites"]
                ],
            },
            "step": 1,
        },
    ]
}

# Convex hull entries (Li-Co system)
DEMO_HULL_ENTRIES = [
    {"composition": {"Li": 1}, "energy": -1.9, "entry_id": "Li", "e_above_hull": 0},
    {"composition": {"Co": 1}, "energy": -7.1, "entry_id": "Co", "e_above_hull": 0},
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

# Empty phase diagram (fallback)
EMPTY_PHASE = {
    "components": ["A", "B"],
    "temperature_range": [0, 1000],
    "regions": [
        {"phase": "α", "vertices": [[0, 0], [0.3, 0], [0.3, 500], [0, 500]]},
        {"phase": "β", "vertices": [[0.3, 0], [0.7, 0], [0.7, 500], [0.3, 500]]},
        {"phase": "γ", "vertices": [[0.7, 0], [1, 0], [1, 500], [0.7, 500]]},
    ],
    "boundaries": [],
}

# Demo XRD pattern
DEMO_XRD = {
    "x": [20, 26, 28, 36, 40, 42, 50, 55, 60],
    "y": [100, 35, 80, 25, 15, 50, 30, 20, 40],
}


def create_layout() -> html.Div:
    """Build the demo layout with embedded data."""
    sections = [
        ("periodic-table-section", "Periodic Table"),
        ("structure-section", "Structure"),
        ("composition-section", "Composition"),
        ("trajectory-section", "Trajectory"),
        ("brillouin-section", "Brillouin Zone"),
        ("convex-section", "Convex Hull"),
        ("phase-section", "Phase Diagram"),
        ("xrd-section", "XRD Plot"),
        ("callback-section", "Callbacks"),
    ]

    return html.Div(
        id="main-container",
        className="main-container",
        children=[
            html.H1("MatterViz Dash Demo", className="title"),
            html.P(
                "Interactive demo of MatterViz components wrapped as Dash components.",
                className="subtitle",
            ),
            # Navigation
            html.Nav(
                [
                    html.A(title, href=f"#{sid}", className="nav-link")
                    for sid, title in sections
                ],
                className="nav",
            ),
            # Periodic Table
            html.Div(
                [
                    html.H3("Periodic Table"),
                    mvc.MatterViz(
                        id="periodic-table",
                        component="periodic-table/PeriodicTable",
                        mv_props={
                            "height": 400,
                            "show_color_bar": True,
                            "heatmap_values": {
                                "Si": 1.0,
                                "C": 0.7,
                                "O": 0.5,
                                "Fe": 0.3,
                            },
                        },
                        className="component-border section-margin",
                    ),
                ],
                id="periodic-table-section",
            ),
            # Structure
            html.Div(
                [
                    html.H3("Crystal Structure (Si)"),
                    mvc.MatterViz(
                        id="structure",
                        component="structure/Structure",
                        mv_props={
                            "structure": DEMO_STRUCTURE,
                            "show_controls": True,
                            "height": 400,
                        },
                        className="component-border section-margin",
                    ),
                ],
                id="structure-section",
            ),
            # Composition
            html.Div(
                [
                    html.H3("Composition"),
                    html.Div(
                        [
                            mvc.MatterViz(
                                id="comp-1",
                                component="composition/Composition",
                                mv_props={
                                    "composition": "LiFePO4",
                                    "mode": "pie",
                                    "size": 160,
                                },
                            ),
                            mvc.MatterViz(
                                id="comp-2",
                                component="composition/Composition",
                                mv_props={
                                    "composition": "BaTiO3",
                                    "mode": "bar",
                                    "size": 160,
                                },
                            ),
                            mvc.MatterViz(
                                id="comp-3",
                                component="composition/Composition",
                                mv_props={
                                    "composition": {"Mg": 2, "Si": 1, "O": 4},
                                    "mode": "pie",
                                    "size": 160,
                                },
                            ),
                        ],
                        className="flex-row section-margin",
                    ),
                ],
                id="composition-section",
            ),
            # Trajectory
            html.Div(
                [
                    html.H3("Trajectory (2-frame demo)"),
                    mvc.MatterViz(
                        id="trajectory",
                        component="trajectory/Trajectory",
                        mv_props={
                            "trajectory": DEMO_TRAJECTORY,
                            "show_controls": True,
                            "fps": 1,
                            "height": 350,
                        },
                        className="component-border section-margin",
                    ),
                ],
                id="trajectory-section",
            ),
            # Brillouin Zone
            html.Div(
                [
                    html.H3("Brillouin Zone"),
                    mvc.MatterViz(
                        id="brillouin",
                        component="brillouin/BrillouinZone",
                        mv_props={"structure": DEMO_STRUCTURE, "height": 350},
                        className="component-border section-margin",
                    ),
                ],
                id="brillouin-section",
            ),
            # Convex Hull
            html.Div(
                [
                    html.H3("Convex Hull (Li-Co)"),
                    mvc.MatterViz(
                        id="convex-hull",
                        component="convex-hull/ConvexHull2D",
                        mv_props={"entries": DEMO_HULL_ENTRIES, "height": 350},
                        className="component-border section-margin",
                    ),
                ],
                id="convex-section",
            ),
            # Phase Diagram
            html.Div(
                [
                    html.H3("Binary Phase Diagram (A-B demo)"),
                    mvc.MatterViz(
                        id="phase-diagram",
                        component="phase-diagram/IsobaricBinaryPhaseDiagram",
                        mv_props={"data": EMPTY_PHASE, "height": 400},
                        className="component-border section-margin",
                    ),
                ],
                id="phase-section",
            ),
            # XRD
            html.Div(
                [
                    html.H3("XRD Plot"),
                    mvc.MatterViz(
                        id="xrd",
                        component="xrd/XrdPlot",
                        mv_props={
                            "patterns": DEMO_XRD,
                            "peak_width": 0.5,
                            "annotate_peaks": 5,
                            "height": 300,
                        },
                        className="component-border section-margin",
                    ),
                ],
                id="xrd-section",
            ),
            # Callback Demo
            html.Div(
                [
                    html.H3("Callback Demo"),
                    html.P("Click elements to see events:", className="text-muted"),
                    html.Pre(
                        id="callback-output",
                        children="Click an element...",
                        className="callback-output",
                    ),
                    mvc.MatterViz(
                        id="callback-ptable",
                        component="periodic-table/PeriodicTable",
                        mv_props={"show_color_bar": False, "height": 300},
                        event_props=["tile_props.onclick"],
                        className="component-border",
                    ),
                ],
                id="callback-section",
            ),
        ],
    )


def create_app() -> dash.Dash:
    """Create the Dash app."""
    # CSS styles with CSS variables for dark mode support
    styles = """
        :root {
            --mv-bg: #ffffff;
            --mv-text: #1a1a1a;
            --mv-text-muted: #666666;
            --mv-border: #dddddd;
            --mv-surface: #f5f5f5;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --mv-bg: #1a1a1a;
                --mv-text: #e0e0e0;
                --mv-text-muted: #999999;
                --mv-border: #444444;
                --mv-surface: #2a2a2a;
            }
        }
        body {
            background: var(--mv-bg);
            color: var(--mv-text);
            font-family: system-ui, -apple-system, sans-serif;
        }
        .main-container {
            padding: 16px;
            max-width: 900px;
            margin: 0 auto;
        }
        .title { text-align: center; }
        .subtitle {
            text-align: center;
            color: var(--mv-text-muted);
            margin-bottom: 24px;
        }
        .nav {
            margin-bottom: 24px;
            text-align: center;
        }
        .nav-link { margin-right: 12px; }
        .text-muted { color: var(--mv-text-muted); }
        .component-border { border: 1px solid var(--mv-border); }
        .section-margin { margin-bottom: 16px; }
        .flex-row {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
            margin-bottom: 16px;
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
        h3 { color: var(--mv-text); }
    """

    app = dash.Dash(__name__)
    app.index_string = f"""
    <!DOCTYPE html>
    <html>
    <head>
        {{%metas%}}
        <title>MatterViz Dash Demo</title>
        {{%favicon%}}
        {{%css%}}
        <style>{styles}</style>
    </head>
    <body>
        {{%app_entry%}}
        {{%config%}}
        {{%scripts%}}
        {{%renderer%}}
    </body>
    </html>
    """
    app.layout = create_layout

    @app.callback(
        Output("callback-output", "children"),
        Input("callback-ptable", "last_event"),
    )
    def show_event(event: dict | None) -> str:
        if not event:
            return "Click an element..."
        return json.dumps(event, indent=2)

    return app


if __name__ == "__main__":
    port = int(os.environ.get("DASH_PORT", 7860))
    host = os.environ.get("DASH_HOST", "0.0.0.0")
    debug = os.environ.get("DASH_DEBUG", "0").lower() in ("1", "true")
    create_app().run(debug=debug, port=port, host=host)
