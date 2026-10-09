import test from "node:test";
import assert from "node:assert/strict";
import {
  swapAxes,
  transposeTensor,
  transposedShape,
} from "../public/transpose.js";
import {
  elementCount,
  indexFromLinear,
  selectRegion,
} from "../public/tensor.js";

const tensor = (shape, highlight = "") => ({
  id: "a",
  name: "tensor",
  shape,
  highlight,
});
const selection = (object) => selectRegion(object.shape, object.highlight);
const selectedCoordinates = (object) =>
  [...selection(object).mask].flatMap((selected, index) =>
    selected ? [indexFromLinear(index, object.shape)] : [],
  );

test("transpose fixes the all-zero index and exchanges coordinates without reversing them", () => {
  for (const [dims, shape, target] of [
    [
      [0, 1],
      [4, 2, 5],
      [2, 1, 3],
    ],
    [
      [0, 2],
      [5, 4, 2],
      [3, 2, 1],
    ],
    [
      [1, 2],
      [2, 5, 4],
      [1, 3, 2],
    ],
  ]) {
    const origin = transposeTensor(tensor([2, 4, 5], "a[0, 0, 0]"), ...dims);
    assert.deepEqual(origin.shape, shape);
    assert.deepEqual(selectedCoordinates(origin), [[0, 0, 0]]);
    const object = tensor([2, 4, 5], "a[1, 2, 3]");
    const transposed = transposeTensor(object, ...dims);
    assert.deepEqual(selectedCoordinates(transposed), [target]);
    assert.equal(elementCount(transposed.shape), 40);
    assert.deepEqual(object, tensor([2, 4, 5], "a[1, 2, 3]"));
  }
});

test("the 40 unique values of arange(40).reshape(2,4,5) match transpose(0,1)", () => {
  const result = new Array(40);
  for (let value = 0; value < 40; value++) {
    const coords = indexFromLinear(value, [2, 4, 5]);
    const transposed = transposeTensor(tensor([2, 4, 5], `a[${coords}]`), 0, 1);
    result[selection(transposed).mask.indexOf(1)] = value;
  }
  assert.deepEqual(
    result,
    [
      0, 1, 2, 3, 4, 20, 21, 22, 23, 24, 5, 6, 7, 8, 9, 25, 26, 27, 28, 29, 10,
      11, 12, 13, 14, 30, 31, 32, 33, 34, 15, 16, 17, 18, 19, 35, 36, 37, 38,
      39,
    ],
  );
});

test("highlights follow exchanged axes; a second exchange restores all selected cells", () => {
  for (const shape of [
    [4, 5],
    [2, 4, 5],
    [3, 2, 4, 5],
  ]) {
    for (const highlight of [
      "",
      "a[1:1]",
      "a[...]",
      "a[0]; a[-1,...,::2]",
      "a[::-2,...,1::2]",
    ]) {
      const original = tensor(shape, highlight);
      for (let dim0 = 0; dim0 < shape.length; dim0++) {
        for (let dim1 = dim0 + 1; dim1 < shape.length; dim1++) {
          const transposed = transposeTensor(original, dim0, dim1);
          assert.equal(selection(transposed).count, selection(original).count);
          const expected = selectedCoordinates(original)
            .map((coords) => {
              const result = [...coords];
              result[dim0] = coords[dim1];
              result[dim1] = coords[dim0];
              return result.join(",");
            })
            .sort();
          assert.deepEqual(
            selectedCoordinates(transposed)
              .map((coords) => coords.join(","))
              .sort(),
            expected,
          );
          const restored = transposeTensor(transposed, dim0, dim1);
          assert.deepEqual(restored.shape, shape);
          assert.deepEqual(selection(restored).mask, selection(original).mask);
        }
      }
    }
  }
  assert.equal(
    transposeTensor(tensor([2, 4, 5], "a[0,:,:]"), 0, 1).highlight,
    "a[:, 0, :]",
  );
});

test("rank is unchanged, including 2D and 4D exchanges involving the batch axis", () => {
  assert.deepEqual(transposedShape([5], 0, 0), [5]);
  assert.deepEqual(transposedShape([4, 5], 0, 1), [5, 4]);
  const transposed = transposeTensor(
    tensor([2, 3, 4, 5], "a[1, 2, 3, 4]"),
    0,
    3,
  );
  assert.deepEqual(transposed.shape, [5, 3, 4, 2]);
  assert.deepEqual(selectedCoordinates(transposed), [[4, 2, 3, 1]]);
  const full = tensor([20, 20, 20, 20], "a[1:20:3,0,::-2,::2]");
  assert.equal(selection(transposeTensor(full, 0, 3)).count, 700);
  assert.deepEqual(
    transposeTensor(tensor([2, 4, 5], "a[1]"), 1, 1),
    tensor([2, 4, 5], "a[1]"),
  );
});

test("negative dimension numbers match positive axes, and invalid axes are rejected", () => {
  const object = tensor([2, 4, 5], "a[-1,0,::2]");
  assert.deepEqual(
    transposeTensor(object, -3, -1),
    transposeTensor(object, 0, 2),
  );
  assert.deepEqual(swapAxes([0, 0, 0], 0, 1), [0, 0, 0]);
  for (const dims of [
    [-4, 0],
    [0, 3],
    [0, 1.5],
    ["0", 1],
    [null, 1],
    [undefined, 1],
  ])
    assert.throws(() => transposedShape([2, 4, 5], ...dims));
  assert.throws(() => transposedShape([5], 0, 1));
});
