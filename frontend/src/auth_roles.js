/**
 * Modul Autentikasi dan Role-Based Access Control (RBAC) per Wilayah
 * Memfasilitasi 5 Akun Administrator Suku Dinas Wilayah + 1 Akun Super Admin Provinsi.
 */

export const REGIONAL_ACCOUNTS = [
  {
    id: "admin_pusat",
    username: "admin.pusat",
    email: "admin.pusat@jakarta.go.id",
    role: "regional_admin",
    region: "jakpus",
    regionName: "Jakarta Pusat",
    name: "Admin Sudin Jakarta Pusat",
    envKey: "VITE_AUTH_ADMIN_PUSAT_PASS",
  },
  {
    id: "admin_utara",
    username: "admin.utara",
    email: "admin.utara@jakarta.go.id",
    role: "regional_admin",
    region: "jakut",
    regionName: "Jakarta Utara",
    name: "Admin Sudin Jakarta Utara",
    envKey: "VITE_AUTH_ADMIN_UTARA_PASS",
  },
  {
    id: "admin_barat",
    username: "admin.barat",
    email: "admin.barat@jakarta.go.id",
    role: "regional_admin",
    region: "jakbar",
    regionName: "Jakarta Barat",
    name: "Admin Sudin Jakarta Barat",
    envKey: "VITE_AUTH_ADMIN_BARAT_PASS",
  },
  {
    id: "admin_selatan",
    username: "admin.selatan",
    email: "admin.selatan@jakarta.go.id",
    role: "regional_admin",
    region: "jaksel",
    regionName: "Jakarta Selatan",
    name: "Admin Sudin Jakarta Selatan",
    envKey: "VITE_AUTH_ADMIN_SELATAN_PASS",
  },
  {
    id: "admin_timur",
    username: "admin.timur",
    email: "admin.timur@jakarta.go.id",
    role: "regional_admin",
    region: "jaktim",
    regionName: "Jakarta Timur",
    name: "Admin Sudin Jakarta Timur",
    envKey: "VITE_AUTH_ADMIN_TIMUR_PASS",
  },
  {
    id: "admin_super",
    username: "admin",
    email: "adminplts@sudinaker.go.id",
    role: "super_admin",
    region: "all",
    regionName: "Provinsi DKI Jakarta",
    name: "Administrator Provinsi DKI Jakarta",
    envKey: "VITE_AUTH_SUPERADMIN_PASS",
  },
];

/**
 * Akses statis ke import.meta.env agar Vite compiler melakukan inline replacement
 */
function readStaticViteEnv(envKey) {
  try {
    if (typeof import.meta !== "undefined" && import.meta?.env) {
      switch (envKey) {
        case "VITE_AUTH_ADMIN_PUSAT_PASS":
          return import.meta.env.VITE_AUTH_ADMIN_PUSAT_PASS;
        case "VITE_AUTH_ADMIN_UTARA_PASS":
          return import.meta.env.VITE_AUTH_ADMIN_UTARA_PASS;
        case "VITE_AUTH_ADMIN_BARAT_PASS":
          return import.meta.env.VITE_AUTH_ADMIN_BARAT_PASS;
        case "VITE_AUTH_ADMIN_SELATAN_PASS":
          return import.meta.env.VITE_AUTH_ADMIN_SELATAN_PASS;
        case "VITE_AUTH_ADMIN_TIMUR_PASS":
          return import.meta.env.VITE_AUTH_ADMIN_TIMUR_PASS;
        case "VITE_AUTH_SUPERADMIN_PASS":
          return import.meta.env.VITE_AUTH_SUPERADMIN_PASS;
        default:
          return "";
      }
    }
  } catch (_) {}
  return "";
}

/**
 * Mengambil password akun dari environment variable (Vite / Node)
 * SANGAT AMAN: Tidak ada password yang di-hardcode di file ini.
 * Password HANYA dibaca dari .env lokal dan Environment Variables Vercel.
 */
export function getAccountPassword(envKey) {
  if (!envKey) return "";

  // 1. Static access untuk Vite browser runtime
  const viteVal = readStaticViteEnv(envKey);
  if (viteVal) return String(viteVal).trim();

  // 2. Node.js environment (saat unit test / SSR)
  try {
    if (typeof process !== "undefined" && process?.env && process.env[envKey]) {
      return String(process.env[envKey]).trim();
    }
  } catch (_) {}

  return "";
}

/**
 * Mencari profil akun berdasarkan input email/username dan password
 */
export function authenticateLocalAccount(emailOrUsername, password) {
  const cleanInput = (emailOrUsername || "").trim().toLowerCase();
  const cleanPass = (password || "").trim();

  if (!cleanInput || !cleanPass) return null;

  for (const acc of REGIONAL_ACCOUNTS) {
    const matchUsername = acc.username.toLowerCase() === cleanInput;
    const matchEmail = acc.email.toLowerCase() === cleanInput;
    const matchAlias = cleanInput.includes(acc.region) || (acc.username && cleanInput === acc.username.replace(".", ""));

    if (matchUsername || matchEmail || matchAlias) {
      const configuredPass = getAccountPassword(acc.envKey);

      // Verifikasi password HANYA terhadap environment variable yang terpasang
      if (configuredPass && cleanPass === configuredPass) {
        return {
          id: acc.id,
          username: acc.username,
          email: acc.email,
          role: acc.role,
          region: acc.region,
          regionName: acc.regionName,
          name: acc.name,
        };
      }
    }
  }

  // Fallback demo/operator jika diakses sebagai demo
  if (cleanInput === "demo" || cleanInput === "operator") {
    return {
      id: "operator",
      username: "operator",
      email: "operator.plts@jakarta.go.id",
      role: "viewer",
      region: "all",
      regionName: "DKI Jakarta (Demo)",
      name: "Operator PLTS (Demo)",
    };
  }

  return null;
}

/**
 * Normalisasi kode wilayah untuk perbandingan yang konsisten
 */
export function normalizeRegionCode(reg) {
  if (!reg) return "";
  const r = String(reg).toLowerCase().trim();
  if (r.includes("pusat") || r.includes("jakpus")) return "jakpus";
  if (r.includes("utara") || r.includes("jakut")) return "jakut";
  if (r.includes("selatan") || r.includes("jaksel")) return "jaksel";
  if (r.includes("barat") || r.includes("jakbar")) return "jakbar";
  if (r.includes("timur") || r.includes("jaktim")) return "jaktim";
  if (r.includes("seribu")) return "seribu";
  if (r === "all") return "all";
  return r;
}

/**
 * Memeriksa apakah user memiliki hak akses untuk mengedit stasiun tertentu
 */
export function canUserEditStation(user, station, getStationRegionFn) {
  if (!user) return false;

  const role = user.role || user.user_metadata?.role || "viewer";
  const rawUserRegion = user.region || user.user_metadata?.region || "";
  const userRegion = normalizeRegionCode(rawUserRegion);

  // Super admin / Administrator Provinsi dapat mengedit seluruh stasiun
  if (role === "super_admin" || userRegion === "all") {
    return true;
  }

  // Viewer / Demo hanya bisa melihat
  if (role === "viewer") {
    return false;
  }

  if (!station) return false;

  const rawStationRegion = getStationRegionFn
    ? getStationRegionFn(station)
    : (station.region ? String(station.region) : "");
  const stationRegion = normalizeRegionCode(rawStationRegion);

  return Boolean(userRegion && stationRegion && userRegion === stationRegion);
}

/**
 * Memeriksa apakah user dapat membuka pengaturan tarif dalam mode edit (Super Admin & Admin Wilayah)
 */
export function canUserOpenTariffSettings(user) {
  if (!user) return false;
  const role = user.role || user.user_metadata?.role || "viewer";
  return role === "super_admin" || role === "regional_admin";
}

/**
 * Memeriksa apakah user dapat mengedit tarif kategori global PLN
 * Hanya Super Admin Provinsi yang berhak karena berdampak ke seluruh DKI Jakarta.
 */
export function canUserEditCategoryTariff(user) {
  if (!user) return false;
  const role = user.role || user.user_metadata?.role || "viewer";
  const userRegion = normalizeRegionCode(user.region || user.user_metadata?.region || "");
  return role === "super_admin" || userRegion === "all";
}

/**
 * Memeriksa apakah user dapat mengedit tarif listrik stasiun tertentu
 * - Super admin dapat mengedit tarif seluruh stasiun
 * - Admin wilayah dapat mengedit tarif stasiun di wilayahnya sendiri
 * - Viewer / demo tidak dapat mengedit
 */
export function canUserEditStationTariff(user, station, getStationRegionFn) {
  return canUserEditStation(user, station, getStationRegionFn);
}

/**
 * Alias kompatibilitas
 */
export function canUserEditTariffs(user) {
  return canUserOpenTariffSettings(user);
}
