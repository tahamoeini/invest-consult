const DAY_MS = 24 * 60 * 60 * 1000;

export const HISTORY_RANGE_DAYS = Object.freeze({
  "1m": 30,
  "6m": 183,
  "1y": 365,
  all: null,
});

function timestamp(value) {
  if (typeof value === "number" || (typeof value === "string" && /^\d{10,13}$/.test(value.trim()))) {
    const numeric = Number(value);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  return new Date(value).getTime();
}

function dayKey(value) {
  const time = timestamp(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

export function normalizeObservedHistory(points, defaultSource = "Unknown source") {
  const byDay = new Map();
  (Array.isArray(points) ? points : []).forEach((point) => {
    const dateValue = Array.isArray(point)
      ? point[0]
      : point?.date ?? point?.time ?? point?.timestamp ?? point?.t;
    const priceValue = Array.isArray(point)
      ? point[1]
      : point?.value ?? point?.price ?? point?.close ?? point?.c;
    const time = timestamp(dateValue);
    const value = Number(priceValue);
    if (!Number.isFinite(time) || !Number.isFinite(value) || value <= 0) return;
    const date = new Date(time).toISOString();
    byDay.set(date.slice(0, 10), {
      date,
      value,
      source: String(point?.source || defaultSource),
      currency: point?.currency || null,
      conversion: point?.conversion || null,
    });
  });
  return [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function filterHistoryRange(points, range = "all", now = Date.now()) {
  const days = HISTORY_RANGE_DAYS[range];
  if (days === undefined) return [];
  const end = timestamp(now);
  if (!Number.isFinite(end) || days === null) return points.slice();
  const start = end - days * DAY_MS;
  return points.filter((point) => {
    const time = timestamp(point.date);
    return Number.isFinite(time) && time >= start && time <= end;
  });
}

export function convertUsdHistoryToToman(usdPoints, dollarPoints) {
  const dollarByDay = new Map(normalizeObservedHistory(dollarPoints).map((point) => [dayKey(point.date), point]));
  let missingFxCount = 0;
  const points = normalizeObservedHistory(usdPoints).flatMap((point) => {
    const dollar = dollarByDay.get(dayKey(point.date));
    if (!dollar) {
      missingFxCount += 1;
      return [];
    }
    return [{
      ...point,
      value: point.value * dollar.value,
      currency: "TOMAN",
      conversion: {
        formula: "USD × USD/TOMAN",
        dollarSource: dollar.source,
        dollarObservedAt: dollar.date,
      },
    }];
  });
  return { points, missingFxCount };
}

function metricForSeries(points, windowDays) {
  if (points.length < 2) return { periodReturn: null, annualizedReturn: null, maxDrawdown: null, coverage: 0, observations: points.length };
  const first = points[0];
  const last = points.at(-1);
  const elapsedDays = (timestamp(last.date) - timestamp(first.date)) / DAY_MS;
  let peak = first.value;
  let maxDrawdown = 0;
  points.forEach((point) => {
    peak = Math.max(peak, point.value);
    maxDrawdown = Math.min(maxDrawdown, point.value / peak - 1);
  });
  const periodReturn = last.value / first.value - 1;
  const annualizedReturn = elapsedDays > 0 && periodReturn > -1
    ? Math.pow(last.value / first.value, 365.25 / elapsedDays) - 1
    : null;
  return {
    periodReturn,
    annualizedReturn: Number.isFinite(annualizedReturn) ? annualizedReturn : null,
    maxDrawdown,
    coverage: windowDays > 0 ? Math.min(1, points.length / windowDays) : 0,
    observations: points.length,
  };
}

export function prepareComparableHistory(assets, range = "all", now = Date.now()) {
  const available = Object.entries(assets || {}).map(([id, asset]) => ({
    id,
    ...asset,
    points: normalizeObservedHistory(asset?.points, asset?.source || "Unknown source"),
  })).filter((asset) => asset.points.length >= 2);
  if (!available.length) return { from: null, to: null, days: 0, series: [], metrics: [] };

  const nowTime = timestamp(now);
  const requestedDays = HISTORY_RANGE_DAYS[range];
  const requestedStart = requestedDays === null ? -Infinity : nowTime - requestedDays * DAY_MS;
  const sharedStart = Math.max(requestedStart, ...available.map((asset) => timestamp(asset.points[0].date)));
  const sharedEnd = Math.min(nowTime, ...available.map((asset) => timestamp(asset.points.at(-1).date)));
  if (!Number.isFinite(sharedStart) || !Number.isFinite(sharedEnd) || sharedEnd <= sharedStart) {
    return { from: null, to: null, days: 0, series: [], metrics: [] };
  }

  const from = new Date(sharedStart).toISOString();
  const to = new Date(sharedEnd).toISOString();
  const windowDays = Math.max(1, Math.floor((sharedEnd - sharedStart) / DAY_MS) + 1);
  const dateSet = new Set();
  const trimmed = available.map((asset) => {
    const points = asset.points.filter((point) => {
      const time = timestamp(point.date);
      if (time < sharedStart || time > sharedEnd) return false;
      dateSet.add(dayKey(point.date));
      return true;
    });
    return { ...asset, points };
  }).filter((asset) => asset.points.length >= 2);
  const dates = [...dateSet].sort();
  const metrics = [];
  const series = trimmed.map((asset) => {
    const base = asset.points[0].value;
    const byDay = new Map(asset.points.map((point) => [dayKey(point.date), point]));
    const values = dates.map((date) => {
      const point = byDay.get(date);
      return {
        date,
        label: date,
        value: point ? point.value / base * 100 : null,
      };
    });
    const metric = metricForSeries(asset.points, windowDays);
    metrics.push({ id: asset.id, name: asset.name || asset.id, ...metric });
    return { id: asset.id, name: asset.name || asset.id, color: asset.color, points: values };
  });
  return { from, to, days: windowDays, series, metrics };
}
