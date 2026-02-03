//! Composition WASM bindings.

use wasm_bindgen::prelude::*;

use crate::element::Element;
use crate::wasm_types::{JsCompositionInfo, JsElementAmount, WasmResult};

#[wasm_bindgen]
pub fn parse_composition(formula: &str) -> WasmResult<JsCompositionInfo> {
    use crate::composition::Composition;

    let result: Result<JsCompositionInfo, String> = (|| {
        let comp = Composition::from_formula(formula).map_err(|e| e.to_string())?;
        let species: Vec<JsElementAmount> = comp
            .iter()
            .map(|(sp, amt)| JsElementAmount {
                element: sp.to_string(),
                amount: *amt,
            })
            .collect();

        Ok(JsCompositionInfo {
            species,
            formula: comp.formula(),
            reduced_formula: comp.reduced_formula(),
            formula_anonymous: comp.anonymous_formula(),
            formula_hill: comp.hill_formula(),
            alphabetical_formula: comp.alphabetical_formula(),
            chemical_system: comp.chemical_system(),
            num_atoms: comp.num_atoms(),
            num_elements: comp.num_elements() as u32,
            weight: comp.weight(),
            is_element: comp.is_element(),
            average_electronegativity: comp.average_electroneg(),
            total_electrons: comp.total_electrons() as u32,
        })
    })();
    result.into()
}

fn parse_comp_and_elem(
    formula: &str,
    element: &str,
) -> Result<(crate::composition::Composition, Element), String> {
    let comp = crate::composition::Composition::from_formula(formula).map_err(|e| e.to_string())?;
    let elem =
        Element::from_symbol(element).ok_or_else(|| format!("Unknown element: {element}"))?;
    Ok((comp, elem))
}

#[wasm_bindgen]
pub fn get_atomic_fraction(formula: &str, element: &str) -> WasmResult<f64> {
    parse_comp_and_elem(formula, element)
        .map(|(comp, elem)| comp.get_atomic_fraction(elem))
        .into()
}

#[wasm_bindgen]
pub fn get_wt_fraction(formula: &str, element: &str) -> WasmResult<f64> {
    parse_comp_and_elem(formula, element)
        .map(|(comp, elem)| comp.get_wt_fraction(elem))
        .into()
}

fn comp_to_element_amounts(comp: &crate::composition::Composition) -> Vec<JsElementAmount> {
    comp.iter()
        .map(|(sp, amt)| JsElementAmount {
            element: sp.element.symbol().to_string(),
            amount: *amt,
        })
        .collect()
}

#[wasm_bindgen]
pub fn reduced_composition(formula: &str) -> WasmResult<Vec<JsElementAmount>> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| comp_to_element_amounts(&c.reduced_composition()))
        .map_err(|e| e.to_string())
        .into()
}

#[wasm_bindgen]
pub fn fractional_composition(formula: &str) -> WasmResult<Vec<JsElementAmount>> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| comp_to_element_amounts(&c.fractional_composition()))
        .map_err(|e| e.to_string())
        .into()
}

#[wasm_bindgen]
pub fn compositions_almost_equal(formula1: &str, formula2: &str) -> WasmResult<bool> {
    use crate::composition::Composition;
    Composition::from_formula(formula1)
        .and_then(|c1| {
            Composition::from_formula(formula2).map(|c2| c1.almost_equals(&c2, 0.01, 1e-8))
        })
        .map_err(|e| e.to_string())
        .into()
}

#[wasm_bindgen]
pub fn is_charge_balanced(formula: &str) -> WasmResult<Option<bool>> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| c.is_charge_balanced())
        .map_err(|e| e.to_string())
        .into()
}

#[wasm_bindgen]
pub fn composition_charge(formula: &str) -> WasmResult<Option<i32>> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| c.charge())
        .map_err(|e| e.to_string())
        .into()
}

#[wasm_bindgen]
pub fn formula_hash(formula: &str) -> WasmResult<String> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| c.formula_hash().to_string())
        .map_err(|e| e.to_string())
        .into()
}

#[wasm_bindgen]
pub fn species_hash(formula: &str) -> WasmResult<String> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| c.species_hash().to_string())
        .map_err(|e| e.to_string())
        .into()
}
