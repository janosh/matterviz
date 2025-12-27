"""Generate binary phase diagram JSON files with complete regions and labels.

This script creates phase diagram data with proper regions, boundaries, colors,
and labels for visualization in IsobaricBinaryPhaseDiagram.svelte.

All phase diagrams use approximate/simplified data for demonstration purposes.
For accurate thermodynamic data, use CALPHAD calculations with validated TDB files.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any, Literal, TypeAlias

Vertex: TypeAlias = list[float]
VertexList: TypeAlias = list[Vertex]

# Type aliases for phase diagram components
BoundaryType = Literal[
    "liquidus", "solidus", "solvus", "eutectic", "peritectic", "tie-line", "custom"
]
SpecialPointType = Literal[
    "eutectic", "peritectic", "eutectoid", "peritectoid", "congruent", "custom"
]

# Dict type aliases for phase diagram structures
PhaseRegion: TypeAlias = dict[str, Any]
PhaseBoundary: TypeAlias = dict[str, Any]
SpecialPoint: TypeAlias = dict[str, Any]
BoundaryStyle: TypeAlias = dict[str, str | float]
PhaseDiagramData: TypeAlias = dict[str, Any]


def dedupe_consecutive_vertices(vertices: VertexList) -> VertexList:
    """Remove duplicate consecutive vertices from a polygon."""
    if len(vertices) <= 1:
        return vertices
    result = [vertices[0]]
    for vertex in vertices[1:]:
        if vertex != result[-1]:
            result.append(vertex)
    return result


def rgba(r: int, g: int, b: int, a: float = 0.6) -> str:
    """Generate rgba color string."""
    return f"rgba({r}, {g}, {b}, {a})"


# Standard phase colors matching the frontend PHASE_COLORS
PHASE_COLORS = {
    # Single-phase regions (alpha=0.6)
    "liquid": rgba(135, 206, 250),
    "fcc_a1": rgba(144, 238, 144),
    "fcc_cu": rgba(255, 180, 150),
    "bcc_a2": rgba(255, 182, 193),
    "hcp_a3": rgba(221, 160, 221),
    "diamond": rgba(173, 216, 230),
    "intermetallic": rgba(255, 200, 150),
    "intermetallic_alt": rgba(200, 180, 255),
    "intermetallic_blue": rgba(180, 200, 230),
    "gold": rgba(255, 215, 0),
    # Two-phase regions (alpha=0.5)
    "two_phase": rgba(255, 235, 156, 0.5),
    "two_phase_fcc_liquid": rgba(180, 230, 180, 0.5),
    "two_phase_fcc_alt": rgba(200, 230, 200, 0.5),
    "two_phase_bcc_liquid": rgba(255, 200, 200, 0.5),
    "two_phase_hcp_liquid": rgba(230, 180, 230, 0.5),
    "two_phase_intermetallic": rgba(255, 220, 180, 0.5),
    "two_phase_intermetallic_alt": rgba(255, 210, 180, 0.5),
    "two_phase_theta_liquid": rgba(255, 235, 200, 0.5),
    "two_phase_theta_cu": rgba(255, 200, 180, 0.5),
    "two_phase_alt": rgba(220, 200, 240, 0.5),
    "two_phase_mixed": rgba(230, 200, 220, 0.5),
    "two_phase_gamma": rgba(180, 200, 250, 0.5),
    "two_phase_gamma_hcp": rgba(230, 230, 180, 0.5),
    "two_phase_ausn": rgba(200, 180, 230, 0.5),
    "two_phase_si": rgba(180, 220, 250, 0.5),
    "two_phase_au_liquid": rgba(255, 235, 150, 0.5),
    "two_phase_au_ausn": rgba(255, 230, 180, 0.5),
    "two_phase_eta": rgba(230, 200, 230, 0.5),
    "two_phase_alfe": rgba(220, 200, 255, 0.5),
    "two_phase_alfe_bcc": rgba(230, 200, 200, 0.5),
    "two_phase_beta_gamma": rgba(230, 200, 180, 0.5),
}


def make_region(
    region_id: str,
    name: str,
    vertices: VertexList,
    color: str,
) -> PhaseRegion:
    """Create a phase region dict with standard structure."""
    return {"id": region_id, "name": name, "vertices": vertices, "color": color}


def make_boundary(
    boundary_id: str,
    boundary_type: BoundaryType,
    points: VertexList,
    style: BoundaryStyle | None = None,
) -> PhaseBoundary:
    """Create a boundary dict with standard structure."""
    result: PhaseBoundary = {"id": boundary_id, "type": boundary_type, "points": points}
    if style:
        result["style"] = style
    return result


def make_special_point(
    point_id: str,
    point_type: SpecialPointType,
    position: list[float],
    label: str,
) -> SpecialPoint:
    """Create a special point dict with standard structure."""
    return {"id": point_id, "type": point_type, "position": position, "label": label}


def create_al_cu_diagram() -> PhaseDiagramData:
    """Create Al-Cu binary phase diagram (simplified eutectic system)."""
    t_min, t_max = 300, 1400
    t_melt_al = 933
    t_melt_cu = 1358
    t_eutectic = 821

    # Simplified Al-Cu: eutectic at ~17% Cu, with θ phase around 33%
    # Liquidus curve
    liquidus = [
        [0.0, t_melt_al],
        [0.05, 900],
        [0.10, 860],
        [0.17, t_eutectic],  # Eutectic point
        [0.25, 900],
        [0.35, 1000],
        [0.50, 1100],
        [0.70, 1200],
        [0.85, 1300],
        [1.0, t_melt_cu],
    ]

    # Solidus/solvus for Al-rich side
    solvus_al = [[0.05, t_eutectic], [0.03, 600], [0.02, t_min]]
    # Solidus/solvus for Cu-rich side
    solvus_cu = [[0.90, t_eutectic], [0.93, 600], [0.95, t_min]]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_cu],
                *reversed(liquidus),
                [0.0, t_melt_al],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "fcc_al",
            "name": "FCC (Al)",
            "vertices": [
                [0.0, t_melt_al],
                [0.05, t_eutectic],
                *solvus_al[1:],
                [0.02, t_min],
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "fcc_cu",
            "name": "FCC (Cu)",
            "vertices": [
                [1.0, t_melt_cu],
                [1.0, t_min],
                [0.95, t_min],
                *reversed(solvus_cu[1:]),
                [0.90, t_eutectic],
            ],
            "color": PHASE_COLORS["fcc_cu"],
        },
        {
            "id": "al_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.0, t_melt_al],
                [0.05, 900],
                [0.10, 860],
                [0.17, t_eutectic],
                [0.05, t_eutectic],
            ],
            "color": PHASE_COLORS["two_phase_fcc_liquid"],
        },
        {
            "id": "cu_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.90, t_eutectic],
                [0.85, 1300],
                [1.0, t_melt_cu],
            ],
            "color": PHASE_COLORS["two_phase_theta_cu"],
        },
        {
            "id": "theta",
            "name": "θ (Al₂Cu)",
            "vertices": [
                [0.30, t_eutectic],
                [0.36, t_eutectic],
                [0.36, t_min],
                [0.30, t_min],
            ],
            "color": PHASE_COLORS["intermetallic"],
        },
        {
            "id": "al_theta",
            "name": "FCC + θ",
            "vertices": [
                [0.05, t_eutectic],
                [0.30, t_eutectic],
                [0.30, t_min],
                [0.02, t_min],
                *reversed(solvus_al[1:]),
            ],
            "color": PHASE_COLORS["two_phase"],
        },
        {
            "id": "theta_cu",
            "name": "θ + FCC",
            "vertices": [
                [0.36, t_eutectic],
                [0.90, t_eutectic],
                *solvus_cu[1:],
                [0.95, t_min],
                [0.36, t_min],
            ],
            "color": PHASE_COLORS["two_phase_intermetallic"],
        },
        {
            "id": "theta_liquid",
            "name": "θ + L",
            "vertices": [
                [0.17, t_eutectic],
                [0.25, 900],
                [0.35, 1000],
                [0.50, 1100],
                [0.70, 1200],
                [0.85, 1300],
                [0.90, t_eutectic],
                [0.36, t_eutectic],
                [0.30, t_eutectic],
            ],
            "color": PHASE_COLORS["two_phase_theta_liquid"],
        },
    ]

    boundaries = [
        {"id": "liquidus", "type": "liquidus", "points": liquidus},
        {"id": "solvus-al", "type": "solvus", "points": solvus_al},
        {"id": "solvus-cu", "type": "solvus", "points": solvus_cu},
        {
            "id": "eutectic",
            "type": "eutectic",
            "points": [[0.05, t_eutectic], [0.90, t_eutectic]],
        },
    ]

    special_points = [
        {
            "id": "eutectic",
            "type": "eutectic",
            "position": [0.17, t_eutectic],
            "label": "E",
        },
    ]

    return {
        "components": ["Al", "Cu"],
        "temperature_range": [t_min, t_max],
        "temperature_unit": "K",
        "composition_unit": "mol%",
        "title": "Al-Cu Binary Phase Diagram",
        "regions": regions,
        "boundaries": boundaries,
        "special_points": special_points,
    }


def create_al_fe_diagram() -> PhaseDiagramData:
    """Create Al-Fe binary phase diagram (peritectic system with intermetallics)."""
    t_min, t_max = 300, 1900
    t_melt_al = 933
    t_melt_fe = 1811
    t_eutectic = 928
    t_peritectic = 1430

    liquidus_left = [
        [0.0, t_melt_al],
        [0.01, 930],
        [0.02, t_eutectic],
    ]
    liquidus_right = [
        [0.02, t_eutectic],
        [0.10, 1000],
        [0.20, 1150],
        [0.30, 1300],
        [0.40, t_peritectic],
        [0.50, 1500],
        [0.70, 1650],
        [0.90, 1780],
        [1.0, t_melt_fe],
    ]

    solidus_al = [[0.0, t_melt_al], [0.01, t_eutectic]]
    solidus_fe = [[0.95, 1700], [1.0, t_melt_fe]]

    solvus_al = [[0.01, t_eutectic], [0.005, 700], [0.002, t_min]]
    solvus_fe = [[0.95, 1700], [0.97, 1400], [0.98, 1000], [0.99, t_min]]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_fe],
                *reversed(liquidus_right),
                *reversed(liquidus_left),
                [0.0, t_melt_al],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "fcc_al",
            "name": "α (FCC Al)",
            "vertices": [
                [0.0, t_melt_al],
                *solidus_al,
                *solvus_al,
                [0.002, t_min],
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "bcc_fe",
            "name": "α (BCC Fe)",
            "vertices": [
                [1.0, t_melt_fe],
                [1.0, t_min],
                [0.99, t_min],
                *reversed(solvus_fe),
                *reversed(solidus_fe),
            ],
            "color": PHASE_COLORS["bcc_a2"],
        },
        {
            "id": "al_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.0, t_melt_al],
                *liquidus_left,
                [0.02, t_eutectic],
                [0.01, t_eutectic],
                *reversed(solidus_al),
            ],
            "color": PHASE_COLORS["two_phase_fcc_liquid"],
        },
        {
            "id": "fe_liquid",
            "name": "BCC + L",
            "vertices": [
                # Trace from solidus up along Fe-rich side, then back along liquidus
                [0.70, 1650],
                [0.90, 1780],
                [1.0, t_melt_fe],
                *reversed(solidus_fe),
            ],
            "color": PHASE_COLORS["two_phase_bcc_liquid"],
        },
        {
            "id": "al3fe",
            "name": "Al₃Fe",
            "vertices": [
                [0.20, t_eutectic],
                [0.30, t_eutectic],
                [0.30, t_min],
                [0.20, t_min],
            ],
            "color": PHASE_COLORS["intermetallic"],
        },
        {
            "id": "alfe",
            "name": "AlFe",
            "vertices": [
                [0.45, t_peritectic],
                [0.55, t_peritectic],
                [0.55, t_min],
                [0.45, t_min],
            ],
            "color": PHASE_COLORS["intermetallic_alt"],
        },
        {
            "id": "al_al3fe",
            "name": "FCC + Al₃Fe",
            "vertices": [
                [0.01, t_eutectic],
                [0.20, t_eutectic],
                [0.20, t_min],
                [0.002, t_min],
                *reversed(solvus_al),
            ],
            "color": PHASE_COLORS["two_phase"],
        },
        {
            "id": "al3fe_liquid",
            "name": "Al₃Fe + L",
            "vertices": [
                [0.02, t_eutectic],
                *liquidus_right[1:4],
                [0.30, t_eutectic],
                [0.20, t_eutectic],
            ],
            "color": PHASE_COLORS["two_phase_intermetallic"],
        },
        {
            "id": "al3fe_alfe",
            "name": "Al₃Fe + AlFe",
            "vertices": [
                [0.30, t_eutectic],
                [0.30, 1300],
                [0.45, t_peritectic],
                [0.45, t_min],
                [0.30, t_min],
            ],
            "color": PHASE_COLORS["two_phase_mixed"],
        },
        {
            "id": "alfe_fe",
            "name": "AlFe + BCC",
            "vertices": [
                [0.55, t_peritectic],
                [0.70, 1650],
                [0.95, 1700],
                *solvus_fe,
                [0.99, t_min],
                [0.55, t_min],
            ],
            "color": PHASE_COLORS["two_phase_alfe_bcc"],
        },
        {
            "id": "alfe_liquid",
            "name": "AlFe + L",
            "vertices": [
                [0.30, 1300],
                *liquidus_right[4:7],
                [0.55, t_peritectic],
                [0.45, t_peritectic],
            ],
            "color": PHASE_COLORS["two_phase_alfe"],
        },
    ]

    boundaries = [
        {"id": "liquidus-left", "type": "liquidus", "points": liquidus_left},
        {"id": "liquidus-right", "type": "liquidus", "points": liquidus_right},
        {"id": "solidus-al", "type": "solidus", "points": solidus_al},
        {"id": "solidus-fe", "type": "solidus", "points": solidus_fe},
        {"id": "solvus-al", "type": "solvus", "points": solvus_al},
        {"id": "solvus-fe", "type": "solvus", "points": solvus_fe},
    ]

    special_points = [
        {
            "id": "eutectic",
            "type": "eutectic",
            "position": [0.02, t_eutectic],
            "label": "E",
        },
        {
            "id": "peritectic",
            "type": "peritectic",
            "position": [0.40, t_peritectic],
            "label": "P",
        },
    ]

    return {
        "components": ["Al", "Fe"],
        "temperature_range": [t_min, t_max],
        "temperature_unit": "K",
        "composition_unit": "mol%",
        "title": "Al-Fe Binary Phase Diagram",
        "regions": regions,
        "boundaries": boundaries,
        "special_points": special_points,
    }


def create_al_mg_diagram() -> PhaseDiagramData:
    """Create Al-Mg binary phase diagram with proper regions."""
    t_min, t_max = 300, 1100
    t_melt_al = 933
    t_melt_mg = 923
    t_eutectic = 710
    t_peritectic = 725

    liquidus_left = [
        [0.0, t_melt_al],
        [0.05, 900],
        [0.15, 820],
        [0.25, 750],
        [0.35, t_eutectic],
    ]
    liquidus_right = [
        [0.35, t_eutectic],
        [0.45, 750],
        [0.55, 780],
        [0.65, t_peritectic],
        [0.75, 800],
        [0.85, 850],
        [0.95, 900],
        [1.0, t_melt_mg],
    ]

    solidus_al = [[0.0, t_melt_al], [0.02, 850], [0.05, 750], [0.08, t_eutectic]]
    solidus_mg = [[0.92, t_eutectic], [0.95, 800], [0.97, 870], [1.0, t_melt_mg]]
    solvus_al = [
        [0.08, t_eutectic],
        [0.06, 600],
        [0.04, 500],
        [0.02, 400],
        [0.01, t_min],
    ]
    solvus_mg = [
        [0.92, t_eutectic],
        [0.94, 600],
        [0.96, 500],
        [0.98, 400],
        [0.99, t_min],
    ]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_mg],
                *reversed(liquidus_right),
                *reversed(liquidus_left),
                [0.0, t_melt_al],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "fcc_a1",
            "name": "α (FCC)",
            "vertices": [
                [0.0, t_melt_al],
                *solidus_al,
                *solvus_al,
                [0.01, t_min],
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "hcp_a3",
            "name": "β (HCP Mg)",
            "vertices": [
                [1.0, t_melt_mg],
                [1.0, t_min],
                [0.99, t_min],
                *reversed(solvus_mg),
                *reversed(solidus_mg),
            ],
            "color": PHASE_COLORS["hcp_a3"],
        },
        {
            "id": "fcc_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.0, t_melt_al],
                *liquidus_left,
                [0.35, t_eutectic],
                [0.08, t_eutectic],
                *reversed(solidus_al),
            ],
            "color": PHASE_COLORS["two_phase_fcc_liquid"],
        },
        {
            "id": "hcp_liquid",
            "name": "HCP + L",
            "vertices": [
                [0.65, t_eutectic],
                [0.65, t_peritectic],
                [0.75, 800],
                [0.85, 850],
                [0.95, 900],
                [1.0, t_melt_mg],
                *reversed(solidus_mg),
                [0.92, t_eutectic],
            ],
            "color": PHASE_COLORS["two_phase_hcp_liquid"],
        },
        {
            "id": "beta_fcc",
            "name": "β + FCC",
            "vertices": [
                [0.08, t_eutectic],
                [0.35, t_eutectic],
                [0.35, t_min],
                [0.01, t_min],
                *reversed(solvus_al),
            ],
            "color": PHASE_COLORS["two_phase_fcc_alt"],
        },
        {
            "id": "almg_beta",
            "name": "β (Al₃Mg₂)",
            "vertices": [
                [0.35, t_eutectic],
                [0.40, t_eutectic],
                [0.40, t_min],
                [0.35, t_min],
            ],
            "color": PHASE_COLORS["intermetallic"],
        },
        {
            "id": "beta_gamma",
            "name": "β + γ",
            "vertices": [
                [0.40, t_eutectic],
                [0.48, t_eutectic],
                [0.48, t_min],
                [0.40, t_min],
            ],
            "color": PHASE_COLORS["two_phase_beta_gamma"],
        },
        {
            "id": "almg_gamma",
            "name": "γ (Al₁₂Mg₁₇)",
            "vertices": [
                [0.48, t_eutectic],
                [0.58, t_eutectic],
                [0.58, t_min],
                [0.48, t_min],
            ],
            "color": PHASE_COLORS["intermetallic_blue"],
        },
        {
            "id": "gamma_hcp",
            "name": "γ + HCP",
            "vertices": [
                [0.58, t_eutectic],
                [0.92, t_eutectic],
                *solvus_mg,
                [0.99, t_min],
                [0.58, t_min],
            ],
            "color": PHASE_COLORS["two_phase_gamma_hcp"],
        },
        {
            "id": "beta_liquid",
            "name": "β + L",
            "vertices": [
                [0.35, t_eutectic],
                [0.45, 750],
                [0.48, 759],
                [0.48, t_eutectic],
            ],
            "color": PHASE_COLORS["two_phase_intermetallic"],
        },
        {
            "id": "gamma_liquid",
            "name": "γ + L",
            "vertices": [
                [0.48, t_eutectic],
                [0.48, 759],
                [0.55, 780],
                [0.65, t_peritectic],
                [0.65, t_eutectic],
                [0.58, t_eutectic],
            ],
            "color": PHASE_COLORS["two_phase_gamma"],
        },
    ]

    boundaries = [
        {
            "id": "liquidus-left",
            "type": "liquidus",
            "points": liquidus_left,
            "style": {"color": "#1565c0", "width": 2.5},
        },
        {
            "id": "liquidus-right",
            "type": "liquidus",
            "points": liquidus_right,
            "style": {"color": "#1565c0", "width": 2.5},
        },
        {
            "id": "solidus-al",
            "type": "solidus",
            "points": solidus_al,
            "style": {"color": "#2e7d32", "width": 2},
        },
        {
            "id": "solidus-mg",
            "type": "solidus",
            "points": solidus_mg,
            "style": {"color": "#2e7d32", "width": 2},
        },
        {
            "id": "solvus-al",
            "type": "solvus",
            "points": solvus_al,
            "style": {"color": "#7b1fa2", "width": 1.5},
        },
        {
            "id": "solvus-mg",
            "type": "solvus",
            "points": solvus_mg,
            "style": {"color": "#7b1fa2", "width": 1.5},
        },
        {
            "id": "eutectic",
            "type": "eutectic",
            "points": [[0.08, t_eutectic], [0.92, t_eutectic]],
            "style": {"color": "#d32f2f", "width": 2},
        },
    ]

    special_points = [
        {
            "id": "eutectic",
            "type": "eutectic",
            "position": [0.35, t_eutectic],
            "label": "E",
        },
        {
            "id": "melt-al",
            "type": "congruent",
            "position": [0.0, t_melt_al],
            "label": "Tₘ(Al)",
        },
        {
            "id": "melt-mg",
            "type": "congruent",
            "position": [1.0, t_melt_mg],
            "label": "Tₘ(Mg)",
        },
    ]

    return {
        "components": ["Al", "Mg"],
        "temperature_range": [t_min, t_max],
        "temperature_unit": "K",
        "composition_unit": "mol%",
        "title": "Al-Mg Binary Phase Diagram",
        "regions": regions,
        "boundaries": boundaries,
        "special_points": special_points,
    }


def create_al_si_diagram() -> PhaseDiagramData:
    """Create Al-Si binary phase diagram (simple eutectic)."""
    t_min, t_max = 300, 1700
    t_melt_al = 933
    t_melt_si = 1687
    t_eutectic = 850
    x_eutectic = 0.12

    liquidus_left = [[0.0, t_melt_al], [0.05, 900], [x_eutectic, t_eutectic]]
    liquidus_right = [
        [x_eutectic, t_eutectic],
        [0.20, 1000],
        [0.40, 1200],
        [0.60, 1400],
        [0.80, 1550],
        [1.0, t_melt_si],
    ]

    solidus_al = [[0.0, t_melt_al], [0.01, 880], [0.015, t_eutectic]]
    solvus_al = [[0.015, t_eutectic], [0.01, 700], [0.005, t_min]]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_si],
                *reversed(liquidus_right),
                *reversed(liquidus_left),
                [0.0, t_melt_al],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "fcc_al",
            "name": "α (FCC Al)",
            "vertices": [
                [0.0, t_melt_al],
                *solidus_al,
                *solvus_al,
                [0.005, t_min],
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "diamond_si",
            "name": "Si (diamond)",
            "vertices": [
                [1.0, t_melt_si],
                [1.0, t_min],
                [0.999, t_min],
                [0.999, t_eutectic],
                [1.0, t_melt_si],
            ],
            "color": PHASE_COLORS["diamond"],
        },
        {
            "id": "al_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.0, t_melt_al],
                *liquidus_left,
                [x_eutectic, t_eutectic],
                [0.015, t_eutectic],
                *reversed(solidus_al),
            ],
            "color": PHASE_COLORS["two_phase_fcc_liquid"],
        },
        {
            "id": "si_liquid",
            "name": "Si + L",
            "vertices": [
                [1.0, t_melt_si],
                [0.999, t_eutectic],
                [x_eutectic, t_eutectic],
                *liquidus_right[1:],
            ],
            "color": PHASE_COLORS["two_phase_si"],
        },
        {
            "id": "al_si",
            "name": "FCC + Si",
            "vertices": [
                [0.015, t_eutectic],
                [0.999, t_eutectic],
                [0.999, t_min],
                [0.005, t_min],
                *reversed(solvus_al),
            ],
            "color": PHASE_COLORS["two_phase"],
        },
    ]

    boundaries = [
        {"id": "liquidus-left", "type": "liquidus", "points": liquidus_left},
        {"id": "liquidus-right", "type": "liquidus", "points": liquidus_right},
        {"id": "solidus-al", "type": "solidus", "points": solidus_al},
        {"id": "solvus-al", "type": "solvus", "points": solvus_al},
        {
            "id": "eutectic",
            "type": "eutectic",
            "points": [[0.015, t_eutectic], [0.999, t_eutectic]],
        },
    ]

    special_points = [
        {
            "id": "eutectic",
            "type": "eutectic",
            "position": [x_eutectic, t_eutectic],
            "label": "E",
        },
    ]

    return {
        "components": ["Al", "Si"],
        "temperature_range": [t_min, t_max],
        "temperature_unit": "K",
        "composition_unit": "mol%",
        "title": "Al-Si Binary Phase Diagram",
        "regions": regions,
        "boundaries": boundaries,
        "special_points": special_points,
    }


def create_au_sn_diagram() -> PhaseDiagramData:
    """Create Au-Sn binary phase diagram (multiple eutectics)."""
    t_min, t_max = 300, 1400
    t_melt_au = 1337
    t_melt_sn = 505
    t_eutectic1 = 553
    t_eutectic2 = 490

    # Simplified Au-Sn with two eutectics
    liquidus = [
        [0.0, t_melt_au],
        [0.10, 1100],
        [0.20, 900],
        [0.29, t_eutectic1],  # Eutectic 1
        [0.50, 600],
        [0.70, 520],
        [0.78, t_eutectic2],  # Eutectic 2
        [0.90, 500],
        [1.0, t_melt_sn],
    ]

    # Solvus curves
    solvus_au = [[0.05, t_eutectic1], [0.03, 400], [0.02, t_min]]
    solvus_sn = [[0.95, t_eutectic2], [0.97, 400], [0.98, t_min]]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_sn],
                *reversed(liquidus),
                [0.0, t_melt_au],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "fcc_au",
            "name": "FCC (Au)",
            "vertices": [
                [0.0, t_melt_au],
                [0.05, t_eutectic1],
                *solvus_au[1:],
                [0.02, t_min],
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["gold"],
        },
        {
            "id": "bct_sn",
            "name": "BCT (Sn)",
            "vertices": [
                [0.95, t_eutectic2],
                *solvus_sn[1:],
                [0.98, t_min],
                [1.0, t_min],
                [1.0, t_melt_sn],
            ],
            "color": PHASE_COLORS["hcp_a3"],
        },
        {
            "id": "au5sn",
            "name": "Au₅Sn",
            "vertices": [
                [0.15, t_eutectic1],
                [0.20, t_eutectic1],
                [0.20, t_min],
                [0.15, t_min],
            ],
            "color": PHASE_COLORS["intermetallic"],
        },
        {
            "id": "ausn",
            "name": "AuSn",
            "vertices": [
                [0.45, t_eutectic1],
                [0.55, t_eutectic1],
                [0.55, t_eutectic2],
                [0.45, t_eutectic2],
            ],
            "color": PHASE_COLORS["intermetallic_alt"],
        },
        {
            "id": "ausn_low",
            "name": "AuSn",
            "vertices": [
                [0.45, t_eutectic2],
                [0.55, t_eutectic2],
                [0.55, t_min],
                [0.45, t_min],
            ],
            "color": PHASE_COLORS["intermetallic_alt"],
        },
        {
            "id": "au_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.0, t_melt_au],
                [0.10, 1100],
                [0.20, 900],
                [0.29, t_eutectic1],
                [0.05, t_eutectic1],
            ],
            "color": PHASE_COLORS["two_phase_au_liquid"],
        },
        {
            "id": "sn_liquid",
            "name": "BCT + L",
            "vertices": [
                [0.78, t_eutectic2],
                [0.90, 500],
                [1.0, t_melt_sn],
                [0.95, t_eutectic2],
            ],
            "color": PHASE_COLORS["two_phase_hcp_liquid"],
        },
        {
            "id": "au_au5sn",
            "name": "FCC + Au₅Sn",
            "vertices": [
                [0.05, t_eutectic1],
                [0.15, t_eutectic1],
                [0.15, t_min],
                [0.02, t_min],
                *reversed(solvus_au[1:]),
            ],
            "color": PHASE_COLORS["two_phase_au_ausn"],
        },
        {
            "id": "au5sn_ausn",
            "name": "Au₅Sn + AuSn",
            "vertices": [
                [0.20, t_eutectic1],
                [0.45, t_eutectic1],
                [0.45, t_min],
                [0.20, t_min],
            ],
            "color": PHASE_COLORS["two_phase_intermetallic_alt"],
        },
        {
            "id": "ausn_sn",
            "name": "AuSn + BCT",
            "vertices": [
                [0.55, t_eutectic2],
                [0.95, t_eutectic2],
                *solvus_sn[1:],
                [0.98, t_min],
                [0.55, t_min],
            ],
            "color": PHASE_COLORS["two_phase_alt"],
        },
        {
            "id": "ausn_liquid",
            "name": "AuSn + L",
            "vertices": [
                [0.29, t_eutectic1],
                [0.50, 600],
                [0.70, 520],
                [0.78, t_eutectic2],
                [0.55, t_eutectic2],
                [0.55, t_eutectic1],
                [0.45, t_eutectic1],
                [0.29, t_eutectic1],
            ],
            "color": PHASE_COLORS["two_phase_ausn"],
        },
    ]

    boundaries = [
        {"id": "liquidus", "type": "liquidus", "points": liquidus},
        {"id": "solvus-au", "type": "solvus", "points": solvus_au},
        {"id": "solvus-sn", "type": "solvus", "points": solvus_sn},
        {
            "id": "eutectic1",
            "type": "eutectic",
            "points": [[0.05, t_eutectic1], [0.55, t_eutectic1]],
        },
        {
            "id": "eutectic2",
            "type": "eutectic",
            "points": [[0.55, t_eutectic2], [0.95, t_eutectic2]],
        },
    ]

    special_points = [
        {
            "id": "eutectic1",
            "type": "eutectic",
            "position": [0.29, t_eutectic1],
            "label": "E₁",
        },
        {
            "id": "eutectic2",
            "type": "eutectic",
            "position": [0.78, t_eutectic2],
            "label": "E₂",
        },
    ]

    return {
        "components": ["Au", "Sn"],
        "temperature_range": [t_min, t_max],
        "temperature_unit": "K",
        "composition_unit": "mol%",
        "title": "Au-Sn Binary Phase Diagram",
        "regions": regions,
        "boundaries": boundaries,
        "special_points": special_points,
    }


def create_cu_zn_diagram() -> PhaseDiagramData:
    """Create Cu-Zn binary phase diagram (brass system - simplified peritectic)."""
    t_min, t_max = 300, 1400
    t_melt_cu = 1358
    t_melt_zn = 693

    # Simplified Cu-Zn with α, β, γ phases and peritectic reaction
    # Key temperatures
    t_perit = 903  # Peritectic temperature for α + L -> β

    # Liquidus curve
    liquidus = [
        [0.0, t_melt_cu],
        [0.15, 1200],
        [0.30, 1050],
        [0.37, t_perit],  # Peritectic point
        [0.50, 850],
        [0.70, 750],
        [0.85, 710],
        [1.0, t_melt_zn],
    ]

    # Solvus curves
    solvus_alpha = [[0.35, t_perit], [0.32, 700], [0.30, t_min]]
    solvus_zn = [[0.97, t_melt_zn], [0.98, 500], [0.99, t_min]]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_zn],
                *reversed(liquidus),
                [0.0, t_melt_cu],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "alpha",
            "name": "α brass (FCC)",
            "vertices": [
                [0.0, t_melt_cu],
                [0.35, t_perit],
                *solvus_alpha[1:],
                [0.30, t_min],
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "beta",
            "name": "β/γ brass",
            "vertices": [
                [0.35, t_perit],
                [0.70, t_perit],
                [0.70, t_min],
                [0.30, t_min],
                *reversed(solvus_alpha[1:]),
            ],
            "color": PHASE_COLORS["bcc_a2"],
        },
        {
            "id": "eta",
            "name": "η (HCP Zn-rich)",
            "vertices": [
                [0.70, t_perit],
                [0.97, t_melt_zn],
                *solvus_zn[1:],
                [0.99, t_min],
                [0.70, t_min],
            ],
            "color": PHASE_COLORS["hcp_a3"],
        },
        {
            "id": "eta_zn",
            "name": "η + Zn",
            "vertices": [
                [0.97, t_melt_zn],
                [1.0, t_melt_zn],
                [1.0, t_min],
                [0.99, t_min],
                *reversed(solvus_zn[1:]),
            ],
            "color": PHASE_COLORS["two_phase_eta"],
        },
        {
            "id": "alpha_liquid",
            "name": "α + L",
            "vertices": [
                [0.0, t_melt_cu],
                [0.15, 1200],
                [0.30, 1050],
                [0.37, t_perit],
                [0.35, t_perit],
            ],
            "color": PHASE_COLORS["two_phase_fcc_liquid"],
        },
        {
            "id": "beta_liquid",
            "name": "β + L",
            "vertices": [
                [0.37, t_perit],
                [0.50, 850],
                [0.70, 750],
                [0.70, t_perit],
            ],
            "color": PHASE_COLORS["two_phase_bcc_liquid"],
        },
        {
            "id": "eta_liquid",
            "name": "η + L",
            "vertices": [
                [0.70, 750],
                [0.85, 710],
                [1.0, t_melt_zn],
                [0.97, t_melt_zn],
                [0.70, t_perit],
            ],
            "color": PHASE_COLORS["two_phase_ausn"],
        },
    ]

    boundaries = [
        {"id": "liquidus", "type": "liquidus", "points": liquidus},
        {"id": "solvus-alpha", "type": "solvus", "points": solvus_alpha},
        {"id": "solvus-zn", "type": "solvus", "points": solvus_zn},
        {
            "id": "peritectic",
            "type": "peritectic",
            "points": [[0.35, t_perit], [0.70, t_perit]],
        },
    ]

    special_points = [
        {
            "id": "peritectic",
            "type": "peritectic",
            "position": [0.37, t_perit],
            "label": "P",
        },
    ]

    return {
        "components": ["Cu", "Zn"],
        "temperature_range": [t_min, t_max],
        "temperature_unit": "K",
        "composition_unit": "mol%",
        "title": "Cu-Zn Binary Phase Diagram",
        "regions": regions,
        "boundaries": boundaries,
        "special_points": special_points,
    }


def create_fe_ni_diagram() -> PhaseDiagramData:
    """Create Fe-Ni binary phase diagram (isomorphous with magnetic transitions)."""
    t_min, t_max = 300, 1900
    t_melt_fe = 1811
    t_melt_ni = 1728
    t_curie_fe = 1043
    t_curie_ni = 631

    liquidus = [
        [0.0, t_melt_fe],
        [0.20, 1790],
        [0.40, 1770],
        [0.60, 1755],
        [0.80, 1740],
        [1.0, t_melt_ni],
    ]
    solidus = [
        [0.0, t_melt_fe],
        [0.20, 1770],
        [0.40, 1750],
        [0.60, 1735],
        [0.80, 1725],
        [1.0, t_melt_ni],
    ]

    # FCC/BCC transition (simplified)
    fcc_bcc = [
        [0.0, 1185],
        [0.05, 1100],
        [0.10, 1000],
        [0.15, 900],
        [0.20, 800],
        [0.25, 700],
        [0.30, 600],
        [0.35, 500],
        [0.40, t_min],
    ]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_ni],
                *reversed(liquidus),
                [0.0, t_melt_fe],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "fcc_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.0, t_melt_fe],
                *liquidus,
                [1.0, t_melt_ni],
                *reversed(solidus),
            ],
            "color": PHASE_COLORS["two_phase_fcc_alt"],
        },
        {
            "id": "fcc",
            "name": "γ (FCC)",
            "vertices": [
                [0.0, solidus[0][1]],
                *solidus,
                [1.0, t_min],
                [0.40, t_min],
                *reversed(fcc_bcc),
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "bcc",
            "name": "α (BCC)",
            "vertices": [
                [0.0, 1185],
                *fcc_bcc,
                [0.40, t_min],
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["bcc_a2"],
        },
    ]

    boundaries = [
        {"id": "liquidus", "type": "liquidus", "points": liquidus},
        {"id": "solidus", "type": "solidus", "points": solidus},
        {
            "id": "fcc-bcc",
            "type": "solvus",
            "points": fcc_bcc,
            "style": {"dash": "4,2"},
        },
    ]

    special_points = [
        {
            "id": "curie-fe",
            "type": "custom",
            "position": [0.0, t_curie_fe],
            "label": "Tc(Fe)",
        },
        {
            "id": "curie-ni",
            "type": "custom",
            "position": [1.0, t_curie_ni],
            "label": "Tc(Ni)",
        },
    ]

    return {
        "components": ["Fe", "Ni"],
        "temperature_range": [t_min, t_max],
        "temperature_unit": "K",
        "composition_unit": "mol%",
        "title": "Fe-Ni Binary Phase Diagram",
        "regions": regions,
        "boundaries": boundaries,
        "special_points": special_points,
    }


def create_pb_sn_diagram() -> PhaseDiagramData:
    """Create Pb-Sn binary phase diagram (classic eutectic)."""
    t_min, t_max = 300, 700
    t_melt_pb = 600
    t_melt_sn = 505
    t_eutectic = 456
    x_eutectic = 0.62

    liquidus_left = [
        [0.0, t_melt_pb],
        [0.15, 570],
        [0.30, 520],
        [0.45, 480],
        [x_eutectic, t_eutectic],
    ]
    liquidus_right = [
        [x_eutectic, t_eutectic],
        [0.75, 470],
        [0.85, 485],
        [0.95, 500],
        [1.0, t_melt_sn],
    ]

    solidus_pb = [[0.0, t_melt_pb], [0.05, 550], [0.15, 480], [0.19, t_eutectic]]
    solidus_sn = [[0.97, t_eutectic], [0.98, 480], [0.99, 495], [1.0, t_melt_sn]]
    solvus_pb = [[0.19, t_eutectic], [0.15, 400], [0.10, 350], [0.05, t_min]]
    solvus_sn = [[0.97, t_eutectic], [0.98, 400], [0.99, 350], [0.995, t_min]]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_sn],
                *reversed(liquidus_right),
                *reversed(liquidus_left),
                [0.0, t_melt_pb],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "fcc_pb",
            "name": "FCC (Pb)",
            "vertices": [
                [0.0, t_melt_pb],
                *solidus_pb,
                *solvus_pb,
                [0.05, t_min],
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "bct_sn",
            "name": "BCT (Sn)",
            "vertices": [
                [1.0, t_melt_sn],
                [1.0, t_min],
                [0.995, t_min],
                *reversed(solvus_sn),
                *reversed(solidus_sn),
            ],
            "color": PHASE_COLORS["hcp_a3"],
        },
        {
            "id": "pb_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.0, t_melt_pb],
                *liquidus_left,
                [x_eutectic, t_eutectic],
                [0.19, t_eutectic],
                *reversed(solidus_pb),
            ],
            "color": PHASE_COLORS["two_phase_fcc_liquid"],
        },
        {
            "id": "sn_liquid",
            "name": "BCT + L",
            "vertices": [
                [1.0, t_melt_sn],
                *solidus_sn,
                [0.97, t_eutectic],
                [x_eutectic, t_eutectic],
                *liquidus_right[1:],
            ],
            "color": PHASE_COLORS["two_phase_hcp_liquid"],
        },
        {
            "id": "pb_sn",
            "name": "FCC + BCT",
            "vertices": [
                [0.19, t_eutectic],
                [0.97, t_eutectic],
                *solvus_sn,
                [0.995, t_min],
                [0.05, t_min],
                *reversed(solvus_pb),
            ],
            "color": PHASE_COLORS["two_phase"],
        },
    ]

    boundaries = [
        {"id": "liquidus-left", "type": "liquidus", "points": liquidus_left},
        {"id": "liquidus-right", "type": "liquidus", "points": liquidus_right},
        {"id": "solidus-pb", "type": "solidus", "points": solidus_pb},
        {"id": "solidus-sn", "type": "solidus", "points": solidus_sn},
        {"id": "solvus-pb", "type": "solvus", "points": solvus_pb},
        {"id": "solvus-sn", "type": "solvus", "points": solvus_sn},
        {
            "id": "eutectic",
            "type": "eutectic",
            "points": [[0.19, t_eutectic], [0.97, t_eutectic]],
        },
    ]

    special_points = [
        {
            "id": "eutectic",
            "type": "eutectic",
            "position": [x_eutectic, t_eutectic],
            "label": "E",
        },
    ]

    return {
        "components": ["Pb", "Sn"],
        "temperature_range": [t_min, t_max],
        "temperature_unit": "K",
        "composition_unit": "mol%",
        "title": "Pb-Sn Binary Phase Diagram",
        "regions": regions,
        "boundaries": boundaries,
        "special_points": special_points,
    }


def validate_region(region: PhaseRegion, diagram_name: str) -> list[str]:
    """Validate a phase region and return list of warnings."""
    warnings = []
    vertices = region.get("vertices", [])
    name = region.get("name", region.get("id", "unknown"))

    if len(vertices) < 3:
        warnings.append(f"  {diagram_name}/{name}: polygon has < 3 vertices")

    if not region.get("color"):
        warnings.append(f"  {diagram_name}/{name}: missing color")

    return warnings


def save_diagram(data: dict, filename: str) -> None:
    """Save phase diagram data to gzipped JSON with validation."""
    diagram_name = Path(filename).stem.replace(".json", "")
    warnings = []

    for region in data.get("regions", []):
        region["vertices"] = dedupe_consecutive_vertices(region["vertices"])
        warnings.extend(validate_region(region, diagram_name))

    if warnings:
        print(f"  ⚠️  Warnings for {diagram_name}:")
        for warning in warnings:
            print(warning)

    with gzip.open(filename, "wt", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    n_regions = len(data.get("regions", []))
    n_boundaries = len(data.get("boundaries", []))
    print(f"  {filename}: {n_regions} regions, {n_boundaries} boundaries")


def main() -> None:
    """Generate all binary phase diagrams."""
    output_dir = Path(__file__).parent

    # Define all diagrams to generate
    diagrams = [
        ("Al-Cu", create_al_cu_diagram),
        ("Al-Fe", create_al_fe_diagram),
        ("Al-Mg", create_al_mg_diagram),
        ("Al-Si", create_al_si_diagram),
        ("Au-Sn", create_au_sn_diagram),
        ("Cu-Zn", create_cu_zn_diagram),
        ("Fe-Ni", create_fe_ni_diagram),
        ("Pb-Sn", create_pb_sn_diagram),
    ]

    print("Generating binary phase diagrams...")
    for name, create_fn in diagrams:
        data = create_fn()
        save_diagram(data, str(output_dir / f"{name}.json.gz"))

    print(
        f"\nDone! Generated {len(diagrams)} phase diagrams with complete regions and labels."
    )


if __name__ == "__main__":
    main()
