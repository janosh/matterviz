# [MatterViz VSCode Extension]

[matterviz vscode extension]: https://marketplace.visualstudio.com/items?itemName=janosh.matterviz

**MatterViz** offers a VSCode extension for rendering crystal structures and molecular dynamics (MD) or geometry optimization trajectories directly in the editor to speed up typical materials science/computational chemistry workflows.

## ✨ Features

### 🔬 **Structure Visualization**

- **Crystal Structures**: Visualize CIF, POSCAR, VASP, and other crystallographic formats
- **Molecular Systems**: Display XYZ, JSON, and YAML molecular structures
- **Interactive 3D Viewer**: Rotate, zoom, and explore structures with intuitive controls
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
3. **Select "Render with MatterViz"** from the context menu
4. **Or use the keyboard shortcut**: `Ctrl+Shift+V` (Windows/Linux) / `Cmd+Shift+V` (Mac)

### Supported File Formats

#### Structure Files

- **CIF** - Crystallographic Information Files
- **POSCAR/CONTCAR** - VASP structure files
- **XYZ/ExtXYZ** - Standard molecular coordinate formats
- **JSON** - JSON-formatted structure data
- **YAML/YML** - YAML structure definitions

#### Trajectory Files

- **TRAJ** - ASE trajectory files
- **ExtXYZ** - Extended XYZ trajectories
- **HDF5/H5** - `torch-sim` HDF5 trajectory formats
- **JSON** - `pymatgen` JSON trajectory formats
- **Compressed files** - `.gz` compressed versions of above

### Custom Editor Integration

MatterViz automatically registers as a custom editor for trajectory files such as `.traj`, `.h5`, `.hdf5`, `.xyz.gz`, etc.

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
  "matterviz.trajectory.show_controls": true
}
```

#### 📊 **Plot Customization**

```json
{
  "matterviz.trajectory.scatter_point_size": 5,
  "matterviz.trajectory.scatter_line_width": 3,
  "matterviz.trajectory.plot_grid_lines": true,
  "matterviz.trajectory.scatter_show_legend": true
}
```

#### 🔧 **Performance Optimization**

```json
{
  "matterviz.trajectory.chunk_size": 500,
  "matterviz.trajectory.array_buffer_threshold": 10485760,
  "matterviz.structure.sphere_segments": 16
}
```

### Setting Categories

| Category        | Description                     | Example Settings                                          |
| --------------- | ------------------------------- | --------------------------------------------------------- |
| **General**     | Global appearance and behavior  | `color_scheme`, `background_color`, `show_image_atoms`    |
| **Structure**   | 3D structure visualization      | `atom_radius`, `bond_thickness`, `show_cell`, `lighting`  |
| **Trajectory**  | Animation and playback controls | `fps`, `auto_play`, `display_mode`, `show_controls`       |
| **Plots**       | Scatter plots and histograms    | `scatter_point_size`, `plot_grid_lines`, `auto_fit_range` |
| **Performance** | Memory and processing options   | `chunk_size`, `use_indexing`, `sphere_segments`           |

### Pro Tips

- **Reset to defaults**: Remove custom settings from your JSON config
- **Project-specific settings**: Use workspace settings (`.vscode/settings.json`) for per-project customization
- **Theme integration**: MatterViz automatically adapts to your VSCode color theme
- **Performance**: Reduce `sphere_segments` for better performance with large structures

## ⌨️ Keyboard Shortcuts

- `Ctrl+Shift+V` / `Cmd+Shift+V` → Render structure/trajectory with MatterViz

## 📄 License

This extension is [MIT-Licensed](./license).

## 🔗 Related Projects

- **✅ MatterViz Web**: [matterviz.janosh.dev](https://matterviz.janosh.dev)
- **✅ pymatviz**: [Jupyter](https://jupyter.org)/[Marimo](https://marimo.io) extension for Python notebooks. Read about widgets in [`pymatviz` readme](https://github.com/janosh/pymatviz/blob/main/readme.md#interactive-widgets) for details.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](../../contributing.md) for details.

## 🛠️ Development

```bash
git clone https://github.com/janosh/matterviz
cd matterviz/extensions/vscode
pnpm install
pnpm build
vsce package
```
