//! Species Python bindings.

use pyo3::prelude::*;

use crate::species::Species as RustSpecies;

/// A chemical species with optional oxidation state.
#[pyclass(name = "Species")]
pub struct PySpecies {
    inner: RustSpecies,
}

#[pymethods]
impl PySpecies {
    /// Create a new Species from a string like "Fe", "Fe2+", "O2-".
    #[new]
    fn new(species_str: &str) -> PyResult<Self> {
        RustSpecies::from_string(species_str)
            .map(|species| PySpecies { inner: species })
            .ok_or_else(|| {
                pyo3::exceptions::PyValueError::new_err(format!(
                    "Invalid species string: {species_str}"
                ))
            })
    }

    /// Element symbol.
    #[getter]
    fn symbol(&self) -> String {
        self.inner.element.symbol().to_string()
    }

    /// Atomic number.
    #[getter]
    fn atomic_number(&self) -> u8 {
        self.inner.element.atomic_number()
    }

    /// Oxidation state (None if neutral/unknown).
    #[getter]
    fn oxidation_state(&self) -> Option<i8> {
        self.inner.oxidation_state
    }

    /// String representation.
    fn __str__(&self) -> String {
        self.inner.to_string()
    }

    /// Repr.
    fn __repr__(&self) -> String {
        format!("Species('{}')", self.inner)
    }

    /// Ionic radius in Angstroms (if available).
    #[getter]
    fn ionic_radius(&self) -> Option<f64> {
        self.inner.ionic_radius()
    }

    /// Atomic radius in Angstroms (if available).
    #[getter]
    fn atomic_radius(&self) -> Option<f64> {
        self.inner.atomic_radius()
    }

    /// Electronegativity (Pauling scale, if available).
    #[getter]
    fn electronegativity(&self) -> Option<f64> {
        self.inner.electronegativity()
    }

    /// Get Shannon ionic radius for specific coordination and spin.
    #[pyo3(signature = (coordination, spin=""))]
    fn shannon_ionic_radius(&self, coordination: &str, spin: &str) -> Option<f64> {
        self.inner.shannon_ionic_radius(coordination, spin)
    }

    /// Covalent radius in Angstroms (if available).
    #[getter]
    fn covalent_radius(&self) -> Option<f64> {
        self.inner.covalent_radius()
    }

    /// Element name.
    #[getter]
    fn name(&self) -> String {
        self.inner.name().to_string()
    }

    /// Atomic mass in amu.
    #[getter]
    fn atomic_mass(&self) -> f64 {
        self.inner.element.atomic_mass()
    }
}

/// Register the species submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "species")?;
    submod.add_class::<PySpecies>()?;
    parent.add_submodule(&submod)?;
    Ok(())
}
