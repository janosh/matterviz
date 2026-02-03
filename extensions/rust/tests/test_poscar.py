"""Tests for POSCAR parsing functionality."""

from __future__ import annotations

import pytest

try:
    from ferrox import io as ferrox_io
except ImportError:
    pytest.skip("ferrox not installed", allow_module_level=True)


# === Basic POSCAR Parsing Tests ===


class TestBasicPoscar:
    """Tests for basic POSCAR parsing functionality."""

    def test_simple_cubic(self) -> None:
        """Parse simple cubic structure."""
        poscar = """Simple cubic
1.0
  4.0  0.0  0.0
  0.0  4.0  0.0
  0.0  0.0  4.0
Fe
1
Direct
  0.0  0.0  0.0
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 1
        assert structure["sites"][0]["species"][0]["element"] == "Fe"
        # Check lattice
        matrix = structure["lattice"]["matrix"]
        assert matrix[0][0] == pytest.approx(4.0)
        assert matrix[1][1] == pytest.approx(4.0)
        assert matrix[2][2] == pytest.approx(4.0)

    def test_bcc_structure(self) -> None:
        """Parse BCC structure with 2 atoms."""
        poscar = """BCC Fe
1.0
  2.87  0.0  0.0
  0.0  2.87  0.0
  0.0  0.0  2.87
Fe
2
Direct
  0.0  0.0  0.0
  0.5  0.5  0.5
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 2
        # Check fractional coords
        assert structure["sites"][0]["abc"][0] == pytest.approx(0.0)
        assert structure["sites"][1]["abc"][0] == pytest.approx(0.5)

    def test_fcc_structure(self) -> None:
        """Parse FCC structure with 4 atoms."""
        poscar = """FCC Al
1.0
  4.05  0.0  0.0
  0.0  4.05  0.0
  0.0  0.0  4.05
Al
4
Direct
  0.0  0.0  0.0
  0.5  0.5  0.0
  0.5  0.0  0.5
  0.0  0.5  0.5
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 4
        assert all(site["species"][0]["element"] == "Al" for site in structure["sites"])

    def test_multi_element(self) -> None:
        """Parse structure with multiple elements."""
        poscar = """NaCl
1.0
  5.64  0.0  0.0
  0.0  5.64  0.0
  0.0  0.0  5.64
Na Cl
4 4
Direct
  0.0  0.0  0.0
  0.5  0.5  0.0
  0.5  0.0  0.5
  0.0  0.5  0.5
  0.5  0.0  0.0
  0.0  0.5  0.0
  0.0  0.0  0.5
  0.5  0.5  0.5
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 8
        na_count = sum(
            1 for site in structure["sites"] if site["species"][0]["element"] == "Na"
        )
        cl_count = sum(
            1 for site in structure["sites"] if site["species"][0]["element"] == "Cl"
        )
        assert na_count == 4
        assert cl_count == 4


# === Scale Factor Tests ===


class TestScaleFactor:
    """Tests for scale factor handling."""

    def test_scale_factor_positive(self) -> None:
        """Positive scale factor multiplies lattice vectors."""
        poscar = """Scaled
2.0
  1.0  0.0  0.0
  0.0  1.0  0.0
  0.0  0.0  1.0
H
1
Direct
  0.0  0.0  0.0
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        matrix = structure["lattice"]["matrix"]
        # Scale 2.0 * unit vectors = 2.0
        assert matrix[0][0] == pytest.approx(2.0)
        assert matrix[1][1] == pytest.approx(2.0)
        assert matrix[2][2] == pytest.approx(2.0)

    def test_scale_factor_fractional(self) -> None:
        """Fractional scale factor."""
        poscar = """Scaled
1.1
  10.0  0.0  0.0
  0.0  6.0  0.0
  0.0  0.0  4.7
Fe
1
Direct
  0.0  0.0  0.0
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        matrix = structure["lattice"]["matrix"]
        assert matrix[0][0] == pytest.approx(11.0)
        assert matrix[1][1] == pytest.approx(6.6)
        assert matrix[2][2] == pytest.approx(5.17)

    def test_negative_scale_volume(self) -> None:
        """Negative scale factor specifies target volume."""
        # -27.0 means target volume of 27 Å³
        # For a 1x1x1 cube, scale should be cbrt(27) = 3.0
        poscar = """Volume scaling
-27.0
  1.0  0.0  0.0
  0.0  1.0  0.0
  0.0  0.0  1.0
H
1
Direct
  0.0  0.0  0.0
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        matrix = structure["lattice"]["matrix"]
        # cbrt(27) = 3.0
        assert matrix[0][0] == pytest.approx(3.0)
        assert matrix[1][1] == pytest.approx(3.0)
        assert matrix[2][2] == pytest.approx(3.0)

    def test_negative_scale_non_cubic(self) -> None:
        """Negative scale with non-cubic cell."""
        # -8.0 means target volume of 8 Å³
        # For 2x2x2 box (vol=8), scale should be 1.0
        poscar = """Volume scaling non-cubic
-8.0
  2.0  0.0  0.0
  0.0  2.0  0.0
  0.0  0.0  2.0
H
1
Direct
  0.0  0.0  0.0
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        matrix = structure["lattice"]["matrix"]
        # Already has volume 8, scale should be 1.0
        assert matrix[0][0] == pytest.approx(2.0)
        assert matrix[1][1] == pytest.approx(2.0)
        assert matrix[2][2] == pytest.approx(2.0)


# === Coordinate Type Tests ===


class TestCoordinateType:
    """Tests for Direct vs Cartesian coordinates."""

    def test_direct_coordinates(self) -> None:
        """Parse Direct (fractional) coordinates."""
        poscar = """Direct coords
1.0
  4.0  0.0  0.0
  0.0  4.0  0.0
  0.0  0.0  4.0
H
1
Direct
  0.5  0.5  0.5
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        # Fractional coords should be 0.5
        assert structure["sites"][0]["abc"][0] == pytest.approx(0.5)
        assert structure["sites"][0]["abc"][1] == pytest.approx(0.5)
        assert structure["sites"][0]["abc"][2] == pytest.approx(0.5)

    def test_cartesian_coordinates(self) -> None:
        """Parse Cartesian coordinates."""
        poscar = """Cartesian coords
1.0
  4.0  0.0  0.0
  0.0  4.0  0.0
  0.0  0.0  4.0
H
1
Cartesian
  2.0  2.0  2.0
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        # Cart 2.0 in 4.0 box = frac 0.5
        assert structure["sites"][0]["abc"][0] == pytest.approx(0.5)
        assert structure["sites"][0]["abc"][1] == pytest.approx(0.5)
        assert structure["sites"][0]["abc"][2] == pytest.approx(0.5)

    def test_cartesian_with_scale(self) -> None:
        """Cartesian coordinates with scale factor."""
        poscar = """Cartesian with scale
2.0
  2.0  0.0  0.0
  0.0  2.0  0.0
  0.0  0.0  2.0
H
1
Cartesian
  1.0  1.0  1.0
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        # Scale 2.0: lattice is 4.0x4.0x4.0
        # Cartesian 1.0 * scale 2.0 = 2.0 in 4.0 box = frac 0.5
        assert structure["sites"][0]["abc"][0] == pytest.approx(0.5)

    @pytest.mark.parametrize(
        "coord_type",
        [pytest.param("direct", id="lowercase"), pytest.param("c", id="abbreviated_c")],
    )
    def test_coord_type_variations(self, coord_type: str) -> None:
        """Coordinate type accepts lowercase and abbreviated forms."""
        # Both direct (lowercase) and c (cartesian) should parse to frac 0.5
        coord = "0.5 0.5 0.5" if coord_type == "direct" else "2.0 2.0 2.0"
        poscar = f"test\n1.0\n4 0 0\n0 4 0\n0 0 4\nH\n1\n{coord_type}\n{coord}\n"
        structure = ferrox_io.parse_poscar_str(poscar)
        assert structure["sites"][0]["abc"][0] == pytest.approx(0.5)


# === Selective Dynamics Tests ===


class TestSelectiveDynamics:
    """Tests for Selective dynamics handling."""

    @pytest.mark.parametrize(
        ("coord_type", "coords", "expected_frac"),
        [
            pytest.param(
                "Direct", "0 0 0 T T T\n  0.5 0.5 0.5 F F F", [0.0, 0.5], id="direct"
            ),
            pytest.param("Cartesian", "2 2 2 T F T", [0.5], id="cartesian"),
        ],
    )
    def test_selective_dynamics(
        self, coord_type: str, coords: str, expected_frac: list[float]
    ) -> None:
        """Selective dynamics parses correctly with Direct and Cartesian coords."""
        poscar = f"""Selective dynamics
1.0
  4.0  0.0  0.0
  0.0  4.0  0.0
  0.0  0.0  4.0
Fe
{len(expected_frac)}
Selective dynamics
{coord_type}
  {coords}
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == len(expected_frac)
        for idx, expected in enumerate(expected_frac):
            assert structure["sites"][idx]["abc"][0] == pytest.approx(expected)


# === Element Symbol Variations ===


class TestElementSymbols:
    """Tests for various element symbol formats."""

    def test_element_at_line_end(self) -> None:
        """Element symbol at end of coordinate line (pymatgen style)."""
        poscar = """Element at end
1.0
  4.0  0.0  0.0
  0.0  4.0  0.0
  0.0  0.0  4.0
Fe O
2 1
Direct
  0.0  0.0  0.0 Fe
  0.5  0.5  0.0 Fe
  0.5  0.5  0.5 O
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 3
        assert structure["sites"][0]["species"][0]["element"] == "Fe"
        assert structure["sites"][2]["species"][0]["element"] == "O"

    def test_vasp6_potcar_hash(self) -> None:
        """VASP 6.4.2+ format with POTCAR hash in symbol."""
        poscar = """VASP 6.4.2 format
1.0
  4.0  0.0  0.0
  0.0  4.0  0.0
  0.0  0.0  4.0
Mg_pv/f474ac0d Si/79d9987ad87
1 1
Direct
  0.0  0.0  0.0
  0.5  0.5  0.5
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 2
        assert structure["sites"][0]["species"][0]["element"] == "Mg"
        assert structure["sites"][1]["species"][0]["element"] == "Si"

    def test_elements_starting_with_s_c_d(self) -> None:
        """Elements starting with S, C, D must not be confused with coordinate type lines."""
        # S (Sulfur), C (Carbon), Dy (Dysprosium) start with letters used for
        # coordinate types (Selective/Cartesian/Direct) - parser must handle this
        poscar = """S C Dy test
1.0
  5.0  0.0  0.0
  0.0  5.0  0.0
  0.0  0.0  5.0
S C Dy
1 1 1
Direct
  0.0  0.0  0.0
  0.3  0.3  0.3
  0.6  0.6  0.6
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 3
        elements = [site["species"][0]["element"] for site in structure["sites"]]
        assert elements == ["S", "C", "Dy"]

    def test_element_with_underscore(self) -> None:
        """Element with underscore variant (Fe_pv, etc.)."""
        poscar = """Element variant
1.0
  4.0  0.0  0.0
  0.0  4.0  0.0
  0.0  0.0  4.0
Fe_pv O_s
2 1
Direct
  0.0  0.0  0.0
  0.5  0.5  0.0
  0.5  0.5  0.5
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert structure["sites"][0]["species"][0]["element"] == "Fe"
        assert structure["sites"][2]["species"][0]["element"] == "O"


# === Multi-line Symbol/Count Tests ===


class TestMultilineSymbols:
    """Tests for multi-line element symbols and counts."""

    def test_many_elements_multiline(self) -> None:
        """Many elements requiring multi-line symbols/counts."""
        poscar = """Multi-element
1.0
  10.0  0.0  0.0
  0.0  10.0  0.0
  0.0  0.0  10.0
Fe Cr Ni
1 1 1
Direct
  0.0  0.0  0.0
  0.3  0.3  0.3
  0.6  0.6  0.6
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 3
        elements = [site["species"][0]["element"] for site in structure["sites"]]
        assert elements == ["Fe", "Cr", "Ni"]


# === Lattice Vector Tests ===


class TestLatticeVectors:
    """Tests for various lattice configurations."""

    def test_triclinic_lattice(self) -> None:
        """Parse triclinic (fully general) lattice."""
        poscar = """Triclinic
1.0
  4.0  0.5  0.2
  0.3  5.0  0.4
  0.1  0.2  6.0
H
1
Direct
  0.25  0.25  0.25
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        matrix = structure["lattice"]["matrix"]
        assert matrix[0][0] == pytest.approx(4.0)
        assert matrix[0][1] == pytest.approx(0.5)
        assert matrix[1][2] == pytest.approx(0.4)
        assert matrix[2][2] == pytest.approx(6.0)

    def test_hexagonal_lattice(self) -> None:
        """Parse hexagonal lattice."""
        import math

        a = 3.0
        c = 5.0
        poscar = f"""Hexagonal
1.0
  {a}  0.0  0.0
  {-a / 2}  {a * math.sqrt(3) / 2}  0.0
  0.0  0.0  {c}
Zn
2
Direct
  0.333333  0.666667  0.25
  0.666667  0.333333  0.75
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 2
        matrix = structure["lattice"]["matrix"]
        assert matrix[0][0] == pytest.approx(3.0)


# === Error Handling Tests ===


class TestErrorHandling:
    """Tests for error handling."""

    @pytest.mark.parametrize(
        ("poscar", "match"),
        [
            pytest.param(
                "VASP 4\n1.0\n4 0 0\n0 4 0\n0 0 4\n2\nDirect\n0 0 0\n0.5 0.5 0.5\n",
                "VASP 4 format",
                id="vasp4_format",
            ),
            pytest.param(
                "Bad element\n1.0\n4 0 0\n0 4 0\n0 0 4\nZz\n1\nDirect\n0 0 0\n",
                "Unknown element",
                id="invalid_element",
            ),
            pytest.param(
                "Missing\n1.0\n4 0 0\n0 4 0\n0 0 4\nFe\n3\nDirect\n0 0 0\n0.5 0.5 0.5\n",
                "Expected 3 coordinates",
                id="missing_coords",
            ),
            pytest.param(
                "Bad scale\nabc\n4 0 0\n0 4 0\n0 0 4\nFe\n1\nDirect\n0 0 0\n",
                "Invalid scale factor",
                id="invalid_scale",
            ),
            pytest.param(
                "Mismatch\n1.0\n4 0 0\n0 4 0\n0 0 4\nFe Ni Cu\n1 2\nDirect\n0 0 0\n",
                "doesn't match",
                id="mismatched_counts",
            ),
            pytest.param(
                "Short\n1.0\n4 0 0\n",
                "at least 8 lines",
                id="too_few_lines",
            ),
        ],
    )
    def test_invalid_poscar(self, poscar: str, match: str) -> None:
        """Invalid POSCAR content raises appropriate error."""
        with pytest.raises(ValueError, match=match):
            ferrox_io.parse_poscar_str(poscar)


# === Real-world POSCAR Tests ===


class TestRealWorldPoscar:
    """Tests with real-world POSCAR examples."""

    def test_fe4p4o16_pymatgen(self) -> None:
        """Fe4P4O16 structure from pymatgen tests (negative volume scale)."""
        poscar = """Fe4P4O16
-300.65685512
    10.4117668700     0.0000000000     0.0000000000
     0.0000000000     6.0671718800     0.0000000000
     0.0000000000     0.0000000000     4.7594895400
Fe P O
4 4 16
direct
     0.2187282200     0.7500000000     0.4748671100
     0.2812717800     0.2500000000     0.9748671100
     0.7187282200     0.7500000000     0.0251328900
     0.7812717800     0.2500000000     0.5251328900
     0.0946130900     0.2500000000     0.4182432700
     0.4053869100     0.7500000000     0.9182432700
     0.5946130900     0.2500000000     0.0817567300
     0.9053869100     0.7500000000     0.5817567300
     0.0433723100     0.7500000000     0.7071376700
     0.0966424400     0.2500000000     0.7413203500
     0.1657097400     0.0460723300     0.2853839400
     0.1657097400     0.4539276700     0.2853839400
     0.3342902600     0.5460723300     0.7853839400
     0.3342902600     0.9539276700     0.7853839400
     0.4033575600     0.7500000000     0.2413203500
     0.4566276900     0.2500000000     0.2071376700
     0.5433723100     0.7500000000     0.7928623300
     0.5966424400     0.2500000000     0.7586796500
     0.6657097400     0.0460723300     0.2146160600
     0.6657097400     0.4539276700     0.2146160600
     0.8342902600     0.5460723300     0.7146160600
     0.8342902600     0.9539276700     0.7146160600
     0.9033575600     0.7500000000     0.2586796500
     0.9566276900     0.2500000000     0.2928623300
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 24
        # Count elements
        elements = [site["species"][0]["element"] for site in structure["sites"]]
        assert elements.count("Fe") == 4
        assert elements.count("P") == 4
        assert elements.count("O") == 16

    def test_silicon_diamond(self) -> None:
        """Silicon diamond structure."""
        poscar = """Si diamond
5.43
  0.0  0.5  0.5
  0.5  0.0  0.5
  0.5  0.5  0.0
Si
2
Direct
  0.0   0.0   0.0
  0.25  0.25  0.25
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 2
        # Lattice should be scaled by 5.43
        matrix = structure["lattice"]["matrix"]
        assert matrix[0][1] == pytest.approx(5.43 * 0.5)

    def test_h2_bcc(self) -> None:
        """Simple H2 BCC test case."""
        poscar = """H2
1.0
   1.0000000000000000    0.0000000000000000    0.0000000000000000
   0.0000000000000000    1.0000000000000000    0.0000000000000000
   0.0000000000000000    0.0000000000000000    1.0000000000000000
H
2
direct
   0.0000000000000000    0.0000000000000000    0.0000000000000000 H
   0.5000000000000000    0.5000000000000000    0.5000000000000000 H
"""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 2
        assert structure["sites"][0]["abc"][0] == pytest.approx(0.0)
        assert structure["sites"][1]["abc"][0] == pytest.approx(0.5)


# === Whitespace Handling Tests ===


class TestWhitespace:
    """Tests for various whitespace patterns."""

    @pytest.mark.parametrize(
        "poscar",
        [
            pytest.param(
                "  Spaces\n  1.0\n    4 0 0\n    0 4 0\n    0 0 4\n  Fe\n  1\n  Direct\n    0 0 0\n",
                id="extra_spaces",
            ),
            pytest.param(
                "Tabs\n1.0\n\t4\t0\t0\n\t0\t4\t0\n\t0\t0\t4\nFe\n1\nDirect\n\t0\t0\t0\n",
                id="tabs",
            ),
        ],
    )
    def test_whitespace_variations(self, poscar: str) -> None:
        """Parser handles various whitespace patterns."""
        structure = ferrox_io.parse_poscar_str(poscar)
        assert len(structure["sites"]) == 1
