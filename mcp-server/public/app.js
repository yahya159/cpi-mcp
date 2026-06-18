"use strict";

// Currently selected time window (hours). Default: last 24h.
let currentHours = 24;

// Which saved connection this dashboard targets (from ?conn=<id> in the URL).
// Empty → the server falls back to the .env tenant.
const CONN_ID = new URLSearchParams(location.search).get("conn") || "";

const $ = (sel) => document.querySelector(sel);

// Append the connection id to an API path so the server queries the right tenant.
function api(path) {
  if (!CONN_ID) return path;
  return path + (path.includes("?") ? "&" : "?") + "conn=" + encodeURIComponent(CONN_ID);
}

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function statusBadge(status) {
  const s = (status || "").toUpperCase();
  return `<span class="badge ${s}">${s || "—"}</span>`;
}

function errorButton(guid) {
  return `<button class="btn ghost view-err" data-guid="${guid}">View error</button>`;
}

function rowsFor(messages, withErrorBtn) {
  if (!messages.length) {
    return `<tr><td colspan="5" class="empty">No messages.</td></tr>`;
  }
  return messages
    .map(
      (m) => `
      <tr>
        <td>${m.iflowName || "—"}</td>
        <td>${statusBadge(m.status)}</td>
        <td>${fmtDate(m.logStart)}</td>
        <td class="mono">${m.messageGuid}</td>
        <td>${withErrorBtn && (m.status === "FAILED" || m.status === "ESCALATED") ? errorButton(m.messageGuid) : ""}</td>
      </tr>`,
    )
    .join("");
}

function renderCards(h) {
  const cards = [
    { label: "Health", value: h.healthStatus, cls: `status-${h.healthStatus}` },
    { label: "Total", value: h.totalMessages, cls: "" },
    { label: "Completed", value: h.completedMessages, cls: "accent-green" },
    { label: "Failed", value: h.failedMessages, cls: "accent-red" },
    { label: "Escalated", value: h.escalatedMessages, cls: "" },
  ];
  $("#cards").innerHTML = cards
    .map(
      (c) => `
      <div class="card ${c.cls}">
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
      </div>`,
    )
    .join("");
}

async function refresh() {
  const main = $("main");
  main.classList.add("spin");
  try {
    const [health, failed, recent] = await Promise.all([
      getJSON(api(`/api/health-summary?lastHours=${currentHours}`)),
      getJSON(api(`/api/failed?lastHours=${currentHours}&top=100`)),
      getJSON(api(`/api/recent?top=20`)),
    ]);

    renderCards(health);
    $("#failedCount").textContent = failed.length;
    $("#failedTable tbody").innerHTML = rowsFor(failed, true);
    $("#recentTable tbody").innerHTML = rowsFor(recent, true);
    showStatus("", "");
  } catch (err) {
    showStatus("err", `Could not load data: ${err.message}`);
  } finally {
    main.classList.remove("spin");
  }
}

function showStatus(kind, message) {
  const el = $("#status");
  if (!message) {
    el.className = "status hidden";
    el.textContent = "";
    return;
  }
  el.className = `status ${kind}`;
  el.textContent = message;
}

async function checkConnection() {
  try {
    const data = await getJSON(api("/api/check"));
    $("#tenant").textContent = data.baseUrl || "(tenant unknown)";
    showStatus("ok", "Connected to SAP CPI OData API.");
    setTimeout(() => showStatus("", ""), 2500);
  } catch (err) {
    $("#tenant").textContent = "Not connected";
    showStatus("err", `Connection failed: ${err.message}`);
  }
}

async function openError(guid) {
  $("#drawer").classList.remove("hidden");
  $("#errGuid").textContent = guid;
  $("#errStep").textContent = "—";
  $("#errText").textContent = "Loading…";
  try {
    const d = await getJSON(api(`/api/error/${encodeURIComponent(guid)}`));
    $("#errStep").textContent = d.lastErrorModelStepId || "—";
    $("#errText").textContent = d.errorText || "(empty)";
  } catch (err) {
    $("#errText").textContent = `Could not load error details: ${err.message}`;
  }
}

// --- Event wiring ---------------------------------------------------------

document.querySelectorAll(".btn.range").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentHours = Number(btn.dataset.hours);
    document.querySelectorAll(".btn.range").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    refresh();
  });
});

$("#refreshBtn").addEventListener("click", refresh);
$("#checkBtn").addEventListener("click", checkConnection);
$("#drawerClose").addEventListener("click", () => $("#drawer").classList.add("hidden"));
$("#drawer").addEventListener("click", (e) => {
  if (e.target.id === "drawer") $("#drawer").classList.add("hidden");
});

// Delegate "View error" buttons (tables are re-rendered).
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-err");
  if (btn) openError(btn.dataset.guid);
});

// --- Init -----------------------------------------------------------------

document.querySelector('.btn.range[data-hours="24"]').classList.add("active");
checkConnection();
refresh();
