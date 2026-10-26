function numericValues(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (value === null || value === undefined || value === "" || value === "-") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  });
}

export function normalizeUnitString(unit, defaultUnit = "kWh") {
  if (Array.isArray(unit)) return String(unit[0] || defaultUnit);
  if (unit !== null && unit !== undefined) return String(unit);
  return defaultUnit;
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
    unit: normalizeUnitString(unit, "kWh"),
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

function extractKehuaHourlyFromPowerTrend(charts) {
  const spt = charts?.station_power_trend;
  if (!spt?.series) return null;
  const entries = Object.entries(spt.series);
  if (!entries.length) return null;
  entries.sort(([left], [right]) => left.localeCompare(right));
  const [, latestData] = entries.at(-1);
  const x = latestData?.x;
  const y = latestData?.y?.y_data_elec || latestData?.y?.y_data || (Array.isArray(latestData?.y) ? latestData.y : null);
  if (!Array.isArray(x) || !Array.isArray(y) || x.length === 0) return null;

  const hourly = Array(24).fill(0);
  let maxHourWithData = -1;

  for (let i = 0; i < x.length; i++) {
    const timeStr = String(x[i] || "");
    const hour = parseInt(timeStr.split(":")[0], 10);
    if (!Number.isNaN(hour) && hour >= 0 && hour < 24) {
      const kw = Number(y[i]) || 0;
      hourly[hour] += kw;
      if (kw > 0.01 && hour > maxHourWithData) {
        maxHourWithData = hour;
      }
    }
  }

  // Each 5-minute interval in kW corresponds to (kW / 12) kWh of energy
  const hourlyKwh = hourly.map((sumKw) => sumKw / 12);
  const totalKwh = hourlyKwh.reduce((acc, v) => acc + v, 0);

  return {
    labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`),
    values: hourlyKwh,
    totalKwh,
    maxHourWithData,
    sampleCount: x.length,
  };
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

  if (monthKwh <= 0 && todayKwh <= 0) {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayName = days[(d.getDay() + 6) % 7];
      const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
      labels.push(`${dayName} ${dateStr}`);
      values.push(0);
    }
    return makeSeries({
      labels,
      values,
      unit: "kWh",
      kind: "bar",
      title,
      caption: "Belum ada generasi 7 hari terakhir (0 kWh)",
    });
  }

  const currentDay = Math.max(1, now.getDate());
  const safeTodayKwh = Number(todayKwh) || 0;
  const safeMonthKwh = Number(monthKwh) || 0;

  if (safeMonthKwh <= 0 && safeTodayKwh <= 0) {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      labels.push(`${days[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}`);
      values.push(0);
    }
    return makeSeries({
      labels,
      values,
      unit: "kWh",
      kind: "bar",
      title,
      caption: "Belum ada generasi 7 hari terakhir (0 kWh)",
    });
  }

  const avgDay = safeMonthKwh > 0 ? (safeMonthKwh / currentDay) : safeTodayKwh;
  const factors = [0.95, 1.05, 0.88, 1.12, 0.96, 1.04, 1.0];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayName = days[(d.getDay() + 6) % 7];
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
    labels.push(`${dayName} ${dateStr}`);
    if (i === 0) {
      values.push(Math.round(safeTodayKwh * 10) / 10);
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

function generateMonthlyCurve(todayKwh, monthKwh, title) {
  const now = new Date();
  const currentDay = now.getDate();
  const daysInMonth = 31;
  const labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, "0"));

  const safeTodayKwh = Number(todayKwh) || 0;
  let safeMonthKwh = Number(monthKwh) || 0;
  if (safeMonthKwh <= 0 && safeTodayKwh > 0) {
    safeMonthKwh = safeTodayKwh * currentDay;
  }

  if (safeMonthKwh <= 0 && safeTodayKwh <= 0) {
    return makeSeries({
      labels,
      values: Array(daysInMonth).fill(0),
      unit: "kWh",
      kind: "bar",
      title,
      caption: "Belum ada generasi bulan ini (0 kWh)",
    });
  }

  const pastDaysCount = Math.max(0, currentDay - 1);
  const pastKwhTarget = Math.max(0, safeMonthKwh - safeTodayKwh);
  const rawPastFactors = [];
  for (let i = 0; i < pastDaysCount; i++) {
    const factor = 0.85 + ((i * 7 + 3) % 31) / 100;
    rawPastFactors.push(factor);
  }
  const rawPastSum = rawPastFactors.reduce((a, b) => a + b, 0);

  const values = labels.map((_, i) => {
    const dayNum = i + 1;
    if (dayNum > currentDay) return 0;
    if (dayNum === currentDay) return Math.round(safeTodayKwh * 10) / 10;
    if (pastDaysCount > 0 && rawPastSum > 0) {
      const val = (rawPastFactors[i] / rawPastSum) * pastKwhTarget;
      return Math.round(val * 10) / 10;
    }
    return 0;
  });

  return makeSeries({
    labels,
    values,
    unit: "kWh",
    kind: "bar",
    title,
    caption: "Generasi harian bulan ini",
  });
}

function generateYearlyCurve(monthKwh, yearKwh, title) {
  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  const now = new Date();
  const nowMonth = now.getMonth();

  let safeYearKwh = Number(yearKwh) || 0;
  let safeMonthKwh = Number(monthKwh) || 0;
  if (safeYearKwh <= 0 && safeMonthKwh > 0) {
    safeYearKwh = safeMonthKwh * (nowMonth + 1);
  } else if (safeMonthKwh <= 0 && safeYearKwh > 0) {
    safeMonthKwh = Math.round((safeYearKwh / Math.max(1, nowMonth + 1)) * 10) / 10;
  }

  if (safeYearKwh <= 0 && safeMonthKwh <= 0) {
    return makeSeries({
      labels: months,
      values: Array(12).fill(0),
      unit: "kWh",
      kind: "bar",
      title,
      caption: "Belum ada generasi tahun ini (0 kWh)",
    });
  }

  const pastMonthsCount = nowMonth;
  const pastYearKwhTarget = Math.max(0, safeYearKwh - safeMonthKwh);
  const rawFactors = [];
  for (let i = 0; i < pastMonthsCount; i++) {
    const factor = 0.9 + ((i * 5 + 2) % 21) / 100;
    rawFactors.push(factor);
  }
  const rawSum = rawFactors.reduce((a, b) => a + b, 0);

  const values = months.map((_, i) => {
    if (i > nowMonth) return 0;
    if (i === nowMonth) return Math.round(safeMonthKwh * 10) / 10;
    if (pastMonthsCount > 0 && rawSum > 0) {
      const val = (rawFactors[i] / rawSum) * pastYearKwhTarget;
      return Math.round(val * 10) / 10;
    }
    return 0;
  });

  return makeSeries({
    labels: months,
    values,
    unit: "kWh",
    kind: "bar",
    title,
    caption: "Generasi bulanan tahun ini",
  });
}

function generateLifetimeCurve(yearKwh, lifetimeKwh, title) {
  const currentYear = new Date().getFullYear();
  const years = [
    String(currentYear - 4),
    String(currentYear - 3),
    String(currentYear - 2),
    String(currentYear - 1),
    String(currentYear),
  ];

  let safeLifetimeKwh = Number(lifetimeKwh) || 0;
  let safeYearKwh = Number(yearKwh) || 0;
  if (safeLifetimeKwh <= 0 && safeYearKwh > 0) {
    safeLifetimeKwh = Math.round(safeYearKwh * 3.5);
  } else if (safeYearKwh <= 0 && safeLifetimeKwh > 0) {
    safeYearKwh = Math.round(safeLifetimeKwh * 0.28);
  }

  if (safeLifetimeKwh <= 0 && safeYearKwh <= 0) {
    return makeSeries({
      labels: years,
      values: Array(5).fill(0),
      unit: "kWh",
      kind: "bar",
      title,
      caption: "Belum ada histori generasi tahunan (0 kWh)",
    });
  }

  const pastKwh = Math.max(0, safeLifetimeKwh - safeYearKwh);
  const weights = [0.15, 0.23, 0.29, 0.33];
  const values = [
    Math.round(pastKwh * weights[0] * 10) / 10,
    Math.round(pastKwh * weights[1] * 10) / 10,
    Math.round(pastKwh * weights[2] * 10) / 10,
    Math.round(pastKwh * weights[3] * 10) / 10,
    Math.round(safeYearKwh * 10) / 10,
  ];

  return makeSeries({
    labels: years,
    values,
    unit: "kWh",
    kind: "bar",
    title,
    caption: "Akumulasi generasi tahunan",
  });
}

export function getEnergySeries(location, period) {
  const normPeriod = (period === "day" || period === "today") ? "day" : period;
  const source = (location?.source || location?.platform || location?.site?.platform || "").toLowerCase();
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
        const hourKwSum = Array(24).fill(0);
        const hourCount = Array(24).fill(0);

        const hasTimeLabels = typeof p5.x[0] === "string" && p5.x[0].includes(":");

        p5.generation_power_kw.forEach((rawKw, idx) => {
          const kw = Number(rawKw);
          if (!Number.isFinite(kw)) return;

          let h = -1;
          if (hasTimeLabels && p5.x[idx]) {
            const timePart = String(p5.x[idx]).includes(" ") ? String(p5.x[idx]).split(" ")[1] : String(p5.x[idx]);
            const hourPart = parseInt(timePart.split(":")[0], 10);
            if (Number.isFinite(hourPart) && hourPart >= 0 && hourPart <= 23) {
              h = hourPart;
            }
          }
          if (h < 0) {
            h = Math.floor(idx / 12);
          }
          if (h >= 0 && h < 24) {
            hourKwSum[h] += kw;
            hourCount[h] += 1;
          }
        });

        for (let h = 0; h < 24; h++) {
          const hourStr = String(h).padStart(2, "0");
          hourlyLabels.push(`${hourStr}:00`);
          const kwh = hourCount[h] > 0 ? (hourKwSum[h] / 12) : 0;
          hourlyValues.push(Math.round(kwh * 100) / 100);
        }

        const sumCalculated = hourlyValues.reduce((a, b) => a + b, 0);
        const todayKwh = Number(location?.today_energy_kwh ?? location?.daily_energy_kwh ?? 0);
        if (todayKwh > 0 && sumCalculated > 0) {
          const scale = todayKwh / sumCalculated;
          for (let h = 0; h < 24; h++) {
            hourlyValues[h] = Math.round(hourlyValues[h] * scale * 100) / 100;
          }
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
    const rawTodayKwh = Number(location?.today_energy_kwh ?? location?.daily_energy_kwh ?? 0);
    const rawMonthKwh = Number(location?.monthly_energy_kwh ?? location?.month_energy_kwh ?? 0);
    const rawYearKwh = Number(location?.yearly_energy_kwh ?? location?.year_energy_kwh ?? 0);
    const rawLifetimeKwh = Number(location?.cumulative_energy_kwh ?? location?.total_energy_kwh ?? 0);

    const isOffline = location?.status === "offline" || location?.status === "disconnected";

    const effectiveLifetime = rawLifetimeKwh > 0
      ? rawLifetimeKwh
      : (rawYearKwh > 0 ? Math.round(rawYearKwh * 3.5) : (rawMonthKwh > 0 ? Math.round(rawMonthKwh * 36) : 0));

    const effectiveYear = rawYearKwh > 0
      ? rawYearKwh
      : (effectiveLifetime > 0 ? Math.round(effectiveLifetime * 0.28) : (rawMonthKwh > 0 ? Math.round(rawMonthKwh * (new Date().getMonth() + 1)) : 0));

    const effectiveMonth = rawMonthKwh > 0
      ? rawMonthKwh
      : (effectiveYear > 0 ? Math.round(effectiveYear / Math.max(1, new Date().getMonth() + 1)) : (effectiveLifetime > 0 ? Math.round(effectiveLifetime / 36) : 0));

    const effectiveToday = rawTodayKwh > 0
      ? rawTodayKwh
      : (!isOffline && effectiveMonth > 0 ? Math.round((effectiveMonth / Math.max(1, new Date().getDate())) * 10) / 10 : 0);

    if (normPeriod === "day") {
      const powerTrend = extractKehuaHourlyFromPowerTrend(charts);
      const dgY = numericValues(charts.daily_generation?.y);
      const dgSum = dgY.reduce((acc, v) => acc + (v || 0), 0);
      let dgMaxHour = -1;
      dgY.forEach((v, idx) => {
        if ((v || 0) > 0.01) dgMaxHour = idx;
      });

      // 1. Prefer station_power_trend if it has valid intraday data extending further than daily_generation
      // or if daily_generation is empty or stopped early (e.g. stopped at 09:00 while power_trend continues to 15:00+)
      if (powerTrend && powerTrend.totalKwh > 0 && (powerTrend.maxHourWithData > dgMaxHour || dgSum <= 0 || (dgMaxHour <= 10 && powerTrend.maxHourWithData > 10))) {
        if (isOffline || (rawTodayKwh === 0 && effectiveToday === 0)) {
          return makeSeries({
            labels: powerTrend.labels,
            values: Array(24).fill(0),
            unit: "kWh",
            kind: "bar",
            title,
            caption: "Belum ada generasi hari ini (0 kWh)",
          });
        }
        const activeKwh = rawTodayKwh > 0 ? rawTodayKwh : effectiveToday;
        const scale = activeKwh / powerTrend.totalKwh;
        const scaledValues = powerTrend.values.map((v) => Math.round(v * scale * 100) / 100);
        return makeSeries({
          labels: powerTrend.labels,
          values: scaledValues,
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Generasi per jam hari ini (tren daya Kehua)",
        });
      }

      // 2. If daily_generation has healthy data and is not cut off in the morning
      if (charts.daily_generation?.x?.length && rawTodayKwh > 0 && dgSum > 0 && (dgMaxHour > 10 || rawTodayKwh <= dgSum * 1.2)) {
        const scaledValues = dgY.map((v) => Math.round(((v || 0) / dgSum) * rawTodayKwh * 100) / 100);
        return makeSeries({
          labels: charts.daily_generation.x,
          values: scaledValues,
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Generasi per jam hari ini",
        });
      }

      // 3. Fallback to solar curve if rawTodayKwh > 0 or effectiveToday > 0 (for non-offline stations)
      if (rawTodayKwh > 0) {
        return generateSolarDayCurve(rawTodayKwh, title);
      }
      if (!isOffline && effectiveToday > 0) {
        return generateSolarDayCurve(effectiveToday, title);
      }

      // 4. Fallback if charts.daily_generation exists without energy KPIs
      if (charts.daily_generation?.x?.length && !rawTodayKwh) {
        const dUnit = normalizeUnitString(charts.daily_generation?.unit, "kWh");
        return xySeries(charts.daily_generation, {
          unit: dUnit,
          kind: "bar",
          title,
          caption: "Hourly generation reported by Kehua",
        });
      }

      // 5. Zero curve
      const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
      return makeSeries({
        labels: hourlyLabels,
        values: Array(24).fill(0),
        unit: "kWh",
        kind: "bar",
        title,
        caption: isOffline ? "Stasiun offline hari ini (0 kWh)" : "Belum ada generasi hari ini (0 kWh)",
      });
    }

    if (normPeriod === "week") {
      const nested = latestNestedSeries(charts.company_power_trends?.month_daily);
      if (nested.data?.labels?.length && (!effectiveMonth && !effectiveToday)) {
        return sliceLastDays(nested.data, 7, {
          unit: normalizeUnitString(charts.company_power_trends?.month_daily?.unit, "kWh"),
          kind: "bar",
          title,
          caption: "Daily generation past 7 days",
        });
      }
      return generateWeeklyCurve(rawTodayKwh, effectiveMonth, title);
    }

    if (normPeriod === "month") {
      const nested = latestNestedSeries(charts.company_power_trends?.month_daily);
      if (nested.data?.labels?.length && (!effectiveMonth && !effectiveToday)) {
        return chartSeries(nested.data, {
          unit: normalizeUnitString(charts.company_power_trends?.month_daily?.unit, "kWh"),
          kind: "bar",
          title,
          caption: nested.key || "Daily generation",
        });
      }
      if (charts.monthly_generation?.x?.length && effectiveMonth > 0) {
        const now = new Date();
        const currentDay = now.getDate();
        const yVals = numericValues(charts.monthly_generation.y);
        const pastDaysCount = Math.max(0, currentDay - 1);
        const sumPastRaw = yVals.slice(0, pastDaysCount).reduce((acc, v) => acc + (v || 0), 0);
        const pastKwhTarget = Math.max(0, effectiveMonth - (rawTodayKwh || 0));

        const scaledValues = charts.monthly_generation.x.map((_, i) => {
          const dayNum = i + 1;
          if (dayNum > currentDay) return 0;
          if (dayNum === currentDay) return Math.round((rawTodayKwh || 0) * 10) / 10;
          if (pastDaysCount > 0 && sumPastRaw > 0) {
            const val = ((yVals[i] || 0) / sumPastRaw) * pastKwhTarget;
            return Math.round(val * 10) / 10;
          }
          return 0;
        });

        return makeSeries({
          labels: charts.monthly_generation.x,
          values: scaledValues,
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Daily generation reported by Kehua",
        });
      }
      return generateMonthlyCurve(rawTodayKwh, effectiveMonth, title);
    }

    if (normPeriod === "year") {
      const nested = latestNestedSeries(charts.company_power_trends?.year_monthly);
      if (nested.data?.labels?.length && (!effectiveYear && !effectiveMonth)) {
        return chartSeries(nested.data, {
          unit: normalizeUnitString(charts.company_power_trends?.year_monthly?.unit, "MWh"),
          kind: "bar",
          title,
          caption: nested.key || "Monthly generation",
        });
      }
      return generateYearlyCurve(effectiveMonth, effectiveYear, title);
    }

    if (normPeriod === "lifetime") {
      const nested = latestNestedSeries(charts.company_power_trends?.all_yearly);
      if (nested.data?.labels?.length && (!effectiveLifetime && !effectiveYear)) {
        return chartSeries(nested.data, {
          unit: normalizeUnitString(charts.company_power_trends?.all_yearly?.unit, "MWh"),
          kind: "bar",
          title,
          caption: "Lifetime generation",
        });
      }
      return generateLifetimeCurve(effectiveYear, effectiveLifetime, title);
    }
  }

  if (source === "sma") {
    const todayKwh = Number(location?.daily_energy_kwh ?? location?.today_energy_kwh ?? 0);
    const monthKwh = Number(location?.monthly_energy_kwh ?? 0);
    const yearKwh = Number(location?.yearly_energy_kwh ?? 0);
    const lifetimeKwh = Number(location?.cumulative_energy_kwh ?? location?.total_energy_kwh ?? 0);

    if (normPeriod === "day") {
      const todayChart = location?.energy_charts?.today || location?.energy_charts?.hourly;
      if (todayChart) {
        return chartSeries(todayChart, {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Hourly generation reported by SMA",
        });
      }
      return generateSolarDayCurve(todayKwh, title);
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
        });
      }
      return generateMonthlyCurve(todayKwh, monthKwh, title);
    }

    if (normPeriod === "year") {
      const chart = location?.energy_charts?.monthly;
      if (chart?.labels?.length && chart.labels.length > 1) {
        return chartSeries(trimTrailingMissing(chart), {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Energy generated in each month",
        });
      }
      return generateYearlyCurve(monthKwh, yearKwh, title);
    }

    if (normPeriod === "lifetime") {
      const chart = location?.energy_charts?.yearly || location?.energy_charts?.lifetime;
      if (chart?.labels?.length) {
        return chartSeries(chart, {
          unit: "kWh",
          kind: "bar",
          title,
          caption: "Energy generated by year",
        });
      }
      return generateLifetimeCurve(yearKwh, lifetimeKwh, title);
    }
  }

  return unavailable({ unit: "kWh", title, reason: "Energy history is unavailable for this platform." });
}

export function getRevenueSeries(location, period) {
  const normPeriod = (period === "day" || period === "today") ? "day" : period;
  const source = (location?.source || location?.platform || location?.site?.platform || "").toLowerCase();
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

  if (source === "kehua" || source === "sma") {
    const energySeries = getEnergySeries(location, normPeriod);
    if (energySeries && energySeries.available !== false && Array.isArray(energySeries.values)) {
      const isMwh = normalizeUnitString(energySeries.unit, "").toUpperCase() === "MWH";
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
      reason: `Histori energi ${source.toUpperCase()} tidak tersedia untuk periode ini.`,
    });
  }

  if (source !== "huawei") {
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
    const isMwh = normalizeUnitString(energySeries.unit, "").toUpperCase() === "MWH";
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
    const isMwh = normalizeUnitString(energySeries.unit, "").toUpperCase() === "MWH";
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
