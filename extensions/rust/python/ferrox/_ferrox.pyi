"""Type stubs for ferrox._ferrox Rust extension module.

This module provides high-performance crystallographic structure operations
implemented in Rust with Python bindings via PyO3.
"""

from collections.abc import Callable, Sequence
from typing import Any, TypeAlias

# Type aliases for better readability
StructureDict: TypeAlias = dict[str, Any]  # pymatgen-compatible structure dict
StructureJson: TypeAlias = (
    str | StructureDict
)  # JSON string or dict (both accepted by Rust)
Matrix3x3: TypeAlias = Sequence[Sequence[float]]  # 3x3 matrix (list or tuple)
IntMatrix3x3: TypeAlias = Sequence[Sequence[int]]  # 3x3 integer matrix
Vector3: TypeAlias = Sequence[float]  # 3-element vector [x, y, z]
IntVector3: TypeAlias = Sequence[int]  # 3-element integer vector [a, b, c]
RotationMatrix: TypeAlias = Sequence[Sequence[int]]  # 3x3 integer rotation matrix
TranslationVector: TypeAlias = Sequence[float]  # 3-element translation vector

__version__: str

# === Top-level Element class ===

class Element:
    """Python wrapper for Element.

    Provides access to element properties like atomic number, mass, electronegativity,
    oxidation states, radii, and physical properties.
    """

    def __init__(self, symbol_or_z: str | int) -> None:
        """Create an Element from symbol or atomic number."""
    @property
    def symbol(self) -> str:
        """Element symbol (e.g., "Fe")."""
    @property
    def z(self) -> int:
        """Atomic number (1-118)."""
    @property
    def atomic_mass(self) -> float:
        """Atomic mass in atomic mass units."""
    @property
    def electronegativity(self) -> float | None:
        """Pauling electronegativity."""
    @property
    def common_oxidation_states(self) -> list[int]:
        """Most common oxidation states."""
    @property
    def oxidation_states(self) -> list[int]:
        """All known oxidation states."""
    @property
    def atomic_radius(self) -> float | None:
        """Atomic radius in Angstroms."""
    @property
    def ionic_radii(self) -> dict[str, float] | None:
        """Ionic radii by oxidation state (keys are string representations of charge)."""
    @property
    def covalent_radius(self) -> float | None:
        """Covalent radius in Angstroms."""
    @property
    def group(self) -> int | None:
        """Periodic table group (1-18)."""
    @property
    def period(self) -> int:
        """Periodic table period (1-7)."""
    @property
    def block(self) -> str:
        """Periodic table block (s, p, d, f)."""
    @property
    def name(self) -> str:
        """Full element name (e.g., "Iron")."""
    def is_metal(self) -> bool:
        """Whether element is a metal."""
    def is_metalloid(self) -> bool:
        """Whether element is a metalloid."""
    def is_noble_gas(self) -> bool:
        """Whether element is a noble gas."""
    def is_rare_earth(self) -> bool:
        """Whether element is a rare earth."""
    def is_lanthanoid(self) -> bool:
        """Whether element is a lanthanoid."""
    def is_actinoid(self) -> bool:
        """Whether element is an actinoid."""
    def is_transition_metal(self) -> bool:
        """Whether element is a transition metal."""
    def is_halogen(self) -> bool:
        """Whether element is a halogen."""
    def is_alkali(self) -> bool:
        """Whether element is an alkali metal."""
    def is_alkaline(self) -> bool:
        """Whether element is an alkaline earth metal."""
    def is_chalcogen(self) -> bool:
        """Whether element is a chalcogen."""
    def is_post_transition_metal(self) -> bool:
        """Whether element is a post-transition metal."""
    def is_radioactive(self) -> bool:
        """Whether element is radioactive."""
    def is_pseudo(self) -> bool:
        """Whether element is a pseudo-element."""
    @property
    def atomic_number(self) -> int:
        """Atomic number (alias for z)."""
    @property
    def row(self) -> int:
        """Periodic table row (alias for period)."""
    @property
    def melting_point(self) -> float | None:
        """Melting point in Kelvin."""
    @property
    def boiling_point(self) -> float | None:
        """Boiling point in Kelvin."""
    @property
    def density(self) -> float | None:
        """Density in g/cm³."""
    @property
    def ionization_energies(self) -> list[float]:
        """Ionization energies in eV."""
    @property
    def first_ionization_energy(self) -> float | None:
        """First ionization energy in eV."""
    @property
    def electron_affinity(self) -> float | None:
        """Electron affinity in eV."""
    @property
    def electron_configuration(self) -> str | None:
        """Electron configuration string."""
    @property
    def electron_configuration_semantic(self) -> str | None:
        """Semantic electron configuration."""
    @property
    def ionic_radius(self) -> float | None:
        """Default ionic radius."""
    @property
    def shannon_radii(self) -> dict[str, Any] | None:
        """Shannon radii data."""
    @property
    def shannon_ionic_radius(self) -> float | None:
        """Shannon ionic radius."""
    @property
    def max_oxidation_state(self) -> int:
        """Maximum oxidation state."""
    @property
    def min_oxidation_state(self) -> int:
        """Minimum oxidation state."""
    @property
    def icsd_oxidation_states(self) -> list[int]:
        """Oxidation states from ICSD."""
    @property
    def n_valence(self) -> int | None:
        """Number of valence electrons."""
    @property
    def molar_heat(self) -> float | None:
        """Molar heat capacity."""
    @property
    def specific_heat(self) -> float | None:
        """Specific heat capacity."""

# === Submodules ===
# ruff: noqa: N801  # lowercase class names are intentional namespace stubs

class io:
    """I/O functions for structure parsing and writing."""

    @staticmethod
    def parse_cif(content: str) -> StructureDict:
        """Parse a CIF string into a structure dict."""
    @staticmethod
    def parse_poscar(content: str) -> StructureDict:
        """Parse a POSCAR string into a structure dict."""
    @staticmethod
    def parse_xyz(content: str) -> StructureDict:
        """Parse an XYZ string into a structure dict."""
    @staticmethod
    def parse_extxyz(content: str) -> StructureDict:
        """Parse an extXYZ string into a structure dict."""
    @staticmethod
    def parse_file(path: str) -> StructureDict:
        """Parse a structure file (auto-detect format)."""
    @staticmethod
    def write_file(structure: StructureJson, path: str) -> None:
        """Write a structure to a file (format from extension)."""
    @staticmethod
    def to_cif(structure: StructureJson, data_name: str | None = None) -> str:
        """Convert structure to CIF string."""
    @staticmethod
    def to_poscar(structure: StructureJson, comment: str | None = None) -> str:
        """Convert structure to POSCAR string."""
    @staticmethod
    def to_extxyz(structure: StructureJson) -> str:
        """Convert structure to extXYZ string."""
    @staticmethod
    def to_json(structure: StructureJson) -> str:
        """Convert structure to JSON string."""
    @staticmethod
    def from_pymatgen(structure: Any) -> StructureDict:
        """Convert pymatgen Structure to dict."""
    @staticmethod
    def to_pymatgen_structure(structure: StructureJson) -> Any:
        """Convert to pymatgen Structure."""
    @staticmethod
    def to_pymatgen_molecule(molecule: StructureJson) -> Any:
        """Convert to pymatgen Molecule."""
    @staticmethod
    def from_ase(atoms: Any) -> StructureDict:
        """Convert ASE Atoms to dict."""
    @staticmethod
    def to_ase_atoms(structure: StructureJson) -> Any:
        """Convert to ASE Atoms."""
    @staticmethod
    def parse_trajectory(path: str) -> list[StructureDict]:
        """Parse a trajectory file."""

class structure:
    """Structure manipulation functions."""

    class StructureMatcher:
        """Structure matching with configurable tolerances."""

        latt_len_tol: float
        site_pos_tol: float

        def __init__(
            self,
            latt_len_tol: float = 0.2,
            site_pos_tol: float = 0.3,
            angle_tol: float = 5.0,
            primitive_cell: bool = True,
            scale: bool = True,
            attempt_supercell: bool = False,
            comparator: str = "species",
        ) -> None:
            """Create a StructureMatcher with specified tolerances."""
        def fit(
            self,
            struct1: StructureJson,
            struct2: StructureJson,
            skip_structure_reduction: bool = False,
        ) -> bool:
            """Check if two structures match."""
        def fit_anonymous(self, struct1: StructureJson, struct2: StructureJson) -> bool:
            """Check if structures match ignoring species identity."""
        def get_mapping(
            self, struct1: StructureJson, struct2: StructureJson
        ) -> list[int] | None:
            """Get the site mapping between structures."""
        def get_rms_dist(
            self, struct1: StructureJson, struct2: StructureJson
        ) -> tuple[float, float] | None:
            """Get RMS distance between matched structures."""
        def get_s2_like_s1(
            self, struct1: StructureJson, struct2: StructureJson
        ) -> StructureDict | None:
            """Get struct2 transformed to match struct1."""
        def group_structures(self, structures: list[StructureJson]) -> list[list[int]]:
            """Group structures by similarity."""

    @staticmethod
    def make_supercell(structure: StructureJson, matrix: IntMatrix3x3) -> StructureDict:
        """Create a supercell using a 3x3 transformation matrix."""
    @staticmethod
    def make_supercell_diag(
        structure: StructureJson, scaling: IntVector3
    ) -> StructureDict:
        """Create a diagonal supercell."""
    @staticmethod
    def get_reduced(
        structure: StructureJson, algorithm: str = "niggli"
    ) -> StructureDict:
        """Get a reduced cell structure."""
    @staticmethod
    def copy(structure: StructureJson, sanitize: bool = False) -> StructureDict:
        """Copy a structure."""
    @staticmethod
    def wrap_to_unit_cell(structure: StructureJson) -> StructureDict:
        """Wrap all sites to the unit cell."""
    @staticmethod
    def interpolate(
        struct1: StructureJson,
        struct2: StructureJson,
        nimages: int,
        interpolate_lattices: bool = False,
        use_pbc: bool = True,
    ) -> list[StructureDict]:
        """Interpolate between two structures."""
    @staticmethod
    def get_sorted(structure: StructureJson, reverse: bool = False) -> StructureDict:
        """Get structure sorted by species."""
    @staticmethod
    def matches(
        struct1: StructureJson, struct2: StructureJson, anonymous: bool = False
    ) -> bool:
        """Check if two structures match."""
    @staticmethod
    def get_metadata(structure: StructureJson) -> dict[str, Any]:
        """Get structure metadata (num_sites, composition, volume, density)."""
    @staticmethod
    def substitute_species(
        structure: StructureJson, old_species: str, new_species: str
    ) -> StructureDict:
        """Substitute one species with another in the structure."""
    @staticmethod
    def remove_species(
        structure: StructureJson, species_list: list[str]
    ) -> StructureDict:
        """Remove all sites of specified species from the structure."""
    @staticmethod
    def remove_sites(structure: StructureJson, indices: list[int]) -> StructureDict:
        """Remove sites at specified indices from the structure."""
    @staticmethod
    def deform(structure: StructureJson, gradient: Matrix3x3) -> StructureDict:
        """Apply a deformation gradient to the structure."""
    @staticmethod
    def ewald_energy(
        structure: StructureJson,
        eta: float | None = None,
        real_cutoff: float | None = None,
        accuracy: float | None = None,
    ) -> float:
        """Compute Ewald energy for a structure with oxidation states."""
    @staticmethod
    def order_disordered(
        structure: StructureJson, max_structures: int = 100
    ) -> list[StructureDict]:
        """Generate ordered structures from a disordered structure."""
    @staticmethod
    def enumerate_derivatives(
        structure: StructureJson, min_size: int = 1, max_size: int = 4
    ) -> list[StructureDict]:
        """Enumerate derivative structures within a size range."""

class lattice:
    """Lattice operations."""

    @staticmethod
    def get_metric_tensor(structure: StructureJson) -> list[list[float]]:
        """Get the lattice metric tensor."""
    @staticmethod
    def get_inv_matrix(structure: StructureJson) -> list[list[float]]:
        """Get the inverse lattice matrix."""
    @staticmethod
    def get_reciprocal(structure: StructureJson) -> list[list[float]]:
        """Get the reciprocal lattice matrix."""
    @staticmethod
    def get_lll_reduced(
        structure: StructureJson, delta: float = 0.75
    ) -> list[list[float]]:
        """Get the LLL-reduced lattice matrix."""
    @staticmethod
    def get_lll_mapping(structure: StructureJson) -> list[list[float]]:
        """Get the LLL reduction mapping matrix."""

class neighbors:
    """Neighbor list and distance functions."""

    @staticmethod
    def get_neighbor_list(
        structure: StructureJson, cutoff: float
    ) -> list[dict[str, Any]]:
        """Get the neighbor list for a structure."""
    @staticmethod
    def get_distance(structure: StructureJson, idx_a: int, idx_b: int) -> float:
        """Get the distance between two sites."""
    @staticmethod
    def distance_matrix(structure: StructureJson) -> list[list[float]]:
        """Get the distance matrix."""
    @staticmethod
    def get_distance_and_image(
        structure: StructureJson, idx_a: int, idx_b: int
    ) -> tuple[float, list[int]]:
        """Get distance and periodic image between sites."""
    @staticmethod
    def distance_from_point(
        structure: StructureJson, idx: int, point: Vector3
    ) -> float:
        """Get distance from a site to a point."""
    @staticmethod
    def is_periodic_image(
        structure: StructureJson, idx_a: int, idx_b: int, tolerance: float
    ) -> bool:
        """Check if two sites are periodic images."""

class coordination:
    """Coordination number and local environment analysis."""

    @staticmethod
    def get_coordination_number(
        structure: StructureJson, site_idx: int, cutoff: float
    ) -> int:
        """Get coordination number for a site."""
    @staticmethod
    def get_coordination_numbers(structure: StructureJson, cutoff: float) -> list[int]:
        """Get coordination numbers for all sites."""
    @staticmethod
    def get_local_environment(
        structure: StructureJson, site_idx: int, cutoff: float
    ) -> dict[str, Any]:
        """Get local environment around a site."""
    @staticmethod
    def get_cn_voronoi(
        structure: StructureJson, site_idx: int, min_solid_angle: float = 0.1
    ) -> float:
        """Get Voronoi coordination number for a site."""
    @staticmethod
    def get_cn_voronoi_all(
        structure: StructureJson, min_solid_angle: float = 0.1
    ) -> list[float]:
        """Get Voronoi coordination numbers for all sites."""

class composition:
    """Composition parsing and analysis."""

    @staticmethod
    def parse_composition(formula: str) -> dict[str, float]:
        """Parse a composition formula."""
    @staticmethod
    def get_atomic_fraction(formula: str, element: str) -> float:
        """Get atomic fraction of an element."""
    @staticmethod
    def get_wt_fraction(formula: str, element: str) -> float:
        """Get weight fraction of an element."""
    @staticmethod
    def reduced_composition(formula: str) -> dict[str, float]:
        """Get reduced composition."""
    @staticmethod
    def fractional_composition(formula: str) -> dict[str, float]:
        """Get fractional composition."""
    @staticmethod
    def is_charge_balanced(formula: str) -> bool:
        """Check if composition is charge-balanced."""
    @staticmethod
    def compositions_almost_equal(
        comp1: str, comp2: str, rtol: float = 0.1, atol: float = 1e-8
    ) -> bool:
        """Check if two compositions are almost equal."""
    @staticmethod
    def formula_hash(formula: str) -> int:
        """Get hash for reduced formula."""
    @staticmethod
    def species_hash(formula: str) -> int:
        """Get hash for species."""
    @staticmethod
    def remap_elements(formula: str, mapping: dict[str, str]) -> dict[str, float]:
        """Remap elements in formula."""
    @staticmethod
    def get_reduced_factor(formula: str) -> float:
        """Get the reduction factor of a formula."""
    @staticmethod
    def composition_charge(formula: str) -> int | None:
        """Get the charge of a composition. Returns None if species lack oxidation states."""

class symmetry:
    """Symmetry and space group functions."""

    @staticmethod
    def get_spacegroup_number(structure: StructureJson, symprec: float = 0.01) -> int:
        """Get the space group number."""
    @staticmethod
    def get_spacegroup_symbol(structure: StructureJson, symprec: float = 0.01) -> str:
        """Get the space group symbol."""
    @staticmethod
    def get_hall_number(structure: StructureJson, symprec: float = 0.01) -> int:
        """Get the Hall number."""
    @staticmethod
    def get_crystal_system(structure: StructureJson, symprec: float = 0.01) -> str:
        """Get the crystal system."""
    @staticmethod
    def get_pearson_symbol(structure: StructureJson, symprec: float = 0.01) -> str:
        """Get the Pearson symbol."""
    @staticmethod
    def get_wyckoff_letters(
        structure: StructureJson, symprec: float = 0.01
    ) -> list[str]:
        """Get Wyckoff letters for all sites."""
    @staticmethod
    def get_symmetry_operations(
        structure: StructureJson, symprec: float = 0.01
    ) -> list[dict[str, Any]]:
        """Get symmetry operations."""
    @staticmethod
    def get_equivalent_sites(
        structure: StructureJson, symprec: float = 0.01
    ) -> list[int]:
        """Get equivalent site indices."""
    @staticmethod
    def get_primitive(structure: StructureJson, symprec: float = 0.01) -> StructureDict:
        """Get the primitive cell."""
    @staticmethod
    def get_conventional(
        structure: StructureJson, symprec: float = 0.01
    ) -> StructureDict:
        """Get the conventional cell."""
    @staticmethod
    def get_symmetry_dataset(
        structure: StructureJson, symprec: float = 0.01
    ) -> dict[str, Any]:
        """Get the full symmetry dataset."""

class defects:
    """Point defect generation and analysis."""

    @staticmethod
    def create_vacancy(structure: StructureJson, site_idx: int) -> dict[str, Any]:
        """Create a vacancy defect."""
    @staticmethod
    def create_substitution(
        structure: StructureJson, site_idx: int, new_species: str
    ) -> dict[str, Any]:
        """Create a substitutional defect."""
    @staticmethod
    def create_interstitial(
        structure: StructureJson, species: str, frac_coords: Vector3
    ) -> dict[str, Any]:
        """Create an interstitial defect."""
    @staticmethod
    def create_antisite(
        structure: StructureJson, site_idx1: int, site_idx2: int
    ) -> dict[str, Any]:
        """Create an antisite defect."""
    @staticmethod
    def find_supercell(
        structure: StructureJson, min_image_distance: float = 10.0
    ) -> IntMatrix3x3:
        """Find optimal supercell for defect calculations."""
    @staticmethod
    def rattle(
        structure: StructureJson, amplitude: float, seed: int | None = None
    ) -> StructureDict:
        """Randomly displace all atoms."""
    @staticmethod
    def distort_bonds(
        structure: StructureJson,
        site_idx: int,
        distortion: float,
        cutoff: float = 3.0,
    ) -> StructureDict:
        """Distort bonds around a site."""
    @staticmethod
    def find_voronoi_interstitials(
        structure: StructureJson, min_dist: float = 1.0
    ) -> list[list[float]]:
        """Find interstitial sites using Voronoi analysis."""
    @staticmethod
    def generate_all(
        structure: StructureJson,
        extrinsic: list[str] | None = None,
        symprec: float = 0.01,
        interstitial_min_dist: float = 1.0,
    ) -> dict[str, list[dict[str, Any]]]:
        """Generate all point defects for a structure."""
    @staticmethod
    def guess_charge_states(
        defect_type: str,
        species: str | None = None,
        site_species: str | None = None,
    ) -> list[int]:
        """Guess reasonable charge states for a defect."""

class surfaces:
    """Surface and slab operations."""

    @staticmethod
    def enumerate_miller(max_index: int) -> list[list[int]]:
        """Enumerate Miller indices up to max_index."""
    @staticmethod
    def find_adsorption_sites(
        slab: StructureJson,
        height: float = 2.0,
        site_types: list[str] | None = None,
        neighbor_cutoff: float | None = None,
        surface_tolerance: float | None = None,
    ) -> list[dict[str, Any]]:
        """Find adsorption sites on a slab."""
    @staticmethod
    def get_surface_atoms(slab: StructureJson, tolerance: float = 0.5) -> list[int]:
        """Get indices of surface atoms."""
    @staticmethod
    def area(slab: StructureJson) -> float:
        """Get the surface area of a slab."""
    @staticmethod
    def calculate_energy(
        slab_energy: float,
        bulk_energy_per_atom: float,
        n_atoms: int,
        surface_area: float,
    ) -> float:
        """Calculate surface energy."""
    @staticmethod
    def d_spacing(structure: StructureJson, h: int, k: int, l: int) -> float:
        """Calculate d-spacing for a Miller index."""
    @staticmethod
    def compute_wulff(
        structure: StructureJson, surface_energies: list[tuple[list[int], float]]
    ) -> dict[str, Any]:
        """Compute the Wulff shape."""
    @staticmethod
    def miller_to_normal(structure: StructureJson, miller: list[int]) -> list[float]:
        """Convert Miller index to normal vector."""

class cell:
    """Cell operations."""

    @staticmethod
    def minimum_image_distance(
        structure: StructureJson, cart_a: Vector3, cart_b: Vector3
    ) -> float:
        """Get minimum image distance."""
    @staticmethod
    def minimum_image_vector(
        structure: StructureJson, cart_a: Vector3, cart_b: Vector3
    ) -> list[float]:
        """Get minimum image vector."""
    @staticmethod
    def niggli_reduce(structure: StructureJson) -> StructureDict:
        """Get Niggli-reduced structure."""
    @staticmethod
    def delaunay_reduce(structure: StructureJson) -> StructureDict:
        """Get Delaunay-reduced structure."""
    @staticmethod
    def is_niggli_reduced(structure: StructureJson, tolerance: float = 0.01) -> bool:
        """Check if structure has Niggli-reduced cell."""
    @staticmethod
    def find_supercell_matrix(
        structure: StructureJson, target: StructureJson
    ) -> IntMatrix3x3 | None:
        """Find supercell matrix between structures."""
    @staticmethod
    def lattices_equivalent(
        struct1: StructureJson, struct2: StructureJson, tolerance: float = 0.01
    ) -> bool:
        """Check if two lattices are equivalent."""
    @staticmethod
    def is_supercell(struct1: StructureJson, struct2: StructureJson) -> bool:
        """Check if struct1 is a supercell of struct2."""

class elastic:
    """Elastic tensor calculations."""

    @staticmethod
    def generate_strains(
        max_strain: float = 0.01, num_steps: int = 6
    ) -> list[list[list[float]]]:
        """Generate strain matrices for elastic tensor calculation."""
    @staticmethod
    def apply_strain(structure: StructureJson, strain: Matrix3x3) -> StructureDict:
        """Apply strain to a structure."""
    @staticmethod
    def stress_to_voigt(stress: Matrix3x3) -> list[float]:
        """Convert 3x3 stress to Voigt notation."""
    @staticmethod
    def strain_to_voigt(strain: Matrix3x3) -> list[float]:
        """Convert 3x3 strain to Voigt notation."""
    @staticmethod
    def tensor_from_stresses(
        strains: list[Matrix3x3], stresses: list[Matrix3x3]
    ) -> list[list[float]]:
        """Calculate elastic tensor from strain/stress data."""
    @staticmethod
    def bulk_modulus(tensor: list[list[float]]) -> float:
        """Calculate bulk modulus from elastic tensor."""
    @staticmethod
    def shear_modulus(tensor: list[list[float]]) -> float:
        """Calculate shear modulus from elastic tensor."""

class rdf:
    """Radial distribution function calculations."""

    @staticmethod
    def compute_rdf(
        structure: StructureJson, r_max: float = 10.0, n_bins: int = 100
    ) -> dict[str, Any]:
        """Compute the radial distribution function."""
    @staticmethod
    def compute_element_rdf(
        structure: StructureJson,
        element1: str,
        element2: str,
        r_max: float = 10.0,
        n_bins: int = 100,
    ) -> dict[str, Any]:
        """Compute element-specific RDF."""
    @staticmethod
    def compute_all_element_rdfs(
        structure: StructureJson, r_max: float = 10.0, n_bins: int = 100
    ) -> dict[str, dict[str, Any]]:
        """Compute RDFs for all element pairs."""

class xrd:
    """X-ray diffraction calculations."""

    @staticmethod
    def compute_xrd(
        structure: StructureJson,
        two_theta_range: tuple[float, float] | None = None,
        wavelength: float = 1.5406,
    ) -> dict[str, Any]:
        """Compute X-ray diffraction pattern."""
    @staticmethod
    def get_atomic_scattering_params() -> dict[str, list[list[float]]]:
        """Get atomic scattering parameters for all elements.

        Returns dict of element -> [[a1,b1], [a2,b2], [a3,b3], [a4,b4]] coefficients.
        """

class oxidation:
    """Oxidation state analysis."""

    @staticmethod
    def oxi_state_guesses(
        structure_or_formula: StructureJson | str,
        all_states: bool = False,
    ) -> list[dict[str, Any]]:
        """Guess oxidation states for a structure or formula.

        Args:
            structure_or_formula: Either a structure JSON/dict or a formula string like "Fe2O3"
            all_states: If True, return all possible assignments instead of just the best
        """
    @staticmethod
    def add_charges_from_oxi_state_guesses(structure: StructureJson) -> StructureDict:
        """Add oxidation states from guesses to structure."""
    @staticmethod
    def compute_bv_sums(
        structure: StructureJson,
        max_radius: float = 4.0,
        scale_factor: float = 0.37,
    ) -> list[float]:
        """Compute bond valence sums."""
    @staticmethod
    def guess_oxidation_states(structure: StructureJson) -> dict[str, float]:
        """Guess oxidation states using composition."""
    @staticmethod
    def add_by_element(
        structure: StructureJson, oxi_states: dict[str, int]
    ) -> StructureDict:
        """Add oxidation states by element."""
    @staticmethod
    def add_by_site(structure: StructureJson, oxi_states: list[int]) -> StructureDict:
        """Add oxidation states by site."""
    @staticmethod
    def remove_oxidation_states(structure: StructureJson) -> StructureDict:
        """Remove oxidation states from structure."""

class order_params:
    """Order parameter calculations."""

    @staticmethod
    def compute_steinhardt_q(
        structure: StructureJson, deg: int, cutoff: float
    ) -> list[float]:
        """Compute Steinhardt Q order parameter."""
    @staticmethod
    def classify_local_structure(q4: float, q6: float, tolerance: float = 0.1) -> str:
        """Classify local structure from Q4/Q6 values."""
    @staticmethod
    def classify_all_atoms(
        structure: StructureJson, cutoff: float, tolerance: float = 0.1
    ) -> list[str]:
        """Classify all atoms in a structure."""

class trajectory:
    """Trajectory analysis."""

    @staticmethod
    def diffusion_from_msd(
        msd: list[float],
        times: list[float],
        dim: int = 3,
        start_fraction: float = 0.2,
        end_fraction: float = 0.8,
    ) -> tuple[float, float]:
        """Calculate diffusion coefficient from MSD."""
    @staticmethod
    def diffusion_from_vacf(vacf: list[float], dt: float, dim: int = 3) -> float:
        """Calculate diffusion coefficient from VACF."""

class md:
    """Molecular dynamics integrators and analysis."""

    class MDState:
        """Molecular dynamics state."""

        positions: list[list[float]]
        velocities: list[list[float]]
        forces: list[list[float]]

        def __init__(
            self,
            positions: list[list[float]],
            masses: list[float],
            velocities: list[list[float]] | None = None,
        ) -> None:
            """Create a new MD state."""
        def init_velocities(
            self, temperature_k: float, seed: int | None = None
        ) -> None:
            """Initialize velocities from Maxwell-Boltzmann distribution."""
        def kinetic_energy(self) -> float:
            """Get kinetic energy in eV."""
        def temperature(self) -> float:
            """Get temperature in Kelvin."""
        def num_atoms(self) -> int:
            """Get number of atoms."""

    class LangevinIntegrator:
        """Langevin dynamics integrator."""

        def __init__(
            self,
            temperature_k: float,
            friction: float,
            dt: float,
            seed: int | None = None,
        ) -> None:
            """Create a Langevin integrator."""
        def step(
            self,
            state: md.MDState,
            compute_forces: Callable[[list[list[float]]], list[list[float]]],
        ) -> None:
            """Perform one Langevin dynamics step."""
        def set_temperature(self, temperature_k: float) -> None:
            """Set target temperature."""
        def set_friction(self, friction: float) -> None:
            """Set friction coefficient."""
        def set_dt(self, dt: float) -> None:
            """Set time step."""

    class NoseHooverChain:
        """Nosé-Hoover chain thermostat for NVT MD."""

        def __init__(
            self, target_temp: float, tau: float, dt: float, n_dof: int
        ) -> None:
            """Create a new Nosé-Hoover chain thermostat."""
        def step(
            self,
            state: md.MDState,
            compute_forces: Callable[[list[list[float]]], list[list[float]]],
        ) -> None:
            """Perform one NVT step."""
        def set_temperature(self, target_temp: float) -> None:
            """Set target temperature."""

    class VelocityRescale:
        """Velocity rescaling (Bussi) thermostat for NVT MD."""

        def __init__(
            self,
            target_temp: float,
            tau: float,
            dt: float,
            n_dof: int,
            seed: int | None = None,
        ) -> None:
            """Create a new velocity rescaling thermostat."""
        def step(
            self,
            state: md.MDState,
            compute_forces: Callable[[list[list[float]]], list[list[float]]],
        ) -> None:
            """Perform one NVT step."""
        def set_temperature(self, target_temp: float) -> None:
            """Set target temperature."""

    class NPTState:
        """State for NPT molecular dynamics."""

        positions: list[list[float]]
        cell: list[list[float]]

        def __init__(
            self,
            positions: list[list[float]],
            masses: list[float],
            cell: list[list[float]],
            pbc: list[bool] | None = None,
        ) -> None:
            """Create a new NPT state."""

    class FireConfig:
        """FIRE optimizer configuration."""

        dt_start: float
        dt_max: float
        max_step: float

        def __init__(
            self,
            dt_start: float | None = None,
            dt_max: float | None = None,
            n_min: int | None = None,
            f_inc: float | None = None,
            f_dec: float | None = None,
            alpha_start: float | None = None,
            f_alpha: float | None = None,
            max_step: float | None = None,
        ) -> None:
            """Create a FIRE configuration."""

    class FireState:
        """FIRE optimizer state."""

        positions: list[list[float]]

        def __init__(
            self,
            positions: list[list[float]],
            config: md.FireConfig | None = None,
        ) -> None:
            """Create a new FIRE optimizer state."""
        def step(
            self,
            compute_forces: Callable[[list[list[float]]], list[list[float]]],
        ) -> None:
            """Perform one FIRE optimization step."""
        def is_converged(self, fmax: float) -> bool:
            """Check if optimization has converged."""
        def max_force(self) -> float:
            """Get maximum force component magnitude."""
        def num_atoms(self) -> int:
            """Get number of atoms."""

    class CellFireState:
        """FIRE optimizer state with cell optimization."""

        positions: list[list[float]]
        cell: list[list[float]]

        def __init__(
            self,
            positions: list[list[float]],
            cell: list[list[float]],
            config: md.FireConfig | None = None,
            cell_factor: float = 1.0,
        ) -> None:
            """Create a new FIRE optimizer state with cell optimization."""
        def step(
            self,
            compute_forces_and_stress: Callable[
                [list[list[float]], list[list[float]]],
                tuple[list[list[float]], list[list[float]]],
            ],
        ) -> None:
            """Perform one FIRE optimization step with cell optimization."""
        def is_converged(self, fmax: float, smax: float) -> bool:
            """Check if optimization has converged."""
        def max_force(self) -> float:
            """Get maximum force component magnitude."""
        def max_stress(self) -> float:
            """Get maximum stress component magnitude."""

    @staticmethod
    def velocity_verlet_step(
        state: md.MDState,
        dt: float,
        compute_forces: Callable[[list[list[float]]], list[list[float]]],
    ) -> None:
        """Perform one velocity Verlet step (NVE ensemble)."""

class potentials:
    """Classical interatomic potentials."""

    @staticmethod
    def compute_lennard_jones(
        positions: list[list[float]],
        cell: list[list[float]] | None = None,
        pbc: list[bool] | None = None,
        sigma: float = 3.4,
        epsilon: float = 0.0103,
        cutoff: float | None = None,
    ) -> tuple[float, list[list[float]]]:
        """Compute Lennard-Jones energy and forces."""
    @staticmethod
    def compute_lennard_jones_forces(
        positions: list[list[float]],
        cell: list[list[float]] | None = None,
        pbc: list[bool] | None = None,
        sigma: float = 3.4,
        epsilon: float = 0.0103,
        cutoff: float | None = None,
    ) -> list[list[float]]:
        """Compute Lennard-Jones forces only."""
    @staticmethod
    def compute_morse(
        positions: list[list[float]],
        cell: list[list[float]] | None = None,
        pbc: list[bool] | None = None,
        d: float = 1.0,
        alpha: float = 1.0,
        r0: float = 1.0,
        cutoff: float = 10.0,
        compute_stress: bool = False,
    ) -> tuple[float, list[list[float]], list[list[float]] | None]:
        """Compute Morse potential energy and forces."""
    @staticmethod
    def compute_soft_sphere(
        positions: list[list[float]],
        cell: list[list[float]] | None = None,
        pbc: list[bool] | None = None,
        sigma: float = 1.0,
        epsilon: float = 1.0,
        alpha: float = 12.0,
        cutoff: float = 10.0,
        compute_stress: bool = False,
    ) -> tuple[float, list[list[float]], list[list[float]] | None]:
        """Compute Soft Sphere potential energy and forces."""
    @staticmethod
    def compute_harmonic_bonds(
        positions: list[list[float]],
        bonds: list[list[float]],
        cell: list[list[float]] | None = None,
        pbc: list[bool] | None = None,
        compute_stress: bool = False,
    ) -> tuple[float, list[list[float]], list[list[float]] | None]:
        """Compute harmonic bond energy and forces."""
