import { parseShape, selectionAxes } from "./tensor.js";

// A quarter turn in the fixed world axes used by layout.js.
// Each destination axis selects a source axis, optionally reversed.
export const ROTATIONS = {
  // Turn the front (-X) face upward/downward about Z, or left/right about Y.
  up: {
    label: "向上",
    axis: [0, 0, 1],
    angle: -Math.PI / 2,
    order: [1, 0, 2],
    reverse: [true, false, false],
  },
  down: {
    label: "向下",
    axis: [0, 0, 1],
    angle: Math.PI / 2,
    order: [1, 0, 2],
    reverse: [false, true, false],
  },
  left: {
    label: "向左",
    axis: [0, 1, 0],
    angle: -Math.PI / 2,
    order: [2, 1, 0],
    reverse: [true, false, false],
  },
  right: {
    label: "向右",
    axis: [0, 1, 0],
    angle: Math.PI / 2,
    order: [2, 1, 0],
    reverse: [false, false, true],
  },
};

export function rotationSpec(direction) {
  if (!Object.hasOwn(ROTATIONS, direction))
    throw new Error("请选择向上、向下、向左或向右翻转。");
  return ROTATIONS[direction];
}

export function rotatedShape(input, direction) {
  const shape = parseShape(input);
  while (shape.length < 3) shape.unshift(1);
  const offset = shape.length - 3;
  return [
    ...shape.slice(0, offset),
    ...rotationSpec(direction).order.map((axis) => shape[offset + axis]),
  ];
}

function sliceToken(indices, size) {
  const sorted = [...indices].sort((a, b) => a - b);
  if (!sorted.length) return "0:0";
  if (sorted.length === size) return ":";
  if (sorted.length === 1) return String(sorted[0]);
  const step = sorted[1] - sorted[0];
  return `${sorted[0]}:${sorted.at(-1) + 1}${step === 1 ? "" : `:${step}`}`;
}

export function rotateTensor(object, direction) {
  const spec = rotationSpec(direction);
  const shape = rotatedShape(object.shape, direction);
  const padding = Math.max(0, 3 - object.shape.length);
  const sourceShape = [...Array(padding).fill(1), ...object.shape];
  const offset = sourceShape.length - 3;
  const highlight = selectionAxes(object.shape, object.highlight)
    .map((axes) => {
      const source = [...Array.from({ length: padding }, () => [0]), ...axes];
      const rotated = [
        ...source.slice(0, offset),
        ...spec.order.map((axis, d) =>
          source[offset + axis].map((index) =>
            spec.reverse[d] ? sourceShape[offset + axis] - 1 - index : index,
          ),
        ),
      ];
      if (rotated.some((indices) => !indices.length)) return "a[0:0]";
      return `a[${rotated.map((indices, d) => sliceToken(indices, shape[d])).join(", ")}]`;
    })
    .join("; ");
  return { ...object, shape, highlight };
}
