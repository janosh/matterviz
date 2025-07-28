// Universal settings schema - single source of truth for all MatterViz settings
// Used by both main package and VSCode extension

export interface SettingType<T = unknown> {
  value: T
  description: string
  enum?: readonly string[]
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}

export interface SettingsConfig {
  // General display settings
  color_scheme: SettingType<string>
  background_color: SettingType<string>
  background_opacity: SettingType<number>
  show_image_atoms: SettingType<boolean>
  show_gizmo: SettingType<boolean>

  // Structure viewer settings
  structure: {
    // Atoms & Bonds
    atom_radius: SettingType<number>
    same_size_atoms: SettingType<boolean>
    show_atoms: SettingType<boolean>
    sphere_segments: SettingType<number>
    bond_thickness: SettingType<number>
    show_bonds: SettingType<boolean>
    bond_color: SettingType<string>
    bonding_strategy: SettingType<string>

    // Camera & Controls
    camera_position: SettingType<[number, number, number]>
    projection: SettingType<`perspective` | `orthographic`>
    fov: SettingType<number>
    rotation_damping: SettingType<number>
    zoom_speed: SettingType<number>
    pan_speed: SettingType<number>
    max_zoom: SettingType<number | undefined>
    min_zoom: SettingType<number | undefined>
    auto_rotate: SettingType<number>

    // Labels & Lighting
    show_site_labels: SettingType<boolean>
    site_label_size: SettingType<number>
    site_label_color: SettingType<string>
    site_label_bg_color: SettingType<string>
    site_label_padding: SettingType<number>
    site_label_offset: SettingType<[number, number, number]>
    ambient_light: SettingType<number>
    directional_light: SettingType<number>

    // Forces & Lattice
    show_force_vectors: SettingType<boolean>
    force_scale: SettingType<number>
    force_color: SettingType<string>
    force_shaft_radius: SettingType<number>
    force_arrow_head_radius: SettingType<number>
    force_arrow_head_length: SettingType<number>
    show_lattice: SettingType<boolean>
    show_vectors: SettingType<boolean>
    lattice_edge_opacity: SettingType<number>
    lattice_surface_opacity: SettingType<number>
    lattice_edge_color: SettingType<string>
    lattice_surface_color: SettingType<string>
    lattice_line_width: SettingType<number>
  }

  // Trajectory viewer settings
  trajectory: {
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
    show_fullscreen_button: SettingType<boolean>
    step_labels: SettingType<number>
    layout: SettingType<`auto` | `horizontal` | `vertical`>

    // File handling and loading
    allow_file_drop: SettingType<boolean>
    array_buffer_threshold: SettingType<number>
    str_threshold: SettingType<number>
    use_indexing: SettingType<boolean>
    chunk_size: SettingType<number>

    // Histogram specific
    histogram_mode: SettingType<`overlay` | `single`>
    histogram_show_legend: SettingType<boolean>
    histogram_bin_count: SettingType<number>

    // Scatter plot specific
    scatter_line_width: SettingType<number>
    scatter_point_size: SettingType<number>
    scatter_show_legend: SettingType<boolean>

    // Plot general
    plot_animation_duration: SettingType<number>
    enable_plot_zoom: SettingType<boolean>
    plot_zoom_factor: SettingType<number>
    auto_fit_plot_range: SettingType<boolean>
    plot_grid_lines: SettingType<boolean>
    plot_axis_labels: SettingType<boolean>

    // Formatting
    step_label_format: SettingType<string>
    property_value_format: SettingType<string>
    tooltip_format: SettingType<string>

    // UI/UX
    enable_keyboard_shortcuts: SettingType<boolean>
    show_parsing_progress: SettingType<boolean>
    compact_controls: SettingType<boolean>
    show_filename_in_controls: SettingType<boolean>
    enable_fullscreen: SettingType<boolean>

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

  // Composition specific
  composition: {
    composition_mode: SettingType<`pie` | `bubble` | `bar`>
    composition_color_scheme: SettingType<string>
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
    value: 1.0,
    description: `Opacity of the background (0.0 = transparent, 1.0 = opaque)`,
    minimum: 0,
    maximum: 1,
  },
  show_image_atoms: {
    value: false,
    description: `Show atoms outside the unit cell for better visualization`,
  },
  show_gizmo: {
    value: true,
    description: `Show orientation gizmo in the corner`,
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
    sphere_segments: {
      value: 20,
      description: `Number of segments for sphere rendering (higher = smoother)`,
      minimum: 8,
      maximum: 64,
    },
    bond_thickness: {
      value: 0.1,
      description: `Thickness of bonds relative to atom radius`,
      minimum: 0.01,
      maximum: 1.0,
    },
    show_bonds: {
      value: false,
      description: `Display bonds between atoms`,
    },
    bond_color: {
      value: `#ffffff`,
      description: `Color for bonds (hex color code)`,
    },
    bonding_strategy: {
      value: `nearest_neighbor`,
      description: `Method for determining bonds between atoms`,
      enum: [`nearest_neighbor`, `covalent_radius`, `distance_cutoff`],
    },

    // Camera & Controls
    camera_position: {
      value: [0, 0, 0] as [number, number, number],
      description: `Initial camera position [x, y, z]`,
      minItems: 3,
      maxItems: 3,
    },
    projection: {
      value: `perspective` as const,
      description: `Camera projection type`,
      enum: [`perspective`, `orthographic`],
    },
    fov: {
      value: 75,
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
      value: 0.02,
      description: `Automatic rotation speed (0 = disabled, positive = clockwise)`,
      minimum: 0,
      maximum: 10,
    },

    // Labels & Lighting
    show_site_labels: {
      value: false,
      description: `Show element labels on atoms`,
    },
    site_label_size: {
      value: 12,
      description: `Font size for atom labels`,
      minimum: 8,
      maximum: 32,
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
      value: [0, 0, 0] as [number, number, number],
      description: `3D offset for atom labels [x, y, z]`,
      minItems: 3,
      maxItems: 3,
    },
    ambient_light: {
      value: 0.4,
      description: `Ambient light intensity (0 = dark, 1 = bright)`,
      minimum: 0,
      maximum: 1,
    },
    directional_light: {
      value: 0.6,
      description: `Directional light intensity (0 = no shadows, 1 = strong shadows)`,
      minimum: 0,
      maximum: 1,
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
    show_lattice: {
      value: false,
      description: `Display unit cell lattice`,
    },
    show_vectors: {
      value: false,
      description: `Display lattice vectors`,
    },
    lattice_edge_opacity: {
      value: 0.3,
      description: `Opacity of lattice edge lines`,
      minimum: 0,
      maximum: 1,
    },
    lattice_surface_opacity: {
      value: 0.1,
      description: `Opacity of lattice surfaces`,
      minimum: 0,
      maximum: 1,
    },
    lattice_edge_color: {
      value: `#808080`,
      description: `Color of lattice edges`,
    },
    lattice_surface_color: {
      value: `#e0e0e0`,
      description: `Color of lattice surfaces`,
    },
    lattice_line_width: {
      value: 1.5,
      description: `Width of lattice edge lines`,
      minimum: 0.5,
      maximum: 5.0,
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
      value: 5,
      description: `Frames per second for trajectory playback`,
      minimum: 0.1,
      maximum: 60,
    },
    fps_range: {
      value: [0.2, 30] as [number, number],
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
    show_fullscreen_button: {
      value: true,
      description: `Show fullscreen toggle button`,
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
    array_buffer_threshold: {
      value: 50000000,
      description: `File size threshold for binary loading (bytes)`,
      minimum: 1000000,
      maximum: 500000000,
    },
    str_threshold: {
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
      description: `Histogram display mode`,
      enum: [`overlay`, `single`],
    },
    histogram_show_legend: {
      value: true,
      description: `Show legend in histogram plots`,
    },
    histogram_bin_count: {
      value: 30,
      description: `Number of bins for histogram plots`,
      minimum: 5,
      maximum: 200,
    },

    // Scatter plot specific
    scatter_line_width: {
      value: 2,
      description: `Line width for scatter plot connections`,
      minimum: 0.5,
      maximum: 10,
    },
    scatter_point_size: {
      value: 3,
      description: `Point size for scatter plots`,
      minimum: 1,
      maximum: 20,
    },
    scatter_show_legend: {
      value: true,
      description: `Show legend in scatter plots`,
    },

    // Plot general
    plot_animation_duration: {
      value: 200,
      description: `Duration of plot animations in milliseconds`,
      minimum: 0,
      maximum: 2000,
    },
    enable_plot_zoom: {
      value: true,
      description: `Enable zooming in plots`,
    },
    plot_zoom_factor: {
      value: 1.5,
      description: `Zoom factor for plot interactions`,
      minimum: 1.1,
      maximum: 5.0,
    },
    auto_fit_plot_range: {
      value: true,
      description: `Automatically fit plot range to data`,
    },
    plot_grid_lines: {
      value: true,
      description: `Show grid lines in plots`,
    },
    plot_axis_labels: {
      value: true,
      description: `Show axis labels in plots`,
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
      description: `Display filename in control panel`,
    },
    enable_fullscreen: {
      value: true,
      description: `Allow fullscreen mode`,
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
    composition_mode: {
      value: `pie` as const,
      description: `Display mode for composition data`,
      enum: [`pie`, `bubble`, `bar`],
    },
    composition_color_scheme: {
      value: `Vesta`,
      description: `Color scheme for composition visualization`,
      enum: [`Vesta`, `Jmol`, `Alloy`, `Pastel`, `Muted`, `Dark Mode`],
    },
  },
}

// Extract the value types for runtime use
export type DefaultSettings = {
  [K in keyof SettingsConfig]: SettingsConfig[K] extends SettingType<infer T> ? T
    : SettingsConfig[K] extends Record<string, unknown> ? {
        [NK in keyof SettingsConfig[K]]: SettingsConfig[K][NK] extends
          SettingType<infer T> ? T
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
  ...user,
  structure: { ...DEFAULTS.structure, ...(user?.structure || {}) },
  trajectory: { ...DEFAULTS.trajectory, ...(user?.trajectory || {}) },
  composition: { ...DEFAULTS.composition, ...(user?.composition || {}) },
})
