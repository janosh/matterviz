"""Generate ternary phase diagram JSON files using pycalphad.

This script creates ternary phase diagram data using the stacked isothermal slices approach.
It calculates phase equilibria at multiple temperatures to build a 3D representation of the
phase diagram prism.

Uses pycalphad's TernaryStrategy for phase boundary calculation and exports data in
a format suitable for visualization in IsobaricTernaryPhaseDiagram.svelte.
"""

from __future__ import annotations

import gzip
import json
import os
from pathlib import Path
from typing import Any, TypeAlias

import numpy as np

# Phase colors matching frontend PHASE_COLOR_HEX
PHASE_COLORS: dict[str, str] = {
    "LIQUID": "#87ceeb",
    "FCC_A1": "#90ee90",
    "FCC": "#90ee90",
    "BCC_A2": "#ffb6c1",
    "BCC": "#ffb6c1",
    "HCP_A3": "#add8e6",
    "HCP": "#add8e6",
    "L12_FCC": "#ffa07a",
    "B2": "#dda0dd",
    "SIGMA": "#ffd700",
    "LAVES": "#98fb98",
    "DEFAULT": "#c8c8c8",
}

TernaryComposition: TypeAlias = tuple[float, float, float]
TernaryVertex: TypeAlias = tuple[float, float, float, float]  # [comp_A, comp_B, comp_C, T]


def get_phase_color(phase_name: str) -> str:
    """Get color for a phase name, with fallback to default."""
    # Try exact match
    if phase_name in PHASE_COLORS:
        return PHASE_COLORS[phase_name]
    # Try uppercase
    upper = phase_name.upper()
    if upper in PHASE_COLORS:
        return PHASE_COLORS[upper]
    # Try partial match
    for key, color in PHASE_COLORS.items():
        if key in upper or upper in key:
            return color
    return PHASE_COLORS["DEFAULT"]


def create_schematic_ternary_eutectic(
    components: tuple[str, str, str],
    t_min: float,
    t_max: float,
    title: str,
) -> dict[str, Any]:
    """Create a schematic ternary eutectic phase diagram with proper space-filling regions.

    This creates a simplified but visually correct ternary phase diagram with:
    - Liquid phase at high temperatures
    - Three solid solution phases (α, β, γ) at the corners
    - Two-phase regions along the edges
    - A ternary eutectic point in the center

    Args:
        components: Tuple of three component names (e.g., ("A", "B", "C"))
        t_min: Minimum temperature (K)
        t_max: Maximum temperature (K)
        title: Title for the phase diagram

    Returns:
        Dictionary with TernaryPhaseDiagramData structure
    """
    # Key temperatures
    t_melt_a = t_max - 100  # Melting point of A
    t_melt_b = t_max - 150  # Melting point of B
    t_melt_c = t_max - 200  # Melting point of C
    t_eutectic = t_min + (t_max - t_min) * 0.35  # Ternary eutectic temperature

    # Eutectic composition (near center)
    eutectic_comp = (0.33, 0.33, 0.34)

    # Build regions as 3D polyhedra
    regions = []

    # 1. Liquid region - dome at the top
    # Vertices form the liquidus surface from melting points down to eutectic
    liquid_vertices: list[TernaryVertex] = [
        # Top of prism (pure liquid at max temp)
        (1.0, 0.0, 0.0, t_max),
        (0.0, 1.0, 0.0, t_max),
        (0.0, 0.0, 1.0, t_max),
        # Melting points at corners
        (1.0, 0.0, 0.0, t_melt_a),
        (0.0, 1.0, 0.0, t_melt_b),
        (0.0, 0.0, 1.0, t_melt_c),
        # Binary eutectic troughs
        (0.5, 0.5, 0.0, t_eutectic + 50),
        (0.5, 0.0, 0.5, t_eutectic + 50),
        (0.0, 0.5, 0.5, t_eutectic + 50),
        # Ternary eutectic point
        (*eutectic_comp, t_eutectic),
    ]
    # Faces of liquid region polyhedron
    liquid_faces = [
        # Top triangle
        [0, 1, 2],
        # Side faces from top to melting points
        [0, 3, 4, 1],
        [1, 4, 5, 2],
        [2, 5, 3, 0],
        # Liquidus surface down to binary eutectics
        [3, 6, 4],
        [4, 8, 5],
        [5, 7, 3],
        # Liquidus surface down to ternary eutectic
        [6, 9, 8, 4],
        [8, 9, 7, 5],
        [7, 9, 6, 3],
        # Bottom of liquid dome (at eutectic)
        [6, 8, 9],
        [8, 7, 9],
        [7, 6, 9],
    ]
    regions.append({
        "id": "liquid",
        "name": "Liquid",
        "vertices": liquid_vertices,
        "faces": liquid_faces,
        "color": PHASE_COLORS["LIQUID"],
    })

    # 2. Alpha phase (A-rich corner solid solution)
    alpha_vertices: list[TernaryVertex] = [
        # Corner at all temperatures
        (1.0, 0.0, 0.0, t_melt_a),
        (1.0, 0.0, 0.0, t_min),
        # Solvus boundary (shrinks with temperature)
        (0.8, 0.2, 0.0, t_melt_a),
        (0.8, 0.0, 0.2, t_melt_a),
        (0.9, 0.1, 0.0, t_min),
        (0.9, 0.0, 0.1, t_min),
        # Points at eutectic temperature
        (0.85, 0.15, 0.0, t_eutectic),
        (0.85, 0.0, 0.15, t_eutectic),
        (0.7, 0.15, 0.15, t_eutectic),
        (0.75, 0.125, 0.125, t_min),
    ]
    alpha_faces = [
        # Top (at melting point)
        [0, 2, 3],
        # Bottom (at min temp)
        [1, 5, 4],
        [1, 4, 9, 5],
        # Sides
        [0, 3, 7, 6, 2],
        [2, 6, 4],
        [3, 5, 7],
        # Inner boundary
        [6, 7, 8],
        [6, 8, 9, 4],
        [7, 5, 9, 8],
    ]
    regions.append({
        "id": "alpha",
        "name": f"α ({components[0]}-rich)",
        "vertices": alpha_vertices,
        "faces": alpha_faces,
        "color": PHASE_COLORS["FCC_A1"],
    })

    # 3. Beta phase (B-rich corner solid solution)
    beta_vertices: list[TernaryVertex] = [
        (0.0, 1.0, 0.0, t_melt_b),
        (0.0, 1.0, 0.0, t_min),
        (0.2, 0.8, 0.0, t_melt_b),
        (0.0, 0.8, 0.2, t_melt_b),
        (0.1, 0.9, 0.0, t_min),
        (0.0, 0.9, 0.1, t_min),
        (0.15, 0.85, 0.0, t_eutectic),
        (0.0, 0.85, 0.15, t_eutectic),
        (0.15, 0.7, 0.15, t_eutectic),
        (0.125, 0.75, 0.125, t_min),
    ]
    beta_faces = [
        [0, 3, 2],
        [1, 4, 5],
        [1, 5, 9, 4],
        [0, 2, 6, 7, 3],
        [2, 4, 6],
        [3, 7, 5],
        [6, 8, 7],
        [6, 4, 9, 8],
        [7, 8, 9, 5],
    ]
    regions.append({
        "id": "beta",
        "name": f"β ({components[1]}-rich)",
        "vertices": beta_vertices,
        "faces": beta_faces,
        "color": PHASE_COLORS["BCC_A2"],
    })

    # 4. Gamma phase (C-rich corner solid solution)
    gamma_vertices: list[TernaryVertex] = [
        (0.0, 0.0, 1.0, t_melt_c),
        (0.0, 0.0, 1.0, t_min),
        (0.2, 0.0, 0.8, t_melt_c),
        (0.0, 0.2, 0.8, t_melt_c),
        (0.1, 0.0, 0.9, t_min),
        (0.0, 0.1, 0.9, t_min),
        (0.15, 0.0, 0.85, t_eutectic),
        (0.0, 0.15, 0.85, t_eutectic),
        (0.15, 0.15, 0.7, t_eutectic),
        (0.125, 0.125, 0.75, t_min),
    ]
    gamma_faces = [
        [0, 2, 3],
        [1, 5, 4],
        [1, 4, 9, 5],
        [0, 3, 7, 6, 2],
        [2, 6, 4],
        [3, 5, 7],
        [6, 7, 8],
        [6, 8, 9, 4],
        [7, 5, 9, 8],
    ]
    regions.append({
        "id": "gamma",
        "name": f"γ ({components[2]}-rich)",
        "vertices": gamma_vertices,
        "faces": gamma_faces,
        "color": PHASE_COLORS["HCP_A3"],
    })

    # 5-7. Two-phase regions along the three edges
    # These fill the space between the liquidus and the solid solution phases

    # α + L (A-B edge, A-rich side)
    alpha_liquid_vertices: list[TernaryVertex] = [
        # Along A-B edge
        (0.8, 0.2, 0.0, t_melt_a),
        (0.5, 0.5, 0.0, t_eutectic + 50),
        (0.85, 0.15, 0.0, t_eutectic),
        # Down to eutectic temperature
        (0.7, 0.3, 0.0, t_eutectic),
        # Into the ternary
        (0.8, 0.0, 0.2, t_melt_a),
        (0.5, 0.0, 0.5, t_eutectic + 50),
        (0.85, 0.0, 0.15, t_eutectic),
        (0.7, 0.0, 0.3, t_eutectic),
        (*eutectic_comp, t_eutectic),
        (0.7, 0.15, 0.15, t_eutectic),
    ]
    alpha_liquid_faces = [
        [0, 1, 3, 2],
        [4, 6, 7, 5],
        [0, 4, 5, 1],
        [2, 3, 7, 6],
        [1, 5, 8, 3],
        [3, 8, 7],
        [2, 6, 9],
        [3, 9, 2],
        [3, 8, 9],
        [6, 7, 8, 9],
    ]
    regions.append({
        "id": "alpha_liquid",
        "name": "α + L",
        "vertices": alpha_liquid_vertices,
        "faces": alpha_liquid_faces,
        "color": "#b8e0b8",  # Light green (mix of α and liquid)
    })

    # β + L (B-rich side)
    beta_liquid_vertices: list[TernaryVertex] = [
        (0.2, 0.8, 0.0, t_melt_b),
        (0.5, 0.5, 0.0, t_eutectic + 50),
        (0.15, 0.85, 0.0, t_eutectic),
        (0.3, 0.7, 0.0, t_eutectic),
        (0.0, 0.8, 0.2, t_melt_b),
        (0.0, 0.5, 0.5, t_eutectic + 50),
        (0.0, 0.85, 0.15, t_eutectic),
        (0.0, 0.7, 0.3, t_eutectic),
        (*eutectic_comp, t_eutectic),
        (0.15, 0.7, 0.15, t_eutectic),
    ]
    beta_liquid_faces = [
        [0, 2, 3, 1],
        [4, 5, 7, 6],
        [0, 1, 5, 4],
        [2, 6, 7, 3],
        [1, 3, 8, 5],
        [3, 7, 8],
        [2, 9, 6],
        [3, 2, 9],
        [3, 9, 8],
        [6, 9, 8, 7],
    ]
    regions.append({
        "id": "beta_liquid",
        "name": "β + L",
        "vertices": beta_liquid_vertices,
        "faces": beta_liquid_faces,
        "color": "#ffd0d8",  # Light pink (mix of β and liquid)
    })

    # γ + L (C-rich side)
    gamma_liquid_vertices: list[TernaryVertex] = [
        (0.2, 0.0, 0.8, t_melt_c),
        (0.5, 0.0, 0.5, t_eutectic + 50),
        (0.15, 0.0, 0.85, t_eutectic),
        (0.3, 0.0, 0.7, t_eutectic),
        (0.0, 0.2, 0.8, t_melt_c),
        (0.0, 0.5, 0.5, t_eutectic + 50),
        (0.0, 0.15, 0.85, t_eutectic),
        (0.0, 0.3, 0.7, t_eutectic),
        (*eutectic_comp, t_eutectic),
        (0.15, 0.15, 0.7, t_eutectic),
    ]
    gamma_liquid_faces = [
        [0, 1, 3, 2],
        [4, 6, 7, 5],
        [0, 4, 5, 1],
        [2, 3, 7, 6],
        [1, 5, 8, 3],
        [3, 8, 7],
        [2, 6, 9],
        [3, 2, 9],
        [3, 9, 8],
        [6, 7, 8, 9],
    ]
    regions.append({
        "id": "gamma_liquid",
        "name": "γ + L",
        "vertices": gamma_liquid_vertices,
        "faces": gamma_liquid_faces,
        "color": "#c8e0f0",  # Light blue (mix of γ and liquid)
    })

    # 8-10. Three-phase regions below eutectic (α + β, β + γ, α + γ)
    # These extend from the eutectic temperature down to t_min

    # α + β region (along A-B edge)
    alpha_beta_vertices: list[TernaryVertex] = [
        (0.85, 0.15, 0.0, t_eutectic),
        (0.15, 0.85, 0.0, t_eutectic),
        (0.9, 0.1, 0.0, t_min),
        (0.1, 0.9, 0.0, t_min),
        # Into the center
        (0.7, 0.15, 0.15, t_eutectic),
        (0.15, 0.7, 0.15, t_eutectic),
        (0.75, 0.125, 0.125, t_min),
        (0.125, 0.75, 0.125, t_min),
        (*eutectic_comp[:2], 0.01, t_eutectic),  # Thin slice at eutectic
        (0.4, 0.4, 0.2, t_min),  # Center of α + β region at bottom
    ]
    alpha_beta_faces = [
        [0, 1, 5, 4],
        [2, 6, 7, 3],
        [0, 2, 3, 1],
        [4, 5, 7, 6],
        [0, 4, 6, 2],
        [1, 3, 7, 5],
        [4, 5, 9, 6],
        [5, 7, 9],
        [6, 9, 7],
    ]
    regions.append({
        "id": "alpha_beta",
        "name": "α + β",
        "vertices": alpha_beta_vertices,
        "faces": alpha_beta_faces,
        "color": "#e8d8e0",  # Mix of α and β colors
    })

    # β + γ region (along B-C edge)
    beta_gamma_vertices: list[TernaryVertex] = [
        (0.0, 0.85, 0.15, t_eutectic),
        (0.0, 0.15, 0.85, t_eutectic),
        (0.0, 0.9, 0.1, t_min),
        (0.0, 0.1, 0.9, t_min),
        (0.15, 0.7, 0.15, t_eutectic),
        (0.15, 0.15, 0.7, t_eutectic),
        (0.125, 0.75, 0.125, t_min),
        (0.125, 0.125, 0.75, t_min),
        (0.4, 0.4, 0.2, t_min),
        (0.2, 0.4, 0.4, t_min),
    ]
    beta_gamma_faces = [
        [0, 4, 5, 1],
        [2, 3, 7, 6],
        [0, 1, 3, 2],
        [4, 6, 7, 5],
        [0, 2, 6, 4],
        [1, 5, 7, 3],
        [4, 6, 8, 9, 5],
        [5, 9, 7],
        [6, 7, 9, 8],
    ]
    regions.append({
        "id": "beta_gamma",
        "name": "β + γ",
        "vertices": beta_gamma_vertices,
        "faces": beta_gamma_faces,
        "color": "#d8d0e8",  # Mix of β and γ colors
    })

    # α + γ region (along A-C edge)
    alpha_gamma_vertices: list[TernaryVertex] = [
        (0.85, 0.0, 0.15, t_eutectic),
        (0.15, 0.0, 0.85, t_eutectic),
        (0.9, 0.0, 0.1, t_min),
        (0.1, 0.0, 0.9, t_min),
        (0.7, 0.15, 0.15, t_eutectic),
        (0.15, 0.15, 0.7, t_eutectic),
        (0.75, 0.125, 0.125, t_min),
        (0.125, 0.125, 0.75, t_min),
        (0.4, 0.2, 0.4, t_min),
        (0.2, 0.4, 0.4, t_min),
    ]
    alpha_gamma_faces = [
        [0, 1, 5, 4],
        [2, 6, 7, 3],
        [0, 2, 3, 1],
        [4, 5, 7, 6],
        [0, 4, 6, 2],
        [1, 3, 7, 5],
        [4, 5, 9, 8, 6],
        [5, 7, 9],
        [6, 8, 9, 7],
    ]
    regions.append({
        "id": "alpha_gamma",
        "name": "α + γ",
        "vertices": alpha_gamma_vertices,
        "faces": alpha_gamma_faces,
        "color": "#b8e8d8",  # Mix of α and γ colors
    })

    # 11. Three-phase region (α + β + γ) at center below eutectic
    three_phase_vertices: list[TernaryVertex] = [
        # At eutectic temperature
        (0.7, 0.15, 0.15, t_eutectic),
        (0.15, 0.7, 0.15, t_eutectic),
        (0.15, 0.15, 0.7, t_eutectic),
        (*eutectic_comp, t_eutectic),
        # At minimum temperature
        (0.75, 0.125, 0.125, t_min),
        (0.125, 0.75, 0.125, t_min),
        (0.125, 0.125, 0.75, t_min),
        (eutectic_comp[0], eutectic_comp[1], eutectic_comp[2], t_min),
    ]
    three_phase_faces = [
        # Top (at eutectic)
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
        # Bottom (at min temp)
        [4, 7, 5],
        [5, 7, 6],
        [6, 7, 4],
        # Sides
        [0, 4, 5, 1],
        [1, 5, 6, 2],
        [2, 6, 4, 0],
    ]
    regions.append({
        "id": "three_phase",
        "name": "α + β + γ",
        "vertices": three_phase_vertices,
        "faces": three_phase_faces,
        "color": "#d0d0d0",  # Gray for three-phase region
    })

    # Special points
    special_points = [
        {
            "id": "eutectic",
            "type": "ternary_eutectic",
            "position": [*eutectic_comp, t_eutectic],
            "label": "E (ternary eutectic)",
        },
        {
            "id": "melt_a",
            "type": "melting_point",
            "position": [1.0, 0.0, 0.0, t_melt_a],
            "label": f"Tₘ({components[0]})",
        },
        {
            "id": "melt_b",
            "type": "melting_point",
            "position": [0.0, 1.0, 0.0, t_melt_b],
            "label": f"Tₘ({components[1]})",
        },
        {
            "id": "melt_c",
            "type": "melting_point",
            "position": [0.0, 0.0, 1.0, t_melt_c],
            "label": f"Tₘ({components[2]})",
        },
    ]

    return {
        "components": list(components),
        "temperature_range": [t_min, t_max],
        "temperature_unit": "K",
        "composition_unit": "mol%",
        "regions": regions,
        "special_points": special_points,
        "title": title,
    }


def create_al_cr_ni_diagram() -> dict[str, Any]:
    """Create Al-Cr-Ni ternary phase diagram (simplified for visualization)."""
    return create_schematic_ternary_eutectic(
        components=("Al", "Cr", "Ni"),
        t_min=500,
        t_max=1800,
        title="Al-Cr-Ni Ternary Phase Diagram (Schematic)",
    )


def create_fe_cr_ni_diagram() -> dict[str, Any]:
    """Create Fe-Cr-Ni ternary phase diagram (stainless steel system)."""
    return create_schematic_ternary_eutectic(
        components=("Fe", "Cr", "Ni"),
        t_min=600,
        t_max=1900,
        title="Fe-Cr-Ni Ternary Phase Diagram (Schematic)",
    )


def create_generic_abc_diagram() -> dict[str, Any]:
    """Create a generic A-B-C ternary phase diagram for demonstration."""
    return create_schematic_ternary_eutectic(
        components=("A", "B", "C"),
        t_min=300,
        t_max=1200,
        title="Generic Ternary Eutectic System (A-B-C)",
    )


def save_diagram(data: dict[str, Any], filename: str) -> None:
    """Save phase diagram data to gzipped JSON."""
    with gzip.open(filename, "wt", encoding="utf-8") as file:
        json.dump(data, file, indent=2)

    n_regions = len(data.get("regions", []))
    n_special = len(data.get("special_points", []))
    print(f"  {filename}: {n_regions} regions, {n_special} special points")


def main() -> None:
    """Generate all ternary phase diagrams."""
    output_dir = Path(__file__).parent

    # Remove old files if they exist
    for old_file in ["A-B-C.json.gz", "Fe-Cr-Ni.json.gz", "Al-Cu-Mg.json.gz"]:
        old_path = output_dir / old_file
        if old_path.exists():
            old_path.unlink()
            print(f"  Removed old file: {old_file}")

    # Generate new diagrams
    diagrams = [
        ("A-B-C-schematic", create_generic_abc_diagram),
        ("Al-Cr-Ni-schematic", create_al_cr_ni_diagram),
        ("Fe-Cr-Ni-schematic", create_fe_cr_ni_diagram),
    ]

    print("Generating ternary phase diagrams...")
    for name, create_fn in diagrams:
        data = create_fn()
        save_diagram(data, str(output_dir / f"{name}.json.gz"))

    print(f"\nDone! Generated {len(diagrams)} ternary phase diagrams.")


if __name__ == "__main__":
    main()
