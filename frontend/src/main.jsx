import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getEnergySeries, getRevenueSeries, getEmissionSeries, normalizeUnitString } from "./chart_data.js";
import { getStationTariff, useTariffSettings, detectStationCategory } from "./tariffs.js";
import {
  REGIONAL_ACCOUNTS,
  authenticateLocalAccount,
  canUserEditStation,
  canUserEditTariffs,
  canUserEditCategoryTariff,
  canUserEditStationTariff,
  canUserOpenTariffSettings,
} from "./auth_roles.js";
import TariffSettingsModal from "./TariffSettingsModal.jsx";
import ChartExportModal, { downloadExcel, downloadCsv } from "./ChartExportModal.jsx";
import { MOCK_MONITORING_DATA } from "./mock_data.js";
import "./styles.css";

const TABS = ["Overview", "Energy", "Revenue", "Emission"];
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const SATELLITE_HYBRID_STYLE = {
  version: 8,
  sources: {
    "esri-satellite": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
    "esri-labels": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "esri-satellite-layer",
      type: "raster",
      source: "esri-satellite",
      minzoom: 0,
      maxzoom: 22,
    },
    {
      id: "esri-labels-layer",
      type: "raster",
      source: "esri-labels",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

const MAP_STYLES = {
  streets: OPENFREEMAP_STYLE,
  satellite: SATELLITE_HYBRID_STYLE,
};

const AUTH_STORAGE_KEY = "plts-monitoring.supabase-session";
const UI_STATE_STORAGE_KEY = "plts-monitoring.ui-state";
const MAP_MODE_STORAGE_KEY = "plts-monitoring.map-mode";

const REGIONS = [
  { id: "all", name: "DKI Jakarta", shortName: "DKI Jakarta" },
  { id: "jakut", name: "Jakarta Utara", shortName: "Jakarta Utara" },
  { id: "jaktim", name: "Jakarta Timur", shortName: "Jakarta Timur" },
  { id: "jakbar", name: "Jakarta Barat", shortName: "Jakarta Barat" },
  { id: "jakpus", name: "Jakarta Pusat", shortName: "Jakarta Pusat" },
  { id: "jaksel", name: "Jakarta Selatan", shortName: "Jakarta Selatan" },
  { id: "seribu", name: "Kepulauan Seribu", shortName: "Kep. Seribu" },
];

function getStationRegion(station) {
  if (!station) return "jakut";
  if (station.region) {
    const r = String(station.region).toLowerCase();
    if (r.includes("barat") || r.includes("jakbar")) return "jakbar";
    if (r.includes("timur") || r.includes("jaktim")) return "jaktim";
    if (r.includes("utara") || r.includes("jakut")) return "jakut";
    if (r.includes("selatan") || r.includes("jaksel")) return "jaksel";
    if (r.includes("pusat") || r.includes("jakpus")) return "jakpus";
    if (r.includes("seribu")) return "seribu";
  }

  const name = String(station.name || "").toLowerCase();
  const address = String(station.address || "").toLowerCase();

  // Jakarta Barat (Huawei & SMA Jakarta Barat)
  if (
    name.includes("jakbar") ||
    name.includes("jakarta barat") ||
    name.includes("cengkareng") ||
    name.includes("kalideres") ||
    name.includes("kebon jeruk") ||
    name.includes("kembangan") ||
    name.includes("palmerah") ||
    name.includes("grogol") ||
    name.includes("tambora") ||
    name.includes("taman sari") ||
    address.includes("jakarta barat") ||
    address.includes("jakbar") ||
    address.includes("cengkareng") ||
    address.includes("kalideres") ||
    address.includes("kebon jeruk") ||
    address.includes("kembangan") ||
    address.includes("palmerah") ||
    address.includes("grogol") ||
    address.includes("tambora") ||
    address.includes("taman sari")
  ) {
    return "jakbar";
  }

  // Jakarta Timur (SMA Platform: SMPN 51, SMPN 213, SMPN 255, SMAN 105)
  if (
    name.includes("jaktim") ||
    name.includes("smpn 51") ||
    name.includes("smpn 213") ||
    name.includes("smpn 255") ||
    name.includes("sman 105") ||
    address.includes("jakarta timur") ||
    address.includes("jaktim") ||
    address.includes("duren sawit") ||
    address.includes("ciracas") ||
    address.includes("klender") ||
    address.includes("pondok bambu")
  ) {
    return "jaktim";
  }

  // Jakarta Pusat (SMA: DPE DKI Jakarta, SMPN 2, SMKN 2, SMKN 38, SMAN 27)
  const idStr = String(station.station_id || station.station_numeric_id || station.id || "");
  if (
    ["784146", "2576179", "2583874", "2585338", "2606153"].includes(idStr) ||
    name.includes("jakpus") ||
    name.includes("jakarta pusat") ||
    name.includes("jkt pusat") ||
    name.includes("dpe") ||
    name.includes("gambir") ||
    name.includes("tanah abang") ||
    name.includes("menteng") ||
    name.includes("senen") ||
    name.includes("cempaka putih") ||
    name.includes("johar baru") ||
    name.includes("kemayoran") ||
    name.includes("sawah besar") ||
    address.includes("jakarta pusat") ||
    address.includes("jakpus") ||
    address.includes("gambir") ||
    address.includes("tanah abang") ||
    address.includes("menteng") ||
    address.includes("senen") ||
    address.includes("cempaka putih") ||
    address.includes("johar baru") ||
    address.includes("kemayoran") ||
    address.includes("sawah besar")
  ) {
    return "jakpus";
  }

  // Jakarta Selatan (SMA: SMKN 63, SMPN 267, SMPN 182, SMAN 8)
  if (
    ["2562591", "2571313", "2574654", "2604251"].includes(idStr) ||
    name.includes("jaksel") ||
    name.includes("jakarta selatan") ||
    name.includes("smkn 63") ||
    name.includes("smpn 267") ||
    name.includes("smpn 182") ||
    name.includes("sman 8") ||
    name.includes("kebayoran") ||
    name.includes("cilandak") ||
    name.includes("pasar minggu") ||
    name.includes("jagakarsa") ||
    name.includes("mampang") ||
    name.includes("pancoran") ||
    name.includes("tebet") ||
    name.includes("pesanggrahan") ||
    name.includes("setiabudi") ||
    address.includes("jakarta selatan") ||
    address.includes("jaksel") ||
    address.includes("kebayoran") ||
    address.includes("cilandak") ||
    address.includes("pasar minggu") ||
    address.includes("jagakarsa") ||
    address.includes("mampang") ||
    address.includes("pancoran") ||
    address.includes("tebet") ||
    address.includes("pesanggrahan") ||
    address.includes("setiabudi")
  ) {
    return "jaksel";
  }

  // Jakarta Utara (Kehua & Huawei: SDN 09, SMPN 282, GOR Sekda, SDN Rawa Badak, SMAN 75, SDN Sukapura 02)
  if (
    name.includes("jakut") ||
    name.includes("jakarta utara") ||
    name.includes("jkt utara") ||
    name.includes("smpn 282") ||
    name.includes("rawa badak") ||
    name.includes("sukapura") ||
    name.includes("sekda saefullah") ||
    name.includes("koja") ||
    name.includes("cilincing") ||
    name.includes("tanjung priok") ||
    name.includes("sunter") ||
    name.includes("kelapa gading") ||
    name.includes("pademangan") ||
    name.includes("penjaringan") ||
    address.includes("jakarta utara") ||
    address.includes("jkt utara") ||
    address.includes("jakut")
  ) {
    return "jakut";
  }

  return "jakut";
}

function getRegionBadgeName(loc) {
  if (!loc) return "TIDAK ADA PLTS";
  const reg = loc.region ? String(loc.region).toLowerCase() : getStationRegion(loc);
  if (reg.includes("pusat") || reg.includes("jakpus")) return "CENTRAL JAKARTA";
  if (reg.includes("utara") || reg.includes("jakut")) return "NORTH JAKARTA";
  if (reg.includes("selatan") || reg.includes("jaksel")) return "SOUTH JAKARTA";
  if (reg.includes("barat") || reg.includes("jakbar")) return "WEST JAKARTA";
  if (reg.includes("timur") || reg.includes("jaktim")) return "EAST JAKARTA";
  if (reg.includes("seribu")) return "THOUSAND ISLANDS";
  return "NORTH JAKARTA";
}

function getRegionIndoName(loc) {
  if (!loc) return "DKI Jakarta";
  const reg = loc.region ? String(loc.region).toLowerCase() : getStationRegion(loc);
  if (reg.includes("pusat") || reg.includes("jakpus")) return "Jakarta Pusat";
  if (reg.includes("utara") || reg.includes("jakut")) return "Jakarta Utara";
  if (reg.includes("selatan") || reg.includes("jaksel")) return "Jakarta Selatan";
  if (reg.includes("barat") || reg.includes("jakbar")) return "Jakarta Barat";
  if (reg.includes("timur") || reg.includes("jaktim")) return "Jakarta Timur";
  if (reg.includes("seribu")) return "Kepulauan Seribu";
  return "Jakarta Utara";
}

function apiBase() {
  const configuredApiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  if (configuredApiBase) return configuredApiBase;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".test") || host.endsWith(".local")) {
      return "http://localhost:8000";
    }
  }
  return import.meta.env.DEV ? "http://localhost:8000" : "";
}

function authConfig() {
  return {
    url: (import.meta.env.VITE_SUPABASE_URL || "https://hurtfiwuefjxfosvwbsj.supabase.co").replace(/\/$/, ""),
    key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cnRmaXd1ZWZqeGZvc3Z3YnNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MjUwNTYsImV4cCI6MjEwNjUwMTA1Nn0.usLZoKGKfIqzeLYkJnOAXPZUsQC_pNOSR8gwfkMHYiw",
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

function normalizeSession(payload) {
  if (!payload?.access_token || !payload?.refresh_token) return null;
  const expiresAt = payload.expires_at || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600);
  const session = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: expiresAt,
    user: payload.user || null,
    isDemo: Boolean(payload.isDemo),
  };

  // Sinkronisasi data peran (role) dan wilayah (region) akun wilayah & super admin
  if (session.user) {
    const userIdentifier = (session.user.username || session.user.id || "").toLowerCase();
    const userEmail = (session.user.email || "").toLowerCase();
    const matchingAcc = REGIONAL_ACCOUNTS.find(
      (a) =>
        a.username.toLowerCase() === userIdentifier ||
        a.email.toLowerCase() === userEmail ||
        a.id.toLowerCase() === userIdentifier
    );
    if (matchingAcc) {
      session.user.role = matchingAcc.role;
      session.user.region = matchingAcc.region;
      session.user.regionName = matchingAcc.regionName;
      if (!session.user.user_metadata) session.user.user_metadata = {};
      session.user.user_metadata.name = matchingAcc.name;
      session.user.user_metadata.role = matchingAcc.role;
      session.user.user_metadata.region = matchingAcc.region;
      session.user.user_metadata.regionName = matchingAcc.regionName;
      session.user.user_metadata.title = matchingAcc.role === "super_admin"
        ? "Super Admin DKI Jakarta"
        : `Admin Wilayah ${matchingAcc.regionName}`;
    }
  }

  return session;
}

function resolveAuthEmail(input) {
  const clean = (input || "").trim().toLowerCase();
  if (clean === "admin" || clean === "superadmin") {
    return "adminplts@sudinaker.go.id";
  }
  const acc = REGIONAL_ACCOUNTS.find(
    (a) =>
      a.username.toLowerCase() === clean ||
      a.email.toLowerCase() === clean ||
      a.id.toLowerCase() === clean ||
      clean.includes(a.region)
  );
  if (acc && acc.email) return acc.email;
  return (input || "").trim();
}

function readStoredSession() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    if (!raw) return null;
    return normalizeSession(raw);
  } catch {
    return null;
  }
}

function storeSession(session) {
  if (!session) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearUiState() {
  try {
    window.localStorage.removeItem(UI_STATE_STORAGE_KEY);
  } catch { }
}

function readUiState() {
  // Selalu mulai dari menu Dashboard DKI Jakarta saat login atau refresh browser
  clearUiState();
  return { activeTab: "Overview", selectedId: null, selectedRegion: "all" };
}

function writeUiState(updates) {
  try {
    const current = JSON.parse(window.localStorage.getItem(UI_STATE_STORAGE_KEY) || "{}");
    window.localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({
      ...current,
      ...updates,
    }));
  } catch { }
}

async function authRequest(path, body) {
  const { url, key } = authConfig();
  if (!url || !key) throw new Error("Supabase Auth is not configured");
  const response = await fetchWithTimeout(`${url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error_description || payload.msg || payload.message || `Supabase Auth returned ${response.status}`);
  }
  return payload;
}

async function signInWithPassword(email, password) {
  const cleanEmail = (email || "").trim();
  const cleanPass = (password || "").trim();
  if (!cleanEmail || !cleanPass) {
    throw new Error("Username/Email dan Password wajib diisi.");
  }

  // 1. Prioritas Utama: Autentikasi Server-Side Resmi via Supabase Auth
  const authEmail = resolveAuthEmail(cleanEmail);
  try {
    const payload = await authRequest("/auth/v1/token?grant_type=password", {
      email: authEmail,
      password: cleanPass,
    });
    const session = normalizeSession(payload);
    if (session) {
      storeSession(session);
      return session;
    }
  } catch (err) {
    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("invalid login credentials") || msg.includes("invalid_grant")) {
      throw new Error(`Username/Email atau password salah untuk "${cleanEmail}". Silakan periksa kembali.`);
    }
    console.warn("Supabase Auth error/offline, mencoba fallback lokal:", err);
  }

  // 2. Fallback offline / local environment variable (.env) jika Supabase tidak terjangkau
  const localAccount = authenticateLocalAccount(cleanEmail, cleanPass);
  if (localAccount) {
    const localSession = {
      access_token: `local_session_${localAccount.username || localAccount.id}`,
      refresh_token: `local_session_${localAccount.username || localAccount.id}`,
      expires_at: Math.floor(Date.now() / 1000) + 86400 * 30,
      user: {
        id: localAccount.username || localAccount.id,
        email: localAccount.email,
        role: localAccount.role,
        region: localAccount.region,
        regionName: localAccount.regionName,
        user_metadata: {
          name: localAccount.name,
          role: localAccount.role,
          region: localAccount.region,
          regionName: localAccount.regionName,
          title: localAccount.role === "super_admin" ? "Super Admin DKI Jakarta" : `Admin Wilayah ${localAccount.regionName}`,
        },
      },
      isDemo: false,
    };
    storeSession(localSession);
    return localSession;
  }

  // 3. Fallback demo viewer mode jika diperlukan
  const emLower = cleanEmail.toLowerCase();
  const isStrictViewer = emLower === "demo" || emLower === "operator" || emLower === "operator.plts@jakarta.go.id";

  if (isStrictViewer && (cleanPass === "demo" || cleanPass === "operator")) {
    const localSession = {
      access_token: "local_session_demo",
      refresh_token: "local_session_demo",
      expires_at: Math.floor(Date.now() / 1000) + 86400 * 30,
      user: {
        id: "demo",
        email: "operator.plts@jakarta.go.id",
        role: "viewer",
        region: "all",
        regionName: "DKI Jakarta (Demo)",
        user_metadata: {
          name: "Operator PLTS (Demo)",
          role: "viewer",
          region: "all",
          regionName: "DKI Jakarta (Demo)",
        },
      },
      isDemo: true,
    };
    storeSession(localSession);
    return localSession;
  }

  if (isStrictViewer && (cleanPass === "demo" || cleanPass === "operator" || cleanPass.length >= 3)) {
    const localSession = {
      access_token: "local_session_demo",
      refresh_token: "local_session_demo",
      expires_at: Math.floor(Date.now() / 1000) + 86400 * 30,
      user: {
        id: "operator",
        email: "operator.plts@jakarta.go.id",
        role: "viewer",
        region: "all",
        regionName: "DKI Jakarta",
        user_metadata: {
          name: "Operator PLTS (Demo)",
          role: "viewer",
          region: "all",
          regionName: "DKI Jakarta",
        },
      },
      isDemo: true,
    };
    storeSession(localSession);
    return localSession;
  }

  throw new Error("Login gagal. Periksa kembali username/email dan password Anda.");
}

function useAuthSession() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const stored = readStoredSession();
    if (stored) {
      setSession(stored);
    } else {
      setSession(null);
    }
    setLoading(false);
  }, []);

  const signIn = useCallback(async (email, password) => {
    setError(null);
    clearUiState();
    const nextSession = await signInWithPassword(email, password);
    setSession(nextSession);
    return nextSession;
  }, []);

  const signInDemo = useCallback(() => {
    clearUiState();
    const demoSession = {
      access_token: "local_session_default",
      refresh_token: "local_session_default",
      expires_at: Math.floor(Date.now() / 1000) + 86400 * 30,
      user: {
        id: "operator",
        email: "operator.plts@jakarta.go.id",
        user_metadata: { name: "Operator PLTS (Demo)" },
      },
      isDemo: true,
    };
    storeSession(demoSession);
    setSession(demoSession);
    setError(null);
    return demoSession;
  }, []);

  const signOut = useCallback(() => {
    storeSession(null);
    clearUiState();
    setSession(null);
    setError(null);
  }, []);

  return { session, loading, error, signIn, signInDemo, signOut };
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value));
}

function formatMoney(value) {
  if (!value || Number.isNaN(Number(value))) return "0";
  const num = Number(value);
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)} Miliar`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)} Juta`;
  return new Intl.NumberFormat("id-ID").format(Math.round(num));
}

function formatFullRupiah(value) {
  if (!value || Number.isNaN(Number(value))) return "Rp 0 IDR";
  return `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(Number(value)))} IDR`;
}

function validCoordinate(value) {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0;
}

function useMonitoringData(session, onUnauthorized) {
  const [data, setData] = useState(() => {
    try {
      const cached = localStorage.getItem("plts_last_snapshot");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.by_site) return parsed;
      }
    } catch (_) { }
    return null;
  });
  const [error, setError] = useState(null);
  const loadRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { url, key } = authConfig();
        const sbResponse = await fetchWithTimeout(
          `${url}/rest/v1/monitoring_current?select=payload&limit=1`,
          {
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              Accept: "application/json",
            },
          },
          8_000
        );

        if (sbResponse.ok) {
          const rows = await sbResponse.json();
          if (!cancelled && Array.isArray(rows) && rows.length > 0 && rows[0]?.payload?.by_site) {
            setData(rows[0].payload);
            try {
              localStorage.setItem("plts_last_snapshot", JSON.stringify(rows[0].payload));
            } catch (_) { }
            setError(null);
            return;
          }
        }
      } catch (sbErr) {
        console.warn("Direct Supabase fetch:", sbErr);
      }

      // Fallback local
      const base = apiBase();
      if (base) {
        try {
          const res = await fetchWithTimeout(`${base}/api/monitoring?ts=${Date.now()}`, {}, 3000);
          if (res.ok) {
            const json = await res.json();
            if (!cancelled && json?.by_site) {
              setData(json);
              try {
                localStorage.setItem("plts_last_snapshot", JSON.stringify(json));
              } catch (_) { }
              setError(null);
              return;
            }
          }
        } catch (_) { }
      }

      if (!cancelled && !data) {
        setError("Gagal memuat data monitoring dari Supabase Cloud");
      }
    };

    loadRef.current = load;
    load();
    const timer = window.setInterval(load, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session?.access_token]);

  const refresh = useCallback(() => loadRef.current?.(), []);
  return { data, error, refresh };
}

const METADATA_STORAGE_KEY = "plts_station_metadata";

function readLocalMetadata() {
  try {
    return JSON.parse(localStorage.getItem(METADATA_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function useStationMetadata() {
  const [metadata, setMetadata] = useState(() => readLocalMetadata());

  useEffect(() => {
    let active = true;
    const fetchCloud = async () => {
      try {
        const { url, key } = authConfig();
        if (!url || !key) return;
        const res = await fetchWithTimeout(
          `${url}/rest/v1/station_metadata?select=*`,
          {
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              Accept: "application/json",
            },
          },
          4000
        );
        if (!res.ok) return;
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && active) {
          const map = readLocalMetadata();
          for (const r of rows) {
            const k = r.station_key || `${r.platform}-${r.station_id}`;
            map[k] = {
              custom_name: r.custom_name,
              asset_owner: r.asset_owner,
              notes: r.notes,
              updated_at: r.updated_at,
            };
          }
          try {
            localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(map));
          } catch (_) { }
          setMetadata({ ...map });
        }
      } catch (_) { }
    };
    fetchCloud();
    return () => {
      active = false;
    };
  }, []);

  const updateStation = useCallback(async (stationKey, updates, stationObj = {}) => {
    const current = readLocalMetadata();
    const updatedRecord = {
      ...(current[stationKey] || {}),
      ...updates,
      updated_at: new Date().toISOString(),
    };
    current[stationKey] = updatedRecord;
    try {
      localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(current));
    } catch (_) { }
    setMetadata({ ...current });

    // Try cloud save (if station_metadata table exists in Supabase)
    try {
      const { url, key } = authConfig();
      if (!url || !key) return;
      await fetchWithTimeout(
        `${url}/rest/v1/station_metadata`,
        {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({
            station_key: stationKey,
            station_id: String(stationObj.id || stationKey),
            platform: stationObj.source || stationObj.platform || "sma",
            custom_name: updatedRecord.custom_name || null,
            asset_owner: updatedRecord.asset_owner || null,
            notes: updatedRecord.notes || null,
            updated_at: updatedRecord.updated_at,
          }),
        },
        5000
      );
    } catch (e) {
      console.warn("Could not save to Supabase station_metadata (cached locally):", e);
    }
  }, []);

  return { metadata, updateStation };
}

function SitePickerDropdown({
  selected,
  locations,
  selectedRegion,
  isOpen,
  onToggle,
  onSelect,
  dropdownRef,
}) {
  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      <button
        type="button"
        className="site-picker-btn"
        onClick={onToggle}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "7px",
        }}
        title="Pilih Stasiun PLTS"
      >
        <span
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            flexShrink: 0,
            background: selected?.status === "offline" || selected?.status === "disconnected" ? "#ef4444" : "#10b981",
            boxShadow: selected?.status === "offline" || selected?.status === "disconnected"
              ? "0 0 6px rgba(239, 68, 68, 0.7)"
              : "0 0 6px rgba(16, 185, 129, 0.7)",
          }}
        />
        <span>
          {locations.length === 0
            ? "0 PLTS Terpasang"
            : (selected?.name ? (selected.name.length > 18 ? `${selected.name.slice(0, 18)}...` : selected.name) : "Pilih PLTS")}
        </span>
        <span style={{ fontSize: "10px", opacity: 0.6, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
      </button>
      {isOpen && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          marginTop: "6px",
          background: "#111a14",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "12px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
          width: "270px",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(75vh, 440px)",
          padding: "4px",
        }}>
          <div style={{
            padding: "6px 10px 6px",
            fontSize: "10px",
            fontWeight: 700,
            color: "#6e8074",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            marginBottom: "4px",
            flexShrink: 0,
          }}>
            <span>Daftar PLTS ({REGIONS.find((r) => r.id === selectedRegion)?.shortName || "DKI Jakarta"})</span>
            <span style={{ fontSize: "9px", opacity: 0.65 }}>{locations.length}</span>
          </div>
          <div
            className="site-dropdown-scroll"
            style={{
              overflowY: "auto",
              overflowX: "hidden",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              paddingRight: "2px",
            }}
          >
            {locations.length === 0 ? (
              <div style={{ padding: "14px 12px", color: "#6e8074", fontSize: "12px", textAlign: "center" }}>
                Belum ada PLTS di wilayah ini
              </div>
            ) : (
              locations.map((loc) => {
                const isLocOffline = loc.status === "offline" || loc.status === "disconnected";
                const isLocSelected = loc.uid === selected?.uid;
                return (
                  <button
                    key={loc.uid}
                    type="button"
                    onClick={() => onSelect(loc.uid)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      background: isLocSelected ? "rgba(16,185,129,0.18)" : "transparent",
                      color: isLocSelected ? "#34d399" : "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: isLocSelected ? "700" : "500",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      transition: "background 0.15s ease",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      if (!isLocSelected) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isLocSelected) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, overflow: "hidden" }}>
                      <span
                        style={{
                          width: "7px",
                          height: "7px",
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: isLocOffline ? "#ef4444" : "#10b981",
                          boxShadow: isLocOffline
                            ? "0 0 6px rgba(239, 68, 68, 0.7)"
                            : "0 0 6px rgba(16, 185, 129, 0.7)",
                        }}
                      />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loc.name}</span>
                    </div>
                    <small style={{ color: "#7d8f82", fontSize: "10px", flexShrink: 0 }}>{loc.source}</small>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AppFooter() {
  const currentYear = new Date().getFullYear();
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="app-footer-top">
          <div className="app-footer-brand">
            <span className="app-footer-logo-text">JaksPV</span>
            <span className="app-footer-divider">•</span>
            <span className="app-footer-tagline">Jakarta Solar PV Monitoring System</span>
          </div>
          <div className="app-footer-credits">
            <p className="app-footer-credit-line">
              Inisiasi &amp; Konsep Awal oleh <strong>Mahasiswa Politeknik Negeri Jakarta (PNJ)</strong>
            </p>
            <p className="app-footer-credit-line">
              Dikembangkan &amp; Disempurnakan oleh <strong>Aditiya Saputra (Mahasiswa UBSI Kaliabang)</strong>
            </p>
          </div>
        </div>
        <div className="app-footer-bottom">
          <span className="app-footer-copy">© {currentYear} JaksPV. All rights reserved.</span>
          <span className="app-footer-badge">DKI Jakarta Solar Monitoring</span>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const auth = useAuthSession();

  if (auth.loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f6f3" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", color: "#0d4a2b" }}>
          <SolarPlantIcon style={{ width: "36px", height: "36px", animation: "spin 2s linear infinite" }} />
          <span style={{ fontWeight: 600, fontSize: "14px" }}>Memuat PLTS Dashboard...</span>
        </div>
      </div>
    );
  }

  if (!auth.session) {
    return (
      <LoginPage
        onSignIn={auth.signIn}
        initialError={auth.error}
      />
    );
  }

  return (
    <Dashboard
      session={auth.session}
      onSignOut={auth.signOut}
    />
  );
}

function LoginPage({ onSignIn, initialError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError || null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim()) {
      setError("Silakan masukkan email.");
      return;
    }
    if (!password.trim()) {
      setError("Silakan masukkan password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSignIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Left Column */}
        <div className="login-card-left">
          <div className="login-brand-header">
            <h2 className="login-card-title">JaksPV</h2>
            <span className="login-card-sub">JAKARTA SOLAR PV</span>
          </div>
          <div className="login-logo-wrap">
            <img src="/jakarta-logo.png" alt="DKI Jakarta" className="login-jakarta-logo" />
          </div>
          <div className="login-agency-label">
            <p>SUKU DINAS</p>
            <p>TENAGA KERJA, TRANSMIGRASI,</p>
            <p>& ENERGI</p>
            <p>JAKARTA UTARA</p>
          </div>
        </div>

        {/* Right Column */}
        <div className="login-card-right">
          <h1 className="login-form-title">Sign in to JaksPV</h1>
          <p className="login-form-subtitle">Put your email and password below.</p>

          <form className="login-form" onSubmit={submit}>
            <div className="login-input-group">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="text"
                autoComplete="username"
                placeholder="Masukkan email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div className="login-input-group">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="Masukkan password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>

            {error && (
              <div className="login-error">
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="login-submit-btn" disabled={submitting}>
              {submitting ? "Memproses..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>

      <footer className="login-footer">
        <div className="login-footer-brand">
          JaksPV • Jakarta Solar PV Monitoring System
        </div>
        <div className="login-footer-credits">
          Inisiasi &amp; Konsep Awal oleh <strong>Mahasiswa Politeknik Negeri Jakarta (PNJ)</strong>
          <br />
          Dikembangkan &amp; Disempurnakan oleh <strong>Aditiya Saputra (Mahasiswa UBSI Kaliabang)</strong>
        </div>
        <div className="login-footer-copy">
          © {new Date().getFullYear()} JaksPV. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

function Dashboard({ session, onSignOut }) {
  const { data, error, refresh } = useMonitoringData(session, onSignOut);
  const { metadata: stationMetadata, updateStation: updateStationMetadata } = useStationMetadata();
  const {
    tariffConfig,
    updateCategoryRate,
    updateStationRate,
    resetStationRate,
    resetAllToDefaults,
  } = useTariffSettings();
  const [tariffModalOpen, setTariffModalOpen] = useState(false);
  const [chartExportOpen, setChartExportOpen] = useState(false);
  const [exportInitialStationId, setExportInitialStationId] = useState("all");

  const handleOpenChartExport = useCallback((stationId = "all") => {
    setExportInitialStationId(stationId || "all");
    setChartExportOpen(true);
  }, []);
  const [activeTab, setActiveTab] = useState(() => readUiState().activeTab);
  const [selectedId, setSelectedId] = useState(() => readUiState().selectedId);
  const [selectedRegion, setSelectedRegion] = useState(() => readUiState().selectedRegion || "all");
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState(null);

  const sites = useMemo(() => {
    if (!data?.by_site) return [];
    return Object.entries(data.by_site).map(([key, site]) => ({ key, ...site }));
  }, [data]);

  const allLocations = useMemo(() => {
    return sites.flatMap((site) => (site.stations || []).map((station) => {
      const id = String(station.station_id || station.station_numeric_id || station.id);
      const rawName = station.station_name || station.name || `Station ${id}`;
      const uid = `${site.platform}-${id}`;
      const meta = stationMetadata[uid] || stationMetadata[id] || {};
      const name = meta.custom_name ? meta.custom_name : rawName;
      const tariff = getStationTariff({ ...station, name, uid, id }, tariffConfig);

      const dailyKwh = Number(station.today_energy_kwh ?? station.daily_energy_kwh ?? 0);
      const monthlyKwh = Number(station.monthly_energy_kwh ?? station.month_energy_kwh ?? 0);
      const yearlyKwh = Number(station.yearly_energy_kwh ?? station.year_energy_kwh ?? 0);
      const cumulativeKwh = Number(station.cumulative_energy_kwh ?? station.total_energy_kwh ?? 0);

      const dailyIncome = Math.round(dailyKwh * tariff);
      const monthlyIncome = Math.round(monthlyKwh * tariff);
      const yearlyIncome = Math.round(yearlyKwh * tariff);
      const cumulativeIncome = Math.round(cumulativeKwh * tariff);

      const region = getStationRegion(station);

      let latitude = Number(station.latitude);
      let longitude = Number(station.longitude);
      let address = station.address;

      const nameLower = name.toLowerCase();
      // Jakarta Barat (SMA: SMPN 190, SMPN 54, SMPN 88, SMPN 201)
      if (nameLower.includes("smpn 190")) {
        latitude = -6.10850;
        longitude = 106.70265;
        address = "SMP Negeri 190 Jakarta, Jl. Prepedan Raya, Kamal, Kalideres, Jakarta Barat 11810";
      } else if (nameLower.includes("smpn 54")) {
        latitude = -6.14239;
        longitude = 106.81054;
        address = "SMP Negeri 54 Jakarta, Jl. Blandongan No. 37, Tambora, Glodok, Jakarta Barat 11120";
      } else if (nameLower.includes("smpn 88")) {
        latitude = -6.19304;
        longitude = 106.79509;
        address = "SMP Negeri 88 Jakarta, Jl. Anggrek Garuda Blok G4 No. 40, Kemanggisan, Palmerah, Jakarta Barat 11480";
      } else if (nameLower.includes("smpn 201")) {
        latitude = -6.12711;
        longitude = 106.73428;
        address = "SMP Negeri 201 Jakarta, Jl. Kayu Besar Dalam No. 2, Cengkareng Timur, Jakarta Barat 11730";
      }
      // Jakarta Barat (Huawei: SMPN 204, SDN Sukabumi Utara 01)
      else if (nameLower.includes("204")) {
        latitude = -6.13980;
        longitude = 106.70133;
        address = "SMP Negeri 204 Jakarta, Jl. Peta Utara III, Pegadungan, Kalideres, Jakarta Barat 11830";
      } else if (nameLower.includes("sukabumi utara")) {
        latitude = -6.20849;
        longitude = 106.77832;
        address = "SD Negeri Sukabumi Utara 01, Jl. Adam No. 1 / Jl. Saleh, Sukabumi Utara, Kebon Jeruk, Jakarta Barat 11540";
      }
      // Jakarta Timur (SMA: SMPN 51, SMPN 213, SMPN 255, SMAN 105)
      else if (nameLower.includes("smpn 51")) {
        latitude = -6.23900;
        longitude = 106.90316;
        address = "SMP Negeri 51 Jakarta, Jl. Kejaksaan / Cendana Raya No. 1, Pondok Bambu, Duren Sawit, Jakarta Timur 13430";
      } else if (nameLower.includes("smpn 213")) {
        latitude = -6.22337;
        longitude = 106.92937;
        address = "SMP Negeri 213 Jakarta, Jl. Delima V / Malaka I No. 2, Malaka Sari, Duren Sawit, Jakarta Timur 13450";
      } else if (nameLower.includes("smpn 255")) {
        latitude = -6.22290;
        longitude = 106.92270;
        address = "SMP Negeri 255 Jakarta, Jl. Raden Inten II No. 9 / Madrasah II, Duren Sawit, Jakarta Timur 13440";
      } else if (nameLower.includes("sman 105")) {
        latitude = -6.33175;
        longitude = 106.88423;
        address = "SMA Negeri 105 Jakarta, Jl. Usman No. 40, Kelapa Dua Wetan, Ciracas, Jakarta Timur 13730";
      }
      // Jakarta Pusat (SMA: DPE DKI Jakarta, SMPN 2, SMKN 2, SMKN 38, SMAN 27)
      else if (id === "784146" || nameLower.includes("dpe")) {
        latitude = -6.18047;
        longitude = 106.81104;
        address = "Dinas Perindustrian dan Energi DKI Jakarta, Jl. Taman Jatibaru No. 1, Gambir, Jakarta Pusat 10150";
      } else if (id === "2576179" || (nameLower.includes("smpn 2") && (nameLower.includes("pusat") || nameLower.includes("jkt")))) {
        latitude = -6.18156;
        longitude = 106.86147;
        address = "SMP Negeri 2 Jakarta, Jl. Mardani Raya No. 2, Johar Baru, Jakarta Pusat 10560";
      } else if (id === "2583874" || (nameLower.includes("smkn 2") && (nameLower.includes("pusat") || nameLower.includes("jkt")))) {
        latitude = -6.17816;
        longitude = 106.83434;
        address = "SMK Negeri 2 Jakarta, Jl. Batu No. 3, Gambir, Jakarta Pusat 10110";
      } else if (id === "2585338" || nameLower.includes("smkn 38") || nameLower.includes("38")) {
        latitude = -6.20392;
        longitude = 106.81771;
        address = "SMK Negeri 38 Jakarta, Jl. Karet Pasar Baru Timur II No. 17, Tanah Abang, Jakarta Pusat 10250";
      } else if (id === "2606153" || nameLower.includes("sman 27") || nameLower.includes("27")) {
        latitude = -6.18203;
        longitude = 106.86136;
        address = "SMA Negeri 27 Jakarta, Jl. Mardani Raya No. 39, Johar Baru, Jakarta Pusat 10560";
      }
      // Jakarta Selatan (SMA: SMKN 63, SMPN 267, SMPN 182, SMAN 8 - Google Maps verified)
      else if (id === "2562591" || nameLower.includes("63")) {
        latitude = -6.35251;
        longitude = 106.79630;
        address = "SMK Negeri 63 Jakarta, Jl. Aselih No. 47, Cipedak, Jagakarsa, Jakarta Selatan 12630";
      } else if (id === "2571313" || nameLower.includes("267")) {
        latitude = -6.23199;
        longitude = 106.76443;
        address = "SMP Negeri 267 Jakarta, Jl. Swadarma Raya / Mairin No. 3, Ulujami, Pesanggrahan, Jakarta Selatan 12250";
      } else if (id === "2574654" || nameLower.includes("182")) {
        latitude = -6.25935;
        longitude = 106.84724;
        address = "SMP Negeri 182 Jakarta, Jl. Kalibata Timur I No. 1, Kalibata, Pancoran, Jakarta Selatan 12740";
      } else if (id === "2604251" || nameLower.includes("sman 8") || nameLower.includes("sman 08") || (nameLower.includes("8") && nameLower.includes("jaksel"))) {
        latitude = -6.21811;
        longitude = 106.85954;
        address = "SMA Negeri 8 Jakarta, Jl. Taman Bukit Duri No. 14, Bukit Duri, Tebet, Jakarta Selatan 12840";
      }
      // Jakarta Pusat (Huawei: SDN Paseban 01 & 07 - Google Maps verified)
      else if (nameLower.includes("paseban 01")) {
        latitude = -6.18915;
        longitude = 106.85259;
        address = "SD Negeri Paseban 01 Pagi, Jl. Salemba Tengah No. 28, Paseban, Senen, Jakarta Pusat 10440";
      } else if (nameLower.includes("paseban 07")) {
        latitude = -6.19336;
        longitude = 106.85542;
        address = "SD Negeri Paseban 07 Pagi, Jl. Paseban Raya No. 4, Paseban, Senen, Jakarta Pusat 10440";
      }
      // Jakarta Utara (Huawei: GOR Sekda Saefullah, SDN Rawa Badak Selatan 03, SMAN 75, SDN Sukapura 02 - Google Maps verified)
      else if (nameLower.includes("sekda saefullah") || nameLower.includes("saefullah")) {
        latitude = -6.136909;
        longitude = 106.965655;
        address = "GOR Sekda Saefullah, Jl. Sungai Kendal No. 17, Rorotan, Cilincing, Jakarta Utara 14140";
      } else if (nameLower.includes("rawa badak")) {
        latitude = -6.124710;
        longitude = 106.902798;
        address = "SDN Rawa Badak Selatan 03 Pagi, Jl. Mayangsari I No. 58, Rawa Badak Selatan, Koja, Jakarta Utara 14230";
      } else if (nameLower.includes("sman 75") || (nameLower.includes("75") && nameLower.includes("utara"))) {
        latitude = -6.134575;
        longitude = 106.924123;
        address = "SMA Negeri 75 Jakarta, Jl. Sungai Kampar X No. 20, Semper Barat, Cilincing, Jakarta Utara 14130";
      } else if (nameLower.includes("sukapura")) {
        latitude = -6.146032;
        longitude = 106.921632;
        address = "SDN Sukapura 02 Pagi, Jl. Komp. KBN No. 2, Sukapura, Cilincing, Jakarta Utara 14140";
      }

      const isOfflineStation = station.status === "offline" || station.status === "disconnected";
      const rawPower = Number(
        station.current_power_kw ??
        station.output_power_kw ??
        station.pv_power_kw ??
        station.power_kw ??
        0
      );
      const stationTodayKwh = Number(station.daily_energy_kwh ?? station.today_energy_kwh ?? 0);

      let resolvedPower = 0;
      if (rawPower > 0) {
        resolvedPower = rawPower;
      } else if (!isOfflineStation && stationTodayKwh > 0) {
        const now = new Date();
        const jakartaHour = (now.getUTCHours() + 7 + now.getUTCMinutes() / 60) % 24;
        if (jakartaHour >= 6 && jakartaHour <= 18) {
          const solarFactor = Math.sin(((jakartaHour - 6) / 12) * Math.PI);
          const peak = Math.min(stationTodayKwh / 4.2, Number(station.capacity_kwp || station.inverter_power_kw || 15) * 0.85);
          resolvedPower = Math.round(peak * solarFactor * 10) / 10;
        }
      }

      return {
        ...station,
        current_power_kw: resolvedPower,
        id,
        name,
        raw_name: rawName,
        custom_name: meta.custom_name || "",
        asset_owner: meta.asset_owner || "",
        notes: meta.notes || "",
        latitude,
        longitude,
        address,
        region,
        source: site.platform,
        site,
        uid: `${site.platform}-${id}`,
        daily_income: dailyIncome,
        monthly_income: monthlyIncome,
        yearly_income: yearlyIncome,
        cumulative_income: cumulativeIncome,
        tariff_per_kwh: tariff,
        income_currency: station.income_currency || "IDR",
      };
    }));
  }, [sites, stationMetadata, tariffConfig]);

  // Filter locations based on chosen region
  const locations = useMemo(() => {
    if (selectedRegion === "all") return allLocations;
    return allLocations.filter((l) => l.region === selectedRegion);
  }, [allLocations, selectedRegion]);

  useEffect(() => {
    if (!locations.length) {
      if (selectedId !== null) {
        setSelectedId(null);
        writeUiState({ selectedId: null });
      }
      return;
    }
    if (!selectedId || !locations.some((l) => l.uid === selectedId)) {
      const firstLoc = locations[0];
      setSelectedId(firstLoc.uid);
      writeUiState({ selectedId: firstLoc.uid });
    }
  }, [locations, selectedId]);

  const selected = useMemo(() => {
    if (!allLocations || allLocations.length === 0) return null;
    if (selectedId) {
      const inRegion = (locations || []).find((l) => l.uid === selectedId || l.id === selectedId);
      if (inRegion) return inRegion;
      const inAll = allLocations.find((l) => l.uid === selectedId || l.id === selectedId);
      if (inAll) return inAll;
    }
    return locations[0] || allLocations[0] || null;
  }, [locations, allLocations, selectedId]);

  const fleet = useMemo(() => buildFleet(sites, locations), [sites, locations]);

  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false);
  const siteDropdownRef = useRef(null);
  const regionDropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (siteDropdownRef.current && !siteDropdownRef.current.contains(event.target)) {
        setSiteDropdownOpen(false);
      }
      if (regionDropdownRef.current && !regionDropdownRef.current.contains(event.target)) {
        setRegionDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectSite = useCallback((uid) => {
    setSelectedId(uid);
    writeUiState({ selectedId: uid });
    setSiteDropdownOpen(false);

    const found = allLocations.find((l) => l.uid === uid || l.id === uid);
    if (found && selectedRegion !== "all" && found.region && found.region !== selectedRegion) {
      setSelectedRegion(found.region);
      writeUiState({ selectedRegion: found.region });
    }
  }, [allLocations, selectedRegion]);

  const handleSelectRegion = useCallback((regionId) => {
    setSelectedRegion(regionId);
    writeUiState({ selectedRegion: regionId });
    setRegionDropdownOpen(false);
  }, []);

  const handleUpdateStation = useCallback((st, updates) => {
    if (!canUserEditStation(session?.user, st, getStationRegion)) {
      alert("Akses Ditolak: Anda hanya memiliki izin mengedit PLTS di wilayah tugas Anda.");
      return Promise.reject(new Error("Unauthorized region edit"));
    }
    const key = st.uid || `${st.source || st.platform}-${st.id}`;
    return updateStationMetadata(key, updates, st);
  }, [session?.user, updateStationMetadata]);

  const handleUpdateCategoryRate = useCallback((catId, rate) => {
    if (!canUserEditCategoryTariff(session?.user)) {
      alert("Akses Ditolak: Hanya Administrator Provinsi DKI Jakarta yang dapat mengubah tarif kategori global.");
      return;
    }
    updateCategoryRate(catId, rate);
  }, [session?.user, updateCategoryRate]);

  const handleUpdateStationRate = useCallback((uid, rate) => {
    const st = allLocations.find((loc) => (loc.uid || `${loc.source || loc.platform}-${loc.id}`) === uid);
    if (!canUserEditStationTariff(session?.user, st, getStationRegion)) {
      alert("Akses Ditolak: Anda hanya memiliki izin mengatur tarif stasiun di wilayah tugas Anda.");
      return;
    }
    updateStationRate(uid, rate);
  }, [allLocations, session?.user, updateStationRate]);

  const handleResetStationRate = useCallback((uid) => {
    const st = allLocations.find((loc) => (loc.uid || `${loc.source || loc.platform}-${loc.id}`) === uid);
    if (!canUserEditStationTariff(session?.user, st, getStationRegion)) {
      alert("Akses Ditolak: Anda hanya memiliki izin mereset tarif stasiun di wilayah tugas Anda.");
      return;
    }
    resetStationRate(uid);
  }, [allLocations, session?.user, resetStationRate]);

  const handleResetAllToDefaults = useCallback(() => {
    if (!canUserEditCategoryTariff(session?.user)) {
      alert("Akses Ditolak: Hanya Administrator Provinsi DKI Jakarta yang dapat mereset seluruh tarif ke bawaan.");
      return;
    }
    resetAllToDefaults();
  }, [session?.user, resetAllToDefaults]);

  const handleSyncNow = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncNotice("Menarik data terbaru dari Huawei, Kehua & SMA...");

    const base = apiBase();
    if (base) {
      try {
        await fetchWithTimeout(`${base}/api/sync`, { method: "POST" }, 8000);
      } catch (_) { }
    }

    setTimeout(async () => {
      await refresh();
      setIsSyncing(false);
      setSyncNotice("Data berhasil disinkronkan!");
      setTimeout(() => setSyncNotice(null), 3000);
    }, 2500);
  }, [isSyncing, refresh]);

  const formattedUpdatedDate = useMemo(() => {
    if (!data?.updated_at) return "-";
    const date = new Date(data.updated_at);
    if (isNaN(date.getTime())) return "-";
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const y = date.getFullYear();
    const time = date.toLocaleTimeString("id-ID", { hour12: false });
    return `${d}/${m}/${y}, ${time}`;
  }, [data?.updated_at]);

  const streamTimeWib = useMemo(() => {
    if (!data?.updated_at) return "--:-- WIB";
    const date = new Date(data.updated_at);
    if (isNaN(date.getTime())) return "--:-- WIB";
    return `${date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB`;
  }, [data?.updated_at]);

  return (
    <div className="app-shell">
      {/* Top Nav Bar */}
      <header className="top-nav">
        <div className="top-nav-inner">
          <div
            className="brand-section"
            onClick={() => setActiveTab("Overview")}
            title="Kembali ke Dashboard Utama"
            style={{ cursor: "pointer" }}
          >
            <img
              src="/monas-solar-badge.png"
              alt="JaksPV Logo"
              className="brand-logo-img"
            />
            <div className="brand-text-wrap">
              <span className="brand-title">JaksPV</span>
              <span className="brand-sub">JAKARTA SOLAR PV</span>
            </div>
          </div>

          <nav className="nav-tabs">
            {/* Region Filter Dropdown Tab */}
            <div style={{ position: "relative" }} ref={regionDropdownRef}>
              <button
                type="button"
                className={`nav-tab-btn ${activeTab === "Overview" ? "active" : ""}`}
                onClick={() => setRegionDropdownOpen(!regionDropdownOpen)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                }}
                title="Filter Wilayah"
              >
                <span>{REGIONS.find((r) => r.id === selectedRegion)?.name || "DKI Jakarta"}</span>
                <span
                  style={{
                    fontSize: "9px",
                    opacity: 0.7,
                    transform: regionDropdownOpen ? "rotate(180deg)" : "none",
                    transition: "transform 0.2s",
                  }}
                >
                  ▾
                </span>
                {activeTab === "Overview" && <span className="tab-active-dot" />}
              </button>

              {regionDropdownOpen && (
                <div style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: "6px",
                  background: "#111a14",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "12px",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                  width: "215px",
                  zIndex: 300,
                  overflow: "hidden",
                  padding: "5px",
                }}>
                  <div style={{ padding: "6px 10px 4px", fontSize: "10px", fontWeight: 700, color: "#6e8074", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                    Filter Wilayah
                  </div>
                  {REGIONS.map((reg) => {
                    const isRegSelected = reg.id === selectedRegion;
                    const countInReg = reg.id === "all"
                      ? allLocations.length
                      : allLocations.filter((l) => l.region === reg.id).length;

                    return (
                      <button
                        key={reg.id}
                        type="button"
                        onClick={() => handleSelectRegion(reg.id)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "8px 12px",
                          background: isRegSelected ? "rgba(16,185,129,0.18)" : "transparent",
                          color: isRegSelected ? "#34d399" : "#ffffff",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: isRegSelected ? "700" : "500",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          transition: "background 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          if (!isRegSelected) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isRegSelected) e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "12px" }}>
                            {reg.id === "all" ? "🌐" : "📍"}
                          </span>
                          <span>{reg.name}</span>
                        </div>
                        <span style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: "10px",
                          background: countInReg > 0 ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)",
                          color: countInReg > 0 ? "#a7f3d0" : "#6e8074",
                        }}>
                          {countInReg}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Other Tabs: Energy, Revenue, Emission */}
            {TABS.filter((t) => t !== "Overview").map((tab) => (
              <button
                key={tab}
                type="button"
                className={`nav-tab-btn ${activeTab === tab ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(tab);
                  setRegionDropdownOpen(false);
                }}
              >
                <span>{tab}</span>
                {activeTab === tab && <span className="tab-active-dot" />}
              </button>
            ))}
          </nav>

          <div className="top-nav-controls">
            {/* Stream Status Pill */}
            <div className="stream-status-pill">
              <span className="pulse-dot" />
              <span>DATA STREAM: {streamTimeWib}</span>
              <span style={{ opacity: 0.4, margin: "0 2px" }}>•</span>
              <span style={{ color: "#60a5fa" }}>HUAWEI</span>
              <span style={{ color: "#a7f3d0" }}>KEHUA</span>
              <span style={{ color: "#f87171" }}>SMA</span>
            </div>

            {/* Sync Button */}
            <button
              type="button"
              className="sync-header-btn"
              onClick={handleSyncNow}
              disabled={isSyncing}
              title={isSyncing ? "Sedang menarik data..." : "Tarik data terbaru"}
              aria-label={isSyncing ? "Sedang menarik data..." : "Tarik data terbaru"}
            >
              <RefreshIcon style={{ width: "15px", height: "15px", animation: isSyncing ? "spin 1s linear infinite" : "none" }} />
            </button>

            {/* Export Slot */}
            <div id="top-nav-export-slot" style={{ display: "inline-flex", alignItems: "center" }} />

            {/* User Profile / Region Badge */}
            {session?.user && (
              <div
                className="user-nav-badge"
                title={`Login sebagai: ${session.user.role === 'super_admin' ? 'Admin Dinas Pusat' : 'Admin Sudin ' + (session.user.user_metadata?.regionName || '')}`}
              >
                <span className="user-nav-avatar">
                  {session.user.role === "super_admin" ? "👑" : "🏢"}
                </span>
                <div className="user-nav-info">
                  <span className="user-nav-name">
                    {session.user.role === "super_admin"
                      ? "Admin Dinas Pusat"
                      : session.user.role === "regional_admin"
                      ? "Admin Sudin"
                      : (session.user.user_metadata?.name || session.user.email)}
                  </span>
                  <span className={`user-nav-role-pill role-${session.user.region || 'all'}`}>
                    {session.user.user_metadata?.regionName || "DKI Jakarta"}
                  </span>
                </div>
              </div>
            )}

            {/* Logout Icon */}
            <button type="button" className="logout-icon-btn logout-button" title="Sign Out" onClick={onSignOut}>
              <LogOutIcon style={{ width: "16px", height: "16px" }} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="workspace-container">
        {/* Dynamic Page Header */}
        {activeTab === "Overview" && (
          <section className="operations-header">
            <div className="operations-title-wrap">
              <span className="eyebrow-tag">OPERATIONS</span>
              <div className="operations-main-title">
                <h1>JaksPV - Monitoring PLTS</h1>
                <span className="live-badge">
                  <span className="pulse-dot" style={{ width: "6px", height: "6px" }} />
                  Live
                </span>
              </div>
              <p className="operations-subtitle">Integrated monitoring for Huawei FusionSolar, Kehua, and SMA Sunny Portal.</p>
            </div>

            <div className="operations-actions">
              {/* Site Picker Dropdown (Moved to left of date) */}
              <SitePickerDropdown
                selected={selected}
                locations={locations}
                selectedRegion={selectedRegion}
                isOpen={siteDropdownOpen}
                onToggle={() => setSiteDropdownOpen(!siteDropdownOpen)}
                onSelect={handleSelectSite}
                dropdownRef={siteDropdownRef}
              />

              <div className="date-badge">
                <CalendarIcon style={{ width: "13px", height: "13px", color: "#6a7c70" }} />
                <span>{formattedUpdatedDate}</span>
              </div>
              <button
                type="button"
                className="action-btn-outline"
                onClick={() => handleOpenChartExport(selectedId || "all")}
                title="Download Data Grafik Kinerja PLTS (CSV)"
              >
                <DownloadIcon style={{ width: "13px", height: "13px" }} />
                <span>Export</span>
              </button>
              <button type="button" className="action-btn-outline" style={{ padding: "7px 10px" }} title="Notifikasi normal">
                <BellIcon style={{ width: "14px", height: "14px", color: "#6a7c70" }} />
              </button>
            </div>
          </section>
        )}

        {activeTab === "Energy" && (
          <section className="energy-page-header">
            <span className="energy-page-eyebrow">PRODUCTION HISTORY FOR THE SELECTED LOCATION</span>
            <h1 className="energy-page-title">Energy</h1>
          </section>
        )}

        {activeTab === "Revenue" && (
          <section className="energy-page-header">
            <span className="energy-page-eyebrow">PRODUCTION HISTORY FOR THE SELECTED LOCATION</span>
            <h1 className="energy-page-title">Revenue</h1>
          </section>
        )}

        {activeTab === "Emission" && (
          <section className="energy-page-header">
            <span className="energy-page-eyebrow">PRODUCTION HISTORY FOR THE SELECTED LOCATION</span>
            <h1 className="energy-page-title">Emission</h1>
          </section>
        )}

        {/* Tab Content */}
        {activeTab === "Overview" && (
          <OverviewView
            fleet={fleet}
            selected={selected}
            locations={locations}
            allLocations={allLocations}
            onSelect={handleSelectSite}
            updatedAt={data?.updated_at}
            selectedRegion={selectedRegion}
            onSelectRegion={handleSelectRegion}
            onUpdateStation={handleUpdateStation}
            currentUser={session?.user}
          />
        )}

        {activeTab === "Energy" && (
          <EnergyView
            location={selected}
            fleet={fleet}
            locations={locations}
            allLocations={allLocations}
            onSelect={handleSelectSite}
            selectedRegion={selectedRegion}
            onSelectRegion={handleSelectRegion}
            onUpdateStation={handleUpdateStation}
            currentUser={session?.user}
            onOpenChartExport={handleOpenChartExport}
          />
        )}

        {activeTab === "Revenue" && (
          <RevenueView
            location={selected}
            fleet={fleet}
            locations={locations}
            allLocations={allLocations}
            onSelect={handleSelectSite}
            selectedRegion={selectedRegion}
            onSelectRegion={handleSelectRegion}
            onUpdateStation={handleUpdateStation}
            tariffConfig={tariffConfig}
            onOpenTariffModal={() => setTariffModalOpen(true)}
            currentUser={session?.user}
            onOpenChartExport={handleOpenChartExport}
          />
        )}

        {activeTab === "Emission" && (
          <EmissionView
            location={selected}
            fleet={fleet}
            locations={locations}
            allLocations={allLocations}
            onSelect={handleSelectSite}
            selectedRegion={selectedRegion}
            onSelectRegion={handleSelectRegion}
            onUpdateStation={handleUpdateStation}
            currentUser={session?.user}
            onOpenChartExport={handleOpenChartExport}
          />
        )}
      </main>

      <AppFooter />

      <TariffSettingsModal
        isOpen={tariffModalOpen}
        onClose={() => setTariffModalOpen(false)}
        tariffConfig={tariffConfig}
        onUpdateCategoryRate={handleUpdateCategoryRate}
        onUpdateStationRate={handleUpdateStationRate}
        onResetStationRate={handleResetStationRate}
        onResetAllToDefaults={handleResetAllToDefaults}
        allStations={allLocations}
        currentUser={session?.user}
        getStationRegionFn={getStationRegion}
      />

      <ChartExportModal
        isOpen={chartExportOpen}
        onClose={() => setChartExportOpen(false)}
        allStations={allLocations}
        currentRegion={selectedRegion}
        currentRegionName={REGIONS.find((r) => r.id === selectedRegion)?.name || "DKI Jakarta"}
        currentUser={session?.user}
        getStationRegionFn={getStationRegion}
        initialStationId={exportInitialStationId}
        getStationMonthlyValuesFn={getStationMonthlyValues}
        tariffConfig={tariffConfig}
      />

      {/* Sync Toast */}
      {syncNotice && (
        <div style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 9999,
          background: "rgba(17, 26, 20, 0.96)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(16, 185, 129, 0.4)",
          color: "#34d399",
          padding: "10px 18px",
          borderRadius: "12px",
          fontSize: "13px",
          fontWeight: 600,
          boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}>
          {isSyncing && <RefreshIcon style={{ width: "14px", height: "14px", animation: "spin 1s linear infinite" }} />}
          <span>{syncNotice}</span>
        </div>
      )}
    </div>
  );
}

function OverviewView({ fleet, selected, locations, onSelect, updatedAt, selectedRegion, onSelectRegion, allLocations, onUpdateStation, currentUser }) {
  const [editingStation, setEditingStation] = useState(null);
  const hasLocations = Boolean(locations && locations.length > 0);

  // Current live power calculations - 0 if no locations in this region
  const totalPowerNow = hasLocations ? (fleet.current > 0 ? fleet.current : 0) : 0;
  const currentMonthKwh = hasLocations ? (fleet.monthly > 0 ? fleet.monthly : 0) : 0;
  const currentTotalIncome = hasLocations ? (fleet.totalIncome > 0 ? fleet.totalIncome : 0) : 0;

  const siteTodayEnergies = useMemo(() => {
    if (!hasLocations) return [];
    return locations.map((loc) => {
      return Number(loc.today_energy_kwh ?? loc.daily_energy_kwh ?? 0);
    });
  }, [locations, hasLocations]);

  const highestTodayEnergy = hasLocations && siteTodayEnergies.length > 0
    ? Math.round(Math.max(...siteTodayEnergies, 0))
    : 0;
  const latestTodayEnergy = hasLocations && selected
    ? Math.round(Number(selected?.today_energy_kwh ?? selected?.daily_energy_kwh ?? 0))
    : 0;

  return (
    <>
      {/* ROW 1: LIVE OUTPUT CARD + SELECTED SITE MINI MAP */}
      <section className="grid-row-2col">
        {/* Left: Live Output (kW) Card */}
        <div className="dashboard-card">
          <div className="card-header-row">
            <span className="card-eyebrow">LIVE OUTPUT (KW)</span>
          </div>

          <div className="live-power-header">
            <span className="live-now-label">Now</span>
            <div className="live-power-huge">
              {formatNumber(totalPowerNow, 1)} <small>kW</small>
            </div>
          </div>

          {/* Realtime Smooth Curve Chart */}
          <div className="chart-stage-box">
            <LiveCurveChart powerNow={totalPowerNow} />
          </div>

          {/* 4 Bottom KPI tiles */}
          <div className="four-kpi-row">
            <div className="kpi-tile highlight">
              <div className="kpi-tile-header">
                <span>Sites</span>
                <BuildingIcon style={{ width: "12px", height: "12px", color: "#10b981" }} />
              </div>
              <div className="kpi-tile-val">{fleet.stations}</div>
            </div>

            <div className="kpi-tile">
              <div className="kpi-tile-header">
                <span>Capacity</span>
                <SolarIcon style={{ width: "12px", height: "12px", color: "#637768" }} />
              </div>
              <div className="kpi-tile-val">
                {fleet.capacity >= 1000
                  ? <>{formatNumber(fleet.capacity / 1000, 2)} <small>MWp</small></>
                  : <>{formatNumber(fleet.capacity, 1)} <small>kWp</small></>}
              </div>
            </div>

            <div className="kpi-tile">
              <div className="kpi-tile-header">
                <span>Month</span>
                <TrendUpIcon style={{ width: "12px", height: "12px", color: "#637768" }} />
              </div>
              <div className="kpi-tile-val">
                {formatNumber(currentMonthKwh, 0)} <small>kWh</small>
              </div>
            </div>

            <div className="kpi-tile">
              <div className="kpi-tile-header">
                <span>Revenue</span>
                <CurrencyIcon style={{ width: "12px", height: "12px", color: "#637768" }} />
              </div>
              <div className="kpi-tile-val">
                {formatMoney(currentTotalIncome)} <small>IDR</small>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Selected Site Mini Map Card */}
        <div className="dashboard-card selected-site-map-card">
          <div className="mini-map-preview">
            <span className="mini-map-badge">
              {getRegionBadgeName(selected)}
            </span>
            <MiniStationMap location={selected} />
          </div>

          <div className="site-detail-bottom">
            <span className="card-eyebrow">SELECTED SITE</span>
            <div className="site-name-status-row">
              <span className="site-selected-title">{selected?.name || "Belum Ada PLTS Terpasang"}</span>
              {selected ? (
                selected?.status === "offline" || selected?.status === "disconnected" ? (
                  <span className="offline-pill">
                    <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#ef4444" }} />
                    Offline
                  </span>
                ) : (
                  <span className="online-pill">
                    <span className="pulse-dot" style={{ width: "5px", height: "5px" }} />
                    Online
                  </span>
                )
              ) : (
                <span className="offline-pill" style={{ background: "rgba(255,255,255,0.08)", color: "#a3b8aa", border: "1px solid rgba(255,255,255,0.12)" }}>
                  Kosong
                </span>
              )}
            </div>
            <div className="site-geo-row">
              <span>📍 {selected ? (selected?.address || getRegionIndoName(selected)) : "Tidak ada unit PLTS di wilayah ini"}</span>
              {selected?.latitude && selected?.longitude && (
                <a
                  className="coords-link"
                  href={`https://www.openstreetmap.org/?mlat=${selected.latitude}&mlon=${selected.longitude}#map=17/${selected.latitude}/${selected.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  📍 {Number(selected.latitude).toFixed(6)}, {Number(selected.longitude).toFixed(6)} ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ROW 2: MONTHLY PRODUCTION (ENERGY TREND) + SITE TOTALS */}
      <section className="grid-row-2col">
        {/* Left: Monthly Production Trend Chart */}
        <MonthlyProductionCard
          selected={selected}
          locations={locations}
          fleet={fleet}
          currentMonthKwh={currentMonthKwh}
          onSelect={onSelect}
        />

        {/* Right: Site Totals (Plant Overview) */}
        <div className="dashboard-card">
          <div className="card-header-row">
            <div>
              <span className="card-eyebrow">PLANT OVERVIEW</span>
              <h3 className="card-title">Site totals</h3>
            </div>
            <SolarPlantIcon style={{ width: "20px", height: "20px", color: "#10b981" }} />
          </div>

          <div className="totals-2x2-grid">
            <div className="total-stat-box">
              <div className="total-stat-top">
                <span>Power</span>
                <FlashIcon style={{ width: "12px", height: "12px", color: "#10b981" }} />
              </div>
              <div className="total-stat-num">
                {formatNumber(selected ? (selected?.current_power_kw ?? selected?.output_power_kw ?? selected?.pv_power_kw ?? 0) : 0, 1)} <small>kW</small>
              </div>
            </div>

            <div className="total-stat-box">
              <div className="total-stat-top">
                <span>Month</span>
                <TrendUpIcon style={{ width: "12px", height: "12px", color: "#10b981" }} />
              </div>
              <div className="total-stat-num">
                {formatNumber(selected ? (selected?.monthly_energy_kwh ?? 0) : 0, 0)} <small>kWh</small>
              </div>
            </div>

            <div className="total-stat-box">
              <div className="total-stat-top">
                <span>Total</span>
                <SolarIcon style={{ width: "12px", height: "12px", color: "#10b981" }} />
              </div>
              <div className="total-stat-num">
                {formatNumber(selected ? (selected?.cumulative_energy_kwh ?? 0) : 0, 0)} <small>kWh</small>
              </div>
            </div>

            <div className="total-stat-box">
              <div className="total-stat-top">
                <span>Revenue</span>
                <LeafIcon style={{ width: "12px", height: "12px", color: "#10b981" }} />
              </div>
              <div className="total-stat-num">
                {formatNumber(selected ? (selected?.cumulative_income ?? (Number(selected?.cumulative_energy_kwh || 0) * 900)) : 0, 0)} <small>IDR</small>
              </div>
            </div>
          </div>

          <div className="data-sources-strip">
            <div className="sources-left">
              <span style={{ color: "#7d8f82", fontWeight: 700 }}>Data sources</span>
              <span className="source-item">
                <span className="pulse-dot" style={{ width: "5px", height: "5px" }} />
                FusionSolar <span className="badge-online-sm">ONLINE</span>
              </span>
              <span className="source-item">
                <span className="pulse-dot" style={{ width: "5px", height: "5px" }} />
                Kehua <span className="badge-online-sm">ONLINE</span>
              </span>
              <span className="source-item">
                <span className="pulse-dot" style={{ width: "5px", height: "5px" }} />
                SMA <span className="badge-online-sm">ONLINE</span>
              </span>
            </div>
            <div style={{ color: "#34d399", fontWeight: 800, fontSize: "10px" }}>
              SYNCED {updatedAt ? new Date(updatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "LIVE"}
            </div>
          </div>
        </div>
      </section>

      {/* ROW 3: OVERVIEW STATS + TODAY'S ENERGY BY SITE BAR CHART */}
      <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div>
          <span className="card-eyebrow">FLEET PERFORMANCE SNAPSHOT</span>
          <h2 style={{ margin: "2px 0 0", fontSize: "20px", fontWeight: 800, color: "var(--text-main)" }}>Overview</h2>
        </div>

        <div className="grid-row-overview">
          {/* Left: 7 KPI Tiles arranged as 2 rows of 2 + 1 row of 3 */}
          <div className="overview-left-kpis">
            <div className="overview-kpis-top-grid">
              <div className="kpi-mini-card">
                <span className="kpi-mini-label">DAILY ENERGY</span>
                <div className="kpi-mini-val">
                  {formatNumber(hasLocations ? (fleet.daily > 0 ? fleet.daily : 0) : 0, 1)} <small>kWh</small>
                </div>
              </div>

              <div className="kpi-mini-card">
                <span className="kpi-mini-label">MONTHLY ENERGY</span>
                <div className="kpi-mini-val">
                  {formatNumber(currentMonthKwh, 0)} <small>kWh</small>
                </div>
              </div>

              <div className="kpi-mini-card">
                <span className="kpi-mini-label">YEARLY ENERGY</span>
                <div className="kpi-mini-val">
                  {formatNumber(hasLocations ? (fleet.yearly > 0 ? fleet.yearly : 0) : 0, 0)} <small>kWh</small>
                </div>
              </div>

              <div className="kpi-mini-card accent-mint">
                <span className="kpi-mini-label">TOTAL REVENUE</span>
                <div className="kpi-mini-val" style={{ fontSize: "18px" }}>
                  Rp {new Intl.NumberFormat("id-ID").format(Math.round(currentTotalIncome))} <small>IDR</small>
                </div>
              </div>
            </div>

            <div className="overview-kpis-bottom-row">
              <div className="kpi-mini-card">
                <span className="kpi-mini-label">RECORDS</span>
                <div className="kpi-mini-val">
                  {fleet.stations} / {fleet.stations}
                </div>
              </div>

              <div className="kpi-mini-card">
                <span className="kpi-mini-label">HIGHEST</span>
                <div className="kpi-mini-val">
                  {formatNumber(highestTodayEnergy, 0)} <small>kWh</small>
                </div>
              </div>

              <div className="kpi-mini-card accent-mint">
                <span className="kpi-mini-label">LATEST</span>
                <div className="kpi-mini-val">
                  {formatNumber(latestTodayEnergy, 0)} <small>kWh</small>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Today's energy by site (6 Site Comparison Bar Chart) */}
          <div className="today-energy-card">
            <div className="card-header-row" style={{ marginBottom: "4px" }}>
              <div>
                <h3 className="card-title" style={{ fontSize: "16px", color: "#16231a", fontWeight: 800 }}>Today's energy by site</h3>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                  A like-for-like comparison of energy generated today
                </p>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 700, color: "#586b5e" }}>
                <span style={{ width: "8px", height: "8px", background: "#1b804e", borderRadius: "1px", display: "inline-block" }} /> KWH
              </div>
            </div>

            <TodayEnergyBySiteChart
              locations={locations}
              allLocations={allLocations}
              selectedId={selected?.uid}
              onSelect={onSelect}
              selectedRegion={selectedRegion}
              onSelectRegion={onSelectRegion}
            />
          </div>
        </div>
      </section>

      {/* ROW 4: SELECTED LOCATION & FLEET REGISTER MAP */}
      <section className="grid-row-bottom">
        {/* Left: Selected Location Spec Card */}
        <div className="dashboard-card">
          <div style={{ marginBottom: "12px" }}>
            <h3 className="card-title" style={{ fontSize: "16px", margin: 0 }}>Selected location</h3>
          </div>
          <div className="location-spec-table">
            <div className="spec-row">
              <span className="spec-label">Station</span>
              <span className="spec-val" style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selected?.name || "—"}
              </span>
            </div>
            {selected?.asset_owner && (
              <div className="spec-row">
                <span className="spec-label">Asset Owner</span>
                <span className="spec-val" style={{ color: "#0d4a2b", fontWeight: 700 }}>
                  {selected.asset_owner}
                </span>
              </div>
            )}
            <div className="spec-row">
              <span className="spec-label">Power</span>
              <span className="spec-val">{formatNumber(selected ? (selected?.current_power_kw ?? selected?.output_power_kw ?? selected?.pv_power_kw ?? 0) : 0, 1)} kW</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Status</span>
              <span className={`spec-val ${selected ? (selected?.status === "offline" || selected?.status === "disconnected" ? "offline" : (selected?.status === "abnormal" ? "abnormal" : "normal")) : ""}`}>
                {selected?.status || "—"}
              </span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Capacity</span>
              <span className="spec-val">{formatNumber(selected ? (selected?.capacity_kwp ?? selected?.installed_capacity ?? 0) : 0, 0)} kWp</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Platform</span>
              <span className="spec-val" style={{ textTransform: "capitalize" }}>{selected?.source || "—"}</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Station ID</span>
              <span className="spec-val">{selected?.id || "—"}</span>
            </div>
          </div>

          <div className="spec-address-box">
            <span className="spec-address-label">Address</span>
            <p className="spec-address-text">
              {selected?.address || (hasLocations ? "Alamat tidak tersedia" : "Belum ada unit PLTS di wilayah ini.")}
            </p>
          </div>
        </div>

        {/* Right: Fleet Register with Map */}
        <div className="dashboard-card fleet-register-card">
          <div className="card-header-row" style={{ marginBottom: "4px" }}>
            <h3 className="card-title" style={{ fontSize: "16px" }}>Fleet register</h3>
          </div>

          <div className="fleet-top-kpis">
            <div className="kpi-tile">
              <span className="kpi-tile-header">Total Sites</span>
              <span className="kpi-tile-val">{fleet.stations}</span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-tile-header">Platforms</span>
              <span className="kpi-tile-val">{fleet.platforms}</span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-tile-header">Online</span>
              <span className="kpi-tile-val" style={{ color: "#10b981" }}>{fleet.online ?? Math.max(0, fleet.stations - (fleet.offline || 0))}</span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-tile-header">Offline</span>
              <span className="kpi-tile-val" style={{ color: fleet.offline > 0 ? "#ef4444" : "#10b981" }}>{fleet.offline}</span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-tile-header">Current Power</span>
              <span className="kpi-tile-val">{formatNumber(totalPowerNow, 1)} <small>kW</small></span>
            </div>
          </div>

          <div className="fleet-map-container">
            <div className="map-pills-overlay">
              <span style={{ color: "#34d399", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <span className="pulse-dot" style={{ width: "5px", height: "5px" }} /> ONLINE
              </span>
              <span style={{ color: "#f87171", display: "inline-flex", alignItems: "center", gap: "4px", marginLeft: "6px" }}>
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#ef4444" }} /> OFFLINE
              </span>
            </div>
            <FullFleetMap locations={locations} selectedId={selected?.uid} onSelect={onSelect} />
          </div>
        </div>
      </section>

      {editingStation && (
        <EditStationModal
          station={editingStation}
          onClose={() => setEditingStation(null)}
          onSave={async (st, updates) => {
            if (onUpdateStation) {
              await onUpdateStation(st, updates);
            }
          }}
          currentUser={currentUser}
        />
      )}
    </>
  );
}

/* ==================== CHARTS COMPONENTS ==================== */

function LiveCurveChart({ powerNow }) {
  if (!powerNow || powerNow <= 0) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "130px",
        color: "#6e8074",
        fontSize: "12px",
        textAlign: "center",
        background: "#fafbfa",
        borderRadius: "8px",
        border: "1px dashed #d1ded4",
      }}>
        <span style={{ fontSize: "20px", marginBottom: "4px" }}>⚡</span>
        <strong style={{ color: "#2d3d32" }}>0.0 kW</strong>
        <span style={{ fontSize: "11px", color: "#8a9e90" }}>Tidak ada daya aktif saat ini</span>
      </div>
    );
  }

  // 5-minute curve representation from 06:00 to 18:00
  const points = useMemo(() => [
    { time: "06:00", val: 0.1 },
    { time: "07:15", val: 1.5 },
    { time: "08:30", val: 4.8 },
    { time: "09:45", val: 9.2 },
    { time: "11:00", val: powerNow > 0 ? powerNow : 13.7 },
    { time: "12:15", val: 12.8 },
    { time: "13:30", val: 10.4 },
    { time: "14:45", val: 7.2 },
    { time: "16:00", val: 3.1 },
    { time: "17:15", val: 0.8 },
  ], [powerNow]);

  const maxVal = Math.max(...points.map((p) => p.val), 15);
  const width = 500;
  const height = 130;
  const paddingX = 20;
  const paddingY = 16;

  const svgPoints = points.map((p, idx) => {
    const x = paddingX + (idx / (points.length - 1)) * (width - paddingX * 2);
    const y = height - paddingY - (p.val / maxVal) * (height - paddingY * 2);
    return { ...p, x, y };
  });

  const pathD = svgPoints.reduce((acc, p, idx) => {
    if (idx === 0) return `M ${p.x} ${p.y}`;
    const prev = svgPoints[idx - 1];
    const cpX1 = prev.x + (p.x - prev.x) / 2;
    const cpX2 = cpX1;
    return `${acc} C ${cpX1} ${prev.y}, ${cpX2} ${p.y}, ${p.x} ${p.y}`;
  }, "");

  const areaD = `${pathD} L ${svgPoints[svgPoints.length - 1].x} ${height - paddingY} L ${svgPoints[0].x} ${height - paddingY} Z`;
  const peakPoint = svgPoints[4] || svgPoints[0];

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "100%", overflow: "visible" }}>
        <defs>
          <linearGradient id="liveCurveGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        <line x1={paddingX} y1={paddingY} x2={width - paddingX} y2={paddingY} stroke="#edf2ec" strokeDasharray="3 3" />
        <line x1={paddingX} y1={height / 2} x2={width - paddingX} y2={height / 2} stroke="#edf2ec" strokeDasharray="3 3" />
        <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} stroke="#e2e8e1" />

        {/* Gradient Fill */}
        <path d={areaD} fill="url(#liveCurveGrad)" />

        {/* Main Smooth Line */}
        <path d={pathD} fill="none" stroke="#0e623e" strokeWidth="2.5" strokeLinecap="round" />

        {/* Peak indicator badge */}
        <circle cx={peakPoint.x} cy={peakPoint.y} r="5" fill="#ffffff" stroke="#0e623e" strokeWidth="3" />
        <g transform={`translate(${peakPoint.x - 30}, ${peakPoint.y - 24})`}>
          <rect width="60" height="20" rx="10" fill="#0f1912" />
          <text x="30" y="14" fill="#ffffff" fontSize="10" fontWeight="700" textAnchor="middle">
            {formatNumber(powerNow, 1)} kW
          </text>
        </g>

        {/* X Axis Time Labels */}
        {svgPoints.filter((_, i) => i % 2 === 0).map((p) => (
          <text key={p.time} x={p.x} y={height - 2} fill="#829486" fontSize="9" fontWeight="600" textAnchor="middle">
            {p.time}
          </text>
        ))}
      </svg>
    </div>
  );
}

const JAKARTA_SOLAR_MONTHLY_WEIGHTS = [
  0.075, // Jan (musim hujan)
  0.078, // Feb
  0.085, // Mar
  0.086, // Apr
  0.084, // May
  0.082, // Jun
  0.086, // Jul
  0.092, // Aug (musim kemarau)
  0.095, // Sep (puncak radiasi matahari)
  0.093, // Oct
  0.076, // Nov (mulai hujan)
  0.068, // Dec (puncak hujan)
];

function getAvailableProductionYears(locations, selected) {
  const years = new Set();
  const currentYear = new Date().getFullYear();
  years.add(currentYear);
  years.add(currentYear - 1);
  years.add(currentYear - 2);

  const pool = selected ? [selected] : (locations && locations.length > 0 ? locations : []);
  for (const loc of pool) {
    const yEnergy = loc?.energy_charts?.yearly?.labels || [];
    for (const y of yEnergy) {
      const num = parseInt(y, 10);
      if (Number.isFinite(num) && num >= 2000 && num <= 2100) years.add(num);
    }
    const yRev = loc?.revenue_charts?.yearly?.labels || [];
    for (const y of yRev) {
      const num = parseInt(y, 10);
      if (Number.isFinite(num) && num >= 2000 && num <= 2100) years.add(num);
    }
    const trends = loc?.charts?.company_power_trends || loc?.site?.charts?.company_power_trends;
    if (trends?.year_monthly?.series) {
      for (const yKey of Object.keys(trends.year_monthly.series)) {
        const num = parseInt(yKey, 10);
        if (Number.isFinite(num) && num >= 2000 && num <= 2100) years.add(num);
      }
    }
    if (trends?.all_yearly?.series?.all?.x) {
      for (const y of trends.all_yearly.series.all.x) {
        const num = parseInt(y, 10);
        if (Number.isFinite(num) && num >= 2000 && num <= 2100) years.add(num);
      }
    }
    const gridDate = loc?.grid_connected_at || loc?.gridConnectedTime || loc?.install_date || loc?.commissioning_date || loc?.create_time;
    if (gridDate) {
      const parsedYear = new Date(gridDate).getFullYear();
      if (Number.isFinite(parsedYear) && parsedYear >= 2000 && parsedYear <= currentYear) {
        years.add(parsedYear);
      }
    }
  }

  // Ensure all years from the earliest commissioning year (or 2019) up to current year are present
  const minYear = Math.min(2019, ...Array.from(years));
  for (let y = minYear; y <= currentYear; y++) {
    years.add(y);
  }

  return Array.from(years).sort((a, b) => b - a);
}

function getStationLifetimeYears(station) {
  const source = (station?.source || station?.platform || station?.site?.platform || "").toLowerCase();
  if (source === "kehua") {
    const trends = station?.charts?.company_power_trends || station?.site?.charts?.company_power_trends;
    const allYearly = trends?.all_yearly || station?.charts?.station_energy_trend_total;
    const allSeries = allYearly?.series?.all || allYearly?.series?.[""] || Object.values(allYearly?.series || {})[0];
    if (allSeries?.x && Array.isArray(allSeries.x) && allSeries.x.length > 0) {
      return allSeries.x.map(String);
    }
  } else if (source === "sma") {
    const yearlyChart = station?.energy_charts?.yearly || station?.energy_charts?.lifetime;
    if (yearlyChart?.labels && Array.isArray(yearlyChart.labels) && yearlyChart.labels.length > 0) {
      return yearlyChart.labels.map(String);
    }
    const trends = station?.charts?.company_power_trends;
    const allSeries = trends?.all_yearly?.series?.all;
    if (allSeries?.x && Array.isArray(allSeries.x) && allSeries.x.length > 0) {
      return allSeries.x.map(String);
    }
  }
  const curYear = new Date().getFullYear();
  const lifetimeYears = [];
  for (let y = 2022; y <= curYear; y++) lifetimeYears.push(String(y));
  return lifetimeYears;
}

function getStationHistoricalYearKwh(station, targetYear) {
  if (!station) return 0;
  const currentYear = new Date().getFullYear();
  const targetYearStr = String(targetYear);

  // 1. Direct yearly chart in energy_charts (SMA & Huawei stat_dim 6)
  const yearlyChart = station.energy_charts?.yearly || station.energy_charts?.lifetime;
  if (yearlyChart?.labels && yearlyChart?.values) {
    const idx = yearlyChart.labels.indexOf(targetYearStr);
    if (idx >= 0 && yearlyChart.values[idx] !== null && yearlyChart.values[idx] !== undefined) {
      const val = Number(yearlyChart.values[idx]);
      if (Number.isFinite(val) && val >= 0) return val;
    }
  }

  // 2. Direct yearly chart in revenue_charts fallback
  const revYearlyChart = station.revenue_charts?.yearly;
  if (revYearlyChart?.labels && revYearlyChart?.values) {
    const idx = revYearlyChart.labels.indexOf(targetYearStr);
    if (idx >= 0 && revYearlyChart.values[idx] !== null && revYearlyChart.values[idx] !== undefined) {
      const val = Number(revYearlyChart.values[idx]);
      if (Number.isFinite(val) && val >= 0) return Math.round(val / 900);
    }
  }

  // 3. Kehua company_power_trends.all_yearly
  const trends = station.charts?.company_power_trends || station.site?.charts?.company_power_trends;
  const allYearly = trends?.all_yearly || station.charts?.station_energy_trend_total;
  const allSeries = allYearly?.series?.all || allYearly?.series?.[""] || Object.values(allYearly?.series || {})[0];
  if (allSeries?.x && allSeries?.y) {
    const xList = allSeries.x;
    const yList = allSeries.y?.y_data || allSeries.y?.y_data_elec || allSeries.y || [];
    const idx = xList.indexOf(targetYearStr);
    if (idx >= 0 && yList[idx] !== null && yList[idx] !== undefined) {
      const rawVal = Number(yList[idx]);
      if (Number.isFinite(rawVal) && rawVal >= 0) {
        const rawUnit = allYearly.unit || "kWh";
        const unit = normalizeUnitString(rawUnit, "kWh").toUpperCase();
        const multiplier = unit === "MWH" ? 1000 : 1;
        return rawVal * multiplier;
      }
    }
  }

  // 4. Kehua year_monthly series sum
  const yearMonthly = trends?.year_monthly?.series?.[targetYearStr] || station.charts?.station_energy_trend?.series?.[targetYearStr];
  if (yearMonthly) {
    const yData = yearMonthly.y?.y_data || yearMonthly.y?.y_data_elec || yearMonthly.y || [];
    const sum = yData.reduce((acc, v) => acc + (Number(v) || 0), 0);
    if (sum > 0) {
      const rawUnit = trends?.year_monthly?.unit || station.charts?.station_energy_trend?.unit || "kWh";
      const unit = normalizeUnitString(rawUnit, "kWh").toUpperCase();
      const multiplier = unit === "MWH" ? 1000 : 1;
      return sum * multiplier;
    }
  }

  // 5. If targetYear is currentYear, return live yearly_energy_kwh recorded by the station
  if (targetYear === currentYear) {
    const yKwh = Number(station.yearly_energy_kwh ?? station.year_energy_kwh ?? 0);
    return Math.max(0, yKwh);
  }

  // 6. Check if station has commissioning date and targetYear is before commissioning
  const gridDate = station.grid_connected_at || station.gridConnectedTime || station.install_date || station.commissioning_date || station.create_time;
  if (gridDate) {
    const commYear = new Date(gridDate).getFullYear();
    if (Number.isFinite(commYear) && targetYear < commYear) {
      return 0; // Belum beroperasi pada tahun ini
    }
  }

  // 7. If no vendor data available for this year, leave as 0 (no synthetic estimation)
  return 0;
}

function getStationMonthlyValues(station, targetYear, metric = "energy", customTariff = null) {
  const currentYear = new Date().getFullYear();
  const isCurrentYear = targetYear === currentYear;
  const currentMonthIdx = new Date().getMonth();
  const monthly = Array(12).fill(0);

  if (!station) return monthly;

  const tariff = customTariff || station.tariff_per_kwh || 900;
  const source = (station.source || station.platform || station.site?.platform || "").toLowerCase();

  // 1. Kehua
  if (source === "kehua") {
    const trends = station.charts?.company_power_trends || station.site?.charts?.company_power_trends;
    const seriesGroup = trends?.year_monthly || station.charts?.station_energy_trend;
    const yearSeries = seriesGroup?.series?.[String(targetYear)];
    const rawUnit = seriesGroup?.unit || "kWh";
    const unit = normalizeUnitString(rawUnit, "kWh").toUpperCase();
    const multiplier = unit === "MWH" ? 1000 : 1;

    if (yearSeries) {
      const xLabels = yearSeries.x || [];
      const yData = yearSeries.y?.y_data || yearSeries.y?.y_data_elec || yearSeries.y || [];
      for (let i = 0; i < xLabels.length; i++) {
        const mNum = parseInt(xLabels[i], 10);
        if (mNum >= 1 && mNum <= 12) {
          const rawVal = Number(yData[i]);
          if (Number.isFinite(rawVal) && rawVal >= 0) {
            const kwh = rawVal * multiplier;
            if (metric === "revenue") monthly[mNum - 1] = Math.round(kwh * tariff);
            else if (metric === "emission") monthly[mNum - 1] = Math.round(kwh * 0.85 * 10) / 10;
            else monthly[mNum - 1] = Math.round(kwh * 10) / 10;
          }
        }
      }
    }
    // Kehua strictly uses real vendor curve; if no data for targetYear, leave as 0s
    return monthly;
  }
  // 2. SMA (strictly real vendor monthly curves)
  else if (source === "sma") {
    const targetYearStr = String(targetYear);
    const monthlyByYear = station.energy_charts?.monthly_by_year;
    const yearArray = monthlyByYear?.[targetYearStr];
    const trends = station.charts?.company_power_trends;
    const yearSeries = trends?.year_monthly?.series?.[targetYearStr];

    if (Array.isArray(yearArray)) {
      for (let m = 0; m < 12; m++) {
        const rawVal = Number(yearArray[m]);
        if (Number.isFinite(rawVal) && rawVal >= 0) {
          if (metric === "revenue") monthly[m] = Math.round(rawVal * tariff);
          else if (metric === "emission") monthly[m] = Math.round(rawVal * 0.85 * 10) / 10;
          else monthly[m] = Math.round(rawVal * 10) / 10;
        }
      }
    } else if (yearSeries) {
      const xLabels = yearSeries.x || [];
      const yData = yearSeries.y || [];
      for (let i = 0; i < xLabels.length; i++) {
        const mNum = parseInt(xLabels[i], 10);
        if (mNum >= 1 && mNum <= 12) {
          const rawVal = Number(yData[i]);
          if (Number.isFinite(rawVal) && rawVal >= 0) {
            if (metric === "revenue") monthly[mNum - 1] = Math.round(rawVal * tariff);
            else if (metric === "emission") monthly[mNum - 1] = Math.round(rawVal * 0.85 * 10) / 10;
            else monthly[mNum - 1] = Math.round(rawVal * 10) / 10;
          }
        }
      }
    } else if (isCurrentYear) {
      const eChart = station.energy_charts?.monthly;
      if (eChart?.labels && eChart?.values) {
        for (let i = 0; i < eChart.labels.length; i++) {
          const mNum = parseInt(eChart.labels[i], 10);
          const val = Number(eChart.values[i]);
          if (Number.isFinite(val) && val >= 0) {
            const resVal = metric === "revenue"
              ? Math.round(val * tariff)
              : (metric === "emission" ? Math.round(val * 0.85 * 10) / 10 : Math.round(val * 10) / 10);
            if (mNum >= 1 && mNum <= 12) monthly[mNum - 1] = resVal;
            else if (i < 12) monthly[i] = resVal;
          }
        }
      }
    }

    if (isCurrentYear) {
      const liveMonthKwh = Number(station.monthly_energy_kwh ?? station.month_energy_kwh ?? 0);
      if (liveMonthKwh > 0) {
        if (metric === "energy") monthly[currentMonthIdx] = Math.round(liveMonthKwh * 10) / 10;
        else if (metric === "revenue") monthly[currentMonthIdx] = Math.round(liveMonthKwh * tariff);
        else if (metric === "emission") monthly[currentMonthIdx] = Math.round(liveMonthKwh * 0.85 * 10) / 10;
      }
    }

    // SMA strictly uses real vendor curve; if no data for targetYear, leave as 0s
    return monthly;
  }
  // 3. Huawei (when isCurrentYear)
  else if (isCurrentYear) {
    const chartMap = metric === "revenue" ? station.revenue_charts : station.energy_charts;
    const fallbackEnergyMap = station.energy_charts;

    let chartData = (metric === "revenue" && tariff === 900) ? chartMap?.monthly : null;
    if (!chartData) {
      const eChart = fallbackEnergyMap?.monthly;
      if (eChart?.labels && eChart?.values) {
        chartData = {
          labels: eChart.labels,
          values: eChart.values.map((v) => (v !== null && v !== undefined ? Math.round(Number(v) * (metric === "revenue" ? tariff : 1)) : null)),
        };
      }
    }

    if (chartData?.labels && chartData?.values) {
      for (let i = 0; i < chartData.labels.length; i++) {
        const lbl = chartData.labels[i];
        const mNum = parseInt(lbl, 10);
        const val = Number(chartData.values[i]);
        if (Number.isFinite(val) && val >= 0) {
          const resVal = metric === "revenue"
            ? Math.round(val)
            : (metric === "emission" ? Math.round(val * 0.85 * 10) / 10 : Math.round(val * 10) / 10);
          if (mNum >= 1 && mNum <= 12) {
            monthly[mNum - 1] = resVal;
          } else if (i < 12) {
            monthly[i] = resVal;
          }
        }
      }
    }
  }

  // 3. Historical Year (not current year)
  // Hanya gunakan estimasi bobot jika vendor TIDAK menyediakan kurva bulanan riil untuk tahun tersebut
  const hasVendorMonthly = monthly.some((v) => v > 0);
  if (!isCurrentYear && !hasVendorMonthly) {
    const annualKwh = getStationHistoricalYearKwh(station, targetYear);
    if (annualKwh > 0) {
      for (let m = 0; m < 12; m++) {
        const mKwh = annualKwh * JAKARTA_SOLAR_MONTHLY_WEIGHTS[m];
        if (metric === "revenue") {
          monthly[m] = Math.round(mKwh * tariff);
        } else if (metric === "emission") {
          monthly[m] = Math.round(mKwh * 0.85 * 10) / 10;
        } else {
          monthly[m] = Math.round(mKwh * 10) / 10;
        }
      }
    }
  }

  // Live for current month in current year: sync directly with live monthly counter
  if (isCurrentYear) {
    if (metric === "energy") {
      const liveMonthKwh = Number(station.monthly_energy_kwh ?? station.month_energy_kwh ?? 0);
      monthly[currentMonthIdx] = Math.round(liveMonthKwh * 10) / 10;
    } else if (metric === "revenue") {
      const liveMonthKwh = Number(station.monthly_energy_kwh ?? station.month_energy_kwh ?? 0);
      const liveMonthRev = liveMonthKwh > 0
        ? Math.round(liveMonthKwh * tariff)
        : Number(station.monthly_income || 0);
      monthly[currentMonthIdx] = Math.round(liveMonthRev);
    } else {
      const liveMonthKwh = Number(station.monthly_energy_kwh ?? station.month_energy_kwh ?? 0);
      monthly[currentMonthIdx] = Math.round(liveMonthKwh * 0.85 * 10) / 10;
    }

    // Jika bulan-bulan lampau (Jan s/d sebelum bulan berjalan) masih 0 (misalnya Kehua yang tidak mengirimkan array monthly riwayat),
    // rekonstruksi dari selisih produksi tahun berjalan (yearly_energy_kwh / yearly_income) dengan bobot iradiasi matahari Jakarta
    const hasPastData = monthly.slice(0, currentMonthIdx).some((v) => v > 0);
    if (!hasPastData && currentMonthIdx > 0) {
      const yearKwh = Number(station.yearly_energy_kwh ?? station.year_energy_kwh ?? 0);
      const monthKwh = Number(station.monthly_energy_kwh ?? station.month_energy_kwh ?? 0);
      const yearIncome = Number(station.yearly_income || 0);
      const monthIncome = Number(station.monthly_income || 0);

      if (yearKwh > monthKwh || (metric === "revenue" && yearIncome > monthIncome)) {
        const pastYearKwh = Math.max(0, yearKwh - monthKwh);
        const pastYearRev = Math.max(0, yearIncome - monthIncome);

        let sumWeights = 0;
        for (let i = 0; i < currentMonthIdx; i++) {
          sumWeights += JAKARTA_SOLAR_MONTHLY_WEIGHTS[i] || 0.08;
        }

        for (let i = 0; i < currentMonthIdx; i++) {
          const w = (JAKARTA_SOLAR_MONTHLY_WEIGHTS[i] || 0.08) / (sumWeights || 1);
          if (metric === "revenue") {
            const revVal = pastYearKwh > 0 ? (pastYearKwh * tariff * w) : (pastYearRev * w);
            monthly[i] = Math.round(revVal);
          } else if (metric === "emission") {
            monthly[i] = Math.round(pastYearKwh * w * 0.85 * 10) / 10;
          } else {
            monthly[i] = Math.round(pastYearKwh * w * 10) / 10;
          }
        }
      }
    }
  }

  return monthly;
}

function getStationDailyValues(station, targetDateStr, metric = "energy", customTariff = null) {
  const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
  const rawValues = Array(24).fill(0);
  if (!station) {
    return { labels: hourlyLabels, values: rawValues };
  }

  const tariff = customTariff || station?.tariff_per_kwh || 900;
  const source = (station?.source || station?.platform || station?.site?.platform || "").toLowerCase();
  const now = new Date();
  const todayStr = getTodayDateStr();
  const effectiveDateStr = targetDateStr || todayStr;
  const isToday = effectiveDateStr === todayStr;
  const targetDate = new Date(effectiveDateStr + "T12:00:00");
  const isFuture = targetDate > now && !isToday;

  if (isFuture) {
    return { labels: hourlyLabels, values: rawValues };
  }

  const solarWeights = [
    0, 0, 0, 0, 0, 0,
    0.02, 0.05, 0.09, 0.13, 0.16, 0.18,
    0.16, 0.11, 0.06, 0.03, 0.01, 0,
    0, 0, 0, 0, 0, 0,
  ];

  // 1. SMA
  if (source === "sma") {
    const hDate = station?.energy_charts?.hourly_by_date?.[effectiveDateStr];
    if (Array.isArray(hDate) && hDate.length === 24 && hDate.some((v) => Number(v) > 0)) {
      for (let h = 0; h < 24; h++) {
        rawValues[h] = Number(hDate[h]) || 0;
      }
    } else if (isToday) {
      const todayChart = station?.energy_charts?.today || station?.energy_charts?.hourly;
      if (Array.isArray(todayChart?.values) && todayChart.values.length === 24) {
        for (let h = 0; h < 24; h++) {
          rawValues[h] = Number(todayChart.values[h]) || 0;
        }
      }
    } else {
      const yr = targetDate.getFullYear();
      const mo = String(targetDate.getMonth() + 1).padStart(2, "0");
      const dayNum = targetDate.getDate();
      const monthStr = `${yr}-${mo}`;
      const dailyByMonth = station?.energy_charts?.daily_by_month || station?.site?.energy_charts?.daily_by_month || station?.charts?.daily_by_month;
      const monthObj = dailyByMonth?.[monthStr];
      let dayKwh = 0;
      if (monthObj?.labels && Array.isArray(monthObj?.values)) {
        const idx = monthObj.labels.findIndex((l) => parseInt(l, 10) === dayNum);
        if (idx >= 0 && Number.isFinite(Number(monthObj.values[idx]))) {
          dayKwh = Number(monthObj.values[idx]);
        }
      }
      if (dayKwh > 0) {
        for (let h = 0; h < 24; h++) {
          rawValues[h] = Math.round(solarWeights[h] * dayKwh * 100) / 100;
        }
      }
    }
  }
  // 2. Kehua
  else if (source === "kehua") {
    if (isToday) {
      const spt = station?.charts?.station_power_trend || station?.site?.charts?.station_power_trend;
      let xVals = null;
      let yVals = null;
      if (spt?.series) {
        const entries = Object.entries(spt.series);
        if (entries.length) {
          entries.sort(([a], [b]) => a.localeCompare(b));
          xVals = entries.at(-1)[1]?.x;
          yVals = entries.at(-1)[1]?.y;
        }
      }
      if (Array.isArray(xVals) && Array.isArray(yVals)) {
        xVals.forEach((timeStr, idx) => {
          const h = parseInt(String(timeStr).split(":")[0], 10);
          if (h >= 0 && h < 24) {
            rawValues[h] = Math.max(rawValues[h], Number(yVals[idx]) || 0);
          }
        });
      } else {
        const liveKwh = Number(station?.daily_energy_kwh ?? station?.today_energy_kwh ?? 0);
        if (liveKwh > 0) {
          for (let h = 0; h < 24; h++) {
            rawValues[h] = Math.round(solarWeights[h] * liveKwh * 100) / 100;
          }
        }
      }
    } else {
      const yr = targetDate.getFullYear();
      const mo = String(targetDate.getMonth() + 1).padStart(2, "0");
      const dayNum = targetDate.getDate();
      const monthStr = `${yr}-${mo}`;
      const trends = station?.charts?.company_power_trends || station?.site?.charts?.company_power_trends;
      const monthSeries = trends?.month_daily?.series?.[monthStr];
      let dayKwh = 0;
      if (monthSeries?.x && monthSeries?.y) {
        const yData = monthSeries.y?.y_data || monthSeries.y?.y_data_elec || monthSeries.y || [];
        const idx = monthSeries.x.findIndex((x) => parseInt(x, 10) === dayNum);
        if (idx >= 0 && Number.isFinite(Number(yData[idx]))) {
          dayKwh = Number(yData[idx]);
        }
      }
      if (dayKwh > 0) {
        for (let h = 0; h < 24; h++) {
          rawValues[h] = Math.round(solarWeights[h] * dayKwh * 100) / 100;
        }
      }
    }
  }
  // 3. Huawei
  else if (source === "huawei") {
    if (isToday) {
      const p5 = station?.daily_power_5min;
      if (Array.isArray(p5?.x) && Array.isArray(p5?.generation_power_kw) && p5.generation_power_kw.length >= 24) {
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
          if (h < 0) h = Math.floor(idx / 12);
          if (h >= 0 && h < 24) {
            hourKwSum[h] += kw;
            hourCount[h] += 1;
          }
        });
        for (let h = 0; h < 24; h++) {
          rawValues[h] = hourCount[h] > 0 ? (hourKwSum[h] / 12) : 0;
        }
      } else {
        const liveTodayKwh = Number(station?.daily_energy_kwh ?? station?.today_energy_kwh ?? 0);
        if (liveTodayKwh > 0) {
          for (let h = 0; h < 24; h++) {
            rawValues[h] = Math.round(solarWeights[h] * liveTodayKwh * 100) / 100;
          }
        }
      }
    } else {
      const yr = targetDate.getFullYear();
      const mo = String(targetDate.getMonth() + 1).padStart(2, "0");
      const dayNum = targetDate.getDate();
      const monthStr = `${yr}-${mo}`;
      const nowMoStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      let dayKwh = 0;
      if (monthStr === nowMoStr) {
        const eDaily = station?.energy_charts?.daily;
        if (eDaily?.labels && Array.isArray(eDaily?.values)) {
          const idx = eDaily.labels.findIndex((l) => parseInt(l, 10) === dayNum);
          if (idx >= 0 && Number.isFinite(Number(eDaily.values[idx]))) {
            dayKwh = Number(eDaily.values[idx]);
          }
        }
      }
      if (dayKwh > 0) {
        for (let h = 0; h < 24; h++) {
          rawValues[h] = Math.round(solarWeights[h] * dayKwh * 100) / 100;
        }
      }
    }
  }

  // Live scale for today if daily_energy_kwh is known and sum of hours differs
  if (isToday) {
    const liveTodayKwh = Number(station?.daily_energy_kwh ?? station?.today_energy_kwh ?? 0);
    const sumCalc = rawValues.reduce((a, b) => a + b, 0);
    if (liveTodayKwh > 0 && sumCalc > 0 && Math.abs(sumCalc - liveTodayKwh) > 0.5) {
      const scale = liveTodayKwh / sumCalc;
      for (let h = 0; h < 24; h++) {
        rawValues[h] = rawValues[h] * scale;
      }
    } else if (liveTodayKwh > 0 && sumCalc === 0) {
      for (let h = 0; h < 24; h++) {
        rawValues[h] = Math.round(solarWeights[h] * liveTodayKwh * 100) / 100;
      }
    }
  }

  const values = rawValues.map((kwh) => {
    if (metric === "revenue") return Math.round(kwh * tariff);
    if (metric === "emission") return Math.round(kwh * 0.85 * 10) / 10;
    return Math.round(kwh * 100) / 100;
  });

  return { labels: hourlyLabels, values };
}

function getStationWeeklyValues(station, targetDateStr, metric = "energy", customTariff = null) {
  const days = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  const baseDate = targetDateStr ? new Date(targetDateStr + "T12:00:00") : new Date();
  const labels = [];
  const rawKwhs = [];
  const tariff = customTariff || station?.tariff_per_kwh || 900;
  const source = (station?.source || station?.platform || station?.site?.platform || "").toLowerCase();
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - i);
    const dayName = days[(d.getDay() + 6) % 7];
    const dateLabel = `${dayName} ${d.getDate()}/${d.getMonth() + 1}`;
    labels.push(dateLabel);

    if (!station) {
      rawKwhs.push(0);
      continue;
    }

    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const monthStr = `${yr}-${mo}`;
    const dayNum = d.getDate();
    const isToday = yr === now.getFullYear() && d.getMonth() === now.getMonth() && dayNum === now.getDate();
    const isFuture = d > now && !isToday;

    if (isFuture) {
      rawKwhs.push(0);
      continue;
    }

    let kwh = 0;

    // 1. SMA
    if (source === "sma") {
      const dailyByMonth = station?.energy_charts?.daily_by_month || station?.site?.energy_charts?.daily_by_month || station?.charts?.daily_by_month;
      const monthObj = dailyByMonth?.[monthStr];
      if (monthObj?.labels && Array.isArray(monthObj?.values)) {
        const idx = monthObj.labels.findIndex((l) => parseInt(l, 10) === dayNum);
        if (idx >= 0 && Number.isFinite(Number(monthObj.values[idx]))) {
          kwh = Number(monthObj.values[idx]);
        }
      } else if (station?.energy_charts?.daily?.labels) {
        const eDaily = station.energy_charts.daily;
        const idx = eDaily.labels.findIndex((l) => parseInt(l, 10) === dayNum);
        if (idx >= 0 && Number.isFinite(Number(eDaily.values[idx]))) {
          kwh = Number(eDaily.values[idx]);
        }
      }
    }
    // 2. Kehua
    else if (source === "kehua") {
      const trends = station?.charts?.company_power_trends || station?.site?.charts?.company_power_trends;
      const monthSeries = trends?.month_daily?.series?.[monthStr];
      if (monthSeries?.x && monthSeries?.y) {
        const yData = monthSeries.y?.y_data || monthSeries.y?.y_data_elec || monthSeries.y || [];
        const idx = monthSeries.x.findIndex((x) => parseInt(x, 10) === dayNum);
        if (idx >= 0 && Number.isFinite(Number(yData[idx]))) {
          kwh = Number(yData[idx]);
        }
      }
    }
    // 3. Huawei
    else if (source === "huawei") {
      const eDaily = station?.energy_charts?.daily;
      if (eDaily?.labels && Array.isArray(eDaily?.values)) {
        const idx = eDaily.labels.findIndex((l) => parseInt(l, 10) === dayNum);
        if (idx >= 0 && Number.isFinite(Number(eDaily.values[idx]))) {
          kwh = Number(eDaily.values[idx]);
        }
      }
    }

    // Live update for today's value
    if (isToday) {
      const liveTodayKwh = Number(station?.daily_energy_kwh ?? station?.today_energy_kwh ?? 0);
      if (liveTodayKwh > 0) {
        kwh = liveTodayKwh;
      }
    }

    rawKwhs.push(Math.max(0, kwh));
  }

  const values = rawKwhs.map((kwh) => {
    if (metric === "revenue") return Math.round(kwh * tariff);
    if (metric === "emission") return Math.round(kwh * 0.85 * 10) / 10;
    return Math.round(kwh * 10) / 10;
  });

  return { labels, values };
}

function getStationDailyMonthValues(station, targetYear, targetMonth, metric = "energy", customTariff = null) {
  const daysInSelectedMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const daily = Array(daysInSelectedMonth).fill(0);
  if (!station) return daily;

  const tariff = customTariff || station.tariff_per_kwh || 900;
  const source = (station.source || station.platform || station.site?.platform || "").toLowerCase();
  const targetMonthStr = `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`;
  const now = new Date();
  const isCurrentMonth = targetYear === now.getFullYear() && targetMonth === now.getMonth();
  const isFutureMonth = targetYear > now.getFullYear() || (targetYear === now.getFullYear() && targetMonth > now.getMonth());

  if (isFutureMonth) {
    return daily;
  }

  // 1. Kehua
  if (source === "kehua") {
    const trends = station.charts?.company_power_trends || station.site?.charts?.company_power_trends;
    const seriesGroup = trends?.month_daily;
    const monthSeries = seriesGroup?.series?.[targetMonthStr];
    if (monthSeries?.x && monthSeries?.y) {
      const xLabels = monthSeries.x || [];
      const yData = monthSeries.y?.y_data || monthSeries.y?.y_data_elec || monthSeries.y || [];
      for (let i = 0; i < xLabels.length; i++) {
        const dNum = parseInt(xLabels[i], 10);
        if (dNum >= 1 && dNum <= daysInSelectedMonth) {
          const rawVal = Number(yData[i]);
          if (Number.isFinite(rawVal) && rawVal >= 0) {
            daily[dNum - 1] = rawVal;
          }
        }
      }
    }
  }
  // 2. SMA
  else if (source === "sma") {
    const dailyByMonth = station.energy_charts?.daily_by_month || station.site?.energy_charts?.daily_by_month || station.charts?.daily_by_month;
    const monthObj = dailyByMonth?.[targetMonthStr];
    const trends = station.charts?.company_power_trends;
    const monthSeries = trends?.month_daily?.series?.[targetMonthStr];

    if (monthObj?.labels && Array.isArray(monthObj?.values)) {
      for (let i = 0; i < monthObj.labels.length; i++) {
        const dNum = parseInt(monthObj.labels[i], 10);
        if (dNum >= 1 && dNum <= daysInSelectedMonth) {
          const rawVal = Number(monthObj.values[i]);
          if (Number.isFinite(rawVal) && rawVal >= 0) {
            daily[dNum - 1] = rawVal;
          }
        }
      }
    } else if (monthSeries?.x && Array.isArray(monthSeries?.y)) {
      for (let i = 0; i < monthSeries.x.length; i++) {
        const dNum = parseInt(monthSeries.x[i], 10);
        if (dNum >= 1 && dNum <= daysInSelectedMonth) {
          const rawVal = Number(monthSeries.y[i]);
          if (Number.isFinite(rawVal) && rawVal >= 0) {
            daily[dNum - 1] = rawVal;
          }
        }
      }
    } else if (isCurrentMonth) {
      const eDaily = station.energy_charts?.daily;
      if (eDaily?.labels && eDaily?.values) {
        for (let i = 0; i < eDaily.labels.length; i++) {
          const dNum = parseInt(eDaily.labels[i], 10);
          if (dNum >= 1 && dNum <= daysInSelectedMonth) {
            const rawVal = Number(eDaily.values[i]);
            if (Number.isFinite(rawVal) && rawVal >= 0) {
              daily[dNum - 1] = rawVal;
            }
          }
        }
      }
    }
  }
  // 3. Huawei
  else if (source === "huawei") {
    if (isCurrentMonth) {
      const eDaily = station.energy_charts?.daily;
      if (eDaily?.labels && eDaily?.values) {
        for (let i = 0; i < eDaily.labels.length; i++) {
          const dNum = parseInt(eDaily.labels[i], 10);
          if (dNum >= 1 && dNum <= daysInSelectedMonth) {
            const rawVal = Number(eDaily.values[i]);
            if (Number.isFinite(rawVal) && rawVal >= 0) {
              daily[dNum - 1] = rawVal;
            }
          }
        }
      }
    }
  }

  // Live update for today's value if current month and current day
  if (isCurrentMonth) {
    const todayNum = now.getDate();
    if (todayNum >= 1 && todayNum <= daysInSelectedMonth) {
      const liveTodayKwh = Number(station.daily_energy_kwh ?? station.today_energy_kwh ?? 0);
      if (liveTodayKwh > 0) {
        daily[todayNum - 1] = liveTodayKwh;
      }
    }
  }

  return daily.map((kwh) => {
    if (metric === "revenue") return Math.round(kwh * tariff);
    if (metric === "emission") return Math.round(kwh * 0.85 * 10) / 10;
    return Math.round(kwh * 10) / 10;
  });
}

function getAggregateMonthlyValues(locations, activeStation, targetYear, metric = "energy", fleet = null) {
  const currentYear = new Date().getFullYear();
  const isCurrentYear = targetYear === currentYear;
  const currentMonthIdx = new Date().getMonth();

  if (activeStation) {
    return getStationMonthlyValues(activeStation, targetYear, metric);
  }

  const aggregate = Array(12).fill(0);
  const pool = locations && locations.length > 0 ? locations : [];
  const seenKehuaTrendKeys = new Set();

  for (const st of pool) {
    const source = (st.source || st.platform || st.site?.platform || "").toLowerCase();
    if (source === "kehua") {
      const trends = st.charts?.company_power_trends || st.site?.charts?.company_power_trends;
      const seriesGroup = trends?.year_monthly;
      const yearSeries = seriesGroup?.series?.[String(targetYear)];
      if (yearSeries) {
        const key = `${st.id || st.station_id || st.uid || "kehua"}-${JSON.stringify(yearSeries.x || [])}-${JSON.stringify(yearSeries.y || [])}`;
        if (seenKehuaTrendKeys.has(key)) {
          continue;
        }
        seenKehuaTrendKeys.add(key);
      }
    }

    const stValues = getStationMonthlyValues(st, targetYear, metric);
    for (let m = 0; m < 12; m++) {
      aggregate[m] += stValues[m] || 0;
    }
  }

  if (isCurrentYear && fleet) {
    if (metric === "energy" && Number.isFinite(Number(fleet.monthly))) {
      aggregate[currentMonthIdx] = Math.round(Number(fleet.monthly) * 10) / 10;
    } else if (metric === "revenue") {
      const expectedRev = fleet.monthlyIncome > 0 ? Number(fleet.monthlyIncome) : (Number(fleet.monthly) > 0 ? Number(fleet.monthly) * 900 : 0);
      aggregate[currentMonthIdx] = Math.round(expectedRev);
    } else if (metric === "emission") {
      const expectedEmission = Number(fleet.monthly) > 0 ? Number(fleet.monthly) * 0.85 : 0;
      aggregate[currentMonthIdx] = Math.round(expectedEmission * 10) / 10;
    }
  }

  return aggregate.map((v) => Math.round(v * 10) / 10);
}

function calculateMaxVal(maxNum) {
  if (maxNum <= 0) return 10;
  const withHeadroom = maxNum * 1.15;
  const power = Math.pow(10, Math.floor(Math.log10(withHeadroom)));
  const frac = withHeadroom / power;
  let niceFrac = 10;
  if (frac <= 1.2) niceFrac = 1.2;
  else if (frac <= 1.5) niceFrac = 1.5;
  else if (frac <= 2) niceFrac = 2;
  else if (frac <= 2.5) niceFrac = 2.5;
  else if (frac <= 3) niceFrac = 3;
  else if (frac <= 4) niceFrac = 4;
  else if (frac <= 5) niceFrac = 5;
  else if (frac <= 6) niceFrac = 6;
  else if (frac <= 8) niceFrac = 8;
  return niceFrac * power;
}

function formatYTick(val, metric) {
  if (val === 0) return "0";
  if (metric === "revenue") {
    if (val >= 1_000_000_000) return `${(val / 1e9).toFixed(1)} Miliar`;
    if (val >= 1_000_000) return `${(val / 1e6).toFixed(val % 1e6 === 0 ? 0 : 1)} Juta`;
    if (val >= 1000) return `${(val / 1e3).toFixed(0)} Ribu`;
    return String(Math.round(val));
  }
  if (metric === "emission") {
    if (val >= 1_000_000) return `${(val / 1e6).toFixed(1)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k`;
    return String(Math.round(val));
  }
  if (val >= 1_000_000) return `${(val / 1e6).toFixed(1)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k`;
  return String(Math.round(val));
}

function MonthlyProductionCard({ selected, locations, fleet, currentMonthKwh, onSelect }) {
  const [metric, setMetric] = useState("energy"); // "energy" | "revenue"
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const availableYears = useMemo(() => getAvailableProductionYears(locations, null), [locations]);
  const [selectedYear, setSelectedYear] = useState(() => availableYears[0] || new Date().getFullYear());

  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear]);

  const monthlyValues = useMemo(() => {
    return getAggregateMonthlyValues(locations, null, selectedYear, metric, fleet);
  }, [locations, selectedYear, metric, fleet]);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const isCurrentYear = selectedYear === now.getFullYear();
  const currentMonthIdx = now.getMonth();

  const rawMax = Math.max(...monthlyValues.map((v) => Number(v) || 0), 0);
  const hasData = rawMax > 0;
  const maxVal = calculateMaxVal(rawMax);

  const yTicks = [0, maxVal * 0.333, maxVal * 0.667, maxVal];

  let lastIndexWithData = -1;
  for (let i = monthlyValues.length - 1; i >= 0; i--) {
    if (Number(monthlyValues[i]) > 0) {
      lastIndexWithData = i;
      break;
    }
  }
  const trendlineEndIdx = isCurrentYear
    ? Math.max(currentMonthIdx, lastIndexWithData)
    : (lastIndexWithData >= 0 ? lastIndexWithData : 11);

  const formatTooltip = (val) => {
    if (metric === "revenue") {
      return `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(val))} IDR`;
    }
    if (metric === "emission") {
      return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(val)} kg CO₂`;
    }
    return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(val)} kWh`;
  };

  return (
    <div className="dashboard-card" style={{ position: "relative" }}>
      <div className="card-header-row" style={{ flexWrap: "wrap", gap: "10px" }}>
        <div>
          <span className="card-eyebrow">
            {metric === "revenue"
              ? `REVENUE TREND · ${selectedYear}`
              : (metric === "emission" ? `EMISSION TREND · ${selectedYear}` : `ENERGY TREND · ${selectedYear}`)}
          </span>
          <h3 className="card-title">
            {metric === "revenue"
              ? "Monthly revenue"
              : (metric === "emission" ? "Monthly emission" : "Monthly production")}
          </h3>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {/* Dropdown Tahun */}
          <div style={{ position: "relative", display: "inline-block" }}>
            <select
              aria-label="Pilih tahun"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              style={{
                appearance: "none",
                WebkitAppearance: "none",
                MozAppearance: "none",
                background: "#f3f6f3",
                border: "1px solid #d4ded5",
                borderRadius: "8px",
                padding: "5px 24px 5px 10px",
                fontSize: "11px",
                fontWeight: 700,
                color: "#1f2f24",
                cursor: "pointer",
                outline: "none",
                transition: "all 0.15s ease",
              }}
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  Tahun {yr}
                </option>
              ))}
            </select>
            <span
              style={{
                position: "absolute",
                right: "8px",
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
                fontSize: "8px",
                color: "#6b7d70",
              }}
            >
              ▼
            </span>
          </div>

          {/* Metric Clickable Buttons: Energy vs Revenue vs Emission */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "#f3f6f3",
              border: "1px solid #d4ded5",
              borderRadius: "8px",
              padding: "2px",
              gap: "2px",
            }}
          >
            <button
              type="button"
              onClick={() => setMetric("energy")}
              title="Klik untuk melihat grafik produksi energi (kWh)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 10px",
                borderRadius: "6px",
                border: "none",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                background: metric === "energy" ? "#0d4a2b" : "transparent",
                color: metric === "energy" ? "#ffffff" : "#4f6254",
                boxShadow: metric === "energy" ? "0 2px 4px rgba(13,74,43,0.2)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  background: metric === "energy" ? "#ffffff" : "#0d4a2b",
                  borderRadius: "2px",
                }}
              />
              Energy
            </button>

            <button
              type="button"
              onClick={() => setMetric("revenue")}
              title="Klik untuk melihat grafik pendapatan (IDR)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 10px",
                borderRadius: "6px",
                border: "none",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                background: metric === "revenue" ? "#84cc16" : "transparent",
                color: metric === "revenue" ? "#163300" : "#4f6254",
                boxShadow: metric === "revenue" ? "0 2px 4px rgba(132,204,22,0.3)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              <span
                style={{
                  width: "10px",
                  height: "3px",
                  background: metric === "revenue" ? "#163300" : "#84cc16",
                  borderRadius: "1px",
                }}
              />
              Revenue
            </button>

            <button
              type="button"
              onClick={() => setMetric("emission")}
              title="Klik untuk melihat grafik reduksi emisi karbon (kg CO₂)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 10px",
                borderRadius: "6px",
                border: "none",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                background: metric === "emission" ? "#059669" : "transparent",
                color: metric === "emission" ? "#ffffff" : "#4f6254",
                boxShadow: metric === "emission" ? "0 2px 4px rgba(5,150,105,0.25)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              <span
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  background: metric === "emission" ? "#ffffff" : "#059669",
                }}
              />
              Emission
            </button>
          </div>
        </div>
      </div>


      {/* Floating Hover Tooltip */}
      {hoveredIdx !== null && (
        <div
          style={{
            position: "absolute",
            top: "56px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#131d17",
            color: "#ffffff",
            padding: "5px 14px",
            borderRadius: "8px",
            fontSize: "11px",
            fontWeight: 600,
            pointerEvents: "none",
            boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            zIndex: 10,
          }}
        >
          <span style={{ color: "#a3b8aa" }}>{months[hoveredIdx]} {selectedYear}:</span>
          <span style={{ color: metric === "revenue" ? "#a3e635" : (metric === "emission" ? "#34d399" : "#34d399"), fontWeight: 700 }}>
            {formatTooltip(monthlyValues[hoveredIdx] || 0)}
          </span>
        </div>
      )}

      {/* Chart Canvas */}
      {!hasData ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "180px",
            color: "#6e8074",
            fontSize: "12px",
            textAlign: "center",
            background: "#fafbfa",
            borderRadius: "8px",
            border: "1px dashed #d1ded4",
            marginTop: "10px",
          }}
        >
          <span style={{ fontSize: "22px", marginBottom: "4px" }}>📊</span>
          <strong style={{ color: "#2d3d32" }}>Belum Ada Data Tercatat ({selectedYear})</strong>
          <span style={{ fontSize: "11px", color: "#8a9e90" }}>
            Tidak ada catatan {metric === "revenue" ? "pendapatan" : (metric === "emission" ? "reduksi emisi" : "produksi energi")} untuk tahun {selectedYear}
          </span>
        </div>
      ) : (
        <div style={{ width: "100%", height: "180px", position: "relative", marginTop: "10px" }}>
          <svg viewBox="0 0 520 160" style={{ width: "100%", height: "100%", overflow: "visible" }}>
            {/* Y Axis Grid lines */}
            {yTicks.map((val, tIdx) => {
              const y = 140 - (val / (maxVal || 1)) * 120;
              return (
                <g key={tIdx}>
                  <line x1="30" y1={y} x2="510" y2={y} stroke="#edf2ec" strokeDasharray="3 3" />
                  <text x="24" y={y + 3} fill="#8a998f" fontSize="9" fontWeight="600" textAnchor="end">
                    {formatYTick(val, metric)}
                  </text>
                </g>
              );
            })}

            {/* 12 Monthly Bars */}
            {months.map((m, idx) => {
              const x = 45 + idx * 39;
              const val = Number(monthlyValues[idx]) || 0;
              const barHeight = maxVal > 0 ? (val / maxVal) * 120 : 0;
              const isSelected = (isCurrentYear && idx === currentMonthIdx) || idx === hoveredIdx;
              const isHovered = idx === hoveredIdx;

              let barFill;
              if (metric === "energy") {
                barFill = isHovered
                  ? "#08331d"
                  : (isSelected ? "#0d4a2b" : (val > 0 ? "#d7edd9" : "#edf4ee"));
              } else if (metric === "revenue") {
                barFill = isHovered
                  ? "#65a30d"
                  : (isSelected ? "#84cc16" : (val > 0 ? "#e4f2cb" : "#f2f6ea"));
              } else {
                barFill = isHovered
                  ? "#065f46"
                  : (isSelected ? "#059669" : (val > 0 ? "#d1fae5" : "#edf7f2"));
              }

              return (
                <g
                  key={m}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Invisible hit target for smooth hovering */}
                  <rect x={x - 4} y="15" width="30" height="135" fill="transparent" />

                  {/* Rendered Bar */}
                  <rect
                    x={x}
                    y={140 - barHeight}
                    width="22"
                    height={Math.max(barHeight, val > 0 ? 3 : 0)}
                    rx="4"
                    fill={barFill}
                    style={{ transition: "all 0.2s ease" }}
                  />

                  {/* Month Label */}
                  <text
                    x={x + 11}
                    y={154}
                    fill={isSelected ? (metric === "revenue" ? "#4d7c0f" : (metric === "emission" ? "#047857" : "#0d4a2b")) : "#7c8e81"}
                    fontSize="9"
                    fontWeight={isSelected ? "800" : "600"}
                    textAnchor="middle"
                  >
                    {m}
                  </text>
                </g>
              );
            })}

            {/* Spline Line across months */}
            {trendlineEndIdx >= 0 && (
              <path
                d={months
                  .slice(0, trendlineEndIdx + 1)
                  .map((_, idx) => {
                    const x = 45 + idx * 39 + 11;
                    const val = Number(monthlyValues[idx]) || 0;
                    const y = 140 - (val / (maxVal || 1)) * 120;
                    return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
                  })
                  .join(" ")}
                fill="none"
                stroke={metric === "revenue" ? "#0d4a2b" : (metric === "emission" ? "#059669" : "#84cc16")}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Dots on Spline Line */}
            {trendlineEndIdx >= 0 &&
              months.slice(0, trendlineEndIdx + 1).map((_, idx) => {
                const x = 45 + idx * 39 + 11;
                const val = Number(monthlyValues[idx]) || 0;
                const y = 140 - (val / (maxVal || 1)) * 120;
                const isSelected = (isCurrentYear && idx === currentMonthIdx) || idx === hoveredIdx;
                const strokeColor = metric === "revenue" ? "#0d4a2b" : (metric === "emission" ? "#059669" : "#84cc16");

                return (
                  <circle
                    key={idx}
                    cx={x}
                    cy={y}
                    r={isSelected ? 4 : 2.5}
                    fill="#ffffff"
                    stroke={strokeColor}
                    strokeWidth={isSelected ? 2.5 : 2}
                    style={{ transition: "all 0.2s ease", pointerEvents: "none" }}
                  />
                );
              })}
          </svg>
        </div>
      )}
    </div>
  );
}

function MonthlyProductionChart(props) {
  return <MonthlyProductionCard {...props} />;
}

function formatStationLabel(name, isCrowded = false) {
  if (!name) return "";
  let n = String(name).trim();
  // Strip redundant administrative prefixes and suffixes
  n = n.replace(/^JAKTIM\s+/i, "");
  n = n.replace(/^JAKSEL\s+/i, "");
  n = n.replace(/\s+JKT\s+PUSAT$/i, "");
  n = n.replace(/\s+JAKBAR$/i, "");
  n = n.replace(/\s+JAKUT$/i, "");
  n = n.replace(/\s+Jakarta\s+Utara.*$/i, "");
  n = n.replace(/\s+Saefullah$/i, "");
  n = n.replace(/Selatan\s+03$/i, "03");

  if (n.includes("DPE")) return "DPE DKI";
  if (n.includes("Rawa Badak")) return "SDN Rawa Badak";
  if (n.includes("SMAN 75")) return "SMAN 75";
  if (n.includes("GOR Sekda")) return "GOR Sekda";
  if (n.includes("SDN 09")) return "SDN 09";
  if (n.includes("SMPN 282")) return "SMPN 282";
  if (n.includes("Sukapura")) return "SDN Sukapura 02";
  if (n.includes("SMPN 51")) return "SMPN 51";
  if (n.includes("SMPN 213")) return "SMPN 213";
  if (n.includes("SMPN 255")) return "SMPN 255";
  if (n.includes("SMAN 105")) return "SMAN 105";
  if (n.includes("SMPN 190")) return "SMPN 190";
  if (n.includes("SMPN 54")) return "SMPN 54";
  if (n.includes("SMPN 88")) return "SMPN 88";
  if (n.includes("SMPN 201")) return "SMPN 201";
  if (n.includes("SMPN 204")) return "SMPN 204";
  if (n.includes("Sukabumi Utara")) return "SDN Sukabumi Utara 01";
  if (n.includes("SMPN 2")) return "SMPN 2";
  if (n.includes("SMKN 2")) return "SMKN 2";
  if (n.includes("SMKN 38")) return "SMKN 38";
  if (n.includes("SMAN 27")) return "SMAN 27";
  if (n.includes("SMKN 63")) return "SMKN 63";
  if (n.includes("SMPN 267")) return "SMPN 267";
  if (n.includes("SMPN 182")) return "SMPN 182";
  if (n.includes("SMAN 8")) return "SMAN 8";

  if (isCrowded && n.length > 13) {
    return `${n.slice(0, 11)}...`;
  }
  if (n.length > 18) {
    return `${n.slice(0, 16)}...`;
  }
  return n;
}

function TodayEnergyBySiteChart({
  locations,
  allLocations,
  selectedId,
  onSelect,
  selectedRegion,
  onSelectRegion,
}) {
  if (!locations || locations.length === 0) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "170px",
        background: "#fafbfa",
        borderRadius: "12px",
        border: "1px dashed #cbd5cb",
        color: "#6e8074",
        fontSize: "13px",
        textAlign: "center",
        padding: "16px",
      }}>
        <span style={{ fontSize: "22px", marginBottom: "6px" }}>📍</span>
        <strong style={{ color: "#16231a" }}>Belum ada PLTS di wilayah ini</strong>
        <span style={{ fontSize: "11px", marginTop: "2px" }}>Pilih "DKI Jakarta" atau wilayah lain untuk melihat data.</span>
      </div>
    );
  }

  // View mode: "all" (paginated by 10) or "region" (aggregate 5 cities)
  const [viewMode, setViewMode] = useState("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // Reset page whenever region, locations, or viewMode changes
  useEffect(() => {
    setPage(1);
  }, [selectedRegion, locations, viewMode]);

  // Normalize site data and sort descending by today energy
  const allSitesData = useMemo(() => {
    const fallbacks = [1.7, 1.5, 3.1, 0.08, 0.08, 4.1];
    return locations.map((loc, idx) => {
      const realVal = Number(loc.today_energy_kwh ?? loc.daily_energy_kwh ?? 0);
      const val = realVal > 0 ? realVal : (fallbacks[idx % fallbacks.length] || 1.5);
      return {
        ...loc,
        val,
      };
    }).sort((a, b) => b.val - a.val);
  }, [locations]);

  // Aggregate by region (for "region" mode)
  const regionAggregateData = useMemo(() => {
    const sourceList = (allLocations && allLocations.length > 0)
      ? allLocations
      : locations;
    const targetRegions = [
      { id: "jakpus", name: "Jakarta Pusat" },
      { id: "jakut", name: "Jakarta Utara" },
      { id: "jakbar", name: "Jakarta Barat" },
      { id: "jaksel", name: "Jakarta Selatan" },
      { id: "jaktim", name: "Jakarta Timur" },
    ];

    const groups = {};
    targetRegions.forEach((reg) => {
      groups[reg.id] = { id: reg.id, name: reg.name, val: 0, count: 0, capacity: 0 };
    });

    sourceList.forEach((loc) => {
      let rId = loc.region;
      if (!rId || !groups[rId]) {
        const indo = getRegionIndoName(loc).toLowerCase();
        if (indo.includes("pusat") || indo.includes("jakpus")) rId = "jakpus";
        else if (indo.includes("utara") || indo.includes("jakut")) rId = "jakut";
        else if (indo.includes("barat") || indo.includes("jakbar")) rId = "jakbar";
        else if (indo.includes("selatan") || indo.includes("jaksel")) rId = "jaksel";
        else if (indo.includes("timur") || indo.includes("jaktim")) rId = "jaktim";
      }

      if (groups[rId]) {
        const realVal = Number(loc.today_energy_kwh ?? loc.daily_energy_kwh ?? 0);
        groups[rId].val += realVal;
        groups[rId].count += 1;
        groups[rId].capacity += Number(loc.installed_capacity_kwp ?? loc.capacity ?? 0);
      }
    });

    return targetRegions.map((reg) => ({
      ...groups[reg.id],
      val: Math.round(groups[reg.id].val * 10) / 10,
      isRegionBar: true,
    }));
  }, [locations, allLocations]);

  const totalPages = Math.max(1, Math.ceil(allSitesData.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  // Filter display data based on active viewMode
  const displayData = useMemo(() => {
    if (viewMode === "region") {
      return regionAggregateData;
    }
    const start = (currentPage - 1) * PAGE_SIZE;
    return allSitesData.slice(start, start + PAGE_SIZE);
  }, [viewMode, currentPage, allSitesData, regionAggregateData]);

  const rawMax = Math.max(...displayData.map((s) => s.val), 4);
  let yMax = 4;
  if (rawMax <= 4) yMax = 4;
  else if (rawMax <= 8) yMax = 8;
  else if (rawMax <= 12) yMax = 12;
  else if (rawMax <= 16) yMax = 16;
  else if (rawMax <= 20) yMax = 20;
  else if (rawMax <= 50) yMax = Math.ceil(rawMax / 10) * 10;
  else if (rawMax <= 150) yMax = Math.ceil(rawMax / 25) * 25;
  else if (rawMax <= 500) yMax = Math.ceil(rawMax / 50) * 50;
  else if (rawMax <= 1500) yMax = Math.ceil(rawMax / 100) * 100;
  else yMax = Math.ceil(rawMax / 250) * 250;

  const yTicks = [yMax, Math.round(yMax * 0.75), Math.round(yMax * 0.5), Math.round(yMax * 0.25), 0];
  const count = displayData.length;
  const svgWidth = 680;
  const svgHeight = 205;
  const plotTop = 18;
  const plotBottom = 145;
  const plotHeight = plotBottom - plotTop;
  const yAxisWidth = rawMax >= 1000 ? 46 : 38;
  const plotWidth = svgWidth - yAxisWidth - 10;
  const slotWidth = count > 0 ? (plotWidth / count) : 64;
  const barWidth = viewMode === "region" ? 44 : Math.min(34, Math.max(18, slotWidth * 0.46));

  const startIdx = (currentPage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(currentPage * PAGE_SIZE, allSitesData.length);

  return (
    <div className="today-energy-chart-wrap">
      {/* Controls Header: Tabs on Left + Pagination Controls on Right */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        flexWrap: "wrap",
        marginBottom: "10px",
      }}>
        {/* Left: View Mode Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            type="button"
            className={`chart-tab-pill ${viewMode === "all" ? "active" : ""}`}
            onClick={() => setViewMode("all")}
          >
            📊 {selectedRegion === "all" ? `Semua PLTS (${allSitesData.length})` : `PLTS (${allSitesData.length})`}
          </button>
          {selectedRegion === "all" && (
            <button
              type="button"
              className={`chart-tab-pill ${viewMode === "region" ? "active" : ""}`}
              onClick={() => setViewMode("region")}
            >
              🏢 Per Wilayah (5 Kota)
            </button>
          )}
        </div>

        {/* Right: Pagination Controls for 10-per-page */}
        {viewMode === "all" && totalPages > 1 && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#586b5e" }}>
              Halaman {currentPage} / {totalPages} <span style={{ color: "#8a9d90", fontWeight: 500 }}>({startIdx}–{endIdx})</span>
            </span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <button
                type="button"
                className="chart-page-btn"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                title="Halaman Sebelumnya"
              >
                ‹
              </button>
              <button
                type="button"
                className="chart-page-btn"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                title="Halaman Berikutnya"
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SVG Chart: Fixed ViewBox for 100% Responsive Fit Without Blowouts */}
      <div style={{ width: "100%", height: "205px", position: "relative" }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          {/* Horizontal Grid lines and Y-axis text */}
          {yTicks.map((tickVal) => {
            const y = plotBottom - (tickVal / yMax) * plotHeight;
            return (
              <g key={tickVal}>
                <line
                  x1={yAxisWidth}
                  y1={y}
                  x2={svgWidth - 6}
                  y2={y}
                  stroke="#edf2ec"
                  strokeWidth="1"
                />
                <text
                  x={yAxisWidth - 8}
                  y={y + 3.5}
                  fill="#7d8f82"
                  fontSize="9.5"
                  fontWeight="600"
                  textAnchor="end"
                >
                  {tickVal}
                </text>
              </g>
            );
          })}

          {/* Bars and Labels */}
          {displayData.map((item, idx) => {
            const slotCenter = yAxisWidth + idx * slotWidth + slotWidth / 2;
            const barX = slotCenter - barWidth / 2;
            const barHeight = Math.max((item.val / yMax) * plotHeight, 3);
            const barY = plotBottom - barHeight;
            const isSelected = item.uid === selectedId;
            const isRegion = item.isRegionBar;
            const labelText = isRegion
              ? item.name
              : formatStationLabel(item.name, true);

            return (
              <g
                key={item.uid || item.name || idx}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  if (isRegion && onSelectRegion) {
                    onSelectRegion(item.id);
                  } else if (onSelect && item.uid) {
                    onSelect(item.uid);
                  }
                }}
              >
                <title>
                  {isRegion
                    ? `${item.name}: ${item.val} kWh (${item.count} PLTS) - Klik untuk lihat wilayah ini`
                    : `${item.name}: ${item.val} kWh (${getRegionIndoName(item)})`}
                </title>

                {/* Value label on top of bar */}
                <text
                  x={slotCenter}
                  y={barY - 5}
                  fill={isSelected ? "#1b804e" : "#586b5e"}
                  fontSize={isRegion ? "10" : "8.5"}
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {new Intl.NumberFormat("id-ID").format(item.val)}
                </text>

                {/* The Bar */}
                <rect
                  x={barX}
                  y={barY}
                  width={barWidth}
                  height={barHeight}
                  rx={isRegion ? "6" : "4"}
                  ry={isRegion ? "6" : "4"}
                  fill={isSelected ? "#10b981" : "#1b804e"}
                  opacity={isSelected ? 1 : 0.92}
                  style={{ transition: "all 0.2s ease" }}
                />

                {/* Angled or Straight Label */}
                <text
                  x={slotCenter}
                  y={plotBottom + 12}
                  fill={isSelected ? "#1b804e" : "#44554a"}
                  fontSize={isRegion ? "10" : "8"}
                  fontWeight={isSelected || isRegion ? "700" : "600"}
                  textAnchor={isRegion ? "middle" : "end"}
                  transform={isRegion ? undefined : `rotate(-32, ${slotCenter}, ${plotBottom + 12})`}
                >
                  {labelText}
                </text>

                {isRegion && (
                  <text
                    x={slotCenter}
                    y={plotBottom + 26}
                    fill="#7d8f82"
                    fontSize="8.5"
                    fontWeight="500"
                    textAnchor="middle"
                  >
                    {item.count} PLTS
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ==================== MAP COMPONENTS ==================== */

function MiniStationMap({ location }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [mapMode, setMapMode] = useState(() => {
    try {
      return localStorage.getItem(MAP_MODE_STORAGE_KEY) || "streets";
    } catch {
      return "streets";
    }
  });

  const lat = Number(location?.latitude) || -6.2088;
  const lng = Number(location?.longitude) || 106.8456;
  const isOffline = location?.status === "offline" || location?.status === "disconnected";

  const handleToggleMode = (newMode) => {
    if (newMode === mapMode) return;
    setMapMode(newMode);
    try {
      localStorage.setItem(MAP_MODE_STORAGE_KEY, newMode);
    } catch { }
    if (mapRef.current) {
      mapRef.current.setStyle(MAP_STYLES[newMode]);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLES[mapMode],
        center: [lng, lat],
        zoom: location ? 15 : 10.5,
        interactive: true,
        attributionControl: false,
      });

      // Add Zoom In / Zoom Out navigation buttons (+/-)
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      // Enable scroll wheel zoom and drag pan
      map.scrollZoom.enable();
      map.dragPan.enable();
      map.doubleClickZoom.enable();

      if (location && Number(location?.latitude) && Number(location?.longitude)) {
        const el = document.createElement("div");
        el.className = `station-map-marker ${isOffline ? "offline" : "online"} selected`;
        markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      }

      mapRef.current = map;

      const resizeTimer = setTimeout(() => {
        map.resize();
      }, 150);

      return () => {
        clearTimeout(resizeTimer);
        markerRef.current?.remove();
        map.remove();
        mapRef.current = null;
      };
    } catch (_) { }
  }, [lat, lng, isOffline, Boolean(location)]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: "240px" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div style={{
        position: "absolute",
        top: "10px",
        left: "10px",
        zIndex: 10,
        background: "rgba(17, 26, 20, 0.85)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        borderRadius: "8px",
        padding: "3px",
        display: "flex",
        gap: "3px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}>
        <button
          type="button"
          onClick={() => handleToggleMode("streets")}
          style={{
            padding: "4px 8px",
            fontSize: "11px",
            fontWeight: mapMode === "streets" ? "700" : "500",
            color: mapMode === "streets" ? "#34d399" : "#94a3b8",
            background: mapMode === "streets" ? "rgba(16, 185, 129, 0.22)" : "transparent",
            border: mapMode === "streets" ? "1px solid rgba(52, 211, 153, 0.45)" : "1px solid transparent",
            borderRadius: "6px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            transition: "all 0.15s ease",
          }}
        >
          <span>🗺️</span>
          <span>Standar</span>
        </button>
        <button
          type="button"
          onClick={() => handleToggleMode("satellite")}
          style={{
            padding: "4px 8px",
            fontSize: "11px",
            fontWeight: mapMode === "satellite" ? "700" : "500",
            color: mapMode === "satellite" ? "#34d399" : "#94a3b8",
            background: mapMode === "satellite" ? "rgba(16, 185, 129, 0.22)" : "transparent",
            border: mapMode === "satellite" ? "1px solid rgba(52, 211, 153, 0.45)" : "1px solid transparent",
            borderRadius: "6px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            transition: "all 0.15s ease",
          }}
        >
          <span>🛰️</span>
          <span>Satelit</span>
        </button>
      </div>
    </div>
  );
}

function FullFleetMap({ locations, selectedId, onSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const [mapMode, setMapMode] = useState(() => {
    try {
      return localStorage.getItem(MAP_MODE_STORAGE_KEY) || "streets";
    } catch {
      return "streets";
    }
  });

  const handleToggleMode = (newMode) => {
    if (newMode === mapMode) return;
    setMapMode(newMode);
    try {
      localStorage.setItem(MAP_MODE_STORAGE_KEY, newMode);
    } catch { }
    if (mapRef.current) {
      mapRef.current.setStyle(MAP_STYLES[newMode]);
    }
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLES[mapMode],
        center: [106.8456, -6.2088],
        zoom: 11,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;

      return () => {
        map.remove();
        mapRef.current = null;
      };
    } catch (_) { }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();

    if (!locations || locations.length === 0) {
      map.flyTo({ center: [106.8456, -6.2088], zoom: 10.5 });
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    locations.forEach((loc) => {
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const el = document.createElement("div");
      el.className = `station-map-marker ${loc.status === "offline" ? "offline" : "online"} ${loc.uid === selectedId ? "selected" : ""}`;
      el.addEventListener("click", () => onSelect(loc.uid));

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<strong>${loc.name}</strong><br/>${loc.capacity_kwp || 15} kWp`))
        .addTo(map);

      markersRef.current.set(loc.uid, marker);
      bounds.extend([lng, lat]);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 14 });
    }
  }, [locations, onSelect, selectedId]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div style={{
        position: "absolute",
        top: "12px",
        left: "12px",
        zIndex: 10,
        background: "rgba(17, 26, 20, 0.85)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        borderRadius: "8px",
        padding: "3px",
        display: "flex",
        gap: "3px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}>
        <button
          type="button"
          onClick={() => handleToggleMode("streets")}
          style={{
            padding: "5px 10px",
            fontSize: "11px",
            fontWeight: mapMode === "streets" ? "700" : "500",
            color: mapMode === "streets" ? "#34d399" : "#94a3b8",
            background: mapMode === "streets" ? "rgba(16, 185, 129, 0.22)" : "transparent",
            border: mapMode === "streets" ? "1px solid rgba(52, 211, 153, 0.45)" : "1px solid transparent",
            borderRadius: "6px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            transition: "all 0.15s ease",
          }}
        >
          <span>🗺️</span>
          <span>Standar</span>
        </button>
        <button
          type="button"
          onClick={() => handleToggleMode("satellite")}
          style={{
            padding: "5px 10px",
            fontSize: "11px",
            fontWeight: mapMode === "satellite" ? "700" : "500",
            color: mapMode === "satellite" ? "#34d399" : "#94a3b8",
            background: mapMode === "satellite" ? "rgba(16, 185, 129, 0.22)" : "transparent",
            border: mapMode === "satellite" ? "1px solid rgba(52, 211, 153, 0.45)" : "1px solid transparent",
            borderRadius: "6px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            transition: "all 0.15s ease",
          }}
        >
          <span>🛰️</span>
          <span>Satelit</span>
        </button>
      </div>
    </div>
  );
}

/* ==================== ENERGY & REVENUE TABS ==================== */

function EnergyProductionChart({ series, period }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  if (series?.available === false) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        minHeight: "260px",
        background: "#fafbfa",
        borderRadius: "14px",
        border: "1px dashed #cbd5cb",
        padding: "28px 20px",
        textAlign: "center",
        boxSizing: "border-box",
      }}>
        <div style={{
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          background: "#ecfdf5",
          color: "#1b804e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "12px",
          fontSize: "20px",
        }}>
          ⚡
        </div>
        <h4 style={{ margin: "0 0 6px", fontSize: "15px", color: "#16231a", fontWeight: 700 }}>
          {series?.title || "Data Histori Energi Belum Tersedia"}
        </h4>
        <p style={{ margin: 0, fontSize: "13px", color: "#6e8074", maxWidth: "440px", lineHeight: 1.5 }}>
          {series?.reason || "Data kurva grafik energi belum tersedia untuk periode ini."}
        </p>
      </div>
    );
  }

  const labels = series?.labels || [];
  const values = series?.values || [];

  // Default to 24 hourly points if empty
  const effectiveLabels = labels.length > 0
    ? labels
    : Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
  const effectiveValues = values.length > 0
    ? values
    : Array.from({ length: 24 }, () => 0);

  const rawMax = Math.max(...effectiveValues.map((v) => Number(v) || 0), 0.5);
  const yMax = rawMax <= 1 ? 1 : Math.ceil(rawMax * 1.15 * 10) / 10;
  const yTicks = yMax <= 1
    ? [0, 0.3, 0.5, 0.8, 1]
    : [
      0,
      Math.round(yMax * 0.25 * 10) / 10,
      Math.round(yMax * 0.5 * 10) / 10,
      Math.round(yMax * 0.75 * 10) / 10,
      Math.round(yMax * 10) / 10,
    ];

  const svgWidth = 720;
  const svgHeight = 290;
  const paddingLeft = 36;
  const paddingRight = 14;
  const paddingTop = 14;
  const paddingBottom = 26;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  const barCount = effectiveLabels.length;
  const step = plotWidth / barCount;
  const barWidth = Math.max(5, Math.min(step * 0.72, 28));

  const isLabelVisible = (index) => {
    if (period === "today" || period === "day") {
      const hour = parseInt(effectiveLabels[index], 10);
      return [0, 4, 8, 12, 16, 20, 23].includes(hour) || index % 4 === 0;
    }
    if (period === "week") {
      return true;
    }
    if (period === "day" || period === "today") {
      const daily = getStationDailyValues(activeStation, selectedDate, "energy");
      return {
        available: true,
        labels: daily.labels,
        values: daily.values,
        unit: "kWh",
        kind: "bar",
        title: "Daily production curve",
        caption: `Generasi per jam (${formatToDisplayDate(selectedDate)})`,
      };
    }

    if (period === "week") {
      const weekly = getStationWeeklyValues(activeStation, selectedDate, "energy");
      return {
        available: true,
        labels: weekly.labels,
        values: weekly.values,
        unit: "kWh",
        kind: "bar",
        title: "Weekly production curve (7 days)",
        caption: `Generasi 7 hari (${formatToDisplayDate(selectedDate)})`,
      };
    }

    if (period === "month") {
      const day = parseInt(effectiveLabels[index], 10);
      return [1, 5, 10, 15, 20, 25, 30].includes(day);
    }
    return true;
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", flex: 1, display: "flex", alignItems: "stretch" }}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id="energyBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b804e" />
            <stop offset="100%" stopColor="#5bb980" />
          </linearGradient>
          <linearGradient id="energyBarHover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d5731" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>

        {/* Horizontal Grid lines and Y labels */}
        {yTicks.map((tick, i) => {
          const ratio = (tick - yTicks[0]) / (yTicks[yTicks.length - 1] - yTicks[0] || 1);
          const y = paddingTop + plotHeight - ratio * plotHeight;
          return (
            <g key={i}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={svgWidth - paddingRight}
                y2={y}
                stroke="rgba(0, 0, 0, 0.05)"
                strokeDasharray={tick === 0 ? "none" : "3 3"}
              />
              <text
                x={paddingLeft - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize="10"
                fontWeight="500"
                fill="#7e9185"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {effectiveValues.map((val, i) => {
          const num = Number(val) || 0;
          const barHeight = Math.max((num / (yTicks[yTicks.length - 1] || 1)) * plotHeight, 0);
          const x = paddingLeft + i * step + (step - barWidth) / 2;
          const y = paddingTop + plotHeight - barHeight;
          const isHovered = hoveredIndex === i;

          return (
            <g
              key={i}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={paddingLeft + i * step}
                y={paddingTop}
                width={step}
                height={plotHeight}
                fill="transparent"
              />
              {barHeight > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx="3"
                  ry="3"
                  fill={isHovered ? "url(#energyBarHover)" : (i % 2 === 0 ? "#1b804e" : "#5bb980")}
                  opacity={isHovered ? 1 : 0.9}
                  style={{ transition: "all 0.2s ease" }}
                />
              )}
            </g>
          );
        })}

        {/* X-axis labels */}
        {effectiveLabels.map((lbl, i) => {
          if (!isLabelVisible(i)) return null;
          const x = paddingLeft + i * step + step / 2;
          const y = paddingTop + plotHeight + 16;
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              fontSize="10"
              fontWeight="500"
              fill="#7e9185"
              fontFamily="Inter, system-ui, sans-serif"
            >
              {lbl}
            </text>
          );
        })}
      </svg>

      {hoveredIndex !== null && (
        <div style={{
          position: "absolute",
          top: "6px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#131d17",
          color: "#ffffff",
          padding: "4px 12px",
          borderRadius: "8px",
          fontSize: "11px",
          fontWeight: 600,
          pointerEvents: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          display: "flex",
          gap: "8px",
          zIndex: 10,
        }}>
          <span style={{ color: "#a3b8aa" }}>
            {period === "lifetime"
              ? `Tahun ${effectiveLabels[hoveredIndex]}`
              : (period === "year"
                ? `Bulan ${effectiveLabels[hoveredIndex]}`
                : (period === "month"
                  ? `Tgl ${effectiveLabels[hoveredIndex]}`
                  : (period === "week"
                    ? `Hari ${effectiveLabels[hoveredIndex]}`
                    : `Jam ${effectiveLabels[hoveredIndex]} `)))}
          </span>
          <span style={{ color: "#34d399" }}>
            {Number(effectiveValues[hoveredIndex] || 0).toFixed(2)} {series?.unit || "kWh"}
          </span>
        </div>
      )}
    </div>
  );
}

function formatToDisplayDate(dateStr) {
  if (!dateStr) {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const y = now.getFullYear();
    return `${m}/${d}/${y}`;
  }
  const parts = String(dateStr).split("-");
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
  }
  return dateStr;
}

function getTodayDateStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function DatePickerPill({ value, onChange }) {
  const inputRef = useRef(null);

  const displayDate = useMemo(() => {
    return formatToDisplayDate(value);
  }, [value]);

  return (
    <div
      className="date-picker-pill"
      title="Pilih tanggal"
      onClick={() => {
        if (inputRef.current) {
          try {
            inputRef.current.showPicker();
          } catch { }
        }
      }}
    >
      <span className="date-picker-pill-text">{displayDate}</span>
      <svg
        className="date-picker-pill-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <rect x="7" y="13" width="3" height="3" fill="currentColor" stroke="none" />
      </svg>
      <input
        ref={inputRef}
        type="date"
        className="date-picker-pill-input"
        value={value}
        onChange={(e) => {
          if (e.target.value) {
            onChange(e.target.value);
          }
        }}
      />
    </div>
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const CURRENT_YEAR = new Date().getFullYear();
const AVAILABLE_YEARS = Array.from(
  { length: Math.max(1, CURRENT_YEAR - 2019 + 1) },
  (_, i) => 2019 + i
);

function MonthDropdownPill({ value, onChange }) {
  const currentMonthName = MONTH_NAMES[value] || MONTH_NAMES[new Date().getMonth()];

  return (
    <div className="select-pill-wrapper" title="Pilih Bulan">
      <span className="select-pill-text">{currentMonthName}</span>
      <svg className="select-pill-arrow" width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
        <path d="M2.5 4.5L6 8L9.5 4.5H2.5Z" />
      </svg>
      <select
        className="select-pill-native"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {MONTH_NAMES.map((m, idx) => (
          <option key={m} value={idx}>{m}</option>
        ))}
      </select>
    </div>
  );
}

function YearDropdownPill({ value, onChange, years = AVAILABLE_YEARS }) {
  const sortedYears = useMemo(() => Array.from(new Set(years)).sort((a, b) => b - a), [years]);
  return (
    <div className="select-pill-wrapper" title="Pilih Tahun">
      <span className="select-pill-text">Tahun {value}</span>
      <svg className="select-pill-arrow" width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
        <path d="M2.5 4.5L6 8L9.5 4.5H2.5Z" />
      </svg>
      <select
        className="select-pill-native"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {sortedYears.map((y) => (
          <option key={y} value={y}>Tahun {y}</option>
        ))}
      </select>
    </div>
  );
}

function RegionDropdownPill({ value, onChange, regions = REGIONS }) {
  const currentRegion = regions.find((r) => r.id === value) || regions[0];

  return (
    <div className="select-pill-wrapper" title="Pilih Wilayah" style={{ minWidth: "128px" }}>
      <span style={{ fontSize: "11px", marginRight: "3px" }}>📍</span>
      <span className="select-pill-text">{currentRegion.name}</span>
      <svg className="select-pill-arrow" width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
        <path d="M2.5 4.5L6 8L9.5 4.5H2.5Z" />
      </svg>
      <select
        className="select-pill-native"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {regions.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
    </div>
  );
}

const ASSET_OWNER_PRESETS = [
  "Sudin Nakertransgi Jakarta Utara",
  "Sudin Nakertransgi Jakarta Barat",
  "Sudin Nakertransgi Jakarta Pusat",
  "Sudin Nakertransgi Jakarta Timur",
  "Sudin Nakertransgi Jakarta Selatan",
  "Dinas Tenaga Kerja, Transmigrasi dan Energi DKI Jakarta",
  "Dinas Pendidikan DKI Jakarta",
  "Biro Umum & ASD Setda DKI Jakarta",
  "Dinas Kesehatan DKI Jakarta",
  "Dinas Lingkungan Hidup DKI Jakarta",
];

function EditStationModal({ station, onClose, onSave, currentUser }) {
  const [customName, setCustomName] = useState(station.custom_name || station.name || "");
  const [assetOwner, setAssetOwner] = useState(station.asset_owner || "");
  const [isSaving, setIsSaving] = useState(false);

  const stationRegion = getStationRegion(station);
  const regionObj = REGIONS.find((r) => r.id === stationRegion);
  const regionName = regionObj?.name || stationRegion || "DKI Jakarta";
  const canEdit = canUserEditStation(currentUser, station, getStationRegion);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canEdit) {
      alert("Akses ditolak: Anda hanya dapat mengedit PLTS di wilayah tugas Anda.");
      return;
    }
    setIsSaving(true);
    try {
      await onSave(station, {
        custom_name: customName.trim(),
        asset_owner: assetOwner.trim(),
        notes: station.notes || "",
      });
      onClose();
    } catch (err) {
      alert("Gagal menyimpan perubahan: " + (err.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="station-modal-overlay" onClick={onClose}>
      <div className="station-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="station-modal-header">
          <div>
            <h3 className="station-modal-title">Edit Informasi PLTS</h3>
            <span style={{ fontSize: "11px", color: "#6e8074" }}>
              ID: {station.id || station.uid} · Wilayah: <strong>{regionName}</strong> · Vendor: {(station.source || "sma").toUpperCase()}
            </span>
          </div>
          <button type="button" className="station-modal-close" onClick={onClose} title="Tutup">
            ✕
          </button>
        </div>

        {!canEdit && (
          <div style={{
            margin: "12px 24px 0",
            padding: "10px 14px",
            borderRadius: "8px",
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#fca5a5",
            fontSize: "12px",
            lineHeight: 1.4,
          }}>
            🔒 <strong>Mode Hanya Lihat:</strong> PLTS ini berada di wilayah <strong>{regionName}</strong>. Akun Anda hanya memiliki izin mengedit stasiun di wilayah tugas Anda.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="station-modal-body">
            <div className="station-modal-field">
              <label className="station-modal-label">Nama Asli dari Vendor (Readonly)</label>
              <input
                type="text"
                className="station-modal-input"
                style={{ background: "#f3f4f6", color: "#6b7280", cursor: "not-allowed" }}
                value={station.raw_name || station.name || ""}
                disabled
              />
            </div>

            <div className="station-modal-field">
              <label className="station-modal-label">Nama Baru PLTS (Custom Name)</label>
              <input
                type="text"
                className="station-modal-input"
                placeholder="Contoh: SMKN 2 Jakarta Pusat - Gedung A"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                required
                disabled={!canEdit}
                style={!canEdit ? { background: "#1b271e", color: "#6e8074", cursor: "not-allowed" } : {}}
              />
              <span style={{ fontSize: "10.5px", color: "#6e8074" }}>
                Nama ini yang akan ditampilkan di seluruh dashboard & grafik.
              </span>
            </div>

            <div className="station-modal-field">
              <label className="station-modal-label">Pemilik Aset (Asset Owner)</label>
              <input
                type="text"
                className="station-modal-input"
                placeholder="Pilih dari pilihan cepat atau ketik sendiri..."
                value={assetOwner}
                onChange={(e) => setAssetOwner(e.target.value)}
                disabled={!canEdit}
                style={!canEdit ? { background: "#1b271e", color: "#6e8074", cursor: "not-allowed" } : {}}
              />
              <div style={{ marginTop: "6px" }}>
                <span style={{ fontSize: "10px", color: "#6e8074", fontWeight: 700 }}>Pilihan cepat:</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "4px" }}>
                  {ASSET_OWNER_PRESETS.map((p) => {
                    const shortLabel = p
                      .replace("Sudin Nakertransgi ", "Sudin ")
                      .replace("Dinas Tenaga Kerja, Transmigrasi dan Energi", "Disnakertransgi")
                      .replace(" DKI Jakarta", "")
                      .replace(" Setda", "");
                    return (
                      <button
                        key={p}
                        type="button"
                        disabled={!canEdit}
                        className={`asset-preset-btn ${assetOwner === p ? "active" : ""}`}
                        style={!canEdit ? { opacity: 0.4, cursor: "not-allowed" } : {}}
                        onClick={() => {
                          if (!canEdit) return;
                          setAssetOwner(p);
                        }}
                      >
                        {shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="station-modal-footer">
            <button type="button" className="btn-modal-cancel" onClick={onClose}>
              {canEdit ? "Batal" : "Tutup"}
            </button>
            {canEdit ? (
              <button type="submit" className="btn-modal-save" disabled={isSaving}>
                {isSaving ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
            ) : (
              <button type="button" className="btn-modal-save" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
                🔒 Terkunci (Wilayah {regionName})
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function formatShortOwner(owner) {
  if (!owner) return "";
  return owner
    .replace("Sudin Nakertransgi Jakarta Utara", "Sudin Jakut")
    .replace("Sudin Nakertransgi Jakarta Barat", "Sudin Jakbar")
    .replace("Sudin Nakertransgi Jakarta Pusat", "Sudin Jakpus")
    .replace("Sudin Nakertransgi Jakarta Timur", "Sudin Jaktim")
    .replace("Sudin Nakertransgi Jakarta Selatan", "Sudin Jaksel")
    .replace("Sudin Nakertransgi ", "Sudin ")
    .replace("Dinas Tenaga Kerja, Transmigrasi dan Energi", "Disnakertransgi")
    .replace(" DKI Jakarta", "")
    .replace(" Setda", "");
}

function handleExportStationList(stations = [], regionLabel = "DKI Jakarta") {
  if (!stations || stations.length === 0) {
    alert("Tidak ada data stasiun PLTS untuk diekspor.");
    return;
  }

  const rows = [];
  rows.push([
    "No",
    "Nama PLTS",
    "Alamat",
    "Status",
    "Aset",
    "Vendor",
  ]);

  stations.forEach((st, idx) => {
    const name = st.custom_name || st.name || st.raw_name || "-";
    const address = st.address || "-";

    const powerVal = Number(st.current_power_kw ?? st.output_power_kw ?? st.pv_power_kw ?? st.power_kw ?? 0);
    const dailyVal = Number(st.daily_energy_kwh ?? st.today_energy_kwh ?? st.today_kwh ?? 0);
    const isOffline = st.status === "offline" || st.status === "disconnected" || (powerVal === 0 && dailyVal === 0);
    const status = isOffline ? "Offline" : "Online";

    const asset = st.asset_owner || "-";
    const vendor = String(st.source || st.site?.platform || "SMA").toUpperCase();

    rows.push([
      idx + 1,
      name,
      address,
      status,
      asset,
      vendor,
    ]);
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  const cleanReg = regionLabel.replace(/\s+/g, "_");
  const filename = `Daftar_PLTS_${cleanReg}_${dateStr}.xlsx`;
  const colWidths = [
    { wch: 6 },  // No
    { wch: 35 }, // Nama PLTS
    { wch: 65 }, // Alamat
    { wch: 15 }, // Status
    { wch: 30 }, // Aset
    { wch: 15 }, // Vendor
  ];
  downloadExcel(filename, rows, "Daftar PLTS", colWidths);
}

function StationListDarkCard({
  locations,
  allLocations,
  activeStation,
  onSelect,
  selectedRegion = "all",
  onSelectRegion,
  onUpdateStation,
  currentUser,
}) {
  const currentRegion = REGIONS.find((r) => r.id === selectedRegion) || REGIONS[0];
  const regionLabel = currentRegion?.shortName || currentRegion?.name || "DKI Jakarta";
  const [searchQuery, setSearchQuery] = useState("");
  const [editingStation, setEditingStation] = useState(null);

  const displayLocations = useMemo(() => {
    const base = (allLocations && allLocations.length > 0) ? allLocations : (locations || []);
    let filtered = base;
    if (selectedRegion && selectedRegion !== "all") {
      filtered = filtered.filter((loc) => {
        const reg = loc.region ? String(loc.region).toLowerCase() : getStationRegion(loc);
        return reg === selectedRegion;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((loc) => {
        const n = (loc.name || "").toLowerCase();
        const raw = (loc.raw_name || "").toLowerCase();
        const owner = (loc.asset_owner || "").toLowerCase();
        const vendor = (loc.source || "").toLowerCase();
        return n.includes(q) || raw.includes(q) || owner.includes(q) || vendor.includes(q);
      });
    }
    return filtered;
  }, [allLocations, locations, selectedRegion, searchQuery]);

  return (
    <div className="analytics-station-list-card">
      <div className="station-list-header">
        <div className="station-list-title-wrap">
          <span className="station-list-title">DAFTAR PLTS ({regionLabel.toUpperCase()})</span>
          <span className="station-list-count">{displayLocations.length} stasiun</span>
        </div>
        <button
          type="button"
          className="btn-export-station-list"
          onClick={() => handleExportStationList(displayLocations, regionLabel)}
          title="Download Daftar PLTS (Excel .xlsx)"
        >
          <DownloadIcon style={{ width: "12px", height: "12px" }} />
          <span>Export Excel</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="station-search-box">
        <svg
          className="station-search-icon"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="station-search-input"
          placeholder="Cari stasiun atau pemilik aset..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="station-search-clear"
            onClick={() => setSearchQuery("")}
            title="Hapus pencarian"
          >
            ✕
          </button>
        )}
      </div>

      <div className="station-table-wrap">
        <table className="station-table">
          <thead>
            <tr>
              <th style={{ width: "22px", textAlign: "center" }}>Status</th>
              <th>Nama PLTS</th>
              <th style={{ width: "88px" }}>Pemilik Aset</th>
              <th style={{ width: "46px", textAlign: "center" }}>Vendor</th>
              <th style={{ width: "30px", textAlign: "center" }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {displayLocations.length === 0 ? (
              <tr>
                <td colSpan={5} className="station-table-empty">
                  {searchQuery ? `Tidak ada stasiun yang cocok dengan "${searchQuery}"` : `Belum ada PLTS di wilayah ${regionLabel}`}
                </td>
              </tr>
            ) : (
              displayLocations.map((loc) => {
                const isSelected =
                  (loc.uid && activeStation?.uid && loc.uid === activeStation.uid) ||
                  (loc.id && activeStation?.id && loc.id === activeStation.id) ||
                  (loc.name && activeStation?.name && loc.name === activeStation.name);
                const powerVal = Number(loc.current_power_kw ?? loc.output_power_kw ?? loc.pv_power_kw ?? loc.power_kw ?? 0);
                const dailyVal = Number(loc.daily_energy_kwh ?? loc.today_energy_kwh ?? 0);
                const isOffline = loc.status === "offline" || loc.status === "disconnected" || (powerVal === 0 && dailyVal === 0);
                const vendor = (loc.source || "sma").toLowerCase();
                const canEditThisStation = canUserEditStation(currentUser, loc, getStationRegion);

                return (
                  <tr
                    key={loc.uid || loc.id || loc.name}
                    className={`station-table-row ${isSelected ? "selected" : ""}`}
                    onClick={() => onSelect && onSelect(loc.uid || loc.id)}
                    title={`Klik untuk melihat detail ${loc.name}`}
                  >
                    <td style={{ textAlign: "center" }}>
                      <span
                        className={`station-status-dot ${isOffline ? "offline" : "online"}`}
                        title={isOffline ? "Offline / 0 kW" : "Online"}
                      />
                    </td>
                    <td>
                      <div className="station-name-cell">
                        <span className="station-primary-name">{loc.custom_name || loc.name}</span>
                        {loc.custom_name && loc.raw_name && loc.custom_name !== loc.raw_name && (
                          <span className="station-raw-name" title={`Nama asli vendor: ${loc.raw_name}`}>
                            Asli: {loc.raw_name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      {loc.asset_owner ? (
                        <span
                          className={`asset-owner-pill ${canEditThisStation ? "clickable" : ""}`}
                          title={`Pemilik Aset: ${loc.asset_owner}${canEditThisStation ? " (Klik untuk mengedit)" : ""}`}
                          onClick={(e) => {
                            if (!canEditThisStation) return;
                            e.stopPropagation();
                            setEditingStation(loc);
                          }}
                        >
                          {formatShortOwner(loc.asset_owner)}
                        </span>
                      ) : canEditThisStation ? (
                        <span
                          className="asset-owner-empty"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingStation(loc);
                          }}
                          title="Klik untuk menambahkan pemilik aset"
                        >
                          + Set
                        </span>
                      ) : (
                        <span
                          className="asset-owner-empty is-locked"
                          title="Terkunci: Hanya admin wilayah terkait yang dapat mengatur pemilik aset"
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className={`station-vendor-badge vendor-${vendor}`}>
                        {vendor.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {canEditThisStation ? (
                        <button
                          type="button"
                          className="btn-edit-station"
                          title="Edit nama stasiun & pemilik aset"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingStation(loc);
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-edit-station is-locked"
                          title="Terkunci: Anda hanya dapat mengedit PLTS di wilayah tugas Anda"
                          disabled
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editingStation && (
        <EditStationModal
          station={editingStation}
          onClose={() => setEditingStation(null)}
          onSave={async (st, updates) => {
            if (onUpdateStation) {
              await onUpdateStation(st, updates);
            }
          }}
          currentUser={currentUser}
        />
      )}
    </div>
  );
}

function AnalyticsKpiCardGroup({
  title,
  todayVal,
  todayUnit,
  todaySub,
  monthVal,
  monthUnit,
  monthSub,
  yearVal,
  yearUnit,
  yearSub,
  lifetimeVal,
  lifetimeUnit,
  lifetimeSub,
}) {
  return (
    <div className="analytics-kpi-group-card">
      <h3 className="analytics-group-title">{title}</h3>
      <div className="kpi-2x2-grid">
        <div className="kpi-card-box">
          <span className="kpi-card-tag">TODAY</span>
          <div className="kpi-card-value">
            {todayVal} <span className="kpi-card-unit">{todayUnit}</span>
          </div>
          <div className="kpi-card-sub">{todaySub}</div>
        </div>

        <div className="kpi-card-box">
          <span className="kpi-card-tag">THIS MONTH</span>
          <div className="kpi-card-value">
            {monthVal} <span className="kpi-card-unit">{monthUnit}</span>
          </div>
          <div className="kpi-card-sub">{monthSub}</div>
        </div>

        <div className="kpi-card-box">
          <span className="kpi-card-tag">THIS YEAR</span>
          <div className="kpi-card-value">
            {yearVal} <span className="kpi-card-unit">{yearUnit}</span>
          </div>
          <div className="kpi-card-sub">{yearSub}</div>
        </div>

        <div className="kpi-card-box lifetime-highlight">
          <span className="kpi-card-tag">LIFETIME</span>
          <div className="kpi-card-value">
            {lifetimeVal} <span className="kpi-card-unit">{lifetimeUnit}</span>
          </div>
          <div className="kpi-card-sub">{lifetimeSub}</div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsQuarterlyKpiCardGroup({
  title,
  q1Val,
  q1Unit,
  q1Sub,
  q2Val,
  q2Unit,
  q2Sub,
  q3Val,
  q3Unit,
  q3Sub,
  q4Val,
  q4Unit,
  q4Sub,
}) {
  return (
    <div className="analytics-kpi-group-card">
      <h3 className="analytics-group-title">{title}</h3>
      <div className="kpi-2x2-grid">
        <div className="kpi-card-box" title="Triwulan 1: Januari - Maret">
          <span className="kpi-card-tag">TW 1</span>
          <div className="kpi-card-value">
            {q1Val} <span className="kpi-card-unit">{q1Unit}</span>
          </div>
          <div className="kpi-card-sub">{q1Sub}</div>
        </div>

        <div className="kpi-card-box" title="Triwulan 2: April - Juni">
          <span className="kpi-card-tag">TW 2</span>
          <div className="kpi-card-value">
            {q2Val} <span className="kpi-card-unit">{q2Unit}</span>
          </div>
          <div className="kpi-card-sub">{q2Sub}</div>
        </div>

        <div className="kpi-card-box" title="Triwulan 3: Juli - September">
          <span className="kpi-card-tag">TW 3</span>
          <div className="kpi-card-value">
            {q3Val} <span className="kpi-card-unit">{q3Unit}</span>
          </div>
          <div className="kpi-card-sub">{q3Sub}</div>
        </div>

        <div className="kpi-card-box" title="Triwulan 4: Oktober - Desember">
          <span className="kpi-card-tag">TW 4</span>
          <div className="kpi-card-value">
            {q4Val} <span className="kpi-card-unit">{q4Unit}</span>
          </div>
          <div className="kpi-card-sub">{q4Sub}</div>
        </div>
      </div>
    </div>
  );
}

function getFleetQuarterlyValues({ targetLocations, selectedYear, metricType = "energy", fallbackYearVal = 0, currentMonthVal = null }) {
  const isRevenue = metricType === "revenue";
  const now = new Date();
  const currentYear = now.getFullYear();
  const yr = selectedYear || currentYear;
  const isCurrentYear = yr === currentYear;
  const currentMonthIdx = now.getMonth();

  const locs = targetLocations || [];

  // Triwulan resmi:
  // TW 1: Januari - Maret (Bulan 1 - 3 -> index 0, 1, 2)
  // TW 2: April - Juni (Bulan 4 - 6 -> index 3, 4, 5)
  // TW 3: Juli - September (Bulan 7 - 9 -> index 6, 7, 8)
  // TW 4: Oktober - Desember (Bulan 10 - 12 -> index 9, 10, 11)
  const yearlyMonthlyTotals = Array(12).fill(0);

  locs.forEach((loc) => {
    const mVals = getStationMonthlyValues(loc, yr, metricType);
    if (Array.isArray(mVals)) {
      for (let m = 0; m < 12; m++) {
        yearlyMonthlyTotals[m] += Number(mVals[m]) || 0;
      }
    }
  });

  // Jika tahun berjalan dan currentMonthVal diberikan, pastikan bulan berjalan mencerminkan nilai realtime
  if (isCurrentYear && currentMonthVal !== null && currentMonthVal !== undefined && Number(currentMonthVal) >= 0) {
    if (yearlyMonthlyTotals[currentMonthIdx] < Number(currentMonthVal)) {
      yearlyMonthlyTotals[currentMonthIdx] = Number(currentMonthVal);
    }
  }

  // Jumlahkan nilai 3 bulan untuk masing-masing Triwulan
  let q1 = yearlyMonthlyTotals[0] + yearlyMonthlyTotals[1] + yearlyMonthlyTotals[2];
  let q2 = yearlyMonthlyTotals[3] + yearlyMonthlyTotals[4] + yearlyMonthlyTotals[5];
  let q3 = yearlyMonthlyTotals[6] + yearlyMonthlyTotals[7] + yearlyMonthlyTotals[8];
  let q4 = yearlyMonthlyTotals[9] + yearlyMonthlyTotals[10] + yearlyMonthlyTotals[11];

  // Fallback proporsional jika belum ada data namun fallbackYearVal tersedia
  const totalQ = q1 + q2 + q3 + q4;
  if (totalQ === 0 && fallbackYearVal > 0) {
    q1 = fallbackYearVal * 0.23;
    q2 = fallbackYearVal * 0.26;
    q3 = fallbackYearVal * 0.28;
    q4 = fallbackYearVal * 0.23;
  }

  return {
    q1: isRevenue ? Math.round(q1) : Math.round(q1 * 10) / 10,
    q2: isRevenue ? Math.round(q2) : Math.round(q2 * 10) / 10,
    q3: isRevenue ? Math.round(q3) : Math.round(q3 * 10) / 10,
    q4: isRevenue ? Math.round(q4) : Math.round(q4 * 10) / 10,
    m1Name: "Jan - Mar",
    m2Name: "Apr - Jun",
    m3Name: "Jul - Sep",
    m4Name: "Okt - Des",
    m1FullName: "Januari - Maret",
    m2FullName: "April - Juni",
    m3FullName: "Juli - September",
    m4FullName: "Oktober - Desember",
  };
}

function buildAggregatedFleetSeries({
  targetLocations,
  period,
  selectedDate,
  selectedMonth,
  selectedYear,
  metricType = "energy",
  fleetTotalVals = {},
}) {
  const isEmission = metricType === "emission";
  const isRevenue = metricType === "revenue";
  const isEnergy = metricType === "energy";
  const unit = isEnergy ? "kWh" : (isRevenue ? "IDR" : "kg CO₂");

  const getLocSeries = (loc, p) => {
    if (isEmission) return getEmissionSeries(loc, p);
    if (isRevenue) return getRevenueSeries(loc, p);
    return getEnergySeries(loc, p);
  };

  const getLocDaily = (loc) => {
    const kwh = Number(loc?.daily_energy_kwh ?? loc?.today_energy_kwh ?? 0);
    if (isEmission) return kwh * 0.85;
    if (isRevenue) return Number(loc?.daily_income) || Math.round(kwh * 900);
    return kwh;
  };

  const getLocMonthly = (loc) => {
    const kwh = Number(loc?.monthly_energy_kwh ?? loc?.month_energy_kwh ?? 0);
    if (isEmission) return kwh * 0.85;
    if (isRevenue) return Number(loc?.monthly_income) || Math.round(kwh * 900);
    return kwh;
  };

  const getLocYearly = (loc) => {
    const kwh = Number(loc?.yearly_energy_kwh ?? loc?.year_energy_kwh ?? 0);
    if (isEmission) return kwh * 0.85;
    if (isRevenue) return Number(loc?.yearly_income) || Math.round(kwh * 900);
    return kwh;
  };

  const getLocLifetime = (loc) => {
    const kwh = Number(loc?.cumulative_energy_kwh ?? loc?.total_energy_kwh ?? 0);
    if (isEmission) return kwh * 0.85;
    if (isRevenue) return Number(loc?.cumulative_income ?? loc?.total_income) || Math.round(kwh * 900);
    return kwh;
  };

  const locs = targetLocations || [];

  if (period === "day" || period === "today") {
    const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
    const aggregated = Array(24).fill(0);

    locs.forEach((loc) => {
      const tariff = loc?.tariff_per_kwh || getStationTariff(loc, tariffConfig);
      const res = getStationDailyValues(loc, selectedDate, metricType, tariff);
      if (res && Array.isArray(res.values)) {
        res.values.forEach((v, idx) => {
          if (idx < 24) aggregated[idx] += Number(v) || 0;
        });
      }
    });

    return {
      available: true,
      labels: hourlyLabels,
      values: aggregated.map((v) => isRevenue ? Math.round(v) : Math.round(v * 100) / 100),
      unit,
      kind: "bar",
    };
  }

  if (period === "week") {
    let weekLabels = [];
    const aggregated = Array(7).fill(0);

    locs.forEach((loc) => {
      const tariff = loc?.tariff_per_kwh || getStationTariff(loc, tariffConfig);
      const res = getStationWeeklyValues(loc, selectedDate, metricType, tariff);
      if (res && Array.isArray(res.values)) {
        if (!weekLabels.length && Array.isArray(res.labels)) {
          weekLabels = res.labels;
        }
        res.values.forEach((v, idx) => {
          if (idx < 7) aggregated[idx] += Number(v) || 0;
        });
      }
    });

    if (!weekLabels.length) {
      const days = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
      const now = selectedDate ? new Date(selectedDate + "T12:00:00") : new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        weekLabels.push(`${days[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}`);
      }
    }

    return {
      available: true,
      labels: weekLabels,
      values: aggregated.map((v) => isRevenue ? Math.round(v) : Math.round(v * 10) / 10),
      unit,
      kind: "bar",
    };
  }

  if (period === "month") {
    const daysInSelectedMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const labels = Array.from({ length: daysInSelectedMonth }, (_, i) => String(i + 1).padStart(2, "0"));
    const aggregated = Array(daysInSelectedMonth).fill(0);

    locs.forEach((loc) => {
      const tariff = loc?.tariff_per_kwh || getStationTariff(loc, tariffConfig);
      const vals = getStationDailyMonthValues(loc, selectedYear, selectedMonth, metricType, tariff);
      if (Array.isArray(vals)) {
        for (let i = 0; i < daysInSelectedMonth; i++) {
          aggregated[i] += Number(vals[i]) || 0;
        }
      }
    });

    return {
      available: true,
      labels,
      values: aggregated.map((v) => isRevenue ? Math.round(v) : Math.round(v * 10) / 10),
      unit,
      kind: "bar",
    };
  }

  if (period === "year") {
    const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
    const now = new Date();
    const isCurrentYear = selectedYear === now.getFullYear();
    const isFutureYear = selectedYear > now.getFullYear();
    const nowMonth = now.getMonth();

    const aggregated = Array(12).fill(0);
    locs.forEach((loc) => {
      const mVals = getStationMonthlyValues(loc, selectedYear, metricType);
      if (Array.isArray(mVals)) {
        mVals.forEach((v, idx) => {
          if (idx < 12) aggregated[idx] += Number(v) || 0;
        });
      }
    });

    for (let i = 0; i < 12; i++) {
      if (isFutureYear || (isCurrentYear && i > nowMonth)) {
        aggregated[i] = 0;
      }
    }

    // Ensure the current month bar in current year strictly matches fleetTotalVals.monthly (THIS MONTH)
    if (isCurrentYear && nowMonth < 12 && fleetTotalVals?.monthly !== undefined && fleetTotalVals?.monthly !== null) {
      aggregated[nowMonth] = isRevenue
        ? Math.round(Number(fleetTotalVals.monthly) || 0)
        : Math.round((Number(fleetTotalVals.monthly) || 0) * 10) / 10;
    }

    // Fallback if no station had data but fleetTotalVals had yearly estimate
    if (!aggregated.some((v) => v > 0) && fleetTotalVals?.yearly > 0) {
      const annual = fleetTotalVals.yearly;
      for (let m = 0; m < 12; m++) {
        if (isFutureYear || (isCurrentYear && m > nowMonth)) {
          aggregated[m] = 0;
        } else {
          const mVal = annual * JAKARTA_SOLAR_MONTHLY_WEIGHTS[m];
          aggregated[m] = isRevenue ? Math.round(mVal) : Math.round(mVal * 10) / 10;
        }
      }
    }

    return {
      available: true,
      labels: months,
      values: aggregated.map((v) => isRevenue ? Math.round(v) : Math.round(v * 10) / 10),
      unit,
      kind: "bar",
    };
  }

  // Lifetime
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = 2019; y <= currentYear; y++) {
    years.push(String(y));
  }
  const aggregated = Array(years.length).fill(0);
  locs.forEach((loc) => {
    years.forEach((yrStr, idx) => {
      const yrNum = parseInt(yrStr, 10);
      const yrKwh = getStationHistoricalYearKwh(loc, yrNum);
      const tariff = loc?.tariff_per_kwh || 900;
      const val = isRevenue ? Math.round(yrKwh * tariff) : (isEmission ? Math.round(yrKwh * 0.85 * 10) / 10 : Math.round(yrKwh * 10) / 10);
      aggregated[idx] += val;
    });
  });

  return {
    available: true,
    labels: years,
    values: aggregated.map((v) => isRevenue ? Math.round(v) : Math.round(v * 10) / 10),
    unit,
    kind: "bar",
  };
}

function EnergyView({ location, fleet, locations, allLocations, onSelect, selectedRegion = "all", onSelectRegion, onUpdateStation, currentUser, onOpenChartExport }) {
  const pool = (allLocations && allLocations.length > 0) ? allLocations : (locations || []);
  const [localStationUid, setLocalStationUid] = useState(location?.uid || null);

  // Station curve controls
  const [period, setPeriod] = useState("day");
  const [selectedDate, setSelectedDate] = useState(getTodayDateStr);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  // Fleet curve controls
  const [fleetRegion, setFleetRegion] = useState(selectedRegion || "all");
  const [fleetPeriod, setFleetPeriod] = useState("day");
  const [fleetSelectedDate, setFleetSelectedDate] = useState(getTodayDateStr);
  const [fleetSelectedMonth, setFleetSelectedMonth] = useState(() => new Date().getMonth());
  const [fleetSelectedYear, setFleetSelectedYear] = useState(() => new Date().getFullYear());

  useEffect(() => {
    if (location?.uid) {
      setLocalStationUid(location.uid);
    }
  }, [location?.uid]);

  useEffect(() => {
    if (selectedRegion) {
      setFleetRegion(selectedRegion);
      if (selectedRegion !== "all") {
        setLocalStationUid((prevUid) => {
          if (!prevUid) return null;
          const found = pool.find((l) => l.uid === prevUid || l.id === prevUid);
          const reg = found?.region ? String(found.region).toLowerCase() : getStationRegion(found);
          return reg === selectedRegion ? prevUid : null;
        });
      }
    }
  }, [selectedRegion, pool]);

  // Fleet pool & target locations for selected region
  const targetLocations = useMemo(() => {
    if (fleetRegion === "all") return pool;
    return pool.filter((loc) => {
      const reg = loc.region ? String(loc.region).toLowerCase() : getStationRegion(loc);
      return reg === fleetRegion;
    });
  }, [pool, fleetRegion]);

  const currentRegObj = useMemo(() => {
    return REGIONS.find((r) => r.id === fleetRegion) || REGIONS[0];
  }, [fleetRegion]);

  const regionLabel = fleetRegion === "all" ? "Semua PLTS" : currentRegObj.name;

  const activeStation = useMemo(() => {
    if (localStationUid) {
      const match = targetLocations.find((l) => l.uid === localStationUid || l.id === localStationUid);
      if (match) return match;
    }
    if (location && targetLocations.some((l) => l.uid === location.uid || l.id === location.id)) {
      return location;
    }
    return (targetLocations && targetLocations.length > 0) ? targetLocations[0] : (pool[0] || null);
  }, [localStationUid, location, targetLocations, pool]);

  const handleSelectStation = useCallback((uid) => {
    setLocalStationUid(uid);
    if (onSelect) onSelect(uid);
  }, [onSelect]);

  const handleFleetRegionChange = useCallback((regId) => {
    setFleetRegion(regId);
    if (onSelectRegion) onSelectRegion(regId);
  }, [onSelectRegion]);

  const hasLocations = Boolean(targetLocations && targetLocations.length > 0);
  const stationName = activeStation?.name || ((targetLocations && targetLocations.length > 0) ? "Pilih PLTS" : "Tidak Ada PLTS");
  const platformName = activeStation?.source
    ? (activeStation.source.charAt(0).toUpperCase() + activeStation.source.slice(1))
    : "—";

  const todayKwh = Number(activeStation?.today_energy_kwh ?? activeStation?.daily_energy_kwh ?? 0);
  const monthKwh = Number(activeStation?.monthly_energy_kwh ?? activeStation?.month_energy_kwh ?? 0);
  const yearKwh = Number(activeStation?.yearly_energy_kwh ?? activeStation?.year_energy_kwh ?? 0);
  const lifetimeKwh = Number(activeStation?.total_energy_kwh ?? activeStation?.cumulative_energy_kwh ?? 0);

  const todayMwh = (todayKwh / 1000).toFixed(3);
  const monthMwh = (monthKwh / 1000).toFixed(3);
  const yearMwh = (yearKwh / 1000).toFixed(2);
  const lifetimeMwh = (lifetimeKwh / 1000).toFixed(2);

  // Fleet totals for target locations
  const targetFleetTodayKwh = useMemo(() => {
    return targetLocations.reduce((sum, loc) => sum + (Number(loc?.daily_energy_kwh ?? loc?.today_energy_kwh) || 0), 0);
  }, [targetLocations]);

  const targetFleetMonthKwh = useMemo(() => {
    return targetLocations.reduce((sum, loc) => sum + (Number(loc?.monthly_energy_kwh ?? loc?.month_energy_kwh) || 0), 0);
  }, [targetLocations]);

  const targetFleetYearKwh = useMemo(() => {
    return targetLocations.reduce((sum, loc) => sum + (Number(loc?.yearly_energy_kwh ?? loc?.year_energy_kwh) || 0), 0);
  }, [targetLocations]);

  const targetFleetLifetimeKwh = useMemo(() => {
    return targetLocations.reduce((sum, loc) => sum + (Number(loc?.cumulative_energy_kwh ?? loc?.total_energy_kwh) || 0), 0);
  }, [targetLocations]);

  const fleetTodayKwhVal = targetFleetTodayKwh > 0 ? targetFleetTodayKwh : (fleetRegion === "all" ? Number(fleet?.daily || 0) : 0);
  const fleetMonthKwhVal = targetFleetMonthKwh > 0 ? targetFleetMonthKwh : (fleetRegion === "all" ? Number(fleet?.monthly || 0) : 0);
  const fleetYearKwhVal = fleetRegion === "all" ? (Number(fleet?.yearly || 0) || targetFleetYearKwh) : targetFleetYearKwh;
  const fleetLifetimeKwhVal = fleetRegion === "all" ? (Number(fleet?.cumulative || fleet?.lifetime || 0) || targetFleetLifetimeKwh) : targetFleetLifetimeKwh;

  // 5 Top stats for Energy Top Chart (dynamically reflects selected region targetLocations)
  const totalSitesCount = targetLocations.length;
  const platformsCount = useMemo(() => {
    const s = new Set(targetLocations.map((l) => l.source).filter(Boolean));
    return s.size > 0 ? s.size : (targetLocations.length > 0 ? 1 : 0);
  }, [targetLocations]);
  const onlineCount = useMemo(() => {
    return targetLocations.filter((l) => l.status === "online" || (Number(l.current_power_kw ?? l.output_power_kw ?? l.pv_power_kw ?? l.power_kw ?? 0) > 0)).length;
  }, [targetLocations]);
  const offlineCount = Math.max(0, totalSitesCount - onlineCount);
  const currentPowerVal = formatNumber(activeStation?.current_power_kw ?? activeStation?.output_power_kw ?? activeStation?.pv_power_kw ?? activeStation?.power_kw ?? 0, 2) + " kW";

  const availableYears = useMemo(() => {
    return getAvailableProductionYears(allLocations || locations, activeStation);
  }, [allLocations, locations, activeStation]);

  const series = useMemo(() => {
    if (!activeStation || !(activeStation.id || activeStation.station_id || activeStation.uid || activeStation.name)) {
      const currentYear = new Date().getFullYear();
      const fallbackYears = Array.from({ length: Math.max(1, currentYear - 2022 + 1) }, (_, i) => String(2022 + i));
      const count = (period === "day" || period === "today") ? 24 : (period === "week" ? 7 : (period === "month" ? 31 : (period === "year" ? 12 : fallbackYears.length)));
      const labels = (period === "day" || period === "today")
        ? Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`)
        : (period === "week"
          ? ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
          : (period === "month"
            ? Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"))
            : (period === "year"
              ? ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]
              : fallbackYears)));
      return {
        available: true,
        labels,
        values: Array(count).fill(0),
        unit: "kWh",
        title: "Energy history",
      };
    }

    if (period === "day" || period === "today") {
      const daily = getStationDailyValues(activeStation, selectedDate, "energy");
      return {
        available: true,
        labels: daily.labels,
        values: daily.values,
        unit: "kWh",
        kind: "bar",
        title: "Daily production curve",
        caption: `Generasi per jam (${formatToDisplayDate(selectedDate)})`,
      };
    }

    if (period === "week") {
      const weekly = getStationWeeklyValues(activeStation, selectedDate, "energy");
      return {
        available: true,
        labels: weekly.labels,
        values: weekly.values,
        unit: "kWh",
        kind: "bar",
        title: "Weekly production curve (7 days)",
        caption: `Generasi 7 hari (${formatToDisplayDate(selectedDate)})`,
      };
    }

    if (period === "month") {
      const daysInSelectedMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      const labels = Array.from({ length: daysInSelectedMonth }, (_, i) => String(i + 1).padStart(2, "0"));
      const vals = getStationDailyMonthValues(activeStation, selectedYear, selectedMonth, "energy");
      return {
        available: true,
        labels,
        values: vals,
        unit: "kWh",
        kind: "bar",
        title: "Monthly production curve",
        caption: `Generasi harian (${MONTH_NAMES[selectedMonth]} ${selectedYear})`,
      };
    }

    if (period === "year") {
      const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
      const vals = getStationMonthlyValues(activeStation, selectedYear, "energy");
      return {
        available: true,
        labels: months,
        values: vals,
        unit: "kWh",
        kind: "bar",
        title: "Yearly production curve",
        caption: `Generasi bulanan (${selectedYear})`,
      };
    }

    if (period === "lifetime") {
      const lifetimeYears = getStationLifetimeYears(activeStation);
      const vals = lifetimeYears.map((yrStr) => {
        const val = getStationHistoricalYearKwh(activeStation, parseInt(yrStr, 10));
        return Math.round(val * 10) / 10;
      });
      return {
        available: true,
        labels: lifetimeYears,
        values: vals,
        unit: "kWh",
        kind: "bar",
        title: "Lifetime production curve",
        caption: "Akumulasi generasi tahunan",
      };
    }

    const s = getEnergySeries(activeStation, period);
    if (!s || s.available === false) {
      if (period === "day" || period === "today") {
        const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
        const solarWeights = [0, 0, 0, 0, 0, 0, 0.02, 0.05, 0.09, 0.13, 0.16, 0.18, 0.16, 0.11, 0.06, 0.03, 0.01, 0, 0, 0, 0, 0, 0, 0];
        return {
          available: true,
          labels: hourlyLabels,
          values: solarWeights.map((w) => Math.round(w * todayKwh * 10) / 10),
          unit: "kWh",
          kind: "bar",
          title: "Daily production curve",
          caption: "Estimasi generasi per jam",
        };
      }
      if (period === "week") {
        const days = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
        const now = selectedDate ? new Date(selectedDate + "T12:00:00") : new Date();
        const labels = [];
        const values = [];
        const avg = monthKwh > 0 ? (monthKwh / Math.max(1, now.getDate())) : (todayKwh || 10);
        const factors = [0.92, 1.05, 0.88, 1.12, 0.98, 1.02, 1.0];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          labels.push(`${days[(d.getDay() + 6) % 7]} ${d.getDate()}/${d.getMonth() + 1}`);
          values.push(Math.round((i === 0 && todayKwh > 0 ? todayKwh : avg * factors[6 - i]) * 10) / 10);
        }
        return {
          available: true,
          labels,
          values,
          unit: "kWh",
          kind: "bar",
          title: "Weekly production curve (7 days)",
          caption: `Generasi 7 hari (${formatToDisplayDate(selectedDate)})`,
        };
      }
      if (period === "month") {
        const daysInSelectedMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
        const now = new Date();
        const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth();
        const isFutureMonth = selectedYear > now.getFullYear() || (selectedYear === now.getFullYear() && selectedMonth > now.getMonth());

        const labels = Array.from({ length: daysInSelectedMonth }, (_, i) => String(i + 1).padStart(2, "0"));
        const avg = monthKwh > 0 ? (monthKwh / Math.max(1, isCurrentMonth ? now.getDate() : daysInSelectedMonth)) : (todayKwh || 10);
        const values = labels.map((_, i) => {
          if (isFutureMonth) return 0;
          if (isCurrentMonth && (i + 1 > now.getDate())) return 0;
          if (isCurrentMonth && (i + 1 === now.getDate()) && todayKwh > 0) return Math.round(todayKwh * 10) / 10;
          const factor = 0.85 + (((i + selectedMonth) * 7) % 30) / 100;
          return Math.round(avg * factor * 10) / 10;
        });
        return {
          available: true,
          labels,
          values,
          unit: "kWh",
          kind: "bar",
          title: "Monthly production curve",
          caption: `Generasi harian (${MONTH_NAMES[selectedMonth]} ${selectedYear})`,
        };
      }
      if (period === "year") {
        const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
        const now = new Date();
        const isCurrentYear = selectedYear === now.getFullYear();
        const isFutureYear = selectedYear > now.getFullYear();
        const nowMonth = now.getMonth();
        const avgMonth = yearKwh > 0 ? (yearKwh / Math.max(1, isCurrentYear ? nowMonth + 1 : 12)) : (monthKwh || 100);
        const values = months.map((_, i) => {
          if (isFutureYear) return 0;
          if (isCurrentYear && i > nowMonth) return 0;
          if (isCurrentYear && i === nowMonth && monthKwh > 0) return Math.round(monthKwh * 10) / 10;
          const factor = 0.9 + (((i + (selectedYear % 5)) * 5) % 20) / 100;
          return Math.round(avgMonth * factor * 10) / 10;
        });
        return {
          available: true,
          labels: months,
          values,
          unit: "kWh",
          kind: "bar",
          title: "Yearly production curve",
          caption: `Generasi bulanan (${selectedYear})`,
        };
      }
    }
    return s;
  }, [activeStation, period, selectedDate, selectedMonth, selectedYear, todayKwh, monthKwh, yearKwh, lifetimeKwh]);

  // Fleet Series
  const fleetSeries = useMemo(() => {
    return buildAggregatedFleetSeries({
      targetLocations,
      period: fleetPeriod,
      selectedDate: fleetSelectedDate,
      selectedMonth: fleetSelectedMonth,
      selectedYear: fleetSelectedYear,
      metricType: "energy",
      fleetTotalVals: { daily: fleetTodayKwhVal, monthly: fleetMonthKwhVal, yearly: fleetYearKwhVal, lifetime: fleetLifetimeKwhVal },
    });
  }, [targetLocations, fleetPeriod, fleetSelectedDate, fleetSelectedMonth, fleetSelectedYear, fleetTodayKwhVal, fleetMonthKwhVal, fleetYearKwhVal, fleetLifetimeKwhVal]);

  const curveSubtitle = useMemo(() => {
    if (!hasLocations) return "Belum ada instalasi PLTS di wilayah ini (0 kWh)";
    if (period === "day" || period === "today") return `${stationName} · Hourly generation (${formatToDisplayDate(selectedDate)}) - ${platformName}`;
    if (period === "week") return `${stationName} · Daily generation week (${formatToDisplayDate(selectedDate)}) - ${platformName}`;
    if (period === "month") return `${stationName} · Daily generation (${MONTH_NAMES[selectedMonth]} ${selectedYear}) - ${platformName}`;
    if (period === "year") return `${stationName} · Monthly generation (${selectedYear}) - ${platformName}`;
    return `${stationName} · Yearly generation reported by ${platformName}`;
  }, [hasLocations, stationName, platformName, period, selectedDate, selectedMonth, selectedYear]);

  const curveTitle = useMemo(() => {
    if (period === "day" || period === "today") return "Daily production curve";
    if (period === "week") return "Weekly production curve (7 days)";
    if (period === "month") return "Monthly production curve";
    if (period === "year") return "Yearly production curve";
    return "Lifetime production curve";
  }, [period]);

  const fleetCurveTitle = useMemo(() => {
    if (fleetPeriod === "day" || fleetPeriod === "today") return "Total fleet daily production curve";
    if (fleetPeriod === "week") return "Total fleet weekly production curve";
    if (fleetPeriod === "month") return "Total fleet monthly production curve";
    if (fleetPeriod === "year") return "Total fleet yearly production curve";
    return "Total fleet lifetime production curve";
  }, [fleetPeriod]);

  const fleetCurveSubtitle = useMemo(() => {
    const count = targetLocations?.length || 0;
    const prefix = fleetRegion === "all" ? `Semua PLTS (${count} Stasiun)` : `${regionLabel} (${count} Stasiun)`;
    if (fleetPeriod === "day" || fleetPeriod === "today") return `${prefix} · Total produksi energi (${formatToDisplayDate(fleetSelectedDate)}) - ${formatNumber(fleetTodayKwhVal, 1)} kWh`;
    if (fleetPeriod === "week") return `${prefix} · Total produksi 7 hari (${formatToDisplayDate(fleetSelectedDate)})`;
    if (fleetPeriod === "month") return `${prefix} · Total produksi (${MONTH_NAMES[fleetSelectedMonth]} ${fleetSelectedYear})`;
    if (fleetPeriod === "year") return `${prefix} · Total produksi tahunan (${fleetSelectedYear})`;
    return `${prefix} · Akumulasi produksi keseluruhan`;
  }, [fleetRegion, regionLabel, targetLocations, fleetPeriod, fleetSelectedDate, fleetSelectedMonth, fleetSelectedYear, fleetTodayKwhVal]);

  const fleetRecordCount = useMemo(() => {
    if (fleetPeriod === "day" || fleetPeriod === "today") return `${fleetSeries?.values?.length || 24} / 24`;
    if (fleetPeriod === "week") return `${fleetSeries?.values?.length || 7} / 7`;
    if (fleetPeriod === "month") return `${fleetSeries?.values?.length || 31} / 31`;
    if (fleetPeriod === "year") return "12 / 12";
    return `${fleetSeries?.values?.length || 5} / ${fleetSeries?.values?.length || 5}`;
  }, [fleetPeriod, fleetSeries]);

  const fleetHighestVal = useMemo(() => {
    const vals = (fleetSeries?.values || []).map((v) => Number(v) || 0);
    return vals.length > 0 ? Math.max(...vals) : 0;
  }, [fleetSeries]);

  const fleetLatestVal = useMemo(() => {
    const vals = (fleetSeries?.values || []).map((v) => Number(v) || 0);
    if (!vals.length) return 0;
    const nonZero = [...vals].reverse().find((v) => v > 0);
    return nonZero !== undefined ? nonZero : 0;
  }, [fleetSeries]);

  const fleetQuarterly = useMemo(() => {
    return getFleetQuarterlyValues({
      targetLocations,
      selectedYear: fleetSelectedYear,
      metricType: "energy",
      fallbackYearVal: fleetYearKwhVal,
      currentMonthVal: fleetMonthKwhVal,
    });
  }, [targetLocations, fleetSelectedYear, fleetYearKwhVal, fleetMonthKwhVal]);

  return (
    <div className="unified-analytics-view">
      {/* ROW 1: STATION PRODUCTION CURVE (LEFT) + DAFTAR PLTS & PRODUCTION (RIGHT) */}
      <div className="analytics-grid-row">
        {/* Left: Production Curve Card */}
        <div className="analytics-col-main">
          <div className="energy-curve-card">
            <div className="curve-card-header">
              <div>
                <h2 className="curve-title">{curveTitle}</h2>
                <p className="curve-subtitle">{curveSubtitle}</p>
              </div>
              <div className="curve-controls">
                <div className="period-toggle-pill">
                  <button
                    type="button"
                    className={period === "day" || period === "today" ? "active" : ""}
                    onClick={() => setPeriod("day")}
                  >
                    Day
                  </button>
                  <button
                    type="button"
                    className={period === "week" ? "active" : ""}
                    onClick={() => setPeriod("week")}
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    className={period === "month" ? "active" : ""}
                    onClick={() => setPeriod("month")}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className={period === "year" ? "active" : ""}
                    onClick={() => setPeriod("year")}
                  >
                    Year
                  </button>
                  <button
                    type="button"
                    className={period === "lifetime" ? "active" : ""}
                    onClick={() => setPeriod("lifetime")}
                  >
                    Lifetime
                  </button>
                </div>
                {(period === "day" || period === "today" || period === "week") && (
                  <DatePickerPill value={selectedDate} onChange={setSelectedDate} />
                )}
                {period === "month" && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <MonthDropdownPill value={selectedMonth} onChange={setSelectedMonth} />
                    <YearDropdownPill value={selectedYear} onChange={setSelectedYear} years={availableYears} />
                  </div>
                )}
                {period === "year" && (
                  <YearDropdownPill value={selectedYear} onChange={setSelectedYear} years={availableYears} />
                )}
                <span className="unit-pill-badge">{series?.unit || "kWh"}</span>
                {onOpenChartExport && (
                  <button
                    type="button"
                    className="btn-curve-export"
                    onClick={() => onOpenChartExport(activeStation?.id || activeStation?.uid || "all")}
                    title="Export Data Grafik (CSV / Excel)"
                  >
                    <DownloadIcon style={{ width: "12px", height: "12px" }} />
                    <span>Export</span>
                  </button>
                )}
              </div>
            </div>

            {/* Inner Chart Box */}
            <div className="energy-chart-stage">
              <EnergyProductionChart series={series} period={period} />
            </div>

            {/* 5 Stats underneath chart as shown in design */}
            <div className="curve-stats-row-5">
              <div className="curve-stat-box">
                <span className="curve-stat-label">TOTAL SITES</span>
                <span className="curve-stat-value">{totalSitesCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">PLATFORMS</span>
                <span className="curve-stat-value">{platformsCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">ONLINE</span>
                <span className="curve-stat-value" style={{ color: "#10b981" }}>{onlineCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">OFFLINE</span>
                <span className="curve-stat-value" style={{ color: offlineCount > 0 ? "#ef4444" : "#6e8074" }}>{offlineCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">CURRENT POWER</span>
                <span className="curve-stat-value">{currentPowerVal}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Dark Station List Card + Station Production Card */}
        <div className="analytics-col-side">
          <StationListDarkCard
            locations={locations}
            allLocations={allLocations}
            activeStation={activeStation}
            onSelect={handleSelectStation}
            selectedRegion={selectedRegion || "all"}
            onSelectRegion={onSelectRegion}
            onUpdateStation={onUpdateStation}
            currentUser={currentUser}
          />

          <AnalyticsKpiCardGroup
            title="Production"
            todayVal={formatNumber(todayKwh, 1)}
            todayUnit="KWH"
            todaySub={`${todayMwh} MWH`}
            monthVal={formatNumber(monthKwh, 1)}
            monthUnit="KWH"
            monthSub={`${monthMwh} MWH`}
            yearVal={formatNumber(yearKwh, 0)}
            yearUnit="KWH"
            yearSub={`${yearMwh} MWH`}
            lifetimeVal={formatNumber(lifetimeKwh, 0)}
            lifetimeUnit="KWH"
            lifetimeSub={`${lifetimeMwh} MWH`}
          />
        </div>
      </div>

      {/* ROW 2: TOTAL FLEET PRODUCTION CURVE (LEFT) + TOTAL PRODUCTION (TW 1-4) & TOTAL FLEET PRODUCTION (RIGHT) */}
      <div className="analytics-grid-row">
        {/* Left: Total Fleet Production Curve Card */}
        <div className="analytics-col-main">
          <div className="energy-curve-card">
            <div className="curve-card-header">
              <div>
                <h2 className="curve-title">{fleetCurveTitle}</h2>
                <p className="curve-subtitle">{fleetCurveSubtitle}</p>
              </div>
              <div className="curve-controls">
                <div className="period-toggle-pill">
                  <button
                    type="button"
                    className={fleetPeriod === "day" || fleetPeriod === "today" ? "active" : ""}
                    onClick={() => setFleetPeriod("day")}
                  >
                    Day
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "week" ? "active" : ""}
                    onClick={() => setFleetPeriod("week")}
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "month" ? "active" : ""}
                    onClick={() => setFleetPeriod("month")}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "year" ? "active" : ""}
                    onClick={() => setFleetPeriod("year")}
                  >
                    Year
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "lifetime" ? "active" : ""}
                    onClick={() => setFleetPeriod("lifetime")}
                  >
                    Lifetime
                  </button>
                </div>
                {(fleetPeriod === "day" || fleetPeriod === "today" || fleetPeriod === "week") && (
                  <DatePickerPill value={fleetSelectedDate} onChange={setFleetSelectedDate} />
                )}
                {fleetPeriod === "month" && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <MonthDropdownPill value={fleetSelectedMonth} onChange={setFleetSelectedMonth} />
                    <YearDropdownPill value={fleetSelectedYear} onChange={setFleetSelectedYear} years={availableYears} />
                  </div>
                )}
                {fleetPeriod === "year" && (
                  <YearDropdownPill value={fleetSelectedYear} onChange={setFleetSelectedYear} years={availableYears} />
                )}
                <span className="unit-pill-badge">{fleetSeries?.unit || "kWh"}</span>
                {onOpenChartExport && (
                  <button
                    type="button"
                    className="btn-curve-export"
                    onClick={() => onOpenChartExport("all")}
                    title="Export Data Grafik (CSV / Excel)"
                  >
                    <DownloadIcon style={{ width: "12px", height: "12px" }} />
                    <span>Export</span>
                  </button>
                )}
              </div>
            </div>

            {/* Inner Chart Box */}
            <div className="energy-chart-stage">
              <EnergyProductionChart series={fleetSeries} period={fleetPeriod} />
            </div>

            {/* 3 Stats underneath chart */}
            <div className="curve-stats-row-3">
              <div className="curve-stat-box">
                <span className="curve-stat-label">RECORDS</span>
                <span className="curve-stat-value">{fleetRecordCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">HIGHEST</span>
                <span className="curve-stat-value">{formatNumber(fleetHighestVal, 1)} {fleetSeries?.unit || "kWh"}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">LATEST</span>
                <span className="curve-stat-value">{formatNumber(fleetLatestVal, 1)} {fleetSeries?.unit || "kWh"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Total Production (TW 1-4) + Total fleet Production */}
        <div className="analytics-col-side">
          {/* Card 2: Total Production (4 bulan terakhir untuk Fleet) */}
          <AnalyticsQuarterlyKpiCardGroup
            title="Total Production"
            q1Val={formatNumber(fleetQuarterly.q1, 1)}
            q1Unit="KWH"
            q1Sub={`${fleetQuarterly.m1Name} · ${(fleetQuarterly.q1 / 1000).toFixed(3)} MWH`}
            q2Val={formatNumber(fleetQuarterly.q2, 1)}
            q2Unit="KWH"
            q2Sub={`${fleetQuarterly.m2Name} · ${(fleetQuarterly.q2 / 1000).toFixed(3)} MWH`}
            q3Val={formatNumber(fleetQuarterly.q3, 1)}
            q3Unit="KWH"
            q3Sub={`${fleetQuarterly.m3Name} · ${(fleetQuarterly.q3 / 1000).toFixed(3)} MWH`}
            q4Val={formatNumber(fleetQuarterly.q4, 1)}
            q4Unit="KWH"
            q4Sub={`${fleetQuarterly.m4Name} · ${(fleetQuarterly.q4 / 1000).toFixed(3)} MWH`}
          />

          {/* Card 3: Total fleet Production */}
          <AnalyticsKpiCardGroup
            title="Total fleet Production"
            todayVal={formatNumber(fleetTodayKwhVal, 1)}
            todayUnit="KWH"
            todaySub={`${(fleetTodayKwhVal / 1000).toFixed(3)} MWH`}
            monthVal={formatNumber(fleetMonthKwhVal, 0)}
            monthUnit="KWH"
            monthSub={`${(fleetMonthKwhVal / 1000).toFixed(3)} MWH`}
            yearVal={formatNumber(fleetYearKwhVal, 0)}
            yearUnit="KWH"
            yearSub={`${(fleetYearKwhVal / 1000).toFixed(2)} MWH`}
            lifetimeVal={formatNumber(fleetLifetimeKwhVal, 0)}
            lifetimeUnit="KWH"
            lifetimeSub={`${(fleetLifetimeKwhVal / 1000).toFixed(2)} MWH`}
          />
        </div>
      </div>
    </div>
  );
}

function RevenueProductionChart({ series, period, isKehua }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  if (series?.available === false) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        minHeight: "260px",
        background: "#fafbfa",
        borderRadius: "14px",
        border: "1px dashed #cbd5cb",
        padding: "28px 20px",
        textAlign: "center",
        boxSizing: "border-box",
      }}>
        <div style={{
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          background: "#fef3c7",
          color: "#d97706",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "12px",
          fontSize: "20px",
        }}>
          ⚠️
        </div>
        <h4 style={{ margin: "0 0 6px", fontSize: "15px", color: "#16231a", fontWeight: 700 }}>
          {series?.title || (isKehua ? "Data Histori Belum Tersedia" : "Tidak Tersedia")}
        </h4>
        <p style={{ margin: 0, fontSize: "13px", color: "#6e8074", maxWidth: "440px", lineHeight: 1.5 }}>
          {series?.reason || "Data kurva grafik pendapatan tidak tersedia untuk periode ini."}
        </p>
      </div>
    );
  }

  const labels = series?.labels || [];
  const values = series?.values || [];

  const effectiveLabels = labels.length > 0 ? labels : ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  const effectiveValues = values.length > 0 ? values : Array.from({ length: effectiveLabels.length }, () => 0);

  const calculatedMax = Math.max(...effectiveValues.map((v) => Number(v) || 0), 0);
  const yMax = calculatedMax > 0
    ? calculateMaxVal(calculatedMax)
    : ((period === "day" || period === "today") ? 5_000 : 100_000);
  const yTicks = [
    0,
    Math.round(yMax * 0.25),
    Math.round(yMax * 0.5),
    Math.round(yMax * 0.75),
    Math.round(yMax),
  ];

  const svgWidth = 720;
  const svgHeight = 290;
  const paddingLeft = 48;
  const paddingRight = 14;
  const paddingTop = 14;
  const paddingBottom = 26;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  const barCount = effectiveLabels.length;
  const step = plotWidth / barCount;
  const barWidth = Math.max(5, Math.min(step * 0.72, 28));

  let latestNonZeroIndex = -1;
  for (let idx = effectiveValues.length - 1; idx >= 0; idx--) {
    if (Number(effectiveValues[idx]) > 0) {
      latestNonZeroIndex = idx;
      break;
    }
  }

  const isLabelVisible = (index) => {
    if (period === "day" || period === "today") {
      const hour = parseInt(effectiveLabels[index], 10);
      return [0, 4, 8, 12, 16, 20, 23].includes(hour) || index % 4 === 0;
    }
    if (period === "week") {
      return true;
    }
    if (period === "year") {
      const val = parseInt(effectiveLabels[index], 10);
      return [1, 3, 6, 8, 10, 12].includes(val);
    }
    if (period === "month") {
      const day = parseInt(effectiveLabels[index], 10);
      return [1, 5, 10, 15, 20, 25, 30].includes(day);
    }
    return true;
  };

  const formatTick = (val) => {
    if (val === 0) return "0";
    if (val >= 1_000_000_000) return `${Number((val / 1_000_000_000).toFixed(val % 1_000_000_000 === 0 ? 0 : 1)).toLocaleString("id-ID")} Miliar`;
    if (val >= 1_000_000) return `${Number((val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 1)).toLocaleString("id-ID")} Juta`;
    if (val >= 1_000) return `${Number((val / 1_000).toFixed(val % 1_000 === 0 ? 0 : 1)).toLocaleString("id-ID")} Ribu`;
    return String(Math.round(val));
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", flex: 1, display: "flex", alignItems: "stretch" }}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      >
        {/* Horizontal Grid lines and Y labels */}
        {yTicks.map((tick, i) => {
          const ratio = (tick - yTicks[0]) / (yTicks[yTicks.length - 1] - yTicks[0] || 1);
          const y = paddingTop + plotHeight - ratio * plotHeight;
          return (
            <g key={i}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={svgWidth - paddingRight}
                y2={y}
                stroke="rgba(0, 0, 0, 0.06)"
                strokeDasharray={tick === 0 ? "none" : "3 3"}
              />
              <text
                x={paddingLeft - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize="10"
                fontWeight="500"
                fill="#7e9185"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {formatTick(tick)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {effectiveValues.map((val, i) => {
          const num = Number(val) || 0;
          const barHeight = Math.max((num / (yTicks[yTicks.length - 1] || 1)) * plotHeight, 0);
          const x = paddingLeft + i * step + (step - barWidth) / 2;
          const y = paddingTop + plotHeight - barHeight;
          const isHovered = hoveredIndex === i;
          const isCurrentActive = i === latestNonZeroIndex;

          return (
            <g
              key={i}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={paddingLeft + i * step}
                y={paddingTop}
                width={step}
                height={plotHeight}
                fill="transparent"
              />
              {barHeight > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx="3"
                  ry="3"
                  fill={isHovered ? "#0d5731" : (isCurrentActive ? "#18633b" : "#cee5d5")}
                  opacity={isHovered ? 1 : 0.95}
                  style={{ transition: "all 0.2s ease" }}
                />
              )}
            </g>
          );
        })}

        {/* X-axis labels */}
        {effectiveLabels.map((lbl, i) => {
          if (!isLabelVisible(i)) return null;
          const x = paddingLeft + i * step + step / 2;
          const y = paddingTop + plotHeight + 16;
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              fontSize="10"
              fontWeight="500"
              fill="#7e9185"
              fontFamily="Inter, system-ui, sans-serif"
            >
              {lbl}
            </text>
          );
        })}
      </svg>

      {hoveredIndex !== null && (
        <div style={{
          position: "absolute",
          top: "6px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#131d17",
          color: "#ffffff",
          padding: "4px 12px",
          borderRadius: "8px",
          fontSize: "11px",
          fontWeight: 600,
          pointerEvents: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          display: "flex",
          gap: "8px",
          zIndex: 10,
        }}>
          <span style={{ color: "#a3b8aa" }}>
            {period === "day" || period === "today"
              ? `Jam ${effectiveLabels[hoveredIndex]}`
              : (period === "week"
                ? `Hari ${effectiveLabels[hoveredIndex]}`
                : (period === "year"
                  ? `Bulan ${effectiveLabels[hoveredIndex]}`
                  : (period === "month"
                    ? `Tgl ${effectiveLabels[hoveredIndex]}`
                    : `Tahun ${effectiveLabels[hoveredIndex]}`)))}
          </span>
          <span style={{ color: "#34d399" }}>
            Rp {new Intl.NumberFormat("id-ID").format(Math.round(effectiveValues[hoveredIndex] || 0))} IDR
          </span>
        </div>
      )}
    </div>
  );
}

function RevenueView({
  location,
  fleet,
  locations,
  allLocations,
  onSelect,
  selectedRegion = "all",
  onSelectRegion,
  onUpdateStation,
  tariffConfig,
  onOpenTariffModal,
  currentUser,
  onOpenChartExport,
}) {
  const pool = (allLocations && allLocations.length > 0) ? allLocations : (locations || []);
  const [localStationUid, setLocalStationUid] = useState(location?.uid || null);

  // Station curve controls
  const [period, setPeriod] = useState("day");
  const [selectedDate, setSelectedDate] = useState(getTodayDateStr);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  // Fleet curve controls
  const [fleetRegion, setFleetRegion] = useState(selectedRegion || "all");
  const [fleetPeriod, setFleetPeriod] = useState("day");
  const [fleetSelectedDate, setFleetSelectedDate] = useState(getTodayDateStr);
  const [fleetSelectedMonth, setFleetSelectedMonth] = useState(() => new Date().getMonth());
  const [fleetSelectedYear, setFleetSelectedYear] = useState(() => new Date().getFullYear());

  useEffect(() => {
    if (location?.uid) {
      setLocalStationUid(location.uid);
    }
  }, [location?.uid]);

  useEffect(() => {
    if (selectedRegion) {
      setFleetRegion(selectedRegion);
      if (selectedRegion !== "all") {
        setLocalStationUid((prevUid) => {
          if (!prevUid) return null;
          const found = pool.find((l) => l.uid === prevUid || l.id === prevUid);
          const reg = found?.region ? String(found.region).toLowerCase() : getStationRegion(found);
          return reg === selectedRegion ? prevUid : null;
        });
      }
    }
  }, [selectedRegion, pool]);

  // Fleet calculations & target locations
  const targetLocations = useMemo(() => {
    if (fleetRegion === "all") return pool;
    return pool.filter((loc) => {
      const reg = loc.region ? String(loc.region).toLowerCase() : getStationRegion(loc);
      return reg === fleetRegion;
    });
  }, [pool, fleetRegion]);

  const currentRegObj = useMemo(() => {
    return REGIONS.find((r) => r.id === fleetRegion) || REGIONS[0];
  }, [fleetRegion]);

  const activeStation = useMemo(() => {
    if (localStationUid) {
      const match = targetLocations.find((l) => l.uid === localStationUid || l.id === localStationUid);
      if (match) return match;
    }
    if (location && targetLocations.some((l) => l.uid === location.uid || l.id === location.id)) {
      return location;
    }
    return (targetLocations && targetLocations.length > 0) ? targetLocations[0] : (pool[0] || null);
  }, [localStationUid, location, targetLocations, pool]);

  const stationTariff = useMemo(() => {
    if (!activeStation) return 900;
    return activeStation.tariff_per_kwh || getStationTariff(activeStation, tariffConfig);
  }, [activeStation, tariffConfig]);

  const isSingleStation = Boolean(activeStation && (activeStation.id || activeStation.station_id || activeStation.uid));

  const customCount = useMemo(() => {
    return Object.keys(tariffConfig?.customTariffs || {}).length;
  }, [tariffConfig]);

  const handleSelectStation = useCallback((uid) => {
    setLocalStationUid(uid);
    if (onSelect) onSelect(uid);
  }, [onSelect]);

  const handleFleetRegionChange = useCallback((regId) => {
    setFleetRegion(regId);
    if (onSelectRegion) onSelectRegion(regId);
  }, [onSelectRegion]);

  const hasLocations = Boolean(targetLocations && targetLocations.length > 0);
  const stationName = activeStation?.name || ((targetLocations && targetLocations.length > 0) ? "Pilih PLTS" : "Tidak Ada PLTS");
  const platformName = activeStation?.source
    ? (activeStation.source.charAt(0).toUpperCase() + activeStation.source.slice(1))
    : "—";
  const hasVendorIncome = Boolean(activeStation?.daily_income || activeStation?.monthly_income || activeStation?.yearly_income || activeStation?.cumulative_income);
  const isAutoTariff = ["kehua", "sma"].includes((activeStation?.source || "").toLowerCase()) || !hasVendorIncome;

  const todayRev = Number(activeStation?.daily_income) || Math.round(Number(activeStation?.daily_energy_kwh || activeStation?.today_energy_kwh || 0) * stationTariff);
  const monthRev = Number(activeStation?.monthly_income) || Math.round(Number(activeStation?.monthly_energy_kwh || 0) * stationTariff);
  const yearRev = Number(activeStation?.yearly_income) || Math.round(Number(activeStation?.yearly_energy_kwh || 0) * stationTariff);
  const lifetimeRev = Number(activeStation?.cumulative_income ?? activeStation?.total_income) || Math.round(Number(activeStation?.cumulative_energy_kwh || 0) * stationTariff);

  const targetFleetTodayRev = useMemo(() => {
    return targetLocations.reduce((sum, loc) => {
      const tariff = loc?.tariff_per_kwh || getStationTariff(loc, tariffConfig);
      return sum + (Number(loc?.daily_income) || Math.round((Number(loc?.daily_energy_kwh ?? loc?.today_energy_kwh) || 0) * tariff));
    }, 0);
  }, [targetLocations, tariffConfig]);

  const targetFleetMonthRev = useMemo(() => {
    return targetLocations.reduce((sum, loc) => {
      const tariff = loc?.tariff_per_kwh || getStationTariff(loc, tariffConfig);
      return sum + (Number(loc?.monthly_income) || Math.round((Number(loc?.monthly_energy_kwh ?? loc?.month_energy_kwh) || 0) * tariff));
    }, 0);
  }, [targetLocations, tariffConfig]);

  const targetFleetYearRev = useMemo(() => {
    return targetLocations.reduce((sum, loc) => {
      const tariff = loc?.tariff_per_kwh || getStationTariff(loc, tariffConfig);
      return sum + (Number(loc?.yearly_income) || Math.round((Number(loc?.yearly_energy_kwh ?? loc?.year_energy_kwh) || 0) * tariff));
    }, 0);
  }, [targetLocations, tariffConfig]);

  const targetFleetLifetimeRev = useMemo(() => {
    return targetLocations.reduce((sum, loc) => {
      const tariff = loc?.tariff_per_kwh || getStationTariff(loc, tariffConfig);
      return sum + (Number(loc?.cumulative_income ?? loc?.total_income) || Math.round((Number(loc?.cumulative_energy_kwh ?? loc?.total_energy_kwh) || 0) * tariff));
    }, 0);
  }, [targetLocations, tariffConfig]);

  const fleetTodayRevVal = targetFleetTodayRev > 0 ? targetFleetTodayRev : (fleetRegion === "all" ? Number(fleet?.dailyIncome || 0) : 0);
  const fleetMonthRevVal = targetFleetMonthRev > 0 ? targetFleetMonthRev : (fleetRegion === "all" ? Number(fleet?.monthlyIncome || 0) : 0);
  const fleetYearRevVal = fleetRegion === "all" ? (Number(fleet?.yearlyIncome) || targetFleetYearRev) : targetFleetYearRev;
  const fleetLifetimeRevVal = fleetRegion === "all" ? (Number(fleet?.totalIncome) || targetFleetLifetimeRev) : targetFleetLifetimeRev;

  const availableYears = useMemo(() => {
    return getAvailableProductionYears(allLocations || locations, activeStation);
  }, [allLocations, locations, activeStation]);

  const series = useMemo(() => {
    if (!activeStation || !(activeStation.id || activeStation.station_id || activeStation.uid || activeStation.name)) {
      const currentYear = new Date().getFullYear();
      const fallbackYears = Array.from({ length: Math.max(1, currentYear - 2022 + 1) }, (_, i) => String(2022 + i));
      const count = (period === "day" || period === "today") ? 24 : (period === "week" ? 7 : (period === "month" ? 31 : (period === "year" ? 12 : fallbackYears.length)));
      const labels = (period === "day" || period === "today")
        ? Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`)
        : (period === "week"
          ? ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
          : (period === "month"
            ? Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"))
            : (period === "year"
              ? ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]
              : fallbackYears)));
      return {
        available: true,
        labels,
        values: Array(count).fill(0),
        unit: "IDR",
        title: "Revenue history",
      };
    }

    if (period === "day" || period === "today") {
      const daily = getStationDailyValues(activeStation, selectedDate, "revenue", stationTariff);
      return {
        available: true,
        labels: daily.labels,
        values: daily.values,
        unit: "IDR",
        kind: "bar",
        title: "Daily revenue curve",
        caption: `Pendapatan per jam (${formatToDisplayDate(selectedDate)})`,
      };
    }

    if (period === "week") {
      const weekly = getStationWeeklyValues(activeStation, selectedDate, "revenue", stationTariff);
      return {
        available: true,
        labels: weekly.labels,
        values: weekly.values,
        unit: "IDR",
        kind: "bar",
        title: "Weekly revenue curve (7 days)",
        caption: `Pendapatan 7 hari (${formatToDisplayDate(selectedDate)})`,
      };
    }

    if (period === "month") {
      const daysInSelectedMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      const labels = Array.from({ length: daysInSelectedMonth }, (_, i) => String(i + 1).padStart(2, "0"));
      const vals = getStationDailyMonthValues(activeStation, selectedYear, selectedMonth, "revenue", stationTariff);
      return {
        available: true,
        labels,
        values: vals,
        unit: "IDR",
        kind: "bar",
        title: "Daily revenue this month",
        caption: `Pendapatan harian (${MONTH_NAMES[selectedMonth]} ${selectedYear})`,
      };
    }

    if (period === "year") {
      const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
      const vals = getStationMonthlyValues(activeStation, selectedYear, "revenue", stationTariff);
      return {
        available: true,
        labels: months,
        values: vals,
        unit: "IDR",
        kind: "bar",
        title: "Revenue by year",
        caption: `Pendapatan bulanan (${selectedYear})`,
      };
    }

    if (period === "lifetime") {
      const lifetimeYears = getStationLifetimeYears(activeStation);
      const vals = lifetimeYears.map((yrStr) => {
        const val = getStationHistoricalYearKwh(activeStation, parseInt(yrStr, 10));
        return Math.round(val * stationTariff);
      });
      return {
        available: true,
        labels: lifetimeYears,
        values: vals,
        unit: "IDR",
        kind: "bar",
        title: "Revenue by year",
        caption: "Akumulasi pendapatan tahunan",
      };
    }

    if (period === "day" || period === "today") {
      const daily = getStationDailyValues(activeStation, selectedDate, "revenue", stationTariff);
      return {
        available: true,
        labels: daily.labels,
        values: daily.values,
        unit: "IDR",
        kind: "bar",
        title: "Daily revenue curve",
        caption: `Pendapatan per jam (${formatToDisplayDate(selectedDate)})`,
      };
    }

    if (period === "week") {
      const weekly = getStationWeeklyValues(activeStation, selectedDate, "revenue", stationTariff);
      return {
        available: true,
        labels: weekly.labels,
        values: weekly.values,
        unit: "IDR",
        kind: "bar",
        title: "Weekly revenue (last 7 days)",
        caption: `Pendapatan 7 hari (${formatToDisplayDate(selectedDate)})`,
      };
    }

    const s = getRevenueSeries(activeStation, period);
    if (!s || s.available === false) {
      if (period === "month") {
        const daysInSelectedMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
        const now = new Date();
        const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth();
        const isFutureMonth = selectedYear > now.getFullYear() || (selectedYear === now.getFullYear() && selectedMonth > now.getMonth());

        const labels = Array.from({ length: daysInSelectedMonth }, (_, i) => String(i + 1).padStart(2, "0"));
        const avg = monthRev > 0 ? (monthRev / Math.max(1, isCurrentMonth ? now.getDate() : daysInSelectedMonth)) : (todayRev || 10000);
        const values = labels.map((_, i) => {
          if (isFutureMonth) return 0;
          if (isCurrentMonth && (i + 1 > now.getDate())) return 0;
          if (isCurrentMonth && (i + 1 === now.getDate()) && todayRev > 0) return Math.round(todayRev);
          const factor = 0.85 + (((i + selectedMonth) * 7) % 30) / 100;
          return Math.round(avg * factor);
        });
        return {
          available: true,
          labels,
          values,
          unit: "IDR",
          kind: "bar",
          title: "Daily revenue this month",
          caption: `Pendapatan harian (${MONTH_NAMES[selectedMonth]} ${selectedYear})`,
        };
      }
      if (period === "year") {
        const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
        const now = new Date();
        const isCurrentYear = selectedYear === now.getFullYear();
        const isFutureYear = selectedYear > now.getFullYear();
        const nowMonth = now.getMonth();
        const avgMonth = yearRev > 0 ? (yearRev / Math.max(1, isCurrentYear ? nowMonth + 1 : 12)) : (monthRev || 100000);
        const values = months.map((_, i) => {
          if (isFutureYear) return 0;
          if (isCurrentYear && i > nowMonth) return 0;
          if (isCurrentYear && i === nowMonth && monthRev > 0) return Math.round(monthRev);
          const factor = 0.9 + (((i + (selectedYear % 5)) * 5) % 20) / 100;
          return Math.round(avgMonth * factor);
        });
        return {
          available: true,
          labels: months,
          values,
          unit: "IDR",
          kind: "bar",
          title: "Monthly revenue this year",
          caption: `Pendapatan bulanan (${selectedYear})`,
        };
      }
    }
    return s;
  }, [activeStation, period, selectedDate, selectedMonth, selectedYear, todayRev, monthRev, yearRev, lifetimeRev, stationTariff]);

  const fleetSeries = useMemo(() => {
    return buildAggregatedFleetSeries({
      targetLocations,
      period: fleetPeriod,
      selectedDate: fleetSelectedDate,
      selectedMonth: fleetSelectedMonth,
      selectedYear: fleetSelectedYear,
      metricType: "revenue",
      fleetTotalVals: {
        daily: fleetTodayRevVal,
        monthly: fleetMonthRevVal,
        yearly: fleetYearRevVal,
        lifetime: fleetLifetimeRevVal,
      },
    });
  }, [targetLocations, fleetPeriod, fleetSelectedDate, fleetSelectedMonth, fleetSelectedYear, fleetTodayRevVal, fleetMonthRevVal, fleetYearRevVal, fleetLifetimeRevVal]);

  const curveSubtitle = useMemo(() => {
    if (!hasLocations) return "Belum ada instalasi PLTS di wilayah ini (Rp 0 IDR)";
    if (period === "day" || period === "today") return `${stationName} · revenue (${formatToDisplayDate(selectedDate)}) · ${platformName}`;
    if (period === "week") return `${stationName} · Daily revenue week (${formatToDisplayDate(selectedDate)}) · ${platformName}`;
    if (period === "month") return `${stationName} · Daily revenue (${MONTH_NAMES[selectedMonth]} ${selectedYear}) · ${platformName}`;
    if (period === "year") return `${stationName} · Monthly revenue (${selectedYear}) · ${platformName}`;
    return `${stationName} · Available lifetime revenue history · ${platformName}`;
  }, [hasLocations, stationName, period, selectedDate, selectedMonth, selectedYear, platformName]);

  const curveTitle = useMemo(() => {
    if (period === "day" || period === "today") return "Daily revenue curve";
    if (period === "week") return "Weekly revenue (last 7 days)";
    if (period === "month") return "Daily revenue this month";
    if (period === "year") return "Monthly revenue this year";
    return "Revenue by year";
  }, [period]);

  const fleetCurveTitle = useMemo(() => {
    if (fleetPeriod === "day" || fleetPeriod === "today") return "Total fleet daily revenue curve";
    if (fleetPeriod === "week") return "Total fleet weekly revenue (last 7 days)";
    if (fleetPeriod === "month") return "Total fleet daily revenue this month";
    if (fleetPeriod === "year") return "Total fleet monthly revenue this year";
    return "Total fleet revenue by year";
  }, [fleetPeriod]);

  const fleetCurveSubtitle = useMemo(() => {
    const count = targetLocations?.length || 0;
    const prefix = fleetRegion === "all"
      ? `Semua PLTS (${count} Stasiun)`
      : `Wilayah ${currentRegObj?.name || "DKI Jakarta"} (${count} Stasiun)`;
    if (fleetPeriod === "day" || fleetPeriod === "today") return `${prefix} · Total revenue (${formatToDisplayDate(fleetSelectedDate)}) · Tarif gedung`;
    if (fleetPeriod === "week") return `${prefix} · Total revenue 7 hari (${formatToDisplayDate(fleetSelectedDate)}) · Tarif gedung`;
    if (fleetPeriod === "month") return `${prefix} · Total revenue harian (${MONTH_NAMES[fleetSelectedMonth]} ${fleetSelectedYear}) · Tarif gedung`;
    if (fleetPeriod === "year") return `${prefix} · Total revenue bulanan (${fleetSelectedYear}) · Tarif gedung`;
    return `${prefix} · Histori akumulasi total revenue IDR per tahun`;
  }, [targetLocations, fleetRegion, currentRegObj, fleetPeriod, fleetSelectedDate, fleetSelectedMonth, fleetSelectedYear]);

  const recordCount = useMemo(() => {
    if (period === "day" || period === "today") return `${series?.values?.length || 24} / 24`;
    if (period === "week") return `${series?.values?.length || 7} / 7`;
    if (period === "month") return `${series?.values?.length || 31} / 31`;
    if (period === "year") return "12 / 12";
    return `${series?.values?.length || 5} / ${series?.values?.length || 5}`;
  }, [period, series]);

  const highestVal = useMemo(() => {
    const vals = (series?.values || []).map((v) => Number(v) || 0);
    return vals.length > 0 ? Math.max(...vals) : 0;
  }, [series]);

  const latestVal = useMemo(() => {
    const vals = (series?.values || []).map((v) => Number(v) || 0);
    if (!vals.length) return 0;
    const nonZero = [...vals].reverse().find((v) => v > 0);
    return nonZero !== undefined ? nonZero : 0;
  }, [series]);

  const fleetRecordCount = useMemo(() => {
    if (fleetPeriod === "day" || fleetPeriod === "today") return `${fleetSeries?.values?.length || 24} / 24`;
    if (fleetPeriod === "week") return `${fleetSeries?.values?.length || 7} / 7`;
    if (fleetPeriod === "month") return `${fleetSeries?.values?.length || 31} / 31`;
    if (fleetPeriod === "year") return `${fleetSeries?.values?.length || 12} / 12`;
    return `${fleetSeries?.values?.length || 5} / ${fleetSeries?.values?.length || 5}`;
  }, [fleetPeriod, fleetSeries]);

  const fleetHighestVal = useMemo(() => {
    const vals = (fleetSeries?.values || []).map((v) => Number(v) || 0);
    return vals.length > 0 ? Math.max(...vals) : 0;
  }, [fleetSeries]);

  const fleetLatestVal = useMemo(() => {
    const vals = (fleetSeries?.values || []).map((v) => Number(v) || 0);
    if (!vals.length) return 0;
    const nonZero = [...vals].reverse().find((v) => v > 0);
    return nonZero !== undefined ? nonZero : 0;
  }, [fleetSeries]);

  const formatIdrNumber = (num) => {
    return new Intl.NumberFormat("id-ID").format(Math.round(Number(num) || 0));
  };

  // 5 Top stats for Station Curve (dynamically reflects selected region targetLocations)
  const totalSitesCount = targetLocations.length;
  const platformsCount = useMemo(() => {
    const s = new Set(targetLocations.map((l) => l.source).filter(Boolean));
    return s.size > 0 ? s.size : (targetLocations.length > 0 ? 1 : 0);
  }, [targetLocations]);
  const onlineCount = useMemo(() => {
    return targetLocations.filter((l) => l.status === "online" || (Number(l.current_power_kw ?? l.output_power_kw ?? l.pv_power_kw ?? l.power_kw ?? 0) > 0)).length;
  }, [targetLocations]);
  const offlineCount = Math.max(0, totalSitesCount - onlineCount);
  const currentPowerVal = formatNumber(activeStation?.current_power_kw ?? activeStation?.output_power_kw ?? activeStation?.pv_power_kw ?? activeStation?.power_kw ?? 0, 2) + " kW";

  const fleetRevQuarterly = useMemo(() => {
    return getFleetQuarterlyValues({
      targetLocations,
      selectedYear: fleetSelectedYear,
      metricType: "revenue",
      fallbackYearVal: fleetYearRevVal,
      currentMonthVal: fleetMonthRevVal,
    });
  }, [targetLocations, fleetSelectedYear, fleetYearRevVal, fleetMonthRevVal]);

  return (
    <div className="unified-analytics-view">
      {/* ROW 1: STATION REVENUE CURVE (LEFT) + DAFTAR PLTS & REVENUE (RIGHT) */}
      <div className="analytics-grid-row">
        {/* Left: Station Revenue Curve Card */}
        <div className="analytics-col-main">
          <div className="energy-curve-card">
            <div className="curve-card-header">
              <div>
                <h2 className="curve-title">{curveTitle}</h2>
                <p className="curve-subtitle">{curveSubtitle}</p>
              </div>
              <div className="curve-controls">
                <button
                  type="button"
                  className="tariff-settings-trigger-btn"
                  onClick={onOpenTariffModal}
                  title={canUserEditTariffs(currentUser)
                    ? "Atur tarif dasar listrik PLN per kategori gedung atau kustom per stasiun"
                    : "Lihat tarif dasar listrik PLN (Mode Hanya Lihat untuk Akun Wilayah)"
                  }
                >
                  <span>{canUserEditTariffs(currentUser) ? "⚙️ Atur Tarif" : "👁️ Lihat Tarif"}</span>
                  {customCount > 0 && <span className="tariff-badge-custom-count">{customCount}</span>}
                </button>
                <div className="period-toggle-pill">
                  <button
                    type="button"
                    className={period === "day" || period === "today" ? "active" : ""}
                    onClick={() => setPeriod("day")}
                  >
                    Day
                  </button>
                  <button
                    type="button"
                    className={period === "week" ? "active" : ""}
                    onClick={() => setPeriod("week")}
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    className={period === "month" ? "active" : ""}
                    onClick={() => setPeriod("month")}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className={period === "year" ? "active" : ""}
                    onClick={() => setPeriod("year")}
                  >
                    Year
                  </button>
                  <button
                    type="button"
                    className={period === "lifetime" ? "active" : ""}
                    onClick={() => setPeriod("lifetime")}
                  >
                    Lifetime
                  </button>
                </div>
                {(period === "day" || period === "today" || period === "week") && (
                  <DatePickerPill value={selectedDate} onChange={setSelectedDate} />
                )}
                {period === "month" && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <MonthDropdownPill value={selectedMonth} onChange={setSelectedMonth} />
                    <YearDropdownPill value={selectedYear} onChange={setSelectedYear} years={availableYears} />
                  </div>
                )}
                {period === "year" && (
                  <YearDropdownPill value={selectedYear} onChange={setSelectedYear} years={availableYears} />
                )}
                <span className="unit-pill-badge">{series?.unit || "IDR"}</span>
                {onOpenChartExport && (
                  <button
                    type="button"
                    className="btn-curve-export"
                    onClick={() => onOpenChartExport(activeStation?.id || activeStation?.uid || "all")}
                    title="Export Data Grafik (CSV / Excel)"
                  >
                    <DownloadIcon style={{ width: "12px", height: "12px" }} />
                    <span>Export</span>
                  </button>
                )}
              </div>
            </div>

            {/* Inner Chart Box */}
            <div className="energy-chart-stage">
              <RevenueProductionChart series={series} period={period} isKehua={isAutoTariff} />
            </div>

            {/* 5 Stats underneath chart as shown in design */}
            <div className="curve-stats-row-5">
              <div className="curve-stat-box">
                <span className="curve-stat-label">TOTAL SITES</span>
                <span className="curve-stat-value">{totalSitesCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">PLATFORMS</span>
                <span className="curve-stat-value">{platformsCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">ONLINE</span>
                <span className="curve-stat-value" style={{ color: "#10b981" }}>{onlineCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">OFFLINE</span>
                <span className="curve-stat-value" style={{ color: offlineCount > 0 ? "#ef4444" : "#6e8074" }}>{offlineCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">CURRENT POWER</span>
                <span className="curve-stat-value" style={{ color: "#047857" }}>{currentPowerVal}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Dark Station List Card + Station Revenue Card */}
        <div className="analytics-col-side">
          <StationListDarkCard
            locations={locations}
            allLocations={allLocations}
            activeStation={activeStation}
            onSelect={handleSelectStation}
            selectedRegion={selectedRegion || "all"}
            onSelectRegion={onSelectRegion}
            onUpdateStation={onUpdateStation}
            currentUser={currentUser}
          />

          <AnalyticsKpiCardGroup
            title="Revenue"
            todayVal={formatIdrNumber(todayRev)}
            todayUnit="IDR"
            todaySub={isSingleStation ? `Tarif: Rp ${formatIdrNumber(stationTariff)}/kWh` : "Dihitung per tarif gedung"}
            monthVal={formatIdrNumber(monthRev)}
            monthUnit="IDR"
            monthSub={isSingleStation ? `Tarif: Rp ${formatIdrNumber(stationTariff)}/kWh` : "Dihitung per tarif gedung"}
            yearVal={formatIdrNumber(yearRev)}
            yearUnit="IDR"
            yearSub={isSingleStation ? `Tarif: Rp ${formatIdrNumber(stationTariff)}/kWh` : "Dihitung per tarif gedung"}
            lifetimeVal={formatIdrNumber(lifetimeRev)}
            lifetimeUnit="IDR"
            lifetimeSub={isSingleStation ? `Tarif: Rp ${formatIdrNumber(stationTariff)}/kWh` : "Dihitung per tarif gedung"}
          />
        </div>
      </div>

      {/* ROW 2: TOTAL FLEET REVENUE CURVE (LEFT) + TOTAL REVENUE (TW 1-4) & TOTAL FLEET REVENUE (RIGHT) */}
      <div className="analytics-grid-row">
        {/* Left: Total Fleet Revenue Curve Card */}
        <div className="analytics-col-main">
          <div className="energy-curve-card">
            <div className="curve-card-header">
              <div>
                <h2 className="curve-title">{fleetCurveTitle}</h2>
                <p className="curve-subtitle">{fleetCurveSubtitle}</p>
              </div>
              <div className="curve-controls">
                <div className="period-toggle-pill">
                  <button
                    type="button"
                    className={fleetPeriod === "day" || fleetPeriod === "today" ? "active" : ""}
                    onClick={() => setFleetPeriod("day")}
                  >
                    Day
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "week" ? "active" : ""}
                    onClick={() => setFleetPeriod("week")}
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "month" ? "active" : ""}
                    onClick={() => setFleetPeriod("month")}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "year" ? "active" : ""}
                    onClick={() => setFleetPeriod("year")}
                  >
                    Year
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "lifetime" ? "active" : ""}
                    onClick={() => setFleetPeriod("lifetime")}
                  >
                    Lifetime
                  </button>
                </div>
                {(fleetPeriod === "day" || fleetPeriod === "today" || fleetPeriod === "week") && (
                  <DatePickerPill value={fleetSelectedDate} onChange={setFleetSelectedDate} />
                )}
                {fleetPeriod === "month" && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <MonthDropdownPill value={fleetSelectedMonth} onChange={setFleetSelectedMonth} />
                    <YearDropdownPill value={fleetSelectedYear} onChange={setFleetSelectedYear} years={availableYears} />
                  </div>
                )}
                {fleetPeriod === "year" && (
                  <YearDropdownPill value={fleetSelectedYear} onChange={setFleetSelectedYear} years={availableYears} />
                )}
                <span className="unit-pill-badge">{fleetSeries?.unit || "IDR"}</span>
                {onOpenChartExport && (
                  <button
                    type="button"
                    className="btn-curve-export"
                    onClick={() => onOpenChartExport("all")}
                    title="Export Data Grafik (CSV / Excel)"
                  >
                    <DownloadIcon style={{ width: "12px", height: "12px" }} />
                    <span>Export</span>
                  </button>
                )}
              </div>
            </div>

            {/* Inner Chart Box */}
            <div className="energy-chart-stage">
              <RevenueProductionChart series={fleetSeries} period={fleetPeriod} isKehua={false} />
            </div>

            {/* 3 Stats underneath chart */}
            <div className="curve-stats-row-3">
              <div className="curve-stat-box">
                <span className="curve-stat-label">RECORDS</span>
                <span className="curve-stat-value">{fleetRecordCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">HIGHEST</span>
                <span className="curve-stat-value">{formatIdrNumber(fleetHighestVal)} IDR</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">LATEST</span>
                <span className="curve-stat-value">{formatIdrNumber(fleetLatestVal)} IDR</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Total Revenue (TW 1-4) + Total fleet Revenue */}
        <div className="analytics-col-side">
          {/* Card 2: Total Revenue (4 bulan terakhir untuk Fleet) */}
          <AnalyticsQuarterlyKpiCardGroup
            title="Total Revenue"
            q1Val={formatIdrNumber(fleetRevQuarterly.q1)}
            q1Unit="IDR"
            q1Sub={`${fleetRevQuarterly.m1Name} · Tarif gedung`}
            q2Val={formatIdrNumber(fleetRevQuarterly.q2)}
            q2Unit="IDR"
            q2Sub={`${fleetRevQuarterly.m2Name} · Tarif gedung`}
            q3Val={formatIdrNumber(fleetRevQuarterly.q3)}
            q3Unit="IDR"
            q3Sub={`${fleetRevQuarterly.m3Name} · Tarif gedung`}
            q4Val={formatIdrNumber(fleetRevQuarterly.q4)}
            q4Unit="IDR"
            q4Sub={`${fleetRevQuarterly.m4Name} · Tarif gedung`}
          />

          {/* Card 3: Total fleet Revenue */}
          <AnalyticsKpiCardGroup
            title="Total fleet Revenue"
            todayVal={formatIdrNumber(fleetTodayRevVal)}
            todayUnit="IDR"
            todaySub="Tarif gedung"
            monthVal={formatIdrNumber(fleetMonthRevVal)}
            monthUnit="IDR"
            monthSub="Tarif gedung"
            yearVal={formatIdrNumber(fleetYearRevVal)}
            yearUnit="IDR"
            yearSub="Tarif gedung"
            lifetimeVal={formatIdrNumber(fleetLifetimeRevVal)}
            lifetimeUnit="IDR"
            lifetimeSub="Tarif gedung"
          />
        </div>
      </div>
    </div>
  );
}

function EmissionProductionChart({ series, period }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  if (series?.available === false) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        minHeight: "260px",
        background: "#fafbfa",
        borderRadius: "14px",
        border: "1px dashed #cbd5cb",
        padding: "28px 20px",
        textAlign: "center",
        boxSizing: "border-box",
      }}>
        <div style={{
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          background: "#ecfdf5",
          color: "#059669",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "12px",
          fontSize: "20px",
        }}>
          🌿
        </div>
        <h4 style={{ margin: "0 0 6px", fontSize: "15px", color: "#16231a", fontWeight: 700 }}>
          {series?.title || "Data Histori Emisi Belum Tersedia"}
        </h4>
        <p style={{ margin: 0, fontSize: "13px", color: "#6e8074", maxWidth: "440px", lineHeight: 1.5 }}>
          {series?.reason || "Data kurva grafik reduksi emisi CO₂ belum tersedia untuk periode ini."}
        </p>
      </div>
    );
  }

  const labels = series?.labels || [];
  const values = series?.values || [];

  const effectiveLabels = labels.length > 0 ? labels : ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  const effectiveValues = values.length > 0 ? values : Array.from({ length: effectiveLabels.length }, () => 0);

  const rawMax = Math.max(...effectiveValues.map((v) => Number(v) || 0), 10);
  const isTonScale = rawMax >= 1000;
  const scaleDivisor = isTonScale ? 1000 : 1;

  // Scaled max for yTicks
  const scaledMax = rawMax / scaleDivisor;
  const yMax = isTonScale
    ? Math.ceil(scaledMax * 1.15 * 10) / 10
    : (rawMax <= 10 ? 10 : Math.ceil(rawMax * 1.15));

  const yTicks = [
    0,
    Math.round(yMax * 0.25 * 10) / 10,
    Math.round(yMax * 0.5 * 10) / 10,
    Math.round(yMax * 0.75 * 10) / 10,
    Math.round(yMax * 10) / 10,
  ];

  const svgWidth = 720;
  const svgHeight = 290;
  const paddingLeft = isTonScale ? 64 : 48;
  const paddingRight = 14;
  const paddingTop = 14;
  const paddingBottom = 26;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  const barCount = effectiveLabels.length;
  const step = plotWidth / barCount;
  const barWidth = Math.max(5, Math.min(step * 0.72, 28));

  let latestNonZeroIndex = -1;
  for (let idx = effectiveValues.length - 1; idx >= 0; idx--) {
    if (Number(effectiveValues[idx]) > 0) {
      latestNonZeroIndex = idx;
      break;
    }
  }

  const isLabelVisible = (index) => {
    if (period === "day" || period === "today") {
      const lbl = effectiveLabels[index] || "";
      return lbl.endsWith(":00") && parseInt(lbl.split(":")[0], 10) % 3 === 0;
    }
    if (period === "week") {
      return true;
    }
    if (period === "year") {
      const val = parseInt(effectiveLabels[index], 10);
      return [1, 3, 6, 8, 10, 12].includes(val);
    }
    if (period === "month") {
      const day = parseInt(effectiveLabels[index], 10);
      return [1, 5, 10, 15, 20, 25, 30].includes(day);
    }
    return true;
  };

  const formatTick = (val) => {
    if (val === 0) return "0";
    if (isTonScale) return `${val.toFixed(1)} Ton`;
    return `${Math.round(val)} kg`;
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", flex: 1, display: "flex", alignItems: "stretch" }}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      >
        {/* Horizontal Grid lines and Y labels */}
        {yTicks.map((tick, i) => {
          const ratio = (tick - yTicks[0]) / (yTicks[yTicks.length - 1] - yTicks[0] || 1);
          const y = paddingTop + plotHeight - ratio * plotHeight;
          return (
            <g key={i}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={svgWidth - paddingRight}
                y2={y}
                stroke="rgba(0, 0, 0, 0.06)"
                strokeDasharray={tick === 0 ? "none" : "3 3"}
              />
              <text
                x={paddingLeft - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize="10"
                fontWeight="500"
                fill="#7e9185"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {formatTick(tick)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {effectiveValues.map((val, i) => {
          const num = Number(val) || 0;
          const scaledNum = num / scaleDivisor;
          const barHeight = Math.max((scaledNum / (yTicks[yTicks.length - 1] || 1)) * plotHeight, 0);
          const x = paddingLeft + i * step + (step - barWidth) / 2;
          const y = paddingTop + plotHeight - barHeight;
          const isHovered = hoveredIndex === i;
          const isCurrentActive = i === latestNonZeroIndex;

          return (
            <g
              key={i}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={paddingLeft + i * step}
                y={paddingTop}
                width={step}
                height={plotHeight}
                fill="transparent"
              />
              {barHeight > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx="3"
                  ry="3"
                  fill={isHovered ? "#047857" : (isCurrentActive ? "#059669" : "#a7f3d0")}
                  opacity={isHovered ? 1 : 0.95}
                  style={{ transition: "all 0.2s ease" }}
                />
              )}
            </g>
          );
        })}

        {/* X-axis labels */}
        {effectiveLabels.map((lbl, i) => {
          if (!isLabelVisible(i)) return null;
          const x = paddingLeft + i * step + step / 2;
          const y = paddingTop + plotHeight + 16;
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              fontSize="10"
              fontWeight="500"
              fill="#7e9185"
              fontFamily="Inter, system-ui, sans-serif"
            >
              {lbl}
            </text>
          );
        })}
      </svg>

      {hoveredIndex !== null && (
        <div style={{
          position: "absolute",
          top: "6px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#111a14",
          color: "#ffffff",
          padding: "4px 12px",
          borderRadius: "8px",
          fontSize: "11px",
          fontWeight: 600,
          pointerEvents: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          display: "flex",
          gap: "8px",
          zIndex: 10,
        }}>
          <span style={{ color: "#a3b8aa" }}>
            {period === "day" || period === "today"
              ? `Jam ${effectiveLabels[hoveredIndex]}`
              : (period === "week"
                ? `Hari ${effectiveLabels[hoveredIndex]}`
                : (period === "year"
                  ? `Bulan ${effectiveLabels[hoveredIndex]}`
                  : (period === "month"
                    ? `Tgl ${effectiveLabels[hoveredIndex]}`
                    : `Tahun ${effectiveLabels[hoveredIndex]}`)))}
          </span>
          <span style={{ color: "#34d399" }}>
            {Number(effectiveValues[hoveredIndex]) >= 1000
              ? `${(Number(effectiveValues[hoveredIndex]) / 1000).toFixed(2)} Ton CO₂ (${new Intl.NumberFormat("id-ID").format(Math.round(Number(effectiveValues[hoveredIndex])))} kg)`
              : `${Number(effectiveValues[hoveredIndex]).toFixed(1)} kg CO₂`}
          </span>
        </div>
      )}
    </div>
  );
}

function EmissionView({ location, fleet, locations, allLocations, onSelect, selectedRegion = "all", onSelectRegion, onUpdateStation, currentUser, onOpenChartExport }) {
  const pool = (allLocations && allLocations.length > 0) ? allLocations : (locations || []);
  const [localStationUid, setLocalStationUid] = useState(location?.uid || null);

  const [period, setPeriod] = useState("day");
  const [selectedDate, setSelectedDate] = useState(getTodayDateStr);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  // Fleet series states
  const [fleetRegion, setFleetRegion] = useState(selectedRegion || "all");
  const [fleetPeriod, setFleetPeriod] = useState("day");
  const [fleetSelectedDate, setFleetSelectedDate] = useState(getTodayDateStr);
  const [fleetSelectedMonth, setFleetSelectedMonth] = useState(() => new Date().getMonth());
  const [fleetSelectedYear, setFleetSelectedYear] = useState(() => new Date().getFullYear());

  useEffect(() => {
    if (location?.uid) {
      setLocalStationUid(location.uid);
    }
  }, [location?.uid]);

  useEffect(() => {
    if (selectedRegion) {
      setFleetRegion(selectedRegion);
      if (selectedRegion !== "all") {
        setLocalStationUid((prevUid) => {
          if (!prevUid) return null;
          const found = pool.find((l) => l.uid === prevUid || l.id === prevUid);
          const reg = found?.region ? String(found.region).toLowerCase() : getStationRegion(found);
          return reg === selectedRegion ? prevUid : null;
        });
      }
    }
  }, [selectedRegion, pool]);

  const targetLocations = useMemo(() => {
    if (fleetRegion === "all") return pool;
    return pool.filter((loc) => {
      const reg = loc.region ? String(loc.region).toLowerCase() : getStationRegion(loc);
      return reg === fleetRegion;
    });
  }, [pool, fleetRegion]);

  const currentRegObj = useMemo(() => {
    return REGIONS.find((r) => r.id === fleetRegion) || REGIONS[0];
  }, [fleetRegion]);

  const activeStation = useMemo(() => {
    if (localStationUid) {
      const match = targetLocations.find((l) => l.uid === localStationUid || l.id === localStationUid);
      if (match) return match;
    }
    if (location && targetLocations.some((l) => l.uid === location.uid || l.id === location.id)) {
      return location;
    }
    return (targetLocations && targetLocations.length > 0) ? targetLocations[0] : (pool[0] || null);
  }, [localStationUid, location, targetLocations, pool]);

  const handleSelectStation = useCallback((uid) => {
    setLocalStationUid(uid);
    if (onSelect) onSelect(uid);
  }, [onSelect]);

  const handleFleetRegionChange = useCallback((regId) => {
    setFleetRegion(regId);
    if (onSelectRegion) onSelectRegion(regId);
  }, [onSelectRegion]);

  const hasLocations = Boolean(targetLocations && targetLocations.length > 0);
  const stationName = activeStation?.name || ((targetLocations && targetLocations.length > 0) ? "Pilih PLTS" : "Tidak Ada PLTS");
  const platformName = activeStation?.source
    ? (activeStation.source.charAt(0).toUpperCase() + activeStation.source.slice(1))
    : "—";

  const EMISSION_FACTOR = 0.85; // kg CO2 / kWh

  const todayKwh = Number(activeStation?.daily_energy_kwh || activeStation?.today_energy_kwh || 0);
  const monthKwh = Number(activeStation?.monthly_energy_kwh || 0);
  const yearKwh = Number(activeStation?.yearly_energy_kwh || 0);
  const lifetimeKwh = Number(activeStation?.cumulative_energy_kwh || 0);

  const todayEmissionKg = todayKwh * EMISSION_FACTOR;
  const monthEmissionKg = monthKwh * EMISSION_FACTOR;
  const yearEmissionKg = yearKwh * EMISSION_FACTOR;
  const lifetimeEmissionKg = lifetimeKwh * EMISSION_FACTOR;

  const targetTodayEmissionKg = useMemo(() => {
    return targetLocations.reduce((sum, loc) => sum + (Number(loc?.daily_energy_kwh ?? loc?.today_energy_kwh) || 0), 0) * EMISSION_FACTOR;
  }, [targetLocations]);

  const targetMonthEmissionKg = useMemo(() => {
    return targetLocations.reduce((sum, loc) => sum + (Number(loc?.monthly_energy_kwh ?? loc?.month_energy_kwh) || 0), 0) * EMISSION_FACTOR;
  }, [targetLocations]);

  const targetYearEmissionKg = useMemo(() => {
    return targetLocations.reduce((sum, loc) => sum + (Number(loc?.yearly_energy_kwh ?? loc?.year_energy_kwh) || 0), 0) * EMISSION_FACTOR;
  }, [targetLocations]);

  const targetLifetimeEmissionKg = useMemo(() => {
    return targetLocations.reduce((sum, loc) => sum + (Number(loc?.cumulative_energy_kwh ?? loc?.total_energy_kwh) || 0), 0) * EMISSION_FACTOR;
  }, [targetLocations]);

  const fleetTotalTodayEmissionKg = targetTodayEmissionKg > 0
    ? targetTodayEmissionKg
    : (fleetRegion === "all" ? (Number(fleet?.daily || 0) * EMISSION_FACTOR) : 0);
  const fleetMonthEmissionKgCalc = targetMonthEmissionKg > 0
    ? targetMonthEmissionKg
    : (fleetRegion === "all" ? (Number(fleet?.monthly || 0) * EMISSION_FACTOR) : 0);
  const fleetYearEmissionKgCalc = fleetRegion === "all"
    ? (Number(fleet?.yearly || 0) * EMISSION_FACTOR || targetYearEmissionKg)
    : targetYearEmissionKg;
  const fleetTotalEmissionKgCalc = fleetRegion === "all"
    ? (Number(fleet?.cumulative || 0) * EMISSION_FACTOR || targetLifetimeEmissionKg)
    : targetLifetimeEmissionKg;

  const availableYears = useMemo(() => {
    return getAvailableProductionYears(allLocations || locations, activeStation);
  }, [allLocations, locations, activeStation]);

  const series = useMemo(() => {
    if (!activeStation || !(activeStation.id || activeStation.station_id || activeStation.uid || activeStation.name)) {
      const currentYear = new Date().getFullYear();
      const fallbackYears = Array.from({ length: Math.max(1, currentYear - 2022 + 1) }, (_, i) => String(2022 + i));
      const count = (period === "day" || period === "today") ? 24 : (period === "week" ? 7 : (period === "month" ? 31 : (period === "year" ? 12 : fallbackYears.length)));
      const labels = (period === "day" || period === "today")
        ? Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`)
        : (period === "week"
          ? ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
          : (period === "month"
            ? Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"))
            : (period === "year"
              ? ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]
              : fallbackYears)));
      return {
        available: true,
        labels,
        values: Array(count).fill(0),
        unit: "kg CO₂",
        title: "Emission history",
      };
    }

    if (period === "day" || period === "today") {
      const daily = getStationDailyValues(activeStation, selectedDate, "emission");
      return {
        available: true,
        labels: daily.labels,
        values: daily.values,
        unit: "kg CO₂",
        kind: "bar",
        title: "Daily emission reduction curve",
        caption: `Reduksi emisi per jam (${formatToDisplayDate(selectedDate)})`,
      };
    }

    if (period === "week") {
      const weekly = getStationWeeklyValues(activeStation, selectedDate, "emission");
      return {
        available: true,
        labels: weekly.labels,
        values: weekly.values,
        unit: "kg CO₂",
        kind: "bar",
        title: "Weekly emission reduction curve (7 days)",
        caption: `Reduksi emisi 7 hari (${formatToDisplayDate(selectedDate)})`,
      };
    }

    if (period === "month") {
      const daysInSelectedMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      const labels = Array.from({ length: daysInSelectedMonth }, (_, i) => String(i + 1).padStart(2, "0"));
      const vals = getStationDailyMonthValues(activeStation, selectedYear, selectedMonth, "emission");
      return {
        available: true,
        labels,
        values: vals,
        unit: "kg CO₂",
        kind: "bar",
        title: "Daily emission reduction this month",
        caption: `Reduksi emisi harian (${MONTH_NAMES[selectedMonth]} ${selectedYear}) (0.85 kg CO₂/kWh)`,
      };
    }

    if (period === "year") {
      const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
      const vals = getStationMonthlyValues(activeStation, selectedYear, "emission");
      return {
        available: true,
        labels: months,
        values: vals,
        unit: "kg CO₂",
        kind: "bar",
        title: "Monthly emission reduction this year",
        caption: `Reduksi emisi bulanan (${selectedYear}) (0.85 kg CO₂/kWh)`,
      };
    }

    if (period === "lifetime") {
      const lifetimeYears = getStationLifetimeYears(activeStation);
      const vals = lifetimeYears.map((yrStr) => {
        const val = getStationHistoricalYearKwh(activeStation, parseInt(yrStr, 10));
        return Math.round(val * 0.85 * 10) / 10;
      });
      return {
        available: true,
        labels: lifetimeYears,
        values: vals,
        unit: "kg CO₂",
        kind: "bar",
        title: "Emission reduction by year",
        caption: "Akumulasi reduksi emisi tahunan (0.85 kg CO₂/kWh)",
      };
    }

    if (period === "day" || period === "today") {
      const daily = getStationDailyValues(activeStation, selectedDate, "emission");
      return {
        available: true,
        labels: daily.labels,
        values: daily.values,
        unit: "kg CO₂",
        kind: "bar",
        title: "Daily emission reduction",
        caption: `Reduksi emisi per jam (${formatToDisplayDate(selectedDate)}) (0.85 kg CO₂/kWh)`,
      };
    }

    if (period === "week") {
      const weekly = getStationWeeklyValues(activeStation, selectedDate, "emission");
      return {
        available: true,
        labels: weekly.labels,
        values: weekly.values,
        unit: "kg CO₂",
        kind: "bar",
        title: "Weekly emission reduction (last 7 days)",
        caption: `Reduksi emisi 7 hari (${formatToDisplayDate(selectedDate)}) (0.85 kg CO₂/kWh)`,
      };
    }

    const s = getEmissionSeries(activeStation, period);
    if (!s || s.available === false) {
      if (period === "month") {
        const daysInSelectedMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
        const now = new Date();
        const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth();
        const isFutureMonth = selectedYear > now.getFullYear() || (selectedYear === now.getFullYear() && selectedMonth > now.getMonth());

        const labels = Array.from({ length: daysInSelectedMonth }, (_, i) => String(i + 1).padStart(2, "0"));
        const avg = monthEmissionKg > 0 ? (monthEmissionKg / Math.max(1, isCurrentMonth ? now.getDate() : daysInSelectedMonth)) : (todayEmissionKg || 10);
        const values = labels.map((_, i) => {
          if (isFutureMonth) return 0;
          if (isCurrentMonth && (i + 1 > now.getDate())) return 0;
          if (isCurrentMonth && (i + 1 === now.getDate()) && todayEmissionKg > 0) return Math.round(todayEmissionKg * 10) / 10;
          const factor = 0.85 + (((i + selectedMonth) * 7) % 30) / 100;
          return Math.round(avg * factor * 10) / 10;
        });
        return {
          available: true,
          labels,
          values,
          unit: "kg CO₂",
          kind: "bar",
          title: "Daily emission reduction this month",
          caption: `Reduksi emisi harian (${MONTH_NAMES[selectedMonth]} ${selectedYear}) (0.85 kg CO₂/kWh)`,
        };
      }
      if (period === "year") {
        const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
        const now = new Date();
        const isCurrentYear = selectedYear === now.getFullYear();
        const isFutureYear = selectedYear > now.getFullYear();
        const nowMonth = now.getMonth();
        const avgMonth = yearEmissionKg > 0 ? (yearEmissionKg / Math.max(1, isCurrentYear ? nowMonth + 1 : 12)) : (monthEmissionKg || 100);
        const values = months.map((_, i) => {
          if (isFutureYear) return 0;
          if (isCurrentYear && i > nowMonth) return 0;
          if (isCurrentYear && i === nowMonth && monthEmissionKg > 0) return Math.round(monthEmissionKg * 10) / 10;
          const factor = 0.9 + (((i + (selectedYear % 5)) * 5) % 20) / 100;
          return Math.round(avgMonth * factor * 10) / 10;
        });
        return {
          available: true,
          labels,
          values,
          unit: "kg CO₂",
          kind: "bar",
          title: "Monthly emission reduction this year",
          caption: `Reduksi emisi bulanan (${selectedYear}) (0.85 kg CO₂/kWh)`,
        };
      }
    }
    return s;
  }, [activeStation, period, selectedDate, selectedMonth, selectedYear, todayEmissionKg, monthEmissionKg, yearEmissionKg, lifetimeEmissionKg]);

  const fleetSeries = useMemo(() => {
    return buildAggregatedFleetSeries({
      targetLocations,
      period: fleetPeriod,
      selectedDate: fleetSelectedDate,
      selectedMonth: fleetSelectedMonth,
      selectedYear: fleetSelectedYear,
      metricType: "emission",
      fleetTotalVals: {
        daily: fleetTotalTodayEmissionKg,
        monthly: fleetMonthEmissionKgCalc,
        yearly: fleetYearEmissionKgCalc,
        lifetime: fleetTotalEmissionKgCalc,
      },
    });
  }, [targetLocations, fleetPeriod, fleetSelectedDate, fleetSelectedMonth, fleetSelectedYear, fleetTotalTodayEmissionKg, fleetMonthEmissionKgCalc, fleetYearEmissionKgCalc, fleetTotalEmissionKgCalc]);

  const curveSubtitle = useMemo(() => {
    if (!hasLocations) return "Belum ada instalasi PLTS di wilayah ini (0 kg CO₂)";
    if (period === "day" || period === "today") return `${stationName} · Reduksi emisi (${formatToDisplayDate(selectedDate)}) · ${platformName}`;
    if (period === "week") return `${stationName} · Reduksi emisi 7 hari (${formatToDisplayDate(selectedDate)}) · ${platformName}`;
    if (period === "month") return `${stationName} · Reduksi emisi harian (${MONTH_NAMES[selectedMonth]} ${selectedYear}) · ${platformName}`;
    if (period === "year") return `${stationName} · Reduksi emisi bulanan (${selectedYear}) · ${platformName}`;
    return `${stationName} · Histori akumulasi reduksi emisi CO₂ per tahun · ${platformName}`;
  }, [hasLocations, stationName, period, selectedDate, selectedMonth, selectedYear, platformName]);

  const curveTitle = useMemo(() => {
    if (period === "day" || period === "today") return "Daily emission reduction";
    if (period === "week") return "Weekly emission reduction (last 7 days)";
    if (period === "month") return "Daily emission reduction this month";
    if (period === "year") return "Monthly emission reduction this year";
    return "Emission reduction by year";
  }, [period]);

  const fleetCurveTitle = useMemo(() => {
    if (fleetPeriod === "day" || fleetPeriod === "today") return "Total fleet daily emission reduction";
    if (fleetPeriod === "week") return "Total fleet weekly emission reduction (last 7 days)";
    if (fleetPeriod === "month") return "Total fleet daily emission reduction this month";
    if (fleetPeriod === "year") return "Total fleet monthly emission reduction this year";
    return "Total fleet emission reduction by year";
  }, [fleetPeriod]);

  const fleetCurveSubtitle = useMemo(() => {
    const count = targetLocations?.length || 0;
    const prefix = fleetRegion === "all"
      ? `Semua PLTS (${count} Stasiun)`
      : `Wilayah ${currentRegObj?.name || "DKI Jakarta"} (${count} Stasiun)`;
    if (fleetPeriod === "day" || fleetPeriod === "today") return `${prefix} · Total emisi (${formatToDisplayDate(fleetSelectedDate)}) · 0.85 kg CO₂/kWh`;
    if (fleetPeriod === "week") return `${prefix} · Total emisi 7 hari (${formatToDisplayDate(fleetSelectedDate)}) · 0.85 kg CO₂/kWh`;
    if (fleetPeriod === "month") return `${prefix} · Total emisi harian (${MONTH_NAMES[fleetSelectedMonth]} ${fleetSelectedYear}) · 0.85 kg CO₂/kWh`;
    if (fleetPeriod === "year") return `${prefix} · Total emisi bulanan (${fleetSelectedYear}) · 0.85 kg CO₂/kWh`;
    return `${prefix} · Histori akumulasi total reduksi emisi CO₂ per tahun`;
  }, [targetLocations, fleetRegion, currentRegObj, fleetPeriod, fleetSelectedDate, fleetSelectedMonth, fleetSelectedYear]);

  const recordCount = useMemo(() => {
    if (period === "day" || period === "today") return `${series?.values?.length || 24} / 24`;
    if (period === "week") return `${series?.values?.length || 7} / 7`;
    if (period === "month") return `${series?.values?.length || 31} / 31`;
    if (period === "year") return `${series?.values?.length || 12} / 12`;
    return `${series?.values?.length || 5} / ${series?.values?.length || 5}`;
  }, [period, series]);

  const highestVal = useMemo(() => {
    const vals = (series?.values || []).map((v) => Number(v) || 0);
    return vals.length > 0 ? Math.max(...vals) : 0;
  }, [series]);

  const latestVal = useMemo(() => {
    const vals = (series?.values || []).map((v) => Number(v) || 0);
    if (!vals.length) return 0;
    const nonZero = [...vals].reverse().find((v) => v > 0);
    return nonZero !== undefined ? nonZero : 0;
  }, [series]);

  const fleetRecordCount = useMemo(() => {
    if (fleetPeriod === "day" || fleetPeriod === "today") return `${fleetSeries?.values?.length || 24} / 24`;
    if (fleetPeriod === "week") return `${fleetSeries?.values?.length || 7} / 7`;
    if (fleetPeriod === "month") return `${fleetSeries?.values?.length || 31} / 31`;
    if (fleetPeriod === "year") return `${fleetSeries?.values?.length || 12} / 12`;
    return `${fleetSeries?.values?.length || 5} / ${fleetSeries?.values?.length || 5}`;
  }, [fleetPeriod, fleetSeries]);

  const fleetHighestVal = useMemo(() => {
    const vals = (fleetSeries?.values || []).map((v) => Number(v) || 0);
    return vals.length > 0 ? Math.max(...vals) : 0;
  }, [fleetSeries]);

  const fleetLatestVal = useMemo(() => {
    const vals = (fleetSeries?.values || []).map((v) => Number(v) || 0);
    if (!vals.length) return 0;
    const nonZero = [...vals].reverse().find((v) => v > 0);
    return nonZero !== undefined ? nonZero : 0;
  }, [fleetSeries]);

  const formatEmissionCard = (kg) => {
    const num = Number(kg) || 0;
    if (num >= 1000) {
      return {
        val: (num / 1000).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        unit: "TON CO₂",
      };
    }
    return {
      val: num.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      unit: "KG CO₂",
    };
  };  // 5 Top stats for Station Curve (dynamically reflects selected region targetLocations)
  const totalSitesCount = targetLocations.length;
  const platformsCount = useMemo(() => {
    const s = new Set(targetLocations.map((l) => l.source).filter(Boolean));
    return s.size > 0 ? s.size : (targetLocations.length > 0 ? 1 : 0);
  }, [targetLocations]);
  const onlineCount = useMemo(() => {
    return targetLocations.filter((l) => l.status === "online" || (Number(l.current_power_kw ?? l.output_power_kw ?? l.pv_power_kw ?? l.power_kw ?? 0) > 0)).length;
  }, [targetLocations]);
  const offlineCount = Math.max(0, totalSitesCount - onlineCount);
  const currentPowerVal = formatNumber(activeStation?.current_power_kw ?? activeStation?.output_power_kw ?? activeStation?.pv_power_kw ?? activeStation?.power_kw ?? 0, 2) + " kW";

  const fleetEmQuarterly = useMemo(() => {
    return getFleetQuarterlyValues({
      targetLocations,
      selectedYear: fleetSelectedYear,
      metricType: "emission",
      fallbackYearVal: fleetYearEmissionKgCalc,
      currentMonthVal: fleetMonthEmissionKgCalc,
    });
  }, [targetLocations, fleetSelectedYear, fleetYearEmissionKgCalc, fleetMonthEmissionKgCalc]);

  return (
    <div className="unified-analytics-view">
      {/* ROW 1: STATION EMISSION CURVE (LEFT) + DAFTAR PLTS & EMISSION (RIGHT) */}
      <div className="analytics-grid-row">
        {/* Left: Station Emission Curve Card */}
        <div className="analytics-col-main">
          <div className="energy-curve-card">
            <div className="curve-card-header">
              <div>
                <h2 className="curve-title">{curveTitle}</h2>
                <p className="curve-subtitle">{curveSubtitle}</p>
              </div>
              <div className="curve-controls">
                <div className="period-toggle-pill">
                  <button
                    type="button"
                    className={period === "day" || period === "today" ? "active" : ""}
                    onClick={() => setPeriod("day")}
                  >
                    Day
                  </button>
                  <button
                    type="button"
                    className={period === "week" ? "active" : ""}
                    onClick={() => setPeriod("week")}
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    className={period === "month" ? "active" : ""}
                    onClick={() => setPeriod("month")}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className={period === "year" ? "active" : ""}
                    onClick={() => setPeriod("year")}
                  >
                    Year
                  </button>
                  <button
                    type="button"
                    className={period === "lifetime" ? "active" : ""}
                    onClick={() => setPeriod("lifetime")}
                  >
                    Lifetime
                  </button>
                </div>
                {(period === "day" || period === "today" || period === "week") && (
                  <DatePickerPill value={selectedDate} onChange={setSelectedDate} />
                )}
                {period === "month" && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <MonthDropdownPill value={selectedMonth} onChange={setSelectedMonth} />
                    <YearDropdownPill value={selectedYear} onChange={setSelectedYear} years={availableYears} />
                  </div>
                )}
                {period === "year" && (
                  <YearDropdownPill value={selectedYear} onChange={setSelectedYear} years={availableYears} />
                )}
                <span className="unit-pill-badge">{series?.unit || "kg CO₂"}</span>
                {onOpenChartExport && (
                  <button
                    type="button"
                    className="btn-curve-export"
                    onClick={() => onOpenChartExport(activeStation?.id || activeStation?.uid || "all")}
                    title="Export Data Grafik (CSV / Excel)"
                  >
                    <DownloadIcon style={{ width: "12px", height: "12px" }} />
                    <span>Export</span>
                  </button>
                )}
              </div>
            </div>

            {/* Inner Chart Box */}
            <div className="energy-chart-stage">
              <EmissionProductionChart series={series} period={period} />
            </div>

            {/* 5 Stats underneath chart as shown in design */}
            <div className="curve-stats-row-5">
              <div className="curve-stat-box">
                <span className="curve-stat-label">TOTAL SITES</span>
                <span className="curve-stat-value">{totalSitesCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">PLATFORMS</span>
                <span className="curve-stat-value">{platformsCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">ONLINE</span>
                <span className="curve-stat-value" style={{ color: "#10b981" }}>{onlineCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">OFFLINE</span>
                <span className="curve-stat-value" style={{ color: offlineCount > 0 ? "#ef4444" : "#6e8074" }}>{offlineCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">CURRENT POWER</span>
                <span className="curve-stat-value" style={{ color: "#047857" }}>{currentPowerVal}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Dark Station List Card + Station Emission Card */}
        <div className="analytics-col-side">
          <StationListDarkCard
            locations={locations}
            allLocations={allLocations}
            activeStation={activeStation}
            onSelect={handleSelectStation}
            selectedRegion={selectedRegion || "all"}
            onSelectRegion={onSelectRegion}
            onUpdateStation={onUpdateStation}
            currentUser={currentUser}
          />

          <AnalyticsKpiCardGroup
            title="Emission"
            todayVal={formatEmissionCard(todayEmissionKg).val}
            todayUnit={formatEmissionCard(todayEmissionKg).unit}
            todaySub="0.85 kg/kWh"
            monthVal={formatEmissionCard(monthEmissionKg).val}
            monthUnit={formatEmissionCard(monthEmissionKg).unit}
            monthSub="0.85 kg/kWh"
            yearVal={formatEmissionCard(yearEmissionKg).val}
            yearUnit={formatEmissionCard(yearEmissionKg).unit}
            yearSub="0.85 kg/kWh"
            lifetimeVal={formatEmissionCard(lifetimeEmissionKg).val}
            lifetimeUnit={formatEmissionCard(lifetimeEmissionKg).unit}
            lifetimeSub="0.85 kg/kWh"
          />
        </div>
      </div>

      {/* ROW 2: TOTAL FLEET EMISSION CURVE (LEFT) + TOTAL EMISSION (TW 1-4) & TOTAL FLEET EMISSION (RIGHT) */}
      <div className="analytics-grid-row">
        {/* Left: Total Fleet Emission Curve Card */}
        <div className="analytics-col-main">
          <div className="energy-curve-card">
            <div className="curve-card-header">
              <div>
                <h2 className="curve-title">{fleetCurveTitle}</h2>
                <p className="curve-subtitle">{fleetCurveSubtitle}</p>
              </div>
              <div className="curve-controls">
                <div className="period-toggle-pill">
                  <button
                    type="button"
                    className={fleetPeriod === "day" || fleetPeriod === "today" ? "active" : ""}
                    onClick={() => setFleetPeriod("day")}
                  >
                    Day
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "week" ? "active" : ""}
                    onClick={() => setFleetPeriod("week")}
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "month" ? "active" : ""}
                    onClick={() => setFleetPeriod("month")}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "year" ? "active" : ""}
                    onClick={() => setFleetPeriod("year")}
                  >
                    Year
                  </button>
                  <button
                    type="button"
                    className={fleetPeriod === "lifetime" ? "active" : ""}
                    onClick={() => setFleetPeriod("lifetime")}
                  >
                    Lifetime
                  </button>
                </div>
                {(fleetPeriod === "day" || fleetPeriod === "today" || fleetPeriod === "week") && (
                  <DatePickerPill value={fleetSelectedDate} onChange={setFleetSelectedDate} />
                )}
                {fleetPeriod === "month" && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <MonthDropdownPill value={fleetSelectedMonth} onChange={setFleetSelectedMonth} />
                    <YearDropdownPill value={fleetSelectedYear} onChange={setFleetSelectedYear} years={availableYears} />
                  </div>
                )}
                {fleetPeriod === "year" && (
                  <YearDropdownPill value={fleetSelectedYear} onChange={setFleetSelectedYear} years={availableYears} />
                )}
                <span className="unit-pill-badge">{fleetSeries?.unit || "kg CO₂"}</span>
                {onOpenChartExport && (
                  <button
                    type="button"
                    className="btn-curve-export"
                    onClick={() => onOpenChartExport("all")}
                    title="Export Data Grafik (CSV / Excel)"
                  >
                    <DownloadIcon style={{ width: "12px", height: "12px" }} />
                    <span>Export</span>
                  </button>
                )}
              </div>
            </div>

            {/* Inner Chart Box */}
            <div className="energy-chart-stage">
              <EmissionProductionChart series={fleetSeries} period={fleetPeriod} />
            </div>

            {/* 3 Stats underneath chart */}
            <div className="curve-stats-row-3">
              <div className="curve-stat-box">
                <span className="curve-stat-label">RECORDS</span>
                <span className="curve-stat-value">{fleetRecordCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">HIGHEST</span>
                <span className="curve-stat-value">
                  {formatEmissionCard(fleetHighestVal).val} {formatEmissionCard(fleetHighestVal).unit}
                </span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">LATEST</span>
                <span className="curve-stat-value">
                  {formatEmissionCard(fleetLatestVal).val} {formatEmissionCard(fleetLatestVal).unit}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Total Emission (TW 1-4) + Total fleet Emission */}
        <div className="analytics-col-side">
          {/* Card 2: Total Emission (4 bulan terakhir untuk Fleet) */}
          <AnalyticsQuarterlyKpiCardGroup
            title="Total Emission"
            q1Val={formatEmissionCard(fleetEmQuarterly.q1).val}
            q1Unit={formatEmissionCard(fleetEmQuarterly.q1).unit}
            q1Sub={`${fleetEmQuarterly.m1Name} · 0.85 kg/kWh`}
            q2Val={formatEmissionCard(fleetEmQuarterly.q2).val}
            q2Unit={formatEmissionCard(fleetEmQuarterly.q2).unit}
            q2Sub={`${fleetEmQuarterly.m2Name} · 0.85 kg/kWh`}
            q3Val={formatEmissionCard(fleetEmQuarterly.q3).val}
            q3Unit={formatEmissionCard(fleetEmQuarterly.q3).unit}
            q3Sub={`${fleetEmQuarterly.m3Name} · 0.85 kg/kWh`}
            q4Val={formatEmissionCard(fleetEmQuarterly.q4).val}
            q4Unit={formatEmissionCard(fleetEmQuarterly.q4).unit}
            q4Sub={`${fleetEmQuarterly.m4Name} · 0.85 kg/kWh`}
          />

          {/* Card 3: Total fleet Emission */}
          <AnalyticsKpiCardGroup
            title="Total fleet Emission"
            todayVal={formatEmissionCard(fleetTotalTodayEmissionKg).val}
            todayUnit={formatEmissionCard(fleetTotalTodayEmissionKg).unit}
            todaySub="0.85 kg/kWh"
            monthVal={formatEmissionCard(fleetMonthEmissionKgCalc).val}
            monthUnit={formatEmissionCard(fleetMonthEmissionKgCalc).unit}
            monthSub="0.85 kg/kWh"
            yearVal={formatEmissionCard(fleetYearEmissionKgCalc).val}
            yearUnit={formatEmissionCard(fleetYearEmissionKgCalc).unit}
            yearSub="0.85 kg/kWh"
            lifetimeVal={formatEmissionCard(fleetTotalEmissionKgCalc).val}
            lifetimeUnit={formatEmissionCard(fleetTotalEmissionKgCalc).unit}
            lifetimeSub="0.85 kg/kWh"
          />
        </div>
      </div>
    </div>
  );
}

/* ==================== DATA BUILDERS & HELPERS ==================== */

function buildFleet(sites, locations) {
  if (!locations || locations.length === 0) {
    return {
      stations: 0,
      platforms: 0,
      online: 0,
      offline: 0,
      capacity: 0,
      current: 0,
      daily: 0,
      monthly: 0,
      yearly: 0,
      cumulative: 0,
      lifetime: 0,
      totalIncome: 0,
      monthlyIncome: 0,
      yearlyIncome: 0,
    };
  }

  const overview = sites.map((s) => s.overview || {});
  const capacity = locations.reduce((sum, l) => sum + (Number(l.capacity_kwp || l.installed_capacity) || 0), 0);
  const current = locations.reduce((sum, l) => sum + (Number(l.current_power_kw ?? l.output_power_kw ?? l.pv_power_kw) || 0), 0);
  const daily = locations.reduce((sum, l) => sum + (Number(l.today_energy_kwh ?? l.daily_energy_kwh) || 0), 0);
  const monthly = locations.reduce((sum, l) => sum + (Number(l.monthly_energy_kwh ?? l.month_energy_kwh) || 0), 0);
  const yearly = locations.reduce((sum, l) => sum + (Number(l.yearly_energy_kwh ?? l.year_energy_kwh) || 0), 0);
  const cumulative = locations.reduce((sum, l) => sum + (Number(l.cumulative_energy_kwh ?? l.total_energy_kwh) || 0), 0);
  const totalIncome = locations.reduce((sum, l) => sum + (Number(l.cumulative_income) || 0), 0);
  const monthlyIncome = locations.reduce((sum, l) => sum + (Number(l.monthly_income) || 0), 0);
  const yearlyIncome = locations.reduce((sum, l) => sum + (Number(l.yearly_income) || 0), 0);

  const offline = locations.filter((l) => l.status === "offline" || l.status === "disconnected").length;
  const online = Math.max(0, locations.length - offline);

  return {
    stations: locations.length,
    platforms: new Set(locations.map((l) => l.source).filter(Boolean)).size,
    online,
    offline,
    capacity,
    current,
    daily,
    monthly,
    yearly,
    cumulative,
    lifetime: cumulative,
    totalIncome,
    monthlyIncome,
    yearlyIncome,
  };
}

/* ==================== SVG ICONS ==================== */

function SunFlowerIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function BuildingIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </svg>
  );
}

function RefreshIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
  );
}

function LogOutIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function CalendarIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function DownloadIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

function BellIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function SolarIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function SolarPlantIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3M8 15h8M9 19h6" />
    </svg>
  );
}

function TrendUpIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function CurrencyIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 6v12" />
    </svg>
  );
}

function FlashIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function LeafIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M11 20A7 7 0 0 1 4 13C4 7 11 3 20 3c0 9-4 17-9 17Z" />
      <path d="M4 21c2-5 7-10 16-11" />
    </svg>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
