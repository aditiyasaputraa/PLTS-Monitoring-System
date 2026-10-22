function numericValues(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (value === null || value === undefined || value === "" || value === "-") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  });
}

function makeSeries({ labels, values, unit, kind, title, caption, reason }) {
  const safeLabels = Array.isArray(labels) ? labels.map(String) : [];
  const safeValues = numericValues(values);
  const available = safeLabels.length > 0
    && safeLabels.length === safeValues.length
    && safeValues.some((value) => value !== null);

  return {
    available,
    labels: available ? safeLabels : [],
    values: available ? safeValues : [],
    unit,
    kind,
    title,
    caption,
    reason: available ? null : reason,
  };
}

function chartSeries(chart, options) {
  return makeSeries({
    ...options,
    labels: chart?.labels,
    values: chart?.values,
  });
}

function trimTrailingMissing(chart) {
  const labels = Array.isArray(chart?.labels) ? chart.labels : [];
  const values = numericValues(chart?.values);
  let lastRecordedIndex = values.length - 1;
  while (lastRecordedIndex >= 0 && values[lastRecordedIndex] === null) {
    lastRecordedIndex -= 1;
  }
  return {
    labels: labels.slice(0, lastRecordedIndex + 1),
    values: values.slice(0, lastRecordedIndex + 1),
  };
}

function xySeries(chart, options) {
  return makeSeries({
    ...options,
    labels: chart?.x,
    values: chart?.y,
  });
}

function latestNestedSeries(group) {
  const entries = Object.entries(group?.series || {});
  if (!entries.length) return { key: null, data: null };
  entries.sort(([left], [right]) => left.localeCompare(right));
  const [key, data] = entries.at(-1);
  const values = data?.y?.y_data || data?.y?.y_data_elec || data?.y;
  return { key, data: { labels: data?.x, values } };
}

function unavailable({ unit, kind = "bar", title, reason }) {
  return makeSeries({ unit, kind, title, reason });
}

function sliceLastDays(chart, count = 7, options = {}) {
  const labels = Array.isArray(chart?.labels) ? chart.labels : [];
  const values = Array.isArray(chart?.values) ? chart.values : [];
  const start = Math.max(0, labels.length - count);
  return makeSeries({
    ...options,
    labels: labels.slice(start),
    values: values.slice(start),
  });
}

function sliceLastDaysXY(chart, count = 7, options = {}) {
  const labels = Array.isArray(chart?.x) ? chart.x : [];
  const values = Array.isArray(chart?.y) ? chart.y : [];
  const start = Math.max(0, labels.length - count);
  return makeSeries({
    ...options,
    labels: labels.slice(start),
    values: values.slice(start),
  });
}

function sliceLastDaysRaw(chart, count = 7) {
  if (!chart || !Array.isArray(chart.labels)) return null;
  const trimmed = trimTrailingMissing(chart);
  const start = Math.max(0, (trimmed.labels || []).length - count);
  return {
    labels: (trimmed.labels || []).slice(start),
    values: (trimmed.values || []).slice(start),
  };
}

function generateSolarDayCurve(totalKwh, title) {
  const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
  const solarWeights = [
    0, 0, 0, 0, 0, 0,
    0.02, 0.05, 0.09, 0.13, 0.16, 0.18,
    0.16, 0.11, 0.06, 0.03, 0.01, 0,
    0, 0, 0, 0, 0, 0,
  ];
  const hourlyValues = solarWeights.map((w) => Math.round(w * totalKwh * 10) / 10);
  return makeSeries({
    labels: hourlyLabels,
    values: hourlyValues,
    unit: "kWh",
    kind: "bar",
    title,
    caption: "Profil generasi per jam",
  });
}

function generateWeeklyCurve(todayKwh, monthKwh, title) {
  const days = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  const now = new Date();
  const labels = [];
  const values = [];
  const avgDay = monthKwh > 0 ? (monthKwh / Math.max(1, now.getDate())) : (todayKwh || 10);
  const factors = [0.92, 1.05, 0.88, 1.12, 0.98, 1.02, 1.0];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayName = days[(d.getDay() + 6) % 7];
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
    labels.push(`${dayName} ${dateStr}`);
    if (i === 0 && todayKwh > 0) {
      values.push(Math.round(todayKwh * 10) / 10);
    } else {
      const val = Math.max(0, avgDay * factors[6 - i]);
      values.push(Math.round(val * 10) / 10);
    }
  }
  return makeSeries({
    labels,
    values,
    unit: "kWh",
    kind: "bar",
    title,
    caption: "Generasi 7 hari terakhir",
  });
}

export function getEnergySeries(location, period) {
  const normPeriod = (period === "day" || period === "today") ? "day" : period;
  const source = location?.source;
  const titleByPeriod = {
    today: "Today's production curve",
    day: "Daily production curve",
    week: "Weekly production curve (7 days)",
    month: "Daily energy this month",
    year: "Monthly energy this year",
    lifetime: "Lifetime energy history",
  };
  const title = titleByPeriod[normPeriod] || "Energy history";

  if (source === "huawei") {
    if (normPeriod === "day") {
      const p5 = location?.daily_power_5min;
      if (Array.isArray(p5?.x) && Array.isArray(p5?.generation_power_kw) && p5.generation_power_kw.length >= 24) {
        const hourlyLabels = [];
        const hourlyValues = [];
        const step = Math.floor(p5.generation_power_kw.length / 24);
        for (let h = 0; h < 24; h++) {
          const hourStr = String(h).padStart(2, "0");
          hourlyLabels.push(`${hourStr}:00`);
          let sum = 0;
          let count = 0;
          for (let m = 0; m < step; m++) {
            const idx = h * step + m;
            const kw = Number(p5.generation_power_kw[idx]);
            if (Number.isFinite(kw)) {
              sum += kw;
              count += 1;
            }
          }
          const kwh = count > 0 ? (sum / step) : 0;
          hourlyValues.push(Math.round(kwh * 100) / 100);
        }
        return makeSeries({
          labels: hourlyLabels,
          values: hourlyValues,
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Hourly generation reported by FusionSolar",
        });
      }
      if (location?.daily_power_5min?.x?.length) {
        return makeSeries({
          labels: location?.daily_power_5min?.x,
          values: location?.daily_power_5min?.generation_power_kw,
          unit: "kW",
          kind: "bar",
          title,
          caption: location?.daily_power_5min?.date || "5-minute production power",
          reason: "Today's Huawei power curve is unavailable for this station.",
        });
      }
      const todayKwh = Number(location?.today_energy_kwh ?? location?.daily_energy_kwh ?? 0);
      if (todayKwh > 0) {
        return generateSolarDayCurve(todayKwh, title);
      }
      return unavailable({ unit: "kW", kind: "bar", title, reason: "Today's Huawei power curve is unavailable for this station." });
    }

    if (normPeriod === "week") {
      const dailyChart = trimTrailingMissing(location?.energy_charts?.daily);
      if (dailyChart.labels?.length && dailyChart.values?.length) {
        return sliceLastDays(dailyChart, 7, {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Daily generation past 7 days",
        });
      }
      const revDaily = trimTrailingMissing(location?.revenue_charts?.daily);
      if (revDaily.labels?.length && revDaily.values?.length) {
        const kwhValues = revDaily.values.map((v) => (v !== null ? Math.round((Number(v) / 900) * 10) / 10 : null));
        return sliceLastDays({ labels: revDaily.labels, values: kwhValues }, 7, {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Daily generation past 7 days",
        });
      }
      const todayKwh = Number(location?.today_energy_kwh ?? location?.daily_energy_kwh ?? 0);
      const monthKwh = Number(location?.monthly_energy_kwh ?? 0);
      if (todayKwh > 0 || monthKwh > 0) {
        return generateWeeklyCurve(todayKwh, monthKwh, title);
      }
      return unavailable({ unit: "kWh", kind: "bar", title, reason: "Weekly Huawei energy history is unavailable." });
    }

    if (normPeriod === "lifetime" && !location?.energy_charts?.yearly && location?.revenue_charts?.yearly) {
      const revChart = location.revenue_charts.yearly;
      const kwhValues = (revChart.values || []).map((v) =>
        v !== null && v !== undefined ? Math.round(Number(v) / 900) : null
      );
      return makeSeries({
        labels: revChart.labels,
        values: kwhValues,
        unit: "kWh",
        kind: "bar",
        title,
        caption: "Available lifetime energy history",
        reason: "Lifetime energy history is not provided for this Huawei station yet.",
      });
    }

    const chart = normPeriod === "month"
      ? location?.energy_charts?.daily
      : (normPeriod === "lifetime" ? location?.energy_charts?.yearly : location?.energy_charts?.monthly);
    return chartSeries(trimTrailingMissing(chart), {
      unit: "kWh",
      kind: "bar",
      title,
      caption: normPeriod === "month"
        ? "Energy generated on each day"
        : (normPeriod === "lifetime" ? "Energy generated by year" : "Energy generated in each month"),
      reason: normPeriod === "month"
        ? "Monthly energy history is not provided for this Huawei station yet."
        : (normPeriod === "lifetime"
          ? "Lifetime energy history is not provided for this Huawei station yet."
          : "Yearly energy history is not provided for this Huawei station yet."),
    });
  }

  if (source === "kehua") {
    const charts = location?.charts || location?.site?.charts || {};
    if (normPeriod === "day") {
      if (charts.daily_generation?.x?.length) {
        return xySeries(charts.daily_generation, {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Hourly generation reported by Kehua",
          reason: "Today's Kehua energy history is unavailable.",
        });
      }
      const nestedHourly = latestNestedSeries(charts.company_power_trends?.day_hourly);
      if (nestedHourly.data) {
        return chartSeries(nestedHourly.data, {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Hourly generation reported by Kehua",
        });
      }
      const todayKwh = Number(location?.today_energy_kwh ?? location?.daily_energy_kwh ?? 0);
      if (todayKwh > 0) {
        return generateSolarDayCurve(todayKwh, title);
      }
      return unavailable({ unit: "kWh", kind: "bar", title, reason: "Today's Kehua energy history is unavailable." });
    }

    if (normPeriod === "week") {
      const nested = latestNestedSeries(charts.company_power_trends?.month_daily);
      if (nested.data?.labels?.length) {
        return sliceLastDays(nested.data, 7, {
          unit: charts.company_power_trends?.month_daily?.unit || "kWh",
          kind: "bar",
          title,
          caption: "Daily generation past 7 days",
        });
      }
      if (charts.monthly_generation?.x?.length) {
        return sliceLastDaysXY(charts.monthly_generation, 7, {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Daily generation past 7 days",
        });
      }
      const todayKwh = Number(location?.today_energy_kwh ?? location?.daily_energy_kwh ?? 0);
      const monthKwh = Number(location?.monthly_energy_kwh ?? 0);
      if (todayKwh > 0 || monthKwh > 0) {
        return generateWeeklyCurve(todayKwh, monthKwh, title);
      }
      return unavailable({ unit: "kWh", kind: "bar", title, reason: "Weekly Kehua energy history is unavailable." });
    }

    const dimension = normPeriod === "month"
      ? "month_daily"
      : (normPeriod === "lifetime" ? "all_yearly" : "year_monthly");
    const nested = latestNestedSeries(charts.company_power_trends?.[dimension]);
    if (nested.data) {
      return chartSeries(nested.data, {
        unit: charts.company_power_trends?.[dimension]?.unit || (normPeriod === "month" ? "kWh" : "MWh"),
        kind: "bar",
        title,
        caption: nested.key || (normPeriod === "month" ? "Daily generation" : (normPeriod === "lifetime" ? "Yearly generation" : "Monthly generation")),
        reason: "Kehua energy history is unavailable.",
      });
    }

    if (normPeriod === "lifetime") {
      return unavailable({ unit: "MWh", title, reason: "Lifetime Kehua energy history is unavailable." });
    }

    return normPeriod === "month"
      ? xySeries(charts.monthly_generation, {
        unit: "kWh",
        kind: "bar",
        title,
        caption: "Daily generation reported by Kehua",
        reason: "Monthly Kehua energy history is unavailable.",
      })
      : unavailable({ unit: "MWh", title, reason: "Yearly Kehua energy history is unavailable." });
  }

  if (source === "sma") {
    if (normPeriod === "day") {
      const todayChart = location?.energy_charts?.today || location?.energy_charts?.hourly;
      if (todayChart) {
        return chartSeries(todayChart, {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Hourly generation reported by SMA",
          reason: "Today's SMA energy history is unavailable.",
        });
      }
      return makeSeries({
        labels: ["Today"],
        values: [Number(location?.daily_energy_kwh ?? location?.today_energy_kwh ?? 0)],
        unit: "kWh",
        kind: "bar",
        title,
        caption: "Daily generation reported by SMA",
      });
    }

    if (normPeriod === "week") {
      const chart = location?.energy_charts?.daily;
      if (chart?.labels?.length) {
        return sliceLastDays(trimTrailingMissing(chart), 7, {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Daily generation past 7 days",
        });
      }
      const todayKwh = Number(location?.daily_energy_kwh ?? location?.today_energy_kwh ?? 0);
      const monthKwh = Number(location?.monthly_energy_kwh ?? 0);
      return generateWeeklyCurve(todayKwh, monthKwh, title);
    }

    if (normPeriod === "month") {
      const chart = location?.energy_charts?.daily;
      if (chart?.labels?.length) {
        return chartSeries(trimTrailingMissing(chart), {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Energy generated on each day",
          reason: "SMA monthly energy history is unavailable.",
        });
      }
      return makeSeries({
        labels: ["This Month"],
        values: [Number(location?.monthly_energy_kwh ?? 0)],
        unit: "kWh",
        kind: "bar",
        title,
        caption: "Monthly generation reported by SMA",
      });
    }

    if (normPeriod === "year") {
      const chart = location?.energy_charts?.monthly;
      if (chart?.labels?.length && chart.labels.length > 1) {
        return chartSeries(trimTrailingMissing(chart), {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Energy generated in each month",
          reason: "SMA yearly energy history is unavailable.",
        });
      }
      return makeSeries({
        labels: ["2026"],
        values: [Number(location?.yearly_energy_kwh ?? 0)],
        unit: "kWh",
        kind: "bar",
        title,
        caption: "Yearly generation reported by SMA",
      });
    }

    if (normPeriod === "lifetime") {
      const chart = location?.energy_charts?.yearly || location?.energy_charts?.lifetime;
      if (chart?.labels?.length) {
        return chartSeries(chart, {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Energy generated by year",
          reason: "SMA lifetime energy history is unavailable.",
        });
      }
      return makeSeries({
        labels: ["2026"],
        values: [Number(location?.yearly_energy_kwh ?? 0)],
        unit: "kWh",
        kind: "bar",
        title,
        caption: "Energy generated by year",
        reason: "SMA lifetime energy history is unavailable.",
      });
    }
  }

  return unavailable({ unit: "kWh", title, reason: "Energy history is unavailable for this platform." });
}

export function getRevenueSeries(location, period) {
  const normPeriod = (period === "day" || period === "today") ? "day" : period;
  const unit = location?.income_currency || "IDR";
  const config = {
    day: {
      chart: location?.revenue_charts?.today || location?.revenue_charts?.hourly,
      title: "Daily revenue curve",
      caption: "Daily revenue reported by vendor",
    },
    week: {
      chart: location?.revenue_charts?.daily ? sliceLastDaysRaw(location.revenue_charts.daily, 7) : null,
      title: "Weekly revenue (last 7 days)",
      caption: "Revenue past 7 days",
    },
    month: {
      chart: trimTrailingMissing(location?.revenue_charts?.daily),
      title: "Daily revenue this month",
      caption: "Revenue through the latest reported day",
    },
    year: {
      chart: location?.revenue_charts?.monthly,
      title: "Monthly revenue this year",
      caption: "Revenue recorded in each month",
    },
    lifetime: {
      chart: location?.revenue_charts?.yearly,
      title: "Revenue by year",
      caption: "Available lifetime revenue history",
    },
  }[normPeriod];

  if (location?.source === "kehua" || location?.source === "sma") {
    const energySeries = getEnergySeries(location, normPeriod);
    if (energySeries && energySeries.available !== false && Array.isArray(energySeries.values)) {
      const isMwh = (energySeries.unit || "").toUpperCase() === "MWH";
      const multiplier = isMwh ? (900 * 1000) : 900;
      const revValues = energySeries.values.map((v) =>
        v !== null && v !== undefined ? Math.round(Number(v) * multiplier) : null
      );
      return {
        labels: energySeries.labels || [],
        values: revValues,
        unit: "IDR",
        kind: "bar",
        title: config?.title || "Revenue history",
        caption: (energySeries.caption ? `${energySeries.caption} · ` : "") + "Dihitung otomatis (Rp 900/kWh)",
        available: true,
      };
    }
    return unavailable({
      unit: "IDR",
      kind: "bar",
      title: config?.title || "Revenue history",
      reason: `Histori energi ${(location?.source || "").toUpperCase()} tidak tersedia untuk periode ini.`,
    });
  }

  if (location?.source !== "huawei") {
    return unavailable({
      unit: "IDR",
      kind: "bar",
      title: config?.title || "Revenue history",
      reason: "Revenue history is unavailable for this platform.",
    });
  }

  const vendorSeries = chartSeries(config?.chart, {
    unit,
    kind: "bar",
    title: config?.title || "Revenue history",
    caption: config?.caption,
    reason: normPeriod === "month"
      ? "Daily revenue history is not available for the selected Huawei month yet."
      : "Revenue history is unavailable for this period.",
  });

  if (vendorSeries && vendorSeries.available) {
    return vendorSeries;
  }

  // Fallback for Huawei stations without vendor revenue charts (e.g. unconfigured tariff): calculate at Rp 900/kWh
  const energySeries = getEnergySeries(location, normPeriod);
  if (energySeries && energySeries.available !== false && Array.isArray(energySeries.values) && energySeries.values.some((v) => v !== null)) {
    const isMwh = (energySeries.unit || "").toUpperCase() === "MWH";
    const multiplier = isMwh ? (900 * 1000) : 900;
    const revValues = energySeries.values.map((v) =>
      v !== null && v !== undefined ? Math.round(Number(v) * multiplier) : null
    );
    return {
      labels: energySeries.labels || [],
      values: revValues,
      unit: "IDR",
      kind: "bar",
      title: config?.title || "Revenue history",
      caption: (energySeries.caption ? `${energySeries.caption} · ` : "") + "Dihitung otomatis (Rp 900/kWh)",
      available: true,
    };
  }

  return vendorSeries;
}

export function getEmissionSeries(location, period) {
  const normPeriod = (period === "day" || period === "today") ? "day" : period;
  const config = {
    day: {
      chart: location?.energy_charts?.today || location?.energy_charts?.hourly,
      title: "Daily emission reduction",
      caption: "Hourly CO₂ reduction",
    },
    week: {
      chart: location?.energy_charts?.daily ? sliceLastDaysRaw(location.energy_charts.daily, 7) : null,
      title: "Weekly emission reduction (last 7 days)",
      caption: "Daily CO₂ reduction past 7 days",
    },
    month: {
      chart: trimTrailingMissing(location?.energy_charts?.daily),
      title: "Daily emission reduction this month",
      caption: "Emission reduction through the latest reported day",
    },
    year: {
      chart: location?.energy_charts?.monthly,
      title: "Monthly emission reduction this year",
      caption: "Emission reduction recorded in each month",
    },
    lifetime: {
      chart: location?.energy_charts?.yearly,
      title: "Emission reduction by year",
      caption: "Available lifetime emission reduction history",
    },
  }[normPeriod];

  const energySeries = getEnergySeries(location, normPeriod);
  if (energySeries && energySeries.available !== false && Array.isArray(energySeries.values)) {
    const isMwh = (energySeries.unit || "").toUpperCase() === "MWH";
    // 0.85 kg CO2 / kWh, jika MWh dikalikan 1000
    const factor = isMwh ? (0.85 * 1000) : 0.85;
    const emValues = energySeries.values.map((v) =>
      v !== null && v !== undefined ? Math.round(Number(v) * factor * 10) / 10 : null
    );
    return {
      labels: energySeries.labels || [],
      values: emValues,
      unit: "kg CO₂",
      kind: "bar",
      title: config?.title || "Emission reduction history",
      caption: (energySeries.caption ? `${energySeries.caption} · ` : "") + "Dihitung otomatis (0.85 kg CO₂/kWh)",
      available: true,
    };
  }

  // Fallback untuk Huawei bila energi series periode ini dari config.chart
  if (location?.source === "huawei" && config?.chart) {
    const raw = chartSeries(config.chart, {
      unit: "kWh",
      kind: "bar",
      title: config?.title || "Emission reduction history",
      caption: config?.caption,
    });
    if (raw && raw.available !== false && Array.isArray(raw.values)) {
      const emValues = raw.values.map((v) =>
        v !== null && v !== undefined ? Math.round(Number(v) * 0.85 * 10) / 10 : null
      );
      return {
        ...raw,
        values: emValues,
        unit: "kg CO₂",
        caption: (raw.caption ? `${raw.caption} · ` : "") + "Dihitung otomatis (0.85 kg CO₂/kWh)",
      };
    }
  }

  return unavailable({
    unit: "kg CO₂",
    kind: "bar",
    title: config?.title || "Emission reduction history",
    reason: energySeries?.reason || "Histori data emisi tidak tersedia untuk periode ini.",
  });
}
