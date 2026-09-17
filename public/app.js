import { TensorViewer } from "./viewer.js";
import {
  parseShape,
  formatShape,
  elementCount,
  selectRegion,
  examplesFor,
} from "./tensor.js";

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  cube: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2.5 8M3 4v6h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  selection:
    '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
const $ = (id) => document.getElementById(id);
const admin = /^\/admin\/?$/.test(location.pathname);
document.body.classList.toggle("admin", admin);
$("admin-panel").hidden = !admin;
$(admin ? "admin-link" : "display-link").setAttribute("aria-current", "page");
if (admin) {
  document.title = "SpaceMatrix · 对象管理";
  $("page-name").textContent = "对象管理";
  $("stage-eyebrow").textContent = "LIVE PREVIEW";
  $("stage-title").textContent = "场景预览";
}
let scene = { revision: -1, objects: [] };
let activeId = null;
let isNew = false;
let dirty = false;
let saving = false;
let viewer;
let toastTimer;

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.toggle("error", error);
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4000);
}

try {
  viewer = new TensorViewer($("canvas"), {
    onSelect: (id) => activate(id, true),
    onZoom: (zoom) =>
      ($("zoom-value").textContent = `${Math.round(zoom * 100)}%`),
  });
} catch (error) {
  $("loading-state").textContent =
    "无法创建三维画布，请启用浏览器硬件加速后刷新。";
  console.error(error);
}

function button(className, title, contents) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.title = title;
  el.innerHTML = contents;
  return el;
}
function activeObject() {
  return scene.objects.find((o) => o.id === activeId);
}

function updateInfo(object = activeObject()) {
  $("info-card").hidden = !object;
  $("axis-note").hidden = !object || object.shape.length < 3;
  if (!object) return;
  $("info-name").textContent = object.name;
  $("info-dimension").textContent = `${object.shape.length}D`;
  $("info-shape").textContent = formatShape(object.shape);
  $("info-count").textContent = elementCount(object.shape).toLocaleString();
  $("selection-info").hidden = !object.highlight;
  $("selection-expression").textContent = object.highlight;
  $("selection-expression").title = object.highlight;
  $("selection-count").textContent = selectRegion(
    object.shape,
    object.highlight,
  ).count.toLocaleString();
  $("selection-swatch").style.background = object.highlightColor;
}

function renderLists() {
  $("object-list").replaceChildren();
  $("object-tabs").replaceChildren();
  $("object-count").textContent = scene.objects.length;
  for (const object of scene.objects) {
    const item = button(
      `object-item${object.id === activeId && !isNew ? " active" : ""}`,
      `编辑 ${object.name}`,
      `<span class="object-thumbnail">${icon("cube")}</span><span class="object-item-text"><span class="object-item-name"></span><span class="object-item-shape"></span></span>${icon("chevron")}`,
    );
    item.querySelector(".object-item-name").textContent = object.name;
    item.querySelector(".object-item-shape").textContent = formatShape(
      object.shape,
    );
    item.setAttribute("aria-pressed", String(object.id === activeId && !isNew));
    item.addEventListener("click", () => activate(object.id, true));
    $("object-list").append(item);
    const tab = button(
      `object-tab${object.id === activeId ? " active" : ""}`,
      `聚焦 ${object.name}`,
      `${icon("cube")}<span class="tab-name"></span>`,
    );
    tab.querySelector(".tab-name").textContent = object.name;
    tab.setAttribute("aria-pressed", String(object.id === activeId));
    tab.addEventListener("click", () => activate(object.id, true));
    $("object-tabs").append(tab);
  }
  viewer?.setActive(activeId);
}

function markDirty(value) {
  dirty = value;
  $("save-indicator").textContent = value ? "未保存" : "";
  $("save-hint").textContent = value
    ? "预览尚未保存 · 点击保存同步到展示页"
    : "保存后自动同步到展示页";
}

function fillForm(object) {
  $("object-form").hidden = !object;
  $("admin-empty").hidden = Boolean(object);
  if (!object) return;
  $("object-name").value = object.name;
  $("object-shape").value = object.shape.join(", ");
  $("object-color").value = object.color;
  $("object-highlight").value = object.highlight;
  $("highlight-color").value = object.highlightColor;
  $("form-title").textContent = isNew ? "新建对象" : "对象设置";
  $("save-label").textContent = isNew ? "添加到场景" : "保存修改";
  $("delete-object").hidden = isNew;
  $("form-error").hidden = true;
  markDirty(false);
  updateExamples(object.shape);
}

function updateExamples(shape) {
  $("rank-badge").textContent = `${shape.length}D`;
  document
    .querySelectorAll("[data-shape]")
    .forEach((el) =>
      el.classList.toggle(
        "active",
        parseShape(el.dataset.shape).length === shape.length,
      ),
    );
  $("example-list").replaceChildren();
  for (const example of examplesFor(shape)) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = example;
    el.addEventListener("click", () => {
      $("object-highlight").value = example;
      previewDraft();
    });
    $("example-list").append(el);
  }
}

function activate(id, focus = false) {
  if (saving) return;
  if (dirty && !window.confirm("当前修改尚未保存，要放弃修改并切换对象吗？"))
    return;
  activeId = id;
  isNew = false;
  markDirty(false);
  viewer?.setObjects(scene.objects);
  renderLists();
  updateInfo();
  if (admin) fillForm(activeObject());
  if (focus) viewer?.focus(id);
}

function acceptScene(next, force = false) {
  if (next.revision < scene.revision) return;
  if (next.revision === scene.revision && !force) return;
  scene = next;
  if (!scene.objects.some((o) => o.id === activeId)) {
    activeId = scene.objects[0]?.id ?? null;
    if (!isNew) markDirty(false);
  }
  if (viewer) $("loading-state").hidden = true;
  $("stage-empty").hidden = scene.objects.length > 0 || isNew;
  // An incoming event must not erase an unsaved admin draft.
  if (admin && dirty) {
    renderLists();
    previewDraft();
    return;
  }
  viewer?.setObjects(scene.objects);
  renderLists();
  updateInfo();
  if (admin && !isNew) fillForm(activeObject());
}

function readDraft() {
  const shape = parseShape($("object-shape").value);
  const highlight = $("object-highlight").value.trim();
  selectRegion(shape, highlight);
  return {
    name: $("object-name").value.trim(),
    shape,
    color: $("object-color").value,
    highlight,
    highlightColor: $("highlight-color").value,
  };
}

let previewTimer;
function previewDraft() {
  if (!admin) return;
  markDirty(true);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    try {
      const object = { id: isNew ? "draft" : activeId, ...readDraft() };
      const objects = isNew
        ? [...scene.objects, object]
        : scene.objects.map((o) => (o.id === activeId ? object : o));
      viewer?.setObjects(objects);
      viewer?.setActive(object.id);
      updateInfo(object);
      updateExamples(object.shape);
      $("stage-empty").hidden = true;
      $("form-error").hidden = true;
    } catch (error) {
      $("form-error").textContent = error.message;
      $("form-error").hidden = false;
    }
  }, 180);
}

async function request(url, method, value) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败，请重试。");
  return data;
}
function setSaving(value) {
  saving = value;
  $("save-object").disabled = value;
  $("delete-object").disabled = value;
  $("add-object").disabled = value;
  $("confirm-delete").disabled = value;
}

function addObject() {
  if (saving) return;
  if (dirty && !window.confirm("当前修改尚未保存，要放弃修改并创建对象吗？"))
    return;
  isNew = true;
  const names = new Set(scene.objects.map((o) => o.name));
  let number = scene.objects.length + 1;
  while (names.has(`tensor_${String(number).padStart(2, "0")}`)) number++;
  fillForm({
    name: `tensor_${String(number).padStart(2, "0")}`,
    shape: [3, 3, 3],
    color: "#bbc6de",
    highlight: "",
    highlightColor: "#6662e8",
  });
  renderLists();
  previewDraft();
  $("object-name").focus();
  $("object-name").select();
}
$("add-object").addEventListener("click", addObject);
$("create-first").addEventListener("click", addObject);
$("object-form").addEventListener("input", previewDraft);
document.querySelectorAll("[data-shape]").forEach((el) =>
  el.addEventListener("click", () => {
    $("object-shape").value = el.dataset.shape;
    $("object-highlight").value = "";
    previewDraft();
  }),
);
$("clear-highlight").addEventListener("click", () => {
  $("object-highlight").value = "";
  previewDraft();
});
$("object-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving) return;
  clearTimeout(previewTimer);
  try {
    const draft = readDraft();
    setSaving(true);
    const creating = isNew;
    const next = await request(
      creating ? "/api/objects" : `/api/objects/${activeId}`,
      creating ? "POST" : "PATCH",
      draft,
    );
    if (creating) activeId = next.objects.at(-1).id;
    isNew = false;
    markDirty(false);
    clearTimeout(previewTimer);
    acceptScene(next, true);
    toast(creating ? "对象已添加，展示页已同步" : "修改已保存，展示页已同步");
  } catch (error) {
    $("form-error").textContent = error.message;
    $("form-error").hidden = false;
  } finally {
    setSaving(false);
  }
});
$("delete-object").addEventListener("click", () => {
  const object = activeObject();
  if (!object) return;
  $("delete-description").textContent =
    `“${object.name}”将从场景中删除，展示页也会同步移除。`;
  $("delete-dialog").showModal();
});
$("cancel-delete").addEventListener("click", () => $("delete-dialog").close());
$("confirm-delete").addEventListener("click", async () => {
  if (saving) return;
  setSaving(true);
  clearTimeout(previewTimer);
  try {
    const next = await request(`/api/objects/${activeId}`, "DELETE");
    isNew = false;
    markDirty(false);
    clearTimeout(previewTimer);
    acceptScene(next, true);
    $("delete-dialog").close();
    toast("对象已删除");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setSaving(false);
  }
});
$("zoom-in").addEventListener("click", () => viewer?.zoom(1.2));
$("zoom-out").addEventListener("click", () => viewer?.zoom(1 / 1.2));
$("reset-view").addEventListener("click", () => viewer?.reset());
$("fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("stage").requestFullscreen();
  } catch {
    toast("当前浏览器不支持全屏，可以使用浏览器的全屏功能。");
  }
});
document.addEventListener("fullscreenchange", () =>
  $("fullscreen").setAttribute(
    "aria-label",
    document.fullscreenElement ? "退出全屏" : "全屏展示",
  ),
);
window.addEventListener("beforeunload", (event) => {
  if (admin && dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

async function load() {
  try {
    const response = await fetch("/api/scene");
    if (!response.ok) throw new Error("读取场景失败");
    acceptScene(await response.json());
  } catch {
    $("loading-state").hidden = false;
    $("loading-state").textContent = "暂时无法连接服务器，正在重试…";
  }
}
load();
const events = new EventSource("/api/events");
events.addEventListener("scene", (event) => {
  try {
    acceptScene(JSON.parse(event.data));
  } catch (error) {
    console.error(error);
    toast("场景更新失败，请刷新页面。", true);
  }
});
events.onopen = () => {
  $("connection").textContent = "已同步";
  $("connection").classList.remove("offline");
};
events.onerror = () => {
  $("connection").textContent = "连接中断 · 自动重连";
  $("connection").classList.add("offline");
};
