const $ = (id) => document.getElementById(id);
const accountPanel = $("accountPanel");
const adminLoginPanel = $("adminLoginPanel");
const userDashboard = $("userDashboard");
const adminDashboard = $("adminDashboard");
const searchResult = $("searchResult");
const uploadResult = $("uploadResult");
const fileInput = $("fileInput");
let maxFileBytes = 100 * 1024 * 1024;
let currentRole = null;
let currentUsername = "";
let deletedNoticeShown = false;
let adminRevokedNoticeShown = false;
const RECENT_KEY = "filenex_recent_codes_v1";

function showResult(element, message, kind = "error", html = false) {
  if (!element) return;
  element.className = `result ${kind}`;
  if (html) element.innerHTML = message; else element.textContent = message;
}
function hideResult(element) { if (!element) return; element.className = "result hidden"; element.textContent = ""; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} بایت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} کیلوبایت`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} مگابایت`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} گیگابایت`;
}
function formatDate(date) {
  try { return new Date(date).toLocaleDateString("fa-IR", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return "—"; }
}
function resultCard(file, heading) {
  const safeName = escapeHtml(file.name); const safeCode = escapeHtml(file.code); const safeUrl = `/api/download/${encodeURIComponent(file.code)}`;
  return `<strong>${escapeHtml(heading)}</strong><div>${safeName}</div><div>حجم: ${formatSize(file.size)}</div><div class="code-line"><span>${safeCode}</span><button class="copy-btn" type="button" data-copy="${safeCode}">کپی کد</button></div><p><a class="download-link" href="${safeUrl}" download>دانلود فایل ←</a></p>`;
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  let data = {}; try { data = await response.json(); } catch { data = {}; }
  if (response.status === 410 && data.deleted) { showDeletedNotice(); throw new Error("شما دوست پرهام حذف شدید"); }
  if (response.status === 410 && data.adminRevoked) { showAdminRevokedNotice(); throw new Error("دسترسی مدیر لغو شد."); }
  if (!response.ok) throw new Error(data.error || "درخواست انجام نشد.");
  return data;
}
function showGlobalNotice(message, deleted = false) {
  const notice = $("globalNotice"); notice.className = `notice${deleted ? " deleted" : ""}`; notice.textContent = message;
  notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function hideAllWorkspaces() {
  accountPanel.classList.add("hidden"); adminLoginPanel.classList.add("hidden"); userDashboard.classList.add("hidden"); adminDashboard.classList.add("hidden");
}
function showDeletedNotice() {
  if (deletedNoticeShown) return; deletedNoticeShown = true; currentRole = null; currentUsername = ""; hideAllWorkspaces();
  showGlobalNotice("شما دوست پرهام حذف شدید", true); $("openAccount").textContent = "ورود / ثبت‌نام";
}
function showAdminRevokedNotice() {
  if (adminRevokedNoticeShown) return; adminRevokedNoticeShown = true; currentRole = null; hideAllWorkspaces(); showGlobalNotice("دسترسی مدیر لغو شد. برای ادامه، دوباره وارد شو.", true);
}
function updateAccountStatus(role, username = "") {
  currentRole = role; currentUsername = username;
  $("openAccount").textContent = role === "user" ? `حساب: ${username}` : "ورود / ثبت‌نام";
}
function setAccountMode(mode) {
  $("registerForm").classList.toggle("hidden", mode !== "register"); $("loginForm").classList.toggle("hidden", mode !== "login");
  $("showRegister").classList.toggle("active", mode === "register"); $("showLogin").classList.toggle("active", mode === "login"); hideResult($("accountResult"));
}
function openAccountPanel(mode = "login") {
  hideAllWorkspaces(); accountPanel.classList.remove("hidden"); setAccountMode(mode); accountPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}
function showUserDashboard(user) {
  deletedNoticeShown = false;
  updateAccountStatus("user", user.username); hideAllWorkspaces(); userDashboard.classList.remove("hidden");
  $("userNameTitle").textContent = user.username; $("userMetricName").textContent = user.username; $("userMetricDate").textContent = formatDate(user.createdAt);
  loadUserSummary(); renderRecentSearches(); userDashboard.scrollIntoView({ behavior: "smooth", block: "start" });
}
function showAdminDashboard() {
  updateAccountStatus("admin"); hideAllWorkspaces(); adminDashboard.classList.remove("hidden");
  selectAdminTab("overview"); refreshAdminSummary(); adminDashboard.scrollIntoView({ behavior: "smooth", block: "start" });
}
function getRecentSearches() {
  try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(value) ? value.slice(0, 8) : []; } catch { return []; }
}
function saveRecentSearch(code, name = "") {
  const recent = getRecentSearches().filter(item => item.code !== code);
  recent.unshift({ code, name, at: new Date().toISOString() });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 8))); } catch {}
  renderRecentSearches();
}
function renderRecentSearches() {
  const list = $("recentSearches"); if (!list) return; list.replaceChildren(); const items = getRecentSearches();
  if (!items.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "هنوز جست‌وجویی انجام نداده‌ای."; list.appendChild(empty); return; }
  for (const item of items) {
    const row = document.createElement("div"); row.className = "recent-item";
    const left = document.createElement("div"); const code = document.createElement("button"); code.type = "button"; code.textContent = item.code; code.addEventListener("click", () => searchFile(item.code, $("userSearchResult"), true));
    const name = document.createElement("small"); name.textContent = item.name || formatDate(item.at); left.append(code, name); row.append(left);
    const open = document.createElement("a"); open.href = `/api/download/${encodeURIComponent(item.code)}`; open.textContent = "دانلود"; open.className = "recent-download"; row.append(open); list.appendChild(row);
  }
}
function selectAdminTab(name) {
  document.querySelectorAll("[data-admin-tab]").forEach(button => button.classList.toggle("active", button.dataset.adminTab === name));
  document.querySelectorAll(".admin-view").forEach(view => view.classList.add("hidden"));
  const view = $(`adminView${name.charAt(0).toUpperCase()}${name.slice(1)}`); if (view) view.classList.remove("hidden");
  if (name === "users") refreshUsers(); if (name === "admins") refreshAdmins(); if (name === "files") refreshFiles();
}
async function refreshAdminSummary() {
  try {
    const data = await api("/api/admin/summary");
    $("adminUserMetric").textContent = data.users.toLocaleString("fa-IR"); $("adminFileMetric").textContent = data.files.toLocaleString("fa-IR");
    $("adminActiveMetric").textContent = data.activeAdmins.toLocaleString("fa-IR"); $("adminStorageMetric").textContent = formatSize(data.storageUsed);
    $("maxUploadLabel").textContent = `${data.maxFileMB} MB`; $("maxSize").textContent = data.maxFileMB; maxFileBytes = data.maxFileMB * 1024 * 1024;
  } catch (error) { showResult($("adminResult"), error.message); }
}
function addEmpty(list, message) { const p = document.createElement("p"); p.className = "empty-state"; p.textContent = message; list.appendChild(p); }
async function refreshUsers() {
  const list = $("usersList"); list.replaceChildren();
  try {
    const data = await api("/api/admin/users"); $("userListCount").textContent = data.count.toLocaleString("fa-IR");
    if (!data.users.length) return addEmpty(list, "هنوز هیچ کاربری ثبت‌نام نکرده است.");
    for (const user of data.users) {
      const row = document.createElement("div"); row.className = "table-row"; const avatar = document.createElement("span"); avatar.className = "row-avatar"; avatar.textContent = "♙";
      const info = document.createElement("div"); info.className = "row-info"; const name = document.createElement("strong"); name.textContent = user.username; const meta = document.createElement("small"); meta.textContent = `عضویت: ${formatDate(user.createdAt)}`; info.append(name, meta);
      const actions = document.createElement("div"); actions.className = "row-actions"; const remove = document.createElement("button"); remove.className = "danger-btn"; remove.type = "button"; remove.textContent = "حذف حساب";
      remove.addEventListener("click", async () => { if (!confirm(`حساب «${user.username}» حذف شود؟`)) return; remove.disabled = true; try { await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" }); showResult($("adminResult"), `حساب ${user.username} حذف شد. کاربر هنگام مراجعه پیام «شما دوست پرهام حذف شدید» را می‌بیند.`, "success"); await refreshUsers(); await refreshAdminSummary(); } catch (e) { showResult($("adminResult"), e.message); remove.disabled = false; } });
      actions.append(remove); row.append(avatar, info, actions); list.appendChild(row);
    }
  } catch (error) { addEmpty(list, error.message); }
}
async function refreshAdmins() {
  const list = $("adminsList"); list.replaceChildren();
  try {
    const data = await api("/api/admin/admins"); $("adminListCount").textContent = data.count.toLocaleString("fa-IR"); $("adminActiveMetric").textContent = data.count.toLocaleString("fa-IR");
    if (!data.admins.length) return addEmpty(list, "هیچ نشست مدیری فعال نیست.");
    for (const admin of data.admins) {
      const row = document.createElement("div"); row.className = "table-row"; const avatar = document.createElement("span"); avatar.className = "row-avatar"; avatar.textContent = "⚙";
      const info = document.createElement("div"); info.className = "row-info"; const name = document.createElement("strong"); name.textContent = admin.label; const meta = document.createElement("small"); meta.textContent = `شروع نشست: ${formatDate(admin.createdAt)}`; info.append(name, meta);
      const actions = document.createElement("div"); actions.className = "row-actions";
      if (admin.current) { const pill = document.createElement("span"); pill.className = "current-pill"; pill.textContent = "نشست فعلی تو"; actions.append(pill); }
      else { const remove = document.createElement("button"); remove.className = "danger-btn"; remove.type = "button"; remove.textContent = "لغو دسترسی"; remove.addEventListener("click", async () => { if (!confirm("دسترسی این نشست مدیر لغو شود؟")) return; remove.disabled = true; try { await api(`/api/admin/admins/${encodeURIComponent(admin.id)}`, { method: "DELETE" }); showResult($("adminResult"), "دسترسی نشست مدیر لغو شد.", "success"); await refreshAdmins(); await refreshAdminSummary(); } catch (e) { showResult($("adminResult"), e.message); remove.disabled = false; } }); actions.append(remove); }
      row.append(avatar, info, actions); list.appendChild(row);
    }
  } catch (error) { addEmpty(list, error.message); }
}
async function refreshFiles() {
  const list = $("filesList"); list.replaceChildren();
  try {
    const data = await api("/api/admin/files"); $("fileListCount").textContent = data.count.toLocaleString("fa-IR");
    if (!data.files.length) return addEmpty(list, "هنوز فایلی آپلود نشده است.");
    for (const file of data.files) {
      const row = document.createElement("div"); row.className = "table-row"; const avatar = document.createElement("span"); avatar.className = "row-avatar"; avatar.textContent = "▤";
      const info = document.createElement("div"); info.className = "row-info"; const name = document.createElement("strong"); name.textContent = file.name; const meta = document.createElement("small"); meta.textContent = `کد ${file.code} • ${formatSize(file.size)} • ${formatDate(file.uploadedAt)}`; info.append(name, meta);
      const actions = document.createElement("div"); actions.className = "row-actions"; const copy = document.createElement("button"); copy.className = "current-pill"; copy.type = "button"; copy.textContent = `کد: ${file.code}`; copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(file.code); copy.textContent = "کپی شد"; } catch { copy.textContent = file.code; } });
      const remove = document.createElement("button"); remove.className = "danger-btn"; remove.type = "button"; remove.textContent = "حذف فایل"; remove.addEventListener("click", async () => { if (!confirm(`فایل «${file.name}» حذف شود؟`)) return; remove.disabled = true; try { await api(`/api/admin/files/${encodeURIComponent(file.code)}`, { method: "DELETE" }); showResult($("adminResult"), "فایل حذف شد و کد آن دیگر کار نمی‌کند.", "success"); await refreshFiles(); await refreshAdminSummary(); } catch (e) { showResult($("adminResult"), e.message); remove.disabled = false; } });
      actions.append(copy, remove); row.append(avatar, info, actions); list.appendChild(row);
    }
  } catch (error) { addEmpty(list, error.message); }
}
async function loadUserSummary() {
  try { const data = await api("/api/user/summary"); $("userMetricFiles").textContent = data.totalFiles.toLocaleString("fa-IR"); $("userMetricDate").textContent = formatDate(data.createdAt); }
  catch (error) { if (error.message !== "شما دوست پرهام حذف شدید") showGlobalNotice(error.message); }
}
async function searchFile(code, target, fromHistory = false) {
  const normalized = String(code || "").trim().toUpperCase(); if (!/^[A-F0-9]{8}$/.test(normalized)) { showResult(target, "کد باید دقیقاً ۸ کاراکتر باشد."); return; }
  try { const data = await api(`/api/files/${encodeURIComponent(normalized)}`); showResult(target, resultCard(data.file, "فایل پیدا شد"), "success", true); saveRecentSearch(data.file.code, data.file.name); if (!fromHistory) $("userSearchCode").value = normalized; }
  catch (error) { showResult(target, error.message); }
}

// Copy code buttons rendered in results.
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]"); if (!button) return;
  try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = "کپی شد"; } catch { button.textContent = button.dataset.copy; }
});

$("openAccount").addEventListener("click", () => currentRole === "user" ? userDashboard.scrollIntoView({ behavior: "smooth" }) : openAccountPanel("login"));
$("heroAccount").addEventListener("click", () => currentRole === "user" ? userDashboard.scrollIntoView({ behavior: "smooth" }) : openAccountPanel("login"));
$("teaserAccount").addEventListener("click", () => currentRole === "user" ? userDashboard.scrollIntoView({ behavior: "smooth" }) : openAccountPanel("register"));
$("openAdmin").addEventListener("click", () => { if (currentRole === "admin") adminDashboard.scrollIntoView({ behavior: "smooth" }); else { hideAllWorkspaces(); adminLoginPanel.classList.remove("hidden"); adminLoginPanel.scrollIntoView({ behavior: "smooth", block: "start" }); } });
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => $(button.dataset.close).classList.add("hidden")));
$("showRegister").addEventListener("click", () => setAccountMode("register")); $("showLogin").addEventListener("click", () => setAccountMode("login"));

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { const data = await api("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: $("registerUsername").value.trim(), password: $("registerPassword").value, registrationCode: $("registrationCode").value }) }); $("registerForm").reset(); showUserDashboard(data.user); showGlobalNotice(`حساب ساخته شد. خوش آمدی، ${data.user.username}.`); }
  catch (error) { showResult($("accountResult"), error.message); } finally { button.disabled = false; }
});
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { const data = await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: $("loginUsername").value.trim(), password: $("loginPassword").value }) }); $("loginForm").reset(); showUserDashboard(data.user); showGlobalNotice(`خوش آمدی، ${data.user.username}.`); }
  catch (error) { showResult($("accountResult"), error.message); } finally { button.disabled = false; }
});
async function logout() { try { await api("/api/logout", { method: "POST" }); } catch {} currentRole = null; currentUsername = ""; hideAllWorkspaces(); $("openAccount").textContent = "ورود / ثبت‌نام"; showGlobalNotice("با موفقیت خارج شدی."); }
$("userLogout").addEventListener("click", logout); $("adminLogout").addEventListener("click", logout);

$("adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await api("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminCode: $("adminLoginCode").value }) }); $("adminLoginForm").reset(); hideResult($("adminLoginResult")); adminRevokedNoticeShown = false; showAdminDashboard(); showGlobalNotice("به داشبورد مدیریت خوش آمدی."); }
  catch (error) { showResult($("adminLoginResult"), error.message); } finally { button.disabled = false; }
});
document.querySelectorAll("[data-admin-tab]").forEach(button => button.addEventListener("click", () => selectAdminTab(button.dataset.adminTab)));
document.querySelectorAll("[data-jump-tab]").forEach(button => button.addEventListener("click", () => selectAdminTab(button.dataset.jumpTab)));

$("searchCode").addEventListener("input", event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-F0-9]/g, "").slice(0, 8); });
$("userSearchCode").addEventListener("input", event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-F0-9]/g, "").slice(0, 8); });
$("searchForm").addEventListener("submit", async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = "در حال جست‌وجو…"; await searchFile($("searchCode").value, searchResult); button.disabled = false; button.textContent = "پیدا کن ←"; });
$("userSearchForm").addEventListener("submit", async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = "در حال جست‌وجو…"; await searchFile($("userSearchCode").value, $("userSearchResult")); button.disabled = false; button.textContent = "جست‌وجو"; });
$("clearRecent").addEventListener("click", () => { try { localStorage.removeItem(RECENT_KEY); } catch {} renderRecentSearches(); });

fileInput.addEventListener("change", () => { const file = fileInput.files[0]; $("fileLabel").textContent = file ? `${file.name} — ${formatSize(file.size)}` : "برای انتخاب فایل کلیک کن"; if (file && file.size > maxFileBytes) showResult(uploadResult, `حجم فایل از حد مجاز (${formatSize(maxFileBytes)}) بیشتر است.`); else hideResult(uploadResult); });
$("uploadForm").addEventListener("submit", async event => {
  event.preventDefault(); const file = fileInput.files[0]; const adminCode = $("adminCode").value;
  if (!file) return showResult(uploadResult, "اول یک فایل انتخاب کن."); if (file.size > maxFileBytes) return showResult(uploadResult, `حجم فایل نباید بیشتر از ${formatSize(maxFileBytes)} باشد.`); if (!adminCode) return showResult(uploadResult, "کد تأیید مدیر را وارد کن.");
  const button = $("uploadButton"); button.disabled = true; button.textContent = "در حال آپلود…"; const formData = new FormData(); formData.append("file", file); formData.append("adminCode", adminCode);
  try { const response = await fetch("/api/upload", { method: "POST", body: formData, credentials: "same-origin" }); let data = {}; try { data = await response.json(); } catch {}
    if (response.status === 410 && data.adminRevoked) { showAdminRevokedNotice(); throw new Error("دسترسی مدیر لغو شد."); }
    if (!response.ok) throw new Error(data.error || "آپلود ناموفق بود."); showResult(uploadResult, resultCard(data.file, "فایل با موفقیت ثبت شد! کد را ذخیره کن."), "success", true); $("uploadForm").reset(); $("fileLabel").textContent = "برای انتخاب فایل کلیک کن"; await refreshAdminSummary();
  } catch (error) { showResult(uploadResult, error.message || "اتصال به سرور برقرار نشد."); } finally { button.disabled = false; button.textContent = "آپلود و دریافت کد ←"; }
});

async function checkSession() {
  try { const data = await api("/api/me"); if (data.role === "user" && currentRole !== "user") showUserDashboard(data.user); if (data.role === "admin" && currentRole !== "admin") showAdminDashboard(); }
  catch (error) { if (error.message === "شما دوست پرهام حذف شدید") showDeletedNotice(); }
}
fetch("/api/config").then(r => r.ok ? r.json() : null).then(data => { if (data && Number.isFinite(data.maxFileMB)) { maxFileBytes = data.maxFileMB * 1024 * 1024; $("maxSize").textContent = data.maxFileMB; $("maxUploadLabel").textContent = `${data.maxFileMB} MB`; } }).catch(() => {});
renderRecentSearches(); checkSession(); setInterval(checkSession, 5000);
