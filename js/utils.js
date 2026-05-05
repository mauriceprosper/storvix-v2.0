// ============================================================
//  STORVIX — Shared Utilities (js/utils.js)
//  Pure JS helpers — no Firebase imports.
// ============================================================

// ── Currency ─────────────────────────────────────────────────
export function fmt(amount) {
  const n = Number(amount) || 0;
  return "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Fee Calculator ───────────────────────────────────────────
export function calculateTotal(subtotal, deliveryFee = 0) {
  const fee = (subtotal + deliveryFee) >= 2500 ? 100 : 0;
  const total = subtotal + deliveryFee + fee;
  return { subtotal, deliveryFee, fee, total };
}

// ── Toast ────────────────────────────────────────────────────
let _toastTimer = null;
export function toast(message, type = "info", duration = 3500) {
  let el = document.getElementById("storvix-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "storvix-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast-show toast-${type}`;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ""; }, duration);
}

// ── Slug ─────────────────────────────────────────────────────
export function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── URL ──────────────────────────────────────────────────────
export function storeUrl(slug) { return `https://${slug}.storvix.ng`; }
export function getParam(name) { return new URLSearchParams(window.location.search).get(name); }

// ── Button State ─────────────────────────────────────────────
export function btnLoading(btn, on, defaultText) {
  if (!btn) return;
  if (on) {
    btn.dataset.orig = btn.textContent;
    btn.textContent = "Please wait…";
    btn.disabled = true;
    btn.classList.add("btn-loading");
  } else {
    btn.textContent = defaultText || btn.dataset.orig || "Submit";
    btn.disabled = false;
    btn.classList.remove("btn-loading");
  }
}

// ── Time ─────────────────────────────────────────────────────
export function timeAgo(date) {
  if (!date) return "";
  const d = date?.toDate ? date.toDate() : new Date(date);
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

export function fmtDate(date, opts = {}) {
  if (!date) return "—";
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", ...opts });
}

// ── IDs ──────────────────────────────────────────────────────
export function generateOrderNumber() { return "STX-" + Date.now().toString(36).toUpperCase().slice(-6); }
export function shortRef(len = 6) { return Math.random().toString(36).substring(2, 2 + len).toUpperCase(); }

// ── Debounce ─────────────────────────────────────────────────
export function debounce(fn, delay = 400) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ── Clipboard ────────────────────────────────────────────────
export async function copyToClipboard(text, msg = "Copied!") {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg, "success");
  } catch {
    const ta = Object.assign(document.createElement("textarea"), {
      value: text, style: "position:fixed;opacity:0"
    });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast(msg, "success");
  }
}

// ── Phone ────────────────────────────────────────────────────
export function normalisePhone(phone) {
  let p = phone.replace(/\s+/g, "").replace(/[^\d+]/g, "");
  if (p.startsWith("0"))   p = "+234" + p.slice(1);
  if (p.startsWith("234")) p = "+" + p;
  return p;
}

export function isValidPhone(phone) {
  const c = phone.replace(/\D/g, "");
  return c.length === 11 || c.length === 13;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Modal ────────────────────────────────────────────────────
export function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("open");
  document.body.style.overflow = "hidden";
}
export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("open");
  document.body.style.overflow = "";
}
export function bindModalClose(id) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", (e) => { if (e.target === el) closeModal(id); });
}

// ── Accent Color ─────────────────────────────────────────────
export function applyAccent(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const dk = (c) => Math.max(0, Math.floor(c * 0.8));
  const lt = (c) => Math.min(255, Math.floor(c + (255-c) * 0.9));
  const h = (c) => c.toString(16).padStart(2,"0");
  const root = document.documentElement;
  root.style.setProperty("--accent",       hex);
  root.style.setProperty("--accent-dark",  `#${h(dk(r))}${h(dk(g))}${h(dk(b))}`);
  root.style.setProperty("--accent-light", `#${h(lt(r))}${h(lt(g))}${h(lt(b))}`);
}

// ── Badges ───────────────────────────────────────────────────
export function statusBadge(status) {
  const map = {
    pending:   ["badge-orange", "Pending"],
    confirmed: ["badge-blue",   "Confirmed"],
    shipped:   ["badge-purple", "Shipped"],
    delivered: ["badge-green",  "Delivered"],
    cancelled: ["badge-red",    "Cancelled"],
  };
  const [cls, label] = map[status] || ["badge-gray", status];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function planBadge(plan) {
  const map = {
    lite:  ["badge-gray",   "Lite"],
    basic: ["badge-blue",   "Basic"],
    plus:  ["badge-purple", "Plus"],
    pro:   ["badge-amber",  "Pro"],
  };
  const [cls, label] = map[plan] || ["badge-gray", plan];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ── File Reader ──────────────────────────────────────────────
export function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error("File read failed"));
    r.readAsDataURL(file);
  });
}

// ── Nigerian Data ────────────────────────────────────────────
export const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue",
  "Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT",
  "Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi",
  "Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo",
  "Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara",
];

export const NIGERIAN_BANKS = [
  { name: "Access Bank",                 code: "044" },
  { name: "Access Bank (Diamond)",        code: "063" },
  { name: "Citibank Nigeria",             code: "023" },
  { name: "EcoBank Nigeria",              code: "050" },
  { name: "Fidelity Bank",               code: "070" },
  { name: "First Bank of Nigeria",        code: "011" },
  { name: "First City Monument Bank",     code: "214" },
  { name: "Guaranty Trust Bank",          code: "058" },
  { name: "Heritage Bank",               code: "030" },
  { name: "Keystone Bank",               code: "082" },
  { name: "Kuda Bank",                   code: "90267" },
  { name: "Moniepoint MFB",              code: "50515" },
  { name: "OPay Digital Services",        code: "100004" },
  { name: "Palmpay",                     code: "100033" },
  { name: "Polaris Bank",                code: "076" },
  { name: "Providus Bank",               code: "101" },
  { name: "Stanbic IBTC Bank",           code: "221" },
  { name: "Standard Chartered Bank",      code: "068" },
  { name: "Sterling Bank",               code: "232" },
  { name: "Union Bank of Nigeria",        code: "032" },
  { name: "United Bank for Africa",       code: "033" },
  { name: "Unity Bank",                  code: "215" },
  { name: "VFD Microfinance Bank",        code: "566" },
  { name: "Wema Bank",                   code: "035" },
  { name: "Zenith Bank",                 code: "057" },
];

export const PRODUCT_CATEGORIES = [
  "Fashion","Bags & Accessories","Beauty","Home & Decor","Electronics",
  "Books & Media","Health & Wellness","Gifts & Crafts","Kids & Baby","Sports","Other",
];

// ── Live bank list from Paystack ──────────────────────────────
// Cached in localStorage for 24h. Falls back to the static list if Paystack is unreachable.
let _bankCache = null;
const _BANK_CACHE_KEY = "storvix_banks_v1";
const _BANK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function getLiveBanks(callListBanksFn) {
  if (_bankCache) return _bankCache;

  // Try localStorage cache
  try {
    const raw = localStorage.getItem(_BANK_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.t && (Date.now() - parsed.t) < _BANK_CACHE_TTL && Array.isArray(parsed.banks)) {
        _bankCache = parsed.banks;
        return parsed.banks;
      }
    }
  } catch { /* ignore corrupt cache */ }

  // Fetch fresh
  try {
    const res = await callListBanksFn();
    const banks = res?.data?.banks;
    if (Array.isArray(banks) && banks.length) {
      _bankCache = banks;
      try {
        localStorage.setItem(_BANK_CACHE_KEY, JSON.stringify({ t: Date.now(), banks }));
      } catch { /* localStorage full or disabled */ }
      return banks;
    }
  } catch (err) {
    console.warn("Live banks fetch failed, using static list:", err.message);
  }

  // Last-resort fallback
  return NIGERIAN_BANKS;
}
