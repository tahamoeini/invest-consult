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
    const dateValue = Array.isArray(point) ? point[0] : (point?.date ?? point?.time ?? point?.timestamp ?? point?.t);
    const priceValue = Array.isArray(point) ? point[1] : (point?.value ?? point?.price ?? point?.close ?? point?.c);
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

export function filterHistoryRange(points, range = "all", now = Date.now(), bounds = {}) {
  const days = HISTORY_RANGE_DAYS[range];
  if (days === undefined) return [];
  const end = timestamp(now);
  const boundedStart = bounds.start ? timestamp(`${bounds.start}T00:00:00.000Z`) : null;
  const boundedEnd = bounds.end ? timestamp(`${bounds.end}T23:59:59.999Z`) : null;
  const start = Number.isFinite(boundedStart) ? boundedStart : days === null ? -Infinity : end - days * DAY_MS;
  const finish = Number.isFinite(boundedEnd) ? Math.min(boundedEnd, end) : end;
  return points.filter((point) => {
    const time = timestamp(point.date);
    return Number.isFinite(time) && time >= start && time <= finish;
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
    return [
      {
        ...point,
        value: point.value * dollar.value,
        currency: "TOMAN",
        conversion: {
          formula: "USD × USD/TOMAN",
          dollarSource: dollar.source,
          dollarObservedAt: dollar.date,
        },
      },
    ];
  });
  return { points, missingFxCount };
}

function metricForSeries(points, windowDays) {
  if (points.length < 2)
    return { periodReturn: null, annualizedReturn: null, maxDrawdown: null, coverage: 0, observations: points.length };
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
  const annualizedReturn =
    elapsedDays > 0 && periodReturn > -1 ? Math.pow(last.value / first.value, 365.25 / elapsedDays) - 1 : null;
  return {
    periodReturn,
    annualizedReturn: Number.isFinite(annualizedReturn) ? annualizedReturn : null,
    maxDrawdown,
    coverage: windowDays > 0 ? Math.min(1, points.length / windowDays) : 0,
    observations: points.length,
  };
}

export function prepareComparableHistory(assets, range = "all", now = Date.now()) {
  const available = Object.entries(assets || {})
    .map(([id, asset]) => ({
      id,
      ...asset,
      points: normalizeObservedHistory(asset?.points, asset?.source || "Unknown source"),
    }))
    .filter((asset) => asset.points.length >= 2);
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
  const trimmed = available
    .map((asset) => {
      const points = asset.points.filter((point) => {
        const time = timestamp(point.date);
        if (time < sharedStart || time > sharedEnd) return false;
        dateSet.add(dayKey(point.date));
        return true;
      });
      return { ...asset, points };
    })
    .filter((asset) => asset.points.length >= 2);
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
        value: point ? (point.value / base) * 100 : null,
      };
    });
    const metric = metricForSeries(asset.points, windowDays);
    metrics.push({ id: asset.id, name: asset.name || asset.id, ...metric });
    return { id: asset.id, name: asset.name || asset.id, color: asset.color, points: values };
  });
  return { from, to, days: windowDays, series, metrics };
}

function historicalRiskMetrics(points) {
  if (points.length < 2)
    return { annualizedVolatility: null, maxDrawdown: null, cvar95: null, observationCount: points.length };
  const simpleReturns = [];
  const logReturns = [];
  let elapsedDays = 0;
  let peak = points[0].value;
  let maxDrawdown = 0;
  points.forEach((point, index) => {
    peak = Math.max(peak, point.value);
    maxDrawdown = Math.min(maxDrawdown, point.value / peak - 1);
    if (!index) return;
    const previous = points[index - 1];
    const gapDays = Math.max(1 / 24, (timestamp(point.date) - timestamp(previous.date)) / DAY_MS);
    const simple = point.value / previous.value - 1;
    if (Number.isFinite(simple) && simple > -1) {
      simpleReturns.push(simple);
      logReturns.push(Math.log1p(simple));
      elapsedDays += gapDays;
    }
  });
  const averageGapDays = logReturns.length ? elapsedDays / logReturns.length : 0;
  const averageLogReturn = logReturns.length
    ? logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length
    : 0;
  const variance =
    logReturns.length > 1
      ? logReturns.reduce((sum, value) => sum + (value - averageLogReturn) ** 2, 0) / (logReturns.length - 1)
      : null;
  const annualizedVolatility =
    Number.isFinite(variance) && averageGapDays > 0 ? Math.sqrt((variance * 365.25) / averageGapDays) : null;
  const tailCount = Math.max(1, Math.ceil(simpleReturns.length * 0.05));
  const worstReturns = simpleReturns
    .slice()
    .sort((left, right) => left - right)
    .slice(0, tailCount);
  const cvar95 = worstReturns.length
    ? -worstReturns.reduce((sum, value) => sum + value, 0) / worstReturns.length
    : null;
  return {
    annualizedVolatility: Number.isFinite(annualizedVolatility) ? annualizedVolatility : null,
    maxDrawdown,
    cvar95: Number.isFinite(cvar95) ? Math.max(0, cvar95) : null,
    observationCount: points.length,
  };
}

export function prepareHistoricalAnalysis(assets, options = {}) {
  const nowTime = timestamp(options.now ?? Date.now());
  const rangeDays = HISTORY_RANGE_DAYS[options.range || "all"];
  const endBound = options.end ? timestamp(`${options.end}T23:59:59.999Z`) : nowTime;
  const startBound = options.start
    ? timestamp(`${options.start}T00:00:00.000Z`)
    : rangeDays === null
      ? -Infinity
      : endBound - rangeDays * DAY_MS;
  const mode = options.mode === "price" ? "price" : "return";
  const currency = options.currency === "USD" ? "USD" : "TOMAN";
  const fxByDay = new Map(
    normalizeObservedHistory(options.fxPoints || []).map((point) => [dayKey(point.date), point.value]),
  );
  const available = Object.entries(assets || {})
    .map(([id, asset]) => {
      let points = normalizeObservedHistory(asset?.points, asset?.source || "Unknown source");
      points = points.filter((point) => {
        const time = timestamp(point.date);
        return Number.isFinite(time) && time >= startBound && time <= endBound;
      });
      if (currency === "USD" && id !== "dollar" && id !== "bourseIndex") {
        points = points.flatMap((point) => {
          const fx = fxByDay.get(dayKey(point.date));
          return Number.isFinite(fx) && fx > 0 ? [{ ...point, value: point.value / fx, currency: "USD" }] : [];
        });
      }
      return { id, ...asset, points };
    })
    .filter((asset) => asset.points.length >= 2);
  const series = available.map((asset) => {
    const base = asset.points[0].value;
    const points = asset.points.map((point) => ({
      ...point,
      value: mode === "return" ? (point.value / base - 1) * 100 : point.value,
    }));
    return { id: asset.id, name: asset.name || asset.id, color: asset.color, points };
  });
  const metrics = available.map((asset) => {
    const first = asset.points[0];
    const last = asset.points.at(-1);
    const elapsedDays = (timestamp(last.date) - timestamp(first.date)) / DAY_MS;
    const periodReturn = last.value / first.value - 1;
    const risk = historicalRiskMetrics(asset.points);
    return {
      id: asset.id,
      name: asset.name || asset.id,
      from: first.date,
      to: last.date,
      elapsedDays,
      periodReturn,
      annualizedReturn:
        elapsedDays >= 365.25 && periodReturn > -1
          ? Math.pow(last.value / first.value, 365.25 / elapsedDays) - 1
          : null,
      ...risk,
      coverage: Math.min(1, asset.points.length / Math.max(2, elapsedDays)),
      currency: currency === "USD" && asset.id !== "dollar" && asset.id !== "bourseIndex" ? "USD" : "TOMAN",
    };
  });
  const volatilities = metrics
    .map((metric) => metric.annualizedVolatility)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  metrics.forEach((metric) => {
    if (!Number.isFinite(metric.annualizedVolatility) || !volatilities.length) metric.riskLevel = null;
    else {
      const rank =
        volatilities.filter((value) => value < metric.annualizedVolatility).length / Math.max(1, volatilities.length);
      metric.riskLevel = rank < 1 / 3 ? "low" : rank < 2 / 3 ? "medium" : "high";
    }
  });
  const dates = available.flatMap((asset) => asset.points.map((point) => point.date)).sort();
  const from = dates[0] || null;
  const to = dates.at(-1) || null;
  const days = from && to ? Math.max(0, Math.ceil((timestamp(to) - timestamp(from)) / DAY_MS)) : 0;
  return { from, to, days, series, metrics };
}
