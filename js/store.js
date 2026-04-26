// ============================================================
//  STORVIX — Buyer Storefront (js/store.js)
//  Works via subdomain (amaka.storvix.ng) AND /store?slug=
// ============================================================

import {
  db, getSellerBySlug, getProducts, getTestimonials,
  collection, addDoc, serverTimestamp, doc, updateDoc, getDoc,
} from "./firebase-config.js";
import {
  fmt, toast, getParam, applyAccent, storeUrl, normalisePhone,
  calculateTotal, isValidPhone, isValidEmail, generateOrderNumber, shortRef,
  NIGERIAN_STATES,
} from "./utils.js";
import { PAYSTACK_PUBLIC_KEY } from "./plans.js";

// ── Detect Store Slug ──────────────────────────────────────────
function getSlug() {
  const hostname = window.location.hostname;
  const isSubdomain = hostname.includes(".storvix.ng")
    && !hostname.startsWith("storvix.ng")
    && !hostname.startsWith("www.");
  if (isSubdomain) return hostname.split(".storvix.ng")[0];
  return getParam("slug") || getParam("s");
}

// ── State ──────────────────────────────────────────────────────
let seller    = null;
let products  = [];
let cart      = [];
let activeCat = "all";
let selectedProduct  = null;
let selectedSize     = null;
let selectedColor    = null;
let checkoutStep     = 1;
let selectedCourier  = null;
let cartSessionId    = null;

// ── Boot ───────────────────────────────────────────────────────
async function init() {
  const slug = getSlug();
  if (!slug) { showStatePage("404", "Store not found", "No store URL was provided."); return; }

  try {
    seller = await getSellerBySlug(slug);
  } catch (e) {
    showStatePage("😕", "Store Not Found", "We couldn't find this store.");
    return;
  }

  if (!seller) {
    showStatePage("😕", "Store Not Found", "This store doesn't exist or has been removed.");
    return;
  }

  // Check store state
  if (seller.suspended) {
    showStatePage("🚫", "Store Not Available", "This store is currently unavailable.");
    return;
  }
  if (seller.holidayMode) {
    showStatePage("🌴", "Store on Break", `${seller.storeName} is taking a short break. Check back soon!`);
    return;
  }
  if (seller.planStatus === "expired" || seller.planStatus === "cancelled") {
    showStatePage("⏸️", "Store Not Available", "This store's subscription has ended. Contact the seller directly.");
    return;
  }

  // All clear — render store
  renderStore();
  loadProducts();
  if (seller.plan !== "lite") loadTestimonials();
  populateStateSelect();
}

// ── Render Store Shell ─────────────────────────────────────────
function renderStore() {
  document.getElementById("pageLoader").style.display = "none";

  // Apply branding
  applyAccent(seller.accentColor || "#6C47FF");

  // SEO
  const title = seller.seoTitle || seller.storeName;
  const desc  = seller.seoDescription || seller.tagline || "";
  document.getElementById("pageTitle").textContent = title + " — Storvix";
  document.getElementById("metaDesc").setAttribute("content", desc);
  document.getElementById("ogTitle").setAttribute("content", title);
  if (seller.bannerUrl) document.getElementById("ogImage").setAttribute("content", seller.bannerUrl);

  // Branding bar (Lite only)
  if (seller.plan === "lite" || !seller.plan) {
    document.getElementById("poweredBar").style.display = "";
    document.getElementById("storvixWatermark").style.display = "";
  }

  // Header
  const headerEl = document.getElementById("storeHeader");
  headerEl.style.display = "";
  if (seller.logoUrl) {
    document.getElementById("headerLogo").src = seller.logoUrl;
    document.getElementById("footerLogo").src = seller.logoUrl;
    document.getElementById("footerLogo").style.display = "";
  } else {
    document.getElementById("headerLogo").style.display = "none";
    document.getElementById("footerLogo").style.display = "none";
  }
  document.getElementById("headerStoreName").textContent = seller.storeName;
  document.getElementById("headerCity").textContent      = [seller.city, seller.state].filter(Boolean).join(", ");

  // Hero
  const hero = document.getElementById("storeHero");
  hero.style.display = "";
  if (seller.bannerUrl) {
    hero.classList.add("has-banner");
    hero.style.backgroundImage = `url(${seller.bannerUrl})`;
  }
  document.getElementById("heroStoreName").textContent = seller.storeName;
  document.getElementById("heroTagline").textContent   = seller.tagline || "";

  // Footer
  document.getElementById("storeFooter").style.display = "";
  document.getElementById("footerAbout").textContent    = seller.about || "";
  if (seller.whatsapp) {
    document.getElementById("footerWhatsApp").innerHTML =
      `<a href="https://wa.me/${seller.whatsapp.replace(/\D/g,"")}" target="_blank">💬 WhatsApp: ${seller.whatsapp}</a>`;
  }
  const socials = document.getElementById("footerSocial");
  const links   = [
    ["Instagram", seller.instagram], ["Twitter", seller.twitter],
    ["TikTok", seller.tiktok],       ["Facebook", seller.facebook],
  ];
  socials.innerHTML = links.filter(([,h]) => h).map(([name,handle]) => `<a href="#">${name}</a>`).join(" · ");

  // Show sections
  document.getElementById("productsSection").style.display = "";
}

// ── Load Products ──────────────────────────────────────────────
async function loadProducts() {
  try {
    products = await getProducts(seller.id, { includeInactive: false, includeDrafts: false });
    renderGrid();
    renderCategories();
    document.getElementById("categoryFilter").style.display = "";
  } catch (e) {
    console.error(e);
    document.getElementById("productGrid").innerHTML = `<p class="text-muted">Failed to load products.</p>`;
  }
}

function renderGrid(filter = "all") {
  const grid = document.getElementById("productGrid");
  let list   = filter === "all" ? products : products.filter(p => p.category === filter);

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:64px">
      <div class="empty-icon">📦</div><h4>No products yet</h4>
      <p>Check back soon — new items are coming!</p></div>`;
    return;
  }

  grid.innerHTML = list.map(p => {
    const img = p.images?.[0] || "";
    const soldOut = p.stock <= 0;
    const onSale  = p.oldPrice && p.oldPrice > p.price;
    return `
      <div class="store-product-card" onclick="openProductModal('${p.id}')">
        <div class="product-img-wrap">
          ${img ? `<img src="${img}" alt="${p.name}" loading="lazy">` : `<div class="product-img-placeholder">📦</div>`}
          ${soldOut ? '<div class="product-badge sold-out">Sold Out</div>' : (onSale ? '<div class="product-badge">Sale</div>' : "")}
          ${!soldOut ? `<div class="product-quick-add" onclick="event.stopPropagation();quickAdd('${p.id}')">Quick Add +</div>` : ""}
        </div>
        <div class="product-info">
          <div class="product-title">${p.name}</div>
          ${(p.colors||[]).length ? `<div class="product-colors-row">${p.colors.slice(0,4).map(c => `<div class="product-color-dot" style="background:${c}"></div>`).join("")}</div>` : ""}
          <div class="product-price-row">
            <span class="product-price">${fmt(p.price)}</span>
            ${onSale ? `<span class="product-old-price">${fmt(p.oldPrice)}</span>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");
}

function renderCategories() {
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))];
  const bar  = document.getElementById("categoryFilter");
  bar.innerHTML = `<button class="cat-btn active" data-cat="all">All Products</button>`;
  cats.forEach(cat => {
    const btn = document.createElement("button");
    btn.className    = "cat-btn";
    btn.dataset.cat  = cat;
    btn.textContent  = cat;
    bar.appendChild(btn);
  });

  bar.querySelectorAll(".cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      bar.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeCat = btn.dataset.cat;
      renderGrid(activeCat);
    });
  });
}

// ── Testimonials ───────────────────────────────────────────────
async function loadTestimonials() {
  try {
    const items = await getTestimonials(seller.id);
    if (!items.length) return;
    const sec  = document.getElementById("testimonialsSection");
    const grid = document.getElementById("testimonialsGrid");
    sec.style.display = "";
    grid.innerHTML = items.map(t => `
      <div class="testimonial-card">
        <div class="testimonial-rating">${"⭐".repeat(t.rating || 5)}</div>
        <div class="testimonial-text">${t.comment || ""}</div>
        <div class="testimonial-name">— ${t.buyerName || "Customer"}</div>
      </div>`).join("");
  } catch {}
}

// ── Product Modal ──────────────────────────────────────────────
window.openProductModal = (id) => {
  const p = products.find(x => x.id === id);
  if (!p) return;
  selectedProduct = p;
  selectedSize  = null;
  selectedColor = null;

  const body = document.getElementById("productModalBody");
  const soldOut = p.stock <= 0;

  body.innerHTML = `
    <div class="product-modal-images">
      <img class="main-img" id="modalMainImg" src="${p.images?.[0] || ""}" alt="${p.name}" onerror="this.style.display='none'">
      ${(p.images||[]).length > 1 ? `<div class="product-thumb-strip">
        ${p.images.map((img,i) => `<img class="product-thumb ${i===0?"active":""}" src="${img}" onclick="switchModalImg(this,'${img}')">`).join("")}
      </div>` : ""}
    </div>
    <div class="product-modal-info">
      <div class="modal-product-name">${p.name}</div>
      <div class="modal-product-price">
        ${fmt(p.price)}
        ${p.oldPrice && p.oldPrice > p.price ? `<span class="modal-old-price">${fmt(p.oldPrice)}</span>` : ""}
      </div>
      ${p.description ? `<p style="font-size:.9375rem;color:var(--text-2);margin-bottom:16px;line-height:1.6">${p.description}</p>` : ""}
      ${(p.sizes||[]).length ? `
        <div class="variant-label">Size</div>
        <div class="size-options">
          ${p.sizes.map(s => `<button class="size-btn" onclick="selectSize(this,'${s}')">${s}</button>`).join("")}
        </div>` : ""}
      ${(p.colors||[]).length ? `
        <div class="variant-label">Colour</div>
        <div class="color-options">
          ${p.colors.map(c => `<div class="color-opt" style="background:${c}" onclick="selectColor(this,'${c}')"></div>`).join("")}
        </div>` : ""}
      <div class="modal-stock">${soldOut ? "❌ Out of stock" : `${p.stock} available`}</div>
      <div class="modal-qty-row">
        <div class="qty-control">
          <button class="qty-btn" onclick="changeModalQty(-1)">−</button>
          <span class="qty-num" id="modalQty">1</span>
          <button class="qty-btn" onclick="changeModalQty(1)">+</button>
        </div>
      </div>
      <button class="btn-add-cart" id="modalAddBtn" ${soldOut?"disabled":""} onclick="addToCartFromModal()">
        ${soldOut ? "Sold Out" : "Add to Cart"}
      </button>
    </div>`;

  document.getElementById("productDetailModal").classList.add("open");
  document.body.style.overflow = "hidden";
};

window.closeProductModal = () => {
  document.getElementById("productDetailModal").classList.remove("open");
  document.body.style.overflow = "";
};

window.switchModalImg = (el, src) => {
  document.getElementById("modalMainImg").src = src;
  document.querySelectorAll(".product-thumb").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
};

window.selectSize = (btn, size) => {
  document.querySelectorAll(".size-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  selectedSize = size;
};

window.selectColor = (el, color) => {
  document.querySelectorAll(".color-opt").forEach(e => e.classList.remove("active"));
  el.classList.add("active");
  selectedColor = color;
};

let modalQty = 1;
window.changeModalQty = (delta) => {
  const max = selectedProduct?.stock || 1;
  modalQty  = Math.max(1, Math.min(max, modalQty + delta));
  document.getElementById("modalQty").textContent = modalQty;
};

window.addToCartFromModal = () => {
  if (!selectedProduct) return;
  if ((selectedProduct.sizes||[]).length && !selectedSize)  { toast("Please select a size.", "error"); return; }
  if ((selectedProduct.colors||[]).length && !selectedColor){ toast("Please select a colour.", "error"); return; }
  const variant = [selectedSize, selectedColor].filter(Boolean).join(" · ");
  addToCart(selectedProduct, modalQty, variant);
  closeProductModal();
  openCart();
  modalQty = 1;
};

// Quick add (no variant selection needed)
window.quickAdd = (id) => {
  const p = products.find(x => x.id === id);
  if (!p || p.stock <= 0) return;
  if ((p.sizes||[]).length || (p.colors||[]).length) { openProductModal(id); return; }
  addToCart(p, 1, "");
  openCart();
};

// ── Cart ───────────────────────────────────────────────────────
function addToCart(product, qty, variant) {
  const existing = cart.find(i => i.id === product.id && i.variant === variant);
  if (existing) {
    existing.qty = Math.min(existing.qty + qty, product.stock);
  } else {
    cart.push({ id: product.id, name: product.name, price: product.price,
                image: product.images?.[0] || "", qty, variant, stock: product.stock });
  }
  renderCart();
  toast(`${product.name} added to cart!`, "success");
}

function renderCart() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  document.getElementById("cartCount").textContent = count;
  document.getElementById("checkoutBtn").disabled  = count === 0;

  const itemsEl = document.getElementById("cartItems");
  if (!cart.length) {
    itemsEl.innerHTML = `<div class="empty-state" style="padding:48px"><div class="empty-icon">🛒</div><h4>Your cart is empty</h4></div>`;
  } else {
    itemsEl.innerHTML = cart.map((item, idx) => `
      <div class="cart-item">
        <img class="cart-item-img" src="${item.image}" alt="${item.name}" onerror="this.style.background='var(--bg)'">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          ${item.variant ? `<div class="cart-item-variant">${item.variant}</div>` : ""}
          <div class="cart-item-row">
            <div class="cart-item-price">${fmt(item.price * item.qty)}</div>
            <div class="qty-control">
              <button class="qty-btn" onclick="changeCartQty(${idx}, -1)">−</button>
              <span class="qty-num">${item.qty}</span>
              <button class="qty-btn" onclick="changeCartQty(${idx}, 1)">+</button>
            </div>
          </div>
          <div class="cart-item-remove" onclick="removeFromCart(${idx})">Remove</div>
        </div>
      </div>`).join("");
  }

  renderCartSummary();
}

function renderCartSummary(delivery = 0) {
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const totals   = calculateTotal(subtotal, delivery);
  const sum      = document.getElementById("cartSummary");
  sum.innerHTML  = `
    <div class="cart-row"><span>Subtotal</span><span>${fmt(totals.subtotal)}</span></div>
    ${delivery ? `<div class="cart-row"><span>Delivery</span><span>${fmt(delivery)}</span></div>` : ""}
    ${totals.fee ? `<div class="cart-row"><span>VAT + Paystack</span><span>${fmt(totals.fee)}</span></div>` : ""}
    <div class="cart-row total"><span>Total</span><span>${fmt(totals.total)}</span></div>`;
}

window.changeCartQty = (idx, delta) => {
  const max = cart[idx].stock;
  cart[idx].qty = Math.max(1, Math.min(max, cart[idx].qty + delta));
  renderCart();
};

window.removeFromCart = (idx) => {
  cart.splice(idx, 1);
  renderCart();
};

function openCart()  {
  document.getElementById("cartDrawer").classList.add("open");
  document.getElementById("cartOverlay").classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeCart() {
  document.getElementById("cartDrawer").classList.remove("open");
  document.getElementById("cartOverlay").classList.remove("open");
  document.body.style.overflow = "";
}

document.getElementById("cartBtn")?.addEventListener("click", openCart);
document.getElementById("cartClose")?.addEventListener("click", closeCart);
document.getElementById("cartOverlay")?.addEventListener("click", closeCart);

// ── Checkout ───────────────────────────────────────────────────
function populateStateSelect() {
  const sel = document.getElementById("buyerState");
  NIGERIAN_STATES.forEach(s => {
    const opt = document.createElement("option"); opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  });
}

document.getElementById("checkoutBtn")?.addEventListener("click", () => {
  closeCart();
  openCheckout();
});

function openCheckout() {
  checkoutStep = 1;
  renderCheckoutStep();
  document.getElementById("checkoutModal").classList.add("open");
  document.body.style.overflow = "hidden";
}

function renderCheckoutStep() {
  ["checkoutStep1","checkoutStep2","checkoutStep3"].forEach((id,i) => {
    document.getElementById(id)?.classList.toggle("active", i + 1 === checkoutStep);
  });
  ["dot1","dot2","dot3"].forEach((id,i) => {
    document.getElementById(id)?.classList.toggle("active", i + 1 === checkoutStep);
  });
  const titles = ["Your Details","Delivery","Order Summary"];
  const subs   = ["Step 1 of 3","Step 2 of 3","Step 3 of 3"];
  document.getElementById("checkoutTitle").textContent    = titles[checkoutStep - 1];
  document.getElementById("checkoutSubtitle").textContent = subs[checkoutStep - 1];

  const nextBtn = document.getElementById("checkoutNextBtn");
  const backBtn = document.getElementById("checkoutBackBtn");
  backBtn.style.display = checkoutStep > 1 ? "" : "none";
  nextBtn.textContent   = checkoutStep === 3 ? "Pay Now" : "Continue →";

  if (checkoutStep === 3) renderOrderSummary();
}

document.getElementById("checkoutNextBtn")?.addEventListener("click", async () => {
  if (checkoutStep === 1) {
    const name  = document.getElementById("buyerName").value.trim();
    const phone = document.getElementById("buyerPhone").value.trim();
    if (!name)            { toast("Enter your name.", "error"); return; }
    if (!isValidPhone(phone)) { toast("Enter a valid phone number.", "error"); return; }
    checkoutStep = 2;
    renderCheckoutStep();
    fetchDeliveryRates();
  } else if (checkoutStep === 2) {
    const street = document.getElementById("buyerStreet").value.trim();
    const city   = document.getElementById("buyerCity").value.trim();
    const state  = document.getElementById("buyerState").value;
    if (!street || !city || !state) { toast("Enter your full delivery address.", "error"); return; }
    if (!selectedCourier) { toast("Select a delivery courier.", "error"); return; }
    checkoutStep = 3;
    renderCheckoutStep();
  } else if (checkoutStep === 3) {
    initiatePayment();
  }
});

document.getElementById("checkoutBackBtn")?.addEventListener("click", () => {
  checkoutStep = Math.max(1, checkoutStep - 1);
  renderCheckoutStep();
});

async function fetchDeliveryRates() {
  const opts = document.getElementById("courierOptions");
  opts.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted)">Getting delivery rates…</div>`;
  selectedCourier = null;

  try {
    const { callGetDeliveryRates } = await import("./firebase-config.js");
    const city  = document.getElementById("buyerCity").value.trim() || "Lagos";
    const state = document.getElementById("buyerState").value || "Lagos";
    const res   = await callGetDeliveryRates({ city, state, sellerState: seller.state || "Lagos", items: cart });
    const rates = res.data?.rates || [];

    if (!rates.length) throw new Error("No rates");
    opts.innerHTML = rates.map(r => `
      <div class="courier-option" data-code="${r.id}" onclick="selectCourier(this,${r.fee},'${r.name}')">
        <div>
          <div class="courier-name">${r.name}</div>
          <div class="courier-eta">${r.eta || "2–5 days"}</div>
        </div>
        <div class="courier-price">${fmt(r.fee)}</div>
      </div>`).join("");
  } catch {
    // Smart fallback — three realistic options based on state distance
    const state       = document.getElementById("buyerState").value || "Lagos";
    const sellerState = seller.state || "Lagos";
    const sameState   = state.toLowerCase() === sellerState.toLowerCase();
    const lagosNeighbors = ["Ogun","Oyo","Osun","Ondo","Ekiti"];
    const isNeighbor  = lagosNeighbors.includes(state) && sellerState === "Lagos";

    // Pricing tiers: same-state · neighbor · far state
    let std, exp, sd;
    if (sameState)      { std = 1500; exp = 2800; sd = 4500; }
    else if (isNeighbor){ std = 2200; exp = 3800; sd = null; }   // no same-day for inter-state
    else                { std = 3500; exp = 5500; sd = null; }

    let html = `
      <div class="courier-option" onclick="selectCourier(this,${std},'Standard Delivery')">
        <div><div class="courier-name">Standard Delivery</div><div class="courier-eta">3–5 business days</div></div>
        <div class="courier-price">${fmt(std)}</div>
      </div>
      <div class="courier-option" onclick="selectCourier(this,${exp},'Express Delivery')">
        <div><div class="courier-name">Express Delivery</div><div class="courier-eta">1–2 business days</div></div>
        <div class="courier-price">${fmt(exp)}</div>
      </div>`;

    if (sd) html += `
      <div class="courier-option" onclick="selectCourier(this,${sd},'Same-Day Delivery')">
        <div><div class="courier-name">Same-Day Delivery</div><div class="courier-eta">Within ${sameState ? "Lagos" : "the state"}, today</div></div>
        <div class="courier-price">${fmt(sd)}</div>
      </div>`;

    opts.innerHTML = html;
  }
}

window.selectCourier = (el, fee, name) => {
  document.querySelectorAll(".courier-option").forEach(o => o.classList.remove("selected"));
  el.classList.add("selected");
  selectedCourier = { name, fee };
  renderCartSummary(fee);
};

function renderOrderSummary() {
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const delivery = selectedCourier?.fee || 0;
  const totals   = calculateTotal(subtotal, delivery);

  document.getElementById("orderSummary").innerHTML = `
    <h4 style="margin-bottom:12px">Order Summary</h4>
    ${cart.map(i => `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:600">${i.name}</div>
          ${i.variant ? `<div style="font-size:.8125rem;color:var(--text-muted)">${i.variant}</div>` : ""}
          <div style="font-size:.8125rem">Qty: ${i.qty}</div>
        </div>
        <div style="font-weight:700">${fmt(i.price * i.qty)}</div>
      </div>`).join("")}
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${fmt(totals.subtotal)}</span></div>
      ${delivery ? `<div style="display:flex;justify-content:space-between"><span>Delivery (${selectedCourier?.name})</span><span>${fmt(delivery)}</span></div>` : ""}
      ${totals.fee ? `<div style="display:flex;justify-content:space-between"><span>VAT + Paystack</span><span>${fmt(totals.fee)}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.125rem;border-top:2px solid var(--text);margin-top:8px;padding-top:8px">
        <span>Total</span><span>${fmt(totals.total)}</span>
      </div>
    </div>`;
}

// ── Paystack Payment ───────────────────────────────────────────
async function initiatePayment() {
  const name  = document.getElementById("buyerName").value.trim();
  const phone = normalisePhone(document.getElementById("buyerPhone").value.trim());
  const email = document.getElementById("buyerEmail").value.trim() || `${phone.replace("+","")}@storvix.ng`;

  const street = document.getElementById("buyerStreet").value.trim();
  const city   = document.getElementById("buyerCity").value.trim();
  const state  = document.getElementById("buyerState").value;

  const subtotal    = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const deliveryFee = selectedCourier?.fee || 0;
  const totals      = calculateTotal(subtotal, deliveryFee);
  const orderNumber = generateOrderNumber();
  const payRef      = `STX_${Date.now()}_${shortRef(4)}`;

  // Pre-save order as pending
  const orderData = {
    orderNumber, sellerId: seller.id, sellerSlug: seller.slug,
    buyer: { name, phone, email },
    address: { street, city, state },
    items: cart.map(i => ({ productId: i.id, name: i.name, price: i.price, qty: i.qty, variant: i.variant || "" })),
    subtotal, deliveryFee, storvixFee: totals.fee, total: totals.total,
    deliveryCourier: selectedCourier?.name || "",
    status: "pending", paymentRef: payRef, paymentStatus: "pending",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };

  let orderId;
  try {
    const ref = await addDoc(collection(db, "sellers", seller.id, "orders"), orderData);
    orderId = ref.id;
  } catch (e) {
    toast("Failed to create order. Please try again.", "error");
    return;
  }

  // Open Paystack
  const handler = window.PaystackPop?.setup({
    key:      PAYSTACK_PUBLIC_KEY,
    email,
    amount:   totals.total * 100, // kobo
    currency: "NGN",
    ref:      payRef,
    metadata: {
      custom_fields: [
        { display_name: "Seller",       variable_name: "seller_slug",   value: seller.slug },
        { display_name: "Order Number", variable_name: "order_number",  value: orderNumber },
        { display_name: "Order ID",     variable_name: "order_id",      value: orderId },
        { display_name: "Seller ID",    variable_name: "seller_id",     value: seller.id },
        { display_name: "Buyer Phone",  variable_name: "buyer_phone",   value: phone },
      ],
    },
    callback: async (response) => {
      // Payment completed — webhook will handle wallet credit + stock decrement
      // Optimistically update order status (security rule allows status/paymentStatus update)
      try {
        await updateDoc(doc(db, "sellers", seller.id, "orders", orderId), {
          paymentStatus: "paid", status: "confirmed",
          paymentRef: response.reference, updatedAt: serverTimestamp(),
        });
      } catch (e) { console.warn("Order update failed (webhook will retry):", e); }

      // Clear cart
      cart = [];
      renderCart();
      document.getElementById("checkoutModal").classList.remove("open");
      document.body.style.overflow = "";

      // Success message
      document.getElementById("storeStatePage").style.display = "";
      document.getElementById("storeStatePage").innerHTML = `
        <div class="store-state-page">
          <div class="store-state-box">
            <div class="store-state-icon">🎉</div>
            <h2 class="store-state-title">Order Confirmed!</h2>
            <p class="store-state-text">
              Thank you, ${name}! Your order <strong>${orderNumber}</strong> has been placed.
              You'll receive a WhatsApp confirmation shortly.
            </p>
            <button class="btn btn-primary" style="margin-top:24px" onclick="location.reload()">Continue Shopping</button>
          </div>
        </div>`;
    },
    onClose: async () => {
      // Payment cancelled — remove pending order
      try {
        await updateDoc(doc(db, "sellers", seller.id, "orders", orderId), { status: "cancelled", paymentStatus: "failed" });
      } catch {}
      toast("Payment cancelled.", "info");
    },
  });

  if (!handler) { toast("Payment could not be initialized. Please try again.", "error"); return; }
  handler.openIframe();
}

// ── State Pages ────────────────────────────────────────────────
function showStatePage(icon, title, text) {
  document.getElementById("pageLoader").style.display = "none";
  const el = document.getElementById("storeStatePage");
  el.style.display = "";
  el.innerHTML = `
    <div class="store-state-page">
      <div class="store-state-box">
        <div class="store-state-icon">${icon}</div>
        <h2 class="store-state-title">${title}</h2>
        <p class="store-state-text">${text}</p>
        <a href="https://storvix.ng" style="color:#6C47FF;font-weight:600;margin-top:16px;display:block">
          Open your own store on Storvix →
        </a>
      </div>
    </div>`;
}

// ── Start ──────────────────────────────────────────────────────
init();