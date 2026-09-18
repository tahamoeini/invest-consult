// @ts-check

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function lineSegments(points) {
  const segments = [];
  let current = [];
  (Array.isArray(points) ? points : []).forEach((point) => {
    const value = finite(point && point.value);
    if (value === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ ...point, value });
  });
  if (current.length) segments.push(current);
  return segments;
}

function pathFor(points, x, y) {
  return points.map((point, index) => `${index ? "L" : "M"}${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
}

function defaultValueLabel(value) {
  return String(Math.round(Number(value) || 0));
}

/**
 * Return an accessible, dependency-free SVG line chart.
 * Series points use { value, label?, index? }. Null values create visible gaps.
 */
export function lineChartMarkup({
  series = [],
  ariaLabel = "نمودار",
  emptyLabel = "داده کافی برای رسم نمودار وجود ندارد.",
  valueLabel = defaultValueLabel,
  height = 250,
  showDots = true,
} = {}) {
  const normalized = series.map((item) => ({
    ...item,
    points: (Array.isArray(item.points) ? item.points : []).map((point, index) => ({ ...point, index })),
  })).filter((item) => item.points.some((point) => finite(point.value) !== null));
  const allValues = normalized.flatMap((item) => item.points.map((point) => finite(point.value)).filter((value) => value !== null));
  const pointCount = normalized.length ? Math.max(...normalized.map((item) => item.points.length)) : 0;
  if (allValues.length < 2 || pointCount < 2) return `<div class="empty-state chart-empty">${escapeHTML(emptyLabel)}</div>`;

  const width = 760;
  const padding = { top: 18, right: 14, bottom: 34, left: 112 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = Math.max(max - min, Math.abs(max) * 0.02, 1);
  const domainMin = min - range * 0.08;
  const domainMax = max + range * 0.08;
  const x = (index) => padding.left + (pointCount <= 1 ? 0 : index / (pointCount - 1)) * plotWidth;
  const y = (value) => padding.top + (1 - (value - domainMin) / Math.max(domainMax - domainMin, 1)) * plotHeight;
  const grid = [0, 0.5, 1].map((ratio) => {
    const lineY = padding.top + plotHeight * ratio;
    return `<line x1="${padding.left}" y1="${lineY.toFixed(2)}" x2="${width - padding.right}" y2="${lineY.toFixed(2)}" class="chart-grid-line" />`;
  }).join("");
  const axisValues = [domainMax, (domainMax + domainMin) / 2, domainMin];
  const yAxis = axisValues.map((value, index) => {
    const lineY = padding.top + plotHeight * (index / (axisValues.length - 1));
    return `<text x="${padding.left - 9}" y="${(lineY + 4).toFixed(2)}" text-anchor="end" class="chart-axis-label">${escapeHTML(valueLabel(value))}</text>`;
  }).join("");
  const lines = normalized.map((item) => {
    const segments = lineSegments(item.points);
    const paths = segments.map((segment) => `<path d="${pathFor(segment, x, y)}" class="chart-line" stroke="${escapeHTML(item.color || "#126b62")}" />`).join("");
    const dots = showDots ? item.points.filter((point) => finite(point.value) !== null).map((point) => `<circle cx="${x(point.index).toFixed(2)}" cy="${y(point.value).toFixed(2)}" r="3.2" class="chart-dot" fill="${escapeHTML(item.color || "#126b62")}"><title>${escapeHTML(item.name || "")} ${escapeHTML(point.label || "")}: ${escapeHTML(valueLabel(point.value))}</title></circle>`).join("") : "";
    return paths + dots;
  }).join("");
  const firstSeries = normalized.find((item) => item.points.length === pointCount) || normalized.find((item) => item.points.length);
  const labels = [0, Math.floor((pointCount - 1) / 2), pointCount - 1]
    .filter((index, position, array) => index >= 0 && array.indexOf(index) === position)
    .map((index) => {
      const point = firstSeries?.points[index];
      return point ? `<text x="${x(index).toFixed(2)}" y="${height - 8}" text-anchor="${index === 0 ? "start" : index === pointCount - 1 ? "end" : "middle"}" class="chart-axis-label">${escapeHTML(point.label || "")}</text>` : "";
    }).join("");
  const legend = normalized.length > 1 ? `<div class="chart-legend">${normalized.map((item) => `<span><i style="--legend-color:${escapeHTML(item.color || "#126b62")}"></i>${escapeHTML(item.name || "")}</span>`).join("")}</div>` : "";
  return `<div class="line-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(ariaLabel)}" preserveAspectRatio="none"><title>${escapeHTML(ariaLabel)}</title><g>${grid}${yAxis}${lines}${labels}</g></svg>${legend}</div>`;
}

export function donutChartMarkup({
  segments = [],
  ariaLabel = "ترکیب دارایی‌ها",
  emptyLabel = "هنوز دارایی قابل نمایش نیست.",
  centerLabel = "کل سبد",
  centerValue = "—",
} = {}) {
  const valid = segments.map((segment) => ({ ...segment, value: Math.max(0, Number(segment.value) || 0) })).filter((segment) => segment.value > 0);
  const total = valid.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) return `<div class="empty-state chart-empty">${escapeHTML(emptyLabel)}</div>`;
  let cursor = 0;
  const stops = valid.map((segment) => {
    const start = cursor / total * 360;
    cursor += segment.value;
    const end = cursor / total * 360;
    return `${segment.color || "#126b62"} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
  }).join(", ");
  const legend = `<div class="donut-legend">${valid.map((segment) => `<div><span><i style="--legend-color:${escapeHTML(segment.color || "#126b62")}"></i>${escapeHTML(segment.name || "")}</span><strong>${escapeHTML(segment.percentLabel || `${Math.round(segment.value / total * 100)}%`)}</strong></div>`).join("")}</div>`;
  return `<div class="donut-layout"><div class="donut-chart" role="img" aria-label="${escapeHTML(ariaLabel)}" style="--donut-stops:${escapeHTML(stops)}"><div><small>${escapeHTML(centerLabel)}</small><strong>${escapeHTML(centerValue)}</strong></div></div>${legend}</div>`;
}

export function normalizeSeriesIndex(points, fallbackLabel = "") {
  const values = (Array.isArray(points) ? points : []).map((point, index) => ({
    value: finite(point && (point.value ?? point.nominal)),
    label: point?.label || point?.date || fallbackLabel || String(index + 1),
  }));
  const base = values.find((point) => point.value !== null)?.value;
  return base && base !== 0 ? values.map((point) => ({ ...point, value: point.value === null ? null : point.value / base * 100 })) : values.map((point) => ({ ...point, value: null }));
}
