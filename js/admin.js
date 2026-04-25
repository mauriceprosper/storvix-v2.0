// ============================================================
//  STORVIX — Admin Panel (js/admin.js)
//  Locked to: usestorvix@gmail.com + mauriceprosper1@gmail.com
// ============================================================

import {
  auth, db, onAuthStateChanged, isAdmin, ADMIN_EMAILS,
  collection, getDocs, collectionGroup, query, orderBy, limit, where,
  doc, updateDoc, serverTimestamp, callProcessPayout,
} from "./firebase-config.js";
import { fmt, toast, fmtDate, timeAgo, statusBadge, planBadge, copyToClipboard } from "./utils.js";

// ── Global ────────────────────────────────────────────────
let allSellers = [];
let allOrders  = [];
let allW       = [];

// ── Boot ──────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "auth.html"; return; }
  if (!isAdmin(user.email)) {
    document.getElementById("adminLoader").style.display = "none";
    document.getElementById("accessDenied").style.display = "";
    return;
  }

  document.getElementById("adminLoader").style.display = "none";
  document.getElementById("adminLayout").style.display = "";
  loadAll();
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
