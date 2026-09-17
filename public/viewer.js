import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { elementCount, indexFromLinear, selectRegion } from "./tensor.js";
import { EYE, RIGHT, UP, FLAT_ROTATION, tensorLayout } from "./layout.js";

export class TensorViewer {
  constructor(container, { onSelect, onZoom } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onZoom = onZoom;
    this.entries = [];
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
    this.controls.minZoom = 0.08;
    this.controls.maxZoom = 12;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener("change", () => {
      this.requestRender();
      this.onZoom?.(this.camera.zoom);
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

  setObjects(objects) {
    // Keep the camera stable for color/highlight/name edits and server updates.
    const geometryKey = JSON.stringify(objects.map((o) => [o.id, o.shape]));
    const geometryChanged = geometryKey !== this.geometryKey;
    this.geometryKey = geometryKey;
    for (const entry of this.entries) {
      this.scene.remove(entry.group);
      entry.group.traverse((child) => {
        if (child.isMesh) {
          child.material.dispose();
          child.dispose();
        }
      });
    }
    this.entries = [];
    this.labels.replaceChildren();
    const layouts = objects.map((o) => tensorLayout(o.shape));
    const columns = Math.ceil(Math.sqrt(objects.length));
    const rows = Math.ceil(objects.length / (columns || 1));
    const cellWidth = Math.max(1, ...layouts.map((l) => l.width)) + 5;
    const cellHeight = Math.max(1, ...layouts.map((l) => l.height)) + 5;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const bounds = new THREE.Box3();
    objects.forEach((object, objectIndex) => {
      const layout = layouts[objectIndex];
      const row = Math.floor(objectIndex / columns);
      const inRow = Math.min(columns, objects.length - row * columns);
      const across = ((objectIndex % columns) - (inRow - 1) / 2) * cellWidth;
      const above = ((rows - 1) / 2 - row) * cellHeight;
      const offset = new THREE.Vector3(
        ...RIGHT.map((v, d) => v * across + UP[d] * above),
      );
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
      const ordinaryCount = total - selection.count;
      const ordinary = ordinaryCount
        ? new THREE.InstancedMesh(
            this.geometry,
            material(object.color, selection.count > 0),
            ordinaryCount,
          )
        : null;
      const selected = selection.count
        ? new THREE.InstancedMesh(
            this.geometry,
            material(object.highlightColor, false),
            selection.count,
          )
        : null;
      if (ordinary) group.add(ordinary);
      if (selected) group.add(selected);
      quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        object.shape.length < 3 ? FLAT_ROTATION : 0,
      );
      let ordinaryIndex = 0,
        selectedIndex = 0;
      for (let index = 0; index < total; index++) {
        position.set(
          ...layout.cellPosition(indexFromLinear(index, object.shape)),
        );
        matrix.compose(position, quaternion, scale);
        if (selection.mask[index])
          selected.setMatrixAt(selectedIndex++, matrix);
        else ordinary.setMatrixAt(ordinaryIndex++, matrix);
      }
      for (const mesh of [ordinary, selected])
        if (mesh) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
        }
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
      label.addEventListener("click", () => this.onSelect?.(object.id));
      this.labels.append(label);
      const labelPoint = new THREE.Vector3(...UP)
        .multiplyScalar(-layout.height / 2 - 0.65)
        .add(offset);
      this.entries.push({
        id: object.id,
        group,
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
    if (geometryChanged) this.reset();
    else this.requestRender();
  }

  setActive(id) {
    for (const entry of this.entries)
      entry.label.classList.toggle("active", entry.id === id);
  }

  fit(bounds, resetDirection = false) {
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
    const inverse = this.camera.matrixWorldInverse;
    let maxX = 0,
      maxY = 0;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).applyMatrix4(inverse);
          maxX = Math.max(maxX, Math.abs(corner.x));
          maxY = Math.max(maxY, Math.abs(corner.y));
        }
    const aspect =
      Math.max(1, this.container.clientWidth) /
      Math.max(1, this.container.clientHeight);
    this.halfHeight = Math.max(1.6, maxY, maxX / aspect) * 1.65;
    this.camera.left = -this.halfHeight * aspect;
    this.camera.right = this.halfHeight * aspect;
    this.camera.top = this.halfHeight;
    this.camera.bottom = -this.halfHeight;
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.onZoom?.(1);
    this.requestRender();
  }

  reset() {
    this.focusedId = null;
    this.fit(
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
      this.fit(entry.bounds);
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
    if (this.bounds) {
      const zoom = this.camera.zoom;
      const bounds =
        this.entries.find((e) => e.id === this.focusedId)?.bounds ||
        this.bounds;
      this.fit(bounds);
      this.camera.zoom = zoom;
      this.camera.updateProjectionMatrix();
    }
    this.requestRender();
  }
}
