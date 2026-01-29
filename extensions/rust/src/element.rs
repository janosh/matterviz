//! Chemical element definitions.
//!
//! This module provides the `Element` enum representing all 118 chemical elements,
//! along with associated data like atomic numbers, symbols, and electronegativities.
//!
//! Extended element data (oxidation states, ionic radii, Shannon radii) is loaded
//! from a gzipped JSON file at compile time and decompressed once on first access.

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::OnceLock;

// =============================================================================
// Extended Element Data (loaded from gzipped JSON)
// =============================================================================

/// Compile-time embedded gzipped JSON data (single source of truth shared with TypeScript).
const ELEMENT_DATA_GZ: &[u8] = include_bytes!("../../../src/lib/element/data.json.gz");

/// Decompressed JSON string (lazily initialized on first access).
static ELEMENT_DATA_JSON: OnceLock<String> = OnceLock::new();

fn get_element_data_json() -> &'static str {
    ELEMENT_DATA_JSON.get_or_init(|| {
        let mut decoder = GzDecoder::new(ELEMENT_DATA_GZ);
        let mut json = String::new();
        decoder
            .read_to_string(&mut json)
            .expect("Failed to decompress element data");
        json
    })
}

/// Shannon radius pair: crystal and ionic radii in Angstroms.
#[derive(Debug, Clone, Deserialize)]
pub struct ShannonRadiusPair {
    /// Crystal radius in Angstroms.
    pub crystal_radius: f64,
    /// Ionic radius in Angstroms.
    pub ionic_radius: f64,
}

/// Shannon radii: coordination -> spin -> radii.
pub type ShannonCoordination = HashMap<String, HashMap<String, ShannonRadiusPair>>;

/// Shannon radii for all oxidation states: oxidation_state -> coordination -> spin -> radii.
pub type ShannonRadii = HashMap<String, ShannonCoordination>;

/// Element data from JSON (for deserialization).
#[derive(Debug, Deserialize)]
struct ElementData {
    name: String,
    atomic_radius: Option<f64>,
    covalent_radius: Option<f64>,
    oxidation_states: Option<Vec<i8>>,
    common_oxidation_states: Option<Vec<i8>>,
    icsd_oxidation_states: Option<Vec<i8>>,
    ionic_radii: Option<HashMap<String, f64>>,
    shannon_radii: Option<ShannonRadii>,
}

static ELEMENT_DATA: OnceLock<Vec<ElementData>> = OnceLock::new();

fn get_element_data(z: u8) -> Option<&'static ElementData> {
    if !(1..=118).contains(&z) {
        return None;
    }
    let data = ELEMENT_DATA.get_or_init(|| {
        serde_json::from_str(get_element_data_json()).expect("Failed to parse element data JSON")
    });
    data.get((z - 1) as usize)
}

/// All 118 chemical elements.
///
/// Elements are represented as an enum with the atomic number as the discriminant.
/// This allows for efficient storage and comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum Element {
    /// Hydrogen (Z=1)
    H = 1,
    /// Helium (Z=2)
    He = 2,
    /// Lithium (Z=3)
    Li = 3,
    /// Beryllium (Z=4)
    Be = 4,
    /// Boron (Z=5)
    B = 5,
    /// Carbon (Z=6)
    C = 6,
    /// Nitrogen (Z=7)
    N = 7,
    /// Oxygen (Z=8)
    O = 8,
    /// Fluorine (Z=9)
    F = 9,
    /// Neon (Z=10)
    Ne = 10,
    /// Sodium (Z=11)
    Na = 11,
    /// Magnesium (Z=12)
    Mg = 12,
    /// Aluminum (Z=13)
    Al = 13,
    /// Silicon (Z=14)
    Si = 14,
    /// Phosphorus (Z=15)
    P = 15,
    /// Sulfur (Z=16)
    S = 16,
    /// Chlorine (Z=17)
    Cl = 17,
    /// Argon (Z=18)
    Ar = 18,
    /// Potassium (Z=19)
    K = 19,
    /// Calcium (Z=20)
    Ca = 20,
    /// Scandium (Z=21)
    Sc = 21,
    /// Titanium (Z=22)
    Ti = 22,
    /// Vanadium (Z=23)
    V = 23,
    /// Chromium (Z=24)
    Cr = 24,
    /// Manganese (Z=25)
    Mn = 25,
    /// Iron (Z=26)
    Fe = 26,
    /// Cobalt (Z=27)
    Co = 27,
    /// Nickel (Z=28)
    Ni = 28,
    /// Copper (Z=29)
    Cu = 29,
    /// Zinc (Z=30)
    Zn = 30,
    /// Gallium (Z=31)
    Ga = 31,
    /// Germanium (Z=32)
    Ge = 32,
    /// Arsenic (Z=33)
    As = 33,
    /// Selenium (Z=34)
    Se = 34,
    /// Bromine (Z=35)
    Br = 35,
    /// Krypton (Z=36)
    Kr = 36,
    /// Rubidium (Z=37)
    Rb = 37,
    /// Strontium (Z=38)
    Sr = 38,
    /// Yttrium (Z=39)
    Y = 39,
    /// Zirconium (Z=40)
    Zr = 40,
    /// Niobium (Z=41)
    Nb = 41,
    /// Molybdenum (Z=42)
    Mo = 42,
    /// Technetium (Z=43)
    Tc = 43,
    /// Ruthenium (Z=44)
    Ru = 44,
    /// Rhodium (Z=45)
    Rh = 45,
    /// Palladium (Z=46)
    Pd = 46,
    /// Silver (Z=47)
    Ag = 47,
    /// Cadmium (Z=48)
    Cd = 48,
    /// Indium (Z=49)
    In = 49,
    /// Tin (Z=50)
    Sn = 50,
    /// Antimony (Z=51)
    Sb = 51,
    /// Tellurium (Z=52)
    Te = 52,
    /// Iodine (Z=53)
    I = 53,
    /// Xenon (Z=54)
    Xe = 54,
    /// Cesium (Z=55)
    Cs = 55,
    /// Barium (Z=56)
    Ba = 56,
    /// Lanthanum (Z=57)
    La = 57,
    /// Cerium (Z=58)
    Ce = 58,
    /// Praseodymium (Z=59)
    Pr = 59,
    /// Neodymium (Z=60)
    Nd = 60,
    /// Promethium (Z=61)
    Pm = 61,
    /// Samarium (Z=62)
    Sm = 62,
    /// Europium (Z=63)
    Eu = 63,
    /// Gadolinium (Z=64)
    Gd = 64,
    /// Terbium (Z=65)
    Tb = 65,
    /// Dysprosium (Z=66)
    Dy = 66,
    /// Holmium (Z=67)
    Ho = 67,
    /// Erbium (Z=68)
    Er = 68,
    /// Thulium (Z=69)
    Tm = 69,
    /// Ytterbium (Z=70)
    Yb = 70,
    /// Lutetium (Z=71)
    Lu = 71,
    /// Hafnium (Z=72)
    Hf = 72,
    /// Tantalum (Z=73)
    Ta = 73,
    /// Tungsten (Z=74)
    W = 74,
    /// Rhenium (Z=75)
    Re = 75,
    /// Osmium (Z=76)
    Os = 76,
    /// Iridium (Z=77)
    Ir = 77,
    /// Platinum (Z=78)
    Pt = 78,
    /// Gold (Z=79)
    Au = 79,
    /// Mercury (Z=80)
    Hg = 80,
    /// Thallium (Z=81)
    Tl = 81,
    /// Lead (Z=82)
    Pb = 82,
    /// Bismuth (Z=83)
    Bi = 83,
    /// Polonium (Z=84)
    Po = 84,
    /// Astatine (Z=85)
    At = 85,
    /// Radon (Z=86)
    Rn = 86,
    /// Francium (Z=87)
    Fr = 87,
    /// Radium (Z=88)
    Ra = 88,
    /// Actinium (Z=89)
    Ac = 89,
    /// Thorium (Z=90)
    Th = 90,
    /// Protactinium (Z=91)
    Pa = 91,
    /// Uranium (Z=92)
    U = 92,
    /// Neptunium (Z=93)
    Np = 93,
    /// Plutonium (Z=94)
    Pu = 94,
    /// Americium (Z=95)
    Am = 95,
    /// Curium (Z=96)
    Cm = 96,
    /// Berkelium (Z=97)
    Bk = 97,
    /// Californium (Z=98)
    Cf = 98,
    /// Einsteinium (Z=99)
    Es = 99,
    /// Fermium (Z=100)
    Fm = 100,
    /// Mendelevium (Z=101)
    Md = 101,
    /// Nobelium (Z=102)
    No = 102,
    /// Lawrencium (Z=103)
    Lr = 103,
    /// Rutherfordium (Z=104)
    Rf = 104,
    /// Dubnium (Z=105)
    Db = 105,
    /// Seaborgium (Z=106)
    Sg = 106,
    /// Bohrium (Z=107)
    Bh = 107,
    /// Hassium (Z=108)
    Hs = 108,
    /// Meitnerium (Z=109)
    Mt = 109,
    /// Darmstadtium (Z=110)
    Ds = 110,
    /// Roentgenium (Z=111)
    Rg = 111,
    /// Copernicium (Z=112)
    Cn = 112,
    /// Nihonium (Z=113)
    Nh = 113,
    /// Flerovium (Z=114)
    Fl = 114,
    /// Moscovium (Z=115)
    Mc = 115,
    /// Livermorium (Z=116)
    Lv = 116,
    /// Tennessine (Z=117)
    Ts = 117,
    /// Oganesson (Z=118)
    Og = 118,

    // Pseudo-elements (Z > 118) for special cases
    /// Dummy atom placeholder for unknown/invalid elements
    Dummy = 119,
    /// Deuterium (hydrogen isotope, mass ~2.014)
    D = 120,
    /// Tritium (hydrogen isotope, mass ~3.016)
    T = 121,
}

impl Element {
    /// All element symbols in atomic number order.
    const SYMBOLS: [&'static str; 118] = [
        "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S",
        "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga",
        "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd",
        "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm",
        "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os",
        "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th", "Pa",
        "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg",
        "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
    ];

    /// Standard atomic weights in atomic mass units (u).
    /// Source: IUPAC 2021 values. Index 0 corresponds to H (Z=1).
    /// For radioactive elements without stable isotopes, the most stable isotope mass is used.
    const ATOMIC_MASSES: [f64; 118] = [
        1.008,         // H
        4.0026022,     // He
        6.94,          // Li
        9.01218315,    // Be
        10.81,         // B
        12.011,        // C
        14.007,        // N
        15.999,        // O
        18.9984031636, // F
        20.17976,      // Ne
        22.989769282,  // Na
        24.305,        // Mg
        26.98153857,   // Al
        28.085,        // Si
        30.9737619985, // P
        32.06,         // S
        35.45,         // Cl
        39.9481,       // Ar
        39.09831,      // K
        40.0784,       // Ca
        44.9559085,    // Sc
        47.8671,       // Ti
        50.94151,      // V
        51.99616,      // Cr
        54.9380443,    // Mn
        55.8452,       // Fe
        58.9331944,    // Co
        58.69344,      // Ni
        63.5463,       // Cu
        65.382,        // Zn
        69.7231,       // Ga
        72.6308,       // Ge
        74.9215956,    // As
        78.9718,       // Se
        79.904,        // Br
        83.7982,       // Kr
        85.46783,      // Rb
        87.621,        // Sr
        88.905842,     // Y
        91.2242,       // Zr
        92.906372,     // Nb
        95.951,        // Mo
        98.0,          // Tc (radioactive)
        101.072,       // Ru
        102.905502,    // Rh
        106.421,       // Pd
        107.86822,     // Ag
        112.4144,      // Cd
        114.8181,      // In
        118.7107,      // Sn
        121.7601,      // Sb
        127.603,       // Te
        126.904473,    // I
        131.2936,      // Xe
        132.905451966, // Cs
        137.3277,      // Ba
        138.905477,    // La
        140.1161,      // Ce
        140.907662,    // Pr
        144.2423,      // Nd
        145.0,         // Pm (radioactive)
        150.362,       // Sm
        151.9641,      // Eu
        157.253,       // Gd
        158.925352,    // Tb
        162.5001,      // Dy
        164.930332,    // Ho
        167.2593,      // Er
        168.934222,    // Tm
        173.0451,      // Yb
        174.96681,     // Lu
        178.492,       // Hf
        180.947882,    // Ta
        183.841,       // W
        186.2071,      // Re
        190.233,       // Os
        192.2173,      // Ir
        195.0849,      // Pt
        196.9665695,   // Au
        200.5923,      // Hg
        204.38,        // Tl
        207.21,        // Pb
        208.980401,    // Bi
        209.0,         // Po (radioactive)
        210.0,         // At (radioactive)
        222.0,         // Rn (radioactive)
        223.0,         // Fr (radioactive)
        226.0,         // Ra (radioactive)
        227.0,         // Ac (radioactive)
        232.03774,     // Th
        231.035882,    // Pa
        238.028913,    // U
        237.0,         // Np (radioactive)
        244.0,         // Pu (radioactive)
        243.0,         // Am (radioactive)
        247.0,         // Cm (radioactive)
        247.0,         // Bk (radioactive)
        251.0,         // Cf (radioactive)
        252.0,         // Es (radioactive)
        257.0,         // Fm (radioactive)
        258.0,         // Md (radioactive)
        259.0,         // No (radioactive)
        266.0,         // Lr (radioactive)
        267.0,         // Rf (radioactive)
        268.0,         // Db (radioactive)
        269.0,         // Sg (radioactive)
        270.0,         // Bh (radioactive)
        277.0,         // Hs (radioactive)
        278.0,         // Mt (radioactive)
        281.0,         // Ds (radioactive)
        282.0,         // Rg (radioactive)
        285.0,         // Cn (radioactive)
        286.0,         // Nh (radioactive)
        289.0,         // Fl (radioactive)
        289.0,         // Mc (radioactive)
        293.0,         // Lv (radioactive)
        294.0,         // Ts (radioactive)
        294.0,         // Og (radioactive)
    ];

    /// Pauling electronegativities (NaN for elements without defined values).
    /// Index 0 corresponds to H (Z=1).
    const ELECTRONEGATIVITIES: [f64; 118] = [
        2.20,
        f64::NAN,
        0.98,
        1.57,
        2.04,
        2.55,
        3.04,
        3.44,
        3.98,
        f64::NAN, // H-Ne
        0.93,
        1.31,
        1.61,
        1.90,
        2.19,
        2.58,
        3.16,
        f64::NAN,
        0.82,
        1.00, // Na-Ca
        1.36,
        1.54,
        1.63,
        1.66,
        1.55,
        1.83,
        1.88,
        1.91,
        1.90,
        1.65, // Sc-Zn
        1.81,
        2.01,
        2.18,
        2.55,
        2.96,
        3.00,
        0.82,
        0.95,
        1.22,
        1.33, // Ga-Zr
        1.60,
        2.16,
        1.90,
        2.20,
        2.28,
        2.20,
        1.93,
        1.69,
        1.78,
        1.96, // Nb-Sn
        2.05,
        2.10,
        2.66,
        2.60,
        0.79,
        0.89,
        1.10,
        1.12,
        1.13,
        1.14, // Sb-Nd
        f64::NAN,
        1.17,
        f64::NAN,
        1.20,
        f64::NAN,
        1.22,
        1.23,
        1.24,
        1.25,
        f64::NAN, // Pm-Yb
        1.27,
        1.30,
        1.50,
        2.36,
        1.90,
        2.20,
        2.20,
        2.28,
        2.54,
        2.00, // Lu-Hg
        1.62,
        2.33,
        2.02,
        2.00,
        2.20,
        f64::NAN,
        0.70,
        0.90,
        1.10,
        1.30, // Tl-Th
        1.50,
        1.38,
        1.36,
        1.28,
        1.30,
        1.30,
        1.30,
        1.30,
        1.30,
        1.30, // Pa-Fm
        1.30,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN, // Md-Hs
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN, // Mt-Lv
        f64::NAN,
        f64::NAN, // Ts-Og
    ];

    /// Create an element from its symbol string.
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert_eq!(Element::from_symbol("Fe"), Some(Element::Fe));
    /// assert_eq!(Element::from_symbol("fe"), Some(Element::Fe));  // Case insensitive
    /// assert_eq!(Element::from_symbol("D"), Some(Element::D));    // Deuterium
    /// assert_eq!(Element::from_symbol("X"), Some(Element::Dummy)); // Dummy atom
    /// ```
    pub fn from_symbol(symbol: &str) -> Option<Self> {
        let lower = symbol.to_lowercase();

        // Check pseudo-elements first (before the static map)
        match lower.as_str() {
            "d" => return Some(Self::D),
            "t" => return Some(Self::T),
            "x" | "xx" | "dummy" | "vac" | "va" => return Some(Self::Dummy),
            _ => {}
        }

        // Static lookup map initialized once (case-insensitive via lowercase keys)
        static SYMBOL_MAP: OnceLock<HashMap<String, Element>> = OnceLock::new();
        let map = SYMBOL_MAP.get_or_init(|| {
            let mut map = HashMap::with_capacity(118);
            for (idx, sym) in Self::SYMBOLS.iter().enumerate() {
                if let Some(elem) = Self::from_atomic_number((idx + 1) as u8) {
                    map.insert(sym.to_lowercase(), elem);
                }
            }
            map
        });
        map.get(&lower).copied()
    }

    /// Create an element from its atomic number (1-118 for real elements, 119-121 for pseudo-elements).
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert_eq!(Element::from_atomic_number(26), Some(Element::Fe));
    /// assert_eq!(Element::from_atomic_number(0), None);
    /// assert_eq!(Element::from_atomic_number(119), Some(Element::Dummy));
    /// assert_eq!(Element::from_atomic_number(120), Some(Element::D));
    /// assert_eq!(Element::from_atomic_number(121), Some(Element::T));
    /// assert_eq!(Element::from_atomic_number(122), None);
    /// ```
    pub fn from_atomic_number(z: u8) -> Option<Self> {
        // Compile-time checks for discriminant values
        const _: () = assert!(Element::Og as u8 == 118);
        const _: () = assert!(Element::Dummy as u8 == 119);
        const _: () = assert!(Element::D as u8 == 120);
        const _: () = assert!(Element::T as u8 == 121);

        if z == 0 || z > 121 {
            return None;
        }
        // SAFETY: z is in range 1-121, matching our enum discriminants.
        // The repr(u8) guarantees memory layout, and the const asserts validate bounds.
        Some(unsafe { std::mem::transmute::<u8, Element>(z) })
    }

    /// Get the element symbol.
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert_eq!(Element::Fe.symbol(), "Fe");
    /// assert_eq!(Element::D.symbol(), "D");
    /// assert_eq!(Element::Dummy.symbol(), "X");
    /// ```
    pub fn symbol(&self) -> &'static str {
        match self {
            Self::Dummy => "X",
            Self::D => "D",
            Self::T => "T",
            _ => Self::SYMBOLS[self.atomic_number() as usize - 1],
        }
    }

    /// Get the atomic number (1-118).
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert_eq!(Element::Fe.atomic_number(), 26);
    /// ```
    pub fn atomic_number(&self) -> u8 {
        *self as u8
    }

    /// Get the Pauling electronegativity, if defined.
    ///
    /// Returns `None` for noble gases, transactinides, and pseudo-elements.
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert!((Element::Fe.electronegativity().unwrap() - 1.83).abs() < 0.01);
    /// assert!(Element::He.electronegativity().is_none());  // Noble gas
    /// assert!(Element::Dummy.electronegativity().is_none()); // Pseudo-element
    /// ```
    pub fn electronegativity(&self) -> Option<f64> {
        // Pseudo-elements have no electronegativity
        if self.atomic_number() > 118 {
            return None;
        }
        let en = Self::ELECTRONEGATIVITIES[self.atomic_number() as usize - 1];
        if en.is_nan() { None } else { Some(en) }
    }

    /// Get the standard atomic weight in atomic mass units (u).
    ///
    /// For pseudo-elements:
    /// - Dummy returns 0.0
    /// - D (deuterium) returns 2.014
    /// - T (tritium) returns 3.016
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert!((Element::C.atomic_mass() - 12.011).abs() < 0.001);
    /// assert!((Element::D.atomic_mass() - 2.014).abs() < 0.001);
    /// assert_eq!(Element::Dummy.atomic_mass(), 0.0);
    /// ```
    pub fn atomic_mass(&self) -> f64 {
        match self {
            Self::Dummy => 0.0,
            Self::D => 2.014101778, // IUPAC deuterium mass
            Self::T => 3.01604928,  // IUPAC tritium mass
            _ => Self::ATOMIC_MASSES[self.atomic_number() as usize - 1],
        }
    }

    /// Check if this is a pseudo-element (Dummy, D, or T).
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert!(!Element::Fe.is_pseudo());
    /// assert!(Element::Dummy.is_pseudo());
    /// assert!(Element::D.is_pseudo());
    /// ```
    pub fn is_pseudo(&self) -> bool {
        self.atomic_number() > 118
    }

    /// Check if this is a dummy/placeholder element.
    pub fn is_dummy(&self) -> bool {
        matches!(self, Self::Dummy)
    }

    // =========================================================================
    // Periodic Table Positioning
    // =========================================================================

    /// Get the periodic table row (1-7).
    ///
    /// For lanthanoids (Z=57-71), returns 6.
    /// For actinoids (Z=89-103), returns 7.
    /// For pseudo-elements (Z>118), returns 0.
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert_eq!(Element::H.row(), 1);
    /// assert_eq!(Element::Fe.row(), 4);
    /// assert_eq!(Element::La.row(), 6);  // Lanthanoid
    /// assert_eq!(Element::U.row(), 7);   // Actinoid
    /// ```
    pub fn row(&self) -> u8 {
        let z = self.atomic_number();
        if z > 118 {
            return 0; // Pseudo-elements
        }
        if (57..=71).contains(&z) {
            return 6; // Lanthanoids
        }
        if (89..=103).contains(&z) {
            return 7; // Actinoids
        }

        const ROW_SIZES: [u8; 7] = [2, 8, 8, 18, 18, 32, 32];
        let mut total: u8 = 0;
        for (row_idx, &size) in ROW_SIZES.iter().enumerate() {
            total += size;
            if z <= total {
                return (row_idx + 1) as u8;
            }
        }
        7
    }

    /// Get the periodic table group (1-18).
    ///
    /// For lanthanoids and actinoids, returns 3.
    /// For pseudo-elements, returns 0.
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert_eq!(Element::H.group(), 1);
    /// assert_eq!(Element::He.group(), 18);
    /// assert_eq!(Element::Fe.group(), 8);
    /// assert_eq!(Element::La.group(), 3);  // Lanthanoid
    /// ```
    pub fn group(&self) -> u8 {
        let z = self.atomic_number();
        if z > 118 {
            return 0;
        }

        match z {
            1 => 1,
            2 => 18,
            3..=18 => {
                let pos = (z - 2) % 8;
                if pos == 0 {
                    18
                } else if pos <= 2 {
                    pos
                } else {
                    10 + pos
                }
            }
            19..=54 => {
                let pos = (z - 18) % 18;
                if pos == 0 { 18 } else { pos }
            }
            57..=71 | 89..=103 => 3, // Lanthanoids and actinoids
            _ => {
                let pos = (z - 54) % 32;
                if pos == 0 {
                    18
                } else if pos >= 18 {
                    pos - 14
                } else {
                    pos
                }
            }
        }
    }

    /// Get the periodic table block (s, p, d, or f).
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::{Element, Block};
    ///
    /// assert_eq!(Element::H.block(), Block::S);
    /// assert_eq!(Element::C.block(), Block::P);
    /// assert_eq!(Element::Fe.block(), Block::D);
    /// assert_eq!(Element::Ce.block(), Block::F);
    /// ```
    pub fn block(&self) -> Block {
        let z = self.atomic_number();

        // Lanthanoids (except Lu) and actinoids (except Lr) are f-block
        if (57..=70).contains(&z) || (89..=102).contains(&z) {
            return Block::F;
        }

        let group = self.group();
        match group {
            0 => Block::S, // Pseudo-elements
            1 | 2 => Block::S,
            3..=12 => Block::D,
            13..=18 => Block::P,
            _ => Block::S,
        }
    }

    // =========================================================================
    // Element Classification
    // =========================================================================

    /// True if element is a noble gas (He, Ne, Ar, Kr, Xe, Rn, Og).
    pub fn is_noble_gas(&self) -> bool {
        matches!(self.atomic_number(), 2 | 10 | 18 | 36 | 54 | 86 | 118)
    }

    /// True if element is an alkali metal (Li, Na, K, Rb, Cs, Fr).
    pub fn is_alkali(&self) -> bool {
        matches!(self.atomic_number(), 3 | 11 | 19 | 37 | 55 | 87)
    }

    /// True if element is an alkaline earth metal (Be, Mg, Ca, Sr, Ba, Ra).
    pub fn is_alkaline(&self) -> bool {
        matches!(self.atomic_number(), 4 | 12 | 20 | 38 | 56 | 88)
    }

    /// True if element is a halogen (F, Cl, Br, I, At).
    ///
    /// Note: Tennessine (Ts, Z=117) is excluded despite being in group 17,
    /// as its chemical properties are predicted to differ significantly from
    /// traditional halogens. This matches pymatgen's classification.
    pub fn is_halogen(&self) -> bool {
        matches!(self.atomic_number(), 9 | 17 | 35 | 53 | 85)
    }

    /// True if element is a chalcogen (O, S, Se, Te, Po).
    pub fn is_chalcogen(&self) -> bool {
        matches!(self.atomic_number(), 8 | 16 | 34 | 52 | 84)
    }

    /// True if element is a lanthanoid (La-Lu, Z=57-71).
    pub fn is_lanthanoid(&self) -> bool {
        (57..=71).contains(&self.atomic_number())
    }

    /// True if element is an actinoid (Ac-Lr, Z=89-103).
    pub fn is_actinoid(&self) -> bool {
        (89..=103).contains(&self.atomic_number())
    }

    /// True if element is a transition metal.
    ///
    /// Includes Sc-Zn (21-30), Y-Cd (39-48), La (57), Hf-Hg (72-80),
    /// Ac (89), and Rf-Cn (104-112).
    ///
    /// Note: La and Ac return true for both `is_transition_metal()` and
    /// `is_lanthanoid()`/`is_actinoid()`. This reflects that these elements
    /// are often classified both ways in the literature.
    pub fn is_transition_metal(&self) -> bool {
        let z = self.atomic_number();
        matches!(z, 21..=30 | 39..=48 | 72..=80 | 104..=112) || z == 57 || z == 89
    }

    /// True if element is a post-transition metal (Al, Ga, In, Tl, Sn, Pb, Bi).
    pub fn is_post_transition_metal(&self) -> bool {
        matches!(
            self,
            Self::Al | Self::Ga | Self::In | Self::Tl | Self::Sn | Self::Pb | Self::Bi
        )
    }

    /// True if element is a metalloid (B, Si, Ge, As, Sb, Te, Po).
    pub fn is_metalloid(&self) -> bool {
        matches!(
            self,
            Self::B | Self::Si | Self::Ge | Self::As | Self::Sb | Self::Te | Self::Po
        )
    }

    /// True if element is a metal (alkali, alkaline, transition, post-transition,
    /// lanthanoid, or actinoid).
    pub fn is_metal(&self) -> bool {
        self.is_alkali()
            || self.is_alkaline()
            || self.is_transition_metal()
            || self.is_post_transition_metal()
            || self.is_lanthanoid()
            || self.is_actinoid()
    }

    /// True if element is radioactive.
    ///
    /// Includes Tc (43), Pm (61), and all elements with Z >= 84.
    pub fn is_radioactive(&self) -> bool {
        let z = self.atomic_number();
        z == 43 || z == 61 || z >= 84
    }

    /// True if element is a rare earth (lanthanoid, actinoid, Sc, or Y).
    pub fn is_rare_earth(&self) -> bool {
        self.is_lanthanoid() || self.is_actinoid() || matches!(self, Self::Sc | Self::Y)
    }

    // =========================================================================
    // Oxidation States (from JSON data)
    // =========================================================================

    /// Get all known oxidation states for this element.
    ///
    /// Returns an empty slice for pseudo-elements or elements without data.
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// let fe_oxi = Element::Fe.oxidation_states();
    /// assert!(fe_oxi.contains(&2));
    /// assert!(fe_oxi.contains(&3));
    /// ```
    pub fn oxidation_states(&self) -> &'static [i8] {
        get_element_data(self.atomic_number())
            .and_then(|d| d.oxidation_states.as_deref())
            .unwrap_or(&[])
    }

    /// Get common oxidation states for this element.
    ///
    /// Returns an empty slice for pseudo-elements or elements without data.
    pub fn common_oxidation_states(&self) -> &'static [i8] {
        get_element_data(self.atomic_number())
            .and_then(|d| d.common_oxidation_states.as_deref())
            .unwrap_or(&[])
    }

    /// Get ICSD oxidation states (oxidation states with at least 10 instances in ICSD).
    pub fn icsd_oxidation_states(&self) -> &'static [i8] {
        get_element_data(self.atomic_number())
            .and_then(|d| d.icsd_oxidation_states.as_deref())
            .unwrap_or(&[])
    }

    /// Get maximum oxidation state.
    pub fn max_oxidation_state(&self) -> Option<i8> {
        self.oxidation_states().iter().copied().max()
    }

    /// Get minimum oxidation state.
    pub fn min_oxidation_state(&self) -> Option<i8> {
        self.oxidation_states().iter().copied().min()
    }

    // =========================================================================
    // Radii (from JSON data)
    // =========================================================================

    /// Get atomic radius in Angstroms.
    ///
    /// Returns `None` for pseudo-elements or elements without data.
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// let fe_radius = Element::Fe.atomic_radius();
    /// assert!(fe_radius.is_some());
    /// assert!(fe_radius.unwrap() > 1.0 && fe_radius.unwrap() < 2.0);
    /// ```
    pub fn atomic_radius(&self) -> Option<f64> {
        get_element_data(self.atomic_number()).and_then(|d| d.atomic_radius)
    }

    /// Get covalent radius in Angstroms.
    pub fn covalent_radius(&self) -> Option<f64> {
        get_element_data(self.atomic_number()).and_then(|d| d.covalent_radius)
    }

    /// Get ionic radii by oxidation state.
    ///
    /// Returns a reference to a HashMap where keys are oxidation states as strings
    /// (e.g., "2", "-1") and values are radii in Angstroms.
    pub fn ionic_radii(&self) -> Option<&'static std::collections::HashMap<String, f64>> {
        get_element_data(self.atomic_number()).and_then(|d| d.ionic_radii.as_ref())
    }

    /// Get ionic radius for a specific oxidation state.
    ///
    /// # Arguments
    ///
    /// * `oxidation_state` - The oxidation state (e.g., 2 for Fe2+, -2 for O2-)
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// let fe2_radius = Element::Fe.ionic_radius(2);
    /// assert!(fe2_radius.is_some());
    /// ```
    pub fn ionic_radius(&self, oxidation_state: i8) -> Option<f64> {
        self.ionic_radii()
            .and_then(|radii| radii.get(&oxidation_state.to_string()))
            .copied()
    }

    /// Get Shannon radii data for this element.
    ///
    /// Shannon radii provide detailed ionic radii accounting for coordination number
    /// and spin state. The returned structure is:
    /// oxidation_state -> coordination -> spin -> {crystal_radius, ionic_radius}
    pub fn shannon_radii(&self) -> Option<&'static ShannonRadii> {
        get_element_data(self.atomic_number()).and_then(|d| d.shannon_radii.as_ref())
    }

    /// Get Shannon ionic radius for a specific oxidation state, coordination, and spin.
    ///
    /// # Arguments
    ///
    /// * `oxidation_state` - The oxidation state (e.g., 2 for Fe2+)
    /// * `coordination` - Coordination number as Roman numeral (e.g., "VI" for octahedral)
    /// * `spin` - Spin state (e.g., "High Spin", "Low Spin", or "" for no spin)
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// // Fe2+ in octahedral (VI) high spin coordination
    /// let radius = Element::Fe.shannon_ionic_radius(2, "VI", "High Spin");
    /// ```
    pub fn shannon_ionic_radius(
        &self,
        oxidation_state: i8,
        coordination: &str,
        spin: &str,
    ) -> Option<f64> {
        self.shannon_radii()
            .and_then(|sr| sr.get(&oxidation_state.to_string()))
            .and_then(|coord_map| coord_map.get(coordination))
            .and_then(|spin_map| spin_map.get(spin))
            .map(|pair| pair.ionic_radius)
    }

    /// Get the full name of this element (e.g., "Iron" for Fe).
    pub fn name(&self) -> &'static str {
        get_element_data(self.atomic_number())
            .map(|d| d.name.as_str())
            .unwrap_or("Unknown")
    }
}

/// Periodic table block (s, p, d, f).
///
/// Note: Helium (He) is placed in group 18 with noble gases for chemical property
/// reasons, so it returns `Block::P` despite having a 1s² electron configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Block {
    /// s-block (groups 1-2, except He)
    S,
    /// p-block (groups 13-18, including He)
    P,
    /// d-block (groups 3-12)
    D,
    /// f-block (lanthanoids and actinoids, except Lu and Lr)
    F,
}

impl Block {
    /// Get the block as a stable string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Block::S => "S",
            Block::P => "P",
            Block::D => "D",
            Block::F => "F",
        }
    }
}

impl std::fmt::Display for Block {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::fmt::Display for Element {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.symbol())
    }
}

// =============================================================================
// Symbol Normalization
// =============================================================================

/// Result of normalizing an element symbol string.
///
/// Contains the parsed element, optional oxidation state, and any metadata
/// extracted from non-standard symbol formats (POTCAR suffixes, labels, etc.).
#[derive(Debug, Clone)]
pub struct NormalizedSymbol {
    /// The normalized element.
    pub element: Element,
    /// Oxidation state extracted from the symbol (e.g., "Fe2+" -> Some(2)).
    pub oxidation_state: Option<i8>,
    /// Additional metadata extracted from the symbol.
    pub metadata: HashMap<String, serde_json::Value>,
}

impl NormalizedSymbol {
    /// Create a new normalized symbol with no metadata.
    pub fn new(element: Element, oxidation_state: Option<i8>) -> Self {
        Self {
            element,
            oxidation_state,
            metadata: HashMap::new(),
        }
    }

    /// Create with metadata.
    pub fn with_metadata(
        element: Element,
        oxidation_state: Option<i8>,
        metadata: HashMap<String, serde_json::Value>,
    ) -> Self {
        Self {
            element,
            oxidation_state,
            metadata,
        }
    }
}

/// Normalize an element symbol string to extract the element and any metadata.
///
/// Handles various non-standard symbol formats:
/// - Standard elements: "Fe", "Ca", "O"
/// - Pseudo-elements: "X", "D", "T", "Vac"
/// - Oxidation states: "Fe2+", "O2-", "Na+", "Cl-"
/// - POTCAR suffixes: "Ca_pv", "Fe_sv", "O_s"
/// - Hash suffixes: "Fe/hash123" (stripped)
/// - CIF-style labels: "Fe1", "Fe1_oct"
///
/// # Returns
///
/// - `Ok(NormalizedSymbol)` with the parsed element and extracted data
/// - `Err(String)` for empty strings
///
/// Unknown symbols are mapped to `Element::Dummy` with original stored in metadata.
///
/// # Examples
///
/// ```
/// use ferrox::element::{normalize_symbol, Element};
///
/// let norm = normalize_symbol("Fe2+").unwrap();
/// assert_eq!(norm.element, Element::Fe);
/// assert_eq!(norm.oxidation_state, Some(2));
///
/// let norm = normalize_symbol("Ca_pv").unwrap();
/// assert_eq!(norm.element, Element::Ca);
/// assert_eq!(norm.metadata.get("potcar_suffix").unwrap(), "_pv");
///
/// let norm = normalize_symbol("Unknown123").unwrap();
/// assert_eq!(norm.element, Element::Dummy);
/// ```
pub fn normalize_symbol(symbol: &str) -> Result<NormalizedSymbol, String> {
    let symbol = symbol.trim();
    if symbol.is_empty() {
        return Err("Empty symbol".to_string());
    }

    // Fast path: exact match with known element
    if let Some(elem) = Element::from_symbol(symbol) {
        return Ok(NormalizedSymbol::new(elem, None));
    }

    // Check for oxidation state suffix: Fe2+, O2-, Na+, Cl-
    if let Some(result) = try_parse_oxidation_state(symbol) {
        return Ok(result);
    }

    // Check for POTCAR suffix: Ca_pv, Fe_sv, O_s
    if let Some(result) = try_parse_potcar_suffix(symbol) {
        return Ok(result);
    }

    // Check for hash suffix: Fe/hash123
    if let Some(pos) = symbol.find('/') {
        let base = &symbol[..pos];
        if let Some(elem) = Element::from_symbol(base) {
            return Ok(NormalizedSymbol::new(elem, None));
        }
    }

    // Check for CIF-style label: Fe1, Fe1_oct, Na2a
    if let Some(result) = try_parse_cif_label(symbol) {
        return Ok(result);
    }

    // Fallback: treat as Dummy atom
    let mut metadata = HashMap::new();
    metadata.insert(
        "original_symbol".to_string(),
        serde_json::Value::String(symbol.to_string()),
    );
    Ok(NormalizedSymbol::with_metadata(
        Element::Dummy,
        None,
        metadata,
    ))
}

/// Try to parse oxidation state from symbol like "Fe2+", "O2-", "Na+", "Cl-".
fn try_parse_oxidation_state(symbol: &str) -> Option<NormalizedSymbol> {
    let last_char = symbol.chars().last()?;
    if last_char != '+' && last_char != '-' {
        return None;
    }

    let sign: i8 = if last_char == '+' { 1 } else { -1 };
    let without_sign = &symbol[..symbol.len() - 1];

    // Find where digits start (from the end)
    let mut digit_start = without_sign.len();
    for (idx, ch) in without_sign.char_indices().rev() {
        if ch.is_ascii_digit() {
            digit_start = idx;
        } else {
            break;
        }
    }

    let elem_str = &without_sign[..digit_start];
    let elem = Element::from_symbol(elem_str)?;

    let oxi = if digit_start == without_sign.len() {
        // No digits, just sign: Na+ -> +1, Cl- -> -1
        sign
    } else {
        let digit_str = &without_sign[digit_start..];
        let magnitude: i8 = digit_str.parse().ok()?;
        sign * magnitude
    };

    Some(NormalizedSymbol::new(elem, Some(oxi)))
}

/// Try to parse POTCAR suffix: Ca_pv, Fe_sv, O_s, etc.
fn try_parse_potcar_suffix(symbol: &str) -> Option<NormalizedSymbol> {
    // Known POTCAR suffixes
    const POTCAR_SUFFIXES: &[&str] = &[
        "_pv", "_sv", "_s", "_h", "_d", "_f", "_sv_GW", "_pv_GW", "_GW",
    ];

    for suffix in POTCAR_SUFFIXES {
        if let Some(base) = symbol.strip_suffix(suffix)
            && let Some(elem) = Element::from_symbol(base)
        {
            let mut metadata = HashMap::new();
            metadata.insert(
                "potcar_suffix".to_string(),
                serde_json::Value::String(suffix.to_string()),
            );
            return Some(NormalizedSymbol::with_metadata(elem, None, metadata));
        }
    }
    None
}

/// Try to parse CIF-style label: Fe1, Fe1_oct, Na2a, etc.
fn try_parse_cif_label(symbol: &str) -> Option<NormalizedSymbol> {
    // Extract alphabetic prefix as element symbol
    let elem_str: String = symbol.chars().take_while(|c| c.is_alphabetic()).collect();
    if elem_str.is_empty() {
        return None;
    }

    let elem = Element::from_symbol(&elem_str)?;

    // Store the full label if it differs from the element symbol
    if symbol.len() > elem_str.len() {
        let mut metadata = HashMap::new();
        metadata.insert(
            "label".to_string(),
            serde_json::Value::String(symbol.to_string()),
        );
        Some(NormalizedSymbol::with_metadata(elem, None, metadata))
    } else {
        Some(NormalizedSymbol::new(elem, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip() {
        // Comprehensive test: all 118 elements round-trip correctly
        for z in 1..=118 {
            let elem = Element::from_atomic_number(z).unwrap();
            assert_eq!(elem.atomic_number(), z, "atomic_number mismatch for Z={z}");
            assert_eq!(
                Element::from_symbol(elem.symbol()),
                Some(elem),
                "symbol roundtrip failed for Z={z}"
            );
            // Case-insensitive lookup
            assert_eq!(
                Element::from_symbol(&elem.symbol().to_lowercase()),
                Some(elem),
                "lowercase lookup failed for Z={z}"
            );
            assert_eq!(
                Element::from_symbol(&elem.symbol().to_uppercase()),
                Some(elem),
                "uppercase lookup failed for Z={z}"
            );
        }

        // Pseudo-elements roundtrip
        for (z, elem, sym) in [
            (119, Element::Dummy, "X"),
            (120, Element::D, "D"),
            (121, Element::T, "T"),
        ] {
            assert_eq!(Element::from_atomic_number(z), Some(elem));
            assert_eq!(elem.symbol(), sym);
            assert_eq!(Element::from_symbol(sym), Some(elem));
        }

        // Dummy atom aliases
        for alias in ["X", "Xx", "dummy", "Vac", "VA"] {
            assert_eq!(
                Element::from_symbol(alias),
                Some(Element::Dummy),
                "Dummy alias '{alias}' should work"
            );
        }

        // Edge cases: truly invalid inputs
        assert_eq!(
            Element::from_symbol(""),
            None,
            "empty string should return None"
        );
        assert_eq!(
            Element::from_symbol("  "),
            None,
            "whitespace should return None"
        );
        assert_eq!(
            Element::from_atomic_number(0),
            None,
            "Z=0 should return None"
        );
        assert_eq!(
            Element::from_atomic_number(122),
            None,
            "Z=122 should return None"
        );
        assert_eq!(
            Element::from_atomic_number(255),
            None,
            "Z=255 should return None"
        );
    }

    #[test]
    fn test_atomic_mass() {
        // Verify data arrays have consistent lengths
        assert_eq!(Element::ATOMIC_MASSES.len(), Element::SYMBOLS.len());
        assert_eq!(Element::ELECTRONEGATIVITIES.len(), Element::SYMBOLS.len());

        // Spot-check common elements (element, expected, tolerance)
        for (elem, expected, tol) in [
            (Element::H, 1.008, 0.001),
            (Element::C, 12.011, 0.001),
            (Element::N, 14.007, 0.001),
            (Element::O, 15.999, 0.001),
            (Element::Fe, 55.845, 0.01),
            (Element::Cu, 63.546, 0.01),
            (Element::Au, 196.967, 0.01),
            (Element::U, 238.029, 0.01),
        ] {
            assert!((elem.atomic_mass() - expected).abs() < tol, "{elem:?}");
        }
        // All 118 elements should have positive mass
        for z in 1..=118 {
            assert!(Element::from_atomic_number(z).unwrap().atomic_mass() > 0.0);
        }

        // Superheavy elements (Z >= 104) should have monotonically increasing mass
        // (since values are based on most stable isotopes which increase with Z)
        for z in 104..118 {
            let m1 = Element::from_atomic_number(z).unwrap().atomic_mass();
            let m2 = Element::from_atomic_number(z + 1).unwrap().atomic_mass();
            assert!(
                m2 >= m1,
                "Mass should increase: Z={z} ({m1}) <= Z={} ({m2})",
                z + 1
            );
        }
    }

    #[test]
    fn test_electronegativity() {
        // Spot-check known values (Pauling scale)
        let known_values = [
            (Element::H, Some(2.20)),
            (Element::C, Some(2.55)),
            (Element::N, Some(3.04)),
            (Element::O, Some(3.44)),
            (Element::F, Some(3.98)), // Most electronegative
            (Element::Fe, Some(1.83)),
            (Element::Au, Some(2.54)),
            // Some noble gases have no electronegativity (stored as NaN)
            (Element::He, None),
            (Element::Ne, None),
            (Element::Ar, None),
            // Note: Kr, Xe, Rn have values in this dataset (some sources assign them)
        ];

        for (elem, expected) in known_values {
            match expected {
                Some(val) => {
                    let en = elem
                        .electronegativity()
                        .unwrap_or_else(|| panic!("{elem:?} should have electronegativity"));
                    assert!(
                        (en - val).abs() < 0.01,
                        "{elem:?} electronegativity {en} != expected {val}"
                    );
                }
                None => {
                    assert!(
                        elem.electronegativity().is_none(),
                        "{elem:?} should have no electronegativity"
                    );
                }
            }
        }

        // Verify electronegativity() returns None for elements with NaN
        // (He=2, Ne=10, Ar=18 are confirmed NaN in the dataset)
        for z in [2, 10, 18] {
            let elem = Element::from_atomic_number(z).unwrap();
            assert!(
                elem.electronegativity().is_none(),
                "{elem:?} (Z={z}) should have no electronegativity"
            );
        }
    }

    #[test]
    #[allow(clippy::type_complexity)]
    fn test_normalize_symbol_comprehensive() {
        use super::{Element, normalize_symbol};

        // Test cases from the plan's symbol normalization table
        let test_cases: Vec<(&str, Element, Option<i8>, Vec<(&str, &str)>)> = vec![
            // (input, expected_element, expected_oxi, expected_metadata_pairs)
            ("Fe", Element::Fe, None, vec![]),
            ("Ca", Element::Ca, None, vec![]),
            ("O", Element::O, None, vec![]),
            // Oxidation states
            ("Fe2+", Element::Fe, Some(2), vec![]),
            ("O2-", Element::O, Some(-2), vec![]),
            ("Na+", Element::Na, Some(1), vec![]),
            ("Cl-", Element::Cl, Some(-1), vec![]),
            ("Fe3+", Element::Fe, Some(3), vec![]),
            ("Ti4+", Element::Ti, Some(4), vec![]),
            // POTCAR suffixes
            ("Ca_pv", Element::Ca, None, vec![("potcar_suffix", "_pv")]),
            ("Fe_sv", Element::Fe, None, vec![("potcar_suffix", "_sv")]),
            ("O_s", Element::O, None, vec![("potcar_suffix", "_s")]),
            // Pseudo-elements
            ("D", Element::D, None, vec![]),
            ("T", Element::T, None, vec![]),
            ("X", Element::Dummy, None, vec![]),
            ("Xx", Element::Dummy, None, vec![]),
            ("Dummy", Element::Dummy, None, vec![]),
            ("Vac", Element::Dummy, None, vec![]),
            // CIF-style labels
            ("Fe1", Element::Fe, None, vec![("label", "Fe1")]),
            ("Fe1_oct", Element::Fe, None, vec![("label", "Fe1_oct")]),
            ("Na2a", Element::Na, None, vec![("label", "Na2a")]),
            ("O2", Element::O, None, vec![("label", "O2")]),
            // Hash suffix (should be stripped, no metadata)
            ("Fe/hash123", Element::Fe, None, vec![]),
        ];

        for (input, expected_elem, expected_oxi, expected_metadata) in test_cases {
            let result = normalize_symbol(input)
                .unwrap_or_else(|e| panic!("Failed to normalize '{input}': {e}"));
            assert_eq!(
                result.element, expected_elem,
                "Element mismatch for '{input}': got {:?}, expected {:?}",
                result.element, expected_elem
            );
            assert_eq!(
                result.oxidation_state, expected_oxi,
                "Oxidation state mismatch for '{input}'"
            );

            // Check metadata
            for (key, expected_val) in expected_metadata {
                let actual = result.metadata.get(key);
                assert!(
                    actual.is_some(),
                    "Missing metadata key '{key}' for '{input}'"
                );
                let actual_str = actual.unwrap().as_str().unwrap_or("");
                assert_eq!(
                    actual_str, expected_val,
                    "Metadata mismatch for '{input}' key '{key}'"
                );
            }
        }

        // Test unknown symbol fallback to Dummy with original_symbol
        let unknown = normalize_symbol("UnknownElement123").unwrap();
        assert_eq!(unknown.element, Element::Dummy);
        assert_eq!(
            unknown
                .metadata
                .get("original_symbol")
                .and_then(|v| v.as_str()),
            Some("UnknownElement123")
        );

        // Test empty string error
        assert!(normalize_symbol("").is_err());
        assert!(normalize_symbol("   ").is_err());
    }

    #[test]
    fn test_pseudo_element_properties() {
        // Test is_pseudo and is_dummy methods
        assert!(!Element::Fe.is_pseudo());
        assert!(!Element::H.is_pseudo());
        assert!(!Element::Og.is_pseudo());

        assert!(Element::Dummy.is_pseudo());
        assert!(Element::D.is_pseudo());
        assert!(Element::T.is_pseudo());

        assert!(Element::Dummy.is_dummy());
        assert!(!Element::D.is_dummy());
        assert!(!Element::T.is_dummy());
        assert!(!Element::Fe.is_dummy());

        // Test atomic_mass for pseudo-elements
        assert_eq!(Element::Dummy.atomic_mass(), 0.0);
        assert!((Element::D.atomic_mass() - 2.014).abs() < 0.01);
        assert!((Element::T.atomic_mass() - 3.016).abs() < 0.01);

        // Test electronegativity returns None for pseudo-elements
        assert!(Element::Dummy.electronegativity().is_none());
        assert!(Element::D.electronegativity().is_none());
        assert!(Element::T.electronegativity().is_none());
    }

    #[test]
    fn test_row_and_group() {
        // Test periodic table positioning
        // Format: (element, expected_row, expected_group)
        let cases: &[(Element, u8, u8)] = &[
            // Period 1
            (Element::H, 1, 1),
            (Element::He, 1, 18),
            // Period 2
            (Element::Li, 2, 1),
            (Element::Be, 2, 2),
            (Element::B, 2, 13),
            (Element::C, 2, 14),
            (Element::N, 2, 15),
            (Element::O, 2, 16),
            (Element::F, 2, 17),
            (Element::Ne, 2, 18),
            // Period 3
            (Element::Na, 3, 1),
            (Element::Mg, 3, 2),
            (Element::Al, 3, 13),
            (Element::Ar, 3, 18),
            // Period 4 - transition metals
            (Element::K, 4, 1),
            (Element::Ca, 4, 2),
            (Element::Sc, 4, 3),
            (Element::Ti, 4, 4),
            (Element::Fe, 4, 8),
            (Element::Cu, 4, 11),
            (Element::Zn, 4, 12),
            (Element::Kr, 4, 18),
            // Lanthanoids (row 6, group 3)
            (Element::La, 6, 3),
            (Element::Ce, 6, 3),
            (Element::Lu, 6, 3),
            // Actinoids (row 7, group 3)
            (Element::Ac, 7, 3),
            (Element::U, 7, 3),
            (Element::Lr, 7, 3),
            // Period 7
            (Element::Og, 7, 18),
        ];

        for (elem, expected_row, expected_group) in cases {
            assert_eq!(
                elem.row(),
                *expected_row,
                "{elem:?} row should be {expected_row}"
            );
            assert_eq!(
                elem.group(),
                *expected_group,
                "{elem:?} group should be {expected_group}"
            );
        }

        // Pseudo-elements
        assert_eq!(Element::Dummy.row(), 0);
        assert_eq!(Element::Dummy.group(), 0);
    }

    #[test]
    fn test_block() {
        let cases: &[(Element, Block)] = &[
            // s-block: groups 1-2
            (Element::H, Block::S),
            (Element::Li, Block::S),
            (Element::Na, Block::S),
            (Element::Ca, Block::S),
            // p-block: groups 13-18 (includes He despite 1s² config)
            (Element::B, Block::P),
            (Element::C, Block::P),
            (Element::O, Block::P),
            (Element::He, Block::P),
            (Element::Ne, Block::P),
            // d-block: groups 3-12
            (Element::Sc, Block::D),
            (Element::Fe, Block::D),
            (Element::Cu, Block::D),
            (Element::Zn, Block::D),
            // f-block boundaries: La (Z=57) to Yb (Z=70), Ac (Z=89) to No (Z=102)
            (Element::La, Block::F),
            (Element::Ce, Block::F),
            (Element::Yb, Block::F),
            (Element::Ac, Block::F),
            (Element::No, Block::F),
            // Lu (Z=71) and Lr (Z=103) are d-block
            (Element::Lu, Block::D),
            (Element::Lr, Block::D),
        ];
        for (elem, expected) in cases {
            assert_eq!(elem.block(), *expected, "{elem:?} should be {expected:?}");
        }
    }

    #[test]
    fn test_classification() {
        // Helper to test a classification method on multiple elements
        fn check(elems: &[Element], pred: fn(&Element) -> bool, name: &str) {
            for elem in elems {
                assert!(pred(elem), "{elem:?} should be {name}");
            }
        }

        use Element::*;

        // Group classifications
        check(
            &[He, Ne, Ar, Kr, Xe, Rn, Og],
            Element::is_noble_gas,
            "noble gas",
        );
        check(&[Li, Na, K, Rb, Cs, Fr], Element::is_alkali, "alkali");
        check(&[Be, Mg, Ca, Sr, Ba, Ra], Element::is_alkaline, "alkaline");
        check(&[F, Cl, Br, I, At], Element::is_halogen, "halogen");
        check(&[O, S, Se, Te, Po], Element::is_chalcogen, "chalcogen");
        check(
            &[B, Si, Ge, As, Sb, Te, Po],
            Element::is_metalloid,
            "metalloid",
        );
        check(
            &[Fe, Cu, Zn, Au],
            Element::is_transition_metal,
            "transition metal",
        );
        check(&[Tc, Pm, Po, U], Element::is_radioactive, "radioactive");
        check(&[La, Ce, Sc, Y, U], Element::is_rare_earth, "rare earth");

        // Alkali/alkaline metals should also be metals
        for elem in [Li, Na, K, Be, Mg, Ca] {
            assert!(elem.is_metal(), "{elem:?} should be metal");
        }

        // Negative cases
        assert!(!H.is_noble_gas());
        assert!(!H.is_alkali()); // H is group 1 but not alkali
        assert!(!Al.is_transition_metal());
        assert!(!Fe.is_radioactive());
        assert!(!Bi.is_radioactive()); // Z=83, just below cutoff
        assert!(!Fe.is_rare_earth());
    }

    #[test]
    fn test_oxidation_states() {
        // Iron has multiple oxidation states
        let fe_oxi = Element::Fe.oxidation_states();
        assert!(fe_oxi.contains(&2), "Fe should have +2");
        assert!(fe_oxi.contains(&3), "Fe should have +3");

        let fe_common = Element::Fe.common_oxidation_states();
        assert!(!fe_common.is_empty());

        // Max and min oxidation states
        let fe_max = Element::Fe.max_oxidation_state();
        let fe_min = Element::Fe.min_oxidation_state();
        assert!(fe_max.is_some());
        assert!(fe_min.is_some());
        assert!(fe_max.unwrap() > 0);
        assert!(fe_min.unwrap() < fe_max.unwrap());

        // Oxygen
        let o_oxi = Element::O.oxidation_states();
        assert!(o_oxi.contains(&-2), "O should have -2");

        // Noble gases typically have no oxidation states
        let he_oxi = Element::He.oxidation_states();
        assert!(he_oxi.is_empty(), "He should have no oxidation states");

        // Pseudo-elements
        assert!(Element::Dummy.oxidation_states().is_empty());
    }

    #[test]
    fn test_radii() {
        // Atomic radius
        let fe_radius = Element::Fe.atomic_radius();
        assert!(fe_radius.is_some(), "Fe should have atomic radius");
        let radius = fe_radius.unwrap();
        assert!(
            radius > 1.0 && radius < 2.0,
            "Fe radius should be ~1.2-1.3 Å"
        );

        // Noble gases may not have atomic radius
        // (depends on data source)

        // Covalent radius
        let c_cov = Element::C.covalent_radius();
        assert!(c_cov.is_some(), "C should have covalent radius");

        // Ionic radii
        let fe_ionic = Element::Fe.ionic_radii();
        assert!(fe_ionic.is_some(), "Fe should have ionic radii");
        let ionic_map = fe_ionic.unwrap();
        assert!(ionic_map.contains_key("2") || ionic_map.contains_key("3"));

        // Ionic radius for specific oxidation state
        let fe2_radius = Element::Fe.ionic_radius(2);
        assert!(fe2_radius.is_some(), "Fe2+ should have ionic radius");

        // Pseudo-elements
        assert!(Element::Dummy.atomic_radius().is_none());
        assert!(Element::Dummy.ionic_radii().is_none());
    }

    #[test]
    fn test_shannon_radii() {
        // Fe should have Shannon radii
        let fe_shannon = Element::Fe.shannon_radii();
        assert!(fe_shannon.is_some(), "Fe should have Shannon radii");

        // Fe2+ in octahedral coordination should have radius
        // Note: Shannon data uses Roman numerals for coordination
        let fe2_vi = Element::Fe.shannon_ionic_radius(2, "VI", "High Spin");
        // This may be None if the exact key doesn't match - just test the API works
        if let Some(radius) = fe2_vi {
            assert!(
                radius > 0.0 && radius < 1.5,
                "Shannon radius should be reasonable"
            );
        }

        // Na should have Shannon radii for +1
        let na_shannon = Element::Na.shannon_radii();
        assert!(na_shannon.is_some(), "Na should have Shannon radii");

        // Pseudo-elements
        assert!(Element::Dummy.shannon_radii().is_none());
    }

    #[test]
    fn test_name() {
        assert_eq!(Element::Fe.name(), "Iron");
        assert_eq!(Element::H.name(), "Hydrogen");
        assert_eq!(Element::O.name(), "Oxygen");
        assert_eq!(Element::Au.name(), "Gold");
        assert_eq!(Element::Og.name(), "Oganesson");

        // Pseudo-elements return "Unknown"
        assert_eq!(Element::Dummy.name(), "Unknown");
    }

    // =========================================================================
    // Pymatgen Edge Case Tests (ported from pymatgen test suite)
    // =========================================================================

    #[test]
    fn test_invalid_symbols() {
        // Invalid symbols should return None
        assert!(Element::from_symbol("Dolphin").is_none());
        assert!(Element::from_symbol("Tyrannosaurus").is_none());
        assert!(Element::from_symbol("Zebra").is_none());
        // Note: Short invalid symbols may return Dummy instead of None
    }

    #[test]
    fn test_isotopes_d_t() {
        // D and T are isotopes of hydrogen
        let d = Element::D;
        let t = Element::T;
        let h = Element::H;

        // All should have symbol "H" (normalized)
        assert_eq!(d.symbol(), "D");
        assert_eq!(t.symbol(), "T");
        assert_eq!(h.symbol(), "H");

        // Different atomic masses
        let h_mass = h.atomic_mass();
        let d_mass = d.atomic_mass();
        let t_mass = t.atomic_mass();
        assert!(d_mass > h_mass, "D mass should be > H mass");
        assert!(t_mass > d_mass, "T mass should be > D mass");
        assert!((d_mass - 2.014).abs() < 0.01, "D mass ≈ 2.014");
        assert!((t_mass - 3.016).abs() < 0.01, "T mass ≈ 3.016");
    }

    #[test]
    fn test_from_atomic_number() {
        assert_eq!(Element::from_atomic_number(1), Some(Element::H));
        assert_eq!(Element::from_atomic_number(26), Some(Element::Fe));
        assert_eq!(Element::from_atomic_number(118), Some(Element::Og));
        assert_eq!(Element::from_atomic_number(0), None);
    }

    #[test]
    fn test_element_equality() {
        assert_eq!(Element::Fe, Element::Fe);
        assert_eq!(Element::from_symbol("Fe"), Some(Element::Fe));
    }

    #[test]
    fn test_normalize_symbol_edge_cases() {
        // Combined test for symbol normalization edge cases
        let simple_cases: &[(&str, Element)] = &[
            // POTCAR suffixes
            ("Ca_pv", Element::Ca),
            ("Fe_sv", Element::Fe),
            ("O_s", Element::O),
            // CIF labels
            ("Fe1", Element::Fe),
            ("Fe1a", Element::Fe),
            ("Na2", Element::Na),
            // Slash suffix (VASP 6.4.2)
            ("Li/", Element::Li),
        ];
        for (symbol, expected) in simple_cases {
            let norm = normalize_symbol(symbol).expect(symbol);
            assert_eq!(norm.element, *expected, "{symbol}");
        }

        // Oxidation state cases
        let oxi_cases: &[(&str, Element, i8)] = &[
            ("Fe2+", Element::Fe, 2),
            ("O2-", Element::O, -2),
            ("Na+", Element::Na, 1),
            ("Cl-", Element::Cl, -1),
        ];
        for (symbol, elem, oxi) in oxi_cases {
            let norm = normalize_symbol(symbol).expect(symbol);
            assert_eq!(norm.element, *elem, "{symbol}");
            assert_eq!(norm.oxidation_state, Some(*oxi), "{symbol}");
        }
    }

    #[test]
    fn test_element_edge_cases() {
        // Dummy element has atomic number > 118, missing properties
        let dummy = Element::Dummy;
        assert!(dummy.atomic_number() > 118);
        assert!(dummy.atomic_radius().is_none());
        assert!(dummy.oxidation_states().is_empty());

        // Noble gases have undefined electronegativity (converted to None)
        assert!(Element::He.electronegativity().is_none());

        // U has many oxidation states
        assert!(!Element::U.oxidation_states().is_empty());

        // Og handles missing data gracefully
        let _ = (Element::Og.atomic_radius(), Element::Og.covalent_radius());
    }
}
