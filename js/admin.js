// ============================================================
//  STORVIX — Admin Panel (js/admin.js)
//  Self-contained Google sign-in. Locked to:
//  - usestorvix@gmail.com
//  - mauriceprosper1@gmail.com
// ============================================================

import {
  auth, db, onAuthStateChanged, isAdmin, ADMIN_EMAILS,
  collection, getDocs, collectionGroup, query, orderBy, limit, where,
  doc, updateDoc, serverTimestamp, callProcessPayout, callBackfillWallets,
  googleSignIn, logOut,
} from "./firebase-config.js";
import { fmt, toast, fmtDate, timeAgo, statusBadge, planBadge, copyToClipboard } from "./utils.js";

// ── Global ────────────────────────────────────────────────
let allSellers = [];
let allOrders  = [];
let allW       = [];

// ── DOM refs ──────────────────────────────────────────────
const loaderEl   = document.getElementById("adminLoader");
const signInEl   = document.getElementById("adminSignIn");
const layoutEl   = document.getElementById("adminLayout");
const googleBtn  = document.getElementById("adminGoogleBtn");

function showLoader()  { loaderEl.style.display = ""; signInEl.style.display = "none"; layoutEl.style.display = "none"; }
function showSignIn()  { loaderEl.style.display = "none"; signInEl.style.display = "flex"; layoutEl.style.display = "none"; }
function showAdmin()   { loaderEl.style.display = "none"; signInEl.style.display = "none"; layoutEl.style.display = ""; }

// ── Auth Gate ─────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showSignIn();
    return;
  }
  if (!isAdmin(user.email)) {
    // Not an admin — sign them out and bounce to landing
    toast("That account isn't an admin. Redirecting…", "error");
    try { await logOut(); } catch {}
    setTimeout(() => { window.location.href = "/"; }, 1200);
    return;
  }

  // Show admin email in sidebar
  const emailEl = document.getElementById("adminCurrentEmail");
  if (emailEl) emailEl.textContent = user.email;

  showAdmin();
  loadAll();
});

// ── Google Sign-in Button ─────────────────────────────────
googleBtn?.addEventListener("click", async () => {
  googleBtn.disabled = true;
  googleBtn.style.opacity = "0.7";
  try {
    await googleSignIn();
    // onAuthStateChanged above will take it from here
  } catch (e) {
    toast(e.message || "Sign-in failed.", "error");
    googleBtn.disabled = false;
    googleBtn.style.opacity = "";
  }
});

// ── Sign Out ──────────────────────────────────────────────
document.getElementById("adminSignOutBtn")?.addEventListener("click", async () => {
  try { await logOut(); } catch {}
  // onAuthStateChanged will show sign-in screen
});

// ── Tabs ──────────────────────────────────────────────────
document.querySelectorAll(".admin-nav-item[data-tab]").forEach(item => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".admin-nav-item").forEach(n => n.classList.remove("active"));
    document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
    item.classList.add("active");
    const tab = item.dataset.tab;
    document.getElementById(`adminTab-${tab}`).classList.add("active");
  });
});

// ── Load Data ─────────────────────────────────────────────
async function loadAll() {
  await Promise.all([loadSellers(), loadOrders(), loadWithdrawals()]);
  renderOverview();
}

async function loadSellers() {
  const snap = await getDocs(collection(db, "sellers"));
  allSellers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderSellers();
}

async function loadOrders() {
  try {
    const snap = await getDocs(query(collectionGroup(db, "orders"), orderBy("createdAt", "desc"), limit(100)));
    allOrders = snap.docs.map(d => ({ id: d.id, sellerId: d.ref.parent.parent.id, ...d.data() }));
  } catch {
    allOrders = [];
  }
  renderOrders();
}

async function loadWithdrawals() {
  try {
    const snap = await getDocs(query(collection(db, "withdrawals"), where("status", "==", "pending")));
    allW = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    allW = [];
  }
  renderWithdrawals();
}

// ── Overview ──────────────────────────────────────────────
function renderOverview() {
  const gmv = allOrders
    .filter(o => ["confirmed","shipped","delivered"].includes(o.status))
    .reduce((s, o) => s + (o.subtotal || 0), 0);
  document.getElementById("adminGmv").textContent          = fmt(gmv);
  document.getElementById("adminSellerCount").textContent  = allSellers.length;
  document.getElementById("adminOrderCount").textContent   = allOrders.length;
  document.getElementById("adminPendingPayouts").textContent = allW.length;
}

// ── Sellers ───────────────────────────────────────────────
function renderSellers(filter = "") {
  const body = document.getElementById("adminSellersBody");
  let list   = allSellers;
  if (filter) {
    list = list.filter(s =>
      s.storeName?.toLowerCase().includes(filter.toLowerCase()) ||
      s.email?.toLowerCase().includes(filter.toLowerCase())
    );
  }
  if (!list.length) { body.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:48px;color:var(--text-muted)">No sellers.</td></tr>`; return; }

  body.innerHTML = list.map(s => `
    <tr>
      <td>
        <div style="font-weight:600">${s.storeName || "—"}</div>
        <div style="font-size:.8125rem;color:var(--text-muted)">${s.slug}.storvix.ng</div>
      </td>
      <td>
        <div>${s.ownerName || "—"}</div>
        <div style="font-size:.8125rem;color:var(--text-muted)">${s.email}</div>
      </td>
      <td>${planBadge(s.plan || "lite")}</td>
      <td>
        ${s.suspended
          ? '<span class="badge badge-red">Suspended</span>'
          : `<span class="badge badge-${s.planStatus==="active"?"green":s.planStatus==="trial"?"blue":"orange"}">${s.planStatus || "trial"}</span>`}
      </td>
      <td>${s.orderCount || 0}</td>
      <td style="font-size:.875rem;color:var(--text-muted)">${fmtDate(s.createdAt)}</td>
      <td>
        <button class="btn btn-sm btn-${s.suspended?"success":"danger"}"
                onclick="toggleSuspend('${s.id}', ${!s.suspended})">
          ${s.suspended ? "Reactivate" : "Suspend"}
        </button>
      </td>
    </tr>`).join("");
}

document.getElementById("adminSellerSearch")?.addEventListener("input", (e) => {
  renderSellers(e.target.value);
});

window.toggleSuspend = async (sellerId, suspend) => {
  await updateDoc(doc(db, "sellers", sellerId), { suspended: suspend, updatedAt: serverTimestamp() });
  const s = allSellers.find(x => x.id === sellerId);
  if (s) s.suspended = suspend;
  renderSellers();
  toast(suspend ? "Seller suspended." : "Seller reactivated.", "success");
};

// ── Orders ────────────────────────────────────────────────
function renderOrders() {
  const body = document.getElementById("adminOrdersBody");
  if (!allOrders.length) { body.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:48px;color:var(--text-muted)">No orders.</td></tr>`; return; }

  body.innerHTML = allOrders.map(o => {
    const seller = allSellers.find(s => s.id === o.sellerId);
    return `
      <tr>
        <td style="font-family:monospace">${o.orderNumber || o.id.slice(0,8)}</td>
        <td>${seller?.storeName || "—"}</td>
        <td>${o.buyer?.name || "—"}</td>
        <td style="font-weight:600">${fmt(o.total || 0)}</td>
        <td>${statusBadge(o.status || "pending")}</td>
        <td style="font-size:.875rem;color:var(--text-muted)">${timeAgo(o.createdAt)}</td>
      </tr>`;
  }).join("");
}

// ── Withdrawals ───────────────────────────────────────────
function renderWithdrawals() {
  const body = document.getElementById("adminWithdrawalsBody");
  if (!allW.length) { body.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:48px;color:var(--text-muted)">No pending withdrawals.</td></tr>`; return; }

  body.innerHTML = allW.map(w => {
    const seller = allSellers.find(s => s.id === w.sellerId);
    return `
      <tr>
        <td>${seller?.storeName || w.sellerId.slice(0,8)}</td>
        <td style="font-weight:700">${fmt(w.amount)}</td>
        <td style="font-size:.875rem">
          <div>${w.bank?.bankName || "—"}</div>
          <div style="color:var(--text-muted)">${w.bank?.accountNumber} · ${w.bank?.accountName}</div>
        </td>
        <td><span class="badge badge-orange">Pending</span></td>
        <td style="font-size:.875rem;color:var(--text-muted)">${timeAgo(w.requestedAt)}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="processPayout('${w.id}')">Process</button>
        </td>
      </tr>`;
  }).join("");
}

window.processPayout = async (id) => {
  if (!confirm("Process this payout via Paystack?")) return;
  try {
    await callProcessPayout({ withdrawalId: id });
    toast("Payout processed!", "success");
    loadWithdrawals();
  } catch (e) {
    toast(e.message || "Failed to process payout.", "error");
  }
};

window.copyToClipboard = copyToClipboard;

// ── Backfill Wallets ──────────────────────────────────────
document.getElementById("backfillBtn")?.addEventListener("click", async () => {
  const btn  = document.getElementById("backfillBtn");
  const out  = document.getElementById("backfillResult");

  if (!confirm("Run wallet backfill? This will scan all paid orders and credit any sellers that were missed. Safe to run multiple times.")) return;

  btn.disabled = true;
  btn.textContent = "Running… (this may take a minute)";
  out.style.display = "";
  out.textContent = "Working…";

  try {
    const res = await callBackfillWallets();
    const r   = res.data;
    let txt =
      `✅ Backfill complete!\n\n` +
      `Sellers scanned:  ${r.sellersScanned}\n` +
      `Orders scanned:   ${r.ordersScanned}\n` +
      `Credits issued:   ${r.creditsIssued}\n` +
      `Already credited: ${r.skipped} (skipped)\n` +
      `Errors:           ${r.errors || 0}\n` +
      `Total credited:   ₦${(r.totalCredited || 0).toLocaleString()}\n\n`;

    if (r.perSeller?.length) {
      txt += `Per seller:\n` + r.perSeller.map(s =>
        `  • ${s.storeName || s.sellerId.slice(0,8)}: +₦${s.credited.toLocaleString()} (${s.skipped} skipped)`
      ).join("\n");
    } else {
      txt += "No new credits issued — all paid orders were already credited.";
    }

    if (r.errorDetails?.length) {
      txt += `\n\n⚠ Errors:\n` + r.errorDetails.slice(0, 10).map(e =>
        `  • ${e.sellerId.slice(0,8)}${e.orderId ? "/" + e.orderId.slice(0,8) : ""}: ${e.error}`
      ).join("\n");
    }

    out.textContent = txt;
    toast(`Backfill: ${r.creditsIssued} credits issued`, r.creditsIssued > 0 ? "success" : "info");
  } catch (e) {
    const detail = e.details?.stack || e.message || "Unknown error";
    out.textContent = `❌ Failed: ${e.message}\n\n${detail}`;
    toast("Backfill failed: " + (e.message || "Unknown error"), "error");
  }

  btn.disabled = false;
  btn.textContent = "Run Wallet Backfill";
});