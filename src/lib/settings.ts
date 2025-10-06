// MatterViz settings schema - single source of truth for all MatterViz settings
// Used by both main package and VSCode extension

import type { Vec3 } from '$lib/math'
import type { D3SymbolName, Markers, Orientation } from '$lib/plot'
import { symbol_names } from '$lib/plot/formatting'
import type { BondingStrategy } from '$lib/structure/bonding'

// SettingType interface with optional context to control where settings apply
// context: 'web' = web browser only, 'editor' = VSCode extension only, 'notebook' = Jupyter/marimo only, 'all' or undefined = all contexts
export interface SettingType<T = unknown> {
  value: T
  description: string
  enum?: readonly string[]
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  context?: `web` | `editor` | `notebook` | `all`
}

export const show_bonds_options = [`never`, `always`, `crystals`, `molecules`] as const
export type ShowBonds = (typeof show_bonds_options)[number]

export interface SettingsConfig {
  // General display settings
  color_scheme: SettingType<string>
  background_color: SettingType<string>
  background_opacity: SettingType<number>

  structure: { // Structure viewer settings
    // Atoms & Bonds
    atom_radius: SettingType<number>
    same_size_atoms: SettingType<boolean>
    show_atoms: SettingType<boolean>
    show_image_atoms: SettingType<boolean>
    sphere_segments: SettingType<number>
    bond_thickness: SettingType<number>
    show_bonds: SettingType<ShowBonds>
    bond_color: SettingType<string>
    bonding_strategy: SettingType<BondingStrategy>

    // Camera & Controls
    show_gizmo: SettingType<boolean>
    camera_position: SettingType<Vec3>
    camera_projection: SettingType<`perspective` | `orthographic`>
    initial_zoom: SettingType<number>
    fov: SettingType<number>
    rotation_damping: SettingType<number>
    zoom_speed: SettingType<number>
    pan_speed: SettingType<number>
    max_zoom: SettingType<number | undefined>
    min_zoom: SettingType<number | undefined>
    auto_rotate: SettingType<number>
    // Manual rotation controls [x, y, z] in radians
    rotation: SettingType<Vec3>

    // Labels & Lighting
    show_site_labels: SettingType<boolean>
    show_site_indices: SettingType<boolean>
    site_label_size: SettingType<number>
    site_label_color: SettingType<string>
    site_label_bg_color: SettingType<string>
    site_label_padding: SettingType<number>
    site_label_offset: SettingType<Vec3>
    ambient_light: SettingType<number>
    directional_light: SettingType<number>

    // Forces & Lattice
    show_force_vectors: SettingType<boolean>
    force_scale: SettingType<number>
    force_color: SettingType<string>
    force_shaft_radius: SettingType<number>
    force_arrow_head_radius: SettingType<number>
    force_arrow_head_length: SettingType<number>
    show_cell: SettingType<boolean>
    show_cell_vectors: SettingType<boolean>
    cell_edge_opacity: SettingType<number>
    cell_surface_opacity: SettingType<number>
    cell_edge_color: SettingType<string>
    cell_surface_color: SettingType<string>
    cell_edge_width: SettingType<number>
    fullscreen_toggle: SettingType<boolean>
  }

  trajectory: { // Trajectory viewer settings
    // Core trajectory settings
    auto_play: SettingType<boolean>
    fps: SettingType<number>
    fps_range: SettingType<[number, number]>
    display_mode: SettingType<
      | `structure+scatter`
      | `structure`
      | `scatter`
      | `histogram`
      | `structure+histogram`
    >
    show_controls: SettingType<boolean>
    fullscreen_toggle: SettingType<boolean>
    step_labels: SettingType<number>
    layout: SettingType<`auto` | Orientation>

    // File handling and loading
    allow_file_drop: SettingType<boolean>
    bin_file_threshold: SettingType<number>
    text_file_threshold: SettingType<number>
    use_indexing: SettingType<boolean>
    chunk_size: SettingType<number>

    // Histogram specific
    histogram_mode: SettingType<`overlay` | `single`>
    histogram_show_legend: SettingType<boolean>
    histogram_bin_count: SettingType<number>

    // Histogram specific (additional to existing)
    histogram_bar_opacity: SettingType<number>
    histogram_bar_stroke_width: SettingType<number>

    // Formatting
    step_label_format: SettingType<string>
    property_value_format: SettingType<string>
    tooltip_format: SettingType<string>

    // UI/UX
    enable_keyboard_shortcuts: SettingType<boolean>
    show_parsing_progress: SettingType<boolean>
    compact_controls: SettingType<boolean>
    show_filename_in_controls: SettingType<boolean>

    // Playback behavior
    smooth_playback: SettingType<boolean>
    loop_playback: SettingType<boolean>
    pause_on_hover: SettingType<boolean>
    highlight_current_frame: SettingType<boolean>
    show_frame_info: SettingType<boolean>

    // Performance
    max_frames_in_memory: SettingType<number>
    memory_usage_warning_threshold: SettingType<number>
    enable_performance_monitoring: SettingType<boolean>
    prefetch_frames: SettingType<number>
    cache_parsed_data: SettingType<boolean>
  }

  plot: { // General plot settings
    animation_duration: SettingType<number>
    enable_zoom: SettingType<boolean>
    zoom_factor: SettingType<number>
    auto_fit_range: SettingType<boolean>
    grid_lines: SettingType<boolean>
    axis_labels: SettingType<boolean>
    show_zero_lines: SettingType<boolean>
    x_grid: SettingType<boolean>
    y_grid: SettingType<boolean>
    y2_grid: SettingType<boolean>
    x_format: SettingType<string>
    y_format: SettingType<string>
    y2_format: SettingType<string>
    x_scale_type: SettingType<string>
    y_scale_type: SettingType<string>
    x_ticks: SettingType<number>
    y_ticks: SettingType<number>
  }

  scatter: { // Scatter plot settings
    point_size: SettingType<number>
    show_legend: SettingType<boolean>
    markers: SettingType<Markers>
    point_color: SettingType<string>
    point_opacity: SettingType<number>
    point_stroke_width: SettingType<number>
    point_stroke_color: SettingType<string>
    point_stroke_opacity: SettingType<number>
    line_width: SettingType<number>
    line_color: SettingType<string>
    line_opacity: SettingType<number>
    line_dash: SettingType<string>
    show_points: SettingType<boolean>
    show_lines: SettingType<boolean>
    symbol_type: SettingType<D3SymbolName>
  }

  composition: { // Composition specific settings
    display_mode: SettingType<`pie` | `bubble` | `bar`>
    color_scheme: SettingType<string>
  }

  phase_diagram: { // Phase diagram defaults (binary/ternary/quaternary)
    binary: {
      camera_zoom: SettingType<number>
      camera_center_x: SettingType<number>
      camera_center_y: SettingType<number>
      color_mode: SettingType<`stability` | `energy`>
      color_scale: SettingType<string>
      show_stable: SettingType<boolean>
      show_unstable: SettingType<boolean>
      show_stable_labels: SettingType<boolean>
      show_unstable_labels: SettingType<boolean>
      energy_threshold: SettingType<number>
      label_energy_threshold: SettingType<number>
      fullscreen: SettingType<boolean>
      info_pane_open: SettingType<boolean>
      legend_pane_open: SettingType<boolean>
    }
    ternary: {
      camera_elevation: SettingType<number>
      camera_azimuth: SettingType<number>
      camera_zoom: SettingType<number>
      camera_center_x: SettingType<number>
      camera_center_y: SettingType<number>
      color_mode: SettingType<`stability` | `energy`>
      color_scale: SettingType<string>
      show_stable: SettingType<boolean>
      show_unstable: SettingType<boolean>
      show_stable_labels: SettingType<boolean>
      show_unstable_labels: SettingType<boolean>
      energy_threshold: SettingType<number>
      label_energy_threshold: SettingType<number>
      show_hull_faces: SettingType<boolean>
      hull_face_color: SettingType<string>
      hull_face_opacity: SettingType<number>
      fullscreen: SettingType<boolean>
      info_pane_open: SettingType<boolean>
      legend_pane_open: SettingType<boolean>
    }
    quaternary: {
      camera_rotation_x: SettingType<number>
      camera_rotation_y: SettingType<number>
      camera_zoom: SettingType<number>
      camera_center_x: SettingType<number>
      camera_center_y: SettingType<number>
      color_mode: SettingType<`stability` | `energy`>
      color_scale: SettingType<string>
      show_stable: SettingType<boolean>
      show_unstable: SettingType<boolean>
      show_stable_labels: SettingType<boolean>
      show_unstable_labels: SettingType<boolean>
      show_hull_faces: SettingType<boolean>
      hull_face_color: SettingType<string>
      hull_face_opacity: SettingType<number>
      energy_threshold: SettingType<number>
      label_energy_threshold: SettingType<number>
      fullscreen: SettingType<boolean>
      info_pane_open: SettingType<boolean>
      legend_pane_open: SettingType<boolean>
    }
  }
}

// Complete settings configuration with values, descriptions, and constraints
export const SETTINGS_CONFIG: SettingsConfig = {
  // General display settings
  color_scheme: {
    value: `Vesta`,
    description: `Color scheme for atoms and bonds`,
    enum: [`Vesta`, `Jmol`, `Alloy`, `Pastel`, `Muted`, `Dark Mode`],
  },
  background_color: {
    value: `#000000`,
    description: `Background color of the 3D viewport`,
  },
  background_opacity: {
    value: 0,
    description: `Opacity of the background (0.0 = transparent, 1.0 = opaque)`,
    minimum: 0,
    maximum: 1,
  },

  // Structure viewer settings
  structure: {
    // Atoms & Bonds
    atom_radius: {
      value: 1.0,
      description: `Radius multiplier for atoms (1.0 = standard atomic radii)`,
      minimum: 0.1,
      maximum: 3.0,
    },
    same_size_atoms: {
      value: false,
      description: `Render all atoms with the same size regardless of element`,
    },
    show_atoms: {
      value: true,
      description: `Display atoms in the structure`,
    },
    show_image_atoms: {
      value: true,
      description:
        `Show atoms on the edge of the cell that are not part of the primitive basis`,
    },
    sphere_segments: {
      value: 20,
      description: `Number of segments for sphere rendering (higher = smoother)`,
      minimum: 8,
      maximum: 64,
    },
    bond_thickness: {
      value: 0.25,
      description: `Thickness of bonds relative to atom radius`,
      minimum: 0.01,
      maximum: 1.0,
    },
    show_bonds: {
      value: `molecules`,
      description: `When to display bonds between atoms`,
      enum: show_bonds_options,
    },
    bond_color: {
      value: `#ffffff`,
      description: `Color for bonds (hex color code)`,
    },
    bonding_strategy: {
      value: `electroneg_ratio`,
      description: `Method for determining bonds between atoms`,
      enum: [
        `electroneg_ratio`,
        `max_dist`,
        `nearest_neighbor`,
      ],
    },

    // Camera & Controls
    show_gizmo: {
      value: true,
      description: `Show orientation gizmo in the corner of structure viewer`,
    },
    camera_position: {
      value: [0, 0, 0] as const,
      description: `Initial camera position [x, y, z]`,
      minItems: 3,
      maxItems: 3,
    },
    camera_projection: {
      value: `orthographic` as const,
      description: `Camera projection type`,
      enum: [`perspective`, `orthographic`],
    },
    initial_zoom: {
      value: 35,
      description:
        `Initial zoom level for orthographic projection (ignored for perspective)`,
      minimum: 0.1,
      maximum: 200,
    },
    fov: {
      value: 10,
      description: `Field of view in degrees for perspective projection`,
      minimum: 10,
      maximum: 150,
    },
    rotation_damping: {
      value: 0.1,
      description: `Camera rotation damping factor (0 = no damping, 1 = heavy damping)`,
      minimum: 0,
      maximum: 1,
    },
    zoom_speed: {
      value: 0.5,
      description: `Mouse wheel zoom sensitivity`,
      minimum: 0.1,
      maximum: 2.0,
    },
    pan_speed: {
      value: 0.5,
      description: `Mouse pan sensitivity`,
      minimum: 0.1,
      maximum: 2.0,
    },
    max_zoom: {
      value: undefined,
      description: `Maximum zoom level (undefined = no limit)`,
    },
    min_zoom: {
      value: undefined,
      description: `Minimum zoom level (undefined = no limit)`,
    },
    auto_rotate: {
      value: 0.2,
      description: `Automatic rotation speed (0 = disabled, positive = clockwise)`,
      minimum: 0,
      maximum: 10,
    },
    rotation: {
      value: [0, 0, 0] as const,
      description:
        `Manual rotation around X, Y, Z axes, displayed in degrees [0, 360] but normalized as radians to [-π, π] for each of [x, y, z]. Combines additively with auto-rotation when both are active.`,
      minItems: 3,
      maxItems: 3,
    },

    // Labels & Lighting
    show_site_labels: {
      value: false,
      description: `Show element labels on atoms`,
    },
    show_site_indices: {
      value: false,
      description: `Show site index numbers on atoms`,
    },
    site_label_size: {
      value: 1,
      description: `Font size for atom labels`,
      minimum: 0.5,
      maximum: 5,
    },
    site_label_color: {
      value: `#ffffff`,
      description: `Text color for atom labels`,
    },
    site_label_bg_color: {
      value: `#000000`,
      description: `Background color for atom labels`,
    },
    site_label_padding: {
      value: 2,
      description: `Padding around atom labels in pixels`,
      minimum: 0,
      maximum: 20,
    },
    site_label_offset: {
      value: [0, 0.5, 0] as const,
      description: `3D offset for atom labels [x, y, z]`,
      minItems: 3,
      maxItems: 3,
    },
    ambient_light: {
      value: 1.5,
      description: `Ambient light intensity (0 = dark, higher = brighter)`,
      minimum: 0,
      maximum: 4,
    },
    directional_light: {
      value: 2.2,
      description:
        `Directional light intensity (0 = no shadows, higher = stronger shadows)`,
      minimum: 0,
      maximum: 4,
    },

    // Forces & Lattice
    show_force_vectors: {
      value: false,
      description: `Display force vectors on atoms`,
    },
    force_scale: {
      value: 1.0,
      description: `Scale factor for force vector arrows`,
      minimum: 0.1,
      maximum: 10.0,
    },
    force_color: {
      value: `#ff0000`,
      description: `Color for force vectors`,
    },
    force_shaft_radius: {
      value: 0.02,
      description: `Radius of force vector shaft`,
      minimum: 0.005,
      maximum: 0.1,
    },
    force_arrow_head_radius: {
      value: 0.08,
      description: `Radius of force vector arrow head`,
      minimum: 0.02,
      maximum: 0.2,
    },
    force_arrow_head_length: {
      value: 0.2,
      description: `Length of force vector arrow head`,
      minimum: 0.05,
      maximum: 0.5,
    },
    show_cell: {
      value: false,
      description: `Display system cell`,
    },
    show_cell_vectors: {
      value: true,
      description: `Display cell vectors`,
    },
    cell_edge_opacity: {
      value: 0.3,
      description: `Opacity of cell edge lines`,
      minimum: 0,
      maximum: 1,
    },
    cell_surface_opacity: {
      value: 0.1,
      description: `Opacity of cell surfaces`,
      minimum: 0,
      maximum: 1,
    },
    cell_edge_color: {
      value: `#808080`,
      description: `Color of cell edges`,
    },
    cell_surface_color: {
      value: `#e0e0e0`,
      description: `Color of cell surfaces`,
    },
    cell_edge_width: {
      value: 1.5,
      description: `Width of cell edge lines`,
      minimum: 0.5,
      maximum: 5.0,
    },
    fullscreen_toggle: {
      value: true,
      description:
        `Show fullscreen toggle button (web-only, always false in other contexts)`,
      context: `web`,
    },
  },

  // Trajectory viewer settings
  trajectory: {
    // Core trajectory settings
    auto_play: {
      value: false,
      description: `Automatically start playing trajectory when opened`,
    },
    fps: {
      value: 10,
      description: `Frames per second for trajectory playback`,
      minimum: 0.1,
      maximum: 60,
    },
    fps_range: {
      value: [0.2, 60] as const,
      description: `Allowed range for playback speed [min, max]`,
      minItems: 2,
      maxItems: 2,
    },
    display_mode: {
      value: `structure+scatter` as const,
      description: `Visualization mode for trajectory data`,
      enum: [
        `structure+scatter`,
        `structure`,
        `scatter`,
        `histogram`,
        `structure+histogram`,
      ],
    },
    show_controls: {
      value: true,
      description: `Show playback controls`,
    },
    fullscreen_toggle: {
      value: true,
      description:
        `Show fullscreen toggle button (web-only, always false in other contexts)`,
      context: `web`,
    },
    step_labels: {
      value: 5,
      description: `Number of frame labels to display`,
      minimum: 0,
      maximum: 20,
    },
    layout: {
      value: `auto` as const,
      description: `Layout arrangement for trajectory viewer`,
      enum: [`auto`, `horizontal`, `vertical`],
    },

    // File handling and loading
    allow_file_drop: {
      value: true,
      description: `Allow drag-and-drop of trajectory files`,
    },
    bin_file_threshold: {
      value: 50000000,
      description: `File size threshold for binary loading (bytes)`,
      minimum: 1000000,
      maximum: 500000000,
    },
    text_file_threshold: {
      value: 25000000,
      description: `File size threshold for text loading (bytes)`,
      minimum: 500000,
      maximum: 250000000,
    },
    use_indexing: {
      value: false,
      description: `Use frame indexing for large trajectories`,
    },
    chunk_size: {
      value: 1000,
      description: `Number of frames to process at once`,
      minimum: 10,
      maximum: 10000,
    },

    // Histogram specific
    histogram_mode: {
      value: `overlay` as const,
      description:
        `Histogram display mode. 'overlay' shows multiple histograms in the same plot, 'single' shows a single histogram`,
      enum: [`overlay`, `single`],
    },
    histogram_show_legend: {
      value: true,
      description: `Show legend in histogram plots`,
    },
    histogram_bin_count: {
      value: 100,
      description: `Number of bins for histogram plots`,
      minimum: 1,
      maximum: 1000,
    },
    histogram_bar_opacity: {
      value: 0.7,
      description: `Opacity of histogram bars`,
      minimum: 0,
      maximum: 1,
    },
    histogram_bar_stroke_width: {
      value: 1,
      description: `Stroke width for histogram bars`,
      minimum: 0,
      maximum: 5,
    },

    // Formatting
    step_label_format: {
      value: `.3~s`,
      description: `Number format for step labels (D3 format specifier)`,
    },
    property_value_format: {
      value: `.2~s`,
      description: `Number format for property values (D3 format specifier)`,
    },
    tooltip_format: {
      value: `.3~s`,
      description: `Number format for tooltips (D3 format specifier)`,
    },

    // UI/UX
    enable_keyboard_shortcuts: {
      value: true,
      description: `Enable keyboard shortcuts for playback`,
    },
    show_parsing_progress: {
      value: true,
      description: `Show progress indicator while parsing files`,
    },
    compact_controls: {
      value: false,
      description: `Use compact layout for playback controls`,
    },
    show_filename_in_controls: {
      value: true,
      description: `Display filename in control pane`,
    },

    // Playback behavior
    smooth_playback: {
      value: false,
      description: `Use smooth interpolation between frames`,
    },
    loop_playback: {
      value: true,
      description: `Loop trajectory playback`,
    },
    pause_on_hover: {
      value: false,
      description: `Pause playback when hovering over controls`,
    },
    highlight_current_frame: {
      value: true,
      description: `Highlight current frame in timeline`,
    },
    show_frame_info: {
      value: true,
      description: `Show frame information overlay`,
    },

    // Performance
    max_frames_in_memory: {
      value: 1000,
      description: `Maximum frames to keep in memory`,
      minimum: 10,
      maximum: 10000,
    },
    memory_usage_warning_threshold: {
      value: 500,
      description: `Frame count threshold for memory warnings`,
      minimum: 10,
      maximum: 5000,
    },
    enable_performance_monitoring: {
      value: false,
      description: `Enable performance monitoring`,
    },
    prefetch_frames: {
      value: 5,
      description: `Number of frames to prefetch ahead`,
      minimum: 0,
      maximum: 100,
    },
    cache_parsed_data: {
      value: true,
      description: `Cache parsed trajectory data`,
    },
  },

  // Composition specific
  composition: {
    display_mode: {
      value: `pie` as const,
      description: `Display mode for composition data`,
      enum: [`pie`, `bubble`, `bar`],
    },
    color_scheme: {
      value: `Vesta`,
      description: `Color scheme for composition visualization`,
      enum: [`Vesta`, `Jmol`, `Alloy`, `Pastel`, `Muted`, `Dark Mode`],
    },
  },

  // Scatter plot specific
  scatter: {
    symbol_type: {
      value: `Circle`,
      description: `Default symbol type for scatter plots`,
      enum: symbol_names,
    },
    line_width: {
      value: 2,
      description: `Line width for scatter plot connections`,
      minimum: 0.5,
      maximum: 10,
    },
    point_size: {
      value: 4,
      description: `Point size for scatter plots`,
      minimum: 1,
      maximum: 20,
    },
    show_legend: {
      value: true,
      description: `Show legend in scatter plots`,
    },

    // Scatter plot specific
    markers: {
      value: `line+points`,
      description: `Scatter plot marker type`,
      enum: [`line`, `points`, `line+points`],
    },
    point_color: {
      value: `#4682b4`,
      description: `Default color for scatter plot points`,
    },
    point_opacity: {
      value: 1,
      description: `Opacity of scatter plot points`,
      minimum: 0,
      maximum: 1,
    },
    point_stroke_width: {
      value: 1,
      description: `Stroke width for scatter plot points`,
      minimum: 0,
      maximum: 5,
    },
    point_stroke_color: {
      value: `#000000`,
      description: `Stroke color for scatter plot points`,
    },
    point_stroke_opacity: {
      value: 1,
      description: `Stroke opacity for scatter plot points`,
      minimum: 0,
      maximum: 1,
    },
    line_color: {
      value: `#4682b4`,
      description: `Default color for scatter plot lines`,
    },
    line_opacity: {
      value: 1,
      description: `Opacity of scatter plot lines`,
      minimum: 0,
      maximum: 1,
    },
    line_dash: {
      value: `solid`,
      description: `Line dash pattern for scatter plots (e.g., "4,4" for dashed)`,
    },
    show_points: {
      value: true,
      description: `Show points in scatter plots`,
    },
    show_lines: {
      value: true,
      description: `Show connecting lines in scatter plots`,
    },
  },

  // Plot general
  plot: {
    animation_duration: {
      value: 200,
      description: `Duration of plot animations in milliseconds`,
      minimum: 0,
      maximum: 2000,
    },
    enable_zoom: {
      value: true,
      description: `Enable zooming in plots`,
    },
    zoom_factor: {
      value: 1.5,
      description: `Zoom factor for plot interactions`,
      minimum: 1.1,
      maximum: 5.0,
    },
    auto_fit_range: {
      value: true,
      description: `Automatically fit plot range to data`,
    },
    grid_lines: {
      value: true,
      description: `Show grid lines in plots`,
    },
    axis_labels: {
      value: true,
      description: `Show axis labels in plots`,
    },
    show_zero_lines: {
      value: true,
      description: `Show zero reference lines in plots`,
    },
    x_grid: {
      value: true,
      description: `Show X-axis grid lines`,
    },
    y_grid: {
      value: true,
      description: `Show Y-axis grid lines`,
    },
    y2_grid: {
      value: true,
      description: `Show secondary Y-axis grid lines`,
    },
    x_format: {
      value: `.2~s`,
      description: `Number format for X-axis ticks (D3 format specifier)`,
    },
    y_format: {
      value: `d`,
      description: `Number format for Y-axis ticks (D3 format specifier)`,
    },
    y2_format: {
      value: ``,
      description: `Number format for secondary Y-axis ticks (D3 format specifier)`,
    },
    x_scale_type: {
      value: `linear`,
      description: `Scale type for X-axis`,
      enum: [`linear`, `log`],
    },
    y_scale_type: {
      value: `linear`,
      description: `Scale type for Y-axis`,
      enum: [`linear`, `log`],
    },
    x_ticks: {
      value: 8,
      description: `Number of ticks on X-axis`,
      minimum: 2,
      maximum: 20,
    },
    y_ticks: {
      value: 6,
      description: `Number of ticks on Y-axis`,
      minimum: 2,
      maximum: 20,
    },
  },

  phase_diagram: { // Phase diagram defaults (binary/ternary/quaternary)
    binary: {
      camera_zoom: {
        value: 1.0,
        description: `Initial zoom for binary (2D) phase diagram`,
        minimum: 0.1,
        maximum: 10,
      },
      camera_center_x: {
        value: 0,
        description: `Initial X center for binary (2D) phase diagram`,
      },
      camera_center_y: {
        value: 0,
        description: `Initial Y center for binary (2D) phase diagram`,
      },
      color_mode: {
        value: `energy`,
        description: `Color mode for 2D PD points`,
        enum: [`stability`, `energy`],
      },
      color_scale: {
        value: `interpolateViridis`,
        description: `D3 interpolate color scale for 2D PD energy mode`,
      },
      show_stable: {
        value: true,
        description: `Show stable phases in 2D PD`,
      },
      show_unstable: {
        value: true,
        description: `Show unstable phases in 2D PD`,
      },
      show_stable_labels: {
        value: true,
        description: `Show labels for stable phases in 2D PD`,
      },
      show_unstable_labels: {
        value: false,
        description: `Show labels for unstable phases in 2D PD`,
      },
      energy_threshold: {
        value: 0.1,
        description: `Max eV/atom above hull for showing unstable entries in 2D PD`,
        minimum: 0,
        maximum: 2,
      },
      label_energy_threshold: {
        value: 0.1,
        description: `Max eV/atom above hull for labeling unstable entries in 2D PD`,
        minimum: 0,
        maximum: 2,
      },
      fullscreen: {
        value: false,
        description: `Start in fullscreen for 2D PD`,
      },
      info_pane_open: {
        value: false,
        description: `Info pane open by default for 2D PD`,
      },
      legend_pane_open: {
        value: false,
        description: `Legend pane open by default for 2D PD`,
      },
    },
    ternary: {
      camera_elevation: {
        value: 45,
        description: `Initial camera elevation (deg) for ternary (3D) PD`,
        minimum: -180,
        maximum: 180,
      },
      camera_azimuth: {
        value: 60,
        description: `Initial camera azimuth (deg) for ternary (3D) PD`,
        minimum: -360,
        maximum: 360,
      },
      camera_zoom: {
        value: 1.5,
        description: `Initial camera zoom for ternary (3D) PD`,
        minimum: 0.1,
        maximum: 10,
      },
      camera_center_x: {
        value: 0,
        description: `Initial X center for ternary (3D) PD`,
      },
      camera_center_y: {
        value: -50,
        description: `Initial Y center for ternary (3D) PD`,
      },
      color_mode: {
        value: `energy`,
        description: `Color mode for 3D PD points`,
        enum: [`stability`, `energy`],
      },
      color_scale: {
        value: `interpolateViridis`,
        description: `D3 interpolate color scale for 3D PD energy mode`,
      },
      show_stable: {
        value: true,
        description: `Show stable phases in 3D PD`,
      },
      show_unstable: {
        value: true,
        description: `Show unstable phases in 3D PD`,
      },
      show_stable_labels: {
        value: true,
        description: `Show labels for stable phases in 3D PD`,
      },
      show_unstable_labels: {
        value: false,
        description: `Show labels for unstable phases in 3D PD`,
      },
      energy_threshold: {
        value: 0.5,
        description: `Max eV/atom above hull for showing unstable entries in 3D PD`,
        minimum: 0,
        maximum: 2,
      },
      label_energy_threshold: {
        value: 0.1,
        description: `Max eV/atom above hull for labeling unstable entries in 3D PD`,
        minimum: 0,
        maximum: 2,
      },
      show_hull_faces: {
        value: true,
        description: `Render lower hull faces in 3D PD`,
      },
      hull_face_color: {
        value: `#4caf50`,
        description: `Color for lower hull faces in 3D PD`,
      },
      hull_face_opacity: {
        value: 0.3,
        description: `Opacity for hull faces in 3D PD (0-1)`,
        minimum: 0,
        maximum: 1,
      },
      fullscreen: {
        value: false,
        description: `Start in fullscreen for 3D PD`,
      },
      info_pane_open: {
        value: false,
        description: `Info pane open by default for 3D PD`,
      },
      legend_pane_open: {
        value: false,
        description: `Legend pane open by default for 3D PD`,
      },
    },
    quaternary: {
      camera_rotation_x: {
        value: -0.6,
        description: `Initial camera X rotation (rad) for quaternary (4D) PD`,
        minimum: -6.283,
        maximum: 6.283,
      },
      camera_rotation_y: {
        value: 0.8,
        description: `Initial camera Y rotation (rad) for quaternary (4D) PD`,
        minimum: -6.283,
        maximum: 6.283,
      },
      camera_zoom: {
        value: 1.4,
        description: `Initial camera zoom for quaternary (4D) PD`,
        minimum: 0.1,
        maximum: 20,
      },
      camera_center_x: {
        value: 0,
        description: `Initial X center for quaternary (4D) PD`,
      },
      camera_center_y: {
        value: 20,
        description: `Initial Y center for quaternary (4D) PD`,
      },
      color_mode: {
        value: `energy`,
        description: `Color mode for 4D PD points`,
        enum: [`stability`, `energy`],
      },
      color_scale: {
        value: `interpolateViridis`,
        description: `D3 interpolate color scale for 4D PD energy mode`,
      },
      show_stable: {
        value: true,
        description: `Show stable phases in 4D PD`,
      },
      show_unstable: {
        value: true,
        description: `Show unstable phases in 4D PD`,
      },
      show_stable_labels: {
        value: true,
        description: `Show labels for stable phases in 4D PD`,
      },
      show_unstable_labels: {
        value: false,
        description: `Show labels for unstable phases in 4D PD`,
      },
      show_hull_faces: {
        value: true,
        description: `Show convex hull faces in 4D PD`,
      },
      hull_face_color: {
        value: `#4caf50`,
        description: `Color for hull faces in 4D PD`,
      },
      hull_face_opacity: {
        value: 0.06,
        description: `Opacity for hull faces in 4D PD (0-1)`,
        minimum: 0,
        maximum: 1,
      },
      energy_threshold: {
        value: 0.1,
        description: `Max eV/atom above hull for showing unstable entries in 4D PD`,
        minimum: 0,
        maximum: 2,
      },
      label_energy_threshold: {
        value: 0.1,
        description: `Max eV/atom above hull for labeling unstable entries in 4D PD`,
        minimum: 0,
        maximum: 2,
      },
      fullscreen: {
        value: false,
        description: `Start in fullscreen for 4D PD`,
      },
      info_pane_open: {
        value: false,
        description: `Info pane open by default for 4D PD`,
      },
      legend_pane_open: {
        value: false,
        description: `Legend pane open by default for 4D PD`,
      },
    },
  },
}

// Extract the value types for runtime use (up to 3 nested levels)
export type DefaultSettings = {
  [K in keyof SettingsConfig]: SettingsConfig[K] extends SettingType<infer T> ? T
    : SettingsConfig[K] extends Record<string, unknown> ? {
        [NK in keyof SettingsConfig[K]]: SettingsConfig[K][NK] extends
          SettingType<infer T> ? T
          : SettingsConfig[K][NK] extends Record<string, unknown> ? {
              [NNK in keyof SettingsConfig[K][NK]]: SettingsConfig[K][NK][NNK] extends
                SettingType<infer T> ? T
                : never
            }
          : never
      }
    : never
}

// Extract values from settings config for runtime use
const extract_values = (
  config: SettingsConfig | SettingType | Record<string, unknown>,
): DefaultSettings => {
  const result = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(config)) {
    if (value && typeof value === `object` && `value` in value) {
      result[key] = (value as SettingType).value
    } else if (value && typeof value === `object`) {
      result[key] = extract_values(value as Record<string, unknown>)
    }
  }
  return result as DefaultSettings
}

// Runtime defaults - extracted values for use in components
export const DEFAULTS = extract_values(SETTINGS_CONFIG)

// Helper to merge with defaults - handles nested structure
export const merge = (user?: Partial<DefaultSettings>): DefaultSettings => ({
  ...DEFAULTS,
  ...(user || {}),
  structure: { ...DEFAULTS.structure, ...(user?.structure || {}) },
  trajectory: { ...DEFAULTS.trajectory, ...(user?.trajectory || {}) },
  composition: { ...DEFAULTS.composition, ...(user?.composition || {}) },
  plot: { ...DEFAULTS.plot, ...(user?.plot || {}) },
  scatter: { ...DEFAULTS.scatter, ...(user?.scatter || {}) },
  phase_diagram: {
    ...DEFAULTS.phase_diagram,
    ...(user?.phase_diagram || {}),
    binary: {
      ...DEFAULTS.phase_diagram.binary,
      ...(user?.phase_diagram?.binary || {}),
    },
    ternary: {
      ...DEFAULTS.phase_diagram.ternary,
      ...(user?.phase_diagram?.ternary || {}),
    },
    quaternary: {
      ...DEFAULTS.phase_diagram.quaternary,
      ...(user?.phase_diagram?.quaternary || {}),
    },
  },
} as DefaultSettings)

// Narrowed accessor for phase diagram defaults to ensure strong typing at call sites
export type PhaseDiagramDefaults = DefaultSettings[`phase_diagram`]
export const PD_DEFAULTS: PhaseDiagramDefaults = DEFAULTS
  .phase_diagram as PhaseDiagramDefaults
