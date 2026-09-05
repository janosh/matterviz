# [MatterViz VSCode Extension]

[matterviz vscode extension]: https://marketplace.visualstudio.com/items?itemName=janosh.matterviz

**MatterViz** is a VSCode extension that renders crystal structures and MD / geometry-optimization trajectories in the editor.

## ✨ Features

### 🔬 **Structure Visualization**

- **Crystal Structures**: Visualize CIF, POSCAR, VASP, and other crystallographic formats
- **Molecular Systems**: Display XYZ, JSON, and YAML molecular structures
- **Interactive 3D Viewer**: Rotate, zoom, and explore structures
- **Atomic Properties**: View element information, bonding, and structural details

### 🎬 **Trajectory Analysis**

- **MD Trajectories**: Animate and analyze molecular dynamics simulations
- **Multi-format Support**: Handle TRAJ, ExtXYZ, HDF5, and compressed formats
- **Playback Controls**: Navigate through trajectory frames with timeline controls
- **Frame Analysis**: Extract and analyze individual frames from trajectories

### 🎨 **Customization**

- **Color Schemes**: Multiple built-in color schemes (Jmol, VESTA, Alloy, Pastel, etc.)
- **Visualization Modes**: Ball-and-stick, space-filling, wireframe representations
- **Export Options**: Save visualizations to PNG or export structure data to ASE XYZ and pymatgen JSON

## 🚀 Installation

Search for "MatterViz" in the VS Code Extensions marketplace.

## 📋 Usage

### Quick Start

1. **Open a structure file** in VS Code (`.cif`, `.poscar`, `.xyz`, `.json`, etc.)
2. **Right-click** in the explorer or editor
3. **Select "MatterViz: Open"** from the context menu
4. **Or use the keyboard shortcut**: `Ctrl+Shift+V` (Windows/Linux) / `Cmd+Shift+V` (Mac)

### Supported File Formats

#### Structure Files

- **CIF** - Crystallographic Information Files
- **POSCAR/CONTCAR** - VASP structure files
- **XYZ/ExtXYZ** - Standard molecular coordinate formats
- **JSON** - JSON-formatted structure data (pymatgen, OPTIMADE)
- **YAML/YML** - YAML structure definitions

#### Trajectory Files

- **TRAJ** - ASE trajectory files
- **ExtXYZ** - Extended XYZ trajectories
- **HDF5/H5** - `flame` HDF5 trajectory formats
- **JSON** - `pymatgen` JSON trajectory formats

#### Fermi Surface Files

- **BXSF** - XCrySDen band structure format
- **FRMSF** - FermiSurfer format

#### Volumetric Data Files

- **CUBE** - Gaussian cube files
- **CHGCAR/ELFCAR/LOCPOT/AECCAR/PARCHG** - VASP volumetric output
- **3D + 2D views** - Switch between interactive isosurfaces and HKL/arbitrary Cartesian cross-sections with filled or contour rendering

#### Compressed Files

All formats above are also supported with `.gz` compression.

#### JSON Files with Multiple Data Types

When a `.json` file contains recognized data (structures, band structures, DOS, convex hulls, phase diagrams, Fermi surfaces, Brillouin zones, XRD patterns, or tabular data), MatterViz opens a **JSON browser** with a navigable tree sidebar and visualization canvas. Renderable nodes are marked with colored badges -- click to render, or drag to a canvas edge to create a split view with multiple visualizations side by side. When both band structure and DOS data are found together, they're rendered as a combined Bands+DOS plot.

### Custom Editor Integration

MatterViz automatically registers as a custom editor for trajectory files such as `.traj`, `.h5`, `.hdf5`, `.xyz.gz`, etc.

### Remote SSH Support

MatterViz supports [VSCode](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh)/[Cursor](https://open-vsx.org/extension/jajera/vsx-remote-ssh) remote SSH connections. Connect to your server via Remote SSH extension, and MatterViz should work just like it does locally.

- ✅ **Remote file access**: Visualize structures and trajectories on remote servers (HPC clusters, cloud instances, etc.)
- ✅ **No manual file transfer**: Files are read directly from the remote filesystem
- ✅ **File watching**: Changes to remote files are automatically detected and reloaded
- ⚠️ **File size limit**: Files are read into extension memory in one operation on both local and Remote SSH workspaces. Non-text files larger than 1 GiB are rejected to prevent memory issues. XYZ/EXTXYZ text trajectories are limited by Node.js text decoding and are currently rejected above about 512 MiB. Other text formats (e.g. JSON, POSCAR, CIF) above about 400 MiB are rejected because large-file loading currently supports trajectories only.
- ℹ️ **Parsing runs off the UI thread**: files below the 400 MiB streaming threshold are parsed in a Web Worker inside the editor tab, so the webview stays responsive while a large file loads. If the worker cannot start, files up to 25 MiB (text) / 50 MiB (binary) are parsed on the main thread instead; larger ones report an error rather than freezing the tab. Trajectories above 400 MiB stay in the extension host, which opens them as a lazily decoded run, sends the webview a summary plus per-frame plot rows as they are extracted, and serves frames on request.

## ⚙️ Configuration & Customization

MatterViz provides extensive customization options through VSCode settings. Access these via:

- **Settings UI**: `File → Preferences → Settings` → Search for "MatterViz"
- **JSON Settings**: `Ctrl+Shift+P` → "Preferences: Open Settings (JSON)"

### Common Configuration Scenarios

#### 🎨 **Visual Appearance**

```json
{
  "matterviz.color_scheme": "Jmol",
  "matterviz.background_color": "#ffffff",
  "matterviz.background_opacity": 0.8,
  "matterviz.structure.show_image_atoms": true,
  "matterviz.structure.atom_radius": 1.2,
  "matterviz.structure.bond_thickness": 0.8
}
```

#### 🎬 **Trajectory Playback**

```json
{
  "matterviz.trajectory.auto_play": true,
  "matterviz.trajectory.fps": 10,
  "matterviz.trajectory.display_mode": "structure+scatter",
  "matterviz.trajectory.show_controls": true,
  "matterviz.trajectory.atom_type_mapping": { "1": "Si", "2": "O" }
}
```

`matterviz.trajectory.atom_type_mapping` names the bare integer atom types of LAMMPS dumps (`.lammpstrj`), which rarely carry an element column. Unmapped types are read as atomic numbers (type 1 = H, 2 = He, ...) with a warning, so set it per workspace (`.vscode/settings.json`) to match the simulation's input script.

#### 📊 **Plot Customization**

```json
{
  "matterviz.scatter.point.size": 5,
  "matterviz.scatter.line.width": 3,
  "matterviz.plot.display.x_grid": true,
  "matterviz.scatter.show_legend": "auto"
}
```

#### 🔧 **Performance Optimization**

```json
{
  "matterviz.trajectory.index_above_bytes": 10000000,
  "matterviz.structure.sphere_segments": 16
}
```

`matterviz.trajectory.index_above_bytes` (default 25 MB) is the single large-file threshold: XYZ/EXTXYZ and ASE `.traj` files above it are indexed and decoded frame by frame on demand instead of being materialised up front. It replaces the former `bin_file_threshold`, `text_file_threshold` and `use_indexing` settings.

### Setting Categories

- **General** — Global appearance and behavior: `color_scheme`, `background_color`
- **Structure** — 3D structure visualization: `atom_radius`, `bond_thickness`, `show_cell_vectors`, `ambient_light`, `show_image_atoms`
- **Trajectory** — Animation and playback controls: `fps`, `auto_play`, `display_mode`, `show_controls`
- **Plots** — Scatter plots and histograms: `scatter.point.size`, `plot.display.x_grid`, `histogram.mode`
- **Performance** — Memory and processing options: `trajectory.index_above_bytes`, `structure.sphere_segments`

### Pro Tips

- **Reset to defaults**: Remove custom settings from your JSON config
- **Project-specific settings**: Use workspace settings (`.vscode/settings.json`) for per-project customization
- **Theme integration**: MatterViz automatically adapts to your VSCode color theme
- **Performance**: Reduce `sphere_segments` for better performance with large structures

## ⌨️ Keyboard Shortcuts

- `Ctrl+Shift+V` / `Cmd+Shift+V` → Render structure/trajectory with MatterViz

## 🐛 Bug Reporting

If you encounter any issues with MatterViz, you can use the built-in bug reporting command to collect debug information:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **"Report MatterViz Bug"**
3. The command will open a new document with detailed debug information including:
   - Your OS and version
   - VSCode/Cursor version
   - MatterViz version
   - Remote vs local session
   - Files currently being rendered
   - System resources and memory usage
   - Extension configuration
4. Copy the information and include it when [creating a GitHub issue](https://github.com/janosh/matterviz/issues/new)

Render confirmations (which file was rendered, how many sites/frames) are logged to the **MatterViz** channel in the Output panel (`View → Output`) rather than shown as notifications; errors still appear as notifications.

## 📄 License

This extension is [MIT-Licensed](./license).

## 🔗 Related Projects

- **✅ MatterViz Web**: [matterviz.janosh.dev](https://matterviz.janosh.dev)
- **✅ pymatviz**: [Jupyter](https://jupyter.org)/[Marimo](https://marimo.io) extension for Python notebooks. Read about widgets in [`pymatviz` readme](https://github.com/janosh/pymatviz/blob/main/readme.md#interactive-widgets) for details.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](../../contributing.md) for details.

## 🛠️ Development

The extension bundles source from the repository and uses shared dependencies from the root installation. Install both root and extension dependencies before building.

```bash
git clone https://github.com/janosh/matterviz
cd matterviz
pnpm install --no-lockfile
pnpm -C extensions/vscode install --ignore-workspace --no-lockfile
cd extensions/vscode
pnpm run build
vsce package  # creates .vsix for local install
```

### Publishing

Publish to both [Open VSX](https://open-vsx.org/extension/janosh/matterviz) and [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=janosh.matterviz):

```bash
cd extensions/vscode
npm run package

# Open VSX (token at ~/.config/matterviz/ovsx-token)
npx ovsx publish matterviz-*.vsix -p $(cat ~/.config/matterviz/ovsx-token)

# VS Code Marketplace (requires `brew install azure-cli` for auth)
az login --allow-no-subscriptions --scope https://app.vssps.visualstudio.com/.default
TOKEN=$(python3 -c "import json,os;c=json.load(open(os.path.expanduser('~/.azure/msal_token_cache.json')));print(next(t['secret'] for t in c['AccessToken'].values() if 'vssps.visualstudio.com' in t.get('target','')))")
vsce publish --no-dependencies -p "$TOKEN"
```
