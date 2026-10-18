const loginPanel = document.querySelector("#loginPanel");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const bookingsList = document.querySelector("#bookingsList");
let allBookings = [];
const statuses = ["New", "Contacted", "Deposit pending", "Confirmed", "Completed", "Cancelled"];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function dateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString();
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
function showDashboard() { loginPanel.hidden = true; dashboard.hidden = false; loadBookings(); }
async function checkSession() {
  try { const result = await api("/api/admin/session"); if (result.authenticated) showDashboard(); }
  catch {}
}
loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginError.hidden = true;
  const data = Object.fromEntries(new FormData(loginForm).entries());
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify(data) });
    loginForm.reset();
    showDashboard();
  } catch (error) { loginError.textContent = error.message; loginError.hidden = false; }
});
async function loadBookings() {
  bookingsList.innerHTML = '<div class="empty-state">Loading requests…</div>';
  try {
    const result = await api("/api/admin/bookings");
    allBookings = result.bookings || [];
    $("#totalCount").textContent = allBookings.length;
    $("#newCount").textContent = allBookings.filter(b => b.status === "New").length;
    $("#confirmedCount").textContent = allBookings.filter(b => b.status === "Confirmed").length;
    $("#depositCount").textContent = allBookings.filter(b => b.status === "Deposit pending").length;
    renderBookings();
  } catch (error) {
    bookingsList.innerHTML = `<div class="empty-state">${esc(error.message)}. Try signing in again.</div>`;
  }
}
function renderBookings() {
  const term = ($("#searchInput").value || "").toLowerCase().trim();
  const matches = allBookings.filter(b => [b.id,b.fullName,b.phone,b.email,b.campus,b.status].join(" ").toLowerCase().includes(term));
  if (!matches.length) {
    bookingsList.innerHTML = `<div class="empty-state">${allBookings.length ? "No requests match your search." : "No storage requests yet. New submissions will appear here."}</div>`;
    return;
  }
  bookingsList.innerHTML = matches.map(b => `
    <article class="booking-record">
      <div class="record-content">
        <div class="record-top"><h3>${esc(b.fullName)}</h3><span class="record-id">${esc(b.id)}</span><span class="status-pill ${esc(b.status.toLowerCase().replaceAll(" ","-"))}">${esc(b.status)}</span></div>
        <div class="record-meta">
          <strong>${esc(b.requestType)}</strong> · Received ${dateTime(b.createdAt)}<br>
          Phone: <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a> · Email: <a href="mailto:${esc(b.email)}">${esc(b.email)}</a><br>
          Campus: ${esc(b.campus)} · Student number: ${esc(b.studentNumber || "Not supplied")}<br>
          Dates: ${esc(b.startDate)} to ${esc(b.endDate)}<br>
          Items: ${esc((b.items || []).join(", "))}<br>
          Quantity/details: ${esc(b.quantities || "Not supplied")} · Fridge requested: ${b.fridgeNeeded ? "Yes (availability to confirm)" : "No"}<br>
          Payment preference: ${esc(b.payment || "Not specified")}
        </div>
        ${b.notes ? `<div class="record-notes"><strong>Student notes:</strong> ${esc(b.notes)}</div>` : ""}
      </div>
      <div class="record-controls"><label class="field"><span>Update status</span><select data-status="${esc(b.id)}">${statuses.map(s => `<option ${b.status===s?"selected":""}>${esc(s)}</option>`).join("")}</select></label><button class="button button-dark" data-save="${esc(b.id)}">Save status</button><a class="button button-outline" href="https://wa.me/${esc(b.phone.replace(/\D/g,""))}" target="_blank" rel="noopener">WhatsApp student ↗</a></div>
    </article>`).join("");
}
bookingsList.addEventListener("click", async event => {
  const button = event.target.closest("[data-save]");
  if (!button) return;
  const id = button.dataset.save;
  const select = bookingsList.querySelector(`[data-status="${CSS.escape(id)}"]`);
  button.disabled = true;
  try {
    await api(`/api/admin/bookings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
    await loadBookings();
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
});
$("#searchInput").addEventListener("input", renderBookings);
$("#refreshButton").addEventListener("click", loadBookings);
$("#exportButton").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/admin/export.csv");
    if (!response.ok) throw new Error("Please sign in again before exporting.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "bn-storage-bookings.csv"; a.click(); URL.revokeObjectURL(url);
  } catch (error) { alert(error.message); }
});
$("#logoutButton").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST", body: "{}" }); } catch {}
  dashboard.hidden = true; loginPanel.hidden = false;
});
function $(selector) { return document.querySelector(selector); }
checkSession();