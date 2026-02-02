//! X-ray diffraction calculations.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::xrd;

use super::helpers::{StructureJson, parse_struct};

/// Compute X-ray diffraction pattern.
#[pyfunction]
#[pyo3(signature = (structure, two_theta_range = None, wavelength = 1.5406))]
fn compute_xrd(
    py: Python<'_>,
    structure: StructureJson,
    two_theta_range: Option<(f64, f64)>,
    wavelength: f64,
) -> PyResult<Py<PyDict>> {
    if !wavelength.is_finite() || wavelength <= 0.0 {
        return Err(PyValueError::new_err(
            "wavelength must be positive and finite",
        ));
    }
    if let Some((min_angle, max_angle)) = two_theta_range {
        if !min_angle.is_finite() || !max_angle.is_finite() || min_angle >= max_angle {
            return Err(PyValueError::new_err(
                "two_theta_range must be finite with min < max",
            ));
        }
    }
    let struc = parse_struct(&structure)?;

    let config = xrd::XrdConfig {
        two_theta_range,
        wavelength,
        ..Default::default()
    };
    let pattern = xrd::compute_xrd(&struc, &config);

    let dict = PyDict::new(py);
    dict.set_item("two_theta", &pattern.two_theta)?;
    dict.set_item("intensities", &pattern.intensities)?;
    dict.set_item("d_spacings", &pattern.d_spacings)?;

    // Convert HklInfo to simple arrays
    let hkls: Vec<Vec<[i32; 3]>> = pattern
        .hkls
        .iter()
        .map(|hkl_group| hkl_group.iter().map(|h| h.hkl).collect())
        .collect();
    dict.set_item("hkls", hkls)?;

    Ok(dict.unbind())
}

/// Register the xrd submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "xrd")?;
    submod.add_function(wrap_pyfunction!(compute_xrd, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
