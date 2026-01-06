# Thermodynamic Database (TDB) Files

TDB files for binary alloy systems from **NIMS (National Institute for Materials Science), Japan** (abe.taichi@nims.go.jp).

| File        | System             | Reference                                                                        |
| ----------- | ------------------ | -------------------------------------------------------------------------------- |
| `Al-Fe.tdb` | Aluminum-Iron      | I. Ansara et al., *Thermochemical database for light metal alloys*, vol. 2, 1998 |
| `Al-Mg.tdb` | Aluminum-Magnesium | Y. Zhong, M. Yang, Z.-K. Liu, *CALPHAD* 29 (2005) 303-311                        |
| `Pb-Sn.tdb` | Lead-Tin           | T.L. Ngai, Y.A. Chang, *CALPHAD* 5 (1981) 267-276                                |

## Usage

TDB files contain **model parameters** (Gibbs energy functions), not the phase diagram itself. Computing phase boundaries requires:

1. Reading the TDB file to extract thermodynamic models
2. Performing Gibbs energy minimization at each temperature-composition point
3. Identifying equilibrium phases at each point

Example with pycalphad:

```py
from pycalphad import Database, binplot
import pycalphad.variables as v

db = Database("Al-Mg.tdb")
binplot(db, ["AL", "MG", "VA"], list(db.phases), {
    v.X("MG"): (0, 1, 0.01), v.T: (300, 1000, 5), v.P: 101325, v.N: 1
})
```

## Pre-computed Phase Diagrams

The `../binary/` directory contains pre-computed phase diagram JSON files. **These are simplified/approximate representations** created for UI demo purposes only. They illustrate typical phase diagram features but are not thermodynamically rigorous! They omit intermetallic phases (e.g., Al-Mg β/γ, Cu-Zn β/γ/δ/ε).

## License

Copyright © NIMS. Reproduced for educational use.
