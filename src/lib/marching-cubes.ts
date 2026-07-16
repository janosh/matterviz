// Marching Cubes algorithm for isosurface extraction
// Based on the classic algorithm by Lorensen & Cline (1987)
import {
  grid_dimensions,
  grid_value,
  is_scalar_grid,
  type ScalarGridLike,
} from '$lib/isosurface/grid'
import { mat3x3_vec3_multiply, matrix_inverse_3x3, type Matrix3x3, type Vec3 } from '$lib/math'

const wrap_grid_idx = (val: number, dim: number) => ((val % dim) + dim) % dim
const clamp_grid_idx = (val: number, max: number) => Math.max(0, Math.min(val, max))

// Edge table: for each cube configuration (256 cases), which edges are intersected
// Each bit indicates whether that edge has an intersection
// oxfmt-ignore
const EDGE_TABLE: number[] = [
  0x0, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c, 0x80c, 0x905, 0xa0f, 0xb06, 0xc0a,
  0xd03, 0xe09, 0xf00, 0x190, 0x99, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c, 0x99c,
  0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90, 0x230, 0x339, 0x33, 0x13a, 0x636,
  0x73f, 0x435, 0x53c, 0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30, 0x3a0,
  0x2a9, 0x1a3, 0xaa, 0x7a6, 0x6af, 0x5a5, 0x4ac, 0xbac, 0xaa5, 0x9af, 0x8a6, 0xfaa,
  0xea3, 0xda9, 0xca0, 0x460, 0x569, 0x663, 0x76a, 0x66, 0x16f, 0x265, 0x36c, 0xc6c,
  0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60, 0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6,
  0xff, 0x3f5, 0x2fc, 0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0, 0x650,
  0x759, 0x453, 0x55a, 0x256, 0x35f, 0x55, 0x15c, 0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a,
  0xb53, 0x859, 0x950, 0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0xcc, 0xfcc,
  0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9, 0x8c0, 0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6,
  0xdcf, 0xec5, 0xfcc, 0xcc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0, 0x950,
  0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c, 0x15c, 0x55, 0x35f, 0x256, 0x55a,
  0x453, 0x759, 0x650, 0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc, 0x2fc,
  0x3f5, 0xff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0, 0xb60, 0xa69, 0x963, 0x86a, 0xf66,
  0xe6f, 0xd65, 0xc6c, 0x36c, 0x265, 0x16f, 0x66, 0x76a, 0x663, 0x569, 0x460, 0xca0,
  0xda9, 0xea3, 0xfaa, 0x8a6, 0x9af, 0xaa5, 0xbac, 0x4ac, 0x5a5, 0x6af, 0x7a6, 0xaa,
  0x1a3, 0x2a9, 0x3a0, 0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c, 0x53c,
  0x435, 0x73f, 0x636, 0x13a, 0x33, 0x339, 0x230, 0xe90, 0xf99, 0xc93, 0xd9a, 0xa96,
  0xb9f, 0x895, 0x99c, 0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x99, 0x190, 0xf00,
  0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c, 0x70c, 0x605, 0x50f, 0x406, 0x30a,
  0x203, 0x109, 0x0,
]
// Triangle table: for each cube configuration, list of edge triplets forming triangles
// -1 marks the end of the triangle list for that configuration
const TRI_TABLE: number[][] = [
  [],
  [0, 8, 3],
  [0, 1, 9],
  [1, 8, 3, 9, 8, 1],
  [1, 2, 10],
  [0, 8, 3, 1, 2, 10],
  [9, 2, 10, 0, 2, 9],
  [2, 8, 3, 2, 10, 8, 10, 9, 8],
  [3, 11, 2],
  [0, 11, 2, 8, 11, 0],
  [1, 9, 0, 2, 3, 11],
  [1, 11, 2, 1, 9, 11, 9, 8, 11],
  [3, 10, 1, 11, 10, 3],
  [0, 10, 1, 0, 8, 10, 8, 11, 10],
  [3, 9, 0, 3, 11, 9, 11, 10, 9],
  [9, 8, 10, 10, 8, 11],
  [4, 7, 8],
  [4, 3, 0, 7, 3, 4],
  [0, 1, 9, 8, 4, 7],
  [4, 1, 9, 4, 7, 1, 7, 3, 1],
  [1, 2, 10, 8, 4, 7],
  [3, 4, 7, 3, 0, 4, 1, 2, 10],
  [9, 2, 10, 9, 0, 2, 8, 4, 7],
  [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4],
  [8, 4, 7, 3, 11, 2],
  [11, 4, 7, 11, 2, 4, 2, 0, 4],
  [9, 0, 1, 8, 4, 7, 2, 3, 11],
  [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1],
  [3, 10, 1, 3, 11, 10, 7, 8, 4],
  [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4],
  [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3],
  [4, 7, 11, 4, 11, 9, 9, 11, 10],
  [9, 5, 4],
  [9, 5, 4, 0, 8, 3],
  [0, 5, 4, 1, 5, 0],
  [8, 5, 4, 8, 3, 5, 3, 1, 5],
  [1, 2, 10, 9, 5, 4],
  [3, 0, 8, 1, 2, 10, 4, 9, 5],
  [5, 2, 10, 5, 4, 2, 4, 0, 2],
  [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8],
  [9, 5, 4, 2, 3, 11],
  [0, 11, 2, 0, 8, 11, 4, 9, 5],
  [0, 5, 4, 0, 1, 5, 2, 3, 11],
  [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5],
  [10, 3, 11, 10, 1, 3, 9, 5, 4],
  [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10],
  [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3],
  [5, 4, 8, 5, 8, 10, 10, 8, 11],
  [9, 7, 8, 5, 7, 9],
  [9, 3, 0, 9, 5, 3, 5, 7, 3],
  [0, 7, 8, 0, 1, 7, 1, 5, 7],
  [1, 5, 3, 3, 5, 7],
  [9, 7, 8, 9, 5, 7, 10, 1, 2],
  [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3],
  [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2],
  [2, 10, 5, 2, 5, 3, 3, 5, 7],
  [7, 9, 5, 7, 8, 9, 3, 11, 2],
  [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11],
  [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7],
  [11, 2, 1, 11, 1, 7, 7, 1, 5],
  [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11],
  [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0],
  [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0],
  [11, 10, 5, 7, 11, 5],
  [10, 6, 5],
  [0, 8, 3, 5, 10, 6],
  [9, 0, 1, 5, 10, 6],
  [1, 8, 3, 1, 9, 8, 5, 10, 6],
  [1, 6, 5, 2, 6, 1],
  [1, 6, 5, 1, 2, 6, 3, 0, 8],
  [9, 6, 5, 9, 0, 6, 0, 2, 6],
  [5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8],
  [2, 3, 11, 10, 6, 5],
  [11, 0, 8, 11, 2, 0, 10, 6, 5],
  [0, 1, 9, 2, 3, 11, 5, 10, 6],
  [5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11],
  [6, 3, 11, 6, 5, 3, 5, 1, 3],
  [0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6],
  [3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9],
  [6, 5, 9, 6, 9, 11, 11, 9, 8],
  [5, 10, 6, 4, 7, 8],
  [4, 3, 0, 4, 7, 3, 6, 5, 10],
  [1, 9, 0, 5, 10, 6, 8, 4, 7],
  [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4],
  [6, 1, 2, 6, 5, 1, 4, 7, 8],
  [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7],
  [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6],
  [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9],
  [3, 11, 2, 7, 8, 4, 10, 6, 5],
  [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11],
  [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6],
  [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6],
  [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6],
  [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11],
  [0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7],
  [6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9],
  [10, 4, 9, 6, 4, 10],
  [4, 10, 6, 4, 9, 10, 0, 8, 3],
  [10, 0, 1, 10, 6, 0, 6, 4, 0],
  [8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10],
  [1, 4, 9, 1, 2, 4, 2, 6, 4],
  [3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4],
  [0, 2, 4, 4, 2, 6],
  [8, 3, 2, 8, 2, 4, 4, 2, 6],
  [10, 4, 9, 10, 6, 4, 11, 2, 3],
  [0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6],
  [3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10],
  [6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1],
  [9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3],
  [8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1],
  [3, 11, 6, 3, 6, 0, 0, 6, 4],
  [6, 4, 8, 11, 6, 8],
  [7, 10, 6, 7, 8, 10, 8, 9, 10],
  [0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10],
  [10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0],
  [10, 6, 7, 10, 7, 1, 1, 7, 3],
  [1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7],
  [2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9],
  [7, 8, 0, 7, 0, 6, 6, 0, 2],
  [7, 3, 2, 6, 7, 2],
  [2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7],
  [2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7],
  [1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11],
  [11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1],
  [8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6],
  [0, 9, 1, 11, 6, 7],
  [7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0],
  [7, 11, 6],
  [7, 6, 11],
  [3, 0, 8, 11, 7, 6],
  [0, 1, 9, 11, 7, 6],
  [8, 1, 9, 8, 3, 1, 11, 7, 6],
  [10, 1, 2, 6, 11, 7],
  [1, 2, 10, 3, 0, 8, 6, 11, 7],
  [2, 9, 0, 2, 10, 9, 6, 11, 7],
  [6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8],
  [7, 2, 3, 6, 2, 7],
  [7, 0, 8, 7, 6, 0, 6, 2, 0],
  [2, 7, 6, 2, 3, 7, 0, 1, 9],
  [1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6],
  [10, 7, 6, 10, 1, 7, 1, 3, 7],
  [10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8],
  [0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7],
  [7, 6, 10, 7, 10, 8, 8, 10, 9],
  [6, 8, 4, 11, 8, 6],
  [3, 6, 11, 3, 0, 6, 0, 4, 6],
  [8, 6, 11, 8, 4, 6, 9, 0, 1],
  [9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6],
  [6, 8, 4, 6, 11, 8, 2, 10, 1],
  [1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6],
  [4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9],
  [10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3],
  [8, 2, 3, 8, 4, 2, 4, 6, 2],
  [0, 4, 2, 4, 6, 2],
  [1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8],
  [1, 9, 4, 1, 4, 2, 2, 4, 6],
  [8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1],
  [10, 1, 0, 10, 0, 6, 6, 0, 4],
  [4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3],
  [10, 9, 4, 6, 10, 4],
  [4, 9, 5, 7, 6, 11],
  [0, 8, 3, 4, 9, 5, 11, 7, 6],
  [5, 0, 1, 5, 4, 0, 7, 6, 11],
  [11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5],
  [9, 5, 4, 10, 1, 2, 7, 6, 11],
  [6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5],
  [7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2],
  [3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6],
  [7, 2, 3, 7, 6, 2, 5, 4, 9],
  [9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7],
  [3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0],
  [6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8],
  [9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7],
  [1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4],
  [4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10],
  [7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10],
  [6, 9, 5, 6, 11, 9, 11, 8, 9],
  [3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5],
  [0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11],
  [6, 11, 3, 6, 3, 5, 5, 3, 1],
  [1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6],
  [0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10],
  [11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5],
  [6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3],
  [5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2],
  [9, 5, 6, 9, 6, 0, 0, 6, 2],
  [1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8],
  [1, 5, 6, 2, 1, 6],
  [1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6],
  [10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0],
  [0, 3, 8, 5, 6, 10],
  [10, 5, 6],
  [11, 5, 10, 7, 5, 11],
  [11, 5, 10, 11, 7, 5, 8, 3, 0],
  [5, 11, 7, 5, 10, 11, 1, 9, 0],
  [10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1],
  [11, 1, 2, 11, 7, 1, 7, 5, 1],
  [0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11],
  [9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7],
  [7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2],
  [2, 5, 10, 2, 3, 5, 3, 7, 5],
  [8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5],
  [9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2],
  [9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2],
  [1, 3, 5, 3, 7, 5],
  [0, 8, 7, 0, 7, 1, 1, 7, 5],
  [9, 0, 3, 9, 3, 5, 5, 3, 7],
  [9, 8, 7, 5, 9, 7],
  [5, 8, 4, 5, 10, 8, 10, 11, 8],
  [5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0],
  [0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5],
  [10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4],
  [2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8],
  [0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11],
  [0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5],
  [9, 4, 5, 2, 11, 3],
  [2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4],
  [5, 10, 2, 5, 2, 4, 4, 2, 0],
  [3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9],
  [5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2],
  [8, 4, 5, 8, 5, 3, 3, 5, 1],
  [0, 4, 5, 1, 0, 5],
  [8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5],
  [9, 4, 5],
  [4, 11, 7, 4, 9, 11, 9, 10, 11],
  [0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11],
  [1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11],
  [3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4],
  [4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2],
  [9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3],
  [11, 7, 4, 11, 4, 2, 2, 4, 0],
  [11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4],
  [2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9],
  [9, 10, 7, 9, 7, 4, 10, 2, 7, 8, 7, 0, 2, 0, 7],
  [3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10],
  [1, 10, 2, 8, 7, 4],
  [4, 9, 1, 4, 1, 7, 7, 1, 3],
  [4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1],
  [4, 0, 3, 7, 4, 3],
  [4, 8, 7],
  [9, 10, 8, 10, 11, 8],
  [3, 0, 9, 3, 9, 11, 11, 9, 10],
  [0, 1, 10, 0, 10, 8, 8, 10, 11],
  [3, 1, 10, 11, 3, 10],
  [1, 2, 11, 1, 11, 9, 9, 11, 8],
  [3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9],
  [0, 2, 11, 8, 0, 11],
  [3, 2, 11],
  [2, 3, 8, 2, 8, 10, 10, 8, 9],
  [9, 10, 2, 0, 9, 2],
  [2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8],
  [1, 10, 2],
  [1, 3, 8, 9, 1, 8],
  [0, 9, 1],
  [0, 3, 8],
  [],
]

// Vertex positions for the 8 corners of a unit cube - flat arrays for speed
// Format: [x0,y0,z0, x1,y1,z1, ...] - access as CUBE_VERTS_X[i], etc.
const CUBE_VERTS_X = new Int8Array([0, 1, 1, 0, 0, 1, 1, 0])
const CUBE_VERTS_Y = new Int8Array([0, 0, 1, 1, 0, 0, 1, 1])
const CUBE_VERTS_Z = new Int8Array([0, 0, 0, 0, 1, 1, 1, 1])

// Edge definitions: pairs of vertex indices for each of 12 edges
// Flattened for direct access: edge i has vertices EDGE_V1[i] and EDGE_V2[i]
const EDGE_V1 = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3])
const EDGE_V2 = new Uint8Array([1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7])

export interface MarchingCubesResult {
  vertices: Vec3[]
  faces: number[][] // triangles as arrays of 3 vertex indices
  normals: Vec3[]
}

export interface MarchingCubesBuffers {
  positions: Float32Array
  indices: Uint32Array
  normals: Float32Array
}

interface MarchingCubesRaw {
  positions: number[]
  indices: number[]
  normals: number[]
}

export interface MarchingCubesOptions {
  // Whether to apply periodic boundary conditions (wrap around grid edges)
  periodic?: boolean
  // Interpolation for smoother surfaces (linear interpolation on edges)
  interpolate?: boolean
  // Whether to center the grid at the origin (shift by -0.5 in fractional coords)
  // Default true for proper Brillouin zone visualization centered at Γ point
  centered?: boolean
  // Whether to compute per-vertex normals via central differences on the grid.
  // Default true. Set false to skip (caller can use geometry.computeVertexNormals() instead).
  normals?: boolean
  // Cartesian translation applied before positions are rounded to Float32 buffers.
  position_offset?: Vec3
}

// Compute gradient (normal) at a grid point using central differences
function compute_gradient(
  grid: ScalarGridLike,
  ix: number,
  iy: number,
  iz: number,
  nx: number,
  ny: number,
  nz: number,
  periodic: boolean,
): Vec3 {
  // Wrap for periodic, clamp for non-periodic boundaries
  const [ix_w, iy_w, iz_w] = periodic
    ? [wrap_grid_idx(ix, nx), wrap_grid_idx(iy, ny), wrap_grid_idx(iz, nz)]
    : [clamp_grid_idx(ix, nx - 1), clamp_grid_idx(iy, ny - 1), clamp_grid_idx(iz, nz - 1)]
  const [ix_m, ix_p] = periodic
    ? [wrap_grid_idx(ix - 1, nx), wrap_grid_idx(ix + 1, nx)]
    : [Math.max(0, ix - 1), Math.min(nx - 1, ix + 1)]
  const [iy_m, iy_p] = periodic
    ? [wrap_grid_idx(iy - 1, ny), wrap_grid_idx(iy + 1, ny)]
    : [Math.max(0, iy - 1), Math.min(ny - 1, iy + 1)]
  const [iz_m, iz_p] = periodic
    ? [wrap_grid_idx(iz - 1, nz), wrap_grid_idx(iz + 1, nz)]
    : [Math.max(0, iz - 1), Math.min(nz - 1, iz + 1)]

  const scale = (lo: number, hi: number) => 1 / Math.max(1, periodic ? 2 : hi - lo)
  if (!is_scalar_grid(grid)) {
    const x_lo = grid[ix_m][iy_w][iz_w]
    const x_hi = grid[ix_p][iy_w][iz_w]
    const y_lo = grid[ix_w][iy_m][iz_w]
    const y_hi = grid[ix_w][iy_p][iz_w]
    const z_row = grid[ix_w][iy_w]
    const gz = -(z_row[iz_p] - z_row[iz_m]) * scale(iz_m, iz_p)
    return [
      -(x_hi - x_lo) * scale(ix_m, ix_p),
      -(y_hi - y_lo) * scale(iy_m, iy_p),
      gz,
    ]
  }
  const x_lo = grid_value(grid, ix_m, iy_w, iz_w)
  const x_hi = grid_value(grid, ix_p, iy_w, iz_w)
  const y_lo = grid_value(grid, ix_w, iy_m, iz_w)
  const y_hi = grid_value(grid, ix_w, iy_p, iz_w)
  const gz =
    -(grid_value(grid, ix_w, iy_w, iz_p) - grid_value(grid, ix_w, iy_w, iz_m)) *
    scale(iz_m, iz_p)
  return [-(x_hi - x_lo) * scale(ix_m, ix_p), -(y_hi - y_lo) * scale(iy_m, iy_p), gz]
}

// Main marching cubes algorithm (optimized version)
function marching_cubes_raw(
  grid: ScalarGridLike,
  iso_value: number,
  k_lattice: Matrix3x3,
  options: MarchingCubesOptions = {},
): MarchingCubesRaw {
  const {
    periodic = true,
    interpolate = true,
    centered = true,
    normals: compute_norms = true,
    position_offset,
  } = options
  // When centered=true, shift fractional coordinates by -0.5 so the grid is
  // centered at the origin (Γ point). This is needed for proper BZ visualization.
  const center_offset = centered ? 0.5 : 0

  const [nx, ny, nz] = grid_dimensions(grid)

  if (nx < 2 || ny < 2 || nz < 2) {
    return { positions: [], indices: [], normals: [] }
  }

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []

  // Iterate over all cubes in the grid
  const max_x = periodic ? nx : nx - 1
  const max_y = periodic ? ny : ny - 1
  const max_z = periodic ? nz : nz - 1

  // Rolling typed edge caches retain only the current x slab. Coordinates stay
  // UNWRAPPED (reach n in periodic mode), so opposite cell faces remain distinct
  // and never create cell-spanning triangles.
  const edge_stride = max_z + 1
  const edge_plane_size = (max_y + 1) * edge_stride
  const x_edge_cache = new Int32Array(edge_plane_size)
  let y_edge_current = new Int32Array(edge_plane_size)
  let y_edge_next = new Int32Array(edge_plane_size)
  let z_edge_current = new Int32Array(edge_plane_size)
  let z_edge_next = new Int32Array(edge_plane_size)
  x_edge_cache.fill(-1)
  y_edge_current.fill(-1)
  y_edge_next.fill(-1)
  z_edge_current.fill(-1)
  z_edge_next.fill(-1)

  // Precompute k_lattice values for faster coordinate transform
  const [kx0, kx1, kx2] = k_lattice[0]
  const [ky0, ky1, ky2] = k_lattice[1]
  const [kz0, kz1, kz2] = k_lattice[2]

  // Precompute inverse grid sizes for fractional coordinate conversion.
  // Non-periodic grids: n points span [0,1] with spacing 1/(n-1) — endpoints at 0 and 1.
  // Periodic grids: n points span [0,1) with spacing 1/n — point n wraps back to 0.
  const inv_nx = 1 / (periodic ? nx : nx - 1)
  const inv_ny = 1 / (periodic ? ny : ny - 1)
  const inv_nz = 1 / (periodic ? nz : nz - 1)
  // Singular lattices cannot map covectors; fall back to index-space unit gradients.
  let normal_transform: Matrix3x3 | null = null
  if (compute_norms) {
    try {
      normal_transform = matrix_inverse_3x3(k_lattice)
    } catch {
      /* keep null */
    }
  }

  // Get or create vertex on an edge (fully optimized with flat array lookups)
  const get_vertex_on_edge = (
    ix: number,
    iy: number,
    iz: number,
    edge_idx: number,
    cube_values: number[],
  ): number => {
    // Use flat arrays instead of destructuring
    const v1_idx = EDGE_V1[edge_idx]
    const v2_idx = EDGE_V2[edge_idx]
    const ox1 = CUBE_VERTS_X[v1_idx]
    const oy1 = CUBE_VERTS_Y[v1_idx]
    const oz1 = CUBE_VERTS_Z[v1_idx]
    const ox2 = CUBE_VERTS_X[v2_idx]
    const oy2 = CUBE_VERTS_Y[v2_idx]
    const oz2 = CUBE_VERTS_Z[v2_idx]

    // Key the edge's lower endpoint. For x-edges, x is the rolling slab and
    // y/z are equal; y- and z-edges normalize their sole varying key coordinate.
    let cache: Int32Array
    let cache_idx: number
    if (ox1 !== ox2) {
      cache = x_edge_cache
      cache_idx = (iy + oy1) * edge_stride + iz + oz1
    } else if (oy1 !== oy2) {
      cache = ox1 === 0 ? y_edge_current : y_edge_next
      cache_idx = (iy + Math.min(oy1, oy2)) * edge_stride + iz + oz1
    } else {
      cache = ox1 === 0 ? z_edge_current : z_edge_next
      cache_idx = (iy + oy1) * edge_stride + iz + Math.min(oz1, oz2)
    }
    const cached = cache[cache_idx]
    if (cached >= 0) return cached

    // Compute vertex position
    const v1 = cube_values[v1_idx]
    const v2 = cube_values[v2_idx]

    let fx: number, fy: number, fz: number
    if (interpolate) {
      const f1x = (ix + ox1) * inv_nx - center_offset
      const f1y = (iy + oy1) * inv_ny - center_offset
      const f1z = (iz + oz1) * inv_nz - center_offset
      const f2x = (ix + ox2) * inv_nx - center_offset
      const f2y = (iy + oy2) * inv_ny - center_offset
      const f2z = (iz + oz2) * inv_nz - center_offset
      const dv = v2 - v1
      if (Math.abs(dv) < 1e-10) {
        fx = f1x
        fy = f1y
        fz = f1z
      } else {
        const lerp = (iso_value - v1) / dv
        fx = f1x + lerp * (f2x - f1x)
        fy = f1y + lerp * (f2y - f1y)
        fz = f1z + lerp * (f2z - f1z)
      }
    } else {
      fx = (ix + (ox1 + ox2) * 0.5) * inv_nx - center_offset
      fy = (iy + (oy1 + oy2) * 0.5) * inv_ny - center_offset
      fz = (iz + (oz1 + oz2) * 0.5) * inv_nz - center_offset
    }

    // Transform to Cartesian (inlined)
    const vert_idx = positions.length / 3
    const cart_x = fx * kx0 + fy * ky0 + fz * kz0
    const cart_y = fx * kx1 + fy * ky1 + fz * kz1
    const cart_z = fx * kx2 + fy * ky2 + fz * kz2
    if (position_offset) {
      positions.push(
        cart_x + position_offset[0],
        cart_y + position_offset[1],
        cart_z + position_offset[2],
      )
    } else positions.push(cart_x, cart_y, cart_z)

    if (compute_norms) {
      const [gx, gy, gz] = compute_gradient(
        grid,
        ix + ox1,
        iy + oy1,
        iz + oz1,
        nx,
        ny,
        nz,
        periodic,
      )
      // Scale by grid spacing without a lattice inverse (singular / anisotropic grids)
      const index_grad: Vec3 = [gx / inv_nx, gy / inv_ny, gz / inv_nz]
      const [cx, cy, cz] = normal_transform
        ? mat3x3_vec3_multiply(normal_transform, index_grad)
        : index_grad
      const length = Math.hypot(cx, cy, cz)
      if (length > 1e-10) normals.push(cx / length, cy / length, cz / length)
      else normals.push(0, 0, 1)
    }

    cache[cache_idx] = vert_idx
    return vert_idx
  }

  // Preallocate cube_values array (reuse across iterations)
  const cube_values: number[] = Array(8)
  const scalar_grid = is_scalar_grid(grid) ? grid : null
  const nested_grid = scalar_grid ? null : (grid as number[][][])

  for (let ix = 0; ix < max_x; ix++) {
    x_edge_cache.fill(-1)
    y_edge_next.fill(-1)
    z_edge_next.fill(-1)
    const ix1 = (ix + 1) % nx
    const ix_row = nested_grid?.[ix] ?? []
    const ix1_row = nested_grid?.[ix1] ?? []

    for (let iy = 0; iy < max_y; iy++) {
      const iy1 = (iy + 1) % ny
      const iy_col = ix_row[iy] ?? []
      const iy1_col = ix_row[iy1] ?? []
      const ix1_iy_col = ix1_row[iy] ?? []
      const ix1_iy1_col = ix1_row[iy1] ?? []

      for (let iz = 0; iz < max_z; iz++) {
        const iz1 = (iz + 1) % nz

        if (scalar_grid) {
          cube_values[0] = grid_value(scalar_grid, ix, iy, iz)
          cube_values[1] = grid_value(scalar_grid, ix1, iy, iz)
          cube_values[2] = grid_value(scalar_grid, ix1, iy1, iz)
          cube_values[3] = grid_value(scalar_grid, ix, iy1, iz)
          cube_values[4] = grid_value(scalar_grid, ix, iy, iz1)
          cube_values[5] = grid_value(scalar_grid, ix1, iy, iz1)
          cube_values[6] = grid_value(scalar_grid, ix1, iy1, iz1)
          cube_values[7] = grid_value(scalar_grid, ix, iy1, iz1)
        } else {
          // Preserve direct nested-array reads for the existing hot path.
          cube_values[0] = iy_col[iz]
          cube_values[1] = ix1_iy_col[iz]
          cube_values[2] = ix1_iy1_col[iz]
          cube_values[3] = iy1_col[iz]
          cube_values[4] = iy_col[iz1]
          cube_values[5] = ix1_iy_col[iz1]
          cube_values[6] = ix1_iy1_col[iz1]
          cube_values[7] = iy1_col[iz1]
        }

        // Compute cube index (unrolled for speed)
        let cube_index = 0
        if (cube_values[0] < iso_value) cube_index |= 1
        if (cube_values[1] < iso_value) cube_index |= 2
        if (cube_values[2] < iso_value) cube_index |= 4
        if (cube_values[3] < iso_value) cube_index |= 8
        if (cube_values[4] < iso_value) cube_index |= 16
        if (cube_values[5] < iso_value) cube_index |= 32
        if (cube_values[6] < iso_value) cube_index |= 64
        if (cube_values[7] < iso_value) cube_index |= 128

        // Skip if cube is entirely inside or outside
        if (EDGE_TABLE[cube_index] === 0) continue

        // Get triangles for this cube configuration
        const tri_list = TRI_TABLE[cube_index]
        const tri_len = tri_list.length

        // Create triangles
        for (let tri_idx = 0; tri_idx < tri_len; tri_idx += 3) {
          const v0 = get_vertex_on_edge(ix, iy, iz, tri_list[tri_idx], cube_values)
          const v1 = get_vertex_on_edge(ix, iy, iz, tri_list[tri_idx + 1], cube_values)
          const v2 = get_vertex_on_edge(ix, iy, iz, tri_list[tri_idx + 2], cube_values)

          // Skip degenerate triangles
          if (v0 !== v1 && v1 !== v2 && v0 !== v2) {
            indices.push(v0, v1, v2)
          }
        }
      }
    }
    ;[y_edge_current, y_edge_next] = [y_edge_next, y_edge_current]
    ;[z_edge_current, z_edge_next] = [z_edge_next, z_edge_current]
  }

  return { positions, indices, normals }
}

// Buffer-oriented result for renderers that otherwise immediately flatten the
// compatibility arrays. This avoids one Vec3 and one triangle-array allocation
// per emitted vertex/face while preserving the public marching_cubes() API.
export function marching_cubes_buffers(
  grid: ScalarGridLike,
  iso_value: number,
  k_lattice: Matrix3x3,
  options: MarchingCubesOptions = {},
): MarchingCubesBuffers {
  const raw = marching_cubes_raw(grid, iso_value, k_lattice, options)
  return {
    positions: Float32Array.from(raw.positions),
    indices: Uint32Array.from(raw.indices),
    normals: Float32Array.from(raw.normals),
  }
}

const packed_to_vec3 = (values: number[]): Vec3[] =>
  Array.from({ length: values.length / 3 }, (_, idx) => {
    const offset = idx * 3
    return [values[offset], values[offset + 1], values[offset + 2]]
  })

export function marching_cubes(
  grid: ScalarGridLike,
  iso_value: number,
  k_lattice: Matrix3x3,
  options: MarchingCubesOptions = {},
): MarchingCubesResult {
  const raw = marching_cubes_raw(grid, iso_value, k_lattice, options)
  return {
    vertices: packed_to_vec3(raw.positions),
    faces: packed_to_vec3(raw.indices),
    normals: packed_to_vec3(raw.normals),
  }
}

// Compute per-vertex normals from faces using area-weighted averaging
// Uses fan triangulation for N-gon faces (quads, etc.)
export function compute_vertex_normals(vertices: Vec3[], faces: number[][]): Vec3[] {
  const normals: Vec3[] = vertices.map(() => [0, 0, 0])
  for (const face of faces) {
    // Validate face has at least 3 indices and all are within bounds
    if (face.length < 3) continue
    if (face.some((idx) => idx < 0 || idx >= vertices.length)) continue

    // Fan triangulation: for N vertices, process N-2 triangles (0,1,2), (0,2,3), ...
    const v0 = vertices[face[0]]
    for (let fan_idx = 1; fan_idx < face.length - 1; fan_idx++) {
      const idx1 = face[fan_idx]
      const idx2 = face[fan_idx + 1]
      const v1 = vertices[idx1]
      const v2 = vertices[idx2]

      // Edge vectors
      const e1: Vec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]]
      const e2: Vec3 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]]

      // Cross product (face normal * 2 * area)
      const normal: Vec3 = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ]

      // Add to the 3 vertices of this triangle
      normals[face[0]][0] += normal[0]
      normals[face[0]][1] += normal[1]
      normals[face[0]][2] += normal[2]
      normals[idx1][0] += normal[0]
      normals[idx1][1] += normal[1]
      normals[idx1][2] += normal[2]
      normals[idx2][0] += normal[0]
      normals[idx2][1] += normal[1]
      normals[idx2][2] += normal[2]
    }
  }

  // Normalize all normals
  for (const normal of normals) {
    const len = Math.hypot(normal[0], normal[1], normal[2])
    if (len > 0) {
      normal[0] /= len
      normal[1] /= len
      normal[2] /= len
    }
  }

  return normals
}
