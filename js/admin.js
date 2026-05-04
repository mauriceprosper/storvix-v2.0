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
  callProcessPayout, callBackfillWallets, callAdminSendMessage,
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
  const paidOrders = allOrders.filter(o => ["confirmed","shipped","delivered"].includes(o.status) || o.paymentStatus === "paid");

  const gmv = paidOrders.reduce((s, o) => s + (o.subtotal || 0), 0);
  const pendingPayoutAmount = allW.filter(w => w.status === "pending").reduce((s, w) => s + (w.amount || 0), 0);

  // Last-7d vs prior-7d delta
  const now = Date.now();
  const D7  = 7 * 24 * 60 * 60 * 1000;
  const last7  = paidOrders.filter(o => o.createdAt?.toMillis?.() > now - D7);
  const prev7  = paidOrders.filter(o => {
    const t = o.createdAt?.toMillis?.() || 0;
    return t < now - D7 && t > now - 2 * D7;
  });
  const last7Gmv = last7.reduce((s, o) => s + (o.subtotal || 0), 0);
  const prev7Gmv = prev7.reduce((s, o) => s + (o.subtotal || 0), 0);
  const delta = prev7Gmv > 0 ? Math.round(((last7Gmv - prev7Gmv) / prev7Gmv) * 100) : (last7Gmv > 0 ? 100 : 0);

  // KPIs
  document.getElementById("adminGmv").textContent           = fmt(gmv);
  document.getElementById("adminGmvSub").textContent        = `${fmt(last7Gmv)} last 7 days`;
  document.getElementById("adminSellerCount").textContent   = allSellers.length;
  document.getElementById("adminSellerSub").textContent     = `${allSellers.filter(s=>s.planStatus==="active").length} on paid plans`;
  document.getElementById("adminOrderCount").textContent    = allOrders.length;
  document.getElementById("adminOrderSub").textContent      = `${last7.length} this week`;
  document.getElementById("adminPendingPayouts").textContent = allW.filter(w=>w.status==="pending").length;
  document.getElementById("adminPendingPayoutsSub").textContent = `${fmt(pendingPayoutAmount)} to pay`;

  // Revenue chart
  renderRevenueChart(paidOrders);

  // Activity feed
  renderActivityFeed();

  // Top sellers
  renderTopSellers();

  // Delta badge on chart
  const deltaEl = document.getElementById("adminRevenueDelta");
  if (deltaEl) {
    if (delta > 0) {
      deltaEl.className = "adm-badge green";
      deltaEl.textContent = `↑ ${delta}% vs prior 7d`;
    } else if (delta < 0) {
      deltaEl.className = "adm-badge red";
      deltaEl.textContent = `↓ ${Math.abs(delta)}% vs prior 7d`;
    } else {
      deltaEl.className = "adm-badge gray";
      deltaEl.textContent = "Flat vs prior 7d";
    }
  }
}

// ── Revenue chart (last 14 days) ──────────────────────────
function renderRevenueChart(paidOrders) {
  const wrap = document.getElementById("adminRevenueChart");
  const days = 14;
  const buckets = Array(days).fill(0);
  const labels  = Array(days).fill("");

  const now = new Date();
  now.setHours(23, 59, 59, 999);

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    labels[i] = d.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
  }

  paidOrders.forEach(o => {
    const t = o.createdAt?.toMillis?.();
    if (!t) return;
    const ageDays = Math.floor((now.getTime() - t) / (24 * 60 * 60 * 1000));
    if (ageDays >= 0 && ageDays < days) {
      buckets[days - 1 - ageDays] += (o.subtotal || 0);
    }
  });

  const max = Math.max(...buckets, 1);
  const W = 600, H = 180, P = 30;
  const xStep = (W - P * 2) / (days - 1);
  const points = buckets.map((v, i) => {
    const x = P + i * xStep;
    const y = H - P - (v / max) * (H - P * 2);
    return `${x},${y}`;
  }).join(" ");
  const fillPoints = `${P},${H-P} ${points} ${P + (days-1)*xStep},${H-P}`;

  wrap.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0066FF" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#0066FF" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${fillPoints}" fill="url(#chartGrad)"/>
      <polyline points="${points}" fill="none" stroke="#0066FF" stroke-width="2.5" stroke-linejoin="round"/>
      ${buckets.map((v, i) => {
        const x = P + i * xStep;
        const y = H - P - (v / max) * (H - P * 2);
        return v > 0 ? `<circle cx="${x}" cy="${y}" r="3" fill="#fff" stroke="#0066FF" stroke-width="2"/>` : "";
      }).join("")}
      ${[0, 1, 2].map(i => {
        const y = P + i * ((H - P * 2) / 2);
        const v = max * (1 - i / 2);
        return `<line x1="${P}" y1="${y}" x2="${W-P}" y2="${y}" stroke="#F3F4F6" stroke-width="1"/>
                <text x="${P-4}" y="${y+3}" text-anchor="end" font-size="9" fill="#9CA3AF">${v >= 1000 ? "₦" + Math.round(v/1000) + "k" : "₦" + Math.round(v)}</text>`;
      }).join("")}
      <text x="${P}" y="${H-8}" font-size="9" fill="#9CA3AF">${labels[0]}</text>
      <text x="${W-P}" y="${H-8}" text-anchor="end" font-size="9" fill="#9CA3AF">${labels[days-1]}</text>
    </svg>`;
}

// ── Activity feed (recent events) ─────────────────────────
function renderActivityFeed() {
  const events = [];

  // Recent orders
  allOrders.slice(0, 8).forEach(o => {
    const seller = allSellers.find(s => s.id === o.sellerId);
    if (o.paymentStatus === "paid") {
      events.push({
        time: o.createdAt?.toMillis?.() || 0,
        icon: "💰", color: "green",
        title: `${seller?.storeName || "A seller"} got an order`,
        meta:  `${fmt(o.total || 0)} · ${o.orderNumber || ""}`
      });
    } else if (o.status === "cancelled") {
      events.push({
        time: o.createdAt?.toMillis?.() || 0,
        icon: "✕", color: "red",
        title: `Order cancelled at ${seller?.storeName || "—"}`,
        meta:  `${fmt(o.total || 0)} · ${o.orderNumber || ""}`
      });
    }
  });

  // Recent sellers
  allSellers
    .filter(s => s.createdAt)
    .sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    .slice(0, 5)
    .forEach(s => {
      events.push({
        time: s.createdAt?.toMillis?.() || 0,
        icon: "🆕", color: "blue",
        title: `New seller: ${s.storeName || s.email || "—"}`,
        meta: s.email || ""
      });
    });

  // Recent withdrawals
  allW.slice(0, 5).forEach(w => {
    const seller = allSellers.find(s => s.id === w.sellerId);
    events.push({
      time: w.requestedAt?.toMillis?.() || 0,
      icon: "💸", color: w.status === "paid" ? "green" : w.status === "rejected" ? "red" : "orange",
      title: `${seller?.storeName || "Seller"} ${w.status === "paid" ? "paid out" : w.status === "rejected" ? "withdrawal rejected" : "requested withdrawal"}`,
      meta:  fmt(w.amount || 0)
    });
  });

  events.sort((a, b) => b.time - a.time);

  const wrap = document.getElementById("adminActivityFeed");
  if (!events.length) {
    wrap.innerHTML = `<div class="admin-empty"><div class="admin-empty-icon">🤷</div><p style="font-size:.875rem">No recent activity</p></div>`;
    return;
  }
  wrap.innerHTML = events.slice(0, 12).map(e => `
    <div class="activity-item">
      <div class="activity-icon ${e.color}">${e.icon}</div>
      <div class="activity-content">
        <div class="activity-title">${e.title}</div>
        <div class="activity-meta">${e.meta} · ${timeAgo(new Date(e.time))}</div>
      </div>
    </div>`).join("");
}

// ── Top sellers ────────────────────────────────────────────
function renderTopSellers() {
  const body = document.getElementById("adminTopSellersBody");

  // Aggregate per seller
  const stats = {};
  allOrders.forEach(o => {
    if (!["confirmed","shipped","delivered"].includes(o.status) && o.paymentStatus !== "paid") return;
    if (!stats[o.sellerId]) stats[o.sellerId] = { gmv: 0, count: 0 };
    stats[o.sellerId].gmv   += (o.subtotal || 0);
    stats[o.sellerId].count += 1;
  });

  const ranked = allSellers
    .map(s => ({ ...s, ...(stats[s.id] || { gmv: 0, count: 0 }) }))
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 5);

  if (!ranked.length || ranked.every(r => r.gmv === 0)) {
    body.innerHTML = `<tr><td colspan="6" class="admin-empty"><div class="admin-empty-icon">🏆</div><p>No sales yet</p></td></tr>`;
    return;
  }

  body.innerHTML = ranked.map((s, i) => `
    <tr class="clickable" onclick="openSellerModal('${s.id}')">
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:24px;height:24px;border-radius:50%;background:${i===0?"#FFD700":i===1?"#C0C0C0":i===2?"#CD7F32":"#E5E7EB"};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;color:${i<3?"#fff":"#6B7280"}">${i+1}</div>
          <div>
            <div style="font-weight:600">${s.storeName || "—"}</div>
            <div style="font-size:.75rem;color:var(--admin-muted)">${s.slug ? s.slug + ".storvix.ng" : ""}</div>
          </div>
        </div>
      </td>
      <td>${planChip(s.plan || "lite")}</td>
      <td>${s.count || 0}</td>
      <td style="font-weight:700">${fmt(s.gmv || 0)}</td>
      <td>${fmt(s.wallet?.balance || 0)}</td>
      <td><button class="admin-btn admin-btn-sm" onclick="event.stopPropagation();openSellerModal('${s.id}')">View</button></td>
    </tr>`).join("");
}

function planChip(plan) {
  const colors = { lite: "gray", basic: "blue", plus: "purple", pro: "green" };
  return `<span class="adm-badge ${colors[plan] || "gray"}">${plan}</span>`;
}

// ── Sellers ───────────────────────────────────────────────
let _sellerSort = { col: "createdAt", dir: "desc" };
let _sellerFilter = "all";
let _sellerSearch = "";

function renderSellers() {
  const body = document.getElementById("adminSellersBody");

  // Stats
  const counts = {
    total:     allSellers.length,
    active:    allSellers.filter(s => s.planStatus === "active" && !s.suspended).length,
    trial:     allSellers.filter(s => s.planStatus === "trial" && !s.suspended).length,
    suspended: allSellers.filter(s => s.suspended).length,
  };
  document.getElementById("sellerStatTotal")     && (document.getElementById("sellerStatTotal").textContent     = counts.total);
  document.getElementById("sellerStatActive")    && (document.getElementById("sellerStatActive").textContent    = counts.active);
  document.getElementById("sellerStatTrial")     && (document.getElementById("sellerStatTrial").textContent     = counts.trial);
  document.getElementById("sellerStatSuspended") && (document.getElementById("sellerStatSuspended").textContent = counts.suspended);

  // Filter
  let list = [...allSellers];
  if (_sellerFilter === "active")    list = list.filter(s => s.planStatus === "active" && !s.suspended);
  if (_sellerFilter === "trial")     list = list.filter(s => s.planStatus === "trial" && !s.suspended);
  if (_sellerFilter === "suspended") list = list.filter(s => s.suspended);

  if (_sellerSearch) {
    const q = _sellerSearch.toLowerCase();
    list = list.filter(s =>
      (s.storeName || "").toLowerCase().includes(q) ||
      (s.email || "").toLowerCase().includes(q) ||
      (s.ownerName || "").toLowerCase().includes(q)
    );
  }

  // Sort
  list.sort((a, b) => {
    const av = a[_sellerSort.col] ?? "";
    const bv = b[_sellerSort.col] ?? "";
    let cmp;
    if (_sellerSort.col === "createdAt") {
      cmp = (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0);
    } else if (_sellerSort.col === "walletBalance") {
      cmp = (a.wallet?.balance || 0) - (b.wallet?.balance || 0);
    } else if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv));
    }
    return _sellerSort.dir === "asc" ? cmp : -cmp;
  });

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="8" class="admin-empty"><div class="admin-empty-icon">🔍</div><p>No sellers match your filters.</p></td></tr>`;
    return;
  }

  body.innerHTML = list.map(s => `
    <tr class="clickable" onclick="openSellerModal('${s.id}')">
      <td>
        <div style="font-weight:600">${s.storeName || "—"}</div>
        <div style="font-size:.75rem;color:var(--admin-muted)">${s.slug ? s.slug + ".storvix.ng" : "—"}</div>
      </td>
      <td>
        <div style="font-size:.875rem">${s.ownerName || "—"}</div>
        <div style="font-size:.75rem;color:var(--admin-muted)">${s.email || ""}</div>
      </td>
      <td>${planChip(s.plan || "lite")}</td>
      <td>
        ${s.suspended
          ? '<span class="adm-badge red">Suspended</span>'
          : `<span class="adm-badge ${s.planStatus === "active" ? "green" : s.planStatus === "trial" ? "blue" : "orange"}">${s.planStatus || "trial"}</span>`}
      </td>
      <td>${s.orderCount || 0}</td>
      <td>${fmt(s.wallet?.balance || 0)}</td>
      <td style="font-size:.8125rem;color:var(--admin-muted)">${fmtDate(s.createdAt)}</td>
      <td>
        <button class="admin-btn admin-btn-sm ${s.suspended ? "admin-btn-accent" : "admin-btn-danger"}"
                onclick="event.stopPropagation();toggleSuspend('${s.id}', ${!s.suspended})">
          ${s.suspended ? "Reactivate" : "Suspend"}
        </button>
      </td>
    </tr>`).join("");

  // Update sort header arrows
  document.querySelectorAll("#adminTab-sellers .sortable").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === _sellerSort.col) {
      th.classList.add(_sellerSort.dir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

document.getElementById("adminSellerSearch")?.addEventListener("input", (e) => {
  _sellerSearch = e.target.value;
  renderSellers();
});
document.getElementById("sellerFilter")?.addEventListener("change", (e) => {
  _sellerFilter = e.target.value;
  renderSellers();
});

// Sortable headers (sellers)
document.querySelectorAll("#adminTab-sellers .sortable").forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.sort;
    if (_sellerSort.col === col) {
      _sellerSort.dir = _sellerSort.dir === "asc" ? "desc" : "asc";
    } else {
      _sellerSort.col = col;
      _sellerSort.dir = "asc";
    }
    renderSellers();
  });
});

window.toggleSuspend = async (sellerId, suspend) => {
  if (!confirm(`${suspend ? "Suspend" : "Reactivate"} this seller?`)) return;
  try {
    await updateDoc(doc(db, "sellers", sellerId), { suspended: suspend, updatedAt: serverTimestamp() });
    const s = allSellers.find(x => x.id === sellerId);
    if (s) s.suspended = suspend;
    renderSellers();
    toast(suspend ? "Seller suspended." : "Seller reactivated.", "success");
  } catch (e) {
    toast("Failed: " + e.message, "error");
  }
};

// ── Seller drill-down modal ───────────────────────────────
window.openSellerModal = (sellerId) => {
  const s = allSellers.find(x => x.id === sellerId);
  if (!s) return;
  const sellerOrders = allOrders.filter(o => o.sellerId === sellerId);
  const paid = sellerOrders.filter(o => o.paymentStatus === "paid");
  const gmv  = paid.reduce((sum, o) => sum + (o.subtotal || 0), 0);
  const sellerWithdrawals = allW.filter(w => w.sellerId === sellerId);

  document.getElementById("sellerModalName").textContent  = s.storeName || "—";
  document.getElementById("sellerModalEmail").textContent = `${s.email || ""} · ${s.slug ? s.slug + ".storvix.ng" : ""}`;

  document.getElementById("sellerModalBody").innerHTML = `
    <div class="stat-row" style="margin-bottom:18px">
      <div class="stat-card"><div class="stat-label">Plan</div><div class="stat-value" style="font-size:1.125rem">${(s.plan || "lite").toUpperCase()}</div><div class="stat-sub">${s.planStatus || "—"}</div></div>
      <div class="stat-card"><div class="stat-label">Orders</div><div class="stat-value">${sellerOrders.length}</div><div class="stat-sub">${paid.length} paid</div></div>
      <div class="stat-card"><div class="stat-label">GMV</div><div class="stat-value" style="font-size:1.125rem">${fmt(gmv)}</div><div class="stat-sub">All time</div></div>
      <div class="stat-card"><div class="stat-label">Wallet</div><div class="stat-value" style="font-size:1.125rem">${fmt(s.wallet?.balance || 0)}</div><div class="stat-sub">Available now</div></div>
    </div>

    <h4 style="margin:0 0 8px;font-size:.875rem">Contact</h4>
    <div style="background:var(--admin-bg);padding:12px;border-radius:8px;font-size:.8125rem;margin-bottom:18px">
      <div><strong>Owner:</strong> ${s.ownerName || "—"}</div>
      <div><strong>Email:</strong> ${s.email || "—"}</div>
      <div><strong>WhatsApp:</strong> ${s.whatsapp || "—"}</div>
      <div><strong>Bank:</strong> ${s.bank?.bankName || "—"} · ${s.bank?.accountNumber || ""} · ${s.bank?.accountName || ""}</div>
      <div><strong>Joined:</strong> ${fmtDate(s.createdAt)}</div>
    </div>

    <h4 style="margin:0 0 8px;font-size:.875rem">Recent orders (${Math.min(sellerOrders.length, 5)} of ${sellerOrders.length})</h4>
    <div style="background:var(--admin-bg);border-radius:8px;overflow:hidden;margin-bottom:18px">
      ${sellerOrders.slice(0, 5).map(o => `
        <div style="padding:10px 12px;border-bottom:1px solid var(--admin-border);display:flex;justify-content:space-between;align-items:center;font-size:.8125rem">
          <div>
            <div style="font-family:monospace;font-weight:600">${o.orderNumber || o.id.slice(0,8)}</div>
            <div style="color:var(--admin-muted);font-size:.75rem">${o.buyer?.name || "—"} · ${timeAgo(o.createdAt)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="adm-badge ${o.paymentStatus === "paid" ? "green" : "orange"}">${o.paymentStatus || "—"}</span>
            <strong>${fmt(o.total || 0)}</strong>
          </div>
        </div>
      `).join("") || '<div style="padding:14px;color:var(--admin-muted);font-size:.875rem">No orders yet</div>'}
    </div>

    <h4 style="margin:0 0 8px;font-size:.875rem">Withdrawals (${sellerWithdrawals.length})</h4>
    <div style="background:var(--admin-bg);border-radius:8px;overflow:hidden">
      ${sellerWithdrawals.slice(0, 5).map(w => `
        <div style="padding:10px 12px;border-bottom:1px solid var(--admin-border);display:flex;justify-content:space-between;align-items:center;font-size:.8125rem">
          <div>
            <strong>${fmt(w.amount)}</strong>
            <span style="color:var(--admin-muted);margin-left:8px">${timeAgo(w.requestedAt)}</span>
          </div>
          <span class="adm-badge ${w.status === "paid" ? "green" : w.status === "rejected" ? "red" : "orange"}">${w.status}</span>
        </div>
      `).join("") || '<div style="padding:14px;color:var(--admin-muted);font-size:.875rem">No withdrawals</div>'}
    </div>

    <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
      ${s.suspended
        ? `<button class="admin-btn admin-btn-accent" onclick="toggleSuspend('${s.id}', false);closeSellerModal()">Reactivate seller</button>`
        : `<button class="admin-btn admin-btn-danger" onclick="toggleSuspend('${s.id}', true);closeSellerModal()">Suspend seller</button>`}
      <a href="https://${s.slug}.storvix.ng" target="_blank" class="admin-btn">Visit storefront ↗</a>
    </div>
  `;

  document.getElementById("sellerModal").classList.add("open");
};

window.closeSellerModal = () => {
  document.getElementById("sellerModal").classList.remove("open");
};

// Click backdrop to close
document.getElementById("sellerModal")?.addEventListener("click", (e) => {
  if (e.target.id === "sellerModal") closeSellerModal();
});

// ── Orders ────────────────────────────────────────────────
let _orderSort = { col: "createdAt", dir: "desc" };
let _orderFilter = "all";
let _orderSearch = "";

function renderOrders() {
  const body = document.getElementById("adminOrdersBody");

  // Stats
  const counts = {
    total:     allOrders.length,
    paid:      allOrders.filter(o => o.paymentStatus === "paid").length,
    pending:   allOrders.filter(o => o.paymentStatus !== "paid" && o.status !== "cancelled").length,
    cancelled: allOrders.filter(o => o.status === "cancelled").length,
  };
  document.getElementById("orderStatTotal")     && (document.getElementById("orderStatTotal").textContent     = counts.total);
  document.getElementById("orderStatPaid")      && (document.getElementById("orderStatPaid").textContent      = counts.paid);
  document.getElementById("orderStatPending")   && (document.getElementById("orderStatPending").textContent   = counts.pending);
  document.getElementById("orderStatCancelled") && (document.getElementById("orderStatCancelled").textContent = counts.cancelled);

  // Filter
  let list = [...allOrders];
  if (_orderFilter !== "all") list = list.filter(o => o.status === _orderFilter);
  if (_orderSearch) {
    const q = _orderSearch.toLowerCase();
    list = list.filter(o => {
      const seller = allSellers.find(s => s.id === o.sellerId);
      return (
        (o.orderNumber || "").toLowerCase().includes(q) ||
        (o.buyer?.name || "").toLowerCase().includes(q) ||
        (seller?.storeName || "").toLowerCase().includes(q)
      );
    });
  }

  // Sort
  list.sort((a, b) => {
    let cmp;
    if (_orderSort.col === "createdAt") {
      cmp = (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0);
    } else if (_orderSort.col === "total") {
      cmp = (a.total || 0) - (b.total || 0);
    } else {
      cmp = String(a[_orderSort.col] ?? "").localeCompare(String(b[_orderSort.col] ?? ""));
    }
    return _orderSort.dir === "asc" ? cmp : -cmp;
  });

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="7" class="admin-empty"><div class="admin-empty-icon">📦</div><p>No orders match your filters.</p></td></tr>`;
    return;
  }

  body.innerHTML = list.slice(0, 200).map(o => {
    const seller = allSellers.find(s => s.id === o.sellerId);
    return `
      <tr class="clickable" onclick="openOrderModal('${o.sellerId}','${o.id}')">
        <td style="font-family:monospace;font-weight:600">${o.orderNumber || o.id.slice(0,8)}</td>
        <td>${seller?.storeName || "—"}</td>
        <td>
          <div>${o.buyer?.name || "—"}</div>
          <div style="font-size:.75rem;color:var(--admin-muted)">${o.buyer?.phone || ""}</div>
        </td>
        <td style="font-weight:700">${fmt(o.total || 0)}</td>
        <td>${paymentBadge(o.paymentStatus)}</td>
        <td>${orderStatusBadge(o.status || "pending")}</td>
        <td style="font-size:.8125rem;color:var(--admin-muted)">${timeAgo(o.createdAt)}</td>
      </tr>`;
  }).join("");

  // Sort header arrows
  document.querySelectorAll("#adminTab-orders .sortable").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === _orderSort.col) {
      th.classList.add(_orderSort.dir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function paymentBadge(status) {
  const map = {
    "paid":    "green",
    "pending": "orange",
    "failed":  "red",
  };
  return `<span class="adm-badge ${map[status] || "gray"}">${status || "—"}</span>`;
}
function orderStatusBadge(status) {
  const map = {
    "pending":    "orange",
    "confirmed":  "blue",
    "processing": "purple",
    "shipped":    "blue",
    "delivered":  "green",
    "cancelled":  "red",
  };
  return `<span class="adm-badge ${map[status] || "gray"}">${status}</span>`;
}

document.getElementById("adminOrderSearch")?.addEventListener("input", (e) => {
  _orderSearch = e.target.value;
  renderOrders();
});
document.getElementById("orderFilter")?.addEventListener("change", (e) => {
  _orderFilter = e.target.value;
  renderOrders();
});
document.querySelectorAll("#adminTab-orders .sortable").forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.sort;
    if (_orderSort.col === col) {
      _orderSort.dir = _orderSort.dir === "asc" ? "desc" : "asc";
    } else {
      _orderSort.col = col;
      _orderSort.dir = "asc";
    }
    renderOrders();
  });
});

// ── Order drill-down modal ────────────────────────────────
window.openOrderModal = (sellerId, orderId) => {
  const o = allOrders.find(x => x.id === orderId && x.sellerId === sellerId);
  if (!o) return;
  const seller = allSellers.find(s => s.id === sellerId);

  document.getElementById("orderModalNumber").textContent = o.orderNumber || o.id.slice(0,8);
  document.getElementById("orderModalStore").textContent  = seller?.storeName || "—";

  const items = (o.items || []).map(i => `
    <tr>
      <td>${i.name}${i.variant ? `<div style="font-size:.75rem;color:var(--admin-muted)">${i.variant}</div>` : ""}</td>
      <td style="text-align:center">${i.qty}</td>
      <td style="text-align:right">${fmt(i.price)}</td>
      <td style="text-align:right;font-weight:600">${fmt(i.price * i.qty)}</td>
    </tr>`).join("") || `<tr><td colspan="4" style="padding:14px;color:var(--admin-muted)">No items</td></tr>`;

  document.getElementById("orderModalBody").innerHTML = `
    <div class="stat-row" style="margin-bottom:18px">
      <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value" style="font-size:1.125rem">${fmt(o.total || 0)}</div></div>
      <div class="stat-card"><div class="stat-label">Payment</div><div class="stat-value" style="font-size:.9375rem">${paymentBadge(o.paymentStatus)}</div></div>
      <div class="stat-card"><div class="stat-label">Order Status</div><div class="stat-value" style="font-size:.9375rem">${orderStatusBadge(o.status)}</div></div>
    </div>

    <h4 style="margin:0 0 8px;font-size:.875rem">Customer</h4>
    <div style="background:var(--admin-bg);padding:12px;border-radius:8px;font-size:.8125rem;margin-bottom:18px">
      <div><strong>Name:</strong> ${o.buyer?.name || "—"}</div>
      <div><strong>Phone:</strong> ${o.buyer?.phone || "—"}</div>
      <div><strong>Email:</strong> ${o.buyer?.email || "—"}</div>
      <div><strong>Address:</strong> ${o.address?.street || ""}, ${o.address?.city || ""}, ${o.address?.state || ""}</div>
      <div><strong>Delivery:</strong> ${o.deliveryCourier || "—"}</div>
    </div>

    <h4 style="margin:0 0 8px;font-size:.875rem">Items</h4>
    <table style="width:100%;font-size:.8125rem;border:1px solid var(--admin-border);border-radius:8px;overflow:hidden;margin-bottom:14px">
      <thead style="background:var(--admin-bg)">
        <tr>
          <th style="padding:8px 12px;text-align:left">Item</th>
          <th style="padding:8px 12px;text-align:center">Qty</th>
          <th style="padding:8px 12px;text-align:right">Price</th>
          <th style="padding:8px 12px;text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>${items}</tbody>
    </table>

    <div style="background:var(--admin-bg);padding:12px;border-radius:8px;font-size:.8125rem">
      ${o.rawSubtotal && o.rawSubtotal !== o.subtotal ? `
        <div style="display:flex;justify-content:space-between"><span>Original subtotal</span><span style="text-decoration:line-through;color:var(--admin-muted)">${fmt(o.rawSubtotal)}</span></div>
        <div style="display:flex;justify-content:space-between;color:var(--admin-success)"><span>Discount (${o.discount?.code || ""})</span><span>−${fmt(o.discount?.amount || 0)}</span></div>
      ` : ""}
      <div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${fmt(o.subtotal || 0)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Delivery</span><span>${fmt(o.deliveryFee || 0)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Service fee</span><span>${fmt(o.storvixFee || 0)}</span></div>
      <div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid var(--admin-border);margin-top:6px;padding-top:6px"><span>Total paid</span><span>${fmt(o.total || 0)}</span></div>
      ${o.paymentRef ? `<div style="font-size:.75rem;color:var(--admin-muted);margin-top:6px">Ref: <code>${o.paymentRef}</code></div>` : ""}
    </div>

    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
      <a href="/track.html?ref=${o.orderNumber}" target="_blank" class="admin-btn">Open tracking ↗</a>
      <button class="admin-btn admin-btn-primary" onclick="closeOrderModal()">Close</button>
    </div>
  `;

  document.getElementById("orderModal").classList.add("open");
};

window.closeOrderModal = () => {
  document.getElementById("orderModal").classList.remove("open");
};

document.getElementById("orderModal")?.addEventListener("click", (e) => {
  if (e.target.id === "orderModal") closeOrderModal();
});

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
      <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value" style="color:var(--admin-warning)">${counts.pending}</div><div class="stat-sub">${fmt(counts.pendingAmount)} to pay out</div></div>
      <div class="stat-card"><div class="stat-label">Paid</div><div class="stat-value" style="color:var(--admin-success)">${counts.paid}</div><div class="stat-sub">All time</div></div>
      <div class="stat-card"><div class="stat-label">Rejected</div><div class="stat-value" style="color:var(--admin-danger)">${counts.rejected}</div><div class="stat-sub">All time</div></div>`;
  }

  if (!allW.length) {
    body.innerHTML = `<tr><td colspan="6" class="admin-empty"><div class="admin-empty-icon">💸</div><p>No withdrawals yet.</p></td></tr>`;
    return;
  }

  // Filter UI updates allW visually
  const filter = document.getElementById("withdrawFilter")?.value || "all";
  const visible = filter === "all" ? allW : allW.filter(w => w.status === filter);

  if (!visible.length) {
    body.innerHTML = `<tr><td colspan="6" class="admin-empty"><p>No ${filter} withdrawals.</p></td></tr>`;
    return;
  }

  body.innerHTML = visible.map(w => {
    const seller = allSellers.find(s => s.id === w.sellerId);
    const fee = w.amount - (w.netAmount || w.amount);

    let statusBadge, actions;
    if (w.status === "pending") {
      statusBadge = '<span class="adm-badge orange">Pending</span>';
      actions = `
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="admin-btn admin-btn-sm admin-btn-accent" onclick="markPaid('${w.id}')">Mark Paid</button>
          <button class="admin-btn admin-btn-sm admin-btn-danger" onclick="rejectWithdrawal('${w.id}')">Reject</button>
        </div>`;
    } else if (w.status === "paid") {
      statusBadge = '<span class="adm-badge green">Paid</span>';
      actions = w.paidAt ? `<span style="font-size:.75rem;color:var(--admin-muted)">${timeAgo(w.paidAt)}</span>` : "—";
    } else if (w.status === "rejected") {
      statusBadge = '<span class="adm-badge red">Rejected</span>';
      actions = `<button class="admin-btn admin-btn-sm" onclick="restoreWithdrawal('${w.id}')">Restore</button>`;
    } else {
      statusBadge = `<span class="adm-badge gray">${w.status}</span>`;
      actions = "—";
    }

    return `
      <tr>
        <td>
          <div style="font-weight:600">${seller?.storeName || w.sellerId.slice(0,8)}</div>
          <div style="font-size:.75rem;color:var(--admin-muted)">${seller?.email || ""}</div>
        </td>
        <td>
          <div style="font-weight:700">${fmt(w.amount)}</div>
          <div style="font-size:.75rem;color:var(--admin-muted)">Fee ${fmt(fee)} · Net ${fmt(w.netAmount || w.amount)}</div>
        </td>
        <td style="font-size:.875rem">
          <div style="font-weight:600">${w.bank?.bankName || "—"}</div>
          <div style="color:var(--admin-muted);font-family:monospace">${w.bank?.accountNumber || ""}</div>
          <div style="color:var(--admin-muted)">${w.bank?.accountName || ""}</div>
        </td>
        <td>${statusBadge}</td>
        <td style="font-size:.875rem;color:var(--admin-muted)">${timeAgo(w.requestedAt)}</td>
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

// ═════════════════════════════════════════════════════════════
//  MESSAGING — broadcast & direct messages to sellers
// ═════════════════════════════════════════════════════════════
let _msgSelectedIcon = "📢";

// Icon picker
document.querySelectorAll(".icon-pick").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".icon-pick").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    _msgSelectedIcon = btn.dataset.icon;
  });
});
// Pre-select default
document.querySelector('.icon-pick[data-icon="📢"]')?.classList.add("selected");

// Recipients dropdown logic
document.getElementById("msgRecipients")?.addEventListener("change", (e) => {
  const v = e.target.value;
  const wrap = document.getElementById("specificSellerWrap");
  const countEl = document.getElementById("msgRecipientCount");

  if (v === "specific") {
    wrap.style.display = "";
    // Populate seller dropdown
    const sel = document.getElementById("msgSellerId");
    sel.innerHTML = '<option value="">Select a seller…</option>' +
      allSellers
        .sort((a, b) => (a.storeName || "").localeCompare(b.storeName || ""))
        .map(s => `<option value="${s.id}">${s.storeName || s.email || s.id.slice(0,8)} (${s.email || "—"})</option>`)
        .join("");
    countEl.textContent = "1 recipient";
  } else if (v === "all") {
    wrap.style.display = "none";
    countEl.textContent = `${allSellers.length} recipients`;
  } else if (v === "active") {
    wrap.style.display = "none";
    countEl.textContent = `${allSellers.filter(s => s.planStatus === "active").length} recipients`;
  } else if (v === "starter") {
    wrap.style.display = "none";
    countEl.textContent = `${allSellers.filter(s => s.planStatus === "starter").length} recipients`;
  } else if (v === "trial") {
    wrap.style.display = "none";
    countEl.textContent = `${allSellers.filter(s => s.planStatus === "trial").length} recipients`;
  } else {
    wrap.style.display = "none";
    countEl.textContent = "—";
  }
});

// Submit handler
document.getElementById("adminMessageForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const recipientsType = document.getElementById("msgRecipients").value;
  const sellerId       = document.getElementById("msgSellerId")?.value;
  const title          = document.getElementById("msgTitle").value.trim();
  const body           = document.getElementById("msgBody").value.trim();

  if (!recipientsType) { toast("Choose recipients.", "error"); return; }
  if (recipientsType === "specific" && !sellerId) { toast("Choose a seller.", "error"); return; }
  if (!title || !body) { toast("Title and message required.", "error"); return; }

  // Confirm broadcasts
  if (recipientsType === "all" && !confirm(`Send "${title}" to ALL ${allSellers.length} sellers?`)) return;

  const btn = document.getElementById("msgSendBtn");
  btn.disabled = true;
  btn.textContent = "Sending…";

  try {
    const recipients = recipientsType === "specific" ? [sellerId] : recipientsType;
    const result = await callAdminSendMessage({
      recipients,
      title,
      body,
      icon: _msgSelectedIcon,
    });

    const sent = result.data?.sent || 0;
    toast(`Message sent to ${sent} seller${sent !== 1 ? "s" : ""}.`, "success");

    // Reset form
    document.getElementById("adminMessageForm").reset();
    document.getElementById("specificSellerWrap").style.display = "none";
    document.getElementById("msgRecipientCount").textContent = "—";
    _msgSelectedIcon = "📢";
    document.querySelectorAll(".icon-pick").forEach(b => b.classList.remove("selected"));
    document.querySelector('.icon-pick[data-icon="📢"]')?.classList.add("selected");

    // Reload broadcast list
    loadRecentBroadcasts();
  } catch (err) {
    console.error("Send failed:", err);
    toast("Failed: " + (err.message || "Unknown error"), "error");
  }

  btn.disabled = false;
  btn.textContent = "Send Message";
});

// Load recent broadcasts
async function loadRecentBroadcasts() {
  const wrap = document.getElementById("recentBroadcastsList");
  if (!wrap) return;

  try {
    const snap = await getDocs(query(
      collection(db, "adminBroadcasts"),
      orderBy("sentAt", "desc"),
      limit(10)
    ));

    if (snap.empty) {
      wrap.innerHTML = `<div class="admin-empty" style="padding:32px"><div class="admin-empty-icon">📭</div><p style="font-size:.875rem">No broadcasts yet</p></div>`;
      return;
    }

    wrap.innerHTML = snap.docs.map(d => {
      const b = d.data();
      const audience = Array.isArray(b.recipients)
        ? `${b.recipientCount} specific seller${b.recipientCount !== 1 ? "s" : ""}`
        : b.recipients === "all"
          ? `All sellers (${b.recipientCount})`
          : `${b.recipients} sellers (${b.recipientCount})`;

      return `
        <div class="broadcast-row">
          <div class="broadcast-row-meta">
            <span>${audience}</span>
            <span>${timeAgo(b.sentAt)}</span>
          </div>
          <div class="broadcast-row-title">${b.icon || "📢"} ${b.title}</div>
          <div class="broadcast-row-body">${b.body}</div>
        </div>`;
    }).join("");
  } catch (err) {
    console.warn("Broadcasts load failed:", err.message);
    wrap.innerHTML = `<div class="admin-empty" style="padding:32px"><p style="font-size:.875rem">Could not load recent broadcasts.</p></div>`;
  }
}

// Hook into tab switch — load broadcasts when entering Messaging tab
document.querySelectorAll('.admin-nav-item[data-tab="messaging"]').forEach(item => {
  item.addEventListener("click", () => loadRecentBroadcasts());
});
