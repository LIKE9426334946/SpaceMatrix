// Camera is on -X, +Y, +Z. Depth (d0) runs along +X, to screen-right/back.
export const VIEW_DIRECTION = [-1.55, 1.15, 1.9];
const length = Math.hypot(...VIEW_DIRECTION);
export const EYE = VIEW_DIRECTION.map((v) => v / length);
const horizontal = Math.hypot(EYE[0], EYE[2]);
export const RIGHT = [EYE[2] / horizontal, 0, -EYE[0] / horizontal];
export const UP = [
  (-EYE[0] * EYE[1]) / horizontal,
  horizontal,
  (-EYE[2] * EYE[1]) / horizontal,
];
export const PITCH = 1.09;
export const FLAT_ROTATION = -Math.atan2(RIGHT[2], RIGHT[0]);
export const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);

export function tensorLayout(shape) {
  const rank = shape.length;
  const [depth, rows, columns] =
    rank >= 3 ? shape.slice(-3) : [1, rank === 2 ? shape[0] : 1, shape.at(-1)];
  const size =
    rank >= 3
      ? [depth * PITCH, rows * PITCH, columns * PITCH]
      : [
          columns * PITCH * RIGHT[0] + RIGHT[2],
          rows * PITCH,
          columns * PITCH * RIGHT[2] + RIGHT[0],
        ];
  const projectedWidth = size.reduce(
    (sum, n, i) => sum + Math.abs(n * RIGHT[i]),
    0,
  );
  const projectedHeight = size.reduce(
    (sum, n, i) => sum + Math.abs(n * UP[i]),
    0,
  );
  const batches = rank === 4 ? shape[0] : 1;
  const gridColumns = Math.ceil(Math.sqrt(batches));
  const gridRows = Math.ceil(batches / gridColumns);
  const batchOffsets = Array.from({ length: batches }, (_, i) => {
    const row = Math.floor(i / gridColumns);
    const columnsInRow = Math.min(gridColumns, batches - row * gridColumns);
    const across =
      ((i % gridColumns) - (columnsInRow - 1) / 2) * (projectedWidth + 2.5);
    const up = ((gridRows - 1) / 2 - row) * (projectedHeight + 2.3);
    return RIGHT.map((v, d) => v * across + UP[d] * up);
  });
  const cellPosition = (coords) => {
    const batch = rank === 4 ? coords[0] : 0;
    const index =
      rank >= 3
        ? coords.slice(-3)
        : [0, rank === 2 ? coords[0] : 0, coords.at(-1)];
    const x = (index[0] - (depth - 1) / 2) * PITCH;
    const y = ((rows - 1) / 2 - index[1]) * PITCH;
    const z = (index[2] - (columns - 1) / 2) * PITCH;
    const local = rank >= 3 ? [x, y, z] : [z * RIGHT[0], y, z * RIGHT[2]];
    return local.map((v, d) => v + batchOffsets[batch][d]);
  };
  const min = [0, 1, 2].map((d) =>
    Math.min(...batchOffsets.map((p) => p[d] - size[d] / 2)),
  );
  const max = [0, 1, 2].map((d) =>
    Math.max(...batchOffsets.map((p) => p[d] + size[d] / 2)),
  );
  return {
    size,
    min,
    max,
    batchOffsets,
    cellPosition,
    width: gridColumns * projectedWidth + (gridColumns - 1) * 2.5,
    height: gridRows * projectedHeight + (gridRows - 1) * 2.3,
  };
}
