"""Tests for Element class and composition functions in ferrox."""

import pytest
from ferrox import Element, composition, rdf


class TestElement:
    """Test Element class functionality."""

    def test_create_from_symbol(self) -> None:
        """Element can be created from symbol string."""
        fe = Element("Fe")
        assert fe.symbol == "Fe"
        assert fe.atomic_number == 26

    def test_create_from_atomic_number(self) -> None:
        """Element can be created from atomic number."""
        fe = Element(26)
        assert fe.symbol == "Fe"

    def test_invalid_symbol_raises(self) -> None:
        """Invalid symbol raises ValueError."""
        with pytest.raises(ValueError, match="Unknown element"):
            Element("Zz")  # Not a valid element or alias

    def test_invalid_atomic_number_raises(self) -> None:
        """Invalid atomic number raises ValueError."""
        with pytest.raises(ValueError, match="Invalid atomic number"):
            Element(200)

    @pytest.mark.parametrize(
        ("symbol", "expected_name"),
        [
            ("H", "Hydrogen"),
            ("Fe", "Iron"),
            ("Au", "Gold"),
            ("O", "Oxygen"),
        ],
    )
    def test_element_name(self, symbol: str, expected_name: str) -> None:
        """Element name matches expected value."""
        assert Element(symbol).name == expected_name

    @pytest.mark.parametrize(
        ("symbol", "expected_mass"),
        [
            ("H", 1.008),
            ("C", 12.011),
            ("Fe", 55.845),
        ],
    )
    def test_atomic_mass(self, symbol: str, expected_mass: float) -> None:
        """Atomic mass is correct within tolerance."""
        assert abs(Element(symbol).atomic_mass - expected_mass) < 0.01

    def test_electronegativity(self) -> None:
        """Electronegativity is correct for Fe."""
        fe = Element("Fe")
        assert fe.electronegativity is not None
        assert abs(fe.electronegativity - 1.83) < 0.01

    def test_noble_gas_no_electronegativity(self) -> None:
        """Noble gases have no electronegativity."""
        he = Element("He")
        assert he.electronegativity is None

    @pytest.mark.parametrize(
        ("symbol", "expected_row", "expected_group"),
        [
            ("H", 1, 1),
            ("He", 1, 18),
            ("Fe", 4, 8),
            ("Au", 6, 11),
        ],
    )
    def test_row_and_group(
        self, symbol: str, expected_row: int, expected_group: int
    ) -> None:
        """Row and group are correct."""
        elem = Element(symbol)
        assert elem.row == expected_row
        assert elem.group == expected_group

    @pytest.mark.parametrize(
        ("symbol", "expected_block"),
        [
            ("H", "S"),
            ("C", "P"),
            ("Fe", "D"),
            ("Ce", "F"),
        ],
    )
    def test_block(self, symbol: str, expected_block: str) -> None:
        """Block is correct."""
        assert Element(symbol).block == expected_block

    def test_oxidation_states(self) -> None:
        """Fe has expected oxidation states."""
        fe = Element("Fe")
        oxi = fe.oxidation_states
        assert 2 in oxi
        assert 3 in oxi

    def test_classification_methods(self) -> None:
        """Classification methods work correctly."""
        fe = Element("Fe")
        assert fe.is_transition_metal()
        assert fe.is_metal()
        assert not fe.is_noble_gas()
        assert not fe.is_halogen()

        he = Element("He")
        assert he.is_noble_gas()
        assert not he.is_metal()

        cl = Element("Cl")
        assert cl.is_halogen()

    def test_physical_properties(self) -> None:
        """Physical properties are available."""
        fe = Element("Fe")
        assert fe.melting_point is not None
        assert fe.melting_point > 1800  # Fe melts at ~1811 K
        assert fe.boiling_point is not None
        assert fe.density is not None
        assert fe.density > 7  # Fe density ~7.87 g/cm³

    def test_ionization_energies(self) -> None:
        """Ionization energies are available."""
        fe = Element("Fe")
        ie = fe.ionization_energies
        assert len(ie) > 0
        # First ionization energy should be positive
        assert ie[0] > 0

    def test_electron_configuration(self) -> None:
        """Electron configuration is available."""
        fe = Element("Fe")
        assert fe.electron_configuration is not None
        assert "3d6" in fe.electron_configuration or "3d" in fe.electron_configuration
        assert fe.electron_configuration_semantic is not None

    def test_element_equality(self) -> None:
        """Elements with same atomic number are equal."""
        fe1 = Element("Fe")
        fe2 = Element(26)
        assert fe1 == fe2

    def test_element_repr(self) -> None:
        """Element has meaningful repr."""
        fe = Element("Fe")
        assert "Fe" in repr(fe)

    def test_element_str(self) -> None:
        """Element str is symbol."""
        fe = Element("Fe")
        assert str(fe) == "Fe"

    @pytest.mark.parametrize(
        ("symbol", "oxi_state", "expected_radius"),
        [
            ("Fe", "2", 0.92),  # Fe2+ high spin ~0.92 Å
            ("Fe", "3", 0.785),  # Fe3+ high spin ~0.785 Å
            ("O", "-2", 1.26),  # O2- ~1.26 Å
            ("Na", "1", 1.16),  # Na+ ~1.16 Å
        ],
    )
    def test_ionic_radii(
        self, symbol: str, oxi_state: str, expected_radius: float
    ) -> None:
        """ionic_radii returns dict with expected values."""
        radii = Element(symbol).ionic_radii
        assert radii is not None
        assert oxi_state in radii
        assert abs(radii[oxi_state] - expected_radius) < 0.1
        assert all(0.3 < r < 2.0 for r in radii.values())

    def test_ionic_radii_none_for_noble_gas(self) -> None:
        """Noble gases have no ionic radii data."""
        assert Element("He").ionic_radii is None

    def test_shannon_radii(self) -> None:
        """shannon_radii returns nested dict with expected structure."""
        shannon = Element("Fe").shannon_radii
        assert shannon is not None
        # Structure: oxi_state -> coordination -> spin -> {crystal_radius, ionic_radius}
        first_entry = next(
            iter(next(iter(next(iter(shannon.values())).values())).values())
        )
        assert "crystal_radius" in first_entry and "ionic_radius" in first_entry
        # VI (octahedral) coordination should be present
        all_coords = {c for coord_map in shannon.values() for c in coord_map}
        assert "VI" in all_coords or "6" in all_coords

    def test_shannon_radii_none_for_noble_gas(self) -> None:
        """Noble gases have no Shannon radii data."""
        assert Element("He").shannon_radii is None


class TestCompositionFunctions:
    """Test new composition functions."""

    def test_get_atomic_fraction(self) -> None:
        """Atomic fraction is correct."""
        # Fe2O3: 2 Fe out of 5 atoms = 0.4
        assert abs(composition.get_atomic_fraction("Fe2O3", "Fe") - 0.4) < 1e-6
        assert abs(composition.get_atomic_fraction("Fe2O3", "O") - 0.6) < 1e-6

    def test_get_atomic_fraction_absent_element(self) -> None:
        """Atomic fraction is 0 for absent element."""
        assert composition.get_atomic_fraction("Fe2O3", "Ca") == 0.0

    def test_get_wt_fraction(self) -> None:
        """Weight fraction is correct."""
        # Fe2O3: Fe wt% ~70%
        wt_fe = composition.get_wt_fraction("Fe2O3", "Fe")
        assert 0.69 < wt_fe < 0.71

    def test_reduced_composition(self) -> None:
        """Reduced composition simplifies formula."""
        reduced = composition.reduced_composition("Fe4O6")
        assert abs(reduced["Fe"] - 2.0) < 1e-6
        assert abs(reduced["O"] - 3.0) < 1e-6

    def test_fractional_composition(self) -> None:
        """Fractional composition sums to 1."""
        frac = composition.fractional_composition("Fe2O3")
        total = sum(frac.values())
        assert abs(total - 1.0) < 1e-6

    def test_compositions_almost_equal(self) -> None:
        """Almost equal compositions are detected."""
        assert composition.compositions_almost_equal("Fe2O3", "Fe2O3")
        # Note: almost_equals compares actual amounts, not reduced formula
        # Fe4O6 has 4 Fe, Fe2O3 has 2 Fe, so they're not almost equal
        assert not composition.compositions_almost_equal("Fe4O6", "Fe2O3")
        assert not composition.compositions_almost_equal("Fe2O3", "FeO")

    def test_formula_hash_same_for_equivalent_formulas(self) -> None:
        """formula_hash gives same value for equivalent reduced formulas."""
        # Same formula written differently
        hash1 = composition.formula_hash("Fe2O3")
        hash2 = composition.formula_hash("O3Fe2")  # Different order, same composition
        assert hash1 == hash2

    def test_formula_hash_different_for_different_formulas(self) -> None:
        """formula_hash gives different values for different compositions."""
        hash_fe2o3 = composition.formula_hash("Fe2O3")
        hash_feo = composition.formula_hash("FeO")
        assert hash_fe2o3 != hash_feo

    def test_formula_hash_same_for_multiples(self) -> None:
        """formula_hash is same for multiples of same reduced formula."""
        hash1 = composition.formula_hash("Fe2O3")
        hash2 = composition.formula_hash("Fe4O6")  # 2x Fe2O3
        assert hash1 == hash2

    def test_species_hash_returns_integer(self) -> None:
        """species_hash returns an integer hash value."""
        hash_val = composition.species_hash("Fe2O3")
        assert isinstance(hash_val, int)
        assert hash_val > 0

    def test_species_hash_different_for_different_compositions(self) -> None:
        """species_hash differs for different compositions."""
        hash1 = composition.species_hash("Fe2O3")
        hash2 = composition.species_hash("FeO")
        assert hash1 != hash2

    @pytest.mark.parametrize(
        ("formula", "mapping", "expected"),
        [
            ("Fe2O3", {"Fe": "Co"}, {"Co": 2.0, "O": 3.0}),
            ("NaCl", {"Na": "K", "Cl": "Br"}, {"K": 1.0, "Br": 1.0}),
        ],
    )
    def test_remap_elements(self, formula: str, mapping: dict, expected: dict) -> None:
        """remap_elements correctly substitutes elements."""
        result = composition.remap_elements(formula, mapping)
        for elem, amt in expected.items():
            assert elem in result
            assert abs(result[elem] - amt) < 1e-6
        # Original elements should be replaced
        for old_elem in mapping:
            assert old_elem not in result

    def test_remap_elements_invalid_element_raises(self) -> None:
        """remap_elements raises for invalid element symbols."""
        with pytest.raises(ValueError, match="Unknown element"):
            composition.remap_elements("Fe2O3", {"Fe": "Zz"})

    @pytest.mark.parametrize(
        ("formula", "expected_factor"),
        [
            ("Fe2O3", 1.0),  # Already reduced
            ("Fe4O6", 2.0),  # 2x Fe2O3
            ("H2O", 1.0),
            ("H4O2", 2.0),  # 2x H2O
            ("H6O3", 3.0),  # 3x H2O
            ("NaCl", 1.0),
            ("Na2Cl2", 2.0),
        ],
    )
    def test_get_reduced_factor(self, formula: str, expected_factor: float) -> None:
        """get_reduced_factor returns expected factors."""
        assert abs(composition.get_reduced_factor(formula) - expected_factor) < 1e-6


class TestRdfFunctions:
    """Test RDF function exports."""

    @pytest.mark.parametrize(
        "func_name",
        ["compute_rdf", "compute_element_rdf", "compute_all_element_rdfs"],
    )
    def test_rdf_functions_exported(self, func_name: str) -> None:
        """RDF functions are exported."""
        assert hasattr(rdf, func_name)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
