import test from "node:test";
import assert from "node:assert/strict";

import { getEnergySeries, getRevenueSeries, getEmissionSeries } from "./chart_data.js";

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
        all_yearly: {
          unit: "MWh",
          series: {
            "all": { x: ["2024", "2025", "2026"], y: { y_data: [12.4, 18.6, 6.2] } },
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
      yearly: { labels: ["2024", "2025", "2026"], values: [18450.2, 22100.5, 9530.1] },
    },
  };

  assert.deepEqual(getEnergySeries(location, "month").values, [64.67, 62.14, 60.4]);
  assert.deepEqual(getEnergySeries(location, "year").values, [2084.12, 1990.17, 2814.79]);
  assert.deepEqual(getEnergySeries(location, "lifetime").values, [18450.2, 22100.5, 9530.1]);
});

test("selects Kehua daily, monthly, yearly, and lifetime energy series", () => {
  assert.deepEqual(getEnergySeries(kehua, "today").values, [0, 0.4]);
  assert.deepEqual(getEnergySeries(kehua, "month").values, [58.1, 63, 68.8]);
  assert.deepEqual(getEnergySeries(kehua, "year").values, [1.2, 1.18, 1.77]);
  assert.equal(getEnergySeries(kehua, "year").unit, "MWh");
  assert.deepEqual(getEnergySeries(kehua, "lifetime").values, [12.4, 18.6, 6.2]);
  assert.equal(getEnergySeries(kehua, "lifetime").unit, "MWh");
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

test("calculates Huawei revenue series automatically when vendor revenue charts are missing", () => {
  const huaweiWithoutRevCharts = {
    ...huawei,
    energy_charts: {
      daily: { labels: ["01", "02", "03"], values: [12, 14, 16] },
    },
    revenue_charts: null,
  };
  const seriesMonth = getRevenueSeries(huaweiWithoutRevCharts, "month");
  assert.equal(seriesMonth.available, true);
  assert.equal(seriesMonth.unit, "IDR");
  assert.deepEqual(seriesMonth.values, [10800, 12600, 14400]); // [12, 14, 16] * 900
  assert.match(seriesMonth.caption, /Rp 900\/kWh/);
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

test("calculates Kehua emission series automatically at 0.85 kg CO2/kWh", () => {
  const seriesYear = getEmissionSeries(kehua, "year");
  assert.equal(seriesYear.available, true);
  assert.equal(seriesYear.unit, "kg CO₂");
  // 1.2 MWh * 850 = 1020, 1.18 MWh * 850 = 1003, 1.77 MWh * 850 = 1504.5
  assert.deepEqual(seriesYear.values, [1020, 1003, 1504.5]);
  assert.deepEqual(seriesYear.labels, ["1", "2", "3"]);
  assert.match(seriesYear.caption, /0.85 kg CO₂\/kWh/);

  const seriesMonth = getEmissionSeries(kehua, "month");
  assert.equal(seriesMonth.available, true);
  assert.equal(seriesMonth.unit, "kg CO₂");
  // 58.1 kWh * 0.85 = 49.4, 63 kWh * 0.85 = 53.6, 68.8 kWh * 0.85 = 58.5
  assert.deepEqual(seriesMonth.values, [49.4, 53.6, 58.5]);
  assert.deepEqual(seriesMonth.labels, ["1", "2", "3"]);
  assert.match(seriesMonth.caption, /0.85 kg CO₂\/kWh/);
});

const sma = {
  source: "sma",
  name: "SMA Site",
  energy_charts: {
    today: { labels: ["00:00", "01:00"], values: [0, 5.2] },
    daily: { labels: ["01", "02"], values: [45.5, 52.1] },
    monthly: { labels: ["Jan", "Feb"], values: [1200, 1350] },
    yearly: { labels: ["2025", "2026"], values: [12500, 14200] },
  },
};

test("selects SMA energy and calculates revenue and emission series", () => {
  const energyToday = getEnergySeries(sma, "today");
  assert.equal(energyToday.available, true);
  assert.deepEqual(energyToday.values, [0, 5.2]);

  const energyMonth = getEnergySeries(sma, "month");
  assert.deepEqual(energyMonth.values, [45.5, 52.1]);

  const revMonth = getRevenueSeries(sma, "month");
  assert.equal(revMonth.available, true);
  assert.deepEqual(revMonth.values, [40950, 46890]);

  const emMonth = getEmissionSeries(sma, "month");
  assert.equal(emMonth.available, true);
  assert.deepEqual(emMonth.values, [38.7, 44.3]);
});

test("supports day and week periods across energy, revenue, and emission", () => {
  const energyDay = getEnergySeries(huawei, "day");
  assert.equal(energyDay.available, true);
  assert.equal(energyDay.unit, "kW");

  const huaweiWithDaily = {
    ...huawei,
    energy_charts: {
      daily: {
        labels: ["01", "02", "03", "04", "05", "06", "07", "08"],
        values: [10, 12, 14, 16, 18, 20, 22, 24],
      },
    },
  };

  const energyWeek = getEnergySeries(huaweiWithDaily, "week");
  assert.equal(energyWeek.available, true);
  assert.equal(energyWeek.values.length, 7);
  assert.deepEqual(energyWeek.values, [12, 14, 16, 18, 20, 22, 24]);

  const revWeek = getRevenueSeries(huaweiWithDaily, "week");
  assert.equal(revWeek.available, true);
  // Uses vendor revenue chart [100, 120, 130]
  assert.deepEqual(revWeek.values, [100, 120, 130]);

  // When revenue_charts is missing, calculates from energy at Rp 900/kWh
  const huaweiNoRev = { ...huaweiWithDaily, revenue_charts: null };
  const revWeekCalc = getRevenueSeries(huaweiNoRev, "week");
  assert.equal(revWeekCalc.available, true);
  assert.deepEqual(revWeekCalc.values, [10800, 12600, 14400, 16200, 18000, 19800, 21600]);

  const emWeek = getEmissionSeries(huaweiWithDaily, "week");
  assert.equal(emWeek.available, true);
  assert.deepEqual(emWeek.values, [10.2, 11.9, 13.6, 15.3, 17, 18.7, 20.4]);
});
test("safely handles Kehua array units and generates complete curves from KPIs", () => {
  const realKehuaFromSupabase = {
    source: "kehua",
    name: "IT Del - Gedung 9",
    daily_energy_kwh: 17.2,
    monthly_energy_kwh: 1302.9,
    yearly_energy_kwh: 17140.0,
    cumulative_energy_kwh: 50720.0,
    charts: {
      daily_generation: {
        unit: ["kWh"],
        x: ["00:00", "01:00", "02:00"],
        y: [0, 0, 0],
      },
      monthly_generation: {
        unit: ["kWh"],
        x: ["1", "2", "3"],
        y: [20, 25, 30],
      },
    },
  };

  // 1. Energy
  const energyDay = getEnergySeries(realKehuaFromSupabase, "day");
  assert.equal(energyDay.available, true);
  assert.equal(energyDay.unit, "kWh");

  const energyMonth = getEnergySeries(realKehuaFromSupabase, "month");
  assert.equal(energyMonth.available, true);
  assert.equal(energyMonth.unit, "kWh");

  const energyYear = getEnergySeries(realKehuaFromSupabase, "year");
  assert.equal(energyYear.available, true);
  assert.equal(energyYear.values.length, 12);

  const energyLifetime = getEnergySeries(realKehuaFromSupabase, "lifetime");
  assert.equal(energyLifetime.available, true);
  assert.equal(energyLifetime.values.length, 5);

  // 2. Revenue
  const revDay = getRevenueSeries(realKehuaFromSupabase, "day");
  assert.equal(revDay.available, true);
  assert.equal(revDay.unit, "IDR");

  const revMonth = getRevenueSeries(realKehuaFromSupabase, "month");
  assert.equal(revMonth.available, true);
  assert.equal(revMonth.unit, "IDR");
  assert.deepEqual(revMonth.values, [308610, 385740, 462870]);

  const revYear = getRevenueSeries(realKehuaFromSupabase, "year");
  assert.equal(revYear.available, true);
  assert.equal(revYear.unit, "IDR");
  assert.equal(revYear.values.length, 12);

  const revLifetime = getRevenueSeries(realKehuaFromSupabase, "lifetime");
  assert.equal(revLifetime.available, true);
  assert.equal(revLifetime.unit, "IDR");
  assert.equal(revLifetime.values.length, 5);

  // 3. Emission
  const emDay = getEmissionSeries(realKehuaFromSupabase, "day");
  assert.equal(emDay.available, true);
  assert.equal(emDay.unit, "kg CO₂");

  const emMonth = getEmissionSeries(realKehuaFromSupabase, "month");
  assert.equal(emMonth.available, true);
  assert.equal(emMonth.unit, "kg CO₂");
  assert.deepEqual(emMonth.values, [291.5, 364.3, 437.2]);

  const emYear = getEmissionSeries(realKehuaFromSupabase, "year");
  assert.equal(emYear.available, true);
  assert.equal(emYear.unit, "kg CO₂");

  const emLifetime = getEmissionSeries(realKehuaFromSupabase, "lifetime");
  assert.equal(emLifetime.available, true);
  assert.equal(emLifetime.unit, "kg CO₂");
});
