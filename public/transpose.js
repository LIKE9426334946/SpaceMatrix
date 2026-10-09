import { parseShape, selectionAxes } from "./tensor.js";

// Match torch.transpose: exchange two axes without reversing either axis.
export function transposeDimensions(rank, dim0, dim1) {
  return [dim0, dim1].map((dim) => {
    if (!Number.isInteger(dim) || dim < -rank || dim >= rank)
      throw new Error(`维度编号需要是 ${-rank} 到 ${rank - 1} 之间的整数。`);
    return dim < 0 ? dim + rank : dim;
  });
}

export function swapAxes(values, dim0, dim1) {
  const result = [...values];
  [result[dim0], result[dim1]] = [result[dim1], result[dim0]];
  return result;
}

export function transposedShape(input, dim0, dim1) {
  const shape = parseShape(input);
  return swapAxes(shape, ...transposeDimensions(shape.length, dim0, dim1));
}

function sliceToken(indices, size) {
  const sorted = [...indices].sort((a, b) => a - b);
  if (!sorted.length) return "0:0";
  if (sorted.length === size) return ":";
  if (sorted.length === 1) return String(sorted[0]);
  const step = sorted[1] - sorted[0];
  return `${sorted[0]}:${sorted.at(-1) + 1}${step === 1 ? "" : `:${step}`}`;
}

export function transposeTensor(object, dim0, dim1) {
  const sourceShape = parseShape(object.shape);
  const dims = transposeDimensions(sourceShape.length, dim0, dim1);
  const shape = swapAxes(sourceShape, ...dims);
  const regions = selectionAxes(sourceShape, object.highlight);
  if (dims[0] === dims[1]) return { ...object, shape };
  const highlight = regions
    .map((axes) => {
      const transposed = swapAxes(axes, ...dims);
      if (transposed.some((indices) => !indices.length)) return "a[0:0]";
      return `a[${transposed.map((indices, d) => sliceToken(indices, shape[d])).join(", ")}]`;
    })
    .join("; ");
  return { ...object, shape, highlight };
}
