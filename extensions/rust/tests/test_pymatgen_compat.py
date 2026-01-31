"""Compatibility tests comparing ferrox vs pymatgen StructureMatcher.

Run with: pytest extensions/rust/tests/test_pymatgen_compat.py -v
"""

from __future__ import annotations

import json
import os
import warnings
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import pytest
from pymatgen.analysis.structure_matcher import ElementComparator
from pymatgen.analysis.structure_matcher import StructureMatcher as PyMatcher
from pymatgen.core import Lattice, Species, Structure

if TYPE_CHECKING:
    from collections.abc import Callable

try:
    from ferrox import StructureMatcher as RustMatcher
except ImportError:
    pytest.skip(
        "ferrox not installed. Run: maturin develop --features python",
        allow_module_level=True,
    )

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
MATTERVIZ_STRUCTURES_DIR = Path(
    os.environ.get("MATTERVIZ_STRUCTURES_DIR", REPO_ROOT / "src/site/structures")
)
PYMATGEN_CIF_DIR = Path(
    os.environ.get("PYMATGEN_CIF_DIR", Path.home() / "dev/pymatgen/tests/files/cif")
)


# === Fixtures ===


@pytest.fixture
def py_matcher() -> PyMatcher:
    """Default pymatgen matcher."""
    return PyMatcher(ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False)


@pytest.fixture
def rust_matcher() -> RustMatcher:
    """Default ferrox matcher."""
    return RustMatcher(
        latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0, primitive_cell=False
    )


@pytest.fixture
def compare(py_matcher: PyMatcher, rust_matcher: RustMatcher) -> Callable:
    """Return a comparison function that asserts both matchers agree."""

    def _compare(s1: Structure, s2: Structure) -> bool:
        py_result = bool(py_matcher.fit(s1, s2))
        rust_result = rust_matcher.fit(
            json.dumps(s1.as_dict()), json.dumps(s2.as_dict())
        )
        assert py_result == rust_result, (
            f"Mismatch: pymatgen={py_result}, ferrox={rust_result}"
        )
        return py_result

    return _compare


# === Structure Generators ===


def make_cubic(element: str, a: float) -> Structure:
    """Simple cubic structure."""
    return Structure(Lattice.cubic(a), [element], [[0, 0, 0]])


def make_bcc(element: str, a: float) -> Structure:
    """BCC structure."""
    return Structure(Lattice.cubic(a), [element, element], [[0, 0, 0], [0.5, 0.5, 0.5]])


def make_fcc(element: str, a: float) -> Structure:
    """FCC structure (conventional cell)."""
    return Structure(
        Lattice.cubic(a),
        [element] * 4,
        [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )


def make_rocksalt(cation: str, anion: str, a: float) -> Structure:
    """Rocksalt structure (NaCl type)."""
    return Structure(Lattice.cubic(a), [cation, anion], [[0, 0, 0], [0.5, 0.5, 0.5]])


def make_perovskite(a_site: str, b_site: str, x_site: str, a: float) -> Structure:
    """Perovskite ABX3 structure."""
    return Structure(
        Lattice.cubic(a),
        [a_site, b_site, x_site, x_site, x_site],
        [[0, 0, 0], [0.5, 0.5, 0.5], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
    )


def make_hexagonal(element: str, a: float, c: float) -> Structure:
    """HCP structure."""
    return Structure(
        Lattice.hexagonal(a, c),
        [element, element],
        [[1 / 3, 2 / 3, 0.25], [2 / 3, 1 / 3, 0.75]],
    )


def make_wurtzite(cation: str, anion: str, a: float, c: float) -> Structure:
    """Wurtzite structure."""
    return Structure(
        Lattice.hexagonal(a, c),
        [cation, cation, anion, anion],
        [
            [1 / 3, 2 / 3, 0],
            [2 / 3, 1 / 3, 0.5],
            [1 / 3, 2 / 3, 0.375],
            [2 / 3, 1 / 3, 0.875],
        ],
    )


def make_diamond(element: str, a: float) -> Structure:
    """Diamond cubic structure."""
    return Structure(
        Lattice.cubic(a),
        [element] * 8,
        [
            [0, 0, 0],
            [0.5, 0.5, 0],
            [0.5, 0, 0.5],
            [0, 0.5, 0.5],
            [0.25, 0.25, 0.25],
            [0.75, 0.75, 0.25],
            [0.75, 0.25, 0.75],
            [0.25, 0.75, 0.75],
        ],
    )


# Base structures for parametrized tests (name, struct) pairs
_BASE_STRUCTURE_DATA = [
    ("cubic-Fe", make_cubic("Fe", 2.87)),
    ("bcc-Fe", make_bcc("Fe", 2.87)),
    ("fcc-Cu", make_fcc("Cu", 3.6)),
    ("rocksalt-NaCl", make_rocksalt("Na", "Cl", 5.64)),
    ("perovskite-BaTiO3", make_perovskite("Ba", "Ti", "O", 4.0)),
    ("hcp-Ti", make_hexagonal("Ti", 2.95, 4.68)),
    ("wurtzite-ZnO", make_wurtzite("Zn", "O", 3.25, 5.21)),
    ("diamond-C", make_diamond("C", 3.57)),
]
BASE_STRUCTURE_IDS = [name for name, _ in _BASE_STRUCTURE_DATA]
BASE_STRUCTURES = [struct for _, struct in _BASE_STRUCTURE_DATA]


# === Structure Transformations ===


def perturb(s: Structure, magnitude: float, seed: int = 42) -> Structure:
    """Add random perturbations to fractional coordinates."""
    rng = np.random.default_rng(seed)
    new_coords = [fc + rng.uniform(-magnitude, magnitude, 3) for fc in s.frac_coords]
    return Structure(s.lattice, s.species, new_coords)


def scale_lattice(s: Structure, factor: float) -> Structure:
    """Scale the lattice by a factor."""
    return Structure(Lattice(s.lattice.matrix * factor), s.species, s.frac_coords)


def strain_lattice(s: Structure, strain: float, axis: int = 0) -> Structure:
    """Apply uniaxial strain along one axis."""
    matrix = s.lattice.matrix.copy()
    matrix[axis] *= 1 + strain
    return Structure(Lattice(matrix), s.species, s.frac_coords)


def shuffle_sites(s: Structure, seed: int = 42) -> Structure:
    """Shuffle the order of sites."""
    rng = np.random.default_rng(seed)
    indices = list(range(len(s)))
    rng.shuffle(indices)
    return Structure(
        s.lattice, [s.species[i] for i in indices], [s.frac_coords[i] for i in indices]
    )


def translate(s: Structure, vec: list[float]) -> Structure:
    """Translate all atoms by a fractional vector."""
    return Structure(s.lattice, s.species, [(fc + vec) % 1.0 for fc in s.frac_coords])


# === Test Classes ===


class TestSelfMatching:
    """Identical structures should always match."""

    @pytest.mark.parametrize(("name", "struct"), _BASE_STRUCTURE_DATA)
    def test_base_structures(
        self, compare: Callable, name: str, struct: Structure
    ) -> None:
        """Base structures match themselves."""
        assert compare(struct, struct) is True, f"{name} should self-match"

    def test_triclinic(self, compare: Callable) -> None:
        """Triclinic lattice self-match."""
        struct = Structure(
            Lattice.from_parameters(3.0, 4.0, 5.0, 80.0, 85.0, 95.0),
            ["Ca"],
            [[0, 0, 0]],
        )
        assert compare(struct, struct) is True

    def test_oblique(self, compare: Callable) -> None:
        """Highly oblique cell self-match."""
        struct = Structure(
            Lattice.from_parameters(5.0, 5.0, 10.0, 60.0, 80.0, 70.0),
            ["Bi", "Se"],
            [[0, 0, 0], [0.5, 0.5, 0.5]],
        )
        assert compare(struct, struct) is True


class TestPerturbations:
    """Perturbed structures within tolerance should match."""

    @pytest.mark.parametrize(("name", "struct"), _BASE_STRUCTURE_DATA)
    @pytest.mark.parametrize("magnitude", [0.01, 0.02, 0.05])
    def test_coordinate_perturbations(
        self, compare: Callable, name: str, struct: Structure, magnitude: float
    ) -> None:
        """Small coordinate perturbations should match."""
        assert compare(struct, perturb(struct, magnitude)) is True, (
            f"{name} +/-{magnitude}"
        )

    @pytest.mark.parametrize(("name", "struct"), _BASE_STRUCTURE_DATA)
    @pytest.mark.parametrize("factor", [0.98, 1.02, 1.05])
    def test_lattice_scaling(
        self, compare: Callable, name: str, struct: Structure, factor: float
    ) -> None:
        """Lattice scaling within tolerance should match."""
        assert compare(struct, scale_lattice(struct, factor)) is True, (
            f"{name} x{factor}"
        )

    @pytest.mark.parametrize(("name", "struct"), _BASE_STRUCTURE_DATA)
    @pytest.mark.parametrize("strain", [0.01, 0.02])
    def test_uniaxial_strain(
        self, compare: Callable, name: str, struct: Structure, strain: float
    ) -> None:
        """Uniaxial strain within tolerance should match."""
        assert compare(struct, strain_lattice(struct, strain)) is True, (
            f"{name} +{strain}"
        )


class TestNonMatching:
    """Different structures should not match."""

    @pytest.mark.parametrize(
        "s1,s2",
        [
            (make_cubic("Fe", 2.87), make_cubic("Cu", 3.6)),
            (make_bcc("Fe", 2.87), make_bcc("W", 3.16)),
            (make_fcc("Cu", 3.6), make_fcc("Al", 4.05)),
            (make_rocksalt("Na", "Cl", 5.64), make_rocksalt("Mg", "O", 4.21)),
            (make_bcc("Fe", 2.87), make_fcc("Fe", 3.6)),  # same element, diff structure
            (
                make_cubic("Cu", 3.6),
                make_fcc("Cu", 3.6),
            ),  # same element, diff structure
        ],
    )
    def test_different_structures(
        self, compare: Callable, s1: Structure, s2: Structure
    ) -> None:
        """Different structures should not match."""
        assert compare(s1, s2) is False


class TestEdgeCases:
    """Edge cases and boundary conditions."""

    def test_shuffled_sites(self, compare: Callable) -> None:
        """Shuffled site order should still match."""
        struct = make_rocksalt("Na", "Cl", 5.64)
        assert compare(struct, shuffle_sites(struct)) is True

    @pytest.mark.parametrize(
        "translation",
        [[0.1, 0, 0], [0, 0.1, 0], [0, 0, 0.1], [0.25, 0.25, 0.25]],
    )
    def test_translations(self, compare: Callable, translation: list[float]) -> None:
        """Translated structures should match."""
        struct = make_rocksalt("Na", "Cl", 5.64)
        assert compare(struct, translate(struct, translation)) is True

    def test_large_perturbation(self, compare: Callable) -> None:
        """Large perturbations - verify both matchers agree."""
        struct = make_bcc("Fe", 2.87)
        # Just verify agreement, don't assert specific result (depends on tolerances)
        compare(struct, perturb(struct, 0.4, seed=2))

    def test_left_vs_right_handed_lattice(self, compare: Callable) -> None:
        """Left-handed vs right-handed lattice."""
        s_left = Structure(
            Lattice([[-4.0, 0, 0], [0, 4.0, 0], [0, 0, 4.0]]), ["Ag"], [[0, 0, 0]]
        )
        s_right = Structure(
            Lattice([[4.0, 0, 0], [0, 4.0, 0], [0, 0, 4.0]]), ["Ag"], [[0, 0, 0]]
        )
        compare(s_left, s_right)  # just check agreement, result may vary

    def test_coords_outside_unit_cell(self, compare: Callable) -> None:
        """Coordinates outside [0,1) should wrap correctly."""
        lattice = Lattice.cubic(5.0)
        s_outside = Structure(
            lattice, ["Li", "Li"], [[1.5, 0.3, 0.2], [-0.3, 0.7, 0.8]]
        )
        s_wrapped = Structure(lattice, ["Li", "Li"], [[0.5, 0.3, 0.2], [0.7, 0.7, 0.8]])
        assert compare(s_outside, s_wrapped) is True

    def test_single_atom(self, compare: Callable) -> None:
        """Single atom structure."""
        struct = Structure(Lattice.cubic(3.0), ["Au"], [[0, 0, 0]])
        assert compare(struct, struct) is True

    def test_needle_cell(self, compare: Callable) -> None:
        """Needle-like cell (c >> a)."""
        struct = Structure(
            Lattice.from_parameters(2.0, 2.0, 20.0, 90.0, 90.0, 90.0),
            ["C"],
            [[0, 0, 0]],
        )
        assert compare(struct, struct) is True

    def test_flat_cell(self, compare: Callable) -> None:
        """Flat cell (c << a)."""
        struct = Structure(
            Lattice.from_parameters(20.0, 20.0, 2.0, 90.0, 90.0, 90.0),
            ["C"],
            [[0, 0, 0]],
        )
        assert compare(struct, struct) is True

    def test_near_cubic_angles(self, compare: Callable) -> None:
        """Near-cubic angles."""
        struct = Structure(
            Lattice.from_parameters(5.0, 5.0, 5.0, 89.5, 90.5, 89.8), ["V"], [[0, 0, 0]]
        )
        assert compare(struct, struct) is True


class TestComparators:
    """Test species vs element comparators."""

    def test_oxidation_state_species_comparator(self) -> None:
        """Different oxidation states should NOT match with SpeciesComparator."""
        py_match = PyMatcher(ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False)
        rust_match = RustMatcher(
            latt_len_tol=0.2,
            site_pos_tol=0.3,
            angle_tol=5.0,
            primitive_cell=False,
            comparator="species",
        )

        lattice = Lattice.cubic(5.0)
        s_fe2 = Structure(lattice, [Species("Fe", 2)], [[0, 0, 0]])
        s_fe3 = Structure(lattice, [Species("Fe", 3)], [[0, 0, 0]])

        py_result = py_match.fit(s_fe2, s_fe3)
        rust_result = rust_match.fit(
            json.dumps(s_fe2.as_dict()), json.dumps(s_fe3.as_dict())
        )
        assert py_result == rust_result

    def test_oxidation_state_element_comparator(self) -> None:
        """Different oxidation states should match with ElementComparator."""
        py_match = PyMatcher(
            ltol=0.2,
            stol=0.3,
            angle_tol=5.0,
            primitive_cell=False,
            comparator=ElementComparator(),
        )
        rust_match = RustMatcher(
            latt_len_tol=0.2,
            site_pos_tol=0.3,
            angle_tol=5.0,
            primitive_cell=False,
            comparator="element",
        )

        lattice = Lattice.cubic(5.0)
        s_fe2 = Structure(lattice, [Species("Fe", 2)], [[0, 0, 0]])
        s_fe3 = Structure(lattice, [Species("Fe", 3)], [[0, 0, 0]])

        py_result = py_match.fit(s_fe2, s_fe3)
        rust_result = rust_match.fit(
            json.dumps(s_fe2.as_dict()), json.dumps(s_fe3.as_dict())
        )
        assert py_result == rust_result
        assert py_result  # should match when ignoring oxidation states


class TestRmsDistance:
    """RMS distance consistency tests."""

    @pytest.mark.parametrize("magnitude", [0.01, 0.02, 0.03])
    def test_rms_consistency(
        self, py_matcher: PyMatcher, rust_matcher: RustMatcher, magnitude: float
    ) -> None:
        """RMS values should be close between pymatgen and ferrox."""
        struct = Structure(
            Lattice.cubic(5.0), ["Fe", "Fe"], [[0, 0, 0], [0.5, 0.5, 0.5]]
        )
        s_pert = perturb(struct, magnitude, seed=100)

        py_rms = py_matcher.get_rms_dist(struct, s_pert)
        rust_rms = rust_matcher.get_rms_dist(
            json.dumps(struct.as_dict()), json.dumps(s_pert.as_dict())
        )

        if py_rms is not None and rust_rms is not None:
            py_val, rust_val = py_rms[0], rust_rms[0]
            assert abs(py_val - rust_val) < max(0.01, 0.1 * py_val), (
                f"RMS mismatch: py={py_val:.4f}, rust={rust_val:.4f}"
            )
        else:
            assert (py_rms is None) == (rust_rms is None)


class TestBatchOperations:
    """Batch processing tests."""

    def test_group_structures(
        self, py_matcher: PyMatcher, rust_matcher: RustMatcher
    ) -> None:
        """Group operation should match pymatgen."""
        structures = [
            make_cubic("Fe", 2.87),
            make_cubic("Fe", 2.90),  # slightly different, should match
            make_bcc("Fe", 2.87),  # different structure
            make_fcc("Cu", 3.6),
        ]
        json_strs = [json.dumps(s.as_dict()) for s in structures]
        rust_groups = rust_matcher.group(json_strs)

        # Build pymatgen groups
        py_groups: dict[int, list[int]] = {}
        for idx, struct in enumerate(structures):
            found = False
            for canonical, members in py_groups.items():
                if py_matcher.fit(structures[canonical], struct):
                    members.append(idx)
                    found = True
                    break
            if not found:
                py_groups[idx] = [idx]

        py_membership = {frozenset(m) for m in py_groups.values()}
        rust_membership = {frozenset(m) for m in rust_groups.values()}
        assert py_membership == rust_membership


class TestLengthToleranceBounds:
    """Length tolerance should use asymmetric bounds (1/(1+ltol), 1+ltol)."""

    @pytest.fixture
    def matchers_no_scale(self) -> tuple[PyMatcher, RustMatcher]:
        """Matchers with scale=False."""
        return (
            PyMatcher(
                ltol=0.2, stol=0.3, angle_tol=5.0, primitive_cell=False, scale=False
            ),
            RustMatcher(
                latt_len_tol=0.2,
                site_pos_tol=0.3,
                angle_tol=5.0,
                primitive_cell=False,
                scale=False,
            ),
        )

    @pytest.mark.parametrize(
        "scale_factor",
        [0.84, 0.82, 1.0 / 1.2, 1.2, 1.21],
    )
    def test_length_tolerance_bounds(
        self, matchers_no_scale: tuple[PyMatcher, RustMatcher], scale_factor: float
    ) -> None:
        """Test length tolerance boundary behavior."""
        py_match, rust_match = matchers_no_scale
        coords = [[0, 0, 0], [0.5, 0.5, 0.5]]
        s1 = Structure(Lattice.cubic(5.0), ["Na", "Cl"], coords)
        s2 = Structure(Lattice.cubic(5.0 * scale_factor), ["Na", "Cl"], coords)

        py_result = py_match.fit(s1, s2)
        rust_result = rust_match.fit(json.dumps(s1.as_dict()), json.dumps(s2.as_dict()))
        assert py_result == rust_result


class TestRegressionCases:
    """Regression tests for previously problematic cases."""

    def test_acute_28deg_rhomb(self, compare: Callable) -> None:
        """Acute angle rhombohedral lattice (28°)."""
        struct = Structure(
            Lattice.from_parameters(5.0, 5.0, 5.0, 28.0, 28.0, 28.0),
            ["Si"],
            [[0, 0, 0]],
        )
        assert compare(struct, struct) is True

    def test_acute_56deg_rhomb(self, compare: Callable) -> None:
        """Acute angle rhombohedral with multiple sites."""
        struct = Structure(
            Lattice.from_parameters(4.8, 4.8, 4.8, 56.5, 56.5, 56.5),
            ["Mg", "Ni", "F", "F", "F", "F", "F", "F"],
            [
                [0, 0, 0],
                [0.5, 0.5, 0.5],
                [0.25, 0.25, 0.25],
                [0.75, 0.75, 0.75],
                [0.25, 0.75, 0.25],
                [0.75, 0.25, 0.75],
                [0.25, 0.25, 0.75],
                [0.75, 0.75, 0.25],
            ],
        )
        assert compare(struct, struct) is True

    def test_obtuse_103deg(self, compare: Callable) -> None:
        """Obtuse angle lattice (103°)."""
        struct = Structure(
            Lattice.from_parameters(3.7, 3.7, 8.0, 103.4, 103.4, 90.0),
            ["Co"] * 8,
            [
                [0, 0, 0],
                [0.5, 0, 0.25],
                [0, 0.5, 0.25],
                [0.5, 0.5, 0],
                [0, 0, 0.5],
                [0.5, 0, 0.75],
                [0, 0.5, 0.75],
                [0.5, 0.5, 0.5],
            ],
        )
        assert compare(struct, struct) is True

    def test_obtuse_116deg(self, compare: Callable) -> None:
        """Obtuse angle monoclinic lattice (116°)."""
        struct = Structure(
            Lattice.from_parameters(5.0, 5.0, 9.2, 116.4, 105.8, 90.0),
            ["Ca", "O"],
            [[0, 0, 0], [0.5, 0.5, 0.5]],
        )
        assert compare(struct, struct) is True

    def test_obtuse_132deg(self, compare: Callable) -> None:
        """Obtuse angle lattice (gamma=132.8°)."""
        struct = Structure(
            Lattice.from_parameters(5.5, 5.5, 6.5, 90.0, 90.0, 132.8),
            ["La", "La", "Co", "O", "O", "O", "O"],
            [
                [0, 0, 0.36],
                [0, 0, 0.64],
                [0, 0, 0],
                [0.25, 0.25, 0],
                [0.75, 0.75, 0],
                [0, 0.5, 0.18],
                [0.5, 0, 0.82],
            ],
        )
        assert compare(struct, struct) is True

    @pytest.mark.parametrize("num_sites", [100, 200])
    def test_large_structures(self, compare: Callable, num_sites: int) -> None:
        """Large structures with many sites."""
        rng = np.random.default_rng(seed=42 + num_sites)
        struct = Structure(
            Lattice.cubic(10.0 + num_sites / 50),
            ["Si"] * num_sites,
            rng.random((num_sites, 3)).tolist(),
        )
        assert compare(struct, struct) is True


class TestAPIs:
    """Test additional ferrox APIs."""

    def test_find_matches(self) -> None:
        """find_matches should return correct indices."""
        matcher = RustMatcher(
            latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0, primitive_cell=True
        )

        existing = [
            make_rocksalt("Na", "Cl", 5.64),
            make_bcc("Fe", 2.87),
            make_fcc("Cu", 3.6),
        ]
        existing_json = [json.dumps(s.as_dict()) for s in existing]

        # New structures: shifted NaCl (matches 0), Fe BCC (matches 1), unique Si
        new = [
            translate(make_rocksalt("Na", "Cl", 5.64), [0.1, 0.1, 0.1]),
            make_bcc("Fe", 2.87),
            Structure(Lattice.cubic(5.43), ["Si"], [[0, 0, 0]]),
        ]
        new_json = [json.dumps(s.as_dict()) for s in new]

        matches = matcher.find_matches(new_json, existing_json)
        assert matches == [0, 1, None]

    def test_find_matches_empty(self) -> None:
        """find_matches with empty inputs."""
        matcher = RustMatcher(
            latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0, primitive_cell=True
        )
        existing_json = [json.dumps(make_bcc("Fe", 2.87).as_dict())]
        new_json = [json.dumps(make_fcc("Cu", 3.6).as_dict())]

        assert matcher.find_matches([], existing_json) == []
        assert matcher.find_matches(new_json, []) == [None]

    def test_reduce_structure(self) -> None:
        """reduce_structure should preserve properties."""
        matcher = RustMatcher(
            latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0, primitive_cell=True
        )

        struct = make_rocksalt("Na", "Cl", 5.64)
        struct.properties = {"energy": -5.5, "source": "DFT"}

        reduced = matcher.reduce_structure(json.dumps(struct.as_dict()))
        reduced_dict = json.loads(reduced)

        assert "@module" in reduced_dict
        assert "@class" in reduced_dict
        # pymatgen may add default properties like 'charge', so check subset
        props = reduced_dict.get("properties", {})
        assert props.get("energy") == -5.5
        assert props.get("source") == "DFT"

    def test_skip_structure_reduction(self) -> None:
        """fit with skip_structure_reduction should work on pre-reduced structures."""
        matcher = RustMatcher(
            latt_len_tol=0.2, site_pos_tol=0.3, angle_tol=5.0, primitive_cell=True
        )

        struct = make_rocksalt("Na", "Cl", 5.64)
        json_str = json.dumps(struct.as_dict())
        reduced = matcher.reduce_structure(json_str)

        # Pre-reduced structures should match
        assert matcher.fit(reduced, reduced, skip_structure_reduction=True) is True

        # Consistency: normal fit should match skip fit
        struct_shifted = translate(struct, [0.1, 0.1, 0.1])
        reduced_shifted = matcher.reduce_structure(json.dumps(struct_shifted.as_dict()))

        normal_result = matcher.fit(json_str, json.dumps(struct_shifted.as_dict()))
        skip_result = matcher.fit(
            reduced, reduced_shifted, skip_structure_reduction=True
        )
        assert normal_result == skip_result


# === External File Tests (skipped if files not available) ===


@pytest.mark.skipif(
    not MATTERVIZ_STRUCTURES_DIR.exists(),
    reason=f"matterviz structures not found at {MATTERVIZ_STRUCTURES_DIR}",
)
class TestMattervizStructures:
    """Tests using matterviz JSON structure files."""

    @pytest.fixture(scope="class")
    def structures(self) -> dict[str, Structure]:
        """Load matterviz structures."""
        result = {}
        for json_file in MATTERVIZ_STRUCTURES_DIR.glob("*.json"):
            try:
                data = json.loads(json_file.read_text())
                if data.get("@class") == "Structure":
                    result[json_file.stem] = Structure.from_dict(data)
            except (
                json.JSONDecodeError,
                ValueError,
                TypeError,
                KeyError,
                OSError,
            ) as exc:
                warnings.warn(f"Failed to load {json_file.stem}: {exc}", stacklevel=2)
        return result

    def test_self_matching(
        self, compare: Callable, structures: dict[str, Structure]
    ) -> None:
        """All matterviz structures should match themselves."""
        for name, struct in structures.items():
            assert compare(struct, struct) is True, f"Failed: {name}"


@pytest.mark.skipif(
    not PYMATGEN_CIF_DIR.exists(),
    reason=f"pymatgen CIF files not found at {PYMATGEN_CIF_DIR}",
)
class TestPymatgenCifStructures:
    """Tests using pymatgen's test CIF files."""

    @pytest.fixture(scope="class")
    def structures(self) -> dict[str, Structure]:
        """Load pymatgen CIF structures."""
        result = {}
        for cif_file in PYMATGEN_CIF_DIR.glob("*.cif"):
            try:
                result[cif_file.stem] = Structure.from_file(str(cif_file))
            except (ValueError, TypeError, KeyError, OSError) as exc:
                warnings.warn(f"Failed to load {cif_file.stem}: {exc}", stacklevel=2)
        return result

    def test_self_matching(
        self, compare: Callable, structures: dict[str, Structure]
    ) -> None:
        """All pymatgen CIF structures should match themselves."""
        for name, struct in structures.items():
            assert compare(struct, struct) is True, f"Failed: {name}"
