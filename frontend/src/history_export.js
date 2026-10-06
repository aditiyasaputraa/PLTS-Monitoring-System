import "./history_export.css";

const AUTH_STORAGE_KEY = "plts-monitoring.supabase-session";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function apiBase() {
  const configured = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  if (configured) return configured;
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

function readSession() {
  try {
    return JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function dateText(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function formatDisplayDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parseDate(value));
}

function defaultDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  return { start: dateText(start), end: dateText(end) };
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "htmlFor") node.htmlFor = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  });
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child) node.append(child);
  }
  return node;
}

function chevronIcon() {
  const wrapper = el("span", { className: "history-control-icon", "aria-hidden": "true" });
  wrapper.innerHTML = '<svg viewBox="0 0 20 20"><path d="m6 8 4 4 4-4" /></svg>';
  return wrapper;
}

function calendarIcon() {
  const wrapper = el("span", { className: "history-control-leading", "aria-hidden": "true" });
  wrapper.innerHTML = '<svg viewBox="0 0 20 20"><path d="M5 3v3M15 3v3M3.5 7.5h13M4.5 5h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /></svg>';
  return wrapper;
}

function setError(message = "") {
  const target = document.querySelector("#history-export-error");
  if (!target) return;
  target.textContent = message;
  target.hidden = !message;
}

function closePopovers(except = null) {
  document.querySelectorAll(".history-popover.open").forEach((popover) => {
    if (popover === except) return;
    popover.classList.remove("open");
    const control = popover.parentElement?.querySelector(".history-control-button");
    control?.setAttribute("aria-expanded", "false");
  });
}

function togglePopover(control, popover) {
  const opening = !popover.classList.contains("open");
  closePopovers(opening ? popover : null);
  popover.classList.toggle("open", opening);
  control.setAttribute("aria-expanded", String(opening));
}

function createDropdown({ name, options, value = "", ariaLabel }) {
  const wrapper = el("div", { className: "history-field-control history-dropdown" });
  const hidden = el("input", { type: "hidden", name, value });
  const valueText = el("span", { className: "history-control-value" });
  const control = el("button", {
    type: "button",
    className: "history-control-button",
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    "aria-label": ariaLabel,
  }, [valueText, chevronIcon()]);
  const menu = el("div", { className: "history-popover history-dropdown-menu", role: "listbox" });
  let items = [];

  const render = () => {
    menu.replaceChildren();
    const selected = items.find((item) => item.value === hidden.value) || items[0];
    valueText.textContent = selected?.label || "Select";
    for (const item of items) {
      const option = el("button", {
        type: "button",
        className: `history-option ${item.value === hidden.value ? "selected" : ""}`,
        role: "option",
        "aria-selected": String(item.value === hidden.value),
      }, [
        el("span", { text: item.label }),
        item.meta ? el("small", { text: item.meta }) : null,
      ]);
      option.addEventListener("click", () => {
        hidden.value = item.value;
        render();
        closePopovers();
      });
      menu.append(option);
    }
  };

  const setOptions = (nextItems) => {
    items = nextItems;
    if (!items.some((item) => item.value === hidden.value)) hidden.value = items[0]?.value || "";
    render();
  };

  control.addEventListener("click", () => togglePopover(control, menu));
  wrapper.append(hidden, control, menu);
  setOptions(options);
  return {
    node: wrapper,
    input: hidden,
    control,
    menu,
    setOptions,
    getSelected: () => items.find((item) => item.value === hidden.value) || null,
  };
}

function createDatePicker({ name, value, ariaLabel }) {
  const wrapper = el("div", { className: "history-field-control history-date-picker" });
  const hidden = el("input", { type: "hidden", name, value });
  const valueText = el("span", { className: "history-control-value", text: formatDisplayDate(value) });
  const control = el("button", {
    type: "button",
    className: "history-control-button history-date-button",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
    "aria-label": ariaLabel,
  }, [calendarIcon(), valueText]);
  const popover = el("div", { className: "history-popover history-calendar", role: "dialog", "aria-label": ariaLabel });
  let viewDate = parseDate(value);

  const renderCalendar = () => {
    popover.replaceChildren();
    const header = el("div", { className: "history-calendar-head" });
    const previous = el("button", { type: "button", className: "history-calendar-nav", "aria-label": "Previous month", text: "‹" });
    const title = el("strong", { text: `${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}` });
    const next = el("button", { type: "button", className: "history-calendar-nav", "aria-label": "Next month", text: "›" });
    previous.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
      renderCalendar();
    });
    next.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
      renderCalendar();
    });
    header.append(previous, title, next);

    const weekdays = el("div", { className: "history-calendar-weekdays" });
    WEEKDAYS.forEach((day) => weekdays.append(el("span", { text: day })));

    const grid = el("div", { className: "history-calendar-grid" });
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const selectedValue = hidden.value;
    const todayValue = dateText(new Date());

    for (let index = 0; index < firstWeekday; index += 1) {
      grid.append(el("span", { className: "history-calendar-empty" }));
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const currentValue = dateText(new Date(year, month, day));
      const dayButton = el("button", {
        type: "button",
        className: [
          "history-calendar-day",
          currentValue === selectedValue ? "selected" : "",
          currentValue === todayValue ? "today" : "",
        ].filter(Boolean).join(" "),
        text: String(day),
        "aria-label": formatDisplayDate(currentValue),
      });
      dayButton.addEventListener("click", () => {
        hidden.value = currentValue;
        valueText.textContent = formatDisplayDate(currentValue);
        viewDate = parseDate(currentValue);
        renderCalendar();
        closePopovers();
      });
      grid.append(dayButton);
    }

    const footer = el("div", { className: "history-calendar-footer" });
    const today = el("button", { type: "button", text: "Today" });
    today.addEventListener("click", () => {
      const currentValue = dateText(new Date());
      hidden.value = currentValue;
      valueText.textContent = formatDisplayDate(currentValue);
      viewDate = new Date();
      renderCalendar();
      closePopovers();
    });
    footer.append(today);
    popover.append(header, weekdays, grid, footer);
  };

  control.addEventListener("click", () => {
    viewDate = parseDate(hidden.value);
    renderCalendar();
    togglePopover(control, popover);
  });
  wrapper.append(hidden, control, popover);
  renderCalendar();
  return { node: wrapper, input: hidden, control, popover };
}

function field(label, control, className = "") {
  return el("div", { className: `history-field ${className}`.trim() }, [
    el("span", { className: "history-field-label", text: label }),
    control,
  ]);
}

async function authorizedFetch(path, options = {}) {
  const session = readSession();
  const base = apiBase();
  if (!base) throw new Error("VITE_API_URL is not configured.");

  const headers = new Headers(options.headers || {});
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  const response = await fetch(`${base}${path}`, { ...options, headers, cache: "no-store" });
  if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
  return response;
}

async function loadStations(dropdown) {
  dropdown.setOptions([{ value: "", label: "All sites", meta: "Fleet" }]);
  let data = null;

  const base = apiBase();
  if (base) {
    try {
      const response = await authorizedFetch(`/api/current?ts=${Date.now()}`);
      if (response.ok) {
        data = await response.json();
      }
    } catch (_) {}
  }

  if (!data?.by_site) {
    try {
      const { url, key } = authConfig();
      const sbRes = await fetch(`${url}/rest/v1/monitoring_current?select=payload&limit=1`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      });
      if (sbRes.ok) {
        const rows = await sbRes.json();
        data = rows?.[0]?.payload;
      }
    } catch (_) {}
  }

  if (!data?.by_site) return;

  const stations = [];
  Object.entries(data?.by_site || {}).forEach(([platform, site]) => {
    (site?.stations || []).forEach((station) => {
      const stId = station?.station_id ?? station?.station_numeric_id ?? station?.id;
      if (stId === undefined || stId === null) return;
      stations.push({
        value: `${platform}::${String(stId)}`,
        label: station.name || station.station_name || String(stId),
        meta: platform,
      });
    });
  });
  stations.sort((a, b) => a.label.localeCompare(b.label));
  dropdown.setOptions([{ value: "", label: "All sites", meta: "Fleet" }, ...stations]);
}

function openModal(modal, stationDropdown) {
  setError();
  closePopovers();
  modal.hidden = false;
  document.body.classList.add("history-export-open");
  loadStations(stationDropdown).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  window.setTimeout(() => modal.querySelector(".history-control-button, button")?.focus(), 0);
}

function closeModal(modal) {
  closePopovers();
  modal.hidden = true;
  document.body.classList.remove("history-export-open");
}

async function exportDirectFromSupabase({ startDate, endDate, resolution, platform, stationId, safeScope, fileFormat }) {
  const { url, key } = authConfig();

  // 1. Try querying daily or hourly table
  const table = resolution === "hourly" ? "monitoring_site_hourly" : "monitoring_site_daily";
  let endpoint = `${url}/rest/v1/${table}?select=*`;
  if (resolution === "hourly") {
    endpoint += `&bucket_hour=gte.${startDate}T00:00:00Z&bucket_hour=lte.${endDate}T23:59:59Z&order=bucket_hour.asc`;
  } else {
    endpoint += `&bucket_date=gte.${startDate}&bucket_date=lte.${endDate}&order=bucket_date.asc`;
  }
  if (platform) endpoint += `&platform=eq.${platform}`;
  if (stationId) endpoint += `&station_id=eq.${stationId}`;

  let rows = [];
  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (res.ok) {
      rows = await res.json();
    }
  } catch (_) {}

  if (Array.isArray(rows) && rows.length > 0) {
    const colKeys = Object.keys(rows[0]);
    const csvLines = [colKeys.join(",")];
    rows.forEach((r) => {
      const line = colKeys.map((k) => {
        const val = r[k];
        if (val === null || val === undefined) return '""';
        if (typeof val === "number") return val;
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      csvLines.push(line.join(","));
    });
    const blob = new Blob([csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const filename = `PLTS-History_${safeScope}_${resolution}_${startDate}_to_${endDate}.csv`;
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = el("a", { href: downloadUrl, download: filename });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    return;
  }

  // 2. Fallback to current monitoring snapshot
  const curRes = await fetch(`${url}/rest/v1/monitoring_current?select=payload&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (curRes.ok) {
    const curRows = await curRes.json();
    const bySite = curRows?.[0]?.payload?.by_site || {};
    const stations = [];
    Object.entries(bySite).forEach(([plat, site]) => {
      if (platform && plat !== platform) return;
      (site.stations || []).forEach((st) => {
        const stId = String(st.station_id ?? st.station_numeric_id ?? st.id);
        if (stationId && stId !== String(stationId)) return;
        stations.push({
          platform: plat,
          station_id: stId,
          station_name: st.name || st.station_name || `Station ${stId}`,
          status: st.status || "normal",
          current_power_kw: st.inverter_power_kw ?? st.current_power_kw ?? 0,
          today_energy_kwh: st.today_energy_kwh ?? st.daily_energy_kwh ?? 0,
          monthly_energy_kwh: st.monthly_energy_kwh ?? st.month_energy_kwh ?? 0,
          total_energy_kwh: st.total_energy_kwh ?? st.cumulative_energy_kwh ?? 0,
          capacity_kwp: st.capacity_kwp ?? st.installed_capacity ?? 0,
          address: st.address || "",
          latitude: st.latitude || "",
          longitude: st.longitude || "",
        });
      });
    });

    if (stations.length > 0) {
      const headers = ["Platform", "Station ID", "Station Name", "Status", "Current Power (kW)", "Daily Energy (kWh)", "Monthly Energy (kWh)", "Total Energy (kWh)", "Capacity (kWp)", "Address", "Latitude", "Longitude"];
      const csvLines = [headers.join(",")];
      stations.forEach((s) => {
        const row = [
          `"${s.platform}"`,
          `"${s.station_id}"`,
          `"${(s.station_name || "").replace(/"/g, '""')}"`,
          `"${s.status}"`,
          Number(s.current_power_kw || 0).toFixed(2),
          Number(s.today_energy_kwh || 0).toFixed(2),
          Number(s.monthly_energy_kwh || 0).toFixed(2),
          Number(s.total_energy_kwh || 0).toFixed(2),
          Number(s.capacity_kwp || 0).toFixed(1),
          `"${(s.address || "").replace(/"/g, '""')}"`,
          s.latitude,
          s.longitude,
        ];
        csvLines.push(row.join(","));
      });
      const blob = new Blob([csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const filename = `PLTS-Monitoring_${safeScope}_${startDate}_to_${endDate}.csv`;
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = el("a", { href: downloadUrl, download: filename });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      return;
    }
  }

  throw new Error("No data available to download for this selection.");
}

async function download(form, button, stationDropdown) {
  setError();
  const formData = new FormData(form);
  const startDate = String(formData.get("start_date") || "");
  const endDate = String(formData.get("end_date") || "");
  const resolution = String(formData.get("resolution") || "daily");
  const fileFormat = String(formData.get("format") || "csv");
  const stationValue = String(formData.get("station") || "");

  if (!startDate || !endDate) throw new Error("Choose both start and end dates.");
  if (endDate < startDate) throw new Error("End date must be on or after start date.");

  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    resolution,
    format: fileFormat,
  });
  let platform = "";
  let stationId = "";
  if (stationValue) {
    [platform, stationId] = stationValue.split("::");
    const selectedStation = stationDropdown?.getSelected?.();
    if (platform) params.set("platform", platform);
    if (stationId) params.set("station_id", stationId);
    if (selectedStation?.label) params.set("station_name", selectedStation.label);
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = `Preparing ${fileFormat.toUpperCase()}...`;
  try {
    const base = apiBase();
    let downloaded = false;

    if (base) {
      try {
        const response = await authorizedFetch(`/api/history/export?${params.toString()}`);
        if (response.ok) {
          const blob = await response.blob();
          const disposition = response.headers.get("Content-Disposition") || "";
          const match = disposition.match(/filename="?([^";]+)"?/i);
          const selectedStation = stationDropdown?.getSelected?.();
          const scope = stationValue ? (selectedStation?.label || "selected-site") : "all-sites";
          const safeScope = scope
            .normalize("NFKD")
            .replace(/[^A-Za-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "history";
          const now = new Date();
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Jakarta",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).formatToParts(now);
          const part = (type) => parts.find((item) => item.type === type)?.value || "00";
          const exportedStamp = `${part("year")}-${part("month")}-${part("day")}_${part("hour")}-${part("minute")}-WIB`;
          const fallbackFilename = `PLTS-History_${safeScope}_${resolution}_${startDate}_to_${endDate}_Exported-${exportedStamp}.${fileFormat}`;
          const filename = match?.[1] || fallbackFilename;
          const url = URL.createObjectURL(blob);
          const anchor = el("a", { href: url, download: filename });
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          downloaded = true;
        }
      } catch (backendErr) {
        console.warn("Backend export failed, attempting direct Supabase fallback:", backendErr);
      }
    }

    if (!downloaded) {
      const selectedStation = stationDropdown?.getSelected?.();
      const scope = stationValue ? (selectedStation?.label || "selected-site") : "all-sites";
      const safeScope = scope
        .normalize("NFKD")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "history";

      await exportDirectFromSupabase({
        startDate,
        endDate,
        resolution,
        platform,
        stationId,
        safeScope,
        fileFormat,
      });
    }
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function mountHeaderTrigger(trigger) {
  const slot = document.querySelector("#top-nav-export-slot");
  const controls = document.querySelector(".top-nav-controls");
  const hasSession = Boolean(readSession()?.access_token);

  if ((!slot && !controls) || !hasSession) {
    trigger.hidden = true;
    return;
  }

  if (slot) {
    if (trigger.parentElement !== slot) {
      slot.appendChild(trigger);
    }
    trigger.hidden = false;
    return;
  }

  if (controls) {
    const logoutButton = controls.querySelector(".logout-icon-btn, .logout-button");
    if (trigger.parentElement !== controls || (logoutButton && trigger.nextElementSibling !== logoutButton)) {
      if (logoutButton) {
        controls.insertBefore(trigger, logoutButton);
      } else {
        controls.appendChild(trigger);
      }
    }
    trigger.hidden = false;
  }
}

function buildWidget() {
  if (document.querySelector("#history-export-root")) return;
  const dates = defaultDates();
  const root = el("div", { id: "history-export-root" });
  const trigger = el("button", {
    type: "button",
    className: "history-export-trigger",
    title: "Download history",
    "aria-label": "Download history",
    "aria-haspopup": "dialog",
  });
  trigger.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 17v3h14v-3" />
    </svg>
  `;

  const modal = el("div", {
    className: "history-export-modal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "history-export-title",
    hidden: "",
  });
  const backdrop = el("button", { type: "button", className: "history-export-backdrop", "aria-label": "Close download history" });
  const panel = el("section", { className: "history-export-panel" });
  const head = el("div", { className: "history-export-head" }, [
    el("div", {}, [
      el("span", { className: "history-export-eyebrow", text: "Historical data" }),
      el("h2", { id: "history-export-title", text: "Download history" }),
    ]),
  ]);
  const close = el("button", { type: "button", className: "history-export-close", text: "Close" });
  head.append(close);

  const form = el("form", { className: "history-export-form" });
  const stationDropdown = createDropdown({
    name: "station",
    ariaLabel: "Select site",
    options: [{ value: "", label: "All sites", meta: "Fleet" }],
  });
  const startPicker = createDatePicker({ name: "start_date", value: dates.start, ariaLabel: "Select start date" });
  const endPicker = createDatePicker({ name: "end_date", value: dates.end, ariaLabel: "Select end date" });
  const resolutionDropdown = createDropdown({
    name: "resolution",
    value: "daily",
    ariaLabel: "Select history resolution",
    options: [
      { value: "daily", label: "Daily", meta: "Long-term rollup" },
      { value: "hourly", label: "Hourly snapshots", meta: "Up to 1 year" },
    ],
  });
  const formatDropdown = createDropdown({
    name: "format",
    value: "csv",
    ariaLabel: "Select download format",
    options: [
      { value: "csv", label: "CSV (.csv)", meta: "Universal spreadsheet format" },
      { value: "xlsx", label: "Excel (.xlsx)", meta: "Formatted workbook" },
    ],
  });

  form.append(
    field("Site", stationDropdown.node),
    el("div", { className: "history-export-date-grid" }, [
      field("From", startPicker.node, "history-date-field"),
      field("To", endPicker.node, "history-date-field"),
    ]),
    field("Resolution", resolutionDropdown.node),
    field("Format", formatDropdown.node),
    el("p", {
      className: "history-export-note",
      text: "Choose Excel (.xlsx) for a formatted workbook or CSV for a lightweight universal file. Filenames include the selected site scope, date range, and export time in WIB.",
    }),
  );

  const error = el("div", { id: "history-export-error", className: "history-export-error", role: "alert", hidden: "" });
  const submit = el("button", { type: "submit", className: "history-export-submit", text: "Download history" });
  form.append(error, submit);
  panel.append(head, form);
  modal.append(backdrop, panel);
  root.append(modal);
  document.body.append(root);

  trigger.addEventListener("click", () => openModal(modal, stationDropdown));
  backdrop.addEventListener("click", () => closeModal(modal));
  close.addEventListener("click", () => closeModal(modal));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await download(form, submit, stationDropdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  });
  document.addEventListener("click", (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const clickedInsideControl = path.some((node) => (
      node instanceof Element && node.classList.contains("history-field-control")
    ));
    if (!clickedInsideControl) closePopovers();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openPopover = document.querySelector(".history-popover.open");
    if (openPopover) closePopovers();
    else if (!modal.hidden) closeModal(modal);
  });

  const syncTrigger = () => mountHeaderTrigger(trigger);
  const observer = new MutationObserver(syncTrigger);
  observer.observe(document.querySelector("#root") || document.body, { childList: true, subtree: true });
  window.addEventListener("storage", syncTrigger);
  syncTrigger();
  window.setInterval(syncTrigger, 1500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", buildWidget, { once: true });
} else {
  buildWidget();
}
