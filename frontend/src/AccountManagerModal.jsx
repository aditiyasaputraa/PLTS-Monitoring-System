import React, { useState, useEffect, useCallback, useMemo } from "react";

export const ACCOUNT_MANAGER_STORAGE_KEY = "plts_account_manager_v1";
export const CLOUD_ACCOUNT_MANAGER_KEY = "__plts_account_manager__";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "https://ioxfjbwlhsbfxmgrgwhh.supabase.co").replace(/\/$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_RAYfBkC2nAU4IQXt4cyF8Q_TpYIv-B_";

const DEFAULT_CONFIG = {
  added_accounts: [],
  disabled_accounts: [],
  disabled_stations: [],
};

export function readAccountManagerConfig() {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_CONFIG;
  }
  try {
    const raw = localStorage.getItem(ACCOUNT_MANAGER_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        added_accounts: Array.isArray(parsed.added_accounts) ? parsed.added_accounts : [],
        disabled_accounts: Array.isArray(parsed.disabled_accounts) ? parsed.disabled_accounts : [],
        disabled_stations: Array.isArray(parsed.disabled_stations) ? parsed.disabled_stations : [],
      };
    }
  } catch (_) {}
  return DEFAULT_CONFIG;
}

export function useAccountManager() {
  const [config, setConfig] = useState(() => readAccountManagerConfig());
  const [loadingCloud, setLoadingCloud] = useState(false);

  const fetchCloudConfig = useCallback(async () => {
    try {
      if (!SUPABASE_URL || !SUPABASE_KEY) return;
      setLoadingCloud(true);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/station_metadata?station_key=eq.${CLOUD_ACCOUNT_MANAGER_KEY}&select=notes,updated_at&limit=1`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Accept: "application/json",
          },
        }
      );
      if (!res.ok) return;
      const rows = await res.json();
      if (Array.isArray(rows) && rows[0]?.notes) {
        const parsed = JSON.parse(rows[0].notes);
        if (parsed && typeof parsed === "object") {
          const merged = {
            added_accounts: Array.isArray(parsed.added_accounts) ? parsed.added_accounts : [],
            disabled_accounts: Array.isArray(parsed.disabled_accounts) ? parsed.disabled_accounts : [],
            disabled_stations: Array.isArray(parsed.disabled_stations) ? parsed.disabled_stations : [],
          };
          try {
            localStorage.setItem(ACCOUNT_MANAGER_STORAGE_KEY, JSON.stringify(merged));
          } catch (_) {}
          setConfig(merged);
        }
      }
    } catch (_) {
    } finally {
      setLoadingCloud(false);
    }
  }, []);

  useEffect(() => {
    fetchCloudConfig();
  }, [fetchCloudConfig]);

  const saveConfig = useCallback(async (newConfig) => {
    const sanitized = {
      added_accounts: Array.isArray(newConfig?.added_accounts) ? newConfig.added_accounts : [],
      disabled_accounts: Array.isArray(newConfig?.disabled_accounts) ? newConfig.disabled_accounts : [],
      disabled_stations: Array.isArray(newConfig?.disabled_stations) ? newConfig.disabled_stations : [],
    };
    try {
      localStorage.setItem(ACCOUNT_MANAGER_STORAGE_KEY, JSON.stringify(sanitized));
    } catch (_) {}
    setConfig(sanitized);

    try {
      if (SUPABASE_URL && SUPABASE_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/station_metadata`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify({
            station_key: CLOUD_ACCOUNT_MANAGER_KEY,
            station_id: CLOUD_ACCOUNT_MANAGER_KEY,
            platform: "system",
            custom_name: "PLTS Account & Station Manager",
            notes: JSON.stringify(sanitized),
            updated_at: new Date().toISOString(),
          }),
        });
      }
    } catch (_) {}
  }, []);

  const addVendorAccount = useCallback(
    async ({ vendor, username, password, region, label }) => {
      const cleanVendor = String(vendor || "huawei").trim().toLowerCase();
      const cleanUsername = String(username || "").trim();
      const cleanPassword = String(password || "").trim();
      if (!cleanUsername || !cleanPassword) {
        throw new Error("Username dan Password akun vendor wajib diisi.");
      }

      const existingIdx = config.added_accounts.findIndex(
        (acc) =>
          String(acc.vendor).toLowerCase() === cleanVendor &&
          String(acc.username).toLowerCase() === cleanUsername.toLowerCase()
      );

      const newAcc = {
        id: `${cleanVendor}_${cleanUsername.toLowerCase()}_${Date.now()}`,
        vendor: cleanVendor,
        username: cleanUsername,
        password: cleanPassword,
        region: region && region !== "auto" ? region : "",
        label: String(label || "").trim() || `${cleanVendor.toUpperCase()} - ${cleanUsername}`,
        enabled: true,
        created_at: new Date().toISOString(),
      };

      const nextAccounts = [...config.added_accounts];
      if (existingIdx >= 0) {
        nextAccounts[existingIdx] = { ...nextAccounts[existingIdx], ...newAcc };
      } else {
        nextAccounts.push(newAcc);
      }

      const nextDisabledAccs = config.disabled_accounts.filter(
        (u) => u.toLowerCase() !== cleanUsername.toLowerCase() && u.toLowerCase() !== `${cleanVendor}:${cleanUsername.toLowerCase()}`
      );

      await saveConfig({
        ...config,
        added_accounts: nextAccounts,
        disabled_accounts: nextDisabledAccs,
      });
    },
    [config, saveConfig]
  );

  const removeVendorAccount = useCallback(
    async (accountId, username, vendor) => {
      const nextAccounts = config.added_accounts.filter((acc) => acc.id !== accountId);
      const cleanUname = String(username || "").trim().toLowerCase();
      const nextDisabled = [...config.disabled_accounts];
      if (cleanUname && !nextDisabled.includes(cleanUname)) {
        nextDisabled.push(cleanUname);
      }
      if (vendor && cleanUname && !nextDisabled.includes(`${vendor.toLowerCase()}:${cleanUname}`)) {
        nextDisabled.push(`${vendor.toLowerCase()}:${cleanUname}`);
      }
      await saveConfig({
        ...config,
        added_accounts: nextAccounts,
        disabled_accounts: nextDisabled,
      });
    },
    [config, saveConfig]
  );

  const blockEnvVendorAccount = useCallback(
    async (username) => {
      const clean = String(username || "").trim().toLowerCase();
      if (!clean) return;
      if (config.disabled_accounts.includes(clean)) return;
      await saveConfig({
        ...config,
        disabled_accounts: [...config.disabled_accounts, clean],
      });
    },
    [config, saveConfig]
  );

  const unblockEnvVendorAccount = useCallback(
    async (username) => {
      const clean = String(username || "").trim().toLowerCase();
      await saveConfig({
        ...config,
        disabled_accounts: config.disabled_accounts.filter((u) => u.toLowerCase() !== clean),
      });
    },
    [config, saveConfig]
  );

  const toggleStationHidden = useCallback(
    async (stationIdentifier) => {
      const idStr = String(stationIdentifier || "").trim();
      if (!idStr) return;
      const isCurrentlyHidden = config.disabled_stations.includes(idStr);
      const nextDisabledStations = isCurrentlyHidden
        ? config.disabled_stations.filter((x) => x !== idStr)
        : [...config.disabled_stations, idStr];

      await saveConfig({
        ...config,
        disabled_stations: nextDisabledStations,
      });
    },
    [config, saveConfig]
  );

  return {
    accountManagerConfig: config,
    loadingCloud,
    addVendorAccount,
    removeVendorAccount,
    blockEnvVendorAccount,
    unblockEnvVendorAccount,
    toggleStationHidden,
    refreshAccountManager: fetchCloudConfig,
  };
}

const VENDOR_INFO = {
  huawei: {
    name: "Huawei FusionSolar",
    color: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
    badge: "HUAWEI",
  },
  kehua: {
    name: "Kehua Tech Energy",
    color: "#059669",
    bg: "#ecfdf5",
    border: "#a7f3d0",
    badge: "KEHUA",
  },
  sma: {
    name: "SMA Sunny Portal (ennexOS)",
    color: "#dc2626",
    bg: "#fef2f2",
    border: "#fecaca",
    badge: "SMA",
  },
};

export default function AccountManagerModal({
  isOpen,
  onClose,
  accountManagerConfig,
  onAddVendorAccount,
  onRemoveVendorAccount,
  onBlockEnvAccount,
  onUnblockEnvAccount,
  onToggleStationHidden,
  onTriggerSync,
  allStationsRaw = [],
  currentUser = null,
}) {
  const isSuperAdmin =
    currentUser?.role === "super_admin" || currentUser?.user_metadata?.role === "super_admin";

  const [activeTab, setActiveTab] = useState("add_account"); // "add_account" | "manage_stations" | "disabled_accounts"
  const [vendor, setVendor] = useState("huawei");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [region, setRegion] = useState("auto");
  const [label, setLabel] = useState("");
  const [envUsernameToBlock, setEnvUsernameToBlock] = useState("");
  const [stationSearch, setStationSearch] = useState("");
  const [stationFilterStatus, setStationFilterStatus] = useState("all"); // "all" | "active" | "hidden" | "offline"
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const showToastMsg = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const addedAccounts = accountManagerConfig?.added_accounts || [];
  const disabledStations = accountManagerConfig?.disabled_stations || [];
  const disabledAccounts = accountManagerConfig?.disabled_accounts || [];

  const handleSubmitNewAccount = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      alert("Silakan isi Username dan Password akun vendor PLTS.");
      return;
    }
    setSubmitting(true);
    try {
      await onAddVendorAccount({
        vendor,
        username: username.trim(),
        password: password.trim(),
        region,
        label: label.trim(),
      });
      setUsername("");
      setPassword("");
      setLabel("");
      setRegion("auto");
      showToastMsg(
        `Akun ${VENDOR_INFO[vendor]?.name || vendor} berhasil disimpan ke Cloud! Scraper akan otomatis menarik datanya.`
      );
      if (onTriggerSync) {
        onTriggerSync();
      }
    } catch (err) {
      alert(err?.message || "Gagal menyimpan akun");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredStations = useMemo(() => {
    const q = stationSearch.toLowerCase().trim();
    return allStationsRaw.filter((st) => {
      const uid = st.uid || `${st.source || st.platform}-${st.id}`;
      const id = String(st.id || st.station_id || "");
      const isHidden = disabledStations.includes(uid) || disabledStations.includes(id);
      const isOffline = st.status === "offline" || Number(st.current_power_kw || 0) <= 0;

      if (stationFilterStatus === "active" && isHidden) return false;
      if (stationFilterStatus === "hidden" && !isHidden) return false;
      if (stationFilterStatus === "offline" && (!isOffline || isHidden)) return false;

      if (q) {
        const matchName = (st.name || "").toLowerCase().includes(q);
        const matchAddr = (st.address || "").toLowerCase().includes(q);
        const matchVendor = (st.source || st.platform || "").toLowerCase().includes(q);
        const matchId = id.toLowerCase().includes(q);
        if (!matchName && !matchAddr && !matchVendor && !matchId) return false;
      }
      return true;
    });
  }, [allStationsRaw, stationSearch, stationFilterStatus, disabledStations]);

  if (!isOpen || !isSuperAdmin) return null;

  return (
    <div className="tariff-modal-backdrop" onClick={onClose}>
      <div
        className="tariff-modal-card"
        style={{ maxWidth: "820px", width: "95%" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="tariff-modal-header">
          <div className="tariff-modal-header-left">
            <div
              className="tariff-modal-icon-badge"
              style={{ background: "linear-gradient(135deg, #047857, #10b981)", color: "#fff" }}
            >
              🛠️
            </div>
            <div>
              <h2 className="tariff-modal-title">Kelola Akun Vendor &amp; Stasiun PLTS</h2>
              <p className="tariff-modal-subtitle">
                Tambah akun PLTS baru (Huawei, Kehua, SMA) atau nonaktifkan/hapus PLTS yang sudah tidak terpakai tanpa menyentuh kode.
              </p>
            </div>
          </div>
          <button className="tariff-modal-close-btn" onClick={onClose} title="Tutup">
            ✕
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div className="tariff-modal-toast">
            <span>✓</span> {toast}
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="tariff-modal-tabs">
          <button
            type="button"
            className={`tariff-tab-btn ${activeTab === "add_account" ? "active" : ""}`}
            onClick={() => setActiveTab("add_account")}
          >
            <span>➕ Tambah Akun PLTS Baru</span>
            {addedAccounts.length > 0 && (
              <span className="tariff-tab-pill active">{addedAccounts.length} Akun Web</span>
            )}
          </button>

          <button
            type="button"
            className={`tariff-tab-btn ${activeTab === "manage_stations" ? "active" : ""}`}
            onClick={() => setActiveTab("manage_stations")}
          >
            <span>🏢 Hapus / Sembunyikan Stasiun PLTS</span>
            {disabledStations.length > 0 && (
              <span
                className="tariff-tab-pill"
                style={{ background: "#fee2e2", color: "#b91c1c" }}
              >
                {disabledStations.length} Nonaktif
              </span>
            )}
          </button>

          <button
            type="button"
            className={`tariff-tab-btn ${activeTab === "disabled_accounts" ? "active" : ""}`}
            onClick={() => setActiveTab("disabled_accounts")}
          >
            <span>🚫 Nonaktifkan Akun Lama</span>
            {disabledAccounts.length > 0 && (
              <span
                className="tariff-tab-pill"
                style={{ background: "#fef3c7", color: "#92400e" }}
              >
                {disabledAccounts.length} Diblokir
              </span>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="tariff-modal-body" style={{ maxHeight: "68vh", overflowY: "auto" }}>
          {/* TAB 1: ADD & LIST VENDOR ACCOUNTS */}
          {activeTab === "add_account" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div className="tariff-info-notice">
                <span className="notice-icon">✨</span>
                <div>
                  <strong>Deteksi Lokasi &amp; Wilayah Otomatis:</strong> Cukup masukkan{" "}
                  <strong>Username</strong> dan <strong>Password</strong> login portal vendor
                  (Huawei FusionSolar, Kehua Tech, atau SMA Sunny Portal). Sistem akan otomatis
                  menarik data stasiun, membaca titik koordinat GPS di peta, dan mengelompokkan
                  wilayah Suku Dinas secara otomatis!
                </div>
              </div>

              <form
                onSubmit={handleSubmitNewAccount}
                style={{
                  background: "#f8faf9",
                  border: "1px solid #d5e0d8",
                  borderRadius: "14px",
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: "14px", color: "#0f2417" }}>
                  Formulir Tambah Akun Monitoring Vendor Baru
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                    gap: "12px",
                  }}
                >
                  {/* Pilih Vendor */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                      Platform Vendor Inverter *
                    </label>
                    <select
                      value={vendor}
                      onChange={(e) => setVendor(e.target.value)}
                      style={{
                        padding: "9px 12px",
                        borderRadius: "9px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                        fontWeight: 600,
                        background: "#fff",
                        color: "#0f172a",
                      }}
                    >
                      <option value="huawei">Huawei FusionSolar</option>
                      <option value="kehua">Kehua Tech (energy.kehua.com)</option>
                      <option value="sma">SMA Sunny Portal (ennexOS)</option>
                    </select>
                  </div>

                  {/* Wilayah (Otomatis / Opsional) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                      Wilayah Suku Dinas (Otomatis)
                    </label>
                    <select
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      style={{
                        padding: "9px 12px",
                        borderRadius: "9px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                        background: "#fff",
                        color: "#0f172a",
                      }}
                    >
                      <option value="auto">✨ Deteksi Otomatis dari Nama/Alamat PLTS</option>
                      <option value="Jakarta Pusat">Jakarta Pusat</option>
                      <option value="Jakarta Utara">Jakarta Utara</option>
                      <option value="Jakarta Barat">Jakarta Barat</option>
                      <option value="Jakarta Selatan">Jakarta Selatan</option>
                      <option value="Jakarta Timur">Jakarta Timur</option>
                      <option value="Kepulauan Seribu">Kepulauan Seribu</option>
                    </select>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                    gap: "12px",
                  }}
                >
                  {/* Username */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                      Username / Email Akun Vendor *
                    </label>
                    <input
                      type="text"
                      placeholder="Contoh: sudin_jaktim01 atau email@..."
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      style={{
                        padding: "9px 12px",
                        borderRadius: "9px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                        background: "#fff",
                      }}
                    />
                  </div>

                  {/* Password */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                      Password Akun Vendor *
                    </label>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="Masukkan password login vendor"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        style={{
                          width: "100%",
                          padding: "9px 38px 9px 12px",
                          borderRadius: "9px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          background: "#fff",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          position: "absolute",
                          right: "8px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "13px",
                          color: "#64748b",
                        }}
                        title={showPassword ? "Sembunyikan Password" : "Lihat Password"}
                      >
                        {showPassword ? "🙈" : "👁️"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Catatan / Label Opsional */}
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                    Keterangan / Nama Lokasi (Opsional)
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Akun PLTS Sekolah Jakarta Timur Batch 2"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    style={{
                      padding: "9px 12px",
                      borderRadius: "9px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      background: "#fff",
                    }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="tariff-btn-primary"
                    style={{
                      padding: "10px 20px",
                      fontSize: "13px",
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span>{submitting ? "Menyimpan..." : "➕ Simpan & Tarik Data Akun Baru"}</span>
                  </button>
                </div>
              </form>

              {/* Daftar Akun yang Ditambahkan dari Website */}
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "13.5px",
                    color: "#0f2417",
                    marginBottom: "10px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>Daftar Akun Vendor Tambahan (via Web Dashboard)</span>
                  <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>
                    Total: {addedAccounts.length} akun
                  </span>
                </div>

                {addedAccounts.length === 0 ? (
                  <div
                    style={{
                      padding: "22px",
                      textAlign: "center",
                      background: "#f8fafc",
                      borderRadius: "12px",
                      border: "1px dashed #cbd5e1",
                      color: "#64748b",
                      fontSize: "13px",
                    }}
                  >
                    Belum ada akun tambahan yang diinput melalui form website. (Akun bawaan dari GitHub Secrets / .env tetap berjalan otomatis).
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {addedAccounts.map((acc) => {
                      const vInfo = VENDOR_INFO[acc.vendor] || VENDOR_INFO.huawei;
                      return (
                        <div
                          key={acc.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "12px 14px",
                            background: "#ffffff",
                            border: "1px solid #e2e8f0",
                            borderRadius: "10px",
                            gap: "12px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <span
                              style={{
                                padding: "4px 9px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: 800,
                                background: vInfo.bg,
                                color: vInfo.color,
                                border: `1px solid ${vInfo.border}`,
                              }}
                            >
                              {vInfo.badge}
                            </span>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: "13.5px", color: "#0f172a" }}>
                                {acc.username}{" "}
                                {acc.label && acc.label !== acc.username ? (
                                  <span style={{ fontWeight: 500, color: "#64748b", fontSize: "12px" }}>
                                    ({acc.label})
                                  </span>
                                ) : null}
                              </div>
                              <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                                Wilayah: <strong>{acc.region || "Deteksi Otomatis"}</strong> • Ditambahkan:{" "}
                                {acc.created_at
                                  ? new Date(acc.created_at).toLocaleDateString("id-ID")
                                  : "Baru saja"}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Hapus akun ${acc.vendor.toUpperCase()} "${acc.username}" dari daftar penarikan data?`
                                )
                              ) {
                                onRemoveVendorAccount(acc.id, acc.username, acc.vendor);
                                showToastMsg(`Akun "${acc.username}" telah dihapus.`);
                              }
                            }}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "8px",
                              border: "1px solid #fecaca",
                              background: "#fef2f2",
                              color: "#dc2626",
                              fontSize: "12px",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            🗑️ Hapus Akun
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: MANAGE / HIDE / REMOVE DECOMMISSIONED STATIONS */}
          {activeTab === "manage_stations" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="tariff-info-notice" style={{ background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }}>
                <span className="notice-icon">💡</span>
                <div>
                  <strong>Menghapus / Menyembunyikan PLTS yang Sudah Mati atau Tidak Terpakai:</strong>{" "}
                  Jika ada lokasi PLTS yang sudah dibongkar, rusak permanen, atau tidak lagi digunakan, klik tombol{" "}
                  <strong>"Hapus dari Dashboard"</strong> di sebelah nama PLTS tersebut. Lokasi tersebut akan{" "}
                  <strong>langsung hilang seketika</strong> dari peta, grafik, dan perhitungan total energi di seluruh dashboard, serta dilewati oleh scraper. Anda juga bisa mengaktifkannya kembali kapan saja.
                </div>
              </div>

              {/* Filter & Search Bar */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <input
                  type="text"
                  placeholder="🔍 Cari nama sekolah/gedung, alamat, atau vendor..."
                  value={stationSearch}
                  onChange={(e) => setStationSearch(e.target.value)}
                  style={{
                    flex: "1 1 260px",
                    padding: "9px 14px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />

                <div style={{ display: "flex", gap: "6px" }}>
                  {[
                    { id: "all", label: `Semua (${allStationsRaw.length})` },
                    {
                      id: "active",
                      label: `Aktif Tampil (${
                        allStationsRaw.filter(
                          (s) =>
                            !disabledStations.includes(s.uid) &&
                            !disabledStations.includes(String(s.id))
                        ).length
                      })`,
                    },
                    { id: "offline", label: "Sedang Offline" },
                    { id: "hidden", label: `Dihapus/Disembunyikan (${disabledStations.length})` },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setStationFilterStatus(tab.id)}
                      style={{
                        padding: "7px 12px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                        border:
                          stationFilterStatus === tab.id
                            ? "1px solid #047857"
                            : "1px solid #cbd5e1",
                        background:
                          stationFilterStatus === tab.id ? "#ecfdf5" : "#ffffff",
                        color: stationFilterStatus === tab.id ? "#047857" : "#475569",
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Station List */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  maxHeight: "420px",
                  overflowY: "auto",
                  paddingRight: "4px",
                }}
              >
                {filteredStations.length === 0 ? (
                  <div
                    style={{
                      padding: "24px",
                      textAlign: "center",
                      color: "#64748b",
                      background: "#f8fafc",
                      borderRadius: "12px",
                    }}
                  >
                    Tidak ada stasiun PLTS yang cocok dengan pencarian/filter ini.
                  </div>
                ) : (
                  filteredStations.map((st) => {
                    const uid = st.uid || `${st.source || st.platform}-${st.id}`;
                    const idStr = String(st.id || st.station_id || "");
                    const isHidden =
                      disabledStations.includes(uid) || disabledStations.includes(idStr);
                    const isOffline =
                      st.status === "offline" || Number(st.current_power_kw || 0) <= 0;
                    const vInfo =
                      VENDOR_INFO[String(st.source || st.platform || "huawei").toLowerCase()] ||
                      VENDOR_INFO.huawei;

                    return (
                      <div
                        key={uid}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "11px 14px",
                          borderRadius: "10px",
                          background: isHidden ? "#fef2f2" : "#ffffff",
                          border: isHidden ? "1px solid #fecaca" : "1px solid #e2e8f0",
                          opacity: isHidden ? 0.85 : 1,
                          gap: "12px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: "6px",
                              fontSize: "10.5px",
                              fontWeight: 800,
                              background: vInfo.bg,
                              color: vInfo.color,
                              border: `1px solid ${vInfo.border}`,
                              flexShrink: 0,
                            }}
                          >
                            {vInfo.badge}
                          </span>

                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: "13.5px",
                                color: isHidden ? "#991b1b" : "#0f172a",
                                textDecoration: isHidden ? "line-through" : "none",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                flexWrap: "wrap",
                              }}
                            >
                              <span>{st.name}</span>
                              <span
                                style={{
                                  fontSize: "10.5px",
                                  padding: "1px 7px",
                                  borderRadius: "999px",
                                  fontWeight: 700,
                                  background: isHidden
                                    ? "#fee2e2"
                                    : isOffline
                                    ? "#fef2f2"
                                    : "#ecfdf5",
                                  color: isHidden
                                    ? "#b91c1c"
                                    : isOffline
                                    ? "#ef4444"
                                    : "#059669",
                                }}
                              >
                                {isHidden ? "NONAKTIF / DIHAPUS" : isOffline ? "Offline" : "Online"}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: "11.5px",
                                color: "#64748b",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              ID: <code>{idStr}</code> • Kapasitas: {st.capacity_kwp || 0} kWp •{" "}
                              {st.address || st.region || "DKI Jakarta"}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const targetKey = disabledStations.includes(idStr) ? idStr : uid;
                            onToggleStationHidden(targetKey);
                            showToastMsg(
                              isHidden
                                ? `PLTS "${st.name}" berhasil ditampilkan kembali di dashboard!`
                                : `PLTS "${st.name}" berhasil dihapus/disembunyikan dari dashboard!`
                            );
                          }}
                          style={{
                            padding: "7px 13px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: 700,
                            cursor: "pointer",
                            flexShrink: 0,
                            border: isHidden ? "1px solid #a7f3d0" : "1px solid #fecaca",
                            background: isHidden ? "#ecfdf5" : "#fef2f2",
                            color: isHidden ? "#047857" : "#dc2626",
                          }}
                        >
                          {isHidden ? "♻️ Tampilkan Kembali" : "🗑️ Hapus dari Dashboard"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 3: BLOCK / DISABLE LEGACY ENV ACCOUNTS */}
          {activeTab === "disabled_accounts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="tariff-info-notice">
                <span className="notice-icon">🔒</span>
                <div>
                  <strong>Menonaktifkan Akun Lama (dari .env / GitHub Secrets):</strong> Jika ada{" "}
                  <strong>akun vendor lama</strong> yang terdaftar di GitHub Secrets atau file{" "}
                  <code>.env</code> yang sudah mati / tidak dipakai lagi, Anda cukup mengetikkan{" "}
                  <strong>Username</strong> akun tersebut di bawah ini. Scraper otomatis akan
                  melewati (tidak lagi menarik data) akun tersebut tanpa Anda perlu membuka GitHub!
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                  background: "#f8faf9",
                  padding: "14px",
                  borderRadius: "12px",
                  border: "1px solid #d5e0d8",
                }}
              >
                <input
                  type="text"
                  placeholder="Masukkan username akun vendor yang ingin dinonaktifkan..."
                  value={envUsernameToBlock}
                  onChange={(e) => setEnvUsernameToBlock(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "9px 13px",
                    borderRadius: "9px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!envUsernameToBlock.trim()) return;
                    onBlockEnvAccount(envUsernameToBlock.trim());
                    showToastMsg(
                      `Akun "${envUsernameToBlock.trim()}" dimasukkan ke daftar nonaktif.`
                    );
                    setEnvUsernameToBlock("");
                  }}
                  style={{
                    padding: "9px 16px",
                    borderRadius: "9px",
                    background: "#dc2626",
                    color: "#fff",
                    border: "none",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  🚫 Nonaktifkan Akun
                </button>
              </div>

              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "13.5px",
                    color: "#0f2417",
                    marginBottom: "8px",
                  }}
                >
                  Daftar Username Akun yang Saat Ini Dinonaktifkan ({disabledAccounts.length})
                </div>

                {disabledAccounts.length === 0 ? (
                  <div
                    style={{
                      padding: "20px",
                      textAlign: "center",
                      background: "#f8fafc",
                      borderRadius: "10px",
                      border: "1px dashed #cbd5e1",
                      color: "#64748b",
                      fontSize: "13px",
                    }}
                  >
                    Tidak ada akun vendor yang diblokir/dinonaktifkan.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {disabledAccounts.map((uname) => (
                      <div
                        key={uname}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          background: "#fef2f2",
                          border: "1px solid #fecaca",
                          borderRadius: "9px",
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: "13px", color: "#991b1b" }}>
                          🚫 {uname}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onUnblockEnvAccount(uname);
                            showToastMsg(`Akun "${uname}" diaktifkan kembali.`);
                          }}
                          style={{
                            padding: "5px 12px",
                            borderRadius: "7px",
                            background: "#ffffff",
                            border: "1px solid #cbd5e1",
                            color: "#0f172a",
                            fontSize: "12px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          ♻️ Aktifkan Kembali
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="tariff-modal-footer">
          <div style={{ fontSize: "12px", color: "#64748b" }}>
            🔒 Tersinkronisasi otomatis ke Cloud Supabase &amp; GitHub Actions Scraper
          </div>
          <div className="tariff-footer-actions">
            <button type="button" className="tariff-btn-secondary" onClick={onClose}>
              Selesai &amp; Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
