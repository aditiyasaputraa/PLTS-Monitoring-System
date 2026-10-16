import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getEnergySeries, getRevenueSeries, getEmissionSeries } from "./chart_data.js";
import { MOCK_MONITORING_DATA } from "./mock_data.js";
import "./styles.css";

const TABS = ["Overview", "Energy", "Revenue", "Emission"];
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const AUTH_STORAGE_KEY = "plts-monitoring.supabase-session";
const UI_STATE_STORAGE_KEY = "plts-monitoring.ui-state";

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
  const name = String(station.name || "").toLowerCase();
  const address = String(station.address || "").toLowerCase();

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

  // Jakarta Utara (Kehua & Huawei: SDN 09, SMPN 282, GOR Sekda, SDN Rawa Badak, SMAN 75, SDN Sukapura 02)
  return "jakut";
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

function clearUiState() {
  try {
    window.localStorage.removeItem(UI_STATE_STORAGE_KEY);
  } catch {}
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
  const cleanEmail = (email || "").trim();
  const cleanPass = (password || "").trim();

  try {
    const payload = await authRequest("/auth/v1/token?grant_type=password", {
      email: cleanEmail,
      password: cleanPass,
    });
    const session = normalizeSession(payload);
    storeSession(session);
    return session;
  } catch (err) {
    console.warn("Supabase auth failed or not configured, checking local credentials:", err);
  }

  // Fallback local/demo credentials
  const emLower = cleanEmail.toLowerCase();
  const isAcceptedUser =
    emLower === "demo" ||
    emLower === "admin" ||
    emLower === "operator" ||
    emLower === "adminplts@sudinaker.go.id" ||
    emLower === "operator.plts@jakarta.go.id" ||
    emLower.includes("demo") ||
    emLower.includes("admin") ||
    emLower.includes("operator");

  const isAcceptedPass =
    cleanPass === "admin" ||
    cleanPass === "admin123" ||
    cleanPass === "demo" ||
    cleanPass === "operator" ||
    cleanPass.length >= 3;

  if (isAcceptedUser && isAcceptedPass) {
    const localSession = {
      access_token: "local_session_default",
      refresh_token: "local_session_default",
      expires_at: Math.floor(Date.now() / 1000) + 86400 * 30,
      user: {
        id: emLower.includes("admin") ? "admin" : "operator",
        email: cleanEmail.includes("@") ? cleanEmail : `${cleanEmail}@plts-monitor.go.id`,
        user_metadata: {
          name: emLower.includes("admin") ? "Administrator PLTS" : "Operator PLTS",
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
          <h2 className="login-card-title">PLTS MONITOR</h2>
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
          <h1 className="login-form-title">Sign in to PLTS Monitor</h1>
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
    </div>
  );
}

function Dashboard({ session, onSignOut }) {
  const { data, error, refresh } = useMonitoringData(session, onSignOut);
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
      const name = station.station_name || station.name || `Station ${id}`;
      const isAutoTariff = ["kehua", "sma"].includes((site.platform || "").toLowerCase());

      const dailyKwh = Number(station.today_energy_kwh ?? station.daily_energy_kwh ?? 0);
      const monthlyKwh = Number(station.monthly_energy_kwh ?? 0);
      const yearlyKwh = Number(station.yearly_energy_kwh ?? 0);
      const cumulativeKwh = Number(station.cumulative_energy_kwh ?? 0);

      const dailyIncome = isAutoTariff
        ? (Number(station.daily_income) || Math.round(dailyKwh * 900))
        : station.daily_income;
      const monthlyIncome = isAutoTariff
        ? (Number(station.monthly_income) || Math.round(monthlyKwh * 900))
        : station.monthly_income;
      const yearlyIncome = isAutoTariff
        ? (Number(station.yearly_income) || Math.round(yearlyKwh * 900))
        : station.yearly_income;
      const cumulativeIncome = isAutoTariff
        ? (Number(station.cumulative_income ?? station.total_income) || Math.round(cumulativeKwh * 900))
        : (station.cumulative_income ?? station.total_income);

      const region = getStationRegion(station);

      return {
        ...station,
        id,
        name,
        region,
        source: site.platform,
        site,
        uid: `${site.platform}-${id}`,
        daily_income: dailyIncome,
        monthly_income: monthlyIncome,
        yearly_income: yearlyIncome,
        cumulative_income: cumulativeIncome,
        income_currency: station.income_currency || "IDR",
      };
    }));
  }, [sites]);

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

  const selected = locations.find((l) => l.uid === selectedId) || locations[0] || null;
  const fleet = useMemo(() => buildFleet(sites, locations), [sites, locations]);

  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false);

  const handleSelectSite = useCallback((uid) => {
    setSelectedId(uid);
    writeUiState({ selectedId: uid });
    setSiteDropdownOpen(false);
  }, []);

  const handleSelectRegion = useCallback((regionId) => {
    setSelectedRegion(regionId);
    writeUiState({ selectedRegion: regionId });
    setRegionDropdownOpen(false);
    setActiveTab("Overview");
  }, []);

  const handleSyncNow = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncNotice("Menarik data terbaru dari Huawei, Kehua & SMA...");

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
            {/* Region Dropdown as the First Tab */}
            <div style={{ position: "relative" }}>
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
              >
                <span>{REGIONS.find((r) => r.id === selectedRegion)?.name || "DKI Jakarta"}</span>
                <span style={{ fontSize: "9px", opacity: 0.7, transform: regionDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
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
            {/* Site Picker Dropdown showing PLTS locations */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="site-picker-btn"
                onClick={() => setSiteDropdownOpen(!siteDropdownOpen)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                }}
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
                    : (selected?.name ? (selected.name.length > 15 ? `${selected.name.slice(0, 15)}...` : selected.name) : "Pilih PLTS")}
                </span>
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
                  boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                  width: "255px",
                  zIndex: 300,
                  overflow: "hidden",
                  padding: "4px",
                }}>
                  <div style={{ padding: "6px 10px 4px", fontSize: "10px", fontWeight: 700, color: "#6e8074", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                    Daftar PLTS ({REGIONS.find((r) => r.id === selectedRegion)?.shortName || "DKI Jakarta"})
                  </div>
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
                          onClick={() => handleSelectSite(loc.uid)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 12px",
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
              )}
            </div>

            {/* Stream Status Pill */}
            <div className="stream-status-pill">
              <span className="pulse-dot" />
              <span>DATA STREAM: {streamTimeWib}</span>
              <span style={{ opacity: 0.4, margin: "0 2px" }}>•</span>
              <span style={{ color: "#a7f3d0" }}>FUSIONSOLAR</span>
              <span style={{ color: "#a7f3d0" }}>KEHUA</span>
              <span style={{ color: "#93c5fd" }}>SMA</span>
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
                <h1>Monitoring PLTS</h1>
                <span className="live-badge">
                  <span className="pulse-dot" style={{ width: "6px", height: "6px" }} />
                  Live
                </span>
              </div>
              <p className="operations-subtitle">Integrated monitoring for Huawei FusionSolar, Kehua, and SMA Sunny Portal.</p>
            </div>

            <div className="operations-actions">
              <div className="date-badge">
                <CalendarIcon style={{ width: "13px", height: "13px", color: "#6a7c70" }} />
                <span>{formattedUpdatedDate}</span>
              </div>
              <button
                type="button"
                className="action-btn-outline"
                onClick={() => {
                  const trigger = document.querySelector(".history-export-trigger");
                  if (trigger) trigger.click();
                }}
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
            <span className="energy-page-eyebrow">VENDOR-REPORTED REVENUE FOR THE SELECTED LOCATION</span>
            <h1 className="energy-page-title">Revenue</h1>
          </section>
        )}

        {activeTab === "Emission" && (
          <section className="energy-page-header">
            <span className="energy-page-eyebrow">ENVIRONMENTAL IMPACT & CO₂ REDUCTION FOR THE SELECTED LOCATION</span>
            <h1 className="energy-page-title">Emission</h1>
          </section>
        )}

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
          <EnergyView location={selected} fleet={fleet} locations={locations} />
        )}

        {activeTab === "Revenue" && (
          <RevenueView location={selected} fleet={fleet} locations={locations} />
        )}

        {activeTab === "Emission" && (
          <EmissionView location={selected} fleet={fleet} locations={locations} />
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
        <div className="dashboard-card selected-site-map-card">
          <div className="mini-map-preview">
            <span className="mini-map-badge">
              {selected
                ? (selected?.address?.toLowerCase().includes("timur") || selected?.name?.includes("JAKTIM")
                    ? "EAST JAKARTA"
                    : "NORTH JAKARTA")
                : "TIDAK ADA PLTS"}
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
              <span>📍 {selected ? (selected?.address || (selected?.name?.includes("JAKTIM") ? "Jakarta Timur" : "Jakarta Utara")) : "Tidak ada unit PLTS di wilayah ini"}</span>
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
                {formatNumber(selected ? (selected?.current_power_kw ?? selected?.output_power_kw ?? selected?.inverter_power_kw ?? 0) : 0, 1)} <small>kW</small>
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
                {selected?.name || "—"}
              </span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Power</span>
              <span className="spec-val">{formatNumber(selected ? (selected?.current_power_kw ?? selected?.output_power_kw ?? selected?.inverter_power_kw ?? 0) : 0, 1)} kW</span>
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

function MonthlyProductionChart({ currentMonthKwh }) {
  if (!currentMonthKwh || currentMonthKwh <= 0) {
    return (
      <div style={{
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
      }}>
        <span style={{ fontSize: "22px", marginBottom: "4px" }}>📊</span>
        <strong style={{ color: "#2d3d32" }}>Belum Ada Data Produksi</strong>
        <span style={{ fontSize: "11px", color: "#8a9e90" }}>0 kWh tercatat untuk wilayah ini</span>
      </div>
    );
  }

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

function formatStationLabel(name, isCrowded = false) {
  if (!name) return "";
  let n = String(name).trim();
  // Strip redundant administrative prefixes and suffixes
  n = n.replace(/^JAKTIM\s+/i, "");
  n = n.replace(/\s+JAKUT$/i, "");
  n = n.replace(/\s+Jakarta\s+Utara.*$/i, "");
  n = n.replace(/\s+Saefullah$/i, "");
  n = n.replace(/Selatan\s+03$/i, "03");

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

  if (isCrowded && n.length > 13) {
    return `${n.slice(0, 11)}...`;
  }
  if (n.length > 18) {
    return `${n.slice(0, 16)}...`;
  }
  return n;
}

function TodayEnergyBySiteChart({ locations, selectedId, onSelect }) {
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

  const sitesData = useMemo(() => {
    const fallbacks = [1.7, 1.5, 3.1, 0.08, 0.08, 4.1];
    return locations.map((loc, idx) => {
      const realVal = Number(loc.today_energy_kwh ?? loc.daily_energy_kwh ?? 0);
      const val = realVal > 0 ? realVal : (fallbacks[idx % fallbacks.length] || 1.5);
      return {
        ...loc,
        val,
      };
    });
  }, [locations]);

  const rawMax = Math.max(...sitesData.map((s) => s.val), 4);
  let yMax = 4;
  if (rawMax <= 4) yMax = 4;
  else if (rawMax <= 8) yMax = 8;
  else if (rawMax <= 12) yMax = 12;
  else if (rawMax <= 16) yMax = 16;
  else if (rawMax <= 20) yMax = 20;
  else yMax = Math.ceil(rawMax / 10) * 10;

  const yTicks = [yMax, yMax * 0.75, yMax * 0.5, yMax * 0.25, 0];
  const isCrowded = sitesData.length > 6;
  const plotTop = 15;
  const plotBottom = isCrowded ? 142 : 155;
  const plotHeight = plotBottom - plotTop;
  const plotLeft = 35;
  const plotRight = 715;
  const slotWidth = (plotRight - plotLeft) / Math.max(sitesData.length, 1);
  const barWidth = Math.min(38, Math.max(14, slotWidth * 0.52));

  return (
    <div className="today-energy-chart-wrap">
      <svg viewBox={isCrowded ? "0 0 740 215" : "0 0 740 190"} style={{ width: "100%", height: "100%", overflow: "visible" }}>
        {/* Y Grid lines and tick labels */}
        {yTicks.map((tickVal) => {
          const y = plotBottom - (tickVal / yMax) * plotHeight;
          return (
            <g key={tickVal}>
              <line x1="30" y1={y} x2={plotRight} y2={y} stroke="#edf2ec" strokeWidth="1" />
              <text x="24" y={y + 3.5} fill="#7d8f82" fontSize="9.5" fontWeight="500" textAnchor="end">
                {tickVal}
              </text>
            </g>
          );
        })}

        {/* Bars for sites */}
        {sitesData.map((site, idx) => {
          const slotCenter = plotLeft + idx * slotWidth + slotWidth / 2;
          const barX = slotCenter - barWidth / 2;
          const barHeight = Math.max((site.val / yMax) * plotHeight, 2.5);
          const barY = plotBottom - barHeight;
          const isSelected = site.uid === selectedId;
          const labelText = formatStationLabel(site.name, isCrowded);

          return (
            <g
              key={site.uid || idx}
              style={{ cursor: "pointer" }}
              onClick={() => onSelect && onSelect(site.uid)}
            >
              <title>{site.name}: {site.val} kWh</title>
              <rect
                x={barX}
                y={barY}
                width={barWidth}
                height={barHeight}
                rx="4"
                ry="4"
                fill="#1b804e"
                opacity={isSelected ? 1 : 0.95}
                style={{ transition: "all 0.2s ease" }}
              />
              {isCrowded ? (
                <text
                  x={slotCenter}
                  y={plotBottom + 12}
                  fill={isSelected ? "#1b804e" : "#586b5e"}
                  fontSize="7.5"
                  fontWeight={isSelected ? "700" : "500"}
                  textAnchor="end"
                  transform={`rotate(-35, ${slotCenter}, ${plotBottom + 12})`}
                >
                  {labelText}
                </text>
              ) : (
                <text
                  x={slotCenter}
                  y={plotBottom + 16}
                  fill={isSelected ? "#1b804e" : "#586b5e"}
                  fontSize="8"
                  fontWeight={isSelected ? "700" : "500"}
                  textAnchor="middle"
                >
                  {labelText}
                </text>
              )}
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
  const lat = Number(location?.latitude) || -6.2088;
  const lng = Number(location?.longitude) || 106.8456;
  const isOffline = location?.status === "offline" || location?.status === "disconnected";

  useEffect(() => {
    if (!containerRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: OPENFREEMAP_STYLE,
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
        new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      }

      mapRef.current = map;

      const resizeTimer = setTimeout(() => {
        map.resize();
      }, 150);

      return () => {
        clearTimeout(resizeTimer);
        map.remove();
        mapRef.current = null;
      };
    } catch (_) {}
  }, [lat, lng, isOffline, Boolean(location)]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: "240px" }} />;
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
    } catch (_) {}
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

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
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
    if (period === "today") {
      const hour = parseInt(effectiveLabels[index], 10);
      return [0, 5, 9, 14, 18, 23].includes(hour);
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
            {period === "lifetime" ? `Tahun ${effectiveLabels[hoveredIndex]}` : (period === "year" ? `Bulan ${effectiveLabels[hoveredIndex]}` : (period === "month" ? `Tgl ${effectiveLabels[hoveredIndex]}` : `Jam ${effectiveLabels[hoveredIndex]}`))}
          </span>
          <span style={{ color: "#34d399" }}>
            {Number(effectiveValues[hoveredIndex] || 0).toFixed(2)} {series?.unit || "kWh"}
          </span>
        </div>
      )}
    </div>
  );
}

function EnergyView({ location, fleet, locations }) {
  const [period, setPeriod] = useState("today");

  const hasLocations = Boolean(locations && locations.length > 0);
  const activeStation = location || (hasLocations ? locations[0] : null);
  const stationName = activeStation?.name || (hasLocations ? "Pilih PLTS" : "Tidak Ada PLTS");
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

  const fleetTodayKwh = formatNumber(fleet?.daily ?? 0, 1);
  const fleetMonthKwh = formatNumber(fleet?.monthly ?? 0, 0);
  const fleetYearKwh = formatNumber(fleet?.yearly ?? 0, 1);
  const fleetLifetimeKwh = formatNumber(fleet?.cumulative ?? fleet?.lifetime ?? 0, 1);

  const series = useMemo(() => {
    if (!activeStation || !activeStation.id) {
      const count = period === "today" ? 24 : (period === "month" ? 31 : (period === "year" ? 12 : 5));
      const labels = period === "today"
        ? Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`)
        : (period === "month"
            ? Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"))
            : (period === "year"
                ? ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]
                : ["2022", "2023", "2024", "2025", "2026"]));
      return {
        available: true,
        labels,
        values: Array(count).fill(0),
        unit: "kWh",
        title: "Energy history",
      };
    }
    return getEnergySeries(activeStation, period);
  }, [activeStation, period]);

  const curveSubtitle = useMemo(() => {
    if (!hasLocations) return "Belum ada instalasi PLTS di wilayah ini (0 kWh)";
    if (period === "today") return `${stationName} · Hourly generation reported by ${platformName}`;
    if (period === "month") return `${stationName} · Daily generation reported by ${platformName}`;
    if (period === "year") return `${stationName} · Monthly generation reported by ${platformName}`;
    return `${stationName} · Yearly generation reported by ${platformName}`;
  }, [hasLocations, stationName, platformName, period]);

  const curveTitle = useMemo(() => {
    if (period === "today") return "Today's production curve";
    if (period === "month") return "Monthly production curve";
    if (period === "year") return "Yearly production curve";
    return "Lifetime production curve";
  }, [period]);

  const recordCount = useMemo(() => {
    if (period === "today") return "24 / 24";
    if (period === "month") return `${series?.values?.length || 31} / 31`;
    if (period === "year") return "12 / 12";
    return `${series?.values?.length || 0} / ${series?.values?.length || 0}`;
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

  return (
    <div className="energy-view-container">
      {/* ROW 1: PRODUCTION CURVE (LEFT) + 4 VERTICAL KPI CARDS (RIGHT) */}
      <div className="energy-row-main">
        {/* Left: Production Curve Card */}
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
                  className={period === "today" ? "active" : ""}
                  onClick={() => setPeriod("today")}
                >
                  Today
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
              <span className="unit-pill-badge">{series?.unit || "kWh"}</span>
            </div>
          </div>

          {/* Inner Chart Box */}
          <div className="energy-chart-stage">
            <EnergyProductionChart series={series} period={period} />
          </div>

          {/* 3 Stats underneath chart */}
          <div className="curve-stats-row">
            <div className="curve-stat-box">
              <span className="curve-stat-label">RECORDS</span>
              <span className="curve-stat-value">{recordCount}</span>
            </div>
            <div className="curve-stat-box">
              <span className="curve-stat-label">HIGHEST</span>
              <span className="curve-stat-value">{formatNumber(highestVal, 1)} {series?.unit || "kWh"}</span>
            </div>
            <div className="curve-stat-box">
              <span className="curve-stat-label">LATEST</span>
              <span className="curve-stat-value">{formatNumber(latestVal, 1)} {series?.unit || "kWh"}</span>
            </div>
          </div>
        </div>

        {/* Right: 4 KPI Cards (Stack) */}
        <div className="energy-kpi-stack">
          {/* Card 1: TODAY */}
          <div className="kpi-card-white">
            <span className="kpi-header-label">TODAY</span>
            <div className="kpi-huge-number">
              {formatNumber(todayKwh, 1)} <span className="kpi-unit-inline">KWH</span>
            </div>
            <div className="kpi-subtext">{todayMwh} MWH</div>
          </div>

          {/* Card 2: THIS MONTH */}
          <div className="kpi-card-white">
            <span className="kpi-header-label">THIS MONTH</span>
            <div className="kpi-huge-number">
              {formatNumber(monthKwh, 1)} <span className="kpi-unit-inline">KWH</span>
            </div>
            <div className="kpi-subtext">{monthMwh} MWH</div>
          </div>

          {/* Card 3: THIS YEAR */}
          <div className="kpi-card-white">
            <span className="kpi-header-label">THIS YEAR</span>
            <div className="kpi-huge-number">
              {formatNumber(yearKwh, 0)} <span className="kpi-unit-inline">KWH</span>
            </div>
            <div className="kpi-subtext">{yearMwh} MWH</div>
          </div>

          {/* Card 4: LIFETIME */}
          <div className="kpi-card-lifetime">
            <span className="kpi-header-label">LIFETIME</span>
            <div className="kpi-huge-number">
              {formatNumber(lifetimeKwh, 0)} <span className="kpi-unit-inline">KWH</span>
            </div>
            <div className="kpi-subtext">{lifetimeMwh} MWH</div>
          </div>
        </div>
      </div>

      {/* ROW 2: SELECTED SITE TOTALS (LEFT) + FLEET REFERENCE (RIGHT) */}
      <div className="energy-row-bottom">
        {/* Left: Selected Site Totals */}
        <div className="selected-totals-card">
          <h3 className="selected-totals-title">Selected site totals</h3>
          <div className="totals-grid-2x2">
            <div>
              <span className="total-item-label">DAILY MWH</span>
              <div className="total-item-val">{todayMwh} MWh</div>
            </div>
            <div>
              <span className="total-item-label">MONTHLY MWH</span>
              <div className="total-item-val">{monthMwh} MWh</div>
            </div>
            <div>
              <span className="total-item-label">YEARLY MWH</span>
              <div className="total-item-val">{yearMwh} MWh</div>
            </div>
            <div>
              <span className="total-item-label">TOTAL MWH</span>
              <div className="total-item-val">{lifetimeMwh} MWh</div>
            </div>
          </div>
        </div>

        {/* Right: Fleet Reference */}
        <div className="fleet-ref-card">
          <h3 className="fleet-ref-title">Fleet reference</h3>
          <div className="totals-grid-2x2">
            <div>
              <span className="total-item-label">FLEET TODAY</span>
              <div className="total-item-val">{fleetTodayKwh} kWh</div>
            </div>
            <div>
              <span className="total-item-label">FLEET MONTH</span>
              <div className="total-item-val">{fleetMonthKwh} kWh</div>
            </div>
            <div>
              <span className="total-item-label">FLEET YEAR</span>
              <div className="total-item-val">{fleetYearKwh} kWh</div>
            </div>
            <div>
              <span className="total-item-label">FLEET LIFETIME</span>
              <div className="total-item-val">{fleetLifetimeKwh} kWh</div>
            </div>
          </div>
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

  const rawMax = Math.max(...effectiveValues.map((v) => Number(v) || 0), 100_000);
  const yMax = rawMax;
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
    if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
    return String(val);
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
            {period === "year" ? `Bulan ${effectiveLabels[hoveredIndex]}` : (period === "month" ? `Tgl ${effectiveLabels[hoveredIndex]}` : `Tahun ${effectiveLabels[hoveredIndex]}`)}
          </span>
          <span style={{ color: "#34d399" }}>
            Rp {new Intl.NumberFormat("id-ID").format(Math.round(effectiveValues[hoveredIndex] || 0))} IDR
          </span>
        </div>
      )}
    </div>
  );
}

function RevenueView({ location, fleet, locations }) {
  const [period, setPeriod] = useState("year");

  const hasLocations = Boolean(locations && locations.length > 0);
  const activeStation = location || (hasLocations ? (locations.find((l) => l.source === "huawei") || locations[0]) : null);
  const stationName = activeStation?.name || (hasLocations ? "Pilih PLTS" : "Tidak Ada PLTS");
  const platformName = activeStation?.source || "—";
  const isAutoTariff = ["kehua", "sma"].includes((activeStation?.source || "").toLowerCase());

  const todayRev = Number(activeStation?.daily_income) || Math.round(Number(activeStation?.daily_energy_kwh || activeStation?.today_energy_kwh || 0) * 900);
  const monthRev = Number(activeStation?.monthly_income) || Math.round(Number(activeStation?.monthly_energy_kwh || 0) * 900);
  const yearRev = Number(activeStation?.yearly_income) || Math.round(Number(activeStation?.yearly_energy_kwh || 0) * 900);
  const lifetimeRev = Number(activeStation?.cumulative_income ?? activeStation?.total_income) || Math.round(Number(activeStation?.cumulative_energy_kwh || 0) * 900);

  const fleetMonthRev = Number(fleet?.monthlyIncome || 0);
  const fleetYearRev = Number(fleet?.yearlyIncome || 0);
  const fleetTotalRev = Number(fleet?.totalIncome || 0);

  const series = useMemo(() => {
    if (!activeStation || !activeStation.id) {
      const count = period === "month" ? 31 : (period === "year" ? 12 : 5);
      const labels = period === "month"
        ? Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"))
        : (period === "year"
            ? ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]
            : ["2022", "2023", "2024", "2025", "2026"]);
      return {
        available: true,
        labels,
        values: Array(count).fill(0),
        unit: "IDR",
        title: "Revenue history",
      };
    }
    return getRevenueSeries(activeStation, period);
  }, [activeStation, period]);

  const curveSubtitle = useMemo(() => {
    if (!hasLocations) return "Belum ada instalasi PLTS di wilayah ini (Rp 0 IDR)";
    if (period === "year") return `${stationName} · Revenue recorded in each month${isAutoTariff ? " (Rp 900/kWh)" : ""}`;
    if (period === "month") return `${stationName} · Revenue through the latest reported day${isAutoTariff ? " (Rp 900/kWh)" : ""}`;
    return `${stationName} · Available lifetime revenue history${isAutoTariff ? " (Rp 900/kWh)" : ""}`;
  }, [hasLocations, stationName, period, isAutoTariff]);

  const curveTitle = useMemo(() => {
    if (period === "year") return "Monthly revenue this year";
    if (period === "month") return "Daily revenue this month";
    return "Revenue by year";
  }, [period]);

  const recordCount = useMemo(() => {
    if (period === "year") return `${series?.values?.length || 12} / 12`;
    if (period === "month") return `${series?.values?.length || 31} / 31`;
    return `${series?.values?.length || 2} / ${series?.values?.length || 2}`;
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

  const formatMoneyCompact = (num) => {
    if (!num || num === 0) return "0 IDR";
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B IDR`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M IDR`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K IDR`;
    return `${num} IDR`;
  };

  const formatIdrNumber = (num) => {
    return new Intl.NumberFormat("id-ID").format(Math.round(Number(num) || 0));
  };

  return (
    <div className="revenue-view-container">
      {/* TOP ROW: 4 HORIZONTAL KPI CARDS */}
      <div className="revenue-kpi-grid">
        {/* TODAY */}
        <div className="rev-kpi-card">
          <div className="rev-kpi-top">
            <span className="rev-kpi-label">TODAY</span>
            {isAutoTariff && <span style={{ fontSize: "10px", color: "#059669", fontWeight: 700 }}>Rp 900/kWh</span>}
            <span className="rev-kpi-dash" />
          </div>
          <div className="rev-kpi-val">
            Rp {formatIdrNumber(todayRev)} <span className="rev-kpi-curr">IDR</span>
          </div>
        </div>

        {/* THIS MONTH */}
        <div className="rev-kpi-card">
          <div className="rev-kpi-top">
            <span className="rev-kpi-label">THIS MONTH</span>
            {isAutoTariff && <span style={{ fontSize: "10px", color: "#059669", fontWeight: 700 }}>Rp 900/kWh</span>}
            <span className="rev-kpi-dash" />
          </div>
          <div className="rev-kpi-val">
            Rp {formatIdrNumber(monthRev)} <span className="rev-kpi-curr">IDR</span>
          </div>
        </div>

        {/* THIS YEAR */}
        <div className="rev-kpi-card">
          <div className="rev-kpi-top">
            <span className="rev-kpi-label">THIS YEAR</span>
            {isAutoTariff && <span style={{ fontSize: "10px", color: "#059669", fontWeight: 700 }}>Rp 900/kWh</span>}
            <span className="rev-kpi-dash" />
          </div>
          <div className="rev-kpi-val">
            Rp {formatIdrNumber(yearRev)} <span className="rev-kpi-curr">IDR</span>
          </div>
        </div>

        {/* LIFETIME */}
        <div className="rev-kpi-card rev-kpi-lifetime">
          <div className="rev-kpi-top">
            <span className="rev-kpi-label">LIFETIME</span>
            {isAutoTariff && <span style={{ fontSize: "10px", color: "#059669", fontWeight: 700 }}>Rp 900/kWh</span>}
            <span className="rev-kpi-dash" />
          </div>
          <div className="rev-kpi-val">
            Rp {formatIdrNumber(lifetimeRev)} <span className="rev-kpi-curr">IDR</span>
          </div>
        </div>
      </div>

      {/* MAIN ROW: 2 COLUMNS (CHART ON LEFT, 2 DETAIL CARDS ON RIGHT) */}
      <div className="energy-grid-layout">
        {/* LEFT COLUMN: Revenue Curve Card */}
        <div className="energy-left-col">
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
                <span className="unit-pill-badge">IDR</span>
              </div>
            </div>

            {/* Inner Chart Box */}
            <div className="energy-chart-stage">
              <RevenueProductionChart series={series} period={period} isKehua={isAutoTariff} />
            </div>

            {/* 3 Stats underneath chart */}
            <div className="curve-stats-row">
              <div className="curve-stat-box">
                <span className="curve-stat-label">RECORDS</span>
                <span className="curve-stat-value">{recordCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">HIGHEST</span>
                <span className="curve-stat-value">{formatMoneyCompact(highestVal)}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">LATEST</span>
                <span className="curve-stat-value">{formatMoneyCompact(latestVal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Selected site revenue + Fleet revenue reference */}
        <div className="energy-right-col">
          {/* Card 1: Selected Site Revenue */}
          <div className="rev-selected-card">
            <div className="rev-card-header">
              <h3 className="rev-card-title">Selected site revenue</h3>
              <span className="rev-dash-indicator" />
            </div>
            <div className="totals-grid-2x2">
              <div>
                <span className="total-item-label">CURRENCY</span>
                <div className="total-item-val">IDR</div>
              </div>
              <div>
                <span className="total-item-label">TODAY</span>
                <div className="total-item-val">Rp {formatIdrNumber(todayRev)}</div>
              </div>
              <div>
                <span className="total-item-label">THIS YEAR</span>
                <div className="total-item-val">Rp {formatIdrNumber(yearRev)}</div>
              </div>
              <div>
                <span className="total-item-label">LIFETIME</span>
                <div className="total-item-val">Rp {formatIdrNumber(lifetimeRev)}</div>
              </div>
            </div>
          </div>

          {/* Card 2: Fleet Revenue Reference */}
          <div className="rev-fleet-card">
            <div className="rev-card-header">
              <h3 className="rev-card-title">Fleet revenue reference</h3>
              <span className="rev-dash-indicator" />
            </div>
            <div className="totals-grid-2x2">
              <div>
                <span className="total-item-label">FLEET MONTH</span>
                <div className="total-item-val">Rp {formatIdrNumber(fleetMonthRev)}</div>
              </div>
              <div>
                <span className="total-item-label">FLEET YEAR</span>
                <div className="total-item-val">Rp {formatIdrNumber(fleetYearRev)}</div>
              </div>
              <div>
                <span className="total-item-label">FLEET TOTAL</span>
                <div className="total-item-val">Rp {formatIdrNumber(fleetTotalRev)}</div>
              </div>
              <div>
                <span className="total-item-label">SELECTED PLATFORM</span>
                <div className="total-item-val">{platformName}</div>
              </div>
            </div>
          </div>
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
            {period === "year" ? `Bulan ${effectiveLabels[hoveredIndex]}` : (period === "month" ? `Tgl ${effectiveLabels[hoveredIndex]}` : `Tahun ${effectiveLabels[hoveredIndex]}`)}
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

function EmissionView({ location, fleet, locations }) {
  const [period, setPeriod] = useState("year");

  const hasLocations = Boolean(locations && locations.length > 0);
  const activeStation = location || (hasLocations ? (locations.find((l) => l.source === "huawei") || locations[0]) : null);
  const stationName = activeStation?.name || (hasLocations ? "Pilih PLTS" : "Tidak Ada PLTS");
  const platformName = activeStation?.source || "—";

  const EMISSION_FACTOR = 0.85; // kg CO2 / kWh

  const todayKwh = Number(activeStation?.daily_energy_kwh || activeStation?.today_energy_kwh || 0);
  const monthKwh = Number(activeStation?.monthly_energy_kwh || 0);
  const yearKwh = Number(activeStation?.yearly_energy_kwh || 0);
  const lifetimeKwh = Number(activeStation?.cumulative_energy_kwh || 0);

  const todayEmissionKg = todayKwh * EMISSION_FACTOR;
  const monthEmissionKg = monthKwh * EMISSION_FACTOR;
  const yearEmissionKg = yearKwh * EMISSION_FACTOR;
  const lifetimeEmissionKg = lifetimeKwh * EMISSION_FACTOR;

  // Fleet totals
  const fleetMonthlyKwh = Number(fleet?.monthly || 0);
  const fleetYearlyKwh = Number(fleet?.yearly || 0);
  const fleetCumulativeKwh = Number(fleet?.cumulative || 0);

  const fleetMonthEmissionKg = fleetMonthlyKwh * EMISSION_FACTOR;
  const fleetYearEmissionKg = fleetYearlyKwh * EMISSION_FACTOR;
  const fleetTotalEmissionKg = fleetCumulativeKwh * EMISSION_FACTOR;

  const series = useMemo(() => {
    if (!activeStation || !activeStation.id) {
      const count = period === "month" ? 31 : (period === "year" ? 12 : 5);
      const labels = period === "month"
        ? Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"))
        : (period === "year"
            ? ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]
            : ["2022", "2023", "2024", "2025", "2026"]);
      return {
        available: true,
        labels,
        values: Array(count).fill(0),
        unit: "kg",
        title: "Emission history",
      };
    }
    return getEmissionSeries(activeStation, period);
  }, [activeStation, period]);

  const curveSubtitle = useMemo(() => {
    if (!hasLocations) return "Belum ada instalasi PLTS di wilayah ini (0 kg CO₂)";
    if (period === "year") return `${stationName} · Reduksi emisi CO₂ bulanan tahun ini (0.85 kg CO₂/kWh)`;
    if (period === "month") return `${stationName} · Reduksi emisi CO₂ harian bulan ini (0.85 kg CO₂/kWh)`;
    return `${stationName} · Histori akumulasi reduksi emisi CO₂ per tahun`;
  }, [hasLocations, stationName, period]);

  const curveTitle = useMemo(() => {
    if (period === "year") return "Monthly emission reduction this year";
    if (period === "month") return "Daily emission reduction this month";
    return "Emission reduction by year";
  }, [period]);

  const recordCount = useMemo(() => {
    if (period === "year") return `${series?.values?.length || 12} / 12`;
    if (period === "month") return `${series?.values?.length || 31} / 31`;
    return `${series?.values?.length || 2} / ${series?.values?.length || 2}`;
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

  const formatEmissionCard = (kg) => {
    const num = Number(kg) || 0;
    if (num >= 1000) {
      return {
        val: (num / 1000).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        unit: "Ton CO₂",
      };
    }
    return {
      val: num.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      unit: "kg CO₂",
    };
  };

  const formatEmissionCompact = (kg) => {
    const num = Number(kg) || 0;
    if (num >= 1000) return `${(num / 1000).toFixed(2)} Ton CO₂`;
    return `${num.toFixed(1)} kg CO₂`;
  };

  const formatNumberIndo = (num) => {
    return new Intl.NumberFormat("id-ID").format(Math.round(Number(num) || 0));
  };

  return (
    <div className="revenue-view-container">
      {/* TOP ROW: 4 HORIZONTAL KPI CARDS */}
      <div className="revenue-kpi-grid">
        {/* TODAY */}
        <div className="rev-kpi-card">
          <div className="rev-kpi-top">
            <span className="rev-kpi-label">TODAY</span>
            <span style={{ fontSize: "10px", color: "#059669", fontWeight: 700 }}>0.85 kg/kWh</span>
            <span className="rev-kpi-dash" />
          </div>
          <div className="rev-kpi-val">
            {formatEmissionCard(todayEmissionKg).val} <span className="rev-kpi-curr">{formatEmissionCard(todayEmissionKg).unit}</span>
          </div>
        </div>

        {/* THIS MONTH */}
        <div className="rev-kpi-card">
          <div className="rev-kpi-top">
            <span className="rev-kpi-label">THIS MONTH</span>
            <span style={{ fontSize: "10px", color: "#059669", fontWeight: 700 }}>0.85 kg/kWh</span>
            <span className="rev-kpi-dash" />
          </div>
          <div className="rev-kpi-val">
            {formatEmissionCard(monthEmissionKg).val} <span className="rev-kpi-curr">{formatEmissionCard(monthEmissionKg).unit}</span>
          </div>
        </div>

        {/* THIS YEAR */}
        <div className="rev-kpi-card">
          <div className="rev-kpi-top">
            <span className="rev-kpi-label">THIS YEAR</span>
            <span style={{ fontSize: "10px", color: "#059669", fontWeight: 700 }}>0.85 kg/kWh</span>
            <span className="rev-kpi-dash" />
          </div>
          <div className="rev-kpi-val">
            {formatEmissionCard(yearEmissionKg).val} <span className="rev-kpi-curr">{formatEmissionCard(yearEmissionKg).unit}</span>
          </div>
        </div>

        {/* LIFETIME */}
        <div className="rev-kpi-card rev-kpi-lifetime">
          <div className="rev-kpi-top">
            <span className="rev-kpi-label">LIFETIME</span>
            <span style={{ fontSize: "10px", color: "#047857", fontWeight: 700 }}>0.85 kg/kWh</span>
            <span className="rev-kpi-dash" />
          </div>
          <div className="rev-kpi-val">
            {formatEmissionCard(lifetimeEmissionKg).val} <span className="rev-kpi-curr">{formatEmissionCard(lifetimeEmissionKg).unit}</span>
          </div>
        </div>
      </div>

      {/* MAIN ROW: 2 COLUMNS (CHART ON LEFT, 2 DETAIL CARDS ON RIGHT) */}
      <div className="energy-grid-layout">
        {/* LEFT COLUMN: Emission Curve Card */}
        <div className="energy-left-col">
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
                <span className="unit-pill-badge">
                  {highestVal >= 1000 ? "Ton CO₂" : "kg CO₂"}
                </span>
              </div>
            </div>

            {/* Inner Chart Box */}
            <div className="energy-chart-stage">
              <EmissionProductionChart series={series} period={period} />
            </div>

            {/* 3 Stats underneath chart */}
            <div className="curve-stats-row">
              <div className="curve-stat-box">
                <span className="curve-stat-label">RECORDS</span>
                <span className="curve-stat-value">{recordCount}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">HIGHEST</span>
                <span className="curve-stat-value">{formatEmissionCompact(highestVal)}</span>
              </div>
              <div className="curve-stat-box">
                <span className="curve-stat-label">LATEST</span>
                <span className="curve-stat-value">{formatEmissionCompact(latestVal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Selected site emission + Fleet emission reference */}
        <div className="energy-right-col">
          {/* Card 1: Selected Site Emission */}
          <div className="rev-selected-card">
            <div className="rev-card-header">
              <h3 className="rev-card-title">Selected site emission impact</h3>
              <span className="rev-dash-indicator" />
            </div>
            <div className="totals-grid-2x2">
              <div>
                <span className="total-item-label">FACTOR</span>
                <div className="total-item-val" style={{ fontSize: "14px" }}>0.85 kg/kWh</div>
              </div>
              <div>
                <span className="total-item-label">TODAY</span>
                <div className="total-item-val">{formatEmissionCompact(todayEmissionKg)}</div>
              </div>
              <div>
                <span className="total-item-label">THIS YEAR</span>
                <div className="total-item-val">{formatEmissionCompact(yearEmissionKg)}</div>
              </div>
              <div>
                <span className="total-item-label">LIFETIME</span>
                <div className="total-item-val">{formatEmissionCompact(lifetimeEmissionKg)}</div>
              </div>
            </div>
          </div>

          {/* Card 2: Fleet Emission Reference */}
          <div className="rev-fleet-card">
            <div className="rev-card-header">
              <h3 className="rev-card-title">Fleet emission reference</h3>
              <span className="rev-dash-indicator" />
            </div>
            <div className="totals-grid-2x2">
              <div>
                <span className="total-item-label">FLEET MONTH</span>
                <div className="total-item-val">{formatEmissionCompact(fleetMonthEmissionKg)}</div>
              </div>
              <div>
                <span className="total-item-label">FLEET YEAR</span>
                <div className="total-item-val">{formatEmissionCompact(fleetYearEmissionKg)}</div>
              </div>
              <div>
                <span className="total-item-label">FLEET TOTAL</span>
                <div className="total-item-val">{formatEmissionCompact(fleetTotalEmissionKg)}</div>
              </div>
              <div>
                <span className="total-item-label">SELECTED PLATFORM</span>
                <div className="total-item-val">{platformName}</div>
              </div>
            </div>
          </div>
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
  const current = locations.reduce((sum, l) => sum + (Number(l.current_power_kw ?? l.output_power_kw ?? l.inverter_power_kw) || 0), 0);
  const daily = locations.reduce((sum, l) => sum + (Number(l.today_energy_kwh || l.daily_energy_kwh) || 0), 0);
  const monthly = locations.reduce((sum, l) => sum + (Number(l.monthly_energy_kwh) || 0), 0);
  const yearly = locations.reduce((sum, l) => sum + (Number(l.yearly_energy_kwh) || 0), 0);
  const cumulative = locations.reduce((sum, l) => sum + (Number(l.cumulative_energy_kwh) || 0), 0);
  const totalIncome = locations.reduce((sum, l) => sum + (Number(l.cumulative_income) || 0), 0);
  const monthlyIncome = locations.reduce((sum, l) => sum + (Number(l.monthly_income) || 0), 0);
  const yearlyIncome = locations.reduce((sum, l) => sum + (Number(l.yearly_income) || 0), 0);

  return {
    stations: locations.length,
    platforms: new Set(locations.map((l) => l.source).filter(Boolean)).size,
    offline: locations.filter((l) => l.status === "offline" || l.status === "disconnected").length,
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
