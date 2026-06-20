"use strict";

const $ = (sel) => document.querySelector(sel);

async function getJSON(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function fields() {
  return {
    name: $("#name").value.trim(),
    apiBaseUrl: $("#apiBaseUrl").value.trim(),
    tokenUrl: $("#tokenUrl").value.trim(),
    clientId: $("#clientId").value.trim(),
    clientSecret: $("#clientSecret").value.trim(),
  };
}

function setStatus(kind, message) {
  const el = $("#formStatus");
  if (!message) {
    el.className = "status hidden";
    el.textContent = "";
    return;
  }
  el.className = `status ${kind}`;
  el.textContent = message;
}

function formatRoleChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return "";
  return checks.map((c) => `${c.role}: ${c.status}`).join("; ");
}

// Any edit invalidates a previous successful test → must re-test before saving.
function invalidateTest() {
  $("#saveBtn").disabled = true;
  setStatus("", "");
}

// --- Service-key JSON parsing --------------------------------------------

// Recursively search an object for the first value of a given key (case-insensitive).
function findKey(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === key) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findKey(v, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function applyServiceKey(json) {
  const url = findKey(json, "url");
  const tokenurl = findKey(json, "tokenurl");
  const clientid = findKey(json, "clientid");
  const clientsecret = findKey(json, "clientsecret");

  if (url) $("#apiBaseUrl").value = String(url);
  if (tokenurl) $("#tokenUrl").value = String(tokenurl);
  if (clientid) $("#clientId").value = String(clientid);
  if (clientsecret) $("#clientSecret").value = String(clientsecret);

  // Suggest a name from the tenant subdomain if empty.
  if (!$("#name").value && url) {
    try {
      $("#name").value = new URL(String(url)).hostname.split(".")[0];
    } catch {
      /* ignore */
    }
  }

  const missing = ["url", "tokenurl", "clientid", "clientsecret"].filter(
    (k) => !findKey(json, k),
  );
  if (missing.length) {
    setStatus("err", `JSON loaded, but these fields were not found: ${missing.join(", ")}. Fill them manually.`);
  } else {
    setStatus("ok", "Service key loaded into the form. Click “Test connection”.");
  }
}

async function handleFile(file) {
  if (!file) return;
  $("#fileName").textContent = file.name;
  invalidateTest();
  try {
    const text = await file.text();
    applyServiceKey(JSON.parse(text));
  } catch (err) {
    setStatus("err", `Could not read JSON: ${err.message}`);
  }
}

// --- Test & save ----------------------------------------------------------

async function testConnection() {
  const f = fields();
  if (!f.apiBaseUrl || !f.tokenUrl || !f.clientId || !f.clientSecret) {
    setStatus("err", "Please fill API Base URL, Token URL, Client ID and Client Secret.");
    return;
  }
  setStatus("", "");
  $("#testBtn").disabled = true;
  $("#testBtn").textContent = "Testing…";
  try {
    const result = await getJSON("/api/connections/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    if (result.ok) {
      const roles = formatRoleChecks(result.roleChecks);
      setStatus(
        "ok",
        `Connection successful → ${result.apiBaseUrl}.` +
          (roles ? ` Role probes: ${roles}.` : "") +
          " You can save it now.",
      );
      $("#saveBtn").disabled = false;
    } else {
      setStatus("err", `Connection failed: ${result.error}`);
      $("#saveBtn").disabled = true;
    }
  } catch (err) {
    setStatus("err", `Test failed: ${err.message}`);
  } finally {
    $("#testBtn").disabled = false;
    $("#testBtn").textContent = "Test connection";
  }
}

async function saveConnection() {
  const f = fields();
  $("#saveBtn").disabled = true;
  try {
    await getJSON("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    setStatus("ok", "Connection saved.");
    $("#connForm").reset();
    $("#fileName").textContent = "";
    await loadConnections();
  } catch (err) {
    setStatus("err", `Could not save: ${err.message}`);
    $("#saveBtn").disabled = false;
  }
}

// --- Saved connections list ----------------------------------------------

async function loadConnections() {
  const list = $("#connList");
  try {
    const conns = await getJSON("/api/connections");
    $("#connCount").textContent = conns.length;
    if (!conns.length) {
      list.innerHTML = `<p class="empty">No connections yet. Add one below.</p>`;
      return;
    }
    list.innerHTML = conns
      .map(
        (c) => `
        <div class="conn-card">
          <div class="conn-info">
            <div class="conn-name">${escapeHtml(c.name)}</div>
            <div class="conn-url mono">${escapeHtml(c.apiBaseUrl)}</div>
          </div>
          <div class="conn-actions">
            <a class="btn primary" href="dashboard.html?conn=${encodeURIComponent(c.id)}">Open</a>
            <button class="btn ghost del" data-id="${c.id}">Delete</button>
          </div>
        </div>`,
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<p class="empty">Could not load connections: ${escapeHtml(err.message)}</p>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

// --- Event wiring ---------------------------------------------------------

$("#browseBtn").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", (e) => handleFile(e.target.files[0]));

const dropZone = $("#dropZone");
["dragover", "dragenter"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("drag");
  }),
);
["dragleave", "drop"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag");
  }),
);
dropZone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

$("#connForm").addEventListener("input", invalidateTest);
$("#testBtn").addEventListener("click", testConnection);
$("#saveBtn").addEventListener("click", saveConnection);

document.addEventListener("click", async (e) => {
  const del = e.target.closest(".del");
  if (del && confirm("Delete this connection?")) {
    try {
      await getJSON(`/api/connections/${encodeURIComponent(del.dataset.id)}`, { method: "DELETE" });
      await loadConnections();
    } catch (err) {
      alert(`Could not delete: ${err.message}`);
    }
  }
});

// --- Init -----------------------------------------------------------------

loadConnections();
