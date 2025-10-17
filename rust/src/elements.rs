use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct ElementData {
    #[serde(rename = "cpk-hex")]
    cpk_hex: Option<String>,
    appearance: Option<String>,
    atomic_mass: f64,
    atomic_radius: Option<f64>,
    boiling_point: Option<f64>,
    category: String,
    column: i32,
    covalent_radius: Option<f64>,
    density: f64,
    discoverer: String,
    electron_affinity: Option<f64>,
    electron_configuration_semantic: String,
    electron_configuration: String,
    electronegativity_pauling: Option<f64>,
    electronegativity: Option<f64>,
    first_ionization: Option<f64>,
    ionization_energies: Vec<f64>,
    melting_point: Option<f64>,
    metal: Option<bool>,
    metalloid: Option<bool>,
    molar_heat: Option<f64>,
    electrons: i32,
    neutrons: i32,
    protons: i32,
    n_shells: i32,
    n_valence: Option<i32>,
    name: String,
    natural: Option<bool>,
    nonmetal: Option<bool>,
    number_of_isotopes: Option<i32>,
    number: i32,
    period: i32,
    phase: String,
    radioactive: Option<bool>,
    row: i32,
    shells: Vec<i32>,
    specific_heat: Option<f64>,
    spectral_img: Option<String>,
    summary: String,
    symbol: String,
    year: serde_json::Value, // Can be number or string
}

#[derive(Debug, Clone)]
pub struct ElementProps {
    pub covalent_radius: Option<f64>,
    pub electronegativity: f64,
    pub is_metal: bool,
    pub is_nonmetal: bool,
}

fn load_element_data() -> Vec<ElementData> {
    const JSON_DATA: &str = include_str!("elements.json");
    serde_json::from_str(JSON_DATA).expect("Failed to parse elements.json")
}

pub fn get_covalent_radii() -> HashMap<String, f64> {
    load_element_data()
        .into_iter()
        .filter_map(|elem| elem.covalent_radius.map(|radius| (elem.symbol, radius)))
        .collect()
}

pub fn get_element_props() -> HashMap<String, ElementProps> {
    load_element_data()
        .into_iter()
        .map(|elem| {
            (
                elem.symbol,
                ElementProps {
                    covalent_radius: elem.covalent_radius,
                    electronegativity: elem.electronegativity
                        .or(elem.electronegativity_pauling)
                        .unwrap_or(0.0),
                    is_metal: elem.metal.unwrap_or(false),
                    is_nonmetal: elem.nonmetal.unwrap_or(false),
                },
            )
        })
        .collect()
}
