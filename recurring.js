const API_BASE_URL = "https://routepilot-recurring-api-awaphxaqf0hmexdp.eastus-01.azurewebsites.net";
const DESTINATIONS_ENDPOINT = "https://dispatch.azurewebsites.net/api/get_destinations_AL";
const RECURRING_ORDERS_ENDPOINT = `${API_BASE_URL}/api/recurring-orders-AL`;
const GENERATED_HISTORY_ENDPOINT = `${API_BASE_URL}/api/recurring-orders-AL/history`;
const IMPORT_ENDPOINT = `${API_BASE_URL}/api/recurring-orders-AL/import`;
const REORDER_ENDPOINT = `${API_BASE_URL}/api/recurring-orders-AL/reorder`;

const weekdayLabels = { MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" };
const weekdayOrder = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

const salesContacts = {
  Austin: "jallman@streamlinesci.com; tguajardo@streamlinesci.com",
  Houston: "jallman@streamlinesci.com"
};

let allRecurringOrders = [];
let allDestinations = [];
let editingRecurringOrderId = null;
let previewImportRows = [];

const demoOrders = [
  {
    id: "demo-1", name: "UAB Morning Pickup", hospitalName: "UAB Hospital", address: "1802 6th Ave S, Birmingham, AL",
    recipientName: "Receiving", recipientPhone: "", salesTeam: "Austin", driverTeamName: "Alabama", driverName: "John Driver",
    routeName: "Monday AM Route", stopSequence: 1, recurrenceType: "weekly", recurrenceDays: ["MO", "WE", "FR"],
    startDate: "2026-06-01", active: true, pickupTask: true, completeAfter: "08:00", completeBefore: "10:00",
    notes: "Demo record shown until backend endpoint is available.", scheduled: true
  },
  {
    id: "demo-2", name: "Clinic Dropoff", hospitalName: "South Clinic", address: "100 Medical Center Dr, Birmingham, AL",
    recipientName: "Front Desk", salesTeam: "Houston", driverTeamName: "Alabama", driverName: "John Driver",
    routeName: "Monday AM Route", stopSequence: 2, recurrenceType: "weekly", recurrenceDays: ["MO"],
    startDate: "2026-06-01", active: true, pickupTask: false, completeAfter: "10:00", completeBefore: "12:00"
  },
  {
    id: "demo-3", name: "Lab Supply Stop", hospitalName: "Lab Services", address: "200 Lab Way, Birmingham, AL",
    salesTeam: "Austin", driverTeamName: "Alabama", driverName: "Maria Driver", routeName: "Tuesday Lab Route",
    stopSequence: 1, recurrenceType: "weekly", recurrenceDays: ["TU"], startDate: "2026-06-01", active: false,
    pickupTask: true, completeAfter: "09:00", completeBefore: "11:30", supplies: true
  }
];

function $(id) { return document.getElementById(id); }

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

function showStatus(message, type = "info") {
  const box = $("status-message");
  box.textContent = message;
  box.className = `status-message ${type}`;
  box.style.display = "block";
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => { box.style.display = "none"; }, 7000);
}

function normalizedKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]+/g, "")
    .replace(/[()]/g, "");
}

function valueFrom(row, candidates) {
  const map = new Map(Object.keys(row).map(key => [normalizedKey(key), row[key]]));
  for (const candidate of candidates) {
    const value = map.get(normalizedKey(candidate));
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function truthyCell(value) {
  if (value === true) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return ["true", "yes", "y", "1", "scheduled", "x"].includes(text);
}

function toTime(value) {
  if (!value) return "";
  if (typeof value === "number") {
    const totalMinutes = Math.round(value * 24 * 60);
    const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const text = String(value).trim();
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  return text;
}

function getSelectedWeekdays() {
  return Array.from(document.querySelectorAll('input[name="weekday"]:checked')).map(item => item.value);
}

function setSelectedWeekdays(days = []) {
  document.querySelectorAll('input[name="weekday"]').forEach(item => { item.checked = days.includes(item.value); });
}

function getOrderId(order) { return order.id || order.recurringOrderId || order.recurring_order_id; }
function isActive(order) { return order.active !== false && order.active !== 0; }
function getDays(order) {
  const days = order.recurrenceDays || order.recurrence_days || [];
  return Array.isArray(days) ? days : String(days).split(",").map(d => d.trim()).filter(Boolean);
}
function getDriver(order) { return order.driverName || order.driver || "Unassigned"; }
function getSequence(order) { return Number(order.stopSequence || order.stop_sequence || 999); }

function buildPayload() {
  return {
    name: $("recurrence-name").value.trim(),
    active: $("active-status").value === "true",
    routeName: $("route-name").value.trim(),
    hospitalName: $("hospital-name").value.trim(),
    address: $("destination-address").value.trim(),
    recipientName: $("recipient-name").value.trim(),
    recipientPhone: $("recipient-phone").value.trim(),
    salesTeam: $("sales-team").value,
    salesNotes: $("sales-notes").value.trim(),
    driverTeamName: $("driver-team").value,
    driverName: $("driver-input").value.trim(),
    stopSequence: Number($("stop-sequence").value || 1),
    recurrenceType: $("recurrence-type").value,
    recurrenceDays: getSelectedWeekdays(),
    monthlyDay: $("monthly-day").value ? Number($("monthly-day").value) : null,
    startDate: $("start-date").value,
    endDate: $("end-date").value || null,
    pickupTask: $("task-type").value === "pickup",
    completeAfter: $("complete-after").value || null,
    completeBefore: $("complete-before").value || null,
    notes: $("task-detail").value.trim(),
    addon: $("opt-addon").checked,
    scheduled: $("opt-scheduled").checked,
    statRun: $("opt-statRun").checked,
    supplies: $("opt-supplies").checked
  };
}

function validatePayload(payload) {
  if (!payload.name || !payload.hospitalName || !payload.address || !payload.driverName || !payload.startDate) return "Please complete required fields.";
  if (payload.recurrenceType === "weekly" && payload.recurrenceDays.length === 0) return "Please select at least one weekday.";
  if (payload.recurrenceType === "monthly" && !payload.monthlyDay) return "Please enter day of month.";
  return null;
}

async function saveRecurringOrder(event) {
  event.preventDefault();
  const payload = buildPayload();
  const validationError = validatePayload(payload);
  if (validationError) { showStatus(validationError, "error"); return; }

  const method = editingRecurringOrderId ? "PUT" : "POST";
  const url = editingRecurringOrderId ? `${RECURRING_ORDERS_ENDPOINT}/${editingRecurringOrderId}` : RECURRING_ORDERS_ENDPOINT;

  try {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || "Backend save failed.");
    showStatus(editingRecurringOrderId ? "Recurring stop updated." : "Recurring stop saved.", "success");
    clearForm();
    await loadRecurringOrders();
  } catch (error) {
    showStatus(`Backend not ready or save failed: ${error.message}. Showing frontend only.`, "error");
  }
}

function clearForm() {
  editingRecurringOrderId = null;
  $("recurring-form").reset();
  $("active-status").value = "true";
  $("recurrence-type").value = "weekly";
  $("stop-sequence").value = 1;
  $("start-date").value = new Date().toISOString().slice(0, 10);
  updateRecurrenceFields();
  $("save-recurring-btn").textContent = "Save Recurring Stop";
}

async function loadDestinations() {
  try {
    const response = await fetch(DESTINATIONS_ENDPOINT);
    const data = await response.json();
    allDestinations = Array.isArray(data) ? data : (data.destinations || []);
  } catch (error) {
    allDestinations = [];
  }
  populateDestinationDatalists();
  populateDriverLists();
}

function populateDestinationDatalists() {
  const hospitals = new Set();
  const addresses = new Set();
  allDestinations.forEach(d => {
    if (d.Hospital || d.hospitalName || d.name) hospitals.add(d.Hospital || d.hospitalName || d.name);
    if (d.Address || d.address || d.destinationAddress) addresses.add(d.Address || d.address || d.destinationAddress);
  });
  $("hospital-name-list").innerHTML = Array.from(hospitals).map(v => `<option value="${escapeHtml(v)}"></option>`).join("");
  $("destination-address-list").innerHTML = Array.from(addresses).map(v => `<option value="${escapeHtml(v)}"></option>`).join("");
}

function populateDriverLists() {
  const teamSelect = $("driver-team");
  const driverList = $("driver-list");
  const teams = new Set(["Alabama"]);
  const drivers = new Set();
  allDestinations.forEach(d => {
    if (d.Team || d.team || d.driverTeamName) teams.add(d.Team || d.team || d.driverTeamName);
    if (d.Driver || d.driver || d.driverName) drivers.add(d.Driver || d.driver || d.driverName);
  });
  allRecurringOrders.forEach(o => { if (o.driverTeamName) teams.add(o.driverTeamName); if (getDriver(o) !== "Unassigned") drivers.add(getDriver(o)); });
  teamSelect.innerHTML = '<option value="">Select Driver Team</option>' + Array.from(teams).sort().map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  driverList.innerHTML = Array.from(drivers).sort().map(d => `<option value="${escapeHtml(d)}"></option>`).join("");
}

async function loadRecurringOrders() {
  try {
    const response = await fetch(RECURRING_ORDERS_ENDPOINT);
    const data = await response.json();
    if (!response.ok) throw new Error("Recurring API unavailable");
    allRecurringOrders = Array.isArray(data) ? data : (data.orders || data.recurringOrders || []);
  } catch (error) {
    allRecurringOrders = demoOrders;
    showStatus("Backend recurring-order API is not connected yet. Showing demo records for layout testing.", "info");
  }
  populateDriverFilter();
  populateDriverLists();
  renderAll();
}

function populateDriverFilter() {
  const drivers = new Set(allRecurringOrders.map(getDriver));
  $("driver-filter").innerHTML = '<option value="all">All Drivers</option>' + Array.from(drivers).sort().map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
}

function filteredOrders() {
  const day = $("weekday-filter").value;
  const driver = $("driver-filter").value;
  const status = $("status-filter").value;
  const search = $("order-search").value.trim().toLowerCase();
  return allRecurringOrders.filter(order => {
    const days = getDays(order);
    const statusOk = status === "all" || (status === "active" && isActive(order)) || (status === "paused" && !isActive(order));
    const dayOk = day === "all" || order.recurrenceType === "daily" || days.includes(day);
    const driverOk = driver === "all" || getDriver(order) === driver;
    const searchText = [order.name, order.hospitalName, order.address, order.routeName, getDriver(order), order.salesTeam].join(" ").toLowerCase();
    return statusOk && dayOk && driverOk && (!search || searchText.includes(search));
  });
}

function renderAll() {
  renderMetrics();
  renderRouteBoard();
  renderFlatTable();
}

function renderMetrics() {
  const active = allRecurringOrders.filter(isActive).length;
  const paused = allRecurringOrders.length - active;
  const drivers = new Set(allRecurringOrders.map(getDriver)).size;
  const todayCode = weekdayOrder[(new Date().getDay() + 6) % 7];
  const today = allRecurringOrders.filter(o => isActive(o) && (o.recurrenceType === "daily" || getDays(o).includes(todayCode))).length;
  $("metric-active").textContent = active;
  $("metric-paused").textContent = paused;
  $("metric-drivers").textContent = drivers;
  $("metric-today").textContent = today;
}

function renderRouteBoard() {
  const board = $("route-sequence-board");
  const orders = filteredOrders().sort((a, b) => (weekdayOrder.indexOf(getDays(a)[0]) - weekdayOrder.indexOf(getDays(b)[0])) || getDriver(a).localeCompare(getDriver(b)) || getSequence(a) - getSequence(b));
  if (orders.length === 0) { board.innerHTML = '<div class="empty-card">No matching recurring stops.</div>'; return; }

  const groups = new Map();
  orders.forEach(order => {
    const days = order.recurrenceType === "daily" ? weekdayOrder : getDays(order);
    days.forEach(day => {
      if ($("weekday-filter").value !== "all" && $("weekday-filter").value !== day && order.recurrenceType !== "daily") return;
      const key = `${day}|${getDriver(order)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
    });
  });

  board.innerHTML = Array.from(groups.entries()).map(([key, groupOrders]) => {
    const [day, driver] = key.split("|");
    groupOrders.sort((a, b) => getSequence(a) - getSequence(b));
    return `<div class="driver-route-card">
      <div class="driver-route-header"><strong>${weekdayLabels[day] || day}</strong><span>${escapeHtml(driver)}</span></div>
      <div class="stop-list">
        ${groupOrders.map(order => `<div class="route-stop ${isActive(order) ? "" : "paused-stop"}">
          <div class="stop-number">${getSequence(order)}</div>
          <div class="stop-main">
            <strong>${escapeHtml(order.name || order.hospitalName || "Unnamed stop")}</strong>
            <span>${escapeHtml(order.hospitalName || "")}</span>
            <small>${escapeHtml(order.address || "")}</small>
            <small>${escapeHtml(order.completeAfter || "")}${order.completeAfter || order.completeBefore ? " - " : ""}${escapeHtml(order.completeBefore || "")}</small>
          </div>
          <div class="stop-actions">
            <button type="button" class="mini-btn" onclick="moveOrder('${getOrderId(order)}', -1)">↑</button>
            <button type="button" class="mini-btn" onclick="moveOrder('${getOrderId(order)}', 1)">↓</button>
            <button type="button" class="mini-btn" onclick="editOrder('${getOrderId(order)}')">Edit</button>
            <button type="button" class="mini-btn" onclick="toggleOrder('${getOrderId(order)}')">${isActive(order) ? "Pause" : "Resume"}</button>
          </div>
        </div>`).join("")}
      </div>
    </div>`;
  }).join("");
}

function renderFlatTable() {
  const body = $("recurring-orders-body");
  const orders = filteredOrders().sort((a, b) => getDriver(a).localeCompare(getDriver(b)) || getSequence(a) - getSequence(b));
  if (orders.length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="empty-cell">No recurring orders loaded yet.</td></tr>';
    return;
  }
  body.innerHTML = orders.map(order => `
    <tr>
      <td>${escapeHtml(getDays(order).map(d => weekdayLabels[d] || d).join(", ") || order.recurrenceType)}</td>
      <td>${escapeHtml(getDriver(order))}</td>
      <td>${getSequence(order)}</td>
      <td><strong>${escapeHtml(order.name || "")}</strong><br><span class="muted-text">${escapeHtml(order.hospitalName || "")}</span></td>
      <td>${escapeHtml(order.completeAfter || "")}${order.completeAfter || order.completeBefore ? " - " : ""}${escapeHtml(order.completeBefore || "")}</td>
      <td><span class="status-pill ${isActive(order) ? "active" : "paused"}">${isActive(order) ? "Active" : "Paused"}</span></td>
      <td><button type="button" class="mini-btn" onclick="editOrder('${getOrderId(order)}')">Edit</button> <button type="button" class="mini-btn" onclick="toggleOrder('${getOrderId(order)}')">${isActive(order) ? "Pause" : "Resume"}</button></td>
    </tr>`).join("");
}

function editOrder(id) {
  const order = allRecurringOrders.find(o => String(getOrderId(o)) === String(id));
  if (!order) return;
  editingRecurringOrderId = id;
  $("recurrence-name").value = order.name || "";
  $("active-status").value = isActive(order) ? "true" : "false";
  $("route-name").value = order.routeName || "";
  $("hospital-name").value = order.hospitalName || "";
  $("destination-address").value = order.address || "";
  $("recipient-name").value = order.recipientName || "";
  $("recipient-phone").value = order.recipientPhone || "";
  $("sales-team").value = order.salesTeam || "";
  $("sales-notes").value = order.salesNotes || "";
  $("driver-team").value = order.driverTeamName || "";
  $("driver-input").value = getDriver(order) === "Unassigned" ? "" : getDriver(order);
  $("stop-sequence").value = getSequence(order);
  $("recurrence-type").value = order.recurrenceType || "weekly";
  setSelectedWeekdays(getDays(order));
  $("monthly-day").value = order.monthlyDay || "";
  $("start-date").value = order.startDate || "";
  $("end-date").value = order.endDate || "";
  $("task-type").value = order.pickupTask === false ? "dropoff" : "pickup";
  $("complete-after").value = order.completeAfter || "";
  $("complete-before").value = order.completeBefore || "";
  $("task-detail").value = order.notes || "";
  $("opt-addon").checked = !!order.addon;
  $("opt-scheduled").checked = !!order.scheduled;
  $("opt-statRun").checked = !!order.statRun;
  $("opt-supplies").checked = !!order.supplies;
  $("save-recurring-btn").textContent = "Update Recurring Stop";
  updateRecurrenceFields();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function toggleOrder(id) {
  const order = allRecurringOrders.find(o => String(getOrderId(o)) === String(id));
  if (!order) return;
  const newActive = !isActive(order);
  try {
    const response = await fetch(`${RECURRING_ORDERS_ENDPOINT}/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: newActive })
    });
    if (!response.ok) throw new Error("Status API unavailable");
    await loadRecurringOrders();
  } catch (error) {
    order.active = newActive;
    showStatus("Backend status API not connected yet. Updated demo state only.", "info");
    renderAll();
  }
}

async function moveOrder(id, direction) {
  const order = allRecurringOrders.find(o => String(getOrderId(o)) === String(id));
  if (!order) return;
  const day = getDays(order)[0] || "MO";
  const driver = getDriver(order);
  const group = allRecurringOrders
    .filter(o => getDriver(o) === driver && (o.recurrenceType === "daily" || getDays(o).includes(day)))
    .sort((a, b) => getSequence(a) - getSequence(b));
  const index = group.findIndex(o => String(getOrderId(o)) === String(id));
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= group.length) return;
  const currentSeq = getSequence(group[index]);
  const targetSeq = getSequence(group[targetIndex]);
  group[index].stopSequence = targetSeq;
  group[targetIndex].stopSequence = currentSeq;

  try {
    await fetch(REORDER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekday: day, driverName: driver, orders: group.map(o => ({ id: getOrderId(o), stopSequence: getSequence(o) })) })
    });
  } catch (error) {
    showStatus("Backend reorder API not connected yet. Reordered demo state only.", "info");
  }
  renderAll();
}

function updateRecurrenceFields() {
  const type = $("recurrence-type").value;
  $("weekly-days-block").style.display = type === "weekly" ? "block" : "none";
  $("monthly-day-block").style.display = type === "monthly" ? "block" : "none";
}

function previewPayload() {
  const payload = buildPayload();
  $("payload-preview").textContent = JSON.stringify(payload, null, 2);
  $("payload-modal").style.display = "flex";
}

function downloadTemplate() {
  const headers = ["Stop_Order", "Driver", "Quantity", "Team", "Recipient_Name", "Recipient_Phone", "Address_Line1", "Address_Line2", "City/Town", "State/Province", "Postal_Code", "Note", "DestNote", "Pickup", "completeAfter", "completeBefore", "Scheduled", "Stat Run", "Supplies"];
  const csv = headers.join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "recurring_route_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') { cell += '"'; i++; }
    else if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (cell || row.length) { row.push(cell); rows.push(row); }
      cell = ""; row = [];
      if (char === "\r" && next === "\n") i++;
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

function readRouteFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split(".").pop().toLowerCase();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Cannot read file."));
    if (ext === "csv") {
      reader.onload = e => resolve(parseCsv(e.target.result));
      reader.readAsText(file);
    } else if (["xlsx", "xls"].includes(ext)) {
      reader.onload = e => {
        if (typeof XLSX === "undefined") {
          reject(new Error("Excel parser did not load. Check internet connection for SheetJS CDN."));
          return;
        }
        const workbook = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(firstSheet, { defval: "" }));
      };
      reader.readAsArrayBuffer(file);
    } else {
      reject(new Error("Please upload .xlsx, .xls, or .csv."));
    }
  });
}

function buildAddress(row) {
  return [
    valueFrom(row, ["Address_Line1", "Address Line 1", "Address1"]),
    valueFrom(row, ["Address_Line2", "Address Line 2", "Address2"]),
    valueFrom(row, ["City/Town", "City", "Town"]),
    valueFrom(row, ["State/Province", "State", "Province"]),
    valueFrom(row, ["Postal_Code", "Postal Code", "Zip", "ZipCode"])
  ].filter(Boolean).join(", ");
}

function normalizeImportRows(rawRows) {
  const weekday = $("import-weekday").value;
  const useRowOrder = $("use-row-order").checked;
  const onlyScheduled = $("only-scheduled").checked;
  const counters = new Map();

  return rawRows.map((row, rowIndex) => {
    const driverName = String(valueFrom(row, ["Driver", "driverName", "Driver Name"])).trim() || "Unassigned";
    const routeName = String(valueFrom(row, ["Quantity", "Route Name", "Route_Name", "Route"])).trim();
    const groupKey = `${weekday}|${driverName}|${routeName}`;
    counters.set(groupKey, (counters.get(groupKey) || 0) + 1);
    const explicitOrder = Number(valueFrom(row, ["Stop_Order", "Stop Order", "stop_sequence", "Sequence", "Order"]));
    const stopSequence = Number.isFinite(explicitOrder) && explicitOrder > 0 ? explicitOrder : (useRowOrder ? counters.get(groupKey) : rowIndex + 1);
    const scheduledCell = valueFrom(row, ["Scheduled", "Schedule"]);
    const scheduled = scheduledCell === "" ? true : truthyCell(scheduledCell);
    const pickupCell = valueFrom(row, ["Pickup", "pickupTask", "Task Type"]);
    const pickupTask = pickupCell === "" ? true : truthyCell(pickupCell) || String(pickupCell).toLowerCase().includes("pickup");
    const recipientName = String(valueFrom(row, ["Recipient_Name", "Recipient Name", "Name"])).trim();
    const hospitalName = String(valueFrom(row, ["DestNote", "Hospital", "Hospital Name", "Lab", "Lab Name", "Merchant"])).trim() || recipientName || routeName;
    const notes = [
      valueFrom(row, ["Note", "Task_Details", "Task Details"]),
      valueFrom(row, ["DestNote", "Destination Note"])
    ].filter(Boolean).join(" | ");
    return {
      sourceRowNumber: rowIndex + 2,
      name: hospitalName || `Imported Stop ${rowIndex + 1}`,
      active: scheduled,
      routeName,
      quantity: routeName,
      hospitalName,
      address: buildAddress(row),
      recipientName,
      recipientPhone: String(valueFrom(row, ["Recipient_Phone", "Recipient Phone", "Phone"])).trim(),
      salesTeam: "",
      driverTeamName: String(valueFrom(row, ["Team", "Driver Team"])).trim(),
      driverName,
      stopSequence,
      recurrenceType: "weekly",
      recurrenceDays: [weekday],
      startDate: new Date().toISOString().slice(0, 10),
      endDate: null,
      pickupTask,
      completeAfter: toTime(valueFrom(row, ["completeAfter", "Complete After", "After"])),
      completeBefore: toTime(valueFrom(row, ["completeBefore", "Complete Before", "Before"])),
      notes,
      addon: truthyCell(valueFrom(row, ["Addon", "Add On"])),
      scheduled,
      statRun: truthyCell(valueFrom(row, ["Stat Run", "StatRun"])),
      supplies: truthyCell(valueFrom(row, ["Supplies"])),
      raw: row
    };
  }).filter(row => !onlyScheduled || row.scheduled);
}

function renderImportPreview() {
  const body = $("import-preview-body");
  const wrap = $("import-preview-wrap");
  if (!previewImportRows.length) {
    wrap.style.display = "none";
    $("import-summary").textContent = "No rows to preview.";
    return;
  }
  wrap.style.display = "block";
  const drivers = new Set(previewImportRows.map(r => r.driverName));
  $("import-summary").textContent = `${previewImportRows.length} stops ready to import across ${drivers.size} driver(s). Stop order uses Stop_Order when present; otherwise row order within weekday + driver + Quantity.`;
  body.innerHTML = previewImportRows.slice(0, 200).map(row => `
    <tr>
      <td>${escapeHtml(weekdayLabels[row.recurrenceDays[0]] || row.recurrenceDays[0])}</td>
      <td>${escapeHtml(row.driverName)}</td>
      <td>${escapeHtml(row.routeName)}</td>
      <td>${escapeHtml(row.stopSequence)}</td>
      <td>${escapeHtml(row.recipientName || row.hospitalName)}</td>
      <td>${escapeHtml(row.recipientPhone)}</td>
      <td>${escapeHtml(row.address)}</td>
      <td>${escapeHtml(row.driverTeamName)}</td>
      <td>${row.scheduled ? "Yes" : "No"}</td>
      <td>${row.pickupTask ? "Pickup" : "Dropoff"}</td>
    </tr>`).join("");
}

async function previewRouteFile() {
  const file = $("route-file").files[0];
  if (!file) { showStatus("Please select a route Excel or CSV file first.", "error"); return; }
  try {
    const rawRows = await readRouteFile(file);
    previewImportRows = normalizeImportRows(rawRows);
    renderImportPreview();
    showStatus("File preview created. Review the table before importing.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  }
}

async function importPreviewedRows() {
  if (!previewImportRows.length) {
    await previewRouteFile();
    if (!previewImportRows.length) return;
  }
  try {
    const response = await fetch(IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekday: $("import-weekday").value, rows: previewImportRows })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || "Import API unavailable");
    showStatus(`Imported ${previewImportRows.length} recurring stops.`, "success");
    await loadRecurringOrders();
  } catch (error) {
    showStatus(`Backend import API is not connected yet. Preview is ready, but rows were not saved. ${error.message}`, "error");
  }
}

async function loadGeneratedHistory() {
  try {
    const response = await fetch(GENERATED_HISTORY_ENDPOINT);
    const data = await response.json();
    const rows = Array.isArray(data) ? data : (data.history || []);
    const body = $("generated-history-body");
    if (!rows.length) return;
    body.innerHTML = rows.map(row => `<tr>
      <td>${escapeHtml(row.scheduledDate || row.date || "")}</td>
      <td>${escapeHtml(row.driverName || row.driver || "")}</td>
      <td>${escapeHtml(row.name || row.recurringStopName || "")}</td>
      <td>${escapeHtml(row.shortId || row.onfleetShortId || "")}</td>
      <td>${escapeHtml(row.status || "")}</td>
      <td>${escapeHtml(row.errorMessage || "")}</td>
    </tr>`).join("");
  } catch (error) {
    // History endpoint is optional for the frontend prototype.
  }
}

function setupEvents() {
  $("recurring-form").addEventListener("submit", saveRecurringOrder);
  $("clear-form-btn").addEventListener("click", clearForm);
  $("preview-payload-btn").addEventListener("click", previewPayload);
  $("close-modal-btn").addEventListener("click", () => { $("payload-modal").style.display = "none"; });
  $("recurrence-type").addEventListener("change", updateRecurrenceFields);
  $("sales-team").addEventListener("change", () => { $("sales-notes").value = salesContacts[$("sales-team").value] || ""; });
  $("download-template-btn").addEventListener("click", downloadTemplate);
  $("preview-route-btn").addEventListener("click", previewRouteFile);
  $("upload-route-btn").addEventListener("click", importPreviewedRows);
  $("route-file").addEventListener("change", () => { previewImportRows = []; $("import-preview-wrap").style.display = "none"; $("import-summary").textContent = ""; });
  ["weekday-filter", "driver-filter", "status-filter", "order-search"].forEach(id => $(id).addEventListener("input", renderAll));
  $("refresh-orders-btn").addEventListener("click", loadRecurringOrders);
}

document.addEventListener("DOMContentLoaded", async () => {
  setupEvents();
  clearForm();
  await loadDestinations();
  await loadRecurringOrders();
  await loadGeneratedHistory();
});
