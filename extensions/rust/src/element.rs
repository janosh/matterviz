//! Chemical element definitions.
//!
//! This module provides the `Element` enum representing all 118 chemical elements,
//! along with associated data like atomic numbers, symbols, and electronegativities.

use serde::{Deserialize, Serialize};

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

    /// Pauling electronegativities (NaN for elements without defined values).
    /// Index 0 corresponds to H (Z=1).
    const ELECTRONEGATIVITIES: [f64; 118] = [
        2.20, f64::NAN, 0.98, 1.57, 2.04, 2.55, 3.04, 3.44, 3.98, f64::NAN, // H-Ne
        0.93, 1.31, 1.61, 1.90, 2.19, 2.58, 3.16, f64::NAN, 0.82, 1.00, // Na-Ca
        1.36, 1.54, 1.63, 1.66, 1.55, 1.83, 1.88, 1.91, 1.90, 1.65, // Sc-Zn
        1.81, 2.01, 2.18, 2.55, 2.96, 3.00, 0.82, 0.95, 1.22, 1.33, // Ga-Zr
        1.60, 2.16, 1.90, 2.20, 2.28, 2.20, 1.93, 1.69, 1.78, 1.96, // Nb-Sn
        2.05, 2.10, 2.66, 2.60, 0.79, 0.89, 1.10, 1.12, 1.13, 1.14, // Sb-Nd
        f64::NAN, 1.17, f64::NAN, 1.20, f64::NAN, 1.22, 1.23, 1.24, 1.25, f64::NAN, // Pm-Yb
        1.27, 1.30, 1.50, 2.36, 1.90, 2.20, 2.20, 2.28, 2.54, 2.00, // Lu-Hg
        1.62, 2.33, 2.02, 2.00, 2.20, f64::NAN, 0.70, 0.90, 1.10, 1.30, // Tl-Th
        1.50, 1.38, 1.36, 1.28, 1.30, 1.30, 1.30, 1.30, 1.30, 1.30, // Pa-Fm
        1.30, f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN, // Md-Hs
        f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN, // Mt-Lv
        f64::NAN, f64::NAN, // Ts-Og
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
    /// assert_eq!(Element::from_symbol("Xx"), None);
    /// ```
    pub fn from_symbol(symbol: &str) -> Option<Self> {
        let symbol_lower = symbol.to_lowercase();
        Self::SYMBOLS
            .iter()
            .position(|s| s.to_lowercase() == symbol_lower)
            .and_then(|idx| Self::from_atomic_number((idx + 1) as u8))
    }

    /// Create an element from its atomic number (1-118).
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert_eq!(Element::from_atomic_number(26), Some(Element::Fe));
    /// assert_eq!(Element::from_atomic_number(0), None);
    /// assert_eq!(Element::from_atomic_number(119), None);
    /// ```
    pub fn from_atomic_number(z: u8) -> Option<Self> {
        if z == 0 || z > 118 {
            return None;
        }
        // SAFETY: z is in range 1-118 which matches our enum discriminants
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
    /// ```
    pub fn symbol(&self) -> &'static str {
        Self::SYMBOLS[self.atomic_number() as usize - 1]
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
    /// Returns `None` for noble gases and some transactinides.
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::element::Element;
    ///
    /// assert!((Element::Fe.electronegativity().unwrap() - 1.83).abs() < 0.01);
    /// assert!(Element::He.electronegativity().is_none());  // Noble gas
    /// ```
    pub fn electronegativity(&self) -> Option<f64> {
        let en = Self::ELECTRONEGATIVITIES[self.atomic_number() as usize - 1];
        if en.is_nan() {
            None
        } else {
            Some(en)
        }
    }
}

impl std::fmt::Display for Element {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.symbol())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_from_symbol() {
        assert_eq!(Element::from_symbol("H"), Some(Element::H));
        assert_eq!(Element::from_symbol("Fe"), Some(Element::Fe));
        assert_eq!(Element::from_symbol("fe"), Some(Element::Fe));
        assert_eq!(Element::from_symbol("FE"), Some(Element::Fe));
        assert_eq!(Element::from_symbol("Og"), Some(Element::Og));
        assert_eq!(Element::from_symbol("Xx"), None);
        assert_eq!(Element::from_symbol(""), None);
    }

    #[test]
    fn test_from_atomic_number() {
        assert_eq!(Element::from_atomic_number(1), Some(Element::H));
        assert_eq!(Element::from_atomic_number(26), Some(Element::Fe));
        assert_eq!(Element::from_atomic_number(118), Some(Element::Og));
        assert_eq!(Element::from_atomic_number(0), None);
        assert_eq!(Element::from_atomic_number(119), None);
    }

    #[test]
    fn test_symbol() {
        assert_eq!(Element::H.symbol(), "H");
        assert_eq!(Element::Fe.symbol(), "Fe");
        assert_eq!(Element::Og.symbol(), "Og");
    }

    #[test]
    fn test_atomic_number() {
        assert_eq!(Element::H.atomic_number(), 1);
        assert_eq!(Element::Fe.atomic_number(), 26);
        assert_eq!(Element::Og.atomic_number(), 118);
    }

    #[test]
    fn test_electronegativity() {
        // Known values
        assert!((Element::H.electronegativity().unwrap() - 2.20).abs() < 0.01);
        assert!((Element::Fe.electronegativity().unwrap() - 1.83).abs() < 0.01);
        assert!((Element::F.electronegativity().unwrap() - 3.98).abs() < 0.01);

        // Noble gases have no electronegativity
        assert!(Element::He.electronegativity().is_none());
        assert!(Element::Ne.electronegativity().is_none());
        assert!(Element::Ar.electronegativity().is_none());
    }

    #[test]
    fn test_roundtrip() {
        for z in 1..=118 {
            let elem = Element::from_atomic_number(z).unwrap();
            assert_eq!(elem.atomic_number(), z);
            assert_eq!(Element::from_symbol(elem.symbol()), Some(elem));
        }
    }
}
