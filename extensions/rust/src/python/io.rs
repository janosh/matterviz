//! File I/O and format conversion functions.
//!
//! This module provides functions for reading and writing structure files
//! in various formats, as well as converting between ferrox, pymatgen, and ASE.

use std::path::Path;

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::io::{
    parse_extxyz_trajectory, parse_structure, parse_structure_json, structure_to_extxyz,
    structure_to_poscar, structure_to_pymatgen_json, write_structure,
};

use super::helpers::{StructureJson, json_to_pydict, parse_struct, structure_to_pydict};

// === Structure Reading Functions ===

/// Parse a structure file (auto-detects format from extension).
#[pyfunction]
fn parse_structure_file(py: Python<'_>, path: &str) -> PyResult<Py<PyDict>> {
    let structure = parse_structure(Path::new(path))
        .map_err(|err| PyValueError::new_err(format!("Error parsing {path}: {err}")))?;
    Ok(structure_to_pydict(py, &structure)?.unbind())
}

/// Parse trajectory file (extXYZ format).
#[pyfunction]
fn parse_trajectory(py: Python<'_>, path: &str) -> PyResult<Vec<Py<PyDict>>> {
    let frames = parse_extxyz_trajectory(Path::new(path))
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let mut results = Vec::new();
    for frame_result in frames {
        let structure = frame_result
            .map_err(|err| PyValueError::new_err(format!("Frame parse error: {err}")))?;
        results.push(structure_to_pydict(py, &structure)?.unbind());
    }
    Ok(results)
}

// === Structure Writing Functions ===

/// Write a structure to a file with automatic format detection.
#[pyfunction]
fn write_structure_file(structure: StructureJson, path: &str) -> PyResult<()> {
    let struc = parse_struct(&structure)?;
    write_structure(&struc, Path::new(path))
        .map_err(|err| PyValueError::new_err(format!("Error writing {path}: {err}")))
}

/// Convert a structure to POSCAR format string.
#[pyfunction]
#[pyo3(signature = (structure, comment = None))]
fn to_poscar(structure: StructureJson, comment: Option<&str>) -> PyResult<String> {
    let struc = parse_struct(&structure)?;
    Ok(structure_to_poscar(&struc, comment))
}

/// Convert a structure to CIF format string.
#[pyfunction]
#[pyo3(signature = (structure, data_name = None))]
fn to_cif(structure: StructureJson, data_name: Option<&str>) -> PyResult<String> {
    let struc = parse_struct(&structure)?;
    Ok(crate::cif::structure_to_cif(&struc, data_name))
}

/// Convert a structure to extXYZ format string.
#[pyfunction]
fn to_extxyz(structure: StructureJson) -> PyResult<String> {
    let struc = parse_struct(&structure)?;
    Ok(structure_to_extxyz(&struc, None))
}

/// Convert a structure to pymatgen JSON format string.
#[pyfunction]
fn to_pymatgen_json(structure: StructureJson) -> PyResult<String> {
    let struc = parse_struct(&structure)?;
    Ok(structure_to_pymatgen_json(&struc))
}

/// Alias for to_pymatgen_json for convenience.
#[pyfunction]
fn to_json(structure: StructureJson) -> PyResult<String> {
    let struc = parse_struct(&structure)?;
    Ok(structure_to_pymatgen_json(&struc))
}

// === Molecule I/O Functions ===

/// Parse a molecule from pymatgen Molecule JSON format.
#[pyfunction]
fn parse_molecule_json(py: Python<'_>, json_str: &str) -> PyResult<Py<PyDict>> {
    let mol = crate::io::parse_molecule_json(json_str)
        .map_err(|err| PyValueError::new_err(format!("Error parsing molecule: {err}")))?;
    let mol_json = crate::io::molecule_to_pymatgen_json(&mol);
    json_to_pydict(py, &mol_json)
}

/// Convert a molecule to pymatgen JSON format string.
#[pyfunction]
fn molecule_to_json(molecule: StructureJson) -> PyResult<String> {
    let mol = crate::io::parse_molecule_json(&molecule.0)
        .map_err(|err| PyValueError::new_err(format!("Error parsing molecule: {err}")))?;
    Ok(crate::io::molecule_to_pymatgen_json(&mol))
}

/// Convert a molecule to XYZ format string.
#[pyfunction]
#[pyo3(signature = (molecule, comment = None))]
fn molecule_to_xyz(molecule: StructureJson, comment: Option<&str>) -> PyResult<String> {
    let mol = crate::io::parse_molecule_json(&molecule.0)
        .map_err(|err| PyValueError::new_err(format!("Error parsing molecule: {err}")))?;
    Ok(crate::io::molecule_to_xyz(&mol, comment))
}

/// Parse a molecule from XYZ file content.
#[pyfunction]
fn parse_xyz_str(py: Python<'_>, content: &str) -> PyResult<Py<PyDict>> {
    let mol = crate::io::parse_xyz_str(content)
        .map_err(|err| PyValueError::new_err(format!("Error parsing XYZ: {err}")))?;
    let mol_json = crate::io::molecule_to_pymatgen_json(&mol);
    json_to_pydict(py, &mol_json)
}

/// Parse a molecule from an XYZ file.
#[pyfunction]
fn parse_xyz_file(py: Python<'_>, path: &str) -> PyResult<Py<PyDict>> {
    let mol = crate::io::parse_xyz(Path::new(path))
        .map_err(|err| PyValueError::new_err(format!("Error parsing XYZ file: {err}")))?;
    let mol_json = crate::io::molecule_to_pymatgen_json(&mol);
    json_to_pydict(py, &mol_json)
}

/// Parse ASE Atoms dict, returning either a Structure or Molecule dict.
#[pyfunction]
fn parse_ase_dict(py: Python<'_>, ase_dict: &Bound<'_, PyDict>) -> PyResult<(String, Py<PyDict>)> {
    let json_module = py.import("json")?;
    let json_str: String = json_module.call_method1("dumps", (ase_dict,))?.extract()?;
    let result = crate::io::parse_ase_atoms_json(&json_str)
        .map_err(|err| PyValueError::new_err(format!("Error parsing ASE dict: {err}")))?;
    struct_or_mol_to_pydict(py, result)
}

/// Parse XYZ content flexibly, returning Structure if lattice present, Molecule otherwise.
#[pyfunction]
fn parse_xyz_flexible(py: Python<'_>, path: &str) -> PyResult<(String, Py<PyDict>)> {
    let result = crate::io::parse_xyz_flexible(Path::new(path))
        .map_err(|err| PyValueError::new_err(format!("Error parsing XYZ: {err}")))?;
    struct_or_mol_to_pydict(py, result)
}

// === Direct Object Conversion ===

/// Convert a pymatgen Structure directly to ferrox dict format.
#[pyfunction]
fn from_pymatgen_structure(py: Python<'_>, structure: &Bound<'_, PyAny>) -> PyResult<Py<PyDict>> {
    let lattice = structure.getattr("lattice")?;
    let matrix: Vec<Vec<f64>> = lattice.getattr("matrix")?.extract()?;

    // Validate matrix dimensions
    if matrix.len() != 3 || matrix.iter().any(|row| row.len() != 3) {
        return Err(PyValueError::new_err(format!(
            "Lattice matrix must be 3x3, got {}x{}",
            matrix.len(),
            matrix.first().map_or(0, |r| r.len())
        )));
    }

    let pbc: [bool; 3] = lattice
        .getattr("pbc")
        .and_then(|p| p.extract())
        .unwrap_or([true, true, true]);
    let charge: f64 = structure
        .getattr("charge")
        .and_then(|c| c.extract())
        .unwrap_or(0.0);

    let mut lattice_obj = crate::lattice::Lattice::new(nalgebra::Matrix3::from_row_slice(&[
        matrix[0][0],
        matrix[0][1],
        matrix[0][2],
        matrix[1][0],
        matrix[1][1],
        matrix[1][2],
        matrix[2][0],
        matrix[2][1],
        matrix[2][2],
    ]));
    lattice_obj.pbc = pbc;

    let sites = structure.getattr("sites")?;
    let mut site_occupancies = Vec::new();
    let mut frac_coords = Vec::new();

    for site_result in sites.try_iter()? {
        let site = site_result?;
        let frac: [f64; 3] = site.getattr("frac_coords")?.extract()?;
        frac_coords.push(nalgebra::Vector3::new(frac[0], frac[1], frac[2]));

        let species_comp = site.getattr("species")?;
        let mut species_vec: Vec<(crate::species::Species, f64)> = Vec::new();

        for item_result in species_comp.call_method0("items")?.try_iter()? {
            let item = item_result?;
            let (sp, occu): (pyo3::Bound<'_, PyAny>, f64) = item.extract()?;
            let symbol: String = sp.getattr("symbol")?.extract()?;
            let elem = crate::element::Element::from_symbol(&symbol)
                .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {symbol}")))?;

            let oxi_state: Option<i8> = sp
                .getattr("oxi_state")
                .and_then(|o| o.extract::<f64>())
                .ok()
                .and_then(|oxi| {
                    if oxi.abs() < 1e-10 {
                        None
                    } else if oxi.fract().abs() < 1e-10 {
                        Some(oxi.round() as i8)
                    } else {
                        None
                    }
                });

            species_vec.push((crate::species::Species::new(elem, oxi_state), occu));
        }

        site_occupancies.push(crate::species::SiteOccupancy::new(species_vec));
    }

    let struc = crate::structure::Structure::try_new_full(
        lattice_obj,
        site_occupancies,
        frac_coords,
        pbc,
        charge,
        std::collections::HashMap::new(),
    )
    .map_err(|err| PyValueError::new_err(format!("Error creating structure: {err}")))?;

    let json = structure_to_pymatgen_json(&struc);
    json_to_pydict(py, &json)
}

/// Convert a ferrox dict to a pymatgen Structure object.
#[pyfunction]
fn to_pymatgen_structure(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyAny>> {
    let pymatgen = py.import("pymatgen.core.structure")?;
    let structure_cls = pymatgen.getattr("Structure")?;
    let struc = parse_struct(&structure)?;
    let json_str = structure_to_pymatgen_json(&struc);
    let dict = json_to_pydict(py, &json_str)?;
    structure_cls
        .call_method1("from_dict", (dict,))
        .map(|o| o.unbind())
}

/// Convert a ferrox dict to a pymatgen Molecule object.
#[pyfunction]
fn to_pymatgen_molecule(py: Python<'_>, molecule: StructureJson) -> PyResult<Py<PyAny>> {
    let pymatgen = py.import("pymatgen.core.structure")?;
    let molecule_cls = pymatgen.getattr("Molecule")?;
    let mol = crate::io::parse_molecule_json(&molecule.0)
        .map_err(|err| PyValueError::new_err(format!("Error parsing molecule: {err}")))?;
    let json_str = crate::io::molecule_to_pymatgen_json(&mol);
    let dict = json_to_pydict(py, &json_str)?;
    molecule_cls
        .call_method1("from_dict", (dict,))
        .map(|o| o.unbind())
}

/// Convert an ASE Atoms object directly to ferrox dict format.
#[pyfunction]
fn from_ase_atoms(py: Python<'_>, atoms: &Bound<'_, PyAny>) -> PyResult<Py<PyDict>> {
    let symbols: Vec<String> = atoms.call_method0("get_chemical_symbols")?.extract()?;
    let positions: Vec<[f64; 3]> = atoms.call_method0("get_positions")?.extract()?;
    let cell_obj = atoms.call_method0("get_cell")?;
    let cell: Vec<Vec<f64>> = cell_obj.extract().unwrap_or_else(|_| vec![vec![0.0; 3]; 3]);
    let has_cell = cell.iter().any(|row| row.iter().any(|&v| v.abs() > 1e-10));
    let pbc: [bool; 3] = atoms
        .call_method0("get_pbc")
        .and_then(|p| p.extract())
        .unwrap_or([false, false, false]);
    let is_periodic = pbc.iter().any(|&p| p) && has_cell;
    let charge: f64 = (|| -> Option<f64> {
        let info = atoms.getattr("info").ok()?;
        let charge_val = info.get_item("charge").ok()?;
        charge_val.extract::<f64>().ok()
    })()
    .unwrap_or(0.0);

    let species: Vec<crate::species::Species> = symbols
        .iter()
        .map(|s| {
            let elem = crate::element::Element::from_symbol(s)
                .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {s}")))?;
            Ok(crate::species::Species::neutral(elem))
        })
        .collect::<PyResult<_>>()?;

    let cart_coords: Vec<nalgebra::Vector3<f64>> = positions
        .iter()
        .map(|p| nalgebra::Vector3::new(p[0], p[1], p[2]))
        .collect();

    if is_periodic {
        let mut lattice = crate::lattice::Lattice::new(nalgebra::Matrix3::from_row_slice(&[
            cell[0][0], cell[0][1], cell[0][2], cell[1][0], cell[1][1], cell[1][2], cell[2][0],
            cell[2][1], cell[2][2],
        ]));
        lattice.pbc = pbc;

        let inv = lattice.inv_matrix();
        let frac_coords: Vec<nalgebra::Vector3<f64>> =
            cart_coords.iter().map(|p| inv * p).collect();

        let struc = crate::structure::Structure::try_new_full(
            lattice,
            species
                .into_iter()
                .map(crate::species::SiteOccupancy::ordered)
                .collect(),
            frac_coords,
            pbc,
            charge,
            std::collections::HashMap::new(),
        )
        .map_err(|err| PyValueError::new_err(format!("Error creating structure: {err}")))?;

        let json = structure_to_pymatgen_json(&struc);
        json_to_pydict(py, &json)
    } else {
        let mol = crate::structure::Structure::try_new_molecule(
            species,
            cart_coords,
            charge,
            std::collections::HashMap::new(),
        )
        .map_err(|err| PyValueError::new_err(format!("Error creating molecule: {err}")))?;

        let json = crate::io::molecule_to_pymatgen_json(&mol);
        json_to_pydict(py, &json)
    }
}

/// Convert a ferrox dict to an ASE Atoms object.
#[pyfunction]
fn to_ase_atoms(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyAny>> {
    let ase = py.import("ase")?;
    let atoms_cls = ase.getattr("Atoms")?;

    let (symbols, positions, cell, pbc, charge) = if let Ok(struc) =
        parse_structure_json(&structure.0)
    {
        let symbols: Vec<String> = struc.species_strings();
        let positions: Vec<[f64; 3]> = struc
            .cart_coords()
            .iter()
            .map(|c| [c.x, c.y, c.z])
            .collect();
        let mat = struc.lattice.matrix();
        let cell = vec![
            vec![mat[(0, 0)], mat[(0, 1)], mat[(0, 2)]],
            vec![mat[(1, 0)], mat[(1, 1)], mat[(1, 2)]],
            vec![mat[(2, 0)], mat[(2, 1)], mat[(2, 2)]],
        ];
        (symbols, positions, Some(cell), struc.pbc, struc.charge)
    } else if let Ok(mol) = crate::io::parse_molecule_json(&structure.0) {
        let symbols: Vec<String> = mol.species_strings();
        let positions: Vec<[f64; 3]> = mol.cart_coords().iter().map(|c| [c.x, c.y, c.z]).collect();
        (symbols, positions, None, [false, false, false], mol.charge)
    } else {
        return Err(PyValueError::new_err(
            "Could not parse input as Structure or Molecule",
        ));
    };

    let kwargs = PyDict::new(py);
    kwargs.set_item("symbols", symbols)?;
    kwargs.set_item("positions", positions)?;
    kwargs.set_item("pbc", pbc)?;
    if let Some(cell) = cell {
        kwargs.set_item("cell", cell)?;
    }

    let atoms = atoms_cls.call((), Some(&kwargs))?;

    if charge.abs() > 1e-10 {
        let info = atoms.getattr("info")?;
        info.set_item("charge", charge)?;
    }

    Ok(atoms.unbind())
}

// === Helper Functions ===

/// Convert StructureOrMolecule to a (type_name, pydict) tuple.
/// Uses deprecated enum until core API migrates to Structure::is_molecule().
#[allow(deprecated)]
fn struct_or_mol_to_pydict(
    py: Python<'_>,
    result: crate::io::StructureOrMolecule,
) -> PyResult<(String, Py<PyDict>)> {
    match result {
        crate::io::StructureOrMolecule::Structure(struc) => {
            let json = structure_to_pymatgen_json(&struc);
            Ok(("Structure".to_string(), json_to_pydict(py, &json)?))
        }
        crate::io::StructureOrMolecule::Molecule(mol) => {
            let json = crate::io::molecule_to_pymatgen_json(&mol);
            Ok(("Molecule".to_string(), json_to_pydict(py, &json)?))
        }
    }
}

/// Register the io submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "io")?;
    submod.add_function(wrap_pyfunction!(parse_structure_file, &submod)?)?;
    submod.add_function(wrap_pyfunction!(parse_trajectory, &submod)?)?;
    submod.add_function(wrap_pyfunction!(write_structure_file, &submod)?)?;
    submod.add_function(wrap_pyfunction!(to_poscar, &submod)?)?;
    submod.add_function(wrap_pyfunction!(to_cif, &submod)?)?;
    submod.add_function(wrap_pyfunction!(to_extxyz, &submod)?)?;
    submod.add_function(wrap_pyfunction!(to_pymatgen_json, &submod)?)?;
    submod.add_function(wrap_pyfunction!(to_json, &submod)?)?;
    submod.add_function(wrap_pyfunction!(parse_molecule_json, &submod)?)?;
    submod.add_function(wrap_pyfunction!(molecule_to_json, &submod)?)?;
    submod.add_function(wrap_pyfunction!(molecule_to_xyz, &submod)?)?;
    submod.add_function(wrap_pyfunction!(parse_xyz_str, &submod)?)?;
    submod.add_function(wrap_pyfunction!(parse_xyz_file, &submod)?)?;
    submod.add_function(wrap_pyfunction!(parse_ase_dict, &submod)?)?;
    submod.add_function(wrap_pyfunction!(parse_xyz_flexible, &submod)?)?;
    submod.add_function(wrap_pyfunction!(from_pymatgen_structure, &submod)?)?;
    submod.add_function(wrap_pyfunction!(to_pymatgen_structure, &submod)?)?;
    submod.add_function(wrap_pyfunction!(to_pymatgen_molecule, &submod)?)?;
    submod.add_function(wrap_pyfunction!(from_ase_atoms, &submod)?)?;
    submod.add_function(wrap_pyfunction!(to_ase_atoms, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
