require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BOOKINGS_FILE)) fs.writeFileSync(BOOKINGS_FILE, "[]", "utf8");

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https://images.pexels.com", "https://*.pexels.com", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: "30kb" }));
app.use(express.urlencoded({ extended: false, limit: "30kb" }));
app.use(session({
  name: "bn.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const bookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false });

function readBookings() {
  try { return JSON.parse(fs.readFileSync(BOOKINGS_FILE, "utf8")); }
  catch { return []; }
}
function writeBookings(items) {
  const temp = BOOKINGS_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(items, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, BOOKINGS_FILE);
}
function clean(value, max = 500) {
  return String(value ?? "").trim().replace(/[<>]/g, "").slice(0, max);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}
function smtpReady() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM);
}
function transporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  return res.status(401).json({ error: "Please sign in to the admin area." });
}
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }));

app.get("/api/health", (_req, res) => res.json({ ok: true, emailConfigured: smtpReady() }));

app.post("/api/bookings", bookingLimiter, async (req, res) => {
  // Honeypot field helps block basic bot submissions.
  if (clean(req.body.website, 200)) return res.json({ ok: true, message: "Request received." });

  const b = {
    id: "BN-" + crypto.randomBytes(4).toString("hex").toUpperCase(),
    createdAt: new Date().toISOString(),
    status: "New",
    requestType: clean(req.body.requestType, 40),
    fullName: clean(req.body.fullName, 100),
    studentNumber: clean(req.body.studentNumber, 40),
    phone: clean(req.body.phone, 30),
    email: clean(req.body.email, 150).toLowerCase(),
    campus: clean(req.body.campus, 100),
    startDate: clean(req.body.startDate, 20),
    endDate: clean(req.body.endDate, 20),
    items: Array.isArray(req.body.items) ? req.body.items.map(x => clean(x, 80)).slice(0, 12) : [],
    quantities: clean(req.body.quantities, 300),
    fridgeNeeded: req.body.fridgeNeeded === true || req.body.fridgeNeeded === "yes",
    payment: clean(req.body.payment, 50),
    notes: clean(req.body.notes, 1500),
    consent: req.body.consent === true || req.body.consent === "on"
  };

  const errors = [];
  if (!b.fullName) errors.push("Enter your full name.");
  if (!/^[+0-9()\-\s]{7,25}$/.test(b.phone)) errors.push("Enter a valid phone or WhatsApp number.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) errors.push("Enter a valid email address.");
  if (!b.campus) errors.push("Enter your campus or institution.");
  if (!b.startDate || !b.endDate) errors.push("Choose both storage dates.");
  if (b.startDate && b.endDate && b.endDate < b.startDate) errors.push("The end date must be on or after the start date.");
  if (!b.items.length) errors.push("Choose at least one type of item.");
  if (!b.consent) errors.push("Please confirm that you agree to be contacted about this request.");
  if (!["Storage booking", "Quote request", "Both"].includes(b.requestType)) errors.push("Choose a request type.");
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });

  const bookings = readBookings();
  bookings.unshift(b);
  writeBookings(bookings);

  let emailSent = false;
  if (smtpReady()) {
    const itemList = b.items.join(", ");
    const body = [
      `New B&N Storage request: ${b.id}`,
      `Request type: ${b.requestType}`,
      `Name: ${b.fullName}`,
      `Student number: ${b.studentNumber || "Not supplied"}`,
      `Phone/WhatsApp: ${b.phone}`,
      `Email: ${b.email}`,
      `Campus: ${b.campus}`,
      `Storage dates: ${b.startDate} to ${b.endDate}`,
      `Items: ${itemList}`,
      `Quantities/details: ${b.quantities || "Not supplied"}`,
      `Fridge storage requested: ${b.fridgeNeeded ? "Yes (subject to availability)" : "No"}`,
      `Payment preference: ${b.payment || "Discuss with business"}`,
      `Notes: ${b.notes || "None"}`,
      "",
      "Please contact the student to confirm availability, final price and any deposit. This request is not yet a confirmed booking."
    ].join("\n");
    try {
      await transporter().sendMail({
        from: process.env.MAIL_FROM,
        to: process.env.BOOKING_EMAIL || "nkosinathipolite325@gmail.com",
        replyTo: b.email,
        subject: `[B&N Storage] ${b.requestType} ${b.id} — ${b.fullName}`,
        text: body
      });
      emailSent = true;
    } catch (err) {
      console.error("Email send failed:", err.message);
    }
  }

  res.status(201).json({
    ok: true,
    id: b.id,
    emailSent,
    message: emailSent
      ? "Your request has been sent. B&N Storage will contact you to confirm availability, pricing and deposit details."
      : "Your request has been saved, but the email service is not configured or could not send the message. Please contact B&N Storage by WhatsApp and quote reference " + b.id + "."
  });
});

app.get("/admin", (_req, res) => res.sendFile(path.join(ROOT, "public", "admin.html")));
app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const username = clean(req.body.username, 100);
  const password = String(req.body.password || "");
  const expectedUser = process.env.ADMIN_USERNAME || "admin";
  const expectedPassword= process.env.ADMIN_PASSWORD|| "Ntando@123";
  if ( username !== expectedUser ||password !==expectedPassword) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start a secure session." });
    req.session.admin = true;
    res.json({ ok: true });
  });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
app.get("/api/admin/session", (req, res) => res.json({ authenticated: req.session?.admin === true }));
app.get("/api/admin/bookings", requireAdmin, (_req, res) => {
  res.json({ bookings: readBookings() });
});
app.patch("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  const allowed = ["New", "Contacted", "Deposit pending", "Confirmed", "Completed", "Cancelled"];
  const status = clean(req.body.status, 40);
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid booking status." });
  const bookings = readBookings();
  const index = bookings.findIndex(b => b.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Booking not found." });
  bookings[index].status = status;
  bookings[index].updatedAt = new Date().toISOString();
  writeBookings(bookings);
  res.json({ ok: true, booking: bookings[index] });
});
app.get("/api/admin/export.csv", requireAdmin, (_req, res) => {
  const bookings = readBookings();
  const fields = ["id","createdAt","status","requestType","fullName","studentNumber","phone","email","campus","startDate","endDate","items","quantities","fridgeNeeded","payment","notes"];
  const cell = v => `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
  const csv = [fields.join(","), ...bookings.map(b => fields.map(f => cell(b[f])).join(","))].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="bn-storage-bookings.csv"');
  res.send(csv);
});

app.listen(PORT, () => {
  console.log(`B&N Storage running at http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD_HASH) console.warn("Admin disabled until ADMIN_PASSWORD_HASH is set in .env.");
  if (!smtpReady()) console.warn("Email is not configured yet. Booking requests are saved locally but will not be emailed.");
});
