//! Python Element class wrapper.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::element::Element as RustElement;

/// Python wrapper for Element.
///
/// Provides access to element properties like atomic number, mass, electronegativity,
/// oxidation states, radii, and physical properties.
#[pyclass(name = "Element")]
pub struct Element {
    inner: RustElement,
}

#[pymethods]
impl Element {
    /// Create an Element from symbol or atomic number.
    ///
    /// Args:
    ///     symbol_or_z: Element symbol (str like "Fe") or atomic number (int like 26)
    ///
    /// Returns:
    ///     Element object
    ///
    /// Raises:
    ///     ValueError: If the symbol or atomic number is invalid
    #[new]
    fn new(symbol_or_z: &Bound<'_, PyAny>) -> PyResult<Self> {
        if let Ok(symbol) = symbol_or_z.extract::<&str>() {
            RustElement::from_symbol(symbol)
                .map(|elem| Self { inner: elem })
                .ok_or_else(|| PyValueError::new_err(format!("Unknown element symbol: {symbol}")))
        } else if let Ok(z) = symbol_or_z.extract::<u8>() {
            RustElement::from_atomic_number(z)
                .map(|elem| Self { inner: elem })
                .ok_or_else(|| PyValueError::new_err(format!("Invalid atomic number: {z}")))
        } else {
            Err(PyValueError::new_err(
                "Expected element symbol (str) or atomic number (int)",
            ))
        }
    }

    /// Element symbol (e.g., "Fe", "O").
    #[getter]
    fn symbol(&self) -> &'static str {
        self.inner.symbol()
    }

    /// Alias for atomic_number for pymatgen compatibility.
    #[getter]
    fn z(&self) -> u8 {
        self.inner.atomic_number()
    }

    /// Atomic number (1-118 for real elements, 119+ for pseudo-elements).
    #[getter]
    fn atomic_number(&self) -> u8 {
        self.inner.atomic_number()
    }

    /// Atomic mass in atomic mass units (u).
    #[getter]
    fn atomic_mass(&self) -> f64 {
        self.inner.atomic_mass()
    }

    /// Full element name (e.g., "Iron", "Oxygen").
    #[getter]
    fn name(&self) -> &'static str {
        self.inner.name()
    }

    /// Pauling electronegativity (None for noble gases, transactinides).
    #[getter]
    fn electronegativity(&self) -> Option<f64> {
        self.inner.electronegativity()
    }

    /// Periodic table row (1-7).
    #[getter]
    fn row(&self) -> u8 {
        self.inner.row()
    }

    /// Periodic table period (alias for row).
    #[getter]
    fn period(&self) -> u8 {
        self.inner.row()
    }

    /// Periodic table group (1-18).
    #[getter]
    fn group(&self) -> u8 {
        self.inner.group()
    }

    /// Periodic table block ("S", "P", "D", or "F").
    #[getter]
    fn block(&self) -> &'static str {
        self.inner.block().as_str()
    }

    /// Atomic radius in Angstroms.
    #[getter]
    fn atomic_radius(&self) -> Option<f64> {
        self.inner.atomic_radius()
    }

    /// Covalent radius in Angstroms.
    #[getter]
    fn covalent_radius(&self) -> Option<f64> {
        self.inner.covalent_radius()
    }

    /// All known oxidation states.
    #[getter]
    fn oxidation_states(&self) -> Vec<i8> {
        self.inner.oxidation_states().to_vec()
    }

    /// Common oxidation states.
    #[getter]
    fn common_oxidation_states(&self) -> Vec<i8> {
        self.inner.common_oxidation_states().to_vec()
    }

    /// ICSD oxidation states (with >= 10 instances in ICSD).
    #[getter]
    fn icsd_oxidation_states(&self) -> Vec<i8> {
        self.inner.icsd_oxidation_states().to_vec()
    }

    /// Maximum oxidation state.
    #[getter]
    fn max_oxidation_state(&self) -> Option<i8> {
        self.inner.max_oxidation_state()
    }

    /// Minimum oxidation state.
    #[getter]
    fn min_oxidation_state(&self) -> Option<i8> {
        self.inner.min_oxidation_state()
    }

    /// Ionic radius for a specific oxidation state (Angstroms).
    #[pyo3(signature = (oxidation_state))]
    fn ionic_radius(&self, oxidation_state: i8) -> Option<f64> {
        self.inner.ionic_radius(oxidation_state)
    }

    /// All ionic radii as dict mapping oxidation state (str) to radius (float).
    #[getter]
    fn ionic_radii(&self, py: Python<'_>) -> PyResult<Option<Py<PyDict>>> {
        match self.inner.ionic_radii() {
            Some(radii) => {
                let dict = PyDict::new(py);
                for (oxi, radius) in radii {
                    dict.set_item(oxi.to_string(), radius)?;
                }
                Ok(Some(dict.unbind()))
            }
            None => Ok(None),
        }
    }

    /// Full Shannon radii data structure.
    #[getter]
    fn shannon_radii(&self, py: Python<'_>) -> PyResult<Option<Py<PyDict>>> {
        match self.inner.shannon_radii() {
            Some(shannon) => {
                let outer_dict = PyDict::new(py);
                for (oxi_state, coord_map) in shannon {
                    let coord_dict = PyDict::new(py);
                    for (coordination, spin_map) in coord_map {
                        let spin_dict = PyDict::new(py);
                        for (spin, radii_pair) in spin_map {
                            let radii_dict = PyDict::new(py);
                            radii_dict.set_item("crystal_radius", radii_pair.crystal_radius)?;
                            radii_dict.set_item("ionic_radius", radii_pair.ionic_radius)?;
                            spin_dict.set_item(spin, radii_dict)?;
                        }
                        coord_dict.set_item(coordination, spin_dict)?;
                    }
                    outer_dict.set_item(oxi_state.to_string(), coord_dict)?;
                }
                Ok(Some(outer_dict.unbind()))
            }
            None => Ok(None),
        }
    }

    /// Shannon ionic radius for specific oxidation state, coordination, and spin.
    #[pyo3(signature = (oxidation_state, coordination, spin = ""))]
    fn shannon_ionic_radius(
        &self,
        oxidation_state: i8,
        coordination: &str,
        spin: &str,
    ) -> Option<f64> {
        self.inner
            .shannon_ionic_radius(oxidation_state, coordination, spin)
    }

    // Physical properties

    /// Melting point in Kelvin.
    #[getter]
    fn melting_point(&self) -> Option<f64> {
        self.inner.melting_point()
    }

    /// Boiling point in Kelvin.
    #[getter]
    fn boiling_point(&self) -> Option<f64> {
        self.inner.boiling_point()
    }

    /// Density in g/cm³.
    #[getter]
    fn density(&self) -> Option<f64> {
        self.inner.density()
    }

    /// Electron affinity in kJ/mol.
    #[getter]
    fn electron_affinity(&self) -> Option<f64> {
        self.inner.electron_affinity()
    }

    /// First ionization energy in kJ/mol.
    #[getter]
    fn first_ionization_energy(&self) -> Option<f64> {
        self.inner.first_ionization_energy()
    }

    /// All ionization energies in kJ/mol.
    #[getter]
    fn ionization_energies(&self) -> Vec<f64> {
        self.inner.ionization_energies().to_vec()
    }

    /// Molar heat capacity (Cp) in J/(mol·K).
    #[getter]
    fn molar_heat(&self) -> Option<f64> {
        self.inner.molar_heat()
    }

    /// Specific heat capacity in J/(g·K).
    #[getter]
    fn specific_heat(&self) -> Option<f64> {
        self.inner.specific_heat()
    }

    /// Number of valence electrons.
    #[getter]
    fn n_valence(&self) -> Option<u8> {
        self.inner.n_valence()
    }

    /// Electron configuration.
    #[getter]
    fn electron_configuration(&self) -> Option<&'static str> {
        self.inner.electron_configuration()
    }

    /// Semantic electron configuration with noble gas core.
    #[getter]
    fn electron_configuration_semantic(&self) -> Option<&'static str> {
        self.inner.electron_configuration_semantic()
    }

    // Classification methods

    /// True if element is a noble gas.
    fn is_noble_gas(&self) -> bool {
        self.inner.is_noble_gas()
    }

    /// True if element is an alkali metal.
    fn is_alkali(&self) -> bool {
        self.inner.is_alkali()
    }

    /// True if element is an alkaline earth metal.
    fn is_alkaline(&self) -> bool {
        self.inner.is_alkaline()
    }

    /// True if element is a halogen.
    fn is_halogen(&self) -> bool {
        self.inner.is_halogen()
    }

    /// True if element is a chalcogen.
    fn is_chalcogen(&self) -> bool {
        self.inner.is_chalcogen()
    }

    /// True if element is a lanthanoid.
    fn is_lanthanoid(&self) -> bool {
        self.inner.is_lanthanoid()
    }

    /// True if element is an actinoid.
    fn is_actinoid(&self) -> bool {
        self.inner.is_actinoid()
    }

    /// True if element is a transition metal.
    fn is_transition_metal(&self) -> bool {
        self.inner.is_transition_metal()
    }

    /// True if element is a post-transition metal.
    fn is_post_transition_metal(&self) -> bool {
        self.inner.is_post_transition_metal()
    }

    /// True if element is a metalloid.
    fn is_metalloid(&self) -> bool {
        self.inner.is_metalloid()
    }

    /// True if element is a metal.
    fn is_metal(&self) -> bool {
        self.inner.is_metal()
    }

    /// True if element is radioactive.
    fn is_radioactive(&self) -> bool {
        self.inner.is_radioactive()
    }

    /// True if element is a rare earth.
    fn is_rare_earth(&self) -> bool {
        self.inner.is_rare_earth()
    }

    /// True if element is a pseudo-element.
    fn is_pseudo(&self) -> bool {
        self.inner.is_pseudo()
    }

    fn __repr__(&self) -> String {
        format!("Element(\"{}\")", self.inner.symbol())
    }

    fn __str__(&self) -> &'static str {
        self.inner.symbol()
    }

    fn __eq__(&self, other: &Self) -> bool {
        self.inner == other.inner
    }

    fn __hash__(&self) -> isize {
        self.inner.atomic_number() as isize
    }
}
