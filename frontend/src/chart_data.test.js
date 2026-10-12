import test from "node:test";
import assert from "node:assert/strict";

import { getEnergySeries, getRevenueSeries } from "./chart_data.js";

const huawei = {
  source: "huawei",
  name: "Huawei Site",
  daily_power_5min: {
    date: "2026-08-03 00:00:00",
    x: ["00:00", "00:05", "00:10"],
    generation_power_kw: [0, 1.2, null],
  },
  revenue_charts: {
    daily: { labels: ["01", "02", "03", "04", "05"], values: [100, 120, 130, null, null] },
    monthly: { labels: ["01", "02", "03"], values: [2000, 2300, null] },
    yearly: { labels: ["2025", "2026"], values: [18000, 4300] },
  },
};

const kehua = {
  source: "kehua",
  name: "Kehua Site",
  income_currency: "¥",
  site: {
    charts: {
      daily_generation: { x: ["00:00", "01:00"], y: [0, 0.4] },
      company_power_trends: {
        month_daily: {
          unit: "kWh",
          series: {
            "2026-06": { x: ["1", "2", "3"], y: { y_data: [58.1, 63, 68.8] } },
          },
        },
        year_monthly: {
          unit: "MWh",
          series: {
            "2026": { x: ["1", "2", "3"], y: { y_data: [1.2, 1.18, 1.77] } },
          },
        },
      },
    },
  },
};

test("selects Huawei intraday power without mixing aggregate energy totals", () => {
  const series = getEnergySeries(huawei, "today");

  assert.equal(series.available, true);
  assert.equal(series.unit, "kW");
  assert.equal(series.kind, "bar");
  assert.deepEqual(series.labels, ["00:00", "00:05", "00:10"]);
  assert.deepEqual(series.values, [0, 1.2, null]);
});

test("reports unavailable Huawei monthly energy instead of inventing a graph", () => {
  const series = getEnergySeries(huawei, "month");

  assert.equal(series.available, false);
  assert.match(series.reason, /monthly energy history/i);
});

test("uses Huawei energy-balance history and removes only future placeholders", () => {
  const location = {
    ...huawei,
    energy_charts: {
      daily: { labels: ["01", "02", "03", "04"], values: [64.67, 62.14, 60.4, null] },
      monthly: { labels: ["01", "02", "03", "04"], values: [2084.12, 1990.17, 2814.79, null] },
    },
  };

  assert.deepEqual(getEnergySeries(location, "month").values, [64.67, 62.14, 60.4]);
  assert.deepEqual(getEnergySeries(location, "year").values, [2084.12, 1990.17, 2814.79]);
});

test("selects Kehua daily, monthly, and yearly energy series", () => {
  assert.deepEqual(getEnergySeries(kehua, "today").values, [0, 0.4]);
  assert.deepEqual(getEnergySeries(kehua, "month").values, [58.1, 63, 68.8]);
  assert.deepEqual(getEnergySeries(kehua, "year").values, [1.2, 1.18, 1.77]);
  assert.equal(getEnergySeries(kehua, "year").unit, "MWh");
});

test("prefers the selected Kehua station's account-specific charts", () => {
  const location = {
    ...kehua,
    charts: {
      daily_generation: { x: ["00:00", "01:00"], y: [0, 2.5] },
    },
  };

  assert.deepEqual(getEnergySeries(location, "today").values, [0, 2.5]);
});

test("maps Huawei revenue periods to daily, monthly, and yearly vendor series", () => {
  assert.deepEqual(getRevenueSeries(huawei, "month").values, [100, 120, 130]);
  assert.deepEqual(getRevenueSeries(huawei, "month").labels, ["01", "02", "03"]);
  assert.deepEqual(getRevenueSeries(huawei, "year").values, [2000, 2300, null]);
  assert.deepEqual(getRevenueSeries(huawei, "lifetime").values, [18000, 4300]);
});

test("calculates Kehua revenue series automatically at Rp 900/kWh", () => {
  const seriesYear = getRevenueSeries(kehua, "year");
  assert.equal(seriesYear.available, true);
  assert.equal(seriesYear.unit, "IDR");
  // 1.2 MWh * 900,000 = 1,080,000, 1.18 MWh * 900,000 = 1,062,000, 1.77 MWh * 900,000 = 1,593,000
  assert.deepEqual(seriesYear.values, [1080000, 1062000, 1593000]);
  assert.deepEqual(seriesYear.labels, ["1", "2", "3"]);
  assert.match(seriesYear.caption, /Rp 900\/kWh/);

  const seriesMonth = getRevenueSeries(kehua, "month");
  assert.equal(seriesMonth.available, true);
  assert.equal(seriesMonth.unit, "IDR");
  // 58.1 kWh * 900 = 52,290, 63 kWh * 900 = 56,700, 68.8 kWh * 900 = 61,920
  assert.deepEqual(seriesMonth.values, [52290, 56700, 61920]);
  assert.deepEqual(seriesMonth.labels, ["1", "2", "3"]);
  assert.match(seriesMonth.caption, /Rp 900\/kWh/);
});

