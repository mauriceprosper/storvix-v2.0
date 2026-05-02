// ============================================================
//  STORVIX — Admin Panel (js/admin.js)
//  Self-contained Google sign-in. Locked to:
//  - usestorvix@gmail.com
//  - mauriceprosper1@gmail.com
// ============================================================

import {
  auth, db, onAuthStateChanged, isAdmin, ADMIN_EMAILS,
  collection, getDocs, collectionGroup, query, orderBy, limit, where,
  doc, updateDoc, serverTimestamp, increment,
  callProcessPayout, callBackfillWallets,
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
  window._adminEmail = user.email;

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
    const snap = await getDocs(query(collection(db, "withdrawals"), orderBy("requestedAt", "desc"), limit(100)));
    allW = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("Withdrawals load fallback (orderBy failed, retrying without):", err.message);
    try {
      const snap = await getDocs(collection(db, "withdrawals"));
      allW = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort client-side
      allW.sort((a, b) => (b.requestedAt?.toMillis?.() || 0) - (a.requestedAt?.toMillis?.() || 0));
    } catch {
      allW = [];
    }
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

  // Top-line counts
  const counts = {
    pending:   allW.filter(w => w.status === "pending").length,
    paid:      allW.filter(w => w.status === "paid").length,
    rejected:  allW.filter(w => w.status === "rejected").length,
    pendingAmount: allW.filter(w => w.status === "pending").reduce((s, w) => s + (w.amount || 0), 0),
  };

  const summaryEl = document.getElementById("withdrawalsSummary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value" style="color:#F59E0B">${counts.pending}</div><div class="stat-sub">${fmt(counts.pendingAmount)} to pay out</div></div>
      <div class="stat-card"><div class="stat-label">Paid</div><div class="stat-value" style="color:#10B981">${counts.paid}</div><div class="stat-sub">All time</div></div>
      <div class="stat-card"><div class="stat-label">Rejected</div><div class="stat-value" style="color:#EF4444">${counts.rejected}</div><div class="stat-sub">All time</div></div>`;
  }

  if (!allW.length) {
    body.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:48px;color:var(--text-muted)">No withdrawals yet.</td></tr>`;
    return;
  }

  // Filter UI updates allW visually
  const filter = document.getElementById("withdrawFilter")?.value || "all";
  const visible = filter === "all" ? allW : allW.filter(w => w.status === filter);

  body.innerHTML = visible.map(w => {
    const seller = allSellers.find(s => s.id === w.sellerId);
    const fee = w.amount - (w.netAmount || w.amount);

    let statusBadge, actions;
    if (w.status === "pending") {
      statusBadge = '<span class="badge badge-orange">Pending</span>';
      actions = `
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" onclick="markPaid('${w.id}')">Mark Paid</button>
          <button class="btn btn-sm btn-danger" onclick="rejectWithdrawal('${w.id}')">Reject</button>
        </div>`;
    } else if (w.status === "paid") {
      statusBadge = '<span class="badge badge-green">Paid</span>';
      actions = w.paidAt ? `<span style="font-size:.75rem;color:var(--text-muted)">${timeAgo(w.paidAt)}</span>` : "—";
    } else if (w.status === "rejected") {
      statusBadge = '<span class="badge badge-red">Rejected</span>';
      actions = `<button class="btn btn-sm btn-secondary" onclick="restoreWithdrawal('${w.id}')">Restore</button>`;
    } else {
      statusBadge = `<span class="badge badge-gray">${w.status}</span>`;
      actions = "—";
    }

    return `
      <tr>
        <td>
          <div style="font-weight:600">${seller?.storeName || w.sellerId.slice(0,8)}</div>
          <div style="font-size:.75rem;color:var(--text-muted)">${seller?.email || ""}</div>
        </td>
        <td>
          <div style="font-weight:700">${fmt(w.amount)}</div>
          <div style="font-size:.75rem;color:var(--text-muted)">Fee ${fmt(fee)} · Net ${fmt(w.netAmount || w.amount)}</div>
        </td>
        <td style="font-size:.875rem">
          <div style="font-weight:600">${w.bank?.bankName || "—"}</div>
          <div style="color:var(--text-muted);font-family:monospace">${w.bank?.accountNumber || ""}</div>
          <div style="color:var(--text-muted)">${w.bank?.accountName || ""}</div>
        </td>
        <td>${statusBadge}</td>
        <td style="font-size:.875rem;color:var(--text-muted)">${timeAgo(w.requestedAt)}</td>
        <td>${actions}</td>
      </tr>`;
  }).join("");
}

window.markPaid = async (id) => {
  const w = allW.find(x => x.id === id);
  if (!w) return;
  const ref = prompt(`Mark withdrawal of ${fmt(w.amount)} as paid?\n\nEnter the bank transfer reference (or leave blank):`);
  if (ref === null) return; // user cancelled

  try {
    await updateDoc(doc(db, "withdrawals", id), {
      status:      "paid",
      paidAt:      serverTimestamp(),
      paidBy:      window._adminEmail || null,
      bankRef:     ref || null,
      method:      "manual",
    });
    toast("Marked as paid.", "success");
    loadWithdrawals();
  } catch (e) {
    toast("Failed: " + e.message, "error");
  }
};

window.rejectWithdrawal = async (id) => {
  const w = allW.find(x => x.id === id);
  if (!w) return;
  const reason = prompt(`Reject this withdrawal?\n\nReason (will refund ${fmt(w.amount)} to wallet):`);
  if (reason === null) return;

  try {
    // Refund to wallet
    await updateDoc(doc(db, "sellers", w.sellerId), {
      "wallet.balance":        increment(w.amount),
      "wallet.totalWithdrawn": increment(-w.amount),
    });
    // Mark rejected
    await updateDoc(doc(db, "withdrawals", id), {
      status:        "rejected",
      rejectedAt:    serverTimestamp(),
      rejectedBy:    window._adminEmail || null,
      rejectReason:  reason || "No reason given",
    });
    toast("Rejected and refunded.", "success");
    loadWithdrawals();
    loadSellers(); // wallet balances changed
  } catch (e) {
    toast("Failed: " + e.message, "error");
  }
};

window.restoreWithdrawal = async (id) => {
  if (!confirm("Restore this withdrawal back to pending?")) return;
  const w = allW.find(x => x.id === id);
  if (!w) return;

  try {
    // Re-deduct from wallet
    await updateDoc(doc(db, "sellers", w.sellerId), {
      "wallet.balance":        increment(-w.amount),
      "wallet.totalWithdrawn": increment(w.amount),
    });
    await updateDoc(doc(db, "withdrawals", id), {
      status:        "pending",
      rejectedAt:    null,
      rejectReason:  null,
    });
    toast("Restored to pending.", "success");
    loadWithdrawals();
    loadSellers();
  } catch (e) {
    toast("Failed: " + e.message, "error");
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