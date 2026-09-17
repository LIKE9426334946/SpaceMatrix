// Python-style basic indexing only. Input is parsed, never executed.
export const MAX_DIMENSION = 20;
export const formatShape = (shape) =>
  `(${shape.join(", ")}${shape.length === 1 ? "," : ""})`;
export const elementCount = (shape) => shape.reduce((a, b) => a * b, 1);

export function parseShape(input) {
  let shape = input;
  if (typeof input === "string") {
    let value = input.trim();
    if (
      (value.startsWith("(") && value.endsWith(")")) ||
      (value.startsWith("[") && value.endsWith("]"))
    )
      value = value.slice(1, -1);
    const parts = value
      .replace(/[,，]\s*$/, "")
      .split(/[,，x×\s]+/i)
      .filter(Boolean);
    if (!parts.every((p) => /^\d+$/.test(p)))
      throw new Error("形状请使用整数，例如 3, 3, 3。");
    shape = parts.map(Number);
  }
  if (
    !Array.isArray(shape) ||
    shape.length < 1 ||
    shape.length > 4 ||
    !shape.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_DIMENSION)
  ) {
    throw new Error("支持 1–4 个维度，每个维度为 1–20。");
  }
  return [...shape];
}

function integer(text) {
  if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new Error(`“${text}”不是有效整数。`);
  return Number(text);
}

function axisIndices(token, size) {
  if (!token.includes(":")) {
    let index = integer(token);
    if (index < 0) index += size;
    if (index < 0 || index >= size)
      throw new Error(`索引 ${token} 越界：这个维度的长度是 ${size}。`);
    return [index];
  }
  const parts = token.split(":");
  if (parts.length > 3) throw new Error("切片格式为 start:stop:step。");
  const step = parts[2] ? integer(parts[2]) : 1;
  if (step === 0) throw new Error("切片的步长不能为 0。");
  const bound = (value, fallback) => {
    if (!value) return fallback;
    let n = integer(value);
    if (n < 0) n += size;
    return step > 0
      ? Math.max(0, Math.min(size, n))
      : Math.max(-1, Math.min(size - 1, n));
  };
  const start = bound(parts[0], step > 0 ? 0 : size - 1);
  const stop = bound(parts[1], step > 0 ? size : -1);
  const indices = [];
  for (let i = start; step > 0 ? i < stop : i > stop; i += step)
    indices.push(i);
  return indices;
}

export function selectRegion(shape, expression = "") {
  const total = elementCount(shape);
  const mask = new Uint8Array(total);
  if (!expression.trim()) return { mask, count: 0, total };
  if (expression.length > 1000) throw new Error("索引表达式过长。");
  const regions = expression.split(";").map((r) => r.trim());
  if (regions.length > 16 || regions.some((r) => !r))
    throw new Error("用分号分隔区域，最多 16 个区域。");
  let count = 0;
  for (const region of regions) {
    const wrapped = region.match(/^(?:[A-Za-z_]\w*)?\s*\[([^\[\]]*)\]$/);
    let body = wrapped ? wrapped[1] : region;
    body = body.replace(/\s/g, "").replace(/,$/, "");
    if (!body || /[\[\]]/.test(body))
      throw new Error("请输入有效索引，例如 a[0, :, :]。");
    let tokens = body.split(",");
    const ellipses = tokens.filter((t) => t === "...").length;
    if (ellipses > 1) throw new Error("一个区域只能使用一个省略号。");
    const explicit = tokens.length - ellipses;
    if (explicit > shape.length)
      throw new Error(`这个对象只有 ${shape.length} 个维度。`);
    if (ellipses)
      tokens = tokens.flatMap((t) =>
        t === "..." ? Array(shape.length - explicit).fill(":") : [t],
      );
    else while (tokens.length < shape.length) tokens.push(":");
    const axes = tokens.map((token, d) => axisIndices(token, shape[d]));
    const visit = (dimension, offset) => {
      if (dimension === shape.length) {
        if (!mask[offset]) {
          mask[offset] = 1;
          count++;
        }
        return;
      }
      for (const index of axes[dimension])
        visit(dimension + 1, offset * shape[dimension] + index);
    };
    visit(0, 0);
  }
  return { mask, count, total };
}

export function indexFromLinear(index, shape) {
  const coords = new Array(shape.length);
  for (let d = shape.length - 1; d >= 0; d--) {
    coords[d] = index % shape[d];
    index = Math.floor(index / shape[d]);
  }
  return coords;
}

export function examplesFor(shape) {
  const full = Array(shape.length).fill(":");
  const first = [...full];
  first[0] = "0";
  const alternate = [...full];
  alternate[shape.length - 1] = "::2";
  return [`a[${first.join(", ")}]`, `a[${alternate.join(", ")}]`, "a[-1, ...]"];
}
