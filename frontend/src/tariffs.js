import { useState, useEffect, useCallback, useMemo } from "react";

export const TARIFF_STORAGE_KEY = "plts_tariff_settings_v1";

export const DEFAULT_TARIFF_CATEGORIES = {
  school: {
    id: "school",
    name: "Sekolah & Pendidikan",
    icon: "🏫",
    defaultRate: 900,
    isLocked: true,
    lockNotice: "Tarif tetap Rp 900/kWh (Tarif Sosial S-2/S-3)",
    description: "SDN, SMPN, SMAN, SMKN, PPKD (Tarif Sosial S-2/S-3 PLN - Terkunci)",
  },
  government: {
    id: "government",
    name: "Kantor Pemerintah & Dinas",
    icon: "🏛️",
    defaultRate: 1444.7,
    isLocked: false,
    description: "Dinas, Kantor Camat, Lurah, Walikota, Gedung Teknis (Tarif P-1 PLN)",
  },
  health: {
    id: "health",
    name: "Fasilitas Kesehatan",
    icon: "🏥",
    defaultRate: 1114.74,
    isLocked: false,
    description: "RSUD, Puskesmas, Labkesda (Tarif Pelayanan Kesehatan PLN)",
  },
  public_facility: {
    id: "public_facility",
    name: "Fasilitas Olahraga & Publik",
    icon: "🏟️",
    defaultRate: 1444.7,
    isLocked: false,
    description: "GOR, PPOP, Taman Hutan Kota, Perpustakaan, Gedung Publik (Tarif P-1)",
  },
  other: {
    id: "other",
    name: "Gedung Lainnya",
    icon: "🏢",
    defaultRate: 1444.7,
    isLocked: false,
    description: "Gedung umum non-sekolah lainnya",
  },
};

/**
 * Mendeteksi kategori gedung secara cerdas dari nama stasiun/gedung
 */
export function detectStationCategory(name) {
  const n = (name || "").toLowerCase().trim();
  if (
    n.includes("sdn") ||
    n.includes("sd negeri") ||
    n.includes("sd ") ||
    n.includes("smpn") ||
    n.includes("smp ") ||
    n.includes("sman") ||
    n.includes("sma ") ||
    n.includes("smkn") ||
    n.includes("smk ") ||
    n.includes("ppkd") ||
    n.includes("sekolah") ||
    n.includes("madrasah")
  ) {
    return "school";
  }
  if (
    n.includes("rsud") ||
    n.includes("puskesmas") ||
    n.includes("labkesda") ||
    n.includes("kesehatan") ||
    n.includes("rumah sakit")
  ) {
    return "health";
  }
  if (
    n.includes("dinas") ||
    n.includes("kantor") ||
    n.includes("camat") ||
    n.includes("lurah") ||
    n.includes("bappeda") ||
    n.includes("pmptsp") ||
    n.includes("dppap") ||
    n.includes("upppd") ||
    n.includes("dpe") ||
    n.includes("sudin") ||
    n.includes("suku dinas")
  ) {
    return "government";
  }
  if (
    n.includes("gor") ||
    n.includes("ppop") ||
    n.includes("pertamanan") ||
    n.includes("hutan kota") ||
    n.includes("islamic center") ||
    n.includes("perpustakaan") ||
    n.includes("arsip") ||
    n.includes("knpi") ||
    n.includes("bahtera jaya")
  ) {
    return "public_facility";
  }
  return "other";
}

/**
 * Membaca pengaturan tarif dari localStorage
 */
export function readTariffSettings() {
  const fallback = {
    categoryRates: {
      school: DEFAULT_TARIFF_CATEGORIES.school.defaultRate,
      government: DEFAULT_TARIFF_CATEGORIES.government.defaultRate,
      health: DEFAULT_TARIFF_CATEGORIES.health.defaultRate,
      public_facility: DEFAULT_TARIFF_CATEGORIES.public_facility.defaultRate,
      other: DEFAULT_TARIFF_CATEGORIES.other.defaultRate,
    },
    customRates: {}, // { [stationUid]: number }
  };

  if (typeof window === "undefined" || !window.localStorage) {
    return fallback;
  }

  try {
    const raw = localStorage.getItem(TARIFF_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        categoryRates: {
          ...fallback.categoryRates,
          ...(parsed.categoryRates || {}),
          school: DEFAULT_TARIFF_CATEGORIES.school.defaultRate, // Tetap 900
        },
        customRates: parsed.customRates || {},
      };
    }
  } catch (_) {}

  return fallback;
}

/**
 * Mendapatkan tarif aktif (Rp/kWh) untuk stasiun tertentu
 */
export function getStationTariff(station, tariffConfig = null) {
  if (!station) return 900;
  const cat = detectStationCategory(station.name || station.station_name);

  // 1. Gedung sekolah (SDN, SMPN, SMAN, SMKN, PPKD) dikunci tetap Rp 900/kWh (Tarif Sosial S-2/S-3)
  if (cat === "school") {
    return DEFAULT_TARIFF_CATEGORIES.school.defaultRate;
  }

  const config = tariffConfig || readTariffSettings();
  const id = String(station.station_id || station.station_numeric_id || station.id || "");
  const uid = station.uid || `${station.source || station.platform || ""}-${id}`;

  // 2. Cek custom rate spesifik untuk stasiun non-sekolah ini
  if (config.customRates && config.customRates[uid] !== undefined && Number(config.customRates[uid]) > 0) {
    return Number(config.customRates[uid]);
  }
  if (id && config.customRates && config.customRates[id] !== undefined && Number(config.customRates[id]) > 0) {
    return Number(config.customRates[id]);
  }

  // 3. Cek apakah ada field tariff_per_kwh yang disematkan langsung
  if (station.tariff_per_kwh && Number(station.tariff_per_kwh) > 0) {
    return Number(station.tariff_per_kwh);
  }

  // 4. Gunakan tarif kategori yang telah dikonfigurasi
  if (config.categoryRates && config.categoryRates[cat] !== undefined && Number(config.categoryRates[cat]) > 0) {
    return Number(config.categoryRates[cat]);
  }

  // 5. Default mutlak dari preset
  return DEFAULT_TARIFF_CATEGORIES[cat]?.defaultRate || 1444.7;
}

/**
 * React Hook untuk mengelola pengaturan tarif di frontend
 */
export function useTariffSettings() {
  const [config, setConfig] = useState(() => readTariffSettings());

  const saveSettings = useCallback((newConfig) => {
    const sanitized = {
      ...newConfig,
      categoryRates: {
        ...(newConfig?.categoryRates || {}),
        school: DEFAULT_TARIFF_CATEGORIES.school.defaultRate, // Enforce locked rate
      },
    };
    try {
      localStorage.setItem(TARIFF_STORAGE_KEY, JSON.stringify(sanitized));
    } catch (_) {}
    setConfig(sanitized);
  }, []);

  const updateCategoryRate = useCallback((catId, rate) => {
    if (catId === "school") return; // Tarif sekolah terkunci tetap Rp 900/kWh
    const num = Math.max(1, Number(rate) || 0);
    const updated = {
      ...config,
      categoryRates: {
        ...config.categoryRates,
        school: DEFAULT_TARIFF_CATEGORIES.school.defaultRate,
        [catId]: num,
      },
    };
    saveSettings(updated);
  }, [config, saveSettings]);

  const updateStationRate = useCallback((stationUid, rate) => {
    const num = Number(rate);
    const customRates = { ...(config.customRates || {}) };
    if (!Number.isFinite(num) || num <= 0) {
      delete customRates[stationUid];
    } else {
      customRates[stationUid] = num;
    }
    const updated = {
      ...config,
      customRates,
    };
    saveSettings(updated);
  }, [config, saveSettings]);

  const resetStationRate = useCallback((stationUid) => {
    const customRates = { ...(config.customRates || {}) };
    delete customRates[stationUid];
    const updated = {
      ...config,
      customRates,
    };
    saveSettings(updated);
  }, [config, saveSettings]);

  const resetAllToDefaults = useCallback(() => {
    const defaults = {
      categoryRates: {
        school: DEFAULT_TARIFF_CATEGORIES.school.defaultRate,
        government: DEFAULT_TARIFF_CATEGORIES.government.defaultRate,
        health: DEFAULT_TARIFF_CATEGORIES.health.defaultRate,
        public_facility: DEFAULT_TARIFF_CATEGORIES.public_facility.defaultRate,
        other: DEFAULT_TARIFF_CATEGORIES.other.defaultRate,
      },
      customRates: {},
    };
    saveSettings(defaults);
  }, [saveSettings]);

  return {
    tariffConfig: config,
    saveSettings,
    updateCategoryRate,
    updateStationRate,
    resetStationRate,
    resetAllToDefaults,
  };
}
