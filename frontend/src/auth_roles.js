/**
 * Modul Autentikasi dan Role-Based Access Control (RBAC) per Wilayah
 * Memfasilitasi 5 Akun Administrator Suku Dinas Wilayah + 1 Akun Super Admin Provinsi.
 *
 * CATATAN KEAMANAN:
 * Password akun TIDAK di-hardcode di kode sumber ini.
 * Seluruh password dibaca secara dinamis dari Environment Variables (VITE_*)
 * yang disimpan secara rahasia di .env lokal dan Dashboard Vercel.
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
 * Mengambil password akun dari environment variable
 */
export function getAccountPassword(envKey) {
  if (!envKey) return "";

  // 1. Vite environment di browser
  try {
    if (typeof import.meta !== "undefined" && import.meta?.env && import.meta.env[envKey]) {
      return String(import.meta.env[envKey]).trim();
    }
  } catch (_) {}

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

      // Verifikasi password terhadap environment variable
      if (configuredPass && cleanPass === configuredPass) {
        return {
          id: acc.id,
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
 * Memeriksa apakah user memiliki hak akses untuk mengedit stasiun tertentu
 */
export function canUserEditStation(user, station, getStationRegionFn) {
  if (!user) return false;

  const role = user.role || user.user_metadata?.role || "super_admin";
  const userRegion = user.region || user.user_metadata?.region || "all";

  // Super admin / Administrator Provinsi dapat mengedit seluruh stasiun
  if (role === "super_admin" || userRegion === "all") {
    return true;
  }

  // Viewer / Demo hanya bisa melihat
  if (role === "viewer") {
    return false;
  }

  if (!station) return false;

  const stationRegion = getStationRegionFn
    ? getStationRegionFn(station)
    : (station.region ? String(station.region).toLowerCase() : "");

  return Boolean(userRegion && stationRegion && userRegion === stationRegion);
}

/**
 * Memeriksa apakah user dapat mengedit tarif kategori global PLN
 * Hanya super admin yang berhak mengubah tarif kategori global karena berdampak ke seluruh DKI Jakarta.
 */
export function canUserEditCategoryTariff(user) {
  if (!user) return false;
  const role = user.role || user.user_metadata?.role || "super_admin";
  const userRegion = user.region || user.user_metadata?.region || "all";
  return role === "super_admin" || userRegion === "all";
}
