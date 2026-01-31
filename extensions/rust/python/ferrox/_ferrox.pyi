"""Type stubs for ferrox._ferrox Rust extension module.

This module provides high-performance crystallographic structure operations
implemented in Rust with Python bindings via PyO3.
"""

from collections.abc import Sequence
from typing import Any, Literal

# Type aliases for better readability
StructureDict = dict[str, Any]  # pymatgen-compatible structure dict
StructureJson = str | StructureDict  # JSON string or dict (both accepted by Rust)
Matrix3x3 = Sequence[Sequence[float]]  # 3x3 matrix (list or tuple)
IntMatrix3x3 = Sequence[Sequence[int]]  # 3x3 integer matrix
Vector3 = Sequence[float]  # 3-element vector [x, y, z]
IntVector3 = Sequence[int]  # 3-element integer vector [a, b, c]
RotationMatrix = Sequence[Sequence[int]]  # 3x3 integer rotation matrix
TranslationVector = Sequence[float]  # 3-element translation vector

__version__: str

class StructureMatcher:
    """High-performance structure matcher for crystallographic comparisons.

    Compares crystal structures accounting for lattice transformations,
    periodic boundary conditions, and optional volume scaling.

    Accepts structures as JSON strings or dicts (from pymatgen's Structure.as_dict()).

    Attributes:
        latt_len_tol: Fractional length tolerance for lattice vectors.
        site_pos_tol: Site position tolerance, normalized.
        angle_tol: Angle tolerance in degrees.
        primitive_cell: Whether to reduce to primitive cell before matching.
        scale: Whether to scale volumes to match.
        attempt_supercell: Whether to try supercell matching.
    """

    # Properties (read-only)
    @property
    def latt_len_tol(self) -> float: ...
    @property
    def site_pos_tol(self) -> float: ...
    @property
    def angle_tol(self) -> float: ...
    @property
    def primitive_cell(self) -> bool: ...
    @property
    def scale(self) -> bool: ...
    @property
    def attempt_supercell(self) -> bool: ...
    def __init__(
        self,
        latt_len_tol: float = 0.2,
        site_pos_tol: float = 0.3,
        angle_tol: float = 5.0,
        primitive_cell: bool = True,
        scale: bool = True,
        attempt_supercell: bool = False,
        comparator: Literal["species", "element"] = "species",
    ) -> None:
        """Create a new StructureMatcher.

        Args:
            latt_len_tol: Fractional length tolerance for lattice vectors.
            site_pos_tol: Site position tolerance, normalized.
            angle_tol: Angle tolerance in degrees.
            primitive_cell: Whether to reduce to primitive cell.
            scale: Whether to scale volumes to match.
            attempt_supercell: Whether to try supercell matching.
            comparator: "species" to match oxidation states, "element" to ignore them.
        """
        ...
    def fit(
        self,
        struct1: StructureJson,
        struct2: StructureJson,
        skip_structure_reduction: bool = False,
    ) -> bool:
        """Check if two structures match.

        Args:
            struct1: First structure as JSON string.
            struct2: Second structure as JSON string.
            skip_structure_reduction: If True, skip Niggli/primitive reduction
                (use with pre-reduced structures from reduce_structure()).

        Returns:
            True if structures match within tolerances.
        """
        ...
    def get_rms_dist(
        self, struct1: StructureJson, struct2: StructureJson
    ) -> tuple[float, float] | None:
        """Get RMS distance between two structures.

        Args:
            struct1: First structure as JSON string.
            struct2: Second structure as JSON string.

        Returns:
            Tuple of (rms, max_dist) if structures match, None otherwise.
        """
        ...
    def fit_anonymous(self, struct1: StructureJson, struct2: StructureJson) -> bool:
        """Check if two structures match under any species permutation.

        Useful for comparing structure prototypes (e.g., NaCl vs MgO both
        have the rocksalt structure).

        Args:
            struct1: First structure as JSON string.
            struct2: Second structure as JSON string.

        Returns:
            True if structures match under some species permutation.
        """
        ...
    def deduplicate(self, structures: list[StructureJson]) -> list[int]:
        """Deduplicate a list of structures.

        Args:
            structures: List of structure JSON strings.

        Returns:
            List where result[i] is the index of the first structure matching structure i.
        """
        ...
    def group(self, structures: list[StructureJson]) -> dict[int, list[int]]:
        """Group structures into equivalence classes.

        Args:
            structures: List of structure JSON strings.

        Returns:
            Dict mapping canonical index to list of equivalent structure indices.
        """
        ...
    def get_unique_indices(self, structures: list[StructureJson]) -> list[int]:
        """Get indices of unique structures from a list.

        Args:
            structures: List of structure JSON strings.

        Returns:
            List of indices of unique (first occurrence) structures.
        """
        ...
    def find_matches(
        self,
        new_structures: list[StructureJson],
        existing_structures: list[StructureJson],
    ) -> list[int | None]:
        """Find matches for new structures against existing (already-deduplicated) structures.

        Optimized for comparing a small batch of new structures against a large
        set of existing deduplicated structures.

        Args:
            new_structures: List of new structure JSON strings to check.
            existing_structures: List of existing structure JSON strings.

        Returns:
            List where result[i] is the index of matching existing structure, or None.
        """
        ...
    def reduce_structure(self, structure: StructureJson) -> StructureJson:
        """Apply Niggli reduction and optionally primitive cell reduction.

        Use this to pre-reduce structures before calling fit(..., skip_structure_reduction=True).

        Args:
            structure: Structure as JSON string.

        Returns:
            Reduced structure as JSON string (pymatgen-compatible).
        """
        ...
    def __repr__(self) -> str: ...

# === I/O Functions - Reading ===

def parse_structure_file(path: str) -> StructureDict:
    """Parse a structure file (auto-detects format from extension).

    Supports: .json (pymatgen), .cif, .xyz/.extxyz, POSCAR*/CONTCAR*/.vasp

    Args:
        path: Path to the structure file.

    Returns:
        Structure as a Python dict compatible with pymatgen's Structure.from_dict().
    """
    ...

def parse_trajectory(path: str) -> list[StructureDict]:
    """Parse trajectory file (extXYZ format).

    Args:
        path: Path to the trajectory file (.xyz/.extxyz format).

    Returns:
        List of pymatgen-compatible structure dicts, one per frame.
    """
    ...

# === I/O Functions - Writing ===

def write_structure_file(structure: StructureJson, path: str) -> None:
    """Write a structure to a file with automatic format detection.

    Format determined by extension: .json, .cif, .xyz/.extxyz, .vasp/POSCAR*/CONTCAR*

    Args:
        structure: Structure as JSON string.
        path: Path to the output file.
    """
    ...

def to_poscar(structure: StructureJson, comment: str | None = None) -> str:
    """Convert a structure to POSCAR format string.

    Args:
        structure: Structure as JSON string.
        comment: Optional comment line (defaults to formula).

    Returns:
        POSCAR format string.
    """
    ...

def to_cif(structure: StructureJson, data_name: str | None = None) -> str:
    """Convert a structure to CIF format string.

    Args:
        structure: Structure as JSON string.
        data_name: Optional data block name (defaults to formula).

    Returns:
        CIF format string.
    """
    ...

def to_extxyz(structure: StructureJson) -> str:
    """Convert a structure to extXYZ format string.

    Args:
        structure: Structure as JSON string.

    Returns:
        extXYZ format string.
    """
    ...

def to_pymatgen_json(structure: StructureJson) -> str:
    """Convert a structure to pymatgen JSON format string.

    Args:
        structure: Structure as JSON string.

    Returns:
        JSON format string compatible with pymatgen's Structure.from_dict().
    """
    ...

# === Supercell Functions ===

def make_supercell(
    structure: StructureJson, scaling_matrix: IntMatrix3x3
) -> StructureDict:
    """Create a supercell from a structure.

    Args:
        structure: Structure as JSON string.
        scaling_matrix: 3x3 integer scaling matrix [[a1,a2,a3],[b1,b2,b3],[c1,c2,c3]].
            Negative values allowed (create mirror transformations).

    Returns:
        Supercell structure as pymatgen-compatible dict.
    """
    ...

def make_supercell_diag(
    structure: StructureJson, nx: int, ny: int, nz: int
) -> StructureDict:
    """Create a diagonal supercell (nx × ny × nz).

    Args:
        structure: Structure as JSON string.
        nx: Scaling factor along a-axis.
        ny: Scaling factor along b-axis.
        nz: Scaling factor along c-axis.

    Returns:
        Supercell structure as pymatgen-compatible dict.
    """
    ...

# === Lattice Reduction Functions ===

def get_reduced_structure(
    structure: StructureJson, algo: Literal["niggli", "lll"]
) -> StructureDict:
    """Get a structure with reduced lattice (Niggli or LLL).

    Atomic positions are preserved in Cartesian space; only the lattice
    basis changes. Fractional coordinates are wrapped to [0, 1).

    Args:
        structure: Structure as JSON string.
        algo: Reduction algorithm - "niggli" or "lll".

    Returns:
        Reduced structure as pymatgen-compatible dict.
    """
    ...

def get_reduced_structure_with_params(
    structure: StructureJson,
    algo: Literal["niggli", "lll"],
    niggli_tol: float = 1e-5,
    lll_delta: float = 0.75,
) -> StructureDict:
    """Get reduced structure with custom parameters.

    Args:
        structure: Structure as JSON string.
        algo: Reduction algorithm.
        niggli_tol: Tolerance for Niggli reduction (ignored for LLL).
        lll_delta: Delta parameter for LLL reduction (ignored for Niggli).

    Returns:
        Reduced structure as pymatgen-compatible dict.
    """
    ...

# === Neighbor Finding and Distance Functions ===

def get_neighbor_list(
    structure: StructureJson,
    r: float,
    numerical_tol: float = 1e-8,
    exclude_self: bool = True,
) -> tuple[list[int], list[int], list[tuple[int, int, int]], list[float]]:
    """Get neighbor list for a structure.

    Finds all atom pairs within cutoff radius using periodic boundary conditions.

    Args:
        structure: Structure as JSON string.
        r: Cutoff radius in Angstroms.
        numerical_tol: Tolerance for distance comparisons.
        exclude_self: If True, exclude self-pairs (distance ~0).

    Returns:
        Tuple of (center_indices, neighbor_indices, image_offsets, distances).
    """
    ...

def get_distance(structure: StructureJson, i: int, j: int) -> float:
    """Get distance between two sites using minimum image convention.

    Args:
        structure: Structure as JSON string.
        i: First site index.
        j: Second site index.

    Returns:
        Distance in Angstroms.
    """
    ...

def get_distance_and_image(
    structure: StructureJson, i: int, j: int
) -> tuple[float, tuple[int, int, int]]:
    """Get distance and periodic image between two sites.

    Args:
        structure: Structure as JSON string.
        i: First site index.
        j: Second site index.

    Returns:
        Tuple of (distance, [da, db, dc]) where image tells which periodic
        image of site j is closest to site i.
    """
    ...

def get_distance_with_image(
    structure: StructureJson,
    i: int,
    j: int,
    jimage: tuple[int, int, int],
) -> float:
    """Get distance to a specific periodic image of site j.

    Args:
        structure: Structure as JSON string.
        i: First site index.
        j: Second site index.
        jimage: Lattice translation [da, db, dc].

    Returns:
        Distance to the specified periodic image.
    """
    ...

def distance_from_point(structure: StructureJson, idx: int, point: Vector3) -> float:
    """Get Cartesian distance from a site to an arbitrary point.

    Simple Euclidean distance, not using periodic boundary conditions.

    Args:
        structure: Structure as JSON string.
        idx: Site index.
        point: Cartesian coordinates [x, y, z].

    Returns:
        Distance in Angstroms.
    """
    ...

def distance_matrix(structure: StructureJson) -> list[list[float]]:
    """Get the full distance matrix between all sites.

    Args:
        structure: Structure as JSON string.

    Returns:
        n × n distance matrix where n = num_sites.
    """
    ...

def is_periodic_image(
    structure: StructureJson, i: int, j: int, tolerance: float = 1e-8
) -> bool:
    """Check if two sites are periodic images of each other.

    Sites are periodic images if they have the same species and their
    fractional coordinates differ by integers (within tolerance).

    Args:
        structure: Structure as JSON string.
        i: First site index.
        j: Second site index.
        tolerance: Tolerance for coordinate comparison.

    Returns:
        True if sites are periodic images.
    """
    ...

# === Site Label and Species Functions ===

def site_label(structure: StructureJson, idx: int) -> str:
    """Get label for a specific site.

    Returns explicit label if set, otherwise the species string.

    Args:
        structure: Structure as JSON string.
        idx: Site index.

    Returns:
        Site label.
    """
    ...

def site_labels(structure: StructureJson) -> list[str]:
    """Get labels for all sites.

    Args:
        structure: Structure as JSON string.

    Returns:
        List of site labels.
    """
    ...

def species_strings(structure: StructureJson) -> list[str]:
    """Get species strings for all sites.

    For ordered sites: "Fe" or "Fe2+". For disordered: "Co:0.500, Fe:0.500".

    Args:
        structure: Structure as JSON string.

    Returns:
        List of species strings.
    """
    ...

# === Interpolation Functions ===

def interpolate(
    struct1: StructureJson,
    struct2: StructureJson,
    n_images: int,
    interpolate_lattices: bool = False,
    use_pbc: bool = True,
) -> list[StructureDict]:
    """Interpolate between two structures for NEB calculations.

    Generates n_images + 1 structures from start to end with linearly
    interpolated coordinates.

    Args:
        struct1: Start structure as JSON string.
        struct2: End structure as JSON string.
        n_images: Number of intermediate images (total returned = n_images + 1).
        interpolate_lattices: If True, also interpolate lattice parameters.
        use_pbc: If True, use minimum image convention for interpolation.

    Returns:
        List of structure dicts from start to end.
    """
    ...

# === Matching Convenience Functions ===

def matches(
    struct1: StructureJson, struct2: StructureJson, anonymous: bool = False
) -> bool:
    """Check if two structures match using default matcher settings.

    Args:
        struct1: First structure as JSON string.
        struct2: Second structure as JSON string.
        anonymous: If True, allows any species permutation (prototype matching).

    Returns:
        True if structures match, False otherwise.
    """
    ...

# === Sorting Functions ===

def get_sorted_structure(
    structure: StructureJson, reverse: bool = False
) -> StructureDict:
    """Get a sorted copy of the structure by atomic number.

    Args:
        structure: Structure as JSON string.
        reverse: If True, sort in descending order.

    Returns:
        Sorted structure as pymatgen-compatible dict.
    """
    ...

def get_sorted_by_electronegativity(
    structure: StructureJson, reverse: bool = False
) -> StructureDict:
    """Get a sorted copy of the structure by electronegativity.

    Args:
        structure: Structure as JSON string.
        reverse: If True, sort in descending order.

    Returns:
        Sorted structure as pymatgen-compatible dict.
    """
    ...

# === Copy/Sanitization Functions ===

def copy_structure(structure: StructureJson, sanitize: bool = False) -> StructureDict:
    """Create a copy of the structure, optionally sanitized.

    Sanitization applies:
    1. LLL lattice reduction
    2. Sort sites by electronegativity
    3. Wrap fractional coords to [0, 1)

    Args:
        structure: Structure as JSON string.
        sanitize: If True, apply sanitization steps.

    Returns:
        Copy of structure as pymatgen-compatible dict.
    """
    ...

def wrap_to_unit_cell(structure: StructureJson) -> StructureDict:
    """Wrap all fractional coordinates to [0, 1).

    Args:
        structure: Structure as JSON string.

    Returns:
        Structure with wrapped coordinates as pymatgen-compatible dict.
    """
    ...

# === Symmetry Operation Functions ===

def apply_operation(
    structure: StructureJson,
    rotation: Matrix3x3,
    translation: TranslationVector,
    fractional: bool = True,
) -> StructureDict:
    """Apply a symmetry operation to a structure.

    The transformation is: new = rotation × old + translation

    Args:
        structure: Structure as JSON string.
        rotation: 3x3 rotation matrix.
        translation: Translation vector [t1, t2, t3].
        fractional: If True, operation is in fractional coords; else Cartesian.

    Returns:
        Transformed structure as pymatgen-compatible dict.
    """
    ...

def apply_inversion(structure: StructureJson, fractional: bool = True) -> StructureDict:
    """Apply inversion through the origin.

    Args:
        structure: Structure as JSON string.
        fractional: If True, operation is in fractional coords; else Cartesian.

    Returns:
        Inverted structure as pymatgen-compatible dict.
    """
    ...

def apply_translation(
    structure: StructureJson,
    translation: TranslationVector,
    fractional: bool = True,
) -> StructureDict:
    """Apply a translation to all sites.

    Args:
        structure: Structure as JSON string.
        translation: Translation vector [t1, t2, t3].
        fractional: If True, translation is in fractional coords; else Cartesian.

    Returns:
        Translated structure as pymatgen-compatible dict.
    """
    ...

# === Structure Property Functions ===

def get_volume(structure: StructureJson) -> float:
    """Get the volume of the unit cell in Angstrom³.

    Args:
        structure: Structure as JSON string.

    Returns:
        Volume in Angstrom³.
    """
    ...

def get_total_mass(structure: StructureJson) -> float:
    """Get the total mass of the structure in atomic mass units (u).

    Args:
        structure: Structure as JSON string.

    Returns:
        Total mass in amu.
    """
    ...

def get_density(structure: StructureJson) -> float | None:
    """Get the density of the structure in g/cm³.

    Args:
        structure: Structure as JSON string.

    Returns:
        Density in g/cm³, or None if volume is zero.
    """
    ...

def get_structure_metadata(
    structure: StructureJson,
    compute_spacegroup: bool = False,
    symprec: float = 0.01,
) -> dict[str, Any]:
    """Get all queryable metadata from a structure in a single call.

    More efficient than calling individual functions when you need
    multiple properties, as it only parses the structure once.

    Args:
        structure: Structure as JSON string.
        compute_spacegroup: Whether to compute spacegroup (expensive).
        symprec: Symmetry precision for spacegroup detection.

    Returns:
        Metadata dict with keys: formula, formula_anonymous, formula_hill,
        chemical_system, elements, n_elements, n_sites, volume, density,
        mass, is_ordered, spacegroup_number (optional).
    """
    ...

# === Symmetry Analysis Functions ===

def get_spacegroup_number(structure: StructureJson, symprec: float = 0.01) -> int:
    """Get the spacegroup number of a structure.

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Spacegroup number (1-230).
    """
    ...

def get_spacegroup_symbol(structure: StructureJson, symprec: float = 0.01) -> str:
    """Get the Hermann-Mauguin spacegroup symbol (e.g., "Fm-3m", "P2_1/c").

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Hermann-Mauguin symbol.
    """
    ...

def get_hall_number(structure: StructureJson, symprec: float = 0.01) -> int:
    """Get the Hall number (1-530) identifying the specific spacegroup setting.

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Hall number.
    """
    ...

def get_pearson_symbol(structure: StructureJson, symprec: float = 0.01) -> str:
    """Get the Pearson symbol (e.g., "cF8" for FCC Cu).

    The Pearson symbol encodes the crystal system, centering type, and
    number of atoms in the conventional cell.

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Pearson symbol.
    """
    ...

def get_wyckoff_letters(structure: StructureJson, symprec: float = 0.01) -> list[str]:
    """Get Wyckoff letters for each site in the structure.

    Wyckoff positions describe the site symmetry and multiplicity.
    Sites with the same letter have equivalent positions under the space group.

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Wyckoff letters for each site (single-character strings).
    """
    ...

def get_site_symmetry_symbols(
    structure: StructureJson, symprec: float = 0.01
) -> list[str]:
    """Get site symmetry symbols for each site (e.g., "m..", "-1", "4mm").

    The site symmetry describes the point group symmetry at each atomic site.

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Site symmetry symbols for each site.
    """
    ...

def get_symmetry_operations(
    structure: StructureJson, symprec: float = 0.01
) -> list[tuple[list[list[int]], list[float]]]:
    """Get symmetry operations in the input cell.

    A symmetry operation transforms a point r to: R @ r + t

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        List of (rotation, translation) pairs.
    """
    ...

def get_equivalent_sites(structure: StructureJson, symprec: float = 0.01) -> list[int]:
    """Get equivalent sites (crystallographic orbits).

    Returns a list where orbits[i] is the index of the representative site
    that site i is equivalent to.

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Orbit indices for each site.
    """
    ...

def get_crystal_system(structure: StructureJson, symprec: float = 0.01) -> str:
    """Get the crystal system based on the spacegroup.

    Returns one of: "triclinic", "monoclinic", "orthorhombic",
    "tetragonal", "trigonal", "hexagonal", "cubic".

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Crystal system name.
    """
    ...

def get_symmetry_dataset(
    structure: StructureJson, symprec: float = 0.01
) -> dict[str, Any]:
    """Get full symmetry dataset for a structure.

    More efficient when you need multiple symmetry properties.

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Dict with keys: spacegroup_number, spacegroup_symbol, hall_number,
        pearson_symbol, crystal_system, wyckoff_letters, site_symmetry_symbols,
        equivalent_sites, symmetry_operations, num_operations.
    """
    ...

# === Site Manipulation Functions ===

def translate_sites(
    structure: StructureJson,
    indices: Sequence[int],
    vector: Vector3,
    fractional: bool = True,
) -> StructureDict:
    """Translate specific sites by a vector.

    Args:
        structure: Structure as JSON string.
        indices: Site indices to translate.
        vector: Translation vector [x, y, z].
        fractional: If True, vector is in fractional coords; else Cartesian.

    Returns:
        Structure with translated sites as pymatgen-compatible dict.
    """
    ...

def perturb(
    structure: StructureJson,
    distance: float,
    min_distance: float | None = None,
    seed: int | None = None,
) -> StructureDict:
    """Perturb all sites by random vectors.

    Each site is translated by a random vector with magnitude uniformly
    distributed in [min_distance, distance].

    Args:
        structure: Structure as JSON string.
        distance: Maximum perturbation distance in Angstroms.
        min_distance: Minimum perturbation distance (default: 0).
        seed: Random seed for reproducibility.

    Returns:
        Perturbed structure as pymatgen-compatible dict.
    """
    ...

# === Normalization and Site Property Functions ===

def normalize_element_symbol(symbol: str) -> dict[str, Any]:
    """Normalize an element symbol string.

    Parses various element symbol formats and extracts the base element,
    oxidation state, and metadata (POTCAR suffix, labels, etc.).

    Args:
        symbol: Element symbol (e.g., "Fe", "Fe2+", "Ca_pv", "Fe1_oct").

    Returns:
        Dict with keys: element (str), oxidation_state (int | None), metadata (dict).
    """
    ...

def get_site_properties(structure: StructureJson, idx: int) -> dict[str, Any]:
    """Get site properties for a specific site.

    Args:
        structure: Structure as JSON string.
        idx: Site index.

    Returns:
        Site properties as a dict.
    """
    ...

def get_all_site_properties(structure: StructureJson) -> list[dict[str, Any]]:
    """Get all site properties for a structure.

    Args:
        structure: Structure as JSON string.

    Returns:
        List of site property dicts (parallel to sites).
    """
    ...

def set_site_property(
    structure: StructureJson, idx: int, key: str, value: Any
) -> StructureDict:
    """Set a site property.

    Args:
        structure: Structure as JSON string.
        idx: Site index.
        key: Property key.
        value: Property value (must be JSON-serializable).

    Returns:
        Updated structure as pymatgen-compatible dict.
    """
    ...

# === Composition Functions ===

def parse_composition(formula: str) -> dict[str, Any]:
    """Parse a chemical formula and return composition data.

    Args:
        formula: Chemical formula string (e.g., "LiFePO4", "Ca3(PO4)2").

    Returns:
        Dict with keys: species (dict[str, float]), formula, reduced_formula,
        formula_anonymous, formula_hill, alphabetical_formula, chemical_system,
        num_atoms, num_elements, weight, is_element, average_electroneg,
        total_electrons.
    """
    ...

# === Slab Functions ===

def make_slab(
    structure: StructureJson,
    miller_index: IntVector3,
    min_slab_size: float = 10.0,
    min_vacuum_size: float = 10.0,
    center_slab: bool = True,
    in_unit_planes: bool = False,
    symprec: float = 0.01,
    termination_index: int = 0,
) -> StructureDict:
    """Create a slab from a bulk structure.

    Args:
        structure: Bulk structure as JSON string.
        miller_index: Miller indices (h, k, l) for the surface.
        min_slab_size: Minimum slab thickness in Angstroms.
        min_vacuum_size: Minimum vacuum thickness in Angstroms.
        center_slab: Whether to center the slab in the cell.
        in_unit_planes: If True, min_slab_size is in unit planes.
        symprec: Symmetry precision for termination detection.
        termination_index: Which termination to use (0 = first).

    Returns:
        Slab structure as pymatgen-compatible dict.
    """
    ...

def generate_slabs(
    structure: StructureJson,
    miller_index: IntVector3,
    min_slab_size: float = 10.0,
    min_vacuum_size: float = 10.0,
    center_slab: bool = True,
    in_unit_planes: bool = False,
    symprec: float = 0.01,
) -> list[StructureDict]:
    """Generate all terminations of a slab.

    Args:
        structure: Bulk structure as JSON string.
        miller_index: Miller indices (h, k, l) for the surface.
        min_slab_size: Minimum slab thickness in Angstroms.
        min_vacuum_size: Minimum vacuum thickness in Angstroms.
        center_slab: Whether to center the slab in the cell.
        in_unit_planes: If True, min_slab_size is in unit planes.
        symprec: Symmetry precision for unique termination detection.

    Returns:
        List of slab structures for all unique terminations.
    """
    ...

# === Transformation Functions ===

def to_primitive(structure: StructureJson, symprec: float = 0.01) -> StructureDict:
    """Get the primitive cell of a structure.

    Uses symmetry analysis to find the smallest unit cell that generates
    the original structure through translational symmetry.

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Primitive structure as pymatgen-compatible dict.
    """
    ...

def to_conventional(structure: StructureJson, symprec: float = 0.01) -> StructureDict:
    """Get the conventional cell of a structure.

    Uses symmetry analysis to find the conventional unit cell based on
    the spacegroup's standard setting.

    Args:
        structure: Structure as JSON string.
        symprec: Symmetry precision.

    Returns:
        Conventional structure as pymatgen-compatible dict.
    """
    ...

def substitute_species(
    structure: StructureJson, from_species: str, to_species: str
) -> StructureDict:
    """Substitute species throughout a structure.

    Args:
        structure: Structure as JSON string.
        from_species: Species to replace (e.g., "Fe", "Fe2+").
        to_species: Replacement species.

    Returns:
        Structure with substituted species.
    """
    ...

def remove_species(structure: StructureJson, species: list[str]) -> StructureDict:
    """Remove all sites containing specified species.

    Args:
        structure: Structure as JSON string.
        species: Species to remove (e.g., ["Li", "Na"]).

    Returns:
        Structure with species removed.
    """
    ...

def remove_sites(structure: StructureJson, indices: list[int]) -> StructureDict:
    """Remove sites by index.

    Args:
        structure: Structure as JSON string.
        indices: Site indices to remove.

    Returns:
        Structure with sites removed.
    """
    ...

def deform(
    structure: StructureJson,
    gradient: Matrix3x3,
) -> StructureDict:
    """Apply a deformation gradient to the lattice.

    Args:
        structure: Structure as JSON string.
        gradient: 3x3 deformation gradient matrix.

    Returns:
        Deformed structure.
    """
    ...

def ewald_energy(
    structure: StructureJson, accuracy: float = 1e-5, real_cutoff: float = 10.0
) -> float:
    """Compute Ewald energy of an ionic structure.

    Args:
        structure: Structure as JSON string (must have oxidation states).
        accuracy: Accuracy parameter for Ewald summation.
        real_cutoff: Real-space cutoff in Angstroms.

    Returns:
        Coulomb energy in eV.
    """
    ...

def order_disordered(
    structure: StructureJson,
    max_structures: int | None = None,
    sort_by_energy: bool = True,
) -> list[StructureDict]:
    """Enumerate orderings of a disordered structure.

    Takes a structure with disordered sites and returns all possible
    ordered configurations, optionally ranked by Ewald energy.

    Args:
        structure: Structure as JSON string.
        max_structures: Maximum number of structures to return.
        sort_by_energy: Whether to sort by Ewald energy.

    Returns:
        List of ordered structures as pymatgen-compatible dicts.
    """
    ...

def enumerate_derivatives(
    structure: StructureJson, min_size: int = 1, max_size: int = 4
) -> list[StructureDict]:
    """Enumerate derivative structures from a parent structure.

    Generates all symmetrically unique supercells up to a given size.

    Args:
        structure: Parent structure as JSON string.
        min_size: Minimum supercell size (number of formula units).
        max_size: Maximum supercell size.

    Returns:
        List of derivative structures.
    """
    ...

# === Coordination Analysis Functions ===

def get_coordination_numbers(structure: StructureJson, cutoff: float) -> list[int]:
    """Get coordination numbers for all sites using a distance cutoff.

    Counts neighbors within the cutoff distance using periodic boundary conditions.

    Args:
        structure: Structure as JSON string.
        cutoff: Maximum distance in Angstroms.

    Returns:
        Coordination numbers for each site.
    """
    ...

def get_coordination_number(
    structure: StructureJson, site_idx: int, cutoff: float
) -> int:
    """Get coordination number for a single site using a distance cutoff.

    Args:
        structure: Structure as JSON string.
        site_idx: Index of the site to analyze.
        cutoff: Maximum distance in Angstroms.

    Returns:
        Coordination number for the specified site.
    """
    ...

def get_local_environment(
    structure: StructureJson, site_idx: int, cutoff: float
) -> list[dict[str, Any]]:
    """Get the local environment (neighbor information) for a site.

    Args:
        structure: Structure as JSON string.
        site_idx: Index of the site to analyze.
        cutoff: Maximum distance in Angstroms.

    Returns:
        List of neighbor dicts with keys: element, species, distance, image, site_idx.
    """
    ...

def get_neighbors(
    structure: StructureJson, site_idx: int, cutoff: float
) -> list[tuple[int, float, tuple[int, int, int]]]:
    """Get neighbors for a site as (site_idx, distance, image) tuples.

    A simpler alternative to get_local_environment without element/species info.

    Args:
        structure: Structure as JSON string.
        site_idx: Index of the site to analyze.
        cutoff: Maximum distance in Angstroms.

    Returns:
        List of (neighbor_idx, distance, [da, db, dc]) tuples.
    """
    ...

def get_cn_voronoi_all(
    structure: StructureJson, min_solid_angle: float = 0.01
) -> list[float]:
    """Get Voronoi-weighted coordination numbers for all sites.

    Uses Voronoi tessellation to determine neighbors based on solid angle.

    Args:
        structure: Structure as JSON string.
        min_solid_angle: Minimum solid angle fraction to count a neighbor.

    Returns:
        Effective coordination numbers for each site.
    """
    ...

def get_cn_voronoi(
    structure: StructureJson, site_idx: int, min_solid_angle: float = 0.01
) -> float:
    """Get Voronoi-weighted coordination number for a single site.

    Args:
        structure: Structure as JSON string.
        site_idx: Index of the site to analyze.
        min_solid_angle: Minimum solid angle fraction to count a neighbor.

    Returns:
        Effective coordination number for the site.
    """
    ...

def get_voronoi_neighbors(
    structure: StructureJson, site_idx: int, min_solid_angle: float = 0.01
) -> list[tuple[int, float]]:
    """Get Voronoi neighbors with their solid angle fractions for a site.

    Returns neighbors sorted by solid angle (largest first).

    Args:
        structure: Structure as JSON string.
        site_idx: Index of the site to analyze.
        min_solid_angle: Minimum solid angle fraction to include.

    Returns:
        List of (neighbor_idx, solid_angle_fraction) tuples.
    """
    ...

def get_local_environment_voronoi(
    structure: StructureJson, site_idx: int, min_solid_angle: float = 0.01
) -> list[dict[str, Any]]:
    """Get local environment using Voronoi tessellation.

    Similar to get_local_environment but uses Voronoi faces instead of distance cutoff.

    Args:
        structure: Structure as JSON string.
        site_idx: Index of the site to analyze.
        min_solid_angle: Minimum solid angle fraction to include.

    Returns:
        List of neighbor dicts with keys: element, species, distance, image, site_idx, solid_angle.
    """
    ...
