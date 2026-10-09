import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { elementCount, indexFromLinear, selectRegion } from "./tensor.js";
import { EYE, UP, sceneLayout } from "./layout.js";
import { swapAxes, transposeDimensions } from "./transpose.js";

// A world unit always occupies the same CSS-pixel scale at 100% zoom.
const PIXELS_PER_UNIT = 64;
export const ANIMATION_DURATION_MS = 2000;

export class TensorViewer {
  constructor(container, { onSelect, onZoom } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onZoom = onZoom;
    this.entries = [];
    this.animationSpeed = 1;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 10000);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "张量三维画布。拖动旋转，滚轮缩放，右键拖动平移。",
    );
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.tabIndex = 0;
    container.prepend(this.renderer.domElement);
    this.labels = document.createElement("div");
    this.labels.className = "scene-labels";
    container.append(this.labels);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.minZoom = 0.01;
    this.controls.maxZoom = 12;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener("change", () => {
      this.requestRender();
      this.onZoom?.(this.camera.zoom);
    });
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (event) => {
      this.pointerStart =
        event.button === 0
          ? { x: event.clientX, y: event.clientY, id: event.pointerId }
          : null;
    });
    canvas.addEventListener("pointerup", (event) => {
      const start = this.pointerStart;
      this.pointerStart = null;
      if (
        this.animating ||
        !start ||
        start.id !== event.pointerId ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
      )
        return;
      const rect = canvas.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        this.camera,
      );
      this.scene.updateMatrixWorld(true);
      const hit = ray.intersectObjects(
        this.entries.map((entry) => entry.group),
        true,
      )[0];
      if (hit) this.onSelect?.(hit.object.userData.objectId);
    });
    canvas.addEventListener("pointercancel", () => {
      this.pointerStart = null;
    });
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.65));
    const light = new THREE.DirectionalLight(0xffffff, 2.25);
    light.position.set(-8, 14, 9);
    this.scene.add(light);
    const fill = new THREE.DirectionalLight(0xc3d5ff, 0.9);
    fill.position.set(10, 2, -5);
    this.scene.add(fill);
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.reset();
  }

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.renderer.render(this.scene, this.camera);
      const width = this.container.clientWidth,
        height = this.container.clientHeight;
      for (const entry of this.entries) {
        const point = entry.labelPoint.clone().project(this.camera);
        entry.label.style.transform = `translate(-50%, 0) translate(${(point.x * 0.5 + 0.5) * width}px, ${(-point.y * 0.5 + 0.5) * height}px)`;
        entry.label.hidden =
          point.z < -1 ||
          point.z > 1 ||
          Math.abs(point.x) > 1 ||
          Math.abs(point.y) > 1;
      }
    });
  }

  setObjects(objects, { preserveCamera = false } = {}) {
    // Keep the camera stable for color/highlight/name edits and server updates.
    const geometryKey = JSON.stringify(objects.map((o) => [o.id, o.shape]));
    const geometryChanged = geometryKey !== this.geometryKey;
    this.geometryKey = geometryKey;
    for (const entry of this.entries) {
      this.scene.remove(entry.group);
      entry.group.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry !== this.geometry) child.geometry.dispose();
          child.material.dispose();
          child.dispose();
        }
      });
    }
    this.entries = [];
    this.labels.replaceChildren();
    const layouts = sceneLayout(objects);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const bounds = new THREE.Box3();
    objects.forEach((object, objectIndex) => {
      const layout = layouts[objectIndex];
      const offset = new THREE.Vector3(...layout.offset);
      const group = new THREE.Group();
      group.position.copy(offset);
      const selection = selectRegion(object.shape, object.highlight);
      const total = elementCount(object.shape);
      const material = (color, faded) =>
        new THREE.MeshLambertMaterial({
          color,
          transparent: faded,
          opacity: faded ? 0.13 : 1,
          depthWrite: !faded,
        });
      // Keep batches separate, and retain the source index of each drawn cell.
      const batches = [];
      const perBatch = total / layout.batchOffsets.length;
      layout.batchOffsets.forEach((batchOffset, batchIndex) => {
        const batch = new THREE.Group();
        batch.position.set(...batchOffset);
        group.add(batch);
        batches.push(batch);
        const start = batchIndex * perBatch;
        let selectedCount = 0;
        for (let index = start; index < start + perBatch; index++)
          selectedCount += selection.mask[index];
        const ordinaryCount = perBatch - selectedCount;
        const ordinary = ordinaryCount
          ? new THREE.InstancedMesh(
              this.geometry,
              material(object.color, selection.count > 0),
              ordinaryCount,
            )
          : null;
        const selected = selectedCount
          ? new THREE.InstancedMesh(
              this.geometry,
              material(object.highlightColor, false),
              selectedCount,
            )
          : null;
        for (const mesh of [ordinary, selected])
          if (mesh) {
            mesh.userData.objectId = object.id;
            mesh.userData.cellIndices = new Uint32Array(mesh.count);
            batch.add(mesh);
          }
        let ordinaryIndex = 0,
          selectedIndex = 0;
        for (let index = start; index < start + perBatch; index++) {
          position.set(
            ...layout.cellPosition(indexFromLinear(index, object.shape)),
          );
          position.sub(batch.position);
          matrix.compose(position, quaternion, scale);
          const mesh = selection.mask[index] ? selected : ordinary;
          const instance = selection.mask[index]
            ? selectedIndex++
            : ordinaryIndex++;
          mesh.setMatrixAt(instance, matrix);
          mesh.userData.cellIndices[instance] = index;
        }
        for (const mesh of [ordinary, selected])
          if (mesh) {
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
          }
      });
      this.scene.add(group);
      const objectBounds = new THREE.Box3(
        new THREE.Vector3(...layout.min).add(offset),
        new THREE.Vector3(...layout.max).add(offset),
      );
      bounds.union(objectBounds);
      const label = document.createElement("button");
      label.className = "scene-label";
      label.textContent = object.name;
      label.title = `聚焦 ${object.name}`;
      label.addEventListener("click", () => {
        if (!this.animating) this.onSelect?.(object.id);
      });
      this.labels.append(label);
      const labelPoint = new THREE.Vector3(...UP)
        .multiplyScalar(-layout.height / 2 - 0.65)
        .add(offset);
      this.entries.push({
        id: object.id,
        shape: [...object.shape],
        layout,
        group,
        batches,
        bounds: objectBounds,
        label,
        labelPoint,
        total,
        selectedCount: selection.count,
      });
    });
    this.bounds = bounds.isEmpty()
      ? new THREE.Box3(
          new THREE.Vector3(-2, -2, -2),
          new THREE.Vector3(2, 2, 2),
        )
      : bounds;
    if (geometryChanged && !preserveCamera) {
      this.focusedId = null;
      this.centerOn(this.bounds);
    } else this.requestRender();
  }

  setAnimationSpeed(value) {
    const speed = Number(value);
    this.animationSpeed =
      Number.isFinite(speed) &&
      speed >= 0.25 &&
      speed <= 2 &&
      Number.isInteger(speed * 4)
        ? speed
        : 1;
    return this.animationSpeed;
  }

  async animateTranspose(id, dim0, dim1, objects) {
    const selected = this.entries.find((entry) => entry.id === id);
    if (!selected) return;
    const dims = transposeDimensions(selected.shape.length, dim0, dim1);
    if (dims[0] === dims[1]) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : ANIMATION_DURATION_MS;
    const layouts = sceneLayout(objects);
    const bounds = new THREE.Box3();
    const targets = new Map(
      objects.map((object, index) => {
        const layout = layouts[index];
        const offset = new THREE.Vector3(...layout.offset);
        const objectBounds = new THREE.Box3(
          new THREE.Vector3(...layout.min).add(offset),
          new THREE.Vector3(...layout.max).add(offset),
        );
        bounds.union(objectBounds);
        return [object.id, { layout, offset, bounds: objectBounds }];
      }),
    );
    const movements = this.entries
      .map((entry) => ({
        entry,
        from: entry.group.position.clone(),
        labelFrom: entry.labelPoint.clone(),
        target: targets.get(entry.id),
      }))
      .filter((item) => item.target);
    const targetLayout = targets.get(id).layout;
    const progressUniform = { value: 0 };
    const delta = new THREE.Vector3(),
      arc = new THREE.Vector3();
    const eye = new THREE.Vector3(...EYE);
    // GPU interpolation keeps 160,000 cells animated without updating every
    // instance matrix on every frame. Each instance keeps its own highlight.
    if (duration)
      selected.group.traverse((mesh) => {
        if (!mesh.isInstancedMesh) return;
        const deltas = new Float32Array(mesh.count * 3);
        const arcs = new Float32Array(mesh.count * 3);
        mesh.userData.cellIndices.forEach((linear, instance) => {
          const coords = indexFromLinear(linear, selected.shape);
          const source = selected.layout.cellPosition(coords);
          const destination = targetLayout.cellPosition(
            swapAxes(coords, ...dims),
          );
          delta.set(...destination).sub(new THREE.Vector3(...source));
          delta.toArray(deltas, instance * 3);
          // Opposite journeys bow in opposite directions instead of collapsing
          // all the swapped rows onto the same plane at the animation midpoint.
          arc.crossVectors(delta, eye).multiplyScalar(0.35);
          arc.toArray(arcs, instance * 3);
        });
        mesh.geometry = this.geometry.clone();
        mesh.geometry.setAttribute(
          "transposeDelta",
          new THREE.InstancedBufferAttribute(deltas, 3),
        );
        mesh.geometry.setAttribute(
          "transposeArc",
          new THREE.InstancedBufferAttribute(arcs, 3),
        );
        mesh.frustumCulled = false;
        mesh.material.onBeforeCompile = (shader) => {
          shader.uniforms.transposeProgress = progressUniform;
          shader.vertexShader =
            `attribute vec3 transposeDelta;\nattribute vec3 transposeArc;\nuniform float transposeProgress;\n${shader.vertexShader}`.replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
            transformed += transposeDelta * transposeProgress
              + transposeArc * sin(3.141592653589793 * transposeProgress);`,
            );
        };
        mesh.material.customProgramCacheKey = () => "tensor-transpose-v1";
        mesh.material.needsUpdate = true;
      });
    const oldAnchor =
      this.entries.find((entry) => entry.id === this.focusedId)?.bounds ||
      this.bounds;
    const newAnchor = targets.get(this.focusedId)?.bounds || bounds;
    const shift = newAnchor
      .getCenter(new THREE.Vector3())
      .sub(oldAnchor.getCenter(new THREE.Vector3()));
    const cameraStart = this.camera.position.clone();
    const targetStart = this.controls.target.clone();
    this.animating = true;
    this.controls.enabled = false;
    try {
      await new Promise((resolve) => {
        let previousTime = performance.now();
        let elapsed = 0;
        const tick = (now) => {
          // Integrate playback time so speed changes take effect mid-animation
          // without jumping forward or restarting the movement.
          elapsed += Math.max(0, now - previousTime) * this.animationSpeed;
          previousTime = now;
          const progress = duration ? Math.min(1, elapsed / duration) : 1;
          const t =
            progress < 0.5
              ? 4 * progress ** 3
              : 1 - (-2 * progress + 2) ** 3 / 2;
          for (const { entry, from, labelFrom, target } of movements) {
            entry.group.position.lerpVectors(from, target.offset, t);
            const labelEnd = new THREE.Vector3(...UP)
              .multiplyScalar(-target.layout.height / 2 - 0.65)
              .add(target.offset);
            entry.labelPoint.lerpVectors(labelFrom, labelEnd, t);
          }
          progressUniform.value = t;
          this.camera.position.copy(cameraStart).addScaledVector(shift, t);
          this.controls.target.copy(targetStart).addScaledVector(shift, t);
          this.requestRender();
          if (progress < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
    } finally {
      this.animating = false;
      this.controls.enabled = true;
    }
  }

  setActive(id) {
    for (const entry of this.entries)
      entry.label.classList.toggle("active", entry.id === id);
  }

  updateProjection() {
    const halfWidth =
      Math.max(1, this.container.clientWidth) / (2 * PIXELS_PER_UNIT);
    const halfHeight =
      Math.max(1, this.container.clientHeight) / (2 * PIXELS_PER_UNIT);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  centerOn(bounds, resetDirection = false) {
    const center = bounds.getCenter(new THREE.Vector3());
    const direction = resetDirection
      ? new THREE.Vector3(...EYE)
      : this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    const distance = Math.max(
      30,
      bounds.getSize(new THREE.Vector3()).length() * 2,
    );
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld(true);
    this.updateProjection();
    this.controls.update();
    this.onZoom?.(this.camera.zoom);
    this.requestRender();
  }

  reset() {
    this.focusedId = null;
    this.camera.zoom = 1;
    this.centerOn(
      this.bounds ||
        new THREE.Box3(
          new THREE.Vector3(-2, -2, -2),
          new THREE.Vector3(2, 2, 2),
        ),
      true,
    );
  }
  focus(id) {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      this.focusedId = id;
      this.centerOn(entry.bounds);
    }
  }
  zoom(factor) {
    this.camera.zoom = THREE.MathUtils.clamp(
      this.camera.zoom * factor,
      this.controls.minZoom,
      this.controls.maxZoom,
    );
    this.camera.updateProjectionMatrix();
    this.onZoom?.(this.camera.zoom);
    this.requestRender();
  }
  resize() {
    this.renderer.setSize(
      this.container.clientWidth,
      this.container.clientHeight,
    );
    this.updateProjection();
    this.requestRender();
  }
}
