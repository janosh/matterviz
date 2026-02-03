//! I/O WASM bindings for parsing and serialization.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;
use wasm_bindgen::prelude::*;

use crate::cif::parse_cif_str;
use crate::io::parse_poscar_str;
use crate::wasm_types::{JsAseAtoms, JsCrystal, WasmResult};

#[wasm_bindgen]
pub fn parse_cif(content: &str) -> WasmResult<JsCrystal> {
    let result = parse_cif_str(content, Path::new("inline.cif"))
        .map_err(|err| err.to_string())
        .map(|structure| JsCrystal::from_structure(&structure));
    result.into()
}

#[wasm_bindgen]
pub fn parse_poscar(content: &str) -> WasmResult<JsCrystal> {
    let result = parse_poscar_str(content)
        .map_err(|err| err.to_string())
        .map(|structure| JsCrystal::from_structure(&structure));
    result.into()
}

#[wasm_bindgen]
pub fn structure_to_json(structure: JsCrystal) -> WasmResult<String> {
    structure
        .to_structure()
        .map(|struc| crate::io::structure_to_pymatgen_json(&struc))
        .into()
}

#[wasm_bindgen]
pub fn structure_to_cif(structure: JsCrystal) -> WasmResult<String> {
    structure
        .to_structure()
        .map(|struc| crate::cif::structure_to_cif(&struc, None))
        .into()
}

#[wasm_bindgen]
pub fn structure_to_poscar(structure: JsCrystal) -> WasmResult<String> {
    structure
        .to_structure()
        .map(|struc| crate::io::structure_to_poscar(&struc, None))
        .into()
}

#[wasm_bindgen]
pub fn parse_molecule_json(json: &str) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let mol = crate::io::parse_molecule_json(json).map_err(|e| e.to_string())?;
        Ok(crate::io::molecule_to_pymatgen_json(&mol))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn molecule_to_xyz_str(json: &str, comment: Option<String>) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let mol = crate::io::parse_molecule_json(json).map_err(|e| e.to_string())?;
        Ok(crate::io::molecule_to_xyz(&mol, comment.as_deref()))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn parse_xyz_str(content: &str) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let mol = crate::io::parse_xyz_str(content).map_err(|e| e.to_string())?;
        Ok(crate::io::molecule_to_pymatgen_json(&mol))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn ase_to_pymatgen(ase_atoms: JsAseAtoms) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let json = serde_json::to_string(&ase_atoms).map_err(|e| e.to_string())?;
        crate::io::ase_atoms_to_pymatgen_json(&json).map_err(|e| e.to_string())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn structure_to_ase(structure: JsCrystal) -> WasmResult<JsAseAtoms> {
    let result: Result<JsAseAtoms, String> = (|| {
        let struc = structure.to_structure()?;
        let ase_dict = crate::io::structure_to_ase_atoms_dict(&struc);
        serde_json::from_value(ase_dict).map_err(|e| format!("Deserialization error: {e}"))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn molecule_to_ase(molecule_json: &str) -> WasmResult<JsAseAtoms> {
    let result: Result<JsAseAtoms, String> = (|| {
        let mol = crate::io::parse_molecule_json(molecule_json).map_err(|e| e.to_string())?;
        let ase_dict = crate::io::molecule_to_ase_atoms_dict(&mol);
        serde_json::from_value(ase_dict).map_err(|e| format!("Deserialization error: {e}"))
    })();
    result.into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsAseParseResult {
    #[serde(rename = "type")]
    pub type_name: String,
    pub data: String,
}

#[wasm_bindgen]
#[allow(deprecated)]
pub fn parse_ase_atoms(ase_atoms: JsAseAtoms) -> WasmResult<JsAseParseResult> {
    let result: Result<JsAseParseResult, String> = (|| {
        let json = serde_json::to_string(&ase_atoms).map_err(|e| e.to_string())?;
        let (type_name, pymatgen_json) =
            match crate::io::parse_ase_atoms_json(&json).map_err(|e| e.to_string())? {
                crate::io::StructureOrMolecule::Structure(s) => (
                    "Structure".to_string(),
                    crate::io::structure_to_pymatgen_json(&s),
                ),
                crate::io::StructureOrMolecule::Molecule(m) => (
                    "Molecule".to_string(),
                    crate::io::molecule_to_pymatgen_json(&m),
                ),
            };
        Ok(JsAseParseResult {
            type_name,
            data: pymatgen_json,
        })
    })();
    result.into()
}
