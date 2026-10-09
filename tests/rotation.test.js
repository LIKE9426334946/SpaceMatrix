import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Vector3 } from "three";
import {
  rotateTensor,
  rotatedShape,
  rotationSpec,
} from "../public/rotation.js";
import {
  elementCount,
  indexFromLinear,
  selectRegion,
} from "../public/tensor.js";
import { tensorLayout } from "../public/layout.js";

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

test("quarter turns swap the correct dimensions and move a highlighted corner", () => {
  const object = tensor([2, 4, 5], "a[0, 0, 0]");
  const cases = {
    up: [
      [4, 2, 5],
      [3, 0, 0],
    ],
    down: [
      [4, 2, 5],
      [0, 1, 0],
    ],
    left: [
      [5, 4, 2],
      [4, 0, 0],
    ],
    right: [
      [5, 4, 2],
      [0, 0, 1],
    ],
  };
  for (const [direction, [shape, corner]] of Object.entries(cases)) {
    const turned = rotateTensor(object, direction);
    assert.deepEqual(turned.shape, shape);
    assert.deepEqual(selectedCoordinates(turned), [corner]);
    assert.equal(elementCount(turned.shape), 40);
    assert.equal(turned.id, object.id);
  }
  assert.deepEqual(object.shape, [2, 4, 5], "input remains unchanged");
  assert.throws(() => rotateTensor(object, "diagonal"));
  assert.throws(() => rotatedShape([21, 4, 5], "up"));
});

test("every reindexed cell lands at the exact endpoint of the 3D animation", () => {
  for (const shape of [[5], [4, 5], [2, 4, 5], [3, 2, 4, 5]]) {
    const before = tensorLayout(shape);
    for (const direction of ["up", "down", "left", "right"]) {
      const spec = rotationSpec(direction);
      const matrix = new Matrix4().makeRotationAxis(
        new Vector3(...spec.axis),
        spec.angle,
      );
      for (let i = 0; i < elementCount(shape); i++) {
        const coords = indexFromLinear(i, shape);
        const object = rotateTensor(tensor(shape, `a[${coords}]`), direction);
        const after = tensorLayout(object.shape);
        const nextCoords = selectedCoordinates(object)[0];
        const batch = shape.length === 4 ? coords[0] : 0;
        const start = new Vector3(...before.cellPosition(coords)).sub(
          new Vector3(...before.batchOffsets[batch]),
        );
        const end = new Vector3(...after.cellPosition(nextCoords)).sub(
          new Vector3(...after.batchOffsets[batch]),
        );
        assert.ok(
          start.applyMatrix4(matrix).distanceTo(end) < 1e-10,
          `${shape}/${direction}/${coords}`,
        );
        if (shape.length === 4) assert.equal(nextCoords[0], batch);
      }
    }
  }
});

test("inverse turns and four successive turns preserve stepped and overlapping highlights", () => {
  for (const highlight of [
    "",
    "a[1:1]",
    "a[... ]",
    "a[0,::-2,1::2]; a[-1,1:4,::-2]",
    "a[0]; a[:,0,::2]",
  ]) {
    const original = tensor([2, 4, 5], highlight);
    for (const [direction, inverse] of [
      ["up", "down"],
      ["left", "right"],
    ]) {
      const restored = rotateTensor(rotateTensor(original, direction), inverse);
      assert.deepEqual(restored.shape, original.shape);
      assert.deepEqual(selection(restored).mask, selection(original).mask);
    }
    for (const direction of ["up", "down", "left", "right"]) {
      let turned = original;
      for (let n = 0; n < 4; n++) {
        turned = rotateTensor(turned, direction);
        assert.equal(selection(turned).count, selection(original).count);
      }
      assert.deepEqual(turned.shape, original.shape);
      assert.deepEqual(selection(turned).mask, selection(original).mask);
    }
  }
});

test("lower ranks gain singleton spatial axes and 4D preserves its batch dimension", () => {
  assert.deepEqual(rotatedShape([5], "left"), [5, 1, 1]);
  assert.deepEqual(rotatedShape([4, 5], "up"), [4, 1, 5]);
  assert.deepEqual(rotatedShape([3, 2, 4, 5], "left"), [3, 5, 4, 2]);
  const before = tensor([20, 20, 20, 20], "a[1:20:3, 0, ::-2, ::2]");
  const after = rotateTensor(before, "up");
  assert.equal(selection(after).count, 700);
  assert.deepEqual(
    [...new Set(selectedCoordinates(after).map((coords) => coords[0]))],
    [1, 4, 7, 10, 13, 16, 19],
  );
});
