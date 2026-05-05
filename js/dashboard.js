// ============================================================
//  STORVIX — Dashboard Logic (js/dashboard.js)
// ============================================================

import {
  auth, db, onAuthStateChanged, getSeller, updateSeller, isAdmin,
  listenOrders, updateOrderStatus, getProducts, addProduct, updateProduct, deleteProduct,
  getCustomers, getDiscounts, getPaymentLinks, getTransactions, getTestimonials,
  uploadImage, requestWithdrawal, logOut,
  doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp,
  onSnapshot, callCreatePaymentLink, callVerifyBankAccount, callListBanks, writeBatch,
  query, where, orderBy, limit,
} from "./firebase-config.js";
import {
  fmt, toast, btnLoading, storeUrl, copyToClipboard, fmtDate, timeAgo,
  statusBadge, planBadge, openModal, closeModal, bindModalClose,
  NIGERIAN_BANKS, PRODUCT_CATEGORIES, readFileAsDataURL, debounce, normalisePhone,
  getLiveBanks,
} from "./utils.js";
import { PLANS, PAYSTACK_PUBLIC_KEY, PAYSTACK_PLAN_CODES, canAccess, isAtLimit, UPGRADE_MESSAGES, getAccountStatus, STARTER_PACK } from "./plans.js";

// ── Global State ─────────────────────────────────────────────
let seller   = null;
let allOrders    = [];
let allProducts  = [];
let allCustomers = [];
let allDiscounts = [];
let allPayLinks  = [];
let allTxns      = [];
let editingProductId = null;
let productImages    = [null, null, null, null, null];
let productColors    = [];
let pendingShipOrder = null;
let revenueChart     = null;
let statusChart      = null;
let walletListener   = null;
let ordersListener   = null;

// ── Boot ──────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "auth.html"; return; }

  seller = await getSeller(user.uid);
  if (!seller?.slug) {
    // If user is admin without a store, send to admin panel instead of onboarding
    if (isAdmin(user.email)) { window.location.href = "admin.html"; return; }
    window.location.href = "onboarding.html"; return;
  }

  initUI();
  startListeners(user.uid);
  loadAllTabs(user.uid);
  document.getElementById("pageLoader").style.display   = "none";
  document.getElementById("dashLayout").style.display   = "";
});

// ── Init UI ───────────────────────────────────────────────────
function initUI() {
  const planInfo  = PLANS[seller.plan] || PLANS.lite;
  const storeLink = storeUrl(seller.slug);

  document.getElementById("sidebarStoreName").textContent = seller.storeName;
  document.getElementById("sidebarStoreUrl").textContent  = `${seller.slug}.storvix.ng`;
  document.getElementById("sidebarUserName").textContent  = seller.ownerName || seller.email;
  document.getElementById("sidebarUserPlan").textContent  = `${planInfo.name} · ${seller.planStatus}`;
  document.getElementById("sidebarAvatar").textContent    = (seller.ownerName || "S")[0].toUpperCase();
  document.getElementById("viewStoreBtn").href            = storeLink;
  document.getElementById("viewStoreQuick").href          = storeLink;
  document.getElementById("kpiProductsLimit").textContent = planInfo.products === Infinity ? "Unlimited" : `Limit: ${planInfo.products}`;

  // Trial / Starter / Active subscription banner
  const accountStatus = getAccountStatus(seller);
  renderSubscriptionBanner(accountStatus);

  // Plan-locked nav items
  if (!canAccess(seller, "paymentLinks")) document.getElementById("navPaylinks")?.classList.add("text-muted");
  if (!canAccess(seller, "analytics"))    document.getElementById("navAnalytics")?.classList.add("text-muted");

  // Bank info for withdrawal
  const bank = seller.bank;
  if (bank?.bankName) {
    document.getElementById("withdrawBankInfo").textContent = `${bank.bankName} · ${bank.accountNumber}`;
  }

  // Settings pre-fill
  prefillSettings();

  // CSV export (Pro only)
  if (canAccess(seller, "csvExport")) {
    document.getElementById("exportCsvBtn").style.display = "";
  }

  // SEO section (Basic+)
  if (canAccess(seller, "seo")) {
    document.getElementById("seoSection").style.display = "";
    const seoT = document.getElementById("seoTitle");
    const seoD = document.getElementById("seoDescription");
    if (seoT) seoT.value = seller.seoTitle || "";
    if (seoD) seoD.value = seller.seoDescription || "";
  }

  // Testimonials (Basic+)
  if (canAccess(seller, "testimonials")) {
    document.getElementById("testimonialsSection").style.display = "";
  }

  // Product image slots
  initProductImageSlots();

  // Category select in product modal
  const catSel = document.getElementById("pCategory");
  PRODUCT_CATEGORIES.forEach(c => {
    const opt = document.createElement("option"); opt.value = c; opt.textContent = c;
    catSel.appendChild(opt);
  });
}

// ── Subscription Banner ───────────────────────────────────────
function renderSubscriptionBanner(status) {
  const banner = document.getElementById("trialBanner");
  if (!banner) return;

  if (status.suspended) {
    // Expired — must subscribe
    banner.style.display = "";
    banner.style.background = "#FEE2E2";
    banner.style.borderColor = "#FCA5A5";
    banner.innerHTML = `
      <div style="flex:1">
        <strong style="color:#991B1B">⏸️ ${status.reason}</strong>
        <div style="font-size:.875rem;color:#7F1D1D;margin-top:2px">Your storefront is paused. Pick a plan to take orders again.</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="switchTab('billing')">Choose Plan</button>`;
  } else if (status.reason === "starter") {
    banner.style.display = "";
    banner.style.background = "rgba(0,102,255,0.08)";
    banner.style.borderColor = "rgba(0,102,255,0.25)";
    const urgent = status.daysLeft <= 7;
    banner.innerHTML = `
      <div style="flex:1">
        <strong style="color:${urgent ? "#B45309" : "#1D4ED8"}">${urgent ? "⚠️" : "🚀"} Starter Pack — ${status.daysLeft} day${status.daysLeft !== 1 ? "s" : ""} left</strong>
        <div style="font-size:.875rem;color:var(--text-muted);margin-top:2px">All Pro features unlocked. After ${status.daysLeft} day${status.daysLeft !== 1 ? "s" : ""}, pick a plan to keep your store live.</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="switchTab('billing')">View Plans</button>`;
  } else if (status.reason === "active" && status.daysLeft !== null && status.daysLeft <= 7) {
    // Active but renewing soon
    banner.style.display = "";
    banner.style.background = "#FEF3C7";
    banner.style.borderColor = "#FCD34D";
    banner.innerHTML = `
      <div style="flex:1">
        <strong style="color:#92400E">📅 Subscription renews in ${status.daysLeft} day${status.daysLeft !== 1 ? "s" : ""}</strong>
        <div style="font-size:.875rem;color:#78350F;margin-top:2px">${seller.autoRenew ? "Will auto-renew on your card" : "Renew manually to keep your store live"}</div>
      </div>
      ${seller.autoRenew ? "" : '<button class="btn btn-primary btn-sm" onclick="switchTab(\'billing\')">Renew Now</button>'}`;
  } else if (status.reason === "trial") {
    // Old-style trial
    banner.style.display = "";
    const daysLeft = Math.max(0, Math.ceil((seller.trialEnd?.toDate?.() - new Date()) / 86400000));
    document.getElementById("trialDaysLeft") && (document.getElementById("trialDaysLeft").textContent = `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining`);
  } else {
    banner.style.display = "none";
  }
}

// ── Subscribe to a plan (after starter or for renewal) ──────
window.subscribeToPlan = (planId, billing) => {
  const plan = PLANS[planId];
  if (!plan) { toast("Invalid plan.", "error"); return; }
  const amount = billing === "annual" ? plan.annual : plan.monthly;

  if (!window.PaystackPop) {
    toast("Payment library still loading — try again in a moment.", "error");
    return;
  }

  // For real recurring subscription, use Paystack subscription API (needs Cloud Functions)
  // For now: charge once + record + extend planExpiry
  const handler = window.PaystackPop.setup({
    key:      PAYSTACK_PUBLIC_KEY,
    email:    seller.email,
    amount:   amount * 100,
    currency: "NGN",
    ref:      `STX_SUB_${seller.id}_${Date.now()}`,
    plan:     PAYSTACK_PLAN_CODES[planId]?.[billing] || undefined, // Triggers Paystack subscription if plan code is real
    metadata: {
      custom_fields: [
        { display_name: "Type",      variable_name: "type",      value: "subscription" },
        { display_name: "Plan",      variable_name: "plan",      value: planId },
        { display_name: "Billing",   variable_name: "billing",   value: billing },
        { display_name: "Seller ID", variable_name: "seller_id", value: seller.id },
      ],
    },
    callback: function (response) {
      // Background: extend planExpiry
      (async () => {
        try {
          const days = billing === "annual" ? 365 : 30;
          const expiry = new Date();
          expiry.setDate(expiry.getDate() + days);

          await updateSeller(seller.id, {
            plan: planId,
            billing,
            planStatus: "active",
            planExpiry: expiry,
            lastPaymentRef: response.reference,
            lastPaymentAt:  serverTimestamp(),
          });
          seller.plan = planId;
          seller.billing = billing;
          seller.planStatus = "active";
          seller.planExpiry = { toDate: () => expiry };
          toast(`Subscribed to ${plan.name}!`, "success");
          setTimeout(() => location.reload(), 1500);
        } catch (e) {
          console.error("Subscription update failed:", e);
          toast("Payment received — refresh to see new plan.", "success");
        }
      })();
    },
    onClose: function () {
      toast("Subscription cancelled.", "info");
    },
  });

  handler.openIframe();
};

// ── Quick re-pay starter (if expired but they want another month) ──
window.repayStarter = () => {
  if (!window.PaystackPop) { toast("Loading…", "error"); return; }
  const handler = window.PaystackPop.setup({
    key:      PAYSTACK_PUBLIC_KEY,
    email:    seller.email,
    amount:   STARTER_PACK.amount * 100,
    currency: "NGN",
    ref:      `STX_STARTER_${seller.id}_${Date.now()}`,
    metadata: { custom_fields: [{ display_name: "Type", variable_name: "type", value: "starter_renewal" }] },
    callback: function (response) {
      (async () => {
        try {
          const expiry = new Date();
          expiry.setDate(expiry.getDate() + STARTER_PACK.durationDays);
          await updateSeller(seller.id, {
            planStatus: "starter",
            starterExpiry: expiry,
            lastPaymentRef: response.reference,
            lastPaymentAt: serverTimestamp(),
          });
          toast("Starter pack renewed!", "success");
          setTimeout(() => location.reload(), 1500);
        } catch (e) { console.error(e); toast("Refresh to see status.", "info"); }
      })();
    },
    onClose: function () { toast("Cancelled.", "info"); },
  });
  handler.openIframe();
};

// ── Navigation ────────────────────────────────────────────────
window.switchTab = function(tab) {
  document.querySelectorAll(".dash-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const tabEl = document.getElementById(`tab-${tab}`);
  if (tabEl) tabEl.classList.add("active");
  const navEl = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (navEl) navEl.classList.add("active");
  document.getElementById("topbarTitle").textContent = navEl?.querySelector("span:last-child")?.textContent?.trim() || "";
  closeSidebar();
};

document.querySelectorAll(".nav-item[data-tab]").forEach(item => {
  item.addEventListener("click", () => {
    const tab = item.dataset.tab;

    if (tab === "paylinks" && !canAccess(seller, "paymentLinks")) {
      toast(UPGRADE_MESSAGES.paymentLinks(), "info"); return;
    }
    if (tab === "analytics" && !canAccess(seller, "analytics")) {
      toast(UPGRADE_MESSAGES.analytics(), "info"); return;
    }
    switchTab(tab);
    if (tab === "analytics") renderAnalytics();
    if (tab === "billing")   renderBilling();
  });
});

// ── Hamburger/sidebar (mobile) ────────────────────────────────
document.getElementById("hamburgerBtn")?.addEventListener("click", () => {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebarOverlay").classList.add("open");
});
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("open");
}
document.getElementById("sidebarOverlay")?.addEventListener("click", closeSidebar);

// ── Logout ────────────────────────────────────────────────────
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await logOut(); window.location.href = "auth.html";
});

// ── Store Link ────────────────────────────────────────────────
window.copyStoreLink = () => copyToClipboard(storeUrl(seller.slug), "Store link copied!");
document.getElementById("copyStoreLinkBtn")?.addEventListener("click", () => copyToClipboard(storeUrl(seller.slug), "Link copied!"));
document.getElementById("shareStoreBtn")?.addEventListener("click", () => {
  if (navigator.share) navigator.share({ title: seller.storeName, url: storeUrl(seller.slug) });
  else copyToClipboard(storeUrl(seller.slug), "Link copied!");
});

// ── Real-time Listeners ───────────────────────────────────────
function startListeners(uid) {
  // Wallet (live)
  walletListener = onSnapshot(doc(db, "sellers", uid), snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    const bal  = data.wallet?.balance || 0;
    const prev = seller.wallet?.balance || 0;

    seller = { ...seller, ...data };
    const fmtBal = fmt(bal);
    document.getElementById("walletBalance").textContent       = fmtBal;
    document.getElementById("walletTotalEarned").textContent   = fmt(data.wallet?.totalEarned || 0);
    document.getElementById("walletTotalWithdrawn").textContent= fmt(data.wallet?.totalWithdrawn || 0);
    document.getElementById("kpiWallet").textContent           = fmtBal;
    document.getElementById("overviewWalletBalance").textContent = fmtBal;

    // Flash green on new credit
    if (bal > prev) {
      const card = document.getElementById("walletCard");
      card.classList.remove("wallet-flash");
      void card.offsetWidth;
      card.classList.add("wallet-flash");
    }
  });

  // Orders (live)
  ordersListener = listenOrders(uid, (orders) => {
    allOrders = orders;
    renderOrders();
    updateOrderStats();
    renderRecentOrders();
    renderDelivery();

    const pending = orders.filter(o => o.status === "pending").length;
    const badge   = document.getElementById("pendingBadge");
    if (pending > 0) { badge.textContent = pending; badge.style.display = ""; }
    else badge.style.display = "none";
  });
}

function updateOrderStats() {
  const total   = allOrders.length;
  const revenue = allOrders.filter(o => ["confirmed","shipped","delivered"].includes(o.status))
    .reduce((s, o) => s + (o.subtotal || 0), 0);
  document.getElementById("kpiOrders").textContent  = total;
  document.getElementById("kpiRevenue").textContent = fmt(revenue);
}

// ── Load All Tabs ─────────────────────────────────────────────
async function loadAllTabs(uid) {
  startNotificationsListener(uid);
  await Promise.all([
    loadProducts(uid),
    loadCustomers(uid),
    loadDiscounts(uid),
    loadPayLinks(uid),
    loadTransactions(uid),
  ]);
}

// ── Products ─────────────────────────────────────────────────
async function loadProducts(uid) {
  allProducts = await getProducts(uid, { includeInactive: false, includeDrafts: true });
  renderProducts();
  document.getElementById("kpiProducts").textContent = allProducts.filter(p => p.active && !p.draft).length;
  checkLowStock();
}

function renderProducts(filter = "") {
  const grid = document.getElementById("productsGrid");
  const list = filter
    ? allProducts.filter(p => p.name?.toLowerCase().includes(filter.toLowerCase()))
    : allProducts;

  const total = allProducts.length;
  const plan  = PLANS[seller.plan] || PLANS.lite;
  document.getElementById("productCountLabel").textContent =
    `(${total}${plan.products !== Infinity ? "/" + plan.products : ""})`;

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:64px">
      <div class="empty-icon">📦</div><h4>No products yet</h4>
      <p>Add your first product to start selling.</p>
      <button class="btn btn-primary" onclick="document.getElementById('addProductBtn').click()">Add Product</button>
    </div>`;
    return;
  }

  grid.innerHTML = list.map(p => {
    const stockCls = p.stock <= 0 ? "stock-out" : p.stock <= seller.stockThreshold ? "stock-low" : "stock-in";
    const stockLbl = p.stock <= 0 ? "Out of Stock" : p.stock <= seller.stockThreshold ? `Low — ${p.stock}` : `${p.stock} in stock`;
    const img      = p.images?.[0] || "";
    return `
      <div class="product-card">
        <div class="product-card-img">
          ${img ? `<img src="${img}" alt="${p.name}" loading="lazy">` : "📦"}
        </div>
        <div class="product-card-body">
          <div class="product-card-name">${p.name || "—"}</div>
          <div class="product-card-price">${fmt(p.price)}</div>
          <div class="product-card-meta">
            <span class="badge ${stockCls}" style="font-size:.7rem">${stockLbl}</span>
            ${p.draft ? '<span class="badge badge-gray" style="font-size:.7rem">Draft</span>' : ""}
          </div>
        </div>
        <div class="product-card-actions">
          <button class="btn btn-sm btn-secondary" style="flex:1" onclick="openEditProduct('${p.id}')">Edit</button>
          <button class="btn btn-sm btn-danger"   onclick="confirmDeleteProduct('${p.id}','${(p.name||"").replace(/'/g,"\\'")}')">Del</button>
        </div>
      </div>`;
  }).join("");
}

function checkLowStock() {
  const threshold = seller.stockThreshold || 3;
  const low = allProducts.filter(p => p.stock > 0 && p.stock <= threshold && p.active);
  const alert = document.getElementById("lowStockAlert");
  if (low.length) {
    alert.style.display = "";
    document.getElementById("lowStockMsg").textContent =
      `Low stock: ${low.map(p => `${p.name} (${p.stock})`).join(", ")}`;
  } else {
    alert.style.display = "none";
  }
}

// Product search
document.getElementById("productSearch")?.addEventListener("input", debounce((e) => {
  renderProducts(e.target.value);
}, 300));

// Add Product Button
document.getElementById("addProductBtn")?.addEventListener("click", () => openAddProduct());
document.getElementById("quickAddProductBtn")?.addEventListener("click", () => openAddProduct());

function openAddProduct() {
  if (isAtLimit(seller, "products")) {
    toast(UPGRADE_MESSAGES.products(seller.plan), "info"); return;
  }
  editingProductId = null;
  document.getElementById("productModalTitle").textContent = "Add Product";
  document.getElementById("productForm").reset();
  productImages = [null, null, null, null, null];
  productColors = [];
  refreshProductImageSlots();
  refreshProductColors();
  openModal("productModal");
}

window.openEditProduct = async (id) => {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  editingProductId = id;
  document.getElementById("productModalTitle").textContent = "Edit Product";
  document.getElementById("pName").value        = p.name || "";
  document.getElementById("pCategory").value    = p.category || "";
  document.getElementById("pPrice").value       = p.price || "";
  document.getElementById("pOldPrice").value    = p.oldPrice || "";
  document.getElementById("pStock").value       = p.stock || "";
  document.getElementById("pDescription").value = p.description || "";
  document.getElementById("pDraft").value       = p.draft ? "true" : "false";
  document.getElementById("pSizes").value       = (p.sizes || []).join(", ");
  productImages = [...(p.images || [null,null,null,null,null])].slice(0,5).map(u => u || null);
  while (productImages.length < 5) productImages.push(null);
  productColors = p.colors || [];
  refreshProductImageSlots();
  refreshProductColors();
  openModal("productModal");
};

window.confirmDeleteProduct = (id, name) => {
  document.getElementById("confirmTitle").textContent   = "Delete Product";
  document.getElementById("confirmMessage").textContent = `Delete "${name}"? This cannot be undone.`;
  document.getElementById("confirmActionBtn").onclick   = async () => {
    await deleteProduct(seller.id, id);
    allProducts = allProducts.filter(p => p.id !== id);
    renderProducts();
    closeModal("confirmModal");
    toast("Product deleted.", "success");
  };
  openModal("confirmModal");
};

// Product Image Slots
function initProductImageSlots() {
  const grid = document.getElementById("productImagesGrid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const slot = document.createElement("div");
    slot.className   = "product-img-slot";
    slot.dataset.idx = i;
    slot.innerHTML   = "+";
    slot.addEventListener("click", () => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*";
      inp.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        productImages[i] = { file, url };
        refreshProductImageSlots();
      });
      inp.click();
    });
    grid.appendChild(slot);
  }
}

function refreshProductImageSlots() {
  const slots = document.querySelectorAll(".product-img-slot");
  slots.forEach((slot, i) => {
    const img = productImages[i];
    if (img) {
      const url = typeof img === "string" ? img : img.url;
      slot.innerHTML = `<img src="${url}" alt>`;
    } else {
      slot.innerHTML = "+";
    }
  });
}

// Product Colors
document.getElementById("pAddColor")?.addEventListener("click", () => {
  const color = document.getElementById("pColorPicker").value;
  if (!productColors.includes(color)) { productColors.push(color); refreshProductColors(); }
});

function refreshProductColors() {
  const wrap  = document.getElementById("pColorsWrap");
  const swatches = wrap.querySelectorAll(".color-swatch");
  swatches.forEach(s => s.remove());
  productColors.forEach((c, i) => {
    const sw = document.createElement("div");
    sw.className  = "color-swatch";
    sw.style.background = c;
    sw.title      = "Click to remove";
    sw.addEventListener("click", () => { productColors.splice(i,1); refreshProductColors(); });
    wrap.insertBefore(sw, document.getElementById("pColorPicker"));
  });
}

// Product Form Submit
document.getElementById("productForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn  = document.getElementById("productSubmitBtn");
  const name = document.getElementById("pName").value.trim();
  const price= parseFloat(document.getElementById("pPrice").value);
  const stock= parseInt(document.getElementById("pStock").value);
  if (!name || isNaN(price) || isNaN(stock)) { toast("Fill in required fields.", "error"); return; }

  btnLoading(btn, true, "Save Product");

  try {
    // Upload new images
    const imageUrls = [];
    for (let i = 0; i < 5; i++) {
      const img = productImages[i];
      if (!img) continue;
      if (typeof img === "string") { imageUrls.push(img); }
      else {
        const url = await uploadImage(seller.id, img.file, `products/${Date.now()}_${i}.jpg`);
        imageUrls.push(url);
      }
    }

    const sizes = document.getElementById("pSizes").value
      .split(",").map(s => s.trim()).filter(Boolean);

    const data = {
      name, price, stock,
      oldPrice:    parseFloat(document.getElementById("pOldPrice").value) || 0,
      category:    document.getElementById("pCategory").value,
      description: document.getElementById("pDescription").value.trim(),
      draft:       document.getElementById("pDraft").value === "true",
      active:      true,
      images:      imageUrls,
      sizes, colors: productColors,
    };

    if (editingProductId) {
      await updateProduct(seller.id, editingProductId, data);
      const idx = allProducts.findIndex(p => p.id === editingProductId);
      if (idx !== -1) allProducts[idx] = { ...allProducts[idx], ...data };
      toast("Product updated!", "success");
    } else {
      const ref = await addProduct(seller.id, data);
      allProducts.unshift({ id: ref.id, ...data });
      toast("Product added!", "success");
    }

    seller.productCount = allProducts.length;
    renderProducts();
    document.getElementById("kpiProducts").textContent = allProducts.filter(p => p.active && !p.draft).length;
    closeModal("productModal");
  } catch (err) {
    console.error(err);
    toast("Failed to save product. Try again.", "error");
  }
  btnLoading(btn, false, "Save Product");
});

// ── Orders ────────────────────────────────────────────────────
let orderFilter = "all";
let orderSearch = "";

function renderOrders() {
  const body = document.getElementById("ordersTableBody");
  let list   = allOrders;
  if (orderFilter !== "all") list = list.filter(o => o.status === orderFilter);
  if (orderSearch)           list = list.filter(o =>
    o.orderNumber?.toLowerCase().includes(orderSearch.toLowerCase()) ||
    o.buyer?.name?.toLowerCase().includes(orderSearch.toLowerCase())
  );

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:48px;color:var(--text-muted)">No orders found.</td></tr>`;
    return;
  }

  body.innerHTML = list.map(o => `
    <tr onclick="openOrderDetail('${o.id}')">
      <td style="font-family:monospace;font-weight:600">${o.orderNumber || o.id.slice(0,8)}</td>
      <td>
        <div style="font-weight:600">${o.buyer?.name || "—"}</div>
        <div style="font-size:.8125rem;color:var(--text-muted)">${o.buyer?.phone || ""}</div>
      </td>
      <td>${(o.items || []).length} item${(o.items||[]).length !== 1 ? "s":""}</td>
      <td style="font-weight:600">${fmt(o.total || o.subtotal || 0)}</td>
      <td>${statusBadge(o.status || "pending")}</td>
      <td style="font-size:.875rem;color:var(--text-muted)">${timeAgo(o.createdAt)}</td>
    </tr>`).join("");
}

document.querySelectorAll(".filter-btn[data-filter]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn[data-filter]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    orderFilter = btn.dataset.filter;
    renderOrders();
  });
});

document.getElementById("orderSearch")?.addEventListener("input", debounce((e) => {
  orderSearch = e.target.value;
  renderOrders();
}, 300));

window.openOrderDetail = (id) => {
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  const content = document.getElementById("orderModalContent");
  content.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div>
        <div style="font-size:.8125rem;color:var(--text-muted);font-weight:600;margin-bottom:4px">ORDER</div>
        <div style="font-weight:700;font-family:monospace">${o.orderNumber || o.id}</div>
        <div style="font-size:.875rem;color:var(--text-muted);margin-top:4px">${fmtDate(o.createdAt)}</div>
      </div>
      <div>
        <div style="font-size:.8125rem;color:var(--text-muted);font-weight:600;margin-bottom:4px">STATUS</div>
        ${statusBadge(o.status)}
        <select class="status-select" style="display:block;margin-top:8px" onchange="changeOrderStatus('${o.id}', this.value, '${o.buyer?.name||""}')">
          ${["pending","confirmed","shipped","delivered","cancelled"].map(s =>
            `<option value="${s}" ${o.status===s?"selected":""}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
          ).join("")}
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div>
        <div style="font-size:.8125rem;color:var(--text-muted);font-weight:600;margin-bottom:8px">BUYER</div>
        <div style="font-weight:600">${o.buyer?.name || "—"}</div>
        <div style="font-size:.875rem">${o.buyer?.phone || ""}</div>
        <div style="font-size:.875rem">${o.buyer?.email || ""}</div>
      </div>
      <div>
        <div style="font-size:.8125rem;color:var(--text-muted);font-weight:600;margin-bottom:8px">DELIVERY</div>
        <div style="font-size:.875rem">${o.address?.street || "—"}</div>
        <div style="font-size:.875rem">${o.address?.city || ""}, ${o.address?.state || ""}</div>
        ${o.deliveryCourier ? `<div style="font-size:.875rem;color:var(--text-muted)">Courier: ${o.deliveryCourier}</div>` : ""}
      </div>
    </div>
    <div style="margin-bottom:20px">
      <div style="font-size:.8125rem;color:var(--text-muted);font-weight:600;margin-bottom:8px">ITEMS</div>
      ${(o.items||[]).map(item => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:600">${item.name}</div>
            ${item.variant ? `<div style="font-size:.8125rem;color:var(--text-muted)">${item.variant}</div>` : ""}
            <div style="font-size:.8125rem">Qty: ${item.qty}</div>
          </div>
          <div style="font-weight:600">${fmt(item.price * item.qty)}</div>
        </div>`).join("")}
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${fmt(o.subtotal||0)}</span></div>
      ${o.deliveryFee ? `<div style="display:flex;justify-content:space-between"><span>Delivery</span><span>${fmt(o.deliveryFee)}</span></div>` : ""}
      ${o.storvixFee ? `<div style="display:flex;justify-content:space-between"><span>VAT + Paystack</span><span>${fmt(o.storvixFee)}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.125rem;border-top:2px solid var(--text);margin-top:8px;padding-top:8px">
        <span>Total</span><span>${fmt(o.total||o.subtotal||0)}</span>
      </div>
    </div>
    ${o.paymentRef ? `<div style="margin-top:12px;font-size:.8125rem;color:var(--text-muted)">Paystack ref: ${o.paymentRef}</div>` : ""}
    ${o.trackingLink ? `<div style="margin-top:8px"><a href="${o.trackingLink}" target="_blank" style="color:var(--purple);font-size:.875rem">Track package ↗</a></div>` : ""}`;
  openModal("orderModal");
};

window.changeOrderStatus = async (orderId, newStatus, buyerName) => {
  const o = allOrders.find(x => x.id === orderId);
  if (!o || o.status === newStatus) return;

  if (newStatus === "shipped") {
    pendingShipOrder = { orderId, buyerName };
    document.getElementById("trackingLinkInput").value = "";
    openModal("shippingModal");
    closeModal("orderModal");
    return;
  }

  try {
    await updateOrderStatus(seller.id, orderId, newStatus);
    toast(`Order marked as ${newStatus}.`, "success");
    closeModal("orderModal");
  } catch {
    toast("Failed to update status.", "error");
  }
};

document.getElementById("confirmShipBtn")?.addEventListener("click", async () => {
  if (!pendingShipOrder) return;
  const tracking = document.getElementById("trackingLinkInput").value.trim();
  try {
    await updateOrderStatus(seller.id, pendingShipOrder.orderId, "shipped", { trackingLink: tracking });
    toast("Order marked as shipped. Buyer notified via WhatsApp.", "success");
    closeModal("shippingModal");
    pendingShipOrder = null;
  } catch {
    toast("Failed to update order.", "error");
  }
});

// ── Recent Orders (Overview) ──────────────────────────────────
function renderRecentOrders() {
  const el   = document.getElementById("recentOrdersList");
  const list = allOrders.slice(0, 5);
  if (!list.length) {
    el.innerHTML = `<div class="empty-state" style="padding:32px">
      <div class="empty-icon">📭</div><h4>No orders yet</h4>
      <p>Share your store link to get your first order.</p></div>`;
    return;
  }
  el.innerHTML = list.map(o => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--border);cursor:pointer" onclick="openOrderDetail('${o.id}')">
      <div>
        <div style="font-weight:600;font-size:.9375rem">${o.buyer?.name || "Guest"}</div>
        <div style="font-size:.8125rem;color:var(--text-muted)">${o.orderNumber || ""} · ${timeAgo(o.createdAt)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-weight:700">${fmt(o.total||o.subtotal||0)}</span>
        ${statusBadge(o.status)}
      </div>
    </div>`).join("");
}

// ── Delivery Tab ──────────────────────────────────────────────
function renderDelivery() {
  const body = document.getElementById("deliveryTableBody");
  const list = allOrders.filter(o => ["confirmed","shipped"].includes(o.status));

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:48px;color:var(--text-muted)">No orders awaiting delivery.</td></tr>`;
    return;
  }

  body.innerHTML = list.map(o => `
    <tr>
      <td style="font-family:monospace;font-weight:600">${o.orderNumber || o.id.slice(0,8)}</td>
      <td>${o.buyer?.name || "—"}</td>
      <td style="font-size:.875rem">${o.address?.city || "—"}, ${o.address?.state || ""}</td>
      <td>${o.deliveryCourier || "—"}</td>
      <td>${statusBadge(o.status)}</td>
      <td>${o.trackingLink ? `<a href="${o.trackingLink}" target="_blank" style="color:var(--purple);font-size:.875rem">Track ↗</a>` : "—"}</td>
      <td>
        ${o.status === "confirmed"
          ? `<button class="btn btn-sm btn-primary" onclick="changeOrderStatus('${o.id}','shipped','${(o.buyer?.name||"").replace(/'/g,"\\'")}')">Mark Shipped</button>`
          : `<button class="btn btn-sm btn-success" onclick="changeOrderStatus('${o.id}','delivered','')">Mark Delivered</button>`}
      </td>
    </tr>`).join("");
}

// ── Customers ─────────────────────────────────────────────────
async function loadCustomers(uid) {
  allCustomers = await getCustomers(uid);
  renderCustomers();
}

function renderCustomers(filter = "") {
  const body = document.getElementById("customersTableBody");
  const list = filter
    ? allCustomers.filter(c => c.name?.toLowerCase().includes(filter.toLowerCase()) || c.phone?.includes(filter))
    : allCustomers;

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:48px;color:var(--text-muted)">No customers yet.</td></tr>`;
    return;
  }

  body.innerHTML = list.map(c => `
    <tr>
      <td>
        <div style="font-weight:600">${c.name || "—"}</div>
        <div style="font-size:.8125rem;color:var(--text-muted)">${c.email || ""}</div>
      </td>
      <td>${c.phone || "—"}</td>
      <td style="font-weight:600">${c.totalOrders || 0}</td>
      <td style="font-weight:600">${fmt(c.totalSpent || 0)}</td>
      <td style="font-size:.875rem;color:var(--text-muted)">${fmtDate(c.lastOrderAt)}</td>
    </tr>`).join("");
}

document.getElementById("customerSearch")?.addEventListener("input", debounce((e) => {
  renderCustomers(e.target.value);
}, 300));

document.getElementById("exportCsvBtn")?.addEventListener("click", () => {
  const rows = [["Name","Phone","Email","Total Orders","Total Spent","Last Order"]];
  allCustomers.forEach(c => rows.push([c.name,c.phone,c.email,c.totalOrders,c.totalSpent,fmtDate(c.lastOrderAt)]));
  const csv  = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `${seller.slug}_customers.csv`;
  a.click();
});

// ── Discounts ─────────────────────────────────────────────────
async function loadDiscounts(uid) {
  allDiscounts = await getDiscounts(uid);
  renderDiscounts();
}

function renderDiscounts() {
  const wrap = document.getElementById("discountsList");
  if (!allDiscounts.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🏷️</div>
      <h4>No coupons yet</h4><p>Create a coupon code to reward your customers.</p></div>`;
    return;
  }
  wrap.innerHTML = allDiscounts.map(d => {
    const valStr = d.type === "percentage" ? `${d.value}% off` : `${fmt(d.value)} off`;
    const usage  = d.maxUses ? `${d.usageCount || 0} / ${d.maxUses} uses` : `${d.usageCount || 0} uses`;
    const isExpired = d.expiresAt?.toDate?.() && d.expiresAt.toDate() < new Date();
    const isMaxed   = d.maxUses && (d.usageCount || 0) >= d.maxUses;
    const status   = (d.active === false || isExpired || isMaxed) ? "Inactive" : "Active";
    const badge    = status === "Active" ? "badge-green" : "badge-gray";
    return `
      <div class="card card-sm" style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-family:monospace;font-size:1.0625rem;letter-spacing:.05em">${d.code || "—"}</div>
          <div style="font-size:.875rem;color:var(--text-muted)">
            ${valStr}
            ${d.minOrderAmount ? ` · Min order ${fmt(d.minOrderAmount)}` : ""}
            ${d.expiresAt?.toDate?.() ? ` · Expires ${fmtDate(d.expiresAt)}` : ""}
            · ${usage}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="badge ${badge}">${status}</span>
          <button class="btn btn-sm btn-danger" onclick="deleteDiscount('${d.id}')">Delete</button>
        </div>
      </div>`;
  }).join("");
}

document.getElementById("addDiscountBtn")?.addEventListener("click", () => {
  document.getElementById("discountForm").reset();
  openModal("discountModal");
});

// Update value hint based on type
document.getElementById("dType")?.addEventListener("change", (e) => {
  const hint = document.getElementById("dValueHint");
  if (hint) hint.textContent = e.target.value === "percentage" ? "e.g. 10 = 10% off" : "e.g. 500 = ₦500 off";
});

document.getElementById("discountForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code  = document.getElementById("dCode").value.trim().toUpperCase();
  const type  = document.getElementById("dType").value;
  const value = parseFloat(document.getElementById("dValue").value);
  const minOrder = parseFloat(document.getElementById("dMinOrder")?.value) || 0;
  const expiryRaw = document.getElementById("dExpiry")?.value;
  const maxUses = parseInt(document.getElementById("dLimit")?.value) || null;

  if (!code)              { toast("Enter a coupon code.", "error"); return; }
  if (!value || value <= 0) { toast("Enter a valid discount value.", "error"); return; }
  if (type === "percentage" && value > 100) { toast("Percentage cannot exceed 100.", "error"); return; }

  // Check duplicate code
  const dupe = allDiscounts.find(d => (d.code || "").toUpperCase() === code);
  if (dupe) { toast(`Code "${code}" already exists.`, "error"); return; }

  const data = {
    code, type, value,
    minOrderAmount: minOrder || null,
    maxUses,
    usageCount: 0,
    active: true,
    expiresAt: expiryRaw ? new Date(expiryRaw + "T23:59:59") : null,
    createdAt: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, "sellers", seller.id, "discounts"), data);
    closeModal("discountModal");
    toast(`Coupon "${code}" created!`, "success");
    loadDiscounts(seller.id);
  } catch (err) {
    toast("Failed to create coupon: " + err.message, "error");
  }
});

window.deleteDiscount = async (id) => {
  await deleteDoc(doc(db, "sellers", seller.id, "discounts", id));
  allDiscounts = allDiscounts.filter(d => d.id !== id);
  renderDiscounts();
  toast("Discount deleted.", "success");
};

// ── Payment Links ─────────────────────────────────────────────
async function loadPayLinks(uid) {
  allPayLinks = await getPaymentLinks(uid);
  renderPayLinks();
}

function renderPayLinks() {
  const wrap = document.getElementById("paylinksContent");
  if (!allPayLinks.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🔗</div>
      <h4>No payment links yet</h4><p>Create a link and share it with customers.</p></div>`;
    return;
  }

  // Quick stats
  const paid     = allPayLinks.filter(pl => pl.used || (pl.usageCount || 0) > 0);
  const totalCollected = paid.reduce((s, pl) => s + (pl.amount * (pl.oneTime ? 1 : (pl.usageCount || 0))), 0);
  const statsHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px">
      <div class="card card-sm"><div style="font-size:.75rem;color:var(--text-muted);font-weight:500">Total Links</div><div style="font-size:1.5rem;font-weight:700">${allPayLinks.length}</div></div>
      <div class="card card-sm"><div style="font-size:.75rem;color:var(--text-muted);font-weight:500">Used</div><div style="font-size:1.5rem;font-weight:700;color:var(--success,#10B981)">${paid.length}</div></div>
      <div class="card card-sm"><div style="font-size:.75rem;color:var(--text-muted);font-weight:500">Collected</div><div style="font-size:1.5rem;font-weight:700">${fmt(totalCollected)}</div></div>
    </div>`;

  const linksHtml = allPayLinks.map(pl => {
    const link = `${window.location.origin}/pay.html?ref=${pl.ref}`;
    const isExpired = pl.expiryDate && new Date(pl.expiryDate) < new Date();

    let status, statusColor;
    if (pl.oneTime && pl.used) {
      status = "Paid";
      statusColor = "badge-green";
    } else if (isExpired) {
      status = "Expired";
      statusColor = "badge-gray";
    } else if (!pl.oneTime && (pl.usageCount || 0) > 0) {
      status = `${pl.usageCount} payments`;
      statusColor = "badge-blue";
    } else {
      status = "Awaiting payment";
      statusColor = "badge-orange";
    }

    const paidByHtml = pl.usedBy ? `
      <div style="margin-top:10px;padding:10px 12px;background:rgba(16,185,129,0.06);border-radius:8px;font-size:.8125rem">
        <div style="font-weight:600;color:#047857;margin-bottom:2px">✓ Paid by</div>
        <div>${escapeHtml(pl.usedBy.name || "—")} · ${escapeHtml(pl.usedBy.phone || "—")}</div>
        <div style="color:var(--text-muted);font-family:monospace;font-size:.75rem;margin-top:2px">Ref: ${escapeHtml(pl.usedBy.paymentRef || "—")}</div>
      </div>` : "";

    return `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div style="flex:1;min-width:200px">
            <div style="font-weight:700;font-size:1rem">${escapeHtml(pl.description || "—")}</div>
            <div style="font-size:.875rem;color:var(--text-muted);margin-top:2px">
              ${fmt(pl.amount)} · ${pl.oneTime ? "One-time" : "Reusable"}
              ${pl.refHint ? ` · ${escapeHtml(pl.refHint)}` : ""}
              ${pl.expiryDate ? ` · Expires ${fmtDate(pl.expiryDate)}` : ""}
            </div>
            ${pl.notes ? `<div style="font-size:.8125rem;color:var(--text-muted);margin-top:6px;font-style:italic">"${escapeHtml(pl.notes)}"</div>` : ""}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="badge ${statusColor}">${status}</span>
            <button class="btn btn-sm btn-secondary" onclick="copyToClipboard('${link}','Link copied!')">Copy Link</button>
            <button class="btn btn-sm btn-danger" onclick="deletePayLink('${pl.id}')" title="Delete">×</button>
          </div>
        </div>
        ${paidByHtml}
      </div>`;
  }).join("");

  wrap.innerHTML = statsHtml + linksHtml;
}

window.deletePayLink = async (linkId) => {
  if (!confirm("Delete this payment link? This cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, "sellers", seller.id, "paymentLinks", linkId));
    toast("Link deleted.", "success");
    loadPayLinks(seller.id);
  } catch (e) {
    toast("Failed: " + e.message, "error");
  }
};

document.getElementById("createPayLinkBtn")?.addEventListener("click", () => {
  if (!canAccess(seller, "paymentLinks")) { toast(UPGRADE_MESSAGES.paymentLinks(), "info"); return; }
  document.getElementById("payLinkForm").reset();
  openModal("payLinkModal");
});

let payLinkOneTime = false;
document.getElementById("plOneTimeToggle")?.addEventListener("click", () => {
  payLinkOneTime = !payLinkOneTime;
  document.getElementById("plOneTimeToggle").classList.toggle("on", payLinkOneTime);
});

document.getElementById("payLinkForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const description    = document.getElementById("plDescription").value.trim();
  const amount         = parseFloat(document.getElementById("plAmount").value);
  const expiryDate     = document.getElementById("plExpiry").value || null;
  const refHint        = document.getElementById("plRefHint")?.value.trim() || "";
  const notes          = document.getElementById("plNotes")?.value.trim() || "";
  const requireEmail   = document.getElementById("plRequireEmail")?.checked || false;
  const requireAddress = document.getElementById("plRequireAddress")?.checked || false;

  if (!description) { toast("Enter what this payment is for.", "error"); return; }
  if (!amount || amount < 100) { toast("Amount must be at least ₦100.", "error"); return; }

  const btn = e.target.querySelector("button[type=submit]");
  btnLoading(btn, true, "Create Link");
  try {
    // Generate a unique ref
    const ref = `PL${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

    await addDoc(collection(db, "sellers", seller.id, "paymentLinks"), {
      ref,
      description,
      amount,
      expiryDate,
      refHint,
      notes,
      requireEmail,
      requireAddress,
      oneTime: payLinkOneTime,
      used: false,
      usageCount: 0,
      createdAt: serverTimestamp(),
    });

    toast("Payment link created!", "success");
    closeModal("payLinkModal");
    loadPayLinks(seller.id);
  } catch (err) {
    console.error("Pay link creation failed:", err);
    toast("Failed to create link: " + err.message, "error");
  }
  btnLoading(btn, false, "Create Link");
});

// ── Transactions ──────────────────────────────────────────────
async function loadTransactions(uid) {
  allTxns = await getTransactions(uid);
  renderTransactions();
}

function renderTransactions() {
  const body = document.getElementById("transactionsBody");
  if (!allTxns.length) {
    body.innerHTML = `<tr><td colspan="4" class="text-center" style="padding:32px;color:var(--text-muted)">No transactions yet.</td></tr>`;
    return;
  }
  body.innerHTML = allTxns.map(t => `
    <tr>
      <td>${t.description || "—"}</td>
      <td>${t.type === "credit" ? '<span class="badge badge-green">Credit</span>' : '<span class="badge badge-red">Debit</span>'}</td>
      <td style="font-weight:700;color:${t.type==="credit"?"var(--green)":"var(--red)"}">${t.type==="credit"?"+":"-"}${fmt(t.amount||0)}</td>
      <td style="font-size:.875rem;color:var(--text-muted)">${timeAgo(t.createdAt)}</td>
    </tr>`).join("");
}

// ── Wallet Withdraw ───────────────────────────────────────────
document.getElementById("withdrawBtn")?.addEventListener("click", async () => {
  const btn    = document.getElementById("withdrawBtn");
  const amount = parseFloat(document.getElementById("withdrawAmount").value);
  if (!amount || amount < 100)  { toast("Withdrawals must be at least ₦100.", "error"); return; }
  if (!seller.bank?.bankCode)   { toast("No bank account on file. Add one in Store Settings.", "error"); return; }

  const balance = seller.wallet?.balance || 0;
  if (amount > balance)         { toast(`Insufficient balance. Available: ${fmt(balance)}`, "error"); return; }

  // Same fee logic as backend: 1% capped at ₦100, min ₦10
  const fee = Math.max(10, Math.min(100, Math.round(amount * 0.01)));
  const net = amount - fee;

  document.getElementById("confirmTitle").textContent   = "Confirm Withdrawal";
  document.getElementById("confirmMessage").textContent =
    `Withdraw ${fmt(amount)} to ${seller.bank.bankName} (${seller.bank.accountNumber})? A ${fmt(fee)} fee applies. You'll receive ${fmt(net)}.`;
  document.getElementById("confirmActionBtn").onclick = async () => {
    btnLoading(btn, true, "Withdraw");
    closeModal("confirmModal");
    try {
      await requestWithdrawal(seller.id, amount, seller.bank);
      toast("Withdrawal requested! Funds will arrive shortly.", "success");
      document.getElementById("withdrawAmount").value = "";
      loadTransactions(seller.id);
    } catch (err) {
      toast(err.message || "Withdrawal failed.", "error");
    }
    btnLoading(btn, false, "Withdraw");
  };
  openModal("confirmModal");
});

// ── Analytics ─────────────────────────────────────────────────
async function renderAnalytics() {
  if (!canAccess(seller, "analytics")) {
    document.getElementById("tab-analytics").innerHTML = `<div class="upgrade-prompt">
      <h4>Analytics — Basic plan and above</h4>
      <p>${UPGRADE_MESSAGES.analytics()}</p>
      <button class="btn btn-primary" onclick="switchTab('billing')">Upgrade Plan</button></div>`;
    return;
  }

  const period  = parseInt(document.querySelector(".period-tab.active")?.dataset.period || 30);
  const cutoff  = new Date(); cutoff.setDate(cutoff.getDate() - period);
  const inPeriod = allOrders.filter(o => {
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt || 0);
    return d >= cutoff;
  });

  const revenue    = inPeriod.filter(o => !["cancelled"].includes(o.status)).reduce((s,o) => s+(o.subtotal||0), 0);
  const orders     = inPeriod.length;
  const aov        = orders ? Math.round(revenue / orders) : 0;
  const delivered  = inPeriod.filter(o => o.status === "delivered").length;

  document.getElementById("analyticsRevenue").textContent  = fmt(revenue);
  document.getElementById("analyticsOrders").textContent   = orders;
  document.getElementById("analyticsAov").textContent      = fmt(aov);
  document.getElementById("analyticsDelivered").textContent = delivered;

  // Revenue chart
  const labels   = [];
  const data     = [];
  for (let i = Math.min(period, 30) - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString("en-NG", { month: "short", day: "numeric" }));
    const dayTotal = inPeriod
      .filter(o => {
        const od = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt || 0);
        return od.toDateString() === d.toDateString() && !["cancelled"].includes(o.status);
      })
      .reduce((s,o) => s+(o.subtotal||0), 0);
    data.push(dayTotal);
  }

  if (revenueChart) revenueChart.destroy();
  revenueChart = new Chart(document.getElementById("revenueChart"), {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Revenue (₦)", data, fill: true,
        backgroundColor: "rgba(108,71,255,0.08)", borderColor: "#6C47FF",
        borderWidth: 2, pointRadius: 3, tension: 0.4 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => "₦"+v.toLocaleString() } } }
    }
  });

  // Status doughnut
  const statuses  = ["pending","confirmed","shipped","delivered","cancelled"];
  const counts    = statuses.map(s => inPeriod.filter(o => o.status === s).length);
  const colors    = ["#F59E0B","#2563EB","#8B5CF6","#16A34A","#DC2626"];
  if (statusChart) statusChart.destroy();
  statusChart = new Chart(document.getElementById("statusChart"), {
    type: "doughnut",
    data: { labels: statuses.map(s => s[0].toUpperCase()+s.slice(1)), datasets: [{ data: counts, backgroundColor: colors }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });

  // Top products
  const productMap = {};
  inPeriod.forEach(o => (o.items||[]).forEach(i => {
    productMap[i.name] = (productMap[i.name] || 0) + (i.price * i.qty);
  }));
  const topProds = Object.entries(productMap).sort((a,b) => b[1]-a[1]).slice(0,5);
  document.getElementById("topProductsList").innerHTML = topProds.length
    ? topProds.map(([name,rev]) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:.9375rem">${name}</span>
          <span style="font-weight:700">${fmt(rev)}</span>
        </div>`).join("")
    : `<p style="color:var(--text-muted);text-align:center;padding:24px">No data yet.</p>`;
}

document.querySelectorAll(".period-tab[data-period]").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".period-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    renderAnalytics();
  });
});

// ── Settings ──────────────────────────────────────────────────
function prefillSettings() {
  document.getElementById("settingsStoreName").value  = seller.storeName || "";
  document.getElementById("settingsWhatsapp").value   = seller.whatsapp || "";
  document.getElementById("settingsCity").value       = seller.city || "";
  document.getElementById("settingsTagline").value    = seller.tagline || "";
  document.getElementById("settingsAbout").value      = seller.about || "";
  document.getElementById("settingsInstagram").value  = seller.instagram || "";
  document.getElementById("settingsTwitter").value    = seller.twitter || "";
  document.getElementById("settingsTiktok").value     = seller.tiktok || "";
  document.getElementById("settingsFacebook").value   = seller.facebook || "";
  document.getElementById("stockThreshold").value     = seller.stockThreshold || 3;

  // Holiday toggle
  const toggle = document.getElementById("holidayToggleSwitch");
  const label  = document.getElementById("holidayToggleLabel");
  if (seller.holidayMode) { toggle.classList.add("on"); label.textContent = "On"; }

  // Logo
  if (seller.logoUrl) {
    document.getElementById("settingsLogoPreview").src          = seller.logoUrl;
    document.getElementById("settingsLogoPreview").style.display = "";
    document.getElementById("settingsLogoPlaceholder").style.display = "none";
  }

  // Color presets
  const wrap = document.getElementById("settingsColorPresets");
  const presets = ["#6C47FF","#DC2626","#16A34A","#2563EB","#D97706","#DB2777","#0891B2","#7C3AED"];
  wrap.innerHTML = "";
  presets.forEach(hex => {
    const sw = document.createElement("div");
    sw.className = "color-preset";
    sw.style.background = hex;
    if (hex === seller.accentColor) sw.classList.add("active");
    sw.addEventListener("click", () => {
      document.getElementById("settingsColorPicker").value = hex;
      wrap.querySelectorAll(".color-preset").forEach(s => s.classList.remove("active"));
      sw.classList.add("active");
    });
    wrap.appendChild(sw);
  });
  document.getElementById("settingsColorPicker").value = seller.accentColor || "#6C47FF";
}

// Holiday toggle
document.getElementById("holidayToggle")?.addEventListener("click", async () => {
  const toggle = document.getElementById("holidayToggleSwitch");
  const label  = document.getElementById("holidayToggleLabel");
  const newVal = !seller.holidayMode;
  seller.holidayMode = newVal;
  toggle.classList.toggle("on", newVal);
  label.textContent = newVal ? "On" : "Off";
});

// Logo upload (settings)
document.getElementById("settingsLogoArea")?.addEventListener("click", () => {
  document.getElementById("settingsLogoFile").click();
});
document.getElementById("settingsLogoFile")?.addEventListener("change", (e) => {
  const file = e.target.files[0]; if (!file) return;
  const url  = URL.createObjectURL(file);
  document.getElementById("settingsLogoPreview").src = url;
  document.getElementById("settingsLogoPreview").style.display = "";
  document.getElementById("settingsLogoPlaceholder").style.display = "none";
});

document.getElementById("settingsSave")?.addEventListener("click", async () => {
  const btn = document.getElementById("settingsSave");
  btnLoading(btn, true, "Save Changes");

  let logoUrl = seller.logoUrl;
  const logoFile = document.getElementById("settingsLogoFile").files[0];
  if (logoFile) logoUrl = await uploadImage(seller.id, logoFile, "logo.png");

  const updates = {
    storeName:       document.getElementById("settingsStoreName").value.trim(),
    whatsapp:        normalisePhone(document.getElementById("settingsWhatsapp").value.trim()),
    city:            document.getElementById("settingsCity").value.trim(),
    tagline:         document.getElementById("settingsTagline").value.trim(),
    about:           document.getElementById("settingsAbout").value.trim(),
    instagram:       document.getElementById("settingsInstagram").value.trim(),
    twitter:         document.getElementById("settingsTwitter").value.trim(),
    tiktok:          document.getElementById("settingsTiktok").value.trim(),
    facebook:        document.getElementById("settingsFacebook").value.trim(),
    accentColor:     document.getElementById("settingsColorPicker").value,
    holidayMode:     seller.holidayMode,
    stockThreshold:  parseInt(document.getElementById("stockThreshold").value) || 3,
    logoUrl,
  };

  if (canAccess(seller, "seo")) {
    updates.seoTitle       = document.getElementById("seoTitle")?.value?.trim() || "";
    updates.seoDescription = document.getElementById("seoDescription")?.value?.trim() || "";
  }

  await updateSeller(seller.id, updates);
  seller = { ...seller, ...updates };
  prefillSettings();
  toast("Settings saved!", "success");
  btnLoading(btn, false, "Save Changes");
});

document.getElementById("settingsCancel")?.addEventListener("click", () => prefillSettings());

// ── Plan & Billing ────────────────────────────────────────────
function renderBilling() {
  const el  = document.getElementById("billingContent");
  const cur = PLANS[seller.plan] || PLANS.lite;
  const today = new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });

  el.innerHTML = `
    <div class="billing-plan-card active-plan">
      <div class="billing-plan-header">
        <div>
          <div class="billing-plan-name">${cur.name}</div>
          <div style="font-size:.875rem;color:var(--text-muted)">${seller.planStatus === "trial" ? "Free trial" : `${seller.billing || "monthly"} billing`}</div>
        </div>
        ${planBadge(seller.plan)}
      </div>
      <div class="billing-plan-price">${fmt(seller.billing === "annual" ? cur.annual : cur.monthly)}<span style="font-size:.875rem;font-weight:400;color:var(--text-muted)">/${seller.billing === "annual" ? "yr" : "mo"}</span></div>
      ${seller.planStatus === "trial"
        ? `<div class="alert alert-info" style="margin-top:16px">🎉 Free trial active — full ${cur.name} features unlocked.</div>`
        : ""}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
      ${Object.values(PLANS).filter(p => p.id !== seller.plan).map(p => `
        <div class="billing-plan-card" style="padding:20px">
          <div style="font-weight:700;margin-bottom:4px">${p.name}</div>
          <div style="font-size:1.25rem;font-weight:800;margin-bottom:12px">${fmt(p.monthly)}<span style="font-size:.8125rem;font-weight:400;color:var(--text-muted)">/mo</span></div>
          <button class="btn btn-primary btn-block btn-sm" onclick="subscribePlan('${p.id}','monthly')">
            ${seller.planStatus === "trial" ? "Upgrade Plan" : "Switch to this"}
          </button>
        </div>`).join("")}
    </div>

    <div class="card" style="margin-bottom:20px">
      <h4 style="margin-bottom:16px">Custom domain</h4>
      <div style="display:flex;align-items:center;gap:12px">
        <span class="badge badge-purple">Coming Soon</span>
        <p style="margin:0;font-size:.9375rem;color:var(--text-muted)">Custom domains are coming soon. We'll notify you when available.</p>
      </div>
    </div>

    ${seller.planStatus !== "trial" ? `
    <div class="card" style="border-color:var(--red-light)">
      <h4 style="margin-bottom:8px;color:var(--red)">Cancel Subscription</h4>
      <p style="font-size:.875rem;margin-bottom:16px">Your store will remain live until the end of your billing period.</p>
      <button class="btn btn-danger btn-sm" onclick="cancelSubscription()">Cancel Plan</button>
    </div>` : ""}`;
}

window.subscribePlan = (planId, billing) => {
  const plan = PLANS[planId];
  if (!plan) return;
  const planCode = PAYSTACK_PLAN_CODES[planId]?.[billing];
  if (!planCode || planCode.includes("code")) {
    toast("Subscription not yet configured. Please contact support.", "error"); return;
  }

  const handler = window.PaystackPop?.setup({
    key:       PAYSTACK_PUBLIC_KEY,
    email:     seller.email,
    plan:      planCode,
    ref:       `STORVIX_${seller.id}_${Date.now()}`,
    metadata:  { custom_fields: [{ display_name: "Seller ID", variable_name: "seller_id", value: seller.id }] },
    callback:  async (response) => {
      await updateSeller(seller.id, { plan: planId, billing, planStatus: "active", subscriptionRef: response.reference });
      seller.plan = planId; seller.billing = billing; seller.planStatus = "active";
      toast(`Subscribed to ${plan.name}! `, "success");
      renderBilling();
    },
    onClose: () => toast("Subscription cancelled.", "info"),
  });
  handler?.openIframe();
};

window.cancelSubscription = () => {
  document.getElementById("confirmTitle").textContent   = "Cancel Subscription";
  document.getElementById("confirmMessage").textContent = "Cancel your plan? Your store stays live until the end of your billing period.";
  document.getElementById("confirmActionBtn").textContent = "Yes, Cancel";
  document.getElementById("confirmActionBtn").onclick   = async () => {
    await updateSeller(seller.id, { planStatus: "cancelled" });
    toast("Subscription cancelled. Your store stays live until period ends.", "info");
    closeModal("confirmModal");
    renderBilling();
  };
  openModal("confirmModal");
};

// ── Modal backdrop close ──────────────────────────────────────
["orderModal","productModal","discountModal","payLinkModal","shippingModal","confirmModal"].forEach(bindModalClose);

// ── Expose helpers to HTML ────────────────────────────────────
window.openModal     = openModal;
window.closeModal    = closeModal;
window.copyToClipboard = copyToClipboard;

// ═════════════════════════════════════════════════════════════
//  NOTIFICATIONS — bell dropdown + Inbox tab
// ═════════════════════════════════════════════════════════════
let allNotifs = [];
let notifsListener = null;

function startNotificationsListener(uid) {
  if (notifsListener) notifsListener();
  const q = query(
    collection(db, "sellers", uid, "notifications"),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  notifsListener = onSnapshot(q, (snap) => {
    allNotifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderNotificationBell();
    renderInbox();
  }, (err) => {
    console.warn("Notifications listener error:", err.message);
  });
}

function renderNotificationBell() {
  const dot = document.getElementById("notifBellDot");
  const list = document.getElementById("notifDropdownList");
  const inboxBadge = document.getElementById("inboxBadge");
  if (!dot || !list) return;

  const unread = allNotifs.filter(n => !n.read);
  if (unread.length > 0) {
    dot.style.display = "";
    if (inboxBadge) {
      inboxBadge.style.display = "";
      inboxBadge.textContent = unread.length > 99 ? "99+" : unread.length;
    }
  } else {
    dot.style.display = "none";
    if (inboxBadge) inboxBadge.style.display = "none";
  }

  // Render top 8 in dropdown
  if (allNotifs.length === 0) {
    list.innerHTML = `<div style="padding:32px 16px;text-align:center;color:var(--text-muted);font-size:.875rem">
      <div style="font-size:1.5rem;margin-bottom:6px">📭</div>
      No notifications yet
    </div>`;
    return;
  }

  list.innerHTML = allNotifs.slice(0, 8).map(n => `
    <div class="notif-row ${n.read ? "" : "unread"}" onclick="onNotifClick('${n.id}', '${(n.link || "").replace(/'/g, "\\'")}')">
      <div class="notif-row-icon">${n.icon || "🔔"}</div>
      <div class="notif-row-content">
        <div class="notif-row-title">${escapeHtml(n.title || "")}</div>
        <div class="notif-row-body">${escapeHtml(n.body || "")}</div>
        <div class="notif-row-time">${timeAgo(n.createdAt)}</div>
      </div>
    </div>
  `).join("");
}

function renderInbox() {
  const wrap = document.getElementById("inboxList");
  if (!wrap) return;

  if (!allNotifs.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📨</div>
      <h4>No messages yet</h4>
      <p>Notifications, payout updates, and admin announcements will appear here.</p>
    </div>`;
    return;
  }

  wrap.innerHTML = allNotifs.map(n => `
    <div class="inbox-card ${n.read ? "" : "unread"}" onclick="onNotifClick('${n.id}', '${(n.link || "").replace(/'/g, "\\'")}')">
      <div class="inbox-card-icon">${n.icon || "🔔"}</div>
      <div class="inbox-card-body">
        <h4 class="inbox-card-title">${escapeHtml(n.title || "")}</h4>
        <p class="inbox-card-text">${escapeHtml(n.body || "")}</p>
        <div class="inbox-card-meta">
          <span>${timeAgo(n.createdAt)}</span>
          ${n.from ? `<span>· From ${escapeHtml(n.from)}</span>` : ""}
          ${n.read ? "" : '<span style="color:var(--purple);font-weight:600">· Unread</span>'}
        </div>
      </div>
    </div>
  `).join("");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

window.onNotifClick = async (notifId, link) => {
  const n = allNotifs.find(x => x.id === notifId);
  if (!n) return;
  // Mark read
  if (!n.read) {
    try {
      await updateDoc(doc(db, "sellers", seller.id, "notifications", notifId), { read: true });
    } catch (e) { console.warn("Mark read failed:", e); }
  }
  // Navigate
  if (link) {
    closeNotifDropdown();
    if (link.startsWith("/dashboard.html")) {
      const tabMatch = link.match(/tab=([\w-]+)/);
      if (tabMatch) switchTab(tabMatch[1]);
    } else if (link.startsWith("http") || link.startsWith("/")) {
      window.location.href = link;
    }
  }
};

window.closeNotifDropdown = () => {
  const dd = document.getElementById("notifDropdown");
  if (dd) dd.style.display = "none";
};

document.getElementById("notifBellBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const dd = document.getElementById("notifDropdown");
  if (!dd) return;
  dd.style.display = dd.style.display === "none" ? "" : "none";
});

// Click outside to close
document.addEventListener("click", (e) => {
  const wrap = document.querySelector(".notif-bell-wrap");
  if (wrap && !wrap.contains(e.target)) closeNotifDropdown();
});

// Mark all read (both in bell and inbox)
async function markAllRead() {
  const unread = allNotifs.filter(n => !n.read);
  if (!unread.length) { toast("No unread messages.", "info"); return; }
  try {
    const batch = writeBatch(db);
    for (const n of unread) {
      batch.update(doc(db, "sellers", seller.id, "notifications", n.id), { read: true });
    }
    await batch.commit();
    toast(`Marked ${unread.length} as read.`, "success");
  } catch (e) {
    toast("Failed: " + e.message, "error");
  }
}
document.getElementById("markAllReadBtn")?.addEventListener("click", markAllRead);
document.getElementById("inboxMarkAllReadBtn")?.addEventListener("click", markAllRead);

// ═════════════════════════════════════════════════════════════
//  BANK ACCOUNT EDITING (Settings tab)
// ═════════════════════════════════════════════════════════════
let _bankVerifiedData = null;

async function initBankSection() {
  // Populate bank dropdown — use live list from Paystack
  const sel = document.getElementById("bankNameSelect");
  if (sel && !sel.dataset.populated) {
    sel.innerHTML = '<option value="">Loading banks…</option>';
    try {
      const banks = await getLiveBanks(callListBanks);
      sel.innerHTML = '<option value="">Select your bank…</option>';
      banks.forEach(b => {
        const opt = document.createElement("option");
        opt.value = b.code;
        opt.dataset.name = b.name;
        opt.textContent = b.name;
        sel.appendChild(opt);
      });
      sel.dataset.populated = "1";
    } catch (err) {
      // Last-resort fallback
      sel.innerHTML = '<option value="">Select your bank…</option>';
      NIGERIAN_BANKS.forEach(b => {
        const opt = document.createElement("option");
        opt.value = b.code;
        opt.dataset.name = b.name;
        opt.textContent = b.name;
        sel.appendChild(opt);
      });
      sel.dataset.populated = "1";
    }
  }

  // Show current bank or edit form
  const currentBox = document.getElementById("bankCurrent");
  const editForm   = document.getElementById("bankEditForm");
  if (seller?.bank?.accountNumber) {
    currentBox.style.display = "";
    editForm.style.display = "none";
    document.getElementById("bankCurrentText").innerHTML =
      `<div>${escapeHtml(seller.bank.bankName)}</div>
       <div style="font-family:monospace;color:var(--text-muted);font-size:.875rem">${escapeHtml(seller.bank.accountNumber)} · ${escapeHtml(seller.bank.accountName || "—")}</div>`;
  } else {
    currentBox.style.display = "none";
    editForm.style.display = "";
  }
}

document.getElementById("bankEditBtn")?.addEventListener("click", () => {
  document.getElementById("bankCurrent").style.display = "none";
  document.getElementById("bankEditForm").style.display = "";
  document.getElementById("bankCancelEditBtn").style.display = "";
});

document.getElementById("bankCancelEditBtn")?.addEventListener("click", () => {
  document.getElementById("bankEditForm").style.display = "none";
  document.getElementById("bankCurrent").style.display = "";
  document.getElementById("bankVerifyResult").style.display = "none";
  document.getElementById("bankConfirmBtn").style.display = "none";
  _bankVerifiedData = null;
});

document.getElementById("bankVerifyBtn")?.addEventListener("click", async () => {
  const sel = document.getElementById("bankNameSelect");
  const acctNum = document.getElementById("bankAcctNumber").value.trim();
  const bankCode = sel.value;
  const bankName = sel.options[sel.selectedIndex]?.dataset.name;
  const result = document.getElementById("bankVerifyResult");
  const confirmBtn = document.getElementById("bankConfirmBtn");
  const verifyBtn  = document.getElementById("bankVerifyBtn");

  if (!bankCode) { toast("Select your bank.", "error"); return; }
  if (!/^\d{10}$/.test(acctNum)) { toast("Account number must be exactly 10 digits.", "error"); return; }

  verifyBtn.disabled = true;
  verifyBtn.textContent = "Verifying…";
  result.style.display = "none";
  confirmBtn.style.display = "none";

  try {
    const res = await callVerifyBankAccount({ bankCode, accountNumber: acctNum });
    const accountName = res.data?.accountName || res.data?.account_name;
    if (!accountName) throw new Error("No account name returned");

    _bankVerifiedData = { bankCode, bankName, accountNumber: acctNum, accountName };

    result.style.display = "";
    result.style.background = "rgba(16,185,129,0.08)";
    result.style.border = "1px solid rgba(16,185,129,0.3)";
    result.innerHTML = `
      <div style="font-size:.75rem;color:#047857;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">✓ Verified</div>
      <div style="font-weight:700;font-size:1.0625rem">${escapeHtml(accountName)}</div>
      <div style="font-size:.875rem;color:var(--text-muted);margin-top:2px">${escapeHtml(bankName)} · ${escapeHtml(acctNum)}</div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-top:8px">Confirm this is correct, then save.</div>
    `;
    confirmBtn.style.display = "";
  } catch (err) {
    result.style.display = "";
    result.style.background = "rgba(239,68,68,0.08)";
    result.style.border = "1px solid rgba(239,68,68,0.3)";
    result.innerHTML = `<div style="color:#B91C1C;font-weight:600">✗ ${err.message || "Could not verify"}</div>
      <div style="font-size:.8125rem;color:var(--text-muted);margin-top:4px">Check the account number and try again.</div>`;
    _bankVerifiedData = null;
  }

  verifyBtn.disabled = false;
  verifyBtn.textContent = "Verify Account";
});

document.getElementById("bankConfirmBtn")?.addEventListener("click", async () => {
  if (!_bankVerifiedData) { toast("Verify the account first.", "error"); return; }
  const btn = document.getElementById("bankConfirmBtn");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    await updateSeller(seller.id, {
      bank: _bankVerifiedData,
      bankVerified: true,
      bankUpdatedAt: serverTimestamp(),
    });
    seller.bank = _bankVerifiedData;
    seller.bankVerified = true;
    toast("Bank account saved!", "success");
    initBankSection();
    // Update wallet bank info display
    const wbi = document.getElementById("withdrawBankInfo");
    if (wbi) wbi.innerHTML = `${_bankVerifiedData.bankName}<br><span style="font-size:.875rem;color:var(--text-muted)">${_bankVerifiedData.accountNumber} · ${_bankVerifiedData.accountName}</span>`;
  } catch (e) {
    toast("Save failed: " + e.message, "error");
  }
  btn.disabled = false; btn.textContent = "Confirm & Save";
});

// Initialize bank section when settings tab is opened
const _origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
  _origSwitchTab(tab);
  if (tab === "settings") initBankSection();
};

// ═════════════════════════════════════════════════════════════
//  REFER & EARN — seller's own referral code + link
// ═════════════════════════════════════════════════════════════
async function initReferralSection() {
  if (!seller) return;

  let code = seller.referralCode;

  // First time: generate from store name
  if (!code) {
    code = await generateReferralCode(seller.storeName || seller.email || "STORE");
    try {
      // Save the code on seller doc + claim it in referralCodes
      await Promise.all([
        updateSeller(seller.id, { referralCode: code }),
        setDoc(doc(db, "referralCodes", code), {
          code,
          ownerType: "seller",
          ownerId:   seller.id,
          ownerName: seller.storeName || "",
          createdAt: serverTimestamp(),
        }),
      ]);
      seller.referralCode = code;
    } catch (e) {
      console.warn("Code claim failed (might be taken):", e);
      // Try with a numeric suffix
      code = code + Math.floor(Math.random() * 99);
      await Promise.all([
        updateSeller(seller.id, { referralCode: code }),
        setDoc(doc(db, "referralCodes", code), {
          code,
          ownerType: "seller",
          ownerId:   seller.id,
          ownerName: seller.storeName || "",
          createdAt: serverTimestamp(),
        }),
      ]);
      seller.referralCode = code;
    }
  }

  // Populate UI
  document.getElementById("myReferralCode") && (document.getElementById("myReferralCode").textContent = code);
  document.getElementById("myReferralLink") && (document.getElementById("myReferralLink").value =
    `${window.location.origin}/onboarding.html?ref=${code}`);
  document.getElementById("referralEarnedDisplay") && (document.getElementById("referralEarnedDisplay").textContent =
    fmt(seller.referralEarned || 0));
  document.getElementById("referralCountDisplay") && (document.getElementById("referralCountDisplay").textContent =
    seller.referralCount || 0);
}

async function generateReferralCode(seedText) {
  // Take first 6 alphanumeric chars of name, uppercase
  const base = (seedText || "STORE")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 6) || "STORE";

  // Try base first, then base+1, base+2, etc until free
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}${i}`;
    try {
      const snap = await getDoc(doc(db, "referralCodes", candidate));
      if (!snap.exists()) return candidate;
    } catch { /* continue */ }
  }
  // Fallback: random suffix
  return `${base}${Math.floor(Math.random() * 9999)}`;
}

document.getElementById("copyReferralCodeBtn")?.addEventListener("click", () => {
  const code = document.getElementById("myReferralCode")?.textContent;
  if (!code || code === "—") return;
  navigator.clipboard.writeText(code).then(() => toast("Code copied!", "success"));
});

document.getElementById("copyReferralLinkBtn")?.addEventListener("click", (e) => {
  const link = document.getElementById("myReferralLink")?.value;
  if (!link) return;
  navigator.clipboard.writeText(link).then(() => {
    const orig = e.target.textContent;
    e.target.textContent = "✓ Copied";
    setTimeout(() => e.target.textContent = orig, 1500);
  });
});

// Init when refer tab opens
const _origSwitchTab2 = window.switchTab;
window.switchTab = function(tab) {
  _origSwitchTab2(tab);
  if (tab === "refer") initReferralSection();
};

// Also init on load if the deep-linked tab is refer
if (window.location.search.includes("tab=refer")) {
  setTimeout(() => initReferralSection(), 1000);
}
