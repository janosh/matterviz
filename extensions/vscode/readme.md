# MatterViz VS Code Extension

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

MatterViz automatically registers as a custom editor for trajectory files (`.traj`, `.h5`, `.hdf5`, `.gz`), providing seamless integration with VS Code's editor system.

## ⌨️ Keyboard Shortcuts

| Shortcut                       | Action                          |
| ------------------------------ | ------------------------------- |
| `Ctrl+Shift+V` / `Cmd+Shift+V` | Render structure with MatterViz |

## 🛠️ Development

This extension is built with:

- **TypeScript** - Main extension logic
- **Svelte 5** - Modern reactive webview components
- **Vite** - Fast build tooling
- **Three.js** - 3D visualization engine

### Building from Source

```bash
cd extensions/vscode
pnpm install
pnpm build
vsce package
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](../../contributing.md) for details.

## 📄 License

This extension is [MIT-Licensed](./license).

## 🐛 Issues & Support

- **Bug Reports**: [GitHub Issues](https://github.com/janosh/matterviz/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/janosh/matterviz/discussions)
- **Documentation**: [MatterViz Docs](https://matterviz.janosh.dev)

## 🔗 Related Projects

- **MatterViz Web**: Full-featured web application at [matterviz.janosh.dev](https://matterviz.janosh.dev)
- (TODO) **MatterViz CLI**: Command-line interface for batch processing
- (TODO) **MatterViz iPython**: [Jupyter](https://jupyter.org)/[Marimo](https://marimo.io) extension for interactive Python-based visualization
