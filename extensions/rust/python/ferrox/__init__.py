"""ferrox - High-performance crystallographic structure operations.

This package provides high-performance structure manipulation, symmetry analysis,
and structure matching implemented in Rust with Python bindings.

Key features:
- Structure file I/O (CIF, POSCAR, extXYZ, JSON)
- Structure matching and deduplication
- Symmetry analysis (spacegroup, Wyckoff positions, etc.)
- Coordination analysis (distance-based and Voronoi)
- Structure transformations (supercells, primitive/conventional cells)
- Composition parsing and analysis
"""

from ferrox._ferrox import (
    # Core
    StructureMatcher,
    __version__,
    # I/O
    parse_composition,
    parse_structure_file,
    parse_trajectory,
    to_cif,
    to_extxyz,
    to_poscar,
    to_pymatgen_json,
    write_structure_file,
    # Supercell & transformations
    make_supercell,
    make_supercell_diag,
    to_conventional,
    to_primitive,
    # Slab generation
    generate_slabs,
    make_slab,
    # Lattice reduction
    get_reduced_structure,
    get_reduced_structure_with_params,
    # Symmetry analysis
    get_crystal_system,
    get_equivalent_sites,
    get_hall_number,
    get_pearson_symbol,
    get_site_symmetry_symbols,
    get_spacegroup_number,
    get_spacegroup_symbol,
    get_symmetry_dataset,
    get_symmetry_operations,
    get_wyckoff_letters,
    # Structure properties
    get_density,
    get_structure_metadata,
    get_total_mass,
    get_volume,
    # Distance & neighbor finding
    distance_from_point,
    distance_matrix,
    get_distance,
    get_distance_and_image,
    get_distance_with_image,
    get_neighbor_list,
    is_periodic_image,
    # Coordination analysis
    get_cn_voronoi,
    get_cn_voronoi_all,
    get_coordination_number,
    get_coordination_numbers,
    get_local_environment,
    get_local_environment_voronoi,
    get_neighbors,
    get_voronoi_neighbors,
    # Sorting
    get_sorted_by_electronegativity,
    get_sorted_structure,
    # Interpolation
    interpolate,
    # Matching
    matches,
    # Copy & wrap
    copy_structure,
    wrap_to_unit_cell,
    # Site manipulation
    perturb,
    remove_sites,
    remove_species,
    set_site_property,
    translate_sites,
    # Site properties & labels
    get_all_site_properties,
    get_site_properties,
    site_label,
    site_labels,
    species_strings,
    # Species operations
    normalize_element_symbol,
    substitute_species,
    # Symmetry operations
    apply_inversion,
    apply_operation,
    apply_translation,
    # Advanced transformations
    deform,
    enumerate_derivatives,
    ewald_energy,
    order_disordered,
)
