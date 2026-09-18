import test from "node:test";
import assert from "node:assert/strict";
import { parseShape, selectRegion, indexFromLinear } from "../public/tensor.js";
import { tensorLayout, EYE, RIGHT, UP, dot } from "../public/layout.js";

test("shapes accept tuples, lists and dimension separators, enforce 1–4D / 1–20", () => {
  for (const value of ["(3, 3, 3)", "[3,3,3]", "3 × 3 × 3", "3 3 3", "3，3，3"])
    assert.deepEqual(parseShape(value), [3, 3, 3]);
  assert.deepEqual(parseShape("(6,)"), [6]);
  assert.deepEqual(parseShape("20,20,20,20"), [20, 20, 20, 20]);
  for (const value of [
    "",
    "0",
    "21",
    "3.5",
    "1,2,3,4,5",
    "eval(1)",
    "(3,3]",
    [-1],
  ])
    assert.throws(() => parseShape(value));
});

test("basic tensor indexing produces expected flattened cells", () => {
  assert.deepEqual(
    [...selectRegion([3, 3, 3], "a[0,:,:]").mask.entries()]
      .filter(([, v]) => v)
      .map(([i]) => i),
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(selectRegion([3, 3, 3], "a[1,1,1]").mask[13], 1);
  for (const expression of [
    "a[0,:,:]",
    "[0,:,:]",
    "0,:,:",
    "a[0]",
    "a[0,]",
    "a[0,...]",
  ])
    assert.equal(selectRegion([3, 3, 3], expression).count, 9);
  assert.equal(selectRegion([3, 3, 3], "a[:,0,:]").count, 9);
  assert.equal(selectRegion([3, 3, 3], "a[-1,...]").count, 9);
  assert.equal(selectRegion([2, 3, 4, 5], "a[:,0,...]").count, 40);
  assert.equal(selectRegion([2, 3, 4, 5], "a[0]").count, 60);
});

test("Python slice boundaries, negative steps, clipping, unions and empty selections", () => {
  const indices = (expression) =>
    [...selectRegion([5], expression).mask.entries()]
      .filter(([, v]) => v)
      .map(([i]) => i);
  assert.deepEqual(indices("a[1:4:2]"), [1, 3]);
  assert.deepEqual(indices("a[::-1]"), [0, 1, 2, 3, 4]);
  assert.deepEqual(indices("a[:-1:-1]"), []);
  assert.deepEqual(indices("a[4:0:-2]"), [2, 4]);
  assert.deepEqual(indices("a[-100:100]"), [0, 1, 2, 3, 4]);
  assert.deepEqual(indices("a[100:-100:-2]"), [0, 2, 4]);
  assert.deepEqual(indices("a[1:1]"), []);
  assert.deepEqual(indices("a[0:3]; a[2:5]"), [0, 1, 2, 3, 4]);
  assert.equal(selectRegion([3, 3, 3], "").count, 0);
  for (const expression of [
    "a[5]",
    "a[-6]",
    "a[::0]",
    "a[0,0]",
    "a[..., ...]",
    "a[None]",
    "a[1,,]",
    "a[[0,1]]",
    "a[0];",
    "alert(1)",
  ])
    assert.throws(() => selectRegion([5], expression));
});

test("full 4D size works without truncation and uses row-major indexing", () => {
  const selection = selectRegion([20, 20, 20, 20], "a[...]");
  assert.equal(selection.total, 160000);
  assert.equal(selection.count, 160000);
  assert.equal(selection.mask.length, 160000);
  assert.deepEqual(indexFromLinear(159999, [20, 20, 20, 20]), [19, 19, 19, 19]);
  assert.equal(selectRegion([20, 20, 20, 20], "a[:,0,:,:]").count, 8000);
});

test("first slice is left/front; depth moves right/back; rows downward", () => {
  const layout = tensorLayout([3, 3, 3]);
  const first = layout.cellPosition([0, 1, 1]),
    last = layout.cellPosition([2, 1, 1]);
  assert.ok(dot(first, RIGHT) < dot(last, RIGHT), "first slice is screen-left");
  assert.ok(dot(first, EYE) > dot(last, EYE), "first slice is closer");
  assert.ok(
    dot(layout.cellPosition([0, 0, 0]), UP) >
      dot(layout.cellPosition([0, 1, 0]), UP),
  );
  const line = tensorLayout([6]);
  const line3D = tensorLayout([1, 1, 6]);
  for (let i = 0; i < 6; i++) {
    assert.deepEqual(line.cellPosition([i]), line3D.cellPosition([0, 0, i]));
  }
  const plane = tensorLayout([4, 5]);
  const plane3D = tensorLayout([1, 4, 5]);
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 5; column++) {
      assert.deepEqual(
        plane.cellPosition([row, column]),
        plane3D.cellPosition([0, row, column]),
      );
    }
  assert.deepEqual(line.size, line3D.size);
  assert.deepEqual(plane.size, plane3D.size);
  assert.equal(tensorLayout([20, 20, 20, 20]).batchOffsets.length, 20);
});
