require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_MB = Math.max(1, Math.min(Number(process.env.MAX_FILE_MB || 102400), 102400));
const REGISTRATION_CODE = String(process.env.REGISTRATION_CODE || "13931363");
const ROOT = __dirname;
const STORAGE = path.join(ROOT, "storage");
const UPLOADS = path.join(STORAGE, "uploads");
const FILES_DB = path.join(STORAGE, "files.json");
const USERS_DB = path.join(STORAGE, "users.json");
const SESSION_COOKIE = "filenex_session";
const sessions = new Map();
const deletedSessions = new Set();
const revokedAdminSessions = new Set();

if (!process.env.ADMIN_UPLOAD_CODE || process.env.ADMIN_UPLOAD_CODE.length < 16 || process.env.ADMIN_UPLOAD_CODE.startsWith("replace-this")) {
  console.error("ERROR: Set a strong ADMIN_UPLOAD_CODE in .env (at least 16 characters)."); process.exit(1);
}
if (!process.env.FILE_CODE_SECRET || process.env.FILE_CODE_SECRET.length < 32 || process.env.FILE_CODE_SECRET.startsWith("replace-this")) {
  console.error("ERROR: Set a random FILE_CODE_SECRET in .env (at least 32 characters)."); process.exit(1);
}

fs.mkdirSync(UPLOADS, { recursive: true });
if (!fs.existsSync(FILES_DB)) fs.writeFileSync(FILES_DB, "[]", { flag: "wx" });
if (!fs.existsSync(USERS_DB)) fs.writeFileSync(USERS_DB, "[]", { flag: "wx" });

function readJson(file, label) {
  try { const value = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(value) ? value : []; }
  catch { throw new Error(`Could not read ${label}.`); }
}
function readFiles() { return readJson(FILES_DB, "storage/files.json"); }
function writeFiles(files) { writeJson(FILES_DB, files); }
function readUsers() { return readJson(USERS_DB, "storage/users.json"); }
function writeUsers(users) { writeJson(USERS_DB, users); }
function writeJson(file, value) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || "")); const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function createCode() { return crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 8); }
function allowedFile(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  return new Set([".pdf", ".txt", ".md", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp3", ".wav", ".ogg", ".mp4", ".webm", ".mov", ".zip", ".rar", ".7z", ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"]).has(ext);
}
function cleanName(name) { return path.basename(String(name || "file")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "file"; }
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString("hex") };
}
function verifyPassword(password, user) {
  const candidate = crypto.scryptSync(String(password), user.salt, 64); const expected = Buffer.from(user.passwordHash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
function getCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) { const index = part.indexOf("="); if (index < 0) continue; if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim()); }
  return "";
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}
function clearSessionCookie(res) { res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); }
function sessionFor(req) {
  const token = getCookie(req, SESSION_COOKIE); if (!token) return null;
  if (deletedSessions.has(token)) return { deleted: true, token };
  if (revokedAdminSessions.has(token)) return { adminRevoked: true, token };
  const session = sessions.get(token); if (!session) return null;
  if (session.role === "user") {
    const user = readUsers().find(u => u.id === session.userId);
    if (!user) return { deleted: true, token };
    return { ...session, token, user };
  }
  return { ...session, token };
}
function requireUser(req, res, next) {
  const session = sessionFor(req);
  if (session?.deleted) return res.status(410).json({ error: "شما دوست پرهام حذف شدید", deleted: true });
  if (!session || session.role !== "user") return res.status(401).json({ error: "ابتدا وارد حساب کاربری شو." });
  req.userSession = session; next();
}
function requireAdmin(req, res, next) {
  const session = sessionFor(req);
  if (session?.adminRevoked) return res.status(410).json({ error: "دسترسی مدیر لغو شد.", adminRevoked: true });
  if (!session || session.role !== "admin") return res.status(401).json({ error: "برای ورود به بخش مدیر، کد مدیر را وارد کن." });
  req.adminSession = session; next();
}

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", "data:"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"] } } }));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(ROOT, "public"), { index: "index.html" }));
const searchLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "درخواست‌های زیادی ارسال شده. کمی بعد دوباره امتحان کن." } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "تلاش‌های زیادی انجام شد. کمی بعد دوباره امتحان کن." } });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "تعداد آپلودها زیاد است. یک ساعت دیگر دوباره امتحان کن." } });
const diskStorage = multer.diskStorage({ destination: (_req, _file, cb) => cb(null, UPLOADS), filename: (_req, _file, cb) => cb(null, crypto.randomBytes(24).toString("hex")) });
const upload = multer({ storage: diskStorage, limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1, fields: 3, fieldSize: 2000 }, fileFilter: (_req, file, cb) => allowedFile(file.originalname) ? cb(null, true) : cb(new Error("این نوع فایل مجاز نیست.")) });

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "FileNex" }));
app.get("/api/config", (_req, res) => res.json({ maxFileMB: MAX_FILE_MB, registrationCodeRequired: true }));

app.post("/api/register", authLimiter, (req, res) => {
  const username = String(req.body.username || "").trim(); const password = String(req.body.password || ""); const registrationCode = String(req.body.registrationCode || "");
  if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(username)) return res.status(400).json({ error: "نام کاربری باید ۳ تا ۲۴ حرف یا عدد باشد." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "رمز عبور باید حداقل ۸ کاراکتر باشد." });
  if (!safeEqual(registrationCode, REGISTRATION_CODE)) return res.status(403).json({ error: "کد ساخت حساب اشتباه است." });
  const users = readUsers(); if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: "این نام کاربری قبلاً گرفته شده است." });
  const credentials = hashPassword(password); const user = { id: crypto.randomUUID(), username, salt: credentials.salt, passwordHash: credentials.hash, createdAt: new Date().toISOString() };
  users.push(user); writeUsers(users);
  const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, { role: "user", userId: user.id, sessionId: crypto.randomUUID(), createdAt: new Date().toISOString() }); setSessionCookie(res, token);
  res.status(201).json({ message: "حساب ساخته شد.", user: { id: user.id, username: user.username, createdAt: user.createdAt } });
});
app.post("/api/login", authLimiter, (req, res) => {
  const username = String(req.body.username || "").trim(); const password = String(req.body.password || "");
  const user = readUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user)) return res.status(401).json({ error: "نام کاربری یا رمز عبور اشتباه است." });
  const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, { role: "user", userId: user.id, sessionId: crypto.randomUUID(), createdAt: new Date().toISOString() }); setSessionCookie(res, token);
  res.json({ message: "وارد حساب شدی.", user: { id: user.id, username: user.username, createdAt: user.createdAt } });
});
app.post("/api/admin/login", authLimiter, (req, res) => {
  if (!safeEqual(req.body.adminCode, process.env.ADMIN_UPLOAD_CODE)) return res.status(403).json({ error: "کد مدیر اشتباه است." });
  const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, { role: "admin", sessionId: crypto.randomUUID(), createdAt: new Date().toISOString() }); setSessionCookie(res, token);
  res.json({ message: "ورود مدیر موفق بود." });
});
app.get("/api/me", (req, res) => {
  const session = sessionFor(req);
  if (session?.deleted) return res.status(410).json({ error: "شما دوست پرهام حذف شدید", deleted: true });
  if (session?.adminRevoked) return res.status(410).json({ error: "دسترسی مدیر لغو شد.", adminRevoked: true });
  if (!session) return res.status(401).json({ error: "وارد نشده‌ای." });
  if (session.role === "admin") return res.json({ role: "admin", createdAt: session.createdAt });
  res.json({ role: "user", user: { id: session.user.id, username: session.user.username, createdAt: session.user.createdAt } });
});
app.post("/api/logout", (req, res) => { const token = getCookie(req, SESSION_COOKIE); if (token) { sessions.delete(token); deletedSessions.delete(token); revokedAdminSessions.delete(token); } clearSessionCookie(res); res.json({ message: "خارج شدی." }); });

app.get("/api/user/summary", requireUser, (req, res) => {
  const files = readFiles(); res.json({ username: req.userSession.user.username, createdAt: req.userSession.user.createdAt, totalFiles: files.length, maxFileMB: MAX_FILE_MB });
});
app.get("/api/admin/summary", requireAdmin, (_req, res) => {
  const admins = [...sessions.entries()].filter(([, s]) => s.role === "admin");
  res.json({ users: readUsers().length, files: readFiles().length, activeAdmins: admins.length, maxFileMB: MAX_FILE_MB, storageUsed: readFiles().reduce((sum, f) => sum + (Number(f.size) || 0), 0) });
});
app.get("/api/admin/users", requireAdmin, (_req, res) => { const users = readUsers(); res.json({ count: users.length, users: users.map(u => ({ id: u.id, username: u.username, createdAt: u.createdAt })) }); });
app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const users = readUsers(); const target = users.find(u => u.id === req.params.id); if (!target) return res.status(404).json({ error: "این حساب پیدا نشد." });
  writeUsers(users.filter(u => u.id !== target.id));
  for (const [token, session] of sessions.entries()) if (session.role === "user" && session.userId === target.id) { sessions.delete(token); deletedSessions.add(token); }
  res.json({ message: `حساب ${target.username} حذف شد.` });
});
app.get("/api/admin/admins", requireAdmin, (req, res) => {
  const currentSessionId = req.adminSession.sessionId;
  const admins = [...sessions.entries()].filter(([, s]) => s.role === "admin").map(([, s], i) => ({ id: s.sessionId, label: s.sessionId === currentSessionId ? "نشست مدیر فعلی" : `مدیر فعال ${i + 1}`, createdAt: s.createdAt, current: s.sessionId === currentSessionId }));
  res.json({ count: admins.length, admins });
});
app.delete("/api/admin/admins/:id", requireAdmin, (req, res) => {
  const currentSessionId = req.adminSession.sessionId; const sessionId = String(req.params.id || "");
  if (sessionId === currentSessionId) return res.status(400).json({ error: "برای جلوگیری از قفل‌شدن پنل، نمی‌توانی نشست فعلی خودت را حذف کنی." });
  const entry = [...sessions.entries()].find(([, s]) => s.role === "admin" && s.sessionId === sessionId);
  if (!entry) return res.status(404).json({ error: "نشست مدیر پیدا نشد یا قبلاً بسته شده است." });
  const [token] = entry; sessions.delete(token); revokedAdminSessions.add(token); res.json({ message: "نشست مدیر لغو شد." });
});
app.get("/api/admin/files", requireAdmin, (_req, res) => { const files = readFiles().slice().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)); res.json({ count: files.length, files: files.map(f => ({ code: f.code, name: f.name, size: f.size, uploadedAt: f.uploadedAt, downloadUrl: `/api/download/${f.code}` })) }); });
app.delete("/api/admin/files/:code", requireAdmin, (req, res) => {
  const code = String(req.params.code || "").toUpperCase(); const files = readFiles(); const target = files.find(f => f.code === code);
  if (!target) return res.status(404).json({ error: "فایل پیدا نشد." });
  writeFiles(files.filter(f => f.code !== code)); fs.rmSync(path.join(UPLOADS, target.diskName), { force: true }); res.json({ message: "فایل حذف شد." });
});
app.get("/api/files/:code", searchLimiter, (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase(); if (!/^[A-F0-9]{8}$/.test(code)) return res.status(400).json({ error: "کد باید ۸ کاراکتر باشد." });
  const item = readFiles().find(f => f.code === code); if (!item) return res.status(404).json({ error: "فایلی با این کد پیدا نشد." });
  res.json({ file: { code: item.code, name: item.name, size: item.size, uploadedAt: item.uploadedAt, downloadUrl: `/api/download/${encodeURIComponent(item.code)}` } });
});
app.get("/api/download/:code", searchLimiter, (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase(); if (!/^[A-F0-9]{8}$/.test(code)) return res.status(400).send("Invalid file code.");
  const item = readFiles().find(f => f.code === code); if (!item) return res.status(404).send("File not found.");
  const diskPath = path.join(UPLOADS, item.diskName); if (!fs.existsSync(diskPath)) return res.status(404).send("File is no longer available.");
  res.setHeader("X-Content-Type-Options", "nosniff"); res.download(diskPath, item.name);
});
app.post("/api/upload", uploadLimiter, requireAdmin, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) { const message = err.code === "LIMIT_FILE_SIZE" ? `حجم فایل نباید بیشتر از ${MAX_FILE_MB} مگابایت باشد.` : (err.message || "آپلود ناموفق بود."); return res.status(400).json({ error: message }); }
    const uploaded = req.file;
    try {
      if (!safeEqual(req.body.adminCode, process.env.ADMIN_UPLOAD_CODE)) { if (uploaded) fs.rmSync(uploaded.path, { force: true }); return res.status(403).json({ error: "کد تأیید مدیر اشتباه است." }); }
      if (!uploaded) return res.status(400).json({ error: "یک فایل انتخاب کن." });
      const files = readFiles(); let code; do { code = createCode(); } while (files.some(f => f.code === code));
      const item = { code, name: cleanName(uploaded.originalname), diskName: uploaded.filename, size: uploaded.size, uploadedAt: new Date().toISOString() };
      files.push(item); writeFiles(files); return res.status(201).json({ message: "فایل با موفقیت ثبت شد.", file: { code: item.code, name: item.name, size: item.size, uploadedAt: item.uploadedAt, downloadUrl: `/api/download/${item.code}` } });
    } catch (e) { if (uploaded) fs.rmSync(uploaded.path, { force: true }); console.error("Upload error:", e.message); return res.status(500).json({ error: "خطای سرور هنگام ذخیره فایل." }); }
  });
});
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: "خطای غیرمنتظره سرور." }); });
app.listen(PORT, () => console.log(`FileNex running on http://localhost:${PORT}`));
