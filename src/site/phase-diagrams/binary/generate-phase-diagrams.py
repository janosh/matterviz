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
    "eutectic",
    "peritectic",
    "eutectoid",
    "peritectoid",
    "congruent",
    "melting_point",
    "custom",
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
    # Remove redundant closing vertex if polygon is explicitly closed
    if len(result) > 1 and result[0] == result[-1]:
        result.pop()
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
    """Create Al-Cu binary phase diagram with eutectic and peritectic reactions.

    The θ (Al₂Cu) phase forms via peritectic reaction: L + FCC(Cu) → θ
    at about 863K. Below the eutectic (821K), we have FCC(Al) + θ and θ + FCC(Cu).
    """
    t_min, t_max = 300, 1400
    t_melt_al = 933
    t_melt_cu = 1358
    t_eutectic = 821
    t_peritectic = 863  # θ forms peritectically

    # Liquidus curve with peritectic point
    liquidus_left = [
        [0.0, t_melt_al],
        [0.05, 900],
        [0.10, 860],
        [0.17, t_eutectic],  # Eutectic point
    ]
    liquidus_right = [
        [0.17, t_eutectic],
        [0.25, 900],
        [0.32, t_peritectic],  # Peritectic composition on liquidus
        [0.50, 1000],
        [0.70, 1150],
        [0.85, 1280],
        [1.0, t_melt_cu],
    ]

    # Solidus/solvus for Al-rich side
    solvus_al = [[0.05, t_eutectic], [0.03, 600], [0.02, t_min]]
    # Solidus for Cu-rich side (from melting point to peritectic)
    solidus_cu = [[0.88, t_peritectic], [0.92, 1000], [0.95, 1150], [1.0, t_melt_cu]]
    # Solvus for Cu-rich side (from peritectic to low temp)
    solvus_cu = [[0.88, t_peritectic], [0.90, 700], [0.92, 500], [0.95, t_min]]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_cu],
                *list(reversed(liquidus_right))[1:],
                *list(reversed(liquidus_left))[1:],
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
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "fcc_cu",
            "name": "FCC (Cu)",
            "vertices": [
                [1.0, t_melt_cu],
                *list(reversed(solidus_cu))[1:],
                *solvus_cu[1:],
                [1.0, t_min],
            ],
            "color": PHASE_COLORS["fcc_cu"],
        },
        {
            "id": "al_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.0, t_melt_al],
                *liquidus_left[1:],
                [0.05, t_eutectic],
            ],
            "color": PHASE_COLORS["two_phase_fcc_liquid"],
        },
        {
            "id": "cu_liquid",
            "name": "FCC + L",
            "vertices": [
                [1.0, t_melt_cu],
                *list(reversed(solidus_cu))[1:],
                [0.88, t_peritectic],
                [0.32, t_peritectic],
                *liquidus_right[2:],
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
                *list(reversed(solvus_al))[1:],
            ],
            "color": PHASE_COLORS["two_phase"],
        },
        {
            "id": "theta_cu",
            "name": "θ + FCC",
            "vertices": [
                [0.36, t_eutectic],
                [0.88, t_eutectic],
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
                [0.32, t_peritectic],
                [0.88, t_peritectic],
                [0.88, t_eutectic],
                [0.36, t_eutectic],
                [0.30, t_eutectic],
            ],
            "color": PHASE_COLORS["two_phase_theta_liquid"],
        },
    ]

    boundaries = [
        {"id": "liquidus-left", "type": "liquidus", "points": liquidus_left},
        {"id": "liquidus-right", "type": "liquidus", "points": liquidus_right},
        {"id": "solidus-cu", "type": "solidus", "points": solidus_cu},
        {"id": "solvus-al", "type": "solvus", "points": solvus_al},
        {"id": "solvus-cu", "type": "solvus", "points": solvus_cu},
        {
            "id": "eutectic",
            "type": "eutectic",
            "points": [[0.05, t_eutectic], [0.36, t_eutectic]],
        },
        {
            "id": "peritectic",
            "type": "peritectic",
            "points": [[0.32, t_peritectic], [0.88, t_peritectic]],
        },
    ]

    special_points = [
        {
            "id": "eutectic",
            "type": "eutectic",
            "position": [0.17, t_eutectic],
            "label": "E",
        },
        {
            "id": "peritectic",
            "type": "peritectic",
            "position": [0.32, t_peritectic],
            "label": "P",
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
                # Down solidus from melting to transition (skip first=melting)
                *list(reversed(solidus_fe))[1:],
                # Down solvus to bottom (skip first=shared transition point)
                *solvus_fe[1:],
                [1.0, t_min],
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
    """Create simplified Al-Mg binary phase diagram (eutectic system).

    This is a simplified diagram showing Al-Mg as a classic eutectic without
    intermetallic compounds. The real Al-Mg system has intermetallic phases
    (β = Al₃Mg₂, γ = Al₁₂Mg₁₇), but representing them properly requires
    careful treatment of line compounds and would make the diagram visually complex.

    For thermodynamic accuracy, compute the phase diagram from the Al-Mg.tdb file
    using pycalphad.
    """
    t_min, t_max = 300, 1100
    t_melt_al = 933
    t_melt_mg = 923
    t_eutectic = 710
    x_eutectic = 0.35  # Eutectic composition (mol% Mg)

    # Liquidus curves
    liquidus_left = [
        [0.0, t_melt_al],
        [0.10, 870],
        [0.20, 800],
        [x_eutectic, t_eutectic],
    ]
    liquidus_right = [
        [x_eutectic, t_eutectic],
        [0.50, 750],
        [0.65, 800],
        [0.80, 870],
        [1.0, t_melt_mg],
    ]

    # Solidus curves (phase boundaries between solid solutions and liquid)
    solidus_al = [[0.0, t_melt_al], [0.03, 850], [0.08, 780], [0.12, t_eutectic]]
    solidus_mg = [[0.88, t_eutectic], [0.92, 780], [0.96, 850], [1.0, t_melt_mg]]

    # Solvus curves (solid solubility limits below eutectic)
    solvus_al = [
        [0.12, t_eutectic],
        [0.10, 600],
        [0.07, 500],
        [0.04, 400],
        [0.02, t_min],
    ]
    solvus_mg = [
        [0.88, t_eutectic],
        [0.90, 600],
        [0.93, 500],
        [0.96, 400],
        [0.98, t_min],
    ]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_mg],
                *list(reversed(liquidus_right))[1:],
                *list(reversed(liquidus_left))[1:],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "fcc_al",
            "name": "α (FCC Al)",
            "vertices": [
                [0.0, t_melt_al],
                *solidus_al[1:],
                *solvus_al[1:],
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "hcp_mg",
            "name": "β (HCP Mg)",
            "vertices": [
                [1.0, t_melt_mg],
                *list(reversed(solidus_mg))[1:],
                *solvus_mg[1:],
                [1.0, t_min],
            ],
            "color": PHASE_COLORS["hcp_a3"],
        },
        {
            "id": "fcc_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.0, t_melt_al],
                *liquidus_left[1:],
                [0.12, t_eutectic],
                *list(reversed(solidus_al))[1:-1],
            ],
            "color": PHASE_COLORS["two_phase_fcc_liquid"],
        },
        {
            "id": "hcp_liquid",
            "name": "HCP + L",
            "vertices": [
                [1.0, t_melt_mg],
                *list(reversed(liquidus_right))[1:],
                [0.88, t_eutectic],
                *solidus_mg[1:-1],
            ],
            "color": PHASE_COLORS["two_phase_hcp_liquid"],
        },
        {
            "id": "fcc_hcp",
            "name": "FCC + HCP",
            "vertices": [
                [0.12, t_eutectic],
                [0.88, t_eutectic],
                *solvus_mg[1:],
                [1.0, t_min],
                [0.0, t_min],
                [0.02, t_min],
                *list(reversed(solvus_al))[1:-1],
            ],
            "color": PHASE_COLORS["two_phase"],
        },
    ]

    boundaries = [
        {
            "id": "liquidus-left",
            "type": "liquidus",
            "points": liquidus_left,
            "style": {"color": "#1565c0", "width": 2.5},
            "label": "Liquidus",
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
            "style": {"color": "#2e7d32", "width": 2, "dash": "4,2"},
        },
        {
            "id": "solidus-mg",
            "type": "solidus",
            "points": solidus_mg,
            "style": {"color": "#2e7d32", "width": 2, "dash": "4,2"},
        },
        {
            "id": "solvus-al",
            "type": "solvus",
            "points": solvus_al,
            "style": {"color": "#7b1fa2", "width": 1.5, "dash": "2,2"},
        },
        {
            "id": "solvus-mg",
            "type": "solvus",
            "points": solvus_mg,
            "style": {"color": "#7b1fa2", "width": 1.5, "dash": "2,2"},
        },
        {
            "id": "eutectic",
            "type": "eutectic",
            "points": [[0.12, t_eutectic], [0.88, t_eutectic]],
            "style": {"color": "#d32f2f", "width": 2},
        },
    ]

    special_points = [
        {
            "id": "eutectic",
            "type": "eutectic",
            "position": [x_eutectic, t_eutectic],
            "label": "E",
        },
        {
            "id": "melt-al",
            "type": "melting_point",
            "position": [0.0, t_melt_al],
            "label": "Tₘ(Al)",
        },
        {
            "id": "melt-mg",
            "type": "melting_point",
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
                [0.15, t_eutectic2],
                [0.20, t_eutectic2],
                [0.20, t_min],
                [0.15, t_min],
            ],
            "color": PHASE_COLORS["intermetallic"],
        },
        {
            "id": "ausn",
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
                [0.05, t_eutectic2],
                [0.15, t_eutectic2],
                [0.15, t_min],
                [0.02, t_min],
                *list(reversed(solvus_au))[1:],
            ],
            "color": PHASE_COLORS["two_phase_au_ausn"],
        },
        {
            "id": "au5sn_ausn",
            "name": "Au₅Sn + AuSn",
            "vertices": [
                [0.20, t_eutectic2],
                [0.45, t_eutectic2],
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
                [0.05, t_eutectic2],
                [0.05, t_eutectic1],
                [0.29, t_eutectic1],
                [0.50, 600],
                [0.70, 520],
                [0.78, t_eutectic2],
                [0.55, t_eutectic2],
                [0.45, t_eutectic2],
                [0.20, t_eutectic2],
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
    """Create Cu-Zn binary phase diagram (brass system - simplified peritectic).

    This simplified diagram shows the key phases in the brass system with proper
    two-phase regions between all single-phase regions to respect Gibbs phase rule.
    """
    t_min, t_max = 300, 1400
    t_melt_cu = 1358
    t_melt_zn = 693
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

    # Solidus curve for α (right edge of α phase)
    solidus_alpha = [[0.35, t_perit], [0.32, 700], [0.28, t_min]]
    # Solvus curve for β (left edge of β phase) - must be to right of solidus_alpha
    solvus_beta_left = [[0.40, t_perit], [0.38, 700], [0.35, t_min]]
    # Solvus curve for β (right edge of β phase)
    solvus_beta_right = [[0.65, t_perit], [0.63, 700], [0.60, t_min]]
    # Solvus curve for η (left edge of η phase)
    solvus_eta_left = [[0.70, t_perit], [0.72, 700], [0.75, t_min]]
    # Solvus curve for η (right edge, approaching pure Zn)
    solvus_eta_right = [[0.97, t_melt_zn], [0.98, 500], [0.99, t_min]]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_zn],
                *list(reversed(liquidus))[1:],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "alpha",
            "name": "α brass (FCC)",
            "vertices": [
                [0.0, t_melt_cu],
                *solidus_alpha,
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "alpha_beta",
            "name": "α + β",
            "vertices": [
                *solidus_alpha,
                [0.28, t_min],
                [0.35, t_min],
                *list(reversed(solvus_beta_left)),
            ],
            "color": PHASE_COLORS["two_phase"],
        },
        {
            "id": "beta",
            "name": "β/γ brass",
            "vertices": [
                *solvus_beta_left,
                [0.35, t_min],
                [0.60, t_min],
                *list(reversed(solvus_beta_right)),
            ],
            "color": PHASE_COLORS["bcc_a2"],
        },
        {
            "id": "beta_eta",
            "name": "β + η",
            "vertices": [
                *solvus_beta_right,
                [0.60, t_min],
                [0.75, t_min],
                *list(reversed(solvus_eta_left)),
            ],
            "color": PHASE_COLORS["two_phase_alt"],
        },
        {
            "id": "eta",
            "name": "η (HCP Zn-rich)",
            "vertices": [
                *solvus_eta_left,
                [0.75, t_min],
                [0.99, t_min],
                *list(reversed(solvus_eta_right)),
                [0.97, t_melt_zn],
            ],
            "color": PHASE_COLORS["hcp_a3"],
        },
        {
            "id": "eta_zn",
            "name": "η + Zn",
            "vertices": [
                [0.97, t_melt_zn],
                *solvus_eta_right[1:],
                [0.99, t_min],
                [1.0, t_min],
                [1.0, t_melt_zn],
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
                [0.40, t_perit],
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
        {"id": "solidus-alpha", "type": "solidus", "points": solidus_alpha},
        {"id": "solvus-beta-left", "type": "solvus", "points": solvus_beta_left},
        {"id": "solvus-beta-right", "type": "solvus", "points": solvus_beta_right},
        {"id": "solvus-eta-left", "type": "solvus", "points": solvus_eta_left},
        {"id": "solvus-eta-right", "type": "solvus", "points": solvus_eta_right},
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
    """Create Fe-Ni binary phase diagram (isomorphous with α+γ two-phase region).

    The Fe-Ni system has a γ-loop where BCC (α) is stable at low temperatures
    on the Fe-rich side. Between α and γ there must be a two-phase α+γ region
    to respect the Law of Adjoining Phase Regions.
    """
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

    # α/α+γ boundary (left edge of two-phase region, right edge of α phase)
    solvus_alpha = [
        [0.0, 1185],
        [0.03, 1100],
        [0.06, 1000],
        [0.09, 900],
        [0.12, 800],
        [0.15, 700],
        [0.18, 600],
        [0.21, 500],
        [0.24, 400],
        [0.27, t_min],
    ]
    # γ/α+γ boundary (right edge of two-phase region, left edge of γ phase)
    solvus_gamma = [
        [0.0, 1394],  # γ-loop top (A3 temperature)
        [0.08, 1200],
        [0.15, 1000],
        [0.22, 800],
        [0.29, 600],
        [0.36, 400],
        [0.43, t_min],
    ]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_melt_ni],
                *list(reversed(liquidus))[1:],
            ],
            "color": PHASE_COLORS["liquid"],
        },
        {
            "id": "fcc_liquid",
            "name": "FCC + L",
            "vertices": [
                [0.0, t_melt_fe],
                *liquidus[1:],
                [1.0, t_melt_ni],
                *list(reversed(solidus))[1:],
            ],
            "color": PHASE_COLORS["two_phase_fcc_alt"],
        },
        {
            "id": "fcc",
            "name": "γ (FCC)",
            "vertices": [
                [0.0, solidus[0][1]],
                *solidus[1:],
                [1.0, t_min],
                [0.43, t_min],
                *list(reversed(solvus_gamma))[1:],
                [0.0, 1394],
            ],
            "color": PHASE_COLORS["fcc_a1"],
        },
        {
            "id": "bcc_fcc",
            "name": "α + γ",
            "vertices": [
                [0.0, 1394],
                *solvus_gamma[1:],
                [0.43, t_min],
                [0.27, t_min],
                *list(reversed(solvus_alpha))[1:],
                [0.0, 1185],
            ],
            "color": PHASE_COLORS["two_phase"],
        },
        {
            "id": "bcc",
            "name": "α (BCC)",
            "vertices": [
                [0.0, 1185],
                *solvus_alpha[1:],
                [0.27, t_min],
                [0.0, t_min],
            ],
            "color": PHASE_COLORS["bcc_a2"],
        },
    ]

    boundaries = [
        {"id": "liquidus", "type": "liquidus", "points": liquidus},
        {"id": "solidus", "type": "solidus", "points": solidus},
        {
            "id": "solvus-alpha",
            "type": "solvus",
            "points": solvus_alpha,
            "style": {"dash": "4,2"},
        },
        {
            "id": "solvus-gamma",
            "type": "solvus",
            "points": solvus_gamma,
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
                # Trace down solidus from melting point to eutectic (skip first=melting point)
                *list(reversed(solidus_sn))[1:],
                # Trace down solvus from eutectic to bottom (skip first=eutectic point)
                *solvus_sn[1:],
                [1.0, t_min],
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
                # Down liquidus from melting to eutectic (skip first=melting point)
                *list(reversed(liquidus_right))[1:],
                # Right along eutectic to BCT solidus
                [0.97, t_eutectic],
                # Up solidus back toward melting (skip first=eutectic, last=melting)
                *solidus_sn[1:-1],
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
    """Validate a phase region and return list of warnings.

    Checks for:
    - Minimum vertex count (3 for valid polygon)
    - Missing color
    - Redundant closing vertex (first == last)
    - Self-intersecting edges (non-consecutive duplicate vertices)
    """
    warnings = []
    vertices = region.get("vertices", [])
    name = region.get("name", region.get("id", "unknown"))

    if len(vertices) < 3:
        warnings.append(f"  {diagram_name}/{name}: polygon has < 3 vertices")

    if not region.get("color"):
        warnings.append(f"  {diagram_name}/{name}: missing color")

    # Check for redundant closing vertex
    if len(vertices) > 1 and vertices[0] == vertices[-1]:
        warnings.append(
            f"  {diagram_name}/{name}: redundant closing vertex (first==last)"
        )

    # Check for non-consecutive duplicate vertices (potential self-intersection)
    seen: dict[tuple[float, float], int] = {}
    for idx, vtx in enumerate(vertices):
        key = (vtx[0], vtx[1])
        if key in seen and idx != seen[key] + 1:
            warnings.append(
                f"  {diagram_name}/{name}: duplicate vertex {vtx} at indices {seen[key]} and {idx}"
            )
        seen[key] = idx

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


def create_ab_example_diagram() -> PhaseDiagramData:
    """Create example A-B eutectic phase diagram for demonstration.

    This is a simplified didactic example showing a classic eutectic system with:
    - Two terminal solid solutions (α and β)
    - A eutectic point where L → α + β
    - Proper Gibbs phase rule compliance (3-phase equilibrium at single T)
    """
    t_min, t_max = 300, 900
    t_melt_a = 800
    t_melt_b = 750
    t_eutectic = 500

    # Liquidus curves
    liquidus_left = [
        [0, t_melt_a],
        [0.1, 700],
        [0.2, 600],
        [0.3, 530],
        [0.4, t_eutectic],
    ]
    liquidus_right = [
        [0.4, t_eutectic],
        [0.5, 530],
        [0.6, 580],
        [0.7, 630],
        [0.8, 680],
        [0.9, 720],
        [1, t_melt_b],
    ]

    # Solidus curves (α and β phase boundaries with liquid)
    solidus_alpha = [[0, t_melt_a], [0.05, 700], [0.1, 600], [0.15, t_eutectic]]
    solidus_beta = [[0.7, t_eutectic], [0.8, 580], [0.9, 660], [1, t_melt_b]]

    # Solvus curves (α and β phase boundaries below eutectic)
    solvus_alpha = [[0.15, t_eutectic], [0.12, 450], [0.1, 400], [0.08, t_min]]
    solvus_beta = [[0.7, t_eutectic], [0.75, 450], [0.8, 400], [0.85, t_min]]

    regions = [
        {
            "id": "liquid",
            "name": "Liquid",
            "vertices": [
                [0, t_max],
                [1, t_max],
                [1, t_melt_b],
                *list(reversed(liquidus_right))[1:],
                *list(reversed(liquidus_left))[1:],
            ],
            "color": rgba(100, 149, 237),
        },
        {
            "id": "alpha",
            "name": "α",
            "vertices": [
                [0, t_melt_a],
                *solidus_alpha[1:],
                *solvus_alpha[1:],
                [0, t_min],
            ],
            "color": rgba(144, 238, 144, 0.7),
        },
        {
            "id": "beta",
            "name": "β",
            "vertices": [
                [1, t_melt_b],
                # Down solidus from melting to eutectic (skip first=melting)
                *list(reversed(solidus_beta))[1:],
                # Down solvus to bottom (skip first=eutectic point)
                *solvus_beta[1:],
                [1, t_min],
            ],
            "color": rgba(255, 182, 193, 0.7),
        },
        {
            "id": "alpha-liquid",
            "name": "α + L",
            "vertices": [
                [0, t_melt_a],
                *liquidus_left[1:],
                [0.15, t_eutectic],
                *list(reversed(solidus_alpha))[1:-1],
            ],
            "color": rgba(140, 200, 140, 0.5),
            "label_position": [0.12, 650],
        },
        {
            "id": "beta-liquid",
            "name": "β + L",
            "vertices": [
                [1, t_melt_b],
                *list(reversed(liquidus_right))[1:],
                [0.7, t_eutectic],
                *solidus_beta[1:-1],
            ],
            "color": rgba(200, 140, 160, 0.5),
            "label_position": [0.75, 620],
        },
        {
            "id": "alpha-beta",
            "name": "α + β",
            "vertices": [
                [0.15, t_eutectic],
                [0.7, t_eutectic],
                *solvus_beta[1:],
                [1, t_min],
                [0, t_min],
                [0.08, t_min],
                *list(reversed(solvus_alpha))[1:-1],
            ],
            "color": rgba(200, 200, 200, 0.5),
        },
    ]

    boundary_style_liquidus = {"color": "#1565c0", "width": 2.5}
    boundary_style_solidus = {"color": "#2e7d32", "width": 2, "dash": "4,2"}
    boundary_style_solvus = {"color": "#7b1fa2", "width": 1.5, "dash": "2,2"}
    boundary_style_eutectic = {"color": "#d32f2f", "width": 2}

    boundaries = [
        {
            "id": "liquidus-left",
            "type": "liquidus",
            "points": liquidus_left,
            "style": boundary_style_liquidus,
            "label": "Liquidus",
        },
        {
            "id": "liquidus-right",
            "type": "liquidus",
            "points": liquidus_right,
            "style": boundary_style_liquidus,
        },
        {
            "id": "solidus-alpha",
            "type": "solidus",
            "points": solidus_alpha,
            "style": boundary_style_solidus,
            "label": "Solidus",
        },
        {
            "id": "solidus-beta",
            "type": "solidus",
            "points": solidus_beta,
            "style": boundary_style_solidus,
        },
        {
            "id": "solvus-alpha",
            "type": "solvus",
            "points": solvus_alpha,
            "style": boundary_style_solvus,
            "label": "Solvus",
        },
        {
            "id": "solvus-beta",
            "type": "solvus",
            "points": solvus_beta,
            "style": boundary_style_solvus,
        },
        {
            "id": "eutectic-line",
            "type": "eutectic",
            "points": [[0.15, t_eutectic], [0.7, t_eutectic]],
            "style": boundary_style_eutectic,
        },
    ]

    special_points = [
        make_special_point("eutectic", "eutectic", [0.4, t_eutectic], "E"),
        make_special_point("melting-a", "melting_point", [0, t_melt_a], "Tₘ(A)"),
        make_special_point("melting-b", "melting_point", [1, t_melt_b], "Tₘ(B)"),
    ]

    return {
        "components": ["A", "B"],
        "temperature_range": [t_min, t_max],
        "temperature_unit": "K",
        "composition_unit": "at%",
        "title": "Example A-B Eutectic Phase Diagram",
        "regions": regions,
        "boundaries": boundaries,
        "special_points": special_points,
    }


def create_fe_fe3c_diagram() -> PhaseDiagramData:
    """Create Fe-Fe3C (iron-cementite) pseudo-binary phase diagram.

    This is the classic metastable iron-carbon diagram, which is actually a
    pseudo-binary section through the Fe-C system from pure Fe to the compound Fe3C.

    Key features:
    - Peritectic at ~1495°C: L + δ → γ
    - Eutectic at ~1147°C: L → γ + Fe3C (ledeburite)
    - Eutectoid at ~727°C: γ → α + Fe3C (pearlite)

    Note: Composition is normalized 0-1 where 0=Fe and 1=Fe3C (6.67 wt% C).
    """
    t_min, t_max = 400, 1600
    t_melt_fe = 1538  # Fe melting point
    t_peritectic = 1495  # δ + L → γ
    t_eutectic = 1147  # L → γ + Fe3C
    t_eutectoid = 727  # γ → α + Fe3C
    t_a3 = 912  # α → γ transformation in pure Fe
    t_a4 = 1394  # γ → δ transformation in pure Fe

    # Composition points (normalized to 0-1 scale, where 1 = Fe3C = 6.67 wt% C)
    x_peritectic_l = 0.077  # 0.51 wt% C / 6.67
    x_peritectic_delta = 0.015  # 0.10 wt% C / 6.67
    x_peritectic_gamma = 0.024  # 0.16 wt% C / 6.67
    x_eutectic = 0.645  # 4.3 wt% C / 6.67
    x_eutectic_gamma = 0.32  # 2.14 wt% C / 6.67
    x_eutectoid = 0.115  # 0.77 wt% C / 6.67
    x_eutectoid_alpha = 0.003  # 0.02 wt% C / 6.67

    # Solvus line (α/α+Fe3C boundary)
    gamma_solvus_left = [
        [x_eutectoid_alpha, t_eutectoid],
        [0.001, 600],
        [0.0, t_min],
    ]

    regions = [
        # Liquid region
        make_region(
            "liquid",
            "Liquid",
            dedupe_consecutive_vertices([
                [0.0, t_max],
                [1.0, t_max],
                [1.0, t_eutectic],
                [x_eutectic, t_eutectic],
                [x_peritectic_l, t_peritectic],
                [0.0, t_melt_fe],
            ]),
            PHASE_COLORS["liquid"],
        ),
        # δ-ferrite (BCC, high temp)
        make_region(
            "delta",
            "δ (BCC)",
            dedupe_consecutive_vertices([
                [0.0, t_melt_fe],
                [x_peritectic_delta, t_peritectic],
                [0.0, t_a4],
            ]),
            PHASE_COLORS["bcc_a2"],
        ),
        # γ-austenite (FCC)
        make_region(
            "gamma",
            "γ (FCC)",
            dedupe_consecutive_vertices([
                [0.0, t_a4],
                [x_peritectic_gamma, t_peritectic],
                [x_eutectic_gamma, t_eutectic],
                [x_eutectoid, t_eutectoid],
                [x_eutectoid_alpha, t_eutectoid],
                [0.0, t_a3],
            ]),
            PHASE_COLORS["fcc_a1"],
        ),
        # α-ferrite (BCC, low temp)
        make_region(
            "alpha",
            "α (BCC)",
            dedupe_consecutive_vertices([
                [0.0, t_a3],
                *gamma_solvus_left,
                [0.0, t_min],
            ]),
            rgba(255, 200, 200),  # Light pink for α
        ),
        # Fe3C (cementite) - appears at right edge
        make_region(
            "fe3c",
            "Fe3C",
            dedupe_consecutive_vertices([
                [1.0, t_eutectic],
                [1.0, t_min],
                [0.95, t_min],
                [0.95, t_eutectic],
            ]),
            rgba(180, 180, 200),  # Grayish for cementite
        ),
        # L + δ two-phase region
        make_region(
            "l_plus_delta",
            "L + δ",
            dedupe_consecutive_vertices([
                [0.0, t_melt_fe],
                [x_peritectic_l, t_peritectic],
                [x_peritectic_delta, t_peritectic],
            ]),
            PHASE_COLORS["two_phase_bcc_liquid"],
        ),
        # L + γ two-phase region
        make_region(
            "l_plus_gamma",
            "L + γ",
            dedupe_consecutive_vertices([
                [x_peritectic_l, t_peritectic],
                [x_eutectic, t_eutectic],
                [x_eutectic_gamma, t_eutectic],
                [x_peritectic_gamma, t_peritectic],
            ]),
            PHASE_COLORS["two_phase_fcc_liquid"],
        ),
        # L + Fe3C two-phase region
        make_region(
            "l_plus_fe3c",
            "L + Fe3C",
            dedupe_consecutive_vertices([
                [x_eutectic, t_eutectic],
                [1.0, t_eutectic],
                [0.95, t_eutectic],
            ]),
            PHASE_COLORS["two_phase_intermetallic"],
        ),
        # γ + Fe3C two-phase region
        make_region(
            "gamma_plus_fe3c",
            "γ + Fe3C",
            dedupe_consecutive_vertices([
                [x_eutectic_gamma, t_eutectic],
                [0.95, t_eutectic],
                [0.95, t_eutectoid],
                [x_eutectoid, t_eutectoid],
            ]),
            PHASE_COLORS["two_phase_gamma"],
        ),
        # α + γ two-phase region
        make_region(
            "alpha_plus_gamma",
            "α + γ",
            dedupe_consecutive_vertices([
                [0.0, t_a3],
                [x_eutectoid_alpha, t_eutectoid],
                [x_eutectoid, t_eutectoid],
                [0.0, t_a4],  # Approximate - simplified
            ]),
            PHASE_COLORS["two_phase_mixed"],
        ),
        # α + Fe3C two-phase region (pearlite region)
        make_region(
            "alpha_plus_fe3c",
            "α + Fe3C",
            dedupe_consecutive_vertices([
                *gamma_solvus_left[1:],
                [0.18, t_min],
                [0.95, t_min],
                [0.95, t_eutectoid],
                [x_eutectoid, t_eutectoid],
                [x_eutectoid_alpha, t_eutectoid],
            ]),
            PHASE_COLORS["two_phase_alt"],
        ),
    ]

    boundary_style = {"color": "#333", "width": 2}
    boundary_style_horizontal = {"color": "#666", "width": 1.5, "dash": "4"}

    boundaries = [
        # Liquidus
        make_boundary(
            "liquidus-left",
            "liquidus",
            [[0.0, t_melt_fe], [x_peritectic_l, t_peritectic]],
            boundary_style,
        ),
        make_boundary(
            "liquidus-right",
            "liquidus",
            [[x_peritectic_l, t_peritectic], [x_eutectic, t_eutectic], [1.0, t_eutectic]],
            boundary_style,
        ),
        # Solidus
        make_boundary(
            "solidus-delta",
            "solidus",
            [[0.0, t_melt_fe], [x_peritectic_delta, t_peritectic]],
            boundary_style,
        ),
        make_boundary(
            "solidus-gamma",
            "solidus",
            [[x_peritectic_gamma, t_peritectic], [x_eutectic_gamma, t_eutectic]],
            boundary_style,
        ),
        # Peritectic horizontal
        make_boundary(
            "peritectic-line",
            "peritectic",
            [[x_peritectic_delta, t_peritectic], [x_peritectic_l, t_peritectic]],
            boundary_style_horizontal,
        ),
        # Eutectic horizontal
        make_boundary(
            "eutectic-line",
            "eutectic",
            [[x_eutectic_gamma, t_eutectic], [1.0, t_eutectic]],
            boundary_style_horizontal,
        ),
        # Eutectoid horizontal
        make_boundary(
            "eutectoid-line",
            "custom",
            [[x_eutectoid_alpha, t_eutectoid], [0.95, t_eutectoid]],
            boundary_style_horizontal,
        ),
        # A3 transformation line
        make_boundary(
            "a3-line",
            "solvus",
            [[0.0, t_a3], [x_eutectoid_alpha, t_eutectoid]],
            boundary_style,
        ),
    ]

    special_points = [
        make_special_point("peritectic", "peritectic", [x_peritectic_l, t_peritectic], "P"),
        make_special_point("eutectic", "eutectic", [x_eutectic, t_eutectic], "E"),
        make_special_point("eutectoid", "eutectoid", [x_eutectoid, t_eutectoid], "S"),
        make_special_point("melting-fe", "melting_point", [0, t_melt_fe], "Tₘ"),
    ]

    return {
        "components": ["Fe", "Fe3C"],
        "temperature_range": [t_min, t_max],
        "temperature_unit": "°C",
        "composition_unit": "wt%",
        "title": "Fe-Fe₃C Pseudo-Binary Phase Diagram",
        "regions": regions,
        "boundaries": boundaries,
        "special_points": special_points,
        # Pseudo-binary metadata
        "pseudo_binary": {
            "parent_system": ["Fe", "C"],
            "section_description": "Metastable iron-cementite section (0 to 6.67 wt% C)",
            "use_subscripts": True,
        },
        "x_axis_label": "wt% C (as Fe<sub>3</sub>C)",
    }


def main() -> None:
    """Generate all binary phase diagrams."""
    output_dir = Path(__file__).parent

    # Define all diagrams to generate
    diagrams = [
        ("A-B", create_ab_example_diagram),
        ("Al-Cu", create_al_cu_diagram),
        ("Al-Fe", create_al_fe_diagram),
        ("Al-Mg", create_al_mg_diagram),
        ("Al-Si", create_al_si_diagram),
        ("Au-Sn", create_au_sn_diagram),
        ("Cu-Zn", create_cu_zn_diagram),
        ("Fe-Fe3C", create_fe_fe3c_diagram),  # Pseudo-binary example
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
