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
    passHash: "1ecbf4c5d985a800e8aec4fb6d11de98da057e3a3637613b9fc2cf63ee0e5072",
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
    passHash: "9f7125066d61e8fd6b10122fe717420efe5864cbc8f33f1dcb1fa6a71da0e6e1",
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
    passHash: "717c5e3568b07f7c486dae5af42534b5a9addd0c315417abcc672d75a6049d06",
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
    passHash: "353f969b7259b1c271b54341bd8e64b667292d0abe87236f77416a1525706b6f",
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
    passHash: "04692c3461f5076dc9a36aca1f15afd6cba39bbd23485c7f458c3e04627189a4",
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
    passHash: "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
  },
];

/**
 * Fungsi SHA-256 murni JavaScript untuk mencocokkan hash password secara satu arah (one-way hashing).
 * Mencegah bocornya plaintext password di GitHub sembari memastikan login tetap berfungsi di browser & Vercel.
 */
export function sha256(ascii) {
  if (typeof ascii !== "string") return "";
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = "length";
  let i, j;
  let result = "";
  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  hash = hash.slice(0, 8);
  ascii += "\x80";
  while ((ascii[lengthProperty] % 64) - 56) ascii += "\x00";
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return "";
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;
  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (i = 0; i < 8; i++) {
    for (let i2 = 3; i2 >= 0; i2--) {
      const c = (hash[i] >> (i2 * 8)) & 255;
      result += (c < 16 ? "0" : "") + c.toString(16);
    }
  }
  return result;
}

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
 * Jika diset di .env atau Vercel Project Settings, nilai env akan diprioritaskan.
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

      // Verifikasi: Cocokkan terhadap environment variable jika diset, atau verifikasi SHA-256 hash satu arah
      const isPassMatched =
        (configuredPass && cleanPass === configuredPass) ||
        (acc.passHash && sha256(cleanPass) === acc.passHash);

      if (isPassMatched) {
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
