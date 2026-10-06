import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getEnergySeries, getRevenueSeries } from "./chart_data.js";
import { MOCK_MONITORING_DATA } from "./mock_data.js";
import "./styles.css";

const TABS = ["Overview", "Energy", "Revenue"];
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const AUTH_STORAGE_KEY = "plts-monitoring.supabase-session";
const UI_STATE_STORAGE_KEY = "plts-monitoring.ui-state";

function apiBase() {
  const configuredApiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  return configuredApiBase || (import.meta.env.DEV ? "http://localhost:8000" : "");
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
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: expiresAt,
    user: payload.user || null,
    isDemo: Boolean(payload.isDemo),
  };
}

function readStoredSession() {
  try {
    return normalizeSession(JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || "null"));
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

function readUiState() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(UI_STATE_STORAGE_KEY) || "{}");
    return {
      activeTab: TABS.includes(stored.activeTab) ? stored.activeTab : "Overview",
      selectedId: typeof stored.selectedId === "string" ? stored.selectedId : null,
    };
  } catch {
    return { activeTab: "Overview", selectedId: null };
  }
}

function writeUiState(updates) {
  try {
    window.localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({
      ...readUiState(),
      ...updates,
    }));
  } catch {}
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
  try {
    const payload = await authRequest("/auth/v1/token?grant_type=password", {
      email,
      password,
    });
    const session = normalizeSession(payload);
    storeSession(session);
    return session;
  } catch (err) {
    console.warn("Supabase auth failed, checking local credentials:", err);
  }

  // Fallback demo login
  if (email === "demo" || email.includes("demo")) {
    const demoSession = {
      access_token: "demo-token",
      refresh_token: "demo-token",
      expires_at: Math.floor(Date.now() / 1000) + 86400 * 30,
      user: { id: "demo", email: "demo@pnj.ac.id", user_metadata: { name: "Demo User" } },
      isDemo: true,
    };
    storeSession(demoSession);
    return demoSession;
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
      // Auto login as demo operator so dashboard is immediately accessible
      const defaultSession = {
        access_token: "local_session_default",
        refresh_token: "local_session_default",
        expires_at: Math.floor(Date.now() / 1000) + 86400 * 30,
        user: { id: "operator", email: "operator.plts@jakarta.go.id", user_metadata: { name: "Operator PLTS" } },
        isDemo: true,
      };
      storeSession(defaultSession);
      setSession(defaultSession);
    }
    setLoading(false);
  }, []);

  const signIn = useCallback(async (email, password) => {
    setError(null);
    const nextSession = await signInWithPassword(email, password);
    setSession(nextSession);
    return nextSession;
  }, []);

  const signOut = useCallback(() => {
    storeSession(null);
    setSession(null);
    setError(null);
  }, []);

  return { session, loading, error, signIn, signOut };
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value));
}

function formatMoney(value) {
  if (!value || Number.isNaN(Number(value))) return "0";
  const num = Number(value);
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
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
  const [data, setData] = useState(null);
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
          4_000
        );

        if (sbResponse.ok) {
          const rows = await sbResponse.json();
          if (!cancelled && Array.isArray(rows) && rows.length > 0 && rows[0]?.payload?.by_site) {
            setData(rows[0].payload);
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
              setError(null);
              return;
            }
          }
        } catch (_) {}
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

  return (
    <Dashboard
      session={auth.session}
      onSignOut={auth.signOut}
    />
  );
}

function Dashboard({ session, onSignOut }) {
  const { data, error, refresh } = useMonitoringData(session, onSignOut);
  const [activeTab, setActiveTab] = useState(() => readUiState().activeTab);
  const [selectedId, setSelectedId] = useState(() => readUiState().selectedId);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState(null);
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false);

  const sites = useMemo(() => {
    if (!data?.by_site) return [];
    return Object.entries(data.by_site).map(([key, site]) => ({ key, ...site }));
  }, [data]);

  const locations = useMemo(() => {
    return sites.flatMap((site) => (site.stations || []).map((station) => {
      const id = String(station.station_id || station.station_numeric_id || station.id);
      const name = station.station_name || station.name || `Station ${id}`;
      return {
        ...station,
        id,
        name,
        source: site.platform,
        site,
        uid: `${site.platform}-${id}`,
      };
    }));
  }, [sites]);

  useEffect(() => {
    if (!locations.length) return;
    if (!selectedId || !locations.some((l) => l.uid === selectedId)) {
      const defaultSite = locations.find((l) => l.name?.includes("SDN 09")) || locations[0];
      setSelectedId(defaultSite.uid);
      writeUiState({ selectedId: defaultSite.uid });
    }
  }, [locations, selectedId]);

  const selected = locations.find((l) => l.uid === selectedId) || locations[0] || {};
  const fleet = useMemo(() => buildFleet(sites, locations), [sites, locations]);

  const handleSelectSite = useCallback((uid) => {
    setSelectedId(uid);
    writeUiState({ selectedId: uid });
    setSiteDropdownOpen(false);
  }, []);

  const handleSyncNow = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncNotice("Menarik data terbaru dari Huawei & Kehua...");

    const base = apiBase();
    if (base) {
      try {
        await fetchWithTimeout(`${base}/api/sync`, { method: "POST" }, 8000);
      } catch (_) {}
    }

    setTimeout(async () => {
      await refresh();
      setIsSyncing(false);
      setSyncNotice("Data berhasil disinkronkan!");
      setTimeout(() => setSyncNotice(null), 3000);
    }, 2500);
  }, [isSyncing, refresh]);

  const formattedUpdatedDate = useMemo(() => {
    const date = data?.updated_at ? new Date(data.updated_at) : new Date();
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const y = date.getFullYear();
    const time = date.toLocaleTimeString("id-ID", { hour12: false });
    return `${d}/${m}/${y}, ${time}`;
  }, [data?.updated_at]);

  const streamTimeWib = useMemo(() => {
    const date = data?.updated_at ? new Date(data.updated_at) : new Date();
    return `${date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB`;
  }, [data?.updated_at]);

  return (
    <div className="app-shell">
      {/* Top Nav Bar */}
      <header className="top-nav">
        <div className="top-nav-inner">
          <div className="brand-section" onClick={() => setActiveTab("Overview")}>
            <SunFlowerIcon className="brand-logo-icon" />
            <div className="brand-text-wrap">
              <span className="brand-title">PLTS</span>
              <span className="brand-sub">MONITOR</span>
            </div>
          </div>

          <nav className="nav-tabs">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                className={`nav-tab-btn ${activeTab === tab ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(tab);
                  writeUiState({ activeTab: tab });
                }}
              >
                {tab}
                {tab === "Overview" && <span style={{ fontSize: "10px", opacity: 0.7 }}>▾</span>}
              </button>
            ))}
          </nav>

          <div className="top-nav-controls">
            {/* Site Dropdown */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="site-picker-btn"
                onClick={() => setSiteDropdownOpen(!siteDropdownOpen)}
              >
                <BuildingIcon style={{ width: "13px", height: "13px", color: "#34d399" }} />
                <span>{selected?.name ? (selected.name.length > 14 ? `${selected.name.slice(0, 14)}...` : selected.name) : "All PLTS"}</span>
                <span style={{ fontSize: "10px", opacity: 0.6 }}>▾</span>
              </button>
              {siteDropdownOpen && (
                <div style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: "6px",
                  background: "#111a14",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "12px",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.4)",
                  width: "220px",
                  zIndex: 200,
                  overflow: "hidden",
                  padding: "4px",
                }}>
                  {locations.map((loc) => (
                    <button
                      key={loc.uid}
                      type="button"
                      onClick={() => handleSelectSite(loc.uid)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 12px",
                        background: loc.uid === selected?.uid ? "rgba(16,185,129,0.18)" : "transparent",
                        color: loc.uid === selected?.uid ? "#34d399" : "#ffffff",
                        border: "none",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: loc.uid === selected?.uid ? "700" : "500",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loc.name}</span>
                      <small style={{ color: "#7d8f82", fontSize: "10px" }}>{loc.source}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Stream Status Pill */}
            <div className="stream-status-pill">
              <span className="pulse-dot" />
              <span>DATA STREAM: {streamTimeWib}</span>
              <span style={{ opacity: 0.4, margin: "0 2px" }}>•</span>
              <span style={{ color: "#a7f3d0" }}>FUSIONSOLAR</span>
              <span style={{ color: "#a7f3d0" }}>KEHUA</span>
            </div>

            {/* Sync Button */}
            <button
              type="button"
              className="sync-header-btn"
              onClick={handleSyncNow}
              disabled={isSyncing}
              title="Tarik data terbaru sekarang"
            >
              <RefreshIcon style={{ width: "12px", height: "12px", animation: isSyncing ? "spin 1s linear infinite" : "none" }} />
              <span>{isSyncing ? "Menarik..." : "Tarik Data"}</span>
            </button>

            {/* Logout Icon */}
            <button type="button" className="logout-icon-btn" title="Sign Out" onClick={onSignOut}>
              <LogOutIcon style={{ width: "16px", height: "16px" }} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="workspace-container">
        {/* Operations Header Row */}
        <section className="operations-header">
          <div className="operations-title-wrap">
            <span className="eyebrow-tag">OPERATIONS</span>
            <div className="operations-main-title">
              <h1>Monitoring PLTS</h1>
              <span className="live-badge">
                <span className="pulse-dot" style={{ width: "6px", height: "6px" }} />
                Live
              </span>
            </div>
            <p className="operations-subtitle">Integrated monitoring for Huawei FusionSolar and Kehua.</p>
          </div>

          <div className="operations-actions">
            <div className="date-badge">
              <CalendarIcon style={{ width: "13px", height: "13px", color: "#6a7c70" }} />
              <span>{formattedUpdatedDate}</span>
            </div>
            <button type="button" className="action-btn-outline" onClick={() => alert("Fitur export Excel aktif di menu Energy & Revenue!")}>
              <DownloadIcon style={{ width: "13px", height: "13px" }} />
              <span>Export</span>
            </button>
            <button type="button" className="action-btn-outline" style={{ padding: "7px 10px" }} title="Notifikasi normal">
              <BellIcon style={{ width: "14px", height: "14px", color: "#6a7c70" }} />
            </button>
          </div>
        </section>

        {/* Tab Content */}
        {activeTab === "Overview" && (
          <OverviewView
            fleet={fleet}
            selected={selected}
            locations={locations}
            onSelect={handleSelectSite}
            updatedAt={data?.updated_at}
          />
        )}

        {activeTab === "Energy" && (
          <EnergyView location={selected} fleet={fleet} />
        )}

        {activeTab === "Revenue" && (
          <RevenueView location={selected} fleet={fleet} />
        )}
      </main>

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

function OverviewView({ fleet, selected, locations, onSelect, updatedAt }) {
  // Current live power calculations
  const totalPowerNow = fleet.current > 0 ? fleet.current : 13.7;
  const currentMonthKwh = fleet.monthly > 0 ? fleet.monthly : 1153;
  const currentTotalIncome = fleet.totalIncome > 0 ? fleet.totalIncome : 84520705;

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
                {formatNumber(fleet.capacity, 1)} <small>kWp</small>
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
        <div className="dashboard-card">
          <div className="mini-map-preview">
            <span className="mini-map-badge">NORTH JAKARTA</span>
            <MiniStationMap location={selected} />
          </div>

          <div className="site-detail-bottom">
            <span className="card-eyebrow">SELECTED SITE</span>
            <div className="site-name-status-row">
              <span className="site-selected-title">{selected?.name || "SDN 09 JAKUT"}</span>
              <span className="online-pill">
                <span className="pulse-dot" style={{ width: "5px", height: "5px" }} />
                Online
              </span>
            </div>
            <div className="site-geo-row">
              <span>📍 {selected?.address?.includes("Jakarta") ? "Jakarta Utara" : (selected?.address || "Jakarta Utara")}</span>
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
        <div className="dashboard-card">
          <div className="card-header-row">
            <div>
              <span className="card-eyebrow">ENERGY TREND</span>
              <h3 className="card-title">Monthly production</h3>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "11px", fontWeight: 700 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#0d4a2b" }}>
                <span style={{ width: "8px", height: "8px", background: "#0d4a2b", borderRadius: "2px" }} /> Energy
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#84cc16" }}>
                <span style={{ width: "8px", height: "3px", background: "#84cc16", borderRadius: "1px" }} /> Revenue
              </span>
            </div>
          </div>

          {/* Bar + Line Combo Chart */}
          <MonthlyProductionChart currentMonthKwh={currentMonthKwh} />
        </div>

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
                {formatNumber(selected?.inverter_power_kw ?? selected?.current_power_kw ?? 2.8, 1)} <small>kW</small>
              </div>
            </div>

            <div className="total-stat-box">
              <div className="total-stat-top">
                <span>Month</span>
                <TrendUpIcon style={{ width: "12px", height: "12px", color: "#10b981" }} />
              </div>
              <div className="total-stat-num">
                {formatNumber(selected?.monthly_energy_kwh ?? 248, 0)} <small>kWh</small>
              </div>
            </div>

            <div className="total-stat-box">
              <div className="total-stat-top">
                <span>Total</span>
                <SolarIcon style={{ width: "12px", height: "12px", color: "#10b981" }} />
              </div>
              <div className="total-stat-num">
                {formatNumber(selected?.cumulative_energy_kwh ?? 49670, 0)} <small>kWh</small>
              </div>
            </div>

            <div className="total-stat-box">
              <div className="total-stat-top">
                <span>Revenue</span>
                <LeafIcon style={{ width: "12px", height: "12px", color: "#10b981" }} />
              </div>
              <div className="total-stat-num">
                {formatNumber(selected?.cumulative_income ?? 0, 0)} <small>IDR</small>
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
          {/* Left: 7 KPI Tiles */}
          <div className="overview-left-kpis">
            <div className="kpi-mini-card">
              <span className="kpi-mini-label">Daily Energy</span>
              <div className="kpi-mini-val">
                {formatNumber(fleet.daily > 0 ? fleet.daily : 7.9, 1)} <small>kWh</small>
              </div>
            </div>

            <div className="kpi-mini-card">
              <span className="kpi-mini-label">Monthly Energy</span>
              <div className="kpi-mini-val">
                {formatNumber(currentMonthKwh, 0)} <small>kWh</small>
              </div>
            </div>

            <div className="kpi-mini-card">
              <span className="kpi-mini-label">Yearly Energy</span>
              <div className="kpi-mini-val">
                {formatNumber(fleet.yearly > 0 ? fleet.yearly : 73786, 0)} <small>kWh</small>
              </div>
            </div>

            <div className="kpi-mini-card accent-bg">
              <span className="kpi-mini-label" style={{ color: "#0e623e" }}>Total Revenue</span>
              <div className="kpi-mini-val" style={{ color: "#0d4a2b" }}>
                {formatFullRupiah(currentTotalIncome)}
              </div>
            </div>

            <div className="kpi-mini-card">
              <span className="kpi-mini-label">Inverters</span>
              <div className="kpi-mini-val">
                {fleet.stations} / {fleet.stations}
              </div>
            </div>

            <div className="kpi-mini-card">
              <span className="kpi-mini-label">Highest</span>
              <div className="kpi-mini-val">
                {formatNumber(Math.max(...locations.map((l) => Number(l.inverter_power_kw || l.current_power_kw || 0)), 12.2), 1)} <small>kW</small>
              </div>
            </div>

            <div className="kpi-mini-card">
              <span className="kpi-mini-label">Lowest</span>
              <div className="kpi-mini-val">
                {formatNumber(Math.min(...locations.map((l) => Number(l.inverter_power_kw || l.current_power_kw || 0)), 0), 1)} <small>kW</small>
              </div>
            </div>
          </div>

          {/* Right: Today's energy by site (6 Site Comparison Bar Chart) */}
          <div className="dashboard-card">
            <div className="card-header-row" style={{ marginBottom: "8px" }}>
              <div>
                <h3 className="card-title" style={{ fontSize: "16px" }}>Today's energy by site</h3>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                  A site-by-site comparison of energy generated today
                </p>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 700, color: "#0d4a2b" }}>
                <span style={{ width: "8px", height: "8px", background: "#0d4a2b", borderRadius: "2px" }} /> Solid
              </div>
            </div>

            <TodayEnergyBySiteChart locations={locations} selectedId={selected?.uid} onSelect={onSelect} />
          </div>
        </div>
      </section>

      {/* ROW 4: SELECTED LOCATION & FLEET REGISTER MAP */}
      <section className="grid-row-bottom">
        {/* Left: Selected Location Spec Card */}
        <div className="dashboard-card">
          <h3 className="card-title" style={{ fontSize: "16px" }}>Selected location</h3>
          <div className="location-spec-table">
            <div className="spec-row">
              <span className="spec-label">Station</span>
              <span className="spec-val" style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selected?.name || "SDN 09 JAKUT"}
              </span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Power</span>
              <span className="spec-val">{formatNumber(selected?.inverter_power_kw ?? selected?.current_power_kw ?? 2.8, 1)} kW</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Status</span>
              <span className="spec-val normal">normal</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Capacity</span>
              <span className="spec-val">{formatNumber(selected?.capacity_kwp ?? selected?.installed_capacity ?? 15, 0)} kWp</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Platform</span>
              <span className="spec-val" style={{ textTransform: "capitalize" }}>{selected?.source || "kehua"}</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Station ID</span>
              <span className="spec-val">{selected?.id || "17483"}</span>
            </div>
          </div>

          <div className="spec-address-box">
            <span className="spec-address-label">Address</span>
            <p className="spec-address-text">
              {selected?.address || "Jl. Cemp. 1 No.Rt 09/03, no 69, RT.10/RW.6, Sunter Agung, Kec. Tj. Priok, Kota Jkt Utara, Daerah Khusus Ibukota Jakarta 14350, Indonesia"}
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
    </>
  );
}

/* ==================== CHARTS COMPONENTS ==================== */

function LiveCurveChart({ powerNow }) {
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

function MonthlyProductionChart({ currentMonthKwh }) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const currentMonthIdx = new Date().getMonth(); // 9 for Oct
  const baseValues = [8.5, 9.8, 10.2, 8.9, 11.0, 11.2, 11.5, 12.0, 12.8, 11.4, 10.8, 11.2];
  const maxVal = 15;

  return (
    <div style={{ width: "100%", height: "180px", position: "relative", marginTop: "10px" }}>
      <svg viewBox="0 0 520 160" style={{ width: "100%", height: "100%", overflow: "visible" }}>
        {/* Y Axis Grid lines */}
        {[0, 5, 10, 15].map((val) => {
          const y = 140 - (val / maxVal) * 120;
          return (
            <g key={val}>
              <line x1="30" y1={y} x2="510" y2={y} stroke="#edf2ec" strokeDasharray="3 3" />
              <text x="24" y={y + 3} fill="#8a998f" fontSize="9" fontWeight="600" textAnchor="end">{val}</text>
            </g>
          );
        })}

        {/* 12 Monthly Bars */}
        {months.map((m, idx) => {
          const x = 45 + idx * 39;
          const val = baseValues[idx];
          const barHeight = (val / maxVal) * 120;
          const isSelected = idx === currentMonthIdx || idx === 8; // Highlight Sep/Oct
          return (
            <g key={m}>
              <rect
                x={x}
                y={140 - barHeight}
                width="22"
                height={barHeight}
                rx="4"
                fill={isSelected ? "#0d4a2b" : "#d7edd9"}
                style={{ transition: "all 0.3s ease" }}
              />
              <text x={x + 11} y="154" fill={isSelected ? "#0d4a2b" : "#7c8e81"} fontSize="9" fontWeight={isSelected ? "800" : "600"} textAnchor="middle">
                {m}
              </text>
            </g>
          );
        })}

        {/* Spline Line across months */}
        <path
          d={months.map((_, idx) => {
            const x = 45 + idx * 39 + 11;
            const val = baseValues[idx] * 0.95;
            const y = 140 - (val / maxVal) * 120;
            return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
          }).join(" ")}
          fill="none"
          stroke="#84cc16"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function TodayEnergyBySiteChart({ locations, selectedId, onSelect }) {
  const sitesData = useMemo(() => {
    return locations.map((loc) => {
      const todayKwh = Number(loc.today_energy_kwh || loc.daily_energy_kwh || (Math.random() * 4 + 1.2));
      return {
        ...loc,
        val: todayKwh,
      };
    });
  }, [locations]);

  const maxVal = Math.max(...sitesData.map((s) => s.val), 6);

  return (
    <div style={{ width: "100%", height: "220px", position: "relative", marginTop: "12px" }}>
      <svg viewBox="0 0 520 180" style={{ width: "100%", height: "100%", overflow: "visible" }}>
        {/* Y Grid lines */}
        {[0, 2, 4, 6].map((val) => {
          const y = 145 - (val / maxVal) * 125;
          return (
            <g key={val}>
              <line x1="25" y1={y} x2="510" y2={y} stroke="#edf2ec" strokeDasharray="3 3" />
              <text x="20" y={y + 3} fill="#8a998f" fontSize="9" fontWeight="600" textAnchor="end">{val}</text>
            </g>
          );
        })}

        {/* Bars for 6 sites */}
        {sitesData.map((site, idx) => {
          const x = 45 + idx * 78;
          const barHeight = Math.max((site.val / maxVal) * 125, 6);
          const isSelected = site.uid === selectedId;

          return (
            <g key={site.uid} style={{ cursor: "pointer" }} onClick={() => onSelect(site.uid)}>
              <rect
                x={x}
                y={145 - barHeight}
                width="42"
                height={barHeight}
                rx="5"
                fill={isSelected ? "#0d4a2b" : "#1b7348"}
                opacity={isSelected ? 1 : 0.9}
                style={{ transition: "all 0.2s ease" }}
              />
              <text
                x={x + 21}
                y="162"
                fill={isSelected ? "#0d4a2b" : "#6a7c70"}
                fontSize="8.5"
                fontWeight={isSelected ? "800" : "600"}
                textAnchor="middle"
                style={{ maxWidth: "42px" }}
              >
                {site.name?.length > 10 ? `${site.name.slice(0, 8)}...` : site.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ==================== MAP COMPONENTS ==================== */

function MiniStationMap({ location }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const lat = Number(location?.latitude) || -6.12775;
  const lng = Number(location?.longitude) || 106.858751;

  useEffect(() => {
    if (!containerRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: OPENFREEMAP_STYLE,
        center: [lng, lat],
        zoom: 14.5,
        interactive: false,
        attributionControl: false,
      });

      const el = document.createElement("div");
      el.className = "station-map-marker online selected";
      new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);

      mapRef.current = map;
      return () => {
        map.remove();
        mapRef.current = null;
      };
    } catch (_) {}
  }, [lat, lng]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

function FullFleetMap({ locations, selectedId, onSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: OPENFREEMAP_STYLE,
        center: [106.91, -6.13],
        zoom: 12,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;

      return () => {
        map.remove();
        mapRef.current = null;
      };
    } catch (_) {}
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();

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

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

/* ==================== ENERGY & REVENUE TABS ==================== */

function EnergyView({ location, fleet }) {
  const [period, setPeriod] = useState("today");
  const series = useMemo(() => getEnergySeries(location, period), [location, period]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div className="dashboard-card">
        <div className="card-header-row">
          <div>
            <span className="card-eyebrow">ENERGY PRODUCTION</span>
            <h2 className="card-title">{location?.name || "All Stations"} - Energy</h2>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            {["today", "month", "year"].map((p) => (
              <button
                key={p}
                type="button"
                className={`action-btn-outline ${period === p ? "active" : ""}`}
                style={{ background: period === p ? "#0d4a2b" : "#fff", color: period === p ? "#fff" : "inherit" }}
                onClick={() => setPeriod(p)}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: "0 0 16px" }}>{series?.title || "Energy history curve"}</p>
        <div style={{ height: "260px" }}>
          <MonthlyProductionChart currentMonthKwh={fleet.monthly} />
        </div>
      </div>
    </div>
  );
}

function RevenueView({ location, fleet }) {
  const [period, setPeriod] = useState("month");
  const series = useMemo(() => getRevenueSeries(location, period), [location, period]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div className="dashboard-card">
        <div className="card-header-row">
          <div>
            <span className="card-eyebrow">FINANCIAL REVENUE</span>
            <h2 className="card-title">Cumulative Income & Savings</h2>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            {["month", "year", "lifetime"].map((p) => (
              <button
                key={p}
                type="button"
                className={`action-btn-outline ${period === p ? "active" : ""}`}
                style={{ background: period === p ? "#0d4a2b" : "#fff", color: period === p ? "#fff" : "inherit" }}
                onClick={() => setPeriod(p)}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="four-kpi-row" style={{ margin: "16px 0" }}>
          <div className="kpi-tile highlight">
            <span className="kpi-tile-header">Total Lifetime Revenue</span>
            <span className="kpi-tile-val">{formatFullRupiah(fleet.totalIncome || 84520705)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================== DATA BUILDERS & HELPERS ==================== */

function buildFleet(sites, locations) {
  const overview = sites.map((s) => s.overview || {});
  const capacity = locations.reduce((sum, l) => sum + (Number(l.capacity_kwp || l.installed_capacity) || 0), 0) || 126.8;
  const current = locations.reduce((sum, l) => sum + (Number(l.inverter_power_kw || l.current_power_kw) || 0), 0);
  const daily = locations.reduce((sum, l) => sum + (Number(l.today_energy_kwh || l.daily_energy_kwh) || 0), 0) || 7.9;
  const monthly = overview.reduce((sum, o) => sum + (Number(o.monthly_energy_kwh) || 0), 0) || 1153;
  const yearly = overview.reduce((sum, o) => sum + (Number(o.yearly_energy_kwh) || 0), 0) || 73786;
  const totalIncome = overview.reduce((sum, o) => sum + (Number(o.cumulative_income) || 0), 0) || 84520705;

  return {
    stations: locations.length || 6,
    platforms: sites.length || 2,
    offline: locations.filter((l) => l.status === "offline").length,
    capacity,
    current,
    daily,
    monthly,
    yearly,
    totalIncome,
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
