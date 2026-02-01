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

class Element:
    """Python wrapper for Element.

    Provides access to element properties like atomic number, mass, electronegativity,
    oxidation states, radii, and physical properties.
    """

    def __init__(self, symbol_or_z: str | int) -> None:
        """Create an Element from symbol or atomic number.

        Args:
            symbol_or_z: Element symbol (str like "Fe") or atomic number (int like 26).

        Raises:
            ValueError: If the symbol or atomic number is invalid.
        """
        ...
    @property
    def symbol(self) -> str:
        """Element symbol (e.g., "Fe")."""
        ...
    @property
    def z(self) -> int:
        """Atomic number (1-118)."""
        ...
    @property
    def atomic_mass(self) -> float:
        """Atomic mass in atomic mass units."""
        ...
    @property
    def electronegativity(self) -> float | None:
        """Pauling electronegativity."""
        ...
    @property
    def common_oxidation_states(self) -> list[int]:
        """Most common oxidation states."""
        ...
    @property
    def oxidation_states(self) -> list[int]:
        """All known oxidation states."""
        ...
    @property
    def atomic_radius(self) -> float | None:
        """Atomic radius in Angstroms."""
        ...
    @property
    def ionic_radii(self) -> dict[int, float]:
        """Ionic radii by oxidation state."""
        ...
    @property
    def van_der_waals_radius(self) -> float | None:
        """Van der Waals radius in Angstroms."""
        ...
    @property
    def covalent_radius(self) -> float | None:
        """Covalent radius in Angstroms."""
        ...
    @property
    def group(self) -> int | None:
        """Periodic table group (1-18)."""
        ...
    @property
    def period(self) -> int:
        """Periodic table period (1-7)."""
        ...
    @property
    def block(self) -> str:
        """Periodic table block (s, p, d, f)."""
        ...
    @property
    def name(self) -> str:
        """Full element name (e.g., "Iron")."""
        ...
    @property
    def is_metal(self) -> bool:
        """Whether element is a metal."""
        ...
    @property
    def is_metalloid(self) -> bool:
        """Whether element is a metalloid."""
        ...
    @property
    def is_noble_gas(self) -> bool:
        """Whether element is a noble gas."""
        ...
    @property
    def is_rare_earth(self) -> bool:
        """Whether element is a rare earth (lanthanide or actinide)."""
        ...
    @property
    def is_lanthanoid(self) -> bool:
        """Whether element is a lanthanoid."""
        ...
    @property
    def is_actinoid(self) -> bool:
        """Whether element is an actinoid."""
        ...
    @property
    def is_transition_metal(self) -> bool:
        """Whether element is a transition metal."""
        ...
    @property
    def is_pseudo(self) -> bool:
        """Whether element is a pseudo-element (dummy)."""
        ...
    def __repr__(self) -> str: ...
    def __str__(self) -> str: ...
    def __eq__(self, other: object) -> bool: ...
    def __hash__(self) -> int: ...

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
    def get_structure_distance(
        self, struct1: StructureJson, struct2: StructureJson
    ) -> float:
        """Compute universal distance between any two structures.

        Unlike get_rms_dist which returns None for incompatible structures,
        this method always returns a finite distance value, making it suitable
        for consistent ranking of structures by similarity.

        Args:
            struct1: First structure as JSON string or dict.
            struct2: Second structure as JSON string or dict.

        Returns:
            Finite distance in [0, 1e9]. Identical structures return 0.0.
            Empty vs non-empty structures return 1e9.
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

# === Molecule I/O Functions ===

def parse_molecule_json(json_str: str) -> StructureDict:
    """Parse a molecule from pymatgen Molecule JSON format.

    Args:
        json_str: JSON string in pymatgen Molecule.as_dict() format.

    Returns:
        Parsed molecule as dict (same format as input).
    """
    ...

def molecule_to_json(molecule: StructureJson) -> str:
    """Convert a molecule to pymatgen JSON format string.

    Args:
        molecule: Molecule as JSON string or dict.

    Returns:
        JSON format string compatible with pymatgen's Molecule.from_dict().
    """
    ...

def molecule_to_xyz(molecule: StructureJson, comment: str | None = None) -> str:
    """Convert a molecule to XYZ format string.

    Args:
        molecule: Molecule as JSON string or dict.
        comment: Optional comment line (defaults to formula).

    Returns:
        XYZ format string.
    """
    ...

def parse_xyz_str(content: str) -> StructureDict:
    """Parse a molecule from XYZ file content.

    Args:
        content: XYZ file content as string.

    Returns:
        Parsed molecule in pymatgen Molecule.as_dict() format.
    """
    ...

def parse_xyz_file(path: str) -> StructureDict:
    """Parse a molecule from an XYZ file.

    Args:
        path: Path to the XYZ file.

    Returns:
        Parsed molecule in pymatgen Molecule.as_dict() format.
    """
    ...

def parse_xyz_flexible(path: str) -> tuple[str, StructureDict]:
    """Parse XYZ content flexibly, returning Structure if lattice present, Molecule otherwise.

    Args:
        path: Path to XYZ file.

    Returns:
        Tuple of ("Structure" or "Molecule", dict in pymatgen format).
    """
    ...

# === ASE Conversion Functions ===

def parse_ase_dict(ase_dict: dict[str, Any]) -> tuple[str, StructureDict]:
    """Parse ASE Atoms dict, returning either a Structure or Molecule dict.

    Args:
        ase_dict: ASE Atoms dict with symbols, positions, cell, pbc, info.

    Returns:
        Tuple of ("Structure" or "Molecule", dict in pymatgen format).
    """
    ...

def from_ase_atoms(atoms: Any) -> StructureDict:
    """Convert an ASE Atoms object directly to ferrox dict format.

    Args:
        atoms: ASE Atoms object.

    Returns:
        Structure or Molecule in ferrox/pymatgen dict format.
    """
    ...

def to_ase_atoms(structure: StructureJson) -> Any:
    """Convert a ferrox dict to an ASE Atoms object.

    Args:
        structure: Structure or Molecule as JSON string or dict.

    Returns:
        ASE Atoms object.
    """
    ...

# === Pymatgen Direct Conversion ===

def from_pymatgen_structure(structure: Any) -> StructureDict:
    """Convert a pymatgen Structure directly to ferrox dict format.

    Extracts lattice, species, and coordinates directly from the pymatgen
    object without JSON serialization overhead.

    Args:
        structure: pymatgen Structure object.

    Returns:
        Structure in ferrox/pymatgen dict format.
    """
    ...

def to_pymatgen_structure(structure: StructureJson) -> Any:
    """Convert a ferrox dict to a pymatgen Structure object.

    Args:
        structure: Structure as JSON string or dict.

    Returns:
        pymatgen Structure object.
    """
    ...

def to_pymatgen_molecule(molecule: StructureJson) -> Any:
    """Convert a ferrox dict to a pymatgen Molecule object.

    Args:
        molecule: Molecule as JSON string or dict.

    Returns:
        pymatgen Molecule object.
    """
    ...

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

# === Lattice Property Functions ===

def get_lattice_metric_tensor(structure: StructureJson) -> list[list[float]]:
    """Get the metric tensor of the lattice.

    The metric tensor G = M @ M.T where M is the lattice matrix.

    Args:
        structure: Structure as JSON string or dict.

    Returns:
        3x3 metric tensor matrix.
    """
    ...

def get_lattice_inv_matrix(structure: StructureJson) -> list[list[float]]:
    """Get the inverse of the lattice matrix.

    Useful for coordinate transformations between Cartesian and fractional.

    Args:
        structure: Structure as JSON string or dict.

    Returns:
        3x3 inverse lattice matrix.
    """
    ...

def get_reciprocal_lattice(structure: StructureJson) -> list[list[float]]:
    """Get the reciprocal lattice.

    Returns the reciprocal lattice matrix (2π convention) as lattice vectors.

    Args:
        structure: Structure as JSON string or dict.

    Returns:
        3x3 reciprocal lattice matrix.
    """
    ...

def get_lll_reduced_lattice(structure: StructureJson) -> list[list[float]]:
    """Get the LLL-reduced lattice matrix.

    The Lenstra-Lenstra-Lovász (LLL) algorithm produces a basis with
    nearly orthogonal vectors, useful for PBC calculations.

    Args:
        structure: Structure as JSON string or dict.

    Returns:
        3x3 LLL-reduced lattice matrix.
    """
    ...

def get_lll_mapping(structure: StructureJson) -> list[list[float]]:
    """Get the transformation matrix to LLL-reduced basis.

    The mapping M transforms original fractional coords to LLL coords:
    frac_lll = M^(-1) @ frac_orig

    Args:
        structure: Structure as JSON string or dict.

    Returns:
        3x3 LLL transformation matrix.
    """
    ...

# === Structure Property Functions ===

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

def get_atomic_fraction(formula: str, element: str) -> float:
    """Get atomic fraction of an element in a composition.

    Args:
        formula: Chemical formula string.
        element: Element symbol (e.g., "Fe").

    Returns:
        Atomic fraction (0.0 to 1.0) or 0.0 if element not present.
    """
    ...

def get_wt_fraction(formula: str, element: str) -> float:
    """Get weight fraction of an element in a composition.

    Args:
        formula: Chemical formula string.
        element: Element symbol (e.g., "Fe").

    Returns:
        Weight fraction (0.0 to 1.0) or 0.0 if element not present.
    """
    ...

def reduced_composition(formula: str) -> dict[str, float]:
    """Get reduced composition as a dict.

    Args:
        formula: Chemical formula string.

    Returns:
        Dict mapping element symbols to amounts in reduced form.
    """
    ...

def get_reduced_factor(formula: str) -> float:
    """Get the reduction factor for a composition.

    Args:
        formula: Chemical formula string.

    Returns:
        The factor by which amounts were divided to get the reduced formula.
    """
    ...

def is_charge_balanced(formula: str) -> bool | None:
    """Check if a composition is charge balanced.

    Args:
        formula: Chemical formula string with oxidation states (e.g., "Fe2+O2-").

    Returns:
        True if charge balanced, False if not, None if species lack oxidation states.
    """
    ...

def species_hash(formula: str) -> int:
    """Get a hash value for the species composition.

    Useful for grouping structures by composition regardless of ordering.

    Args:
        formula: Chemical formula string.

    Returns:
        Hash value for the species composition.
    """
    ...

def remap_elements(formula: str, mapping: dict[str, str]) -> dict[str, float]:
    """Remap elements in a composition according to a mapping.

    Args:
        formula: Chemical formula string.
        mapping: Element symbol -> new element symbol mapping.

    Returns:
        New composition dict with remapped elements.
    """
    ...

def fractional_composition(formula: str) -> dict[str, float]:
    """Get fractional composition (atomic fractions) as a dict.

    Args:
        formula: Chemical formula string.

    Returns:
        Dict mapping element symbols to atomic fractions (sum to 1.0).
    """
    ...

def composition_charge(formula: str) -> int | None:
    """Get the total charge of a composition.

    Args:
        formula: Chemical formula string with oxidation states.

    Returns:
        Total charge as integer, or None if species lack oxidation states.
    """
    ...

def compositions_almost_equal(
    formula1: str, formula2: str, rtol: float = 0.01, atol: float = 1e-8
) -> bool:
    """Check if two compositions are approximately equal.

    Args:
        formula1: First chemical formula.
        formula2: Second chemical formula.
        rtol: Relative tolerance (default 0.01, i.e. 1%).
        atol: Absolute tolerance (default 1e-8).

    Returns:
        True if compositions are approximately equal.
    """
    ...

def formula_hash(formula: str) -> int:
    """Get a hash of the reduced formula (ignores oxidation states).

    Useful for grouping compositions by formula regardless of oxidation states.

    Args:
        formula: Chemical formula string.

    Returns:
        Hash value for the reduced formula.
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

# =============================================================================
# XRD Functions
# =============================================================================

# Type alias for XRD pattern result
XrdPatternDict = dict[str, Any]  # {two_theta, intensities, hkls, d_spacings}

def compute_xrd(
    structure: StructureJson,
    wavelength: float = 1.54184,
    two_theta_range: tuple[float, float] | None = None,
    debye_waller_factors: dict[str, float] | None = None,
    scaled: bool = True,
) -> XrdPatternDict:
    """Compute powder X-ray diffraction pattern from a structure.

    Uses kinematic diffraction theory with Cromer-Mann atomic scattering factors.

    Args:
        structure: Structure as JSON string or dict.
        wavelength: X-ray wavelength in Angstroms (default: 1.54184, Cu Kα).
        two_theta_range: Tuple of (min, max) 2θ angles in degrees (default: (0, 180)).
        debye_waller_factors: Dict of element symbol to B factor (optional).
        scaled: Whether to scale intensities to 0-100 (default: True).

    Returns:
        Dict with keys:
            - two_theta: List of 2θ angles in degrees
            - intensities: List of peak intensities
            - hkls: List of lists of {hkl, multiplicity} dicts for each peak
            - d_spacings: List of d-spacings in Angstroms
    """
    ...

def get_atomic_scattering_params() -> dict[str, list[list[float]]]:
    """Get atomic scattering parameters (Cromer-Mann coefficients).

    Returns the scattering coefficients for all elements, which are used
    in XRD pattern calculation. This is the single source of truth (SSOT)
    shared with TypeScript/matterviz.

    Returns:
        Dict mapping element symbols to their scattering coefficients.
        Each coefficient set is [[a1, b1], [a2, b2], [a3, b3], [a4, b4]].
    """
    ...

# =============================================================================
# RDF Functions
# =============================================================================

def compute_rdf(
    structure: StructureJson,
    r_max: float = 15.0,
    n_bins: int = 75,
    normalize: bool = True,
    auto_expand: bool = True,
    expansion_factor: float = 2.0,
) -> tuple[list[float], list[float]]:
    """Compute the total radial distribution function for all atom pairs.

    Args:
        structure: Structure as JSON string or dict.
        r_max: Maximum distance in Angstroms.
        n_bins: Number of histogram bins.
        normalize: Whether to normalize by ideal gas density.
        auto_expand: Whether to auto-expand structure to avoid finite-size effects.
        expansion_factor: Minimum lattice dimension = r_max × factor.

    Returns:
        Tuple of (r, g_r) where r is bin centers and g_r is RDF values.
    """
    ...

def compute_element_rdf(
    structure: StructureJson,
    element_a: str,
    element_b: str,
    r_max: float = 15.0,
    n_bins: int = 75,
    normalize: bool = True,
    auto_expand: bool = True,
    expansion_factor: float = 2.0,
) -> tuple[list[float], list[float]]:
    """Compute element-resolved radial distribution function.

    Calculates g(r) for a specific element pair, counting distances from
    atoms of element_a to atoms of element_b.

    Args:
        structure: Structure as JSON string or dict.
        element_a: Center element symbol (e.g., "Fe").
        element_b: Neighbor element symbol (e.g., "O").
        r_max: Maximum distance in Angstroms.
        n_bins: Number of histogram bins.
        normalize: Whether to normalize by ideal gas density.
        auto_expand: Whether to auto-expand structure.
        expansion_factor: Minimum lattice dimension = r_max × factor.

    Returns:
        Tuple of (r, g_r) where r is bin centers and g_r is RDF values.
    """
    ...

def compute_all_element_rdfs(
    structure: StructureJson,
    r_max: float = 15.0,
    n_bins: int = 75,
    normalize: bool = True,
    auto_expand: bool = True,
    expansion_factor: float = 2.0,
) -> list[dict[str, Any]]:
    """Compute RDF for all unique element pairs in the structure.

    Returns one RDF for each unique (element_a, element_b) pair where
    element_a <= element_b (by atomic number), avoiding duplicates.

    Args:
        structure: Structure as JSON string or dict.
        r_max: Maximum distance in Angstroms.
        n_bins: Number of histogram bins.
        normalize: Whether to normalize by ideal gas density.
        auto_expand: Whether to auto-expand structure.
        expansion_factor: Minimum lattice dimension = r_max × factor.

    Returns:
        List of dicts, each with keys: element_a, element_b, r, g_r.
    """
    ...

# =============================================================================
# Oxidation State Functions
# =============================================================================

def oxi_state_guesses(
    formula: str,
    target_charge: int = 0,
    use_all_oxi_states: bool = False,
    max_sites: int | None = None,
) -> list[dict[str, Any]]:
    """Guess oxidation states for a composition, ranked by ICSD probability.

    Args:
        formula: Chemical formula string.
        target_charge: Target total charge (default 0 for neutral).
        use_all_oxi_states: Whether to use all possible oxidation states.
        max_sites: Maximum number of sites to consider (for performance).

    Returns:
        List of dicts with keys: oxidation_states (dict), probability (float).
    """
    ...

def guess_oxidation_states_bvs(
    structure: StructureJson,
    symprec: float = 0.1,
    max_radius: float = 4.0,
    scale_factor: float = 1.015,
) -> list[int]:
    """Guess oxidation states using BVS-based MAP estimation with symmetry.

    Args:
        structure: Structure as JSON string or dict.
        symprec: Symmetry precision for equivalent site detection.
        max_radius: Maximum radius for BVS calculation.
        scale_factor: Scale factor for BVS parameters.

    Returns:
        List of oxidation states for each site.
    """
    ...

def add_charges_from_oxi_state_guesses(
    structure: StructureJson, target_charge: int = 0
) -> StructureDict:
    """Add oxidation states to a structure based on composition guessing.

    Raises ValueError for mixed-valence (non-integer average oxi states).

    Args:
        structure: Structure as JSON string or dict.
        target_charge: Target total charge (default 0 for neutral).

    Returns:
        Structure with oxidation states added.
    """
    ...

def add_oxidation_state_by_element(
    structure: StructureJson, oxi_states: dict[str, int]
) -> StructureDict:
    """Add oxidation states to a structure by element symbol mapping.

    Args:
        structure: Structure as JSON string or dict.
        oxi_states: Dict mapping element symbols to oxidation states.

    Returns:
        Structure with oxidation states added.
    """
    ...

def add_oxidation_state_by_site(
    structure: StructureJson, oxi_states: Sequence[int]
) -> StructureDict:
    """Add oxidation states to a structure by site index.

    Args:
        structure: Structure as JSON string or dict.
        oxi_states: List of oxidation states for each site.

    Returns:
        Structure with oxidation states added.
    """
    ...

def remove_oxidation_states(structure: StructureJson) -> StructureDict:
    """Remove oxidation states from all sites in a structure.

    Args:
        structure: Structure as JSON string or dict.

    Returns:
        Structure with oxidation states removed.
    """
    ...

def compute_bv_sums(
    structure: StructureJson, max_radius: float = 4.0, scale_factor: float = 1.015
) -> list[float]:
    """Compute bond valence sums for all sites using O'Keeffe & Brese parameters.

    Args:
        structure: Structure as JSON string or dict.
        max_radius: Maximum radius for BVS calculation.
        scale_factor: Scale factor for BVS parameters.

    Returns:
        List of bond valence sums for each site.
    """
    ...

# =============================================================================
# Order Parameter Functions
# =============================================================================

def compute_steinhardt_q(structure: StructureJson, l: int, cutoff: float) -> list[float]:
    """Compute Steinhardt order parameter q_l for all atoms.

    Args:
        structure: Structure as JSON string or dict.
        l: Angular momentum quantum number (typically 4 or 6).
        cutoff: Neighbor cutoff distance in Angstroms.

    Returns:
        List of q_l values for each atom.
    """
    ...

def classify_local_structure(q4: float, q6: float, tolerance: float = 0.1) -> str:
    """Classify local structure based on q4 and q6 values.

    Args:
        q4: Local q4 value.
        q6: Local q6 value.
        tolerance: Classification tolerance (default: 0.1).

    Returns:
        Structure type: "fcc", "bcc", "hcp", "icosahedral", "liquid", or "unknown".
    """
    ...

def classify_all_atoms(
    structure: StructureJson, cutoff: float, tolerance: float = 0.1
) -> list[str]:
    """Classify all atoms in a structure based on their local order parameters.

    Args:
        structure: Structure as JSON string or dict.
        cutoff: Neighbor cutoff distance in Angstroms.
        tolerance: Classification tolerance (default: 0.1).

    Returns:
        List of structure type strings for each atom.
    """
    ...
