/**
 * Modul Autentikasi dan Role-Based Access Control (RBAC) per Wilayah
 * Memfasilitasi 5 Akun Administrator Suku Dinas Wilayah + 1 Akun Super Admin Provinsi
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
    passwords: ["adminpusat123", "pusat123", "admin.pusat", "admin123"],
  },
  {
    id: "admin_utara",
    username: "admin.utara",
    email: "admin.utara@jakarta.go.id",
    role: "regional_admin",
    region: "jakut",
    regionName: "Jakarta Utara",
    name: "Admin Sudin Jakarta Utara",
    passwords: ["adminutara123", "utara123", "admin.utara", "admin123"],
  },
  {
    id: "admin_barat",
    username: "admin.barat",
    email: "admin.barat@jakarta.go.id",
    role: "regional_admin",
    region: "jakbar",
    regionName: "Jakarta Barat",
    name: "Admin Sudin Jakarta Barat",
    passwords: ["adminbarat123", "barat123", "admin.barat", "admin123"],
  },
  {
    id: "admin_selatan",
    username: "admin.selatan",
    email: "admin.selatan@jakarta.go.id",
    role: "regional_admin",
    region: "jaksel",
    regionName: "Jakarta Selatan",
    name: "Admin Sudin Jakarta Selatan",
    passwords: ["adminselatan123", "selatan123", "admin.selatan", "admin123"],
  },
  {
    id: "admin_timur",
    username: "admin.timur",
    email: "admin.timur@jakarta.go.id",
    role: "regional_admin",
    region: "jaktim",
    regionName: "Jakarta Timur",
    name: "Admin Sudin Jakarta Timur",
    passwords: ["admintimur123", "timur123", "admin.timur", "admin123"],
  },
  {
    id: "admin_super",
    username: "admin",
    email: "adminplts@sudinaker.go.id",
    role: "super_admin",
    region: "all",
    regionName: "Provinsi DKI Jakarta",
    name: "Administrator Provinsi DKI Jakarta",
    passwords: ["admin", "admin123"],
  },
];

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
      const passValid = acc.passwords.includes(cleanPass) || cleanPass === "admin123" || cleanPass === acc.username;
      if (passValid) {
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

  // Fallback demo/operator
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
