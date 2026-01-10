"""Minimal Dash app to exercise matterviz-dash-components."""

import mimetypes

import dash
from dash import html

import matterviz_dash_components as mvc

# Ensure wasm is served with the correct MIME type when running locally.
if mimetypes.guess_type("file.wasm")[0] != "application/wasm":
    mimetypes.add_type("application/wasm", ".wasm")

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

CONVEX_ENTRIES = [
    {"composition": {"Si": 1, "C": 0, "O": 0}, "energy": -1.2, "name": "Si"},
    {"composition": {"Si": 0, "C": 1, "O": 0}, "energy": -0.8, "name": "C"},
    {"composition": {"Si": 0, "C": 0, "O": 1}, "energy": -0.9, "name": "O"},
    {"composition": {"Si": 0.4, "C": 0.3, "O": 0.3}, "energy": -1.6, "name": "SiCO"},
]

PHASE_DIAGRAM_BINARY = {
    "components": ["Al", "Cu"],
    "temperature_range": [300, 900],
    "composition_unit": "at%",
    "regions": [
        {"id": "alpha", "name": "Alpha", "vertices": [[0, 300], [30, 600], [0, 900]], "color": "#6baed6"},
        {"id": "beta", "name": "Beta", "vertices": [[30, 600], [70, 600], [100, 900], [0, 900]], "color": "#fd8d3c"},
    ],
    "boundaries": [
        {"id": "alpha-beta", "type": "tie-line", "points": [[30, 600], [70, 600]], "style": {"color": "#ffffff"}},
    ],
    "special_points": [
        {"id": "eutectic", "type": "eutectic", "position": [50, 600], "label": "E"},
    ],
    "title": "Al-Cu (synthetic)",
}

PHASE_DIAGRAM_TERNARY = {
    "components": ["Li", "Fe", "P"],
    "temperature_range": [300, 900],
    "composition_unit": "at%",
    "regions": [
        {
            "id": "olivine",
            "name": "Olivine",
            "vertices": [
                [0.6, 0.2, 0.2, 500],
                [0.5, 0.3, 0.2, 500],
                [0.55, 0.25, 0.2, 700],
            ],
            "faces": [[0, 1, 2]],
            "color": "#4daf4a",
        },
        {
            "id": "spinel",
            "name": "Spinel",
            "vertices": [
                [0.3, 0.4, 0.3, 600],
                [0.25, 0.45, 0.3, 600],
                [0.28, 0.42, 0.3, 800],
            ],
            "faces": [[0, 1, 2]],
            "color": "#984ea3",
        },
    ],
    "special_points": [
        {"id": "t-eut", "type": "ternary_eutectic", "position": [0.35, 0.35, 0.3, 650], "label": "E*"},
    ],
    "title": "Li-Fe-P (synthetic)",
}

XRDPLOT_SERIES = [
    {
        "name": "Sample",
        "data": [
            {"two_theta": 20, "intensity": 10},
            {"two_theta": 24, "intensity": 25},
            {"two_theta": 28, "intensity": 80},
            {"two_theta": 32, "intensity": 40},
        ],
    }
]


def layout():
    sections = [
        ("periodic-table-section", "Periodic Table"),
        ("structure-section", "Structure (Si)"),
        ("composition-section", "Composition"),
        ("trajectory-section", "Trajectory (2-frame toy)"),
        ("brillouin-section", "Brillouin Zone"),
        ("convex-2d-section", "Convex Hull 2D"),
        ("convex-3d-section", "Convex Hull 3D"),
        ("phase-binary-section", "Binary Phase Diagram"),
        ("phase-ternary-section", "Ternary Phase Diagram"),
        ("xrd-section", "XRD Plot"),
    ]

    return html.Div(
        style={"display": "grid", "gap": "16px", "padding": "12px"},
        children=[
            html.H3("MatterViz Dash demo"),
            html.Div(
                [
                    html.H4("Table of Contents"),
                    html.Ul(
                        [
                            html.Li(html.A(title, href=f"#{sid}"))
                            for sid, title in sections
                        ]
                    ),
                ]
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
                        style={"height": "340px", "border": "1px solid #ddd"},
                    ),
                ]
                ,
                id="periodic-table-section",
            ),
            html.Div(
                [
                    html.H4("Structure (Si)"),
                    mvc.MatterViz(
                        id="structure",
                        component="structure/Structure",
                        mv_props={
                            "structure": SILICON_STRUCTURE,
                            "show_controls": True,
                            "height": 360,
                        },
                        style={"height": "380px", "border": "1px solid #ddd"},
                    ),
                ]
                ,
                id="structure-section",
            ),
            html.Div(
                [
                    html.H4("Composition"),
                    mvc.MatterViz(
                        id="composition",
                        component="composition/Composition",
                        mv_props={
                            "composition": "LiFePO4",
                            "mode": "pie",
                            "size": 240,
                            "color_scheme": "vesta",
                        },
                        style={"height": "320px", "border": "1px solid #ddd"},
                    ),
                ]
                ,
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
                        style={"height": "380px", "border": "1px solid #ddd"},
                    ),
                ]
                ,
                id="trajectory-section",
            ),
            html.Div(
                [
                    html.H4("Brillouin Zone"),
                    mvc.MatterViz(
                        id="brillouin",
                        component="brillouin/BrillouinZone",
                        mv_props={"structure": SILICON_STRUCTURE, "height": 360},
                        style={"height": "380px", "border": "1px solid #ddd"},
                    ),
                ]
                ,
                id="brillouin-section",
            ),
            html.Div(
                [
                    html.H4("Convex Hull 2D"),
                    mvc.MatterViz(
                        id="convex-2d",
                        component="convex-hull/ConvexHull2D",
                        mv_props={"entries": CONVEX_ENTRIES, "height": 320},
                        style={"height": "340px", "border": "1px solid #ddd"},
                    ),
                ]
                ,
                id="convex-2d-section",
            ),
            html.Div(
                [
                    html.H4("Convex Hull 3D"),
                    mvc.MatterViz(
                        id="convex-3d",
                        component="convex-hull/ConvexHull3D",
                        mv_props={
                            "entries": [
                                {"composition": {"A": 1, "B": 0, "C": 0}, "energy": -1.2, "name": "A"},
                                {"composition": {"A": 0, "B": 1, "C": 0}, "energy": -0.9, "name": "B"},
                                {"composition": {"A": 0, "B": 0, "C": 1}, "energy": -0.95, "name": "C"},
                                {"composition": {"A": 0.33, "B": 0.33, "C": 0.34}, "energy": -1.6, "name": "ABC"},
                            ],
                            "height": 360,
                        },
                        style={"height": "380px", "border": "1px solid #ddd"},
                    ),
                ]
                ,
                id="convex-3d-section",
            ),
            html.Div(
                [
                    html.H4("Binary Phase Diagram"),
                    mvc.MatterViz(
                        id="phase-binary",
                        component="phase-diagram/IsobaricBinaryPhaseDiagram",
                        mv_props={"data": PHASE_DIAGRAM_BINARY, "height": 320},
                        style={"height": "340px", "border": "1px solid #ddd"},
                    ),
                ]
                ,
                id="phase-binary-section",
            ),
            html.Div(
                [
                    html.H4("Ternary Phase Diagram"),
                    mvc.MatterViz(
                        id="phase-ternary",
                        component="phase-diagram/IsobaricTernaryPhaseDiagram",
                        mv_props={"data": PHASE_DIAGRAM_TERNARY, "height": 360},
                        style={"height": "380px", "border": "1px solid #ddd"},
                    ),
                ]
                ,
                id="phase-ternary-section",
            ),
            html.Div(
                [
                    html.H4("XRD Plot"),
                    mvc.MatterViz(
                        id="xrd",
                        component="xrd/XrdPlot",
                        mv_props={"series": XRDPLOT_SERIES, "show_controls": True, "height": 320},
                        style={"height": "340px", "border": "1px solid #ddd"},
                    ),
                ]
                ,
                id="xrd-section",
            ),
        ],
    )


def create_app():
    app = dash.Dash(__name__, suppress_callback_exceptions=True)
    app.layout = layout
    return app


if __name__ == "__main__":
    create_app().run(debug=False, port=8050)

