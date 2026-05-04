// ============================================================
//  STORVIX — Onboarding Wizard (js/onboarding.js)
// ============================================================

import {
  auth, db, onAuthStateChanged, getSeller, createSeller,
  uploadImage, checkSlugAvailable, serverTimestamp, doc, updateDoc,
  Timestamp,
} from "./firebase-config.js";
import {
  toast, btnLoading, getParam, slugify, copyToClipboard,
  NIGERIAN_STATES, NIGERIAN_BANKS, PRODUCT_CATEGORIES, isValidPhone,
  normalisePhone, debounce, storeUrl,
} from "./utils.js";
import { callVerifyBankAccount } from "./firebase-config.js";
import { PAYSTACK_PUBLIC_KEY, STARTER_PACK } from "./plans.js";

// ── State ──────────────────────────────────────────────────
let currentUser  = null;
let currentStep  = 1;
const TOTAL      = 5;
let formData     = {
  plan:          getParam("plan")    || sessionStorage.getItem("selectedPlan")    || "lite",
  billing:       getParam("billing") || sessionStorage.getItem("selectedBilling") || "monthly",
  ownerName:     sessionStorage.getItem("ownerName") || "",
  categories:    [],
  accentColor:   "#6C47FF",
  logoFile:      null,
  bannerFile:    null,
  bankVerified:  false,
  bank:          {},
};

const PRESET_COLORS = ["#6C47FF","#DC2626","#16A34A","#2563EB","#D97706","#DB2777","#0891B2","#7C3AED"];

// ── Boot ───────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "auth.html"; return; }
  currentUser = user;

  const existing = await getSeller(user.uid);
  if (existing?.slug) { window.location.href = "dashboard.html"; return; }

  // Pre-fill name
  const name = formData.ownerName || user.displayName || "";
  if (name) document.getElementById("ownerName").value = name;

  initStates();
  initBanks();
  initCategories();
  initColors();
  initUploads();
  showStep(1);

  document.getElementById("onboardPage").style.display = "";
});

// ── Step Navigation ─────────────────────────────────────────
function showStep(n) {
  document.querySelectorAll(".onboard-step").forEach(s => s.classList.remove("active"));
  const el = document.getElementById("step" + n);
  if (el) el.classList.add("active");
  currentStep = n;
  const pct = ((n - 1) / (TOTAL - 1)) * 100;
  document.getElementById("progressFill").style.width = pct + "%";
  document.getElementById("stepInfo").textContent = `Step ${n} of ${TOTAL}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Init: Nigerian States ───────────────────────────────────
function initStates() {
  const sel = document.getElementById("stateSelect");
  NIGERIAN_STATES.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  });
}

// ── Init: Banks ─────────────────────────────────────────────
function initBanks() {
  const sel = document.getElementById("bankSelect");
  NIGERIAN_BANKS.forEach(b => {
    const opt = document.createElement("option");
    opt.value = b.code; opt.textContent = b.name;
    opt.dataset.name = b.name;
    sel.appendChild(opt);
  });
}

// ── Init: Categories ────────────────────────────────────────
function initCategories() {
  const wrap = document.getElementById("categoryChips");
  PRODUCT_CATEGORIES.forEach(cat => {
    const chip = document.createElement("div");
    chip.className = "chip"; chip.textContent = cat; chip.dataset.cat = cat;
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      const idx = formData.categories.indexOf(cat);
      if (idx === -1) formData.categories.push(cat);
      else formData.categories.splice(idx, 1);
    });
    wrap.appendChild(chip);
  });
}

// ── Init: Brand Colors ───────────────────────────────────────
function initColors() {
  const wrap = document.getElementById("colorPresets");
  PRESET_COLORS.forEach(hex => {
    const sw = document.createElement("div");
    sw.className = "color-preset";
    sw.style.background = hex;
    if (hex === formData.accentColor) sw.classList.add("active");
    sw.addEventListener("click", () => {
      setAccent(hex);
      wrap.querySelectorAll(".color-preset").forEach(s => s.classList.remove("active"));
      sw.classList.add("active");
    });
    wrap.appendChild(sw);
  });

  const picker = document.getElementById("colorPicker");
  const hexIn  = document.getElementById("colorHex");
  picker.value = formData.accentColor;
  hexIn.value  = formData.accentColor;

  picker.addEventListener("input", () => { setAccent(picker.value); hexIn.value = picker.value; });
  hexIn.addEventListener("input", () => {
    const v = hexIn.value;
    if (/^#[0-9a-f]{6}$/i.test(v)) { setAccent(v); picker.value = v; }
  });
}

function setAccent(hex) {
  formData.accentColor = hex;
  document.getElementById("colorHex").value  = hex;
  document.getElementById("colorPicker").value = hex;
}

// ── Init: File Uploads ──────────────────────────────────────
function initUploads() {
  // Logo
  const logoArea = document.getElementById("logoUploadArea");
  const logoFile = document.getElementById("logoFile");
  logoArea.addEventListener("click", () => logoFile.click());
  logoFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast("Logo must be under 2MB.", "error"); return; }
    formData.logoFile = file;
    const url = URL.createObjectURL(file);
    const prev = document.getElementById("logoPreview");
    prev.src = url; prev.style.display = "block";
    document.getElementById("logoUploadPlaceholder").style.display = "none";
  });

  // Banner
  const bannerArea = document.getElementById("bannerUploadArea");
  const bannerFile = document.getElementById("bannerFile");
  bannerArea.addEventListener("click", () => bannerFile.click());
  bannerFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    formData.bannerFile = file;
    const url = URL.createObjectURL(file);
    const prev = document.getElementById("bannerPreview");
    prev.src = url; prev.style.display = "block";
    document.getElementById("bannerUploadPlaceholder").style.display = "none";
  });
}

// ── Slug ────────────────────────────────────────────────────
const slugInput    = document.getElementById("slugInput");
const slugPreview  = document.getElementById("slugPreview");
const slugStatus   = document.getElementById("slugStatus");

document.getElementById("storeName")?.addEventListener("input", (e) => {
  const auto = slugify(e.target.value);
  if (!slugInput._userEdited) {
    slugInput.value = auto;
    updateSlugPreview(auto);
    checkSlug(auto);
  }
});

slugInput.addEventListener("input", (e) => {
  slugInput._userEdited = true;
  const val = slugify(e.target.value);
  updateSlugPreview(val);
  checkSlug(val);
});

function updateSlugPreview(slug) {
  slugPreview.textContent = slug ? `${slug}.storvix.ng` : "your-store.storvix.ng";
}

const checkSlug = debounce(async (slug) => {
  if (!slug || slug.length < 3) {
    slugStatus.textContent = "";
    return;
  }
  slugStatus.textContent = "Checking…";
  slugStatus.className   = "slug-status";
  const available = await checkSlugAvailable(slug, currentUser?.uid);
  if (available) {
    slugStatus.textContent = "✓ Available!";
    slugStatus.className   = "slug-status available";
  } else {
    slugStatus.textContent = "✗ Already taken. Try another.";
    slugStatus.className   = "slug-status taken";
  }
}, 500);

// ── Bank Verify ─────────────────────────────────────────────
document.getElementById("verifyBankBtn")?.addEventListener("click", async () => {
  const btn      = document.getElementById("verifyBankBtn");
  const accountN = document.getElementById("accountNumber").value.trim();
  const bankSel  = document.getElementById("bankSelect");
  const bankCode = bankSel.value;
  const bankName = bankSel.options[bankSel.selectedIndex]?.dataset.name;

  if (!bankCode)             { toast("Select a bank first.", "error"); return; }
  if (accountN.length !== 10){ toast("Account number must be 10 digits.", "error"); return; }

  btnLoading(btn, true, "Verify");
  document.getElementById("accountNameResult").textContent = "";

  try {
    const res = await callVerifyBankAccount({ accountNumber: accountN, bankCode });
    const name = res.data?.accountName;
    if (name) {
      document.getElementById("accountNameResult").textContent = `✓ ${name}`;
      formData.bank = { bankName, bankCode, accountNumber: accountN, accountName: name };
      formData.bankVerified = true;
    } else {
      toast("Account not found. Check the details.", "error");
    }
  } catch {
    // Fallback: accept manually
    document.getElementById("accountNameResult").textContent = "Could not verify automatically — account saved.";
    formData.bank = { bankName, bankCode, accountNumber: accountN, accountName: "Unverified" };
    formData.bankVerified = false;
  }
  btnLoading(btn, false, "Verify");
});

// ── Step Actions ────────────────────────────────────────────
document.getElementById("step1Next")?.addEventListener("click", () => {
  const name      = document.getElementById("ownerName").value.trim();
  const storeName = document.getElementById("storeName").value.trim();
  const city      = document.getElementById("cityInput").value.trim();
  const state     = document.getElementById("stateSelect").value;
  const whatsapp  = document.getElementById("whatsappNumber").value.trim();

  if (!name)      { toast("Enter your full name.", "error"); return; }
  if (!storeName) { toast("Enter your store name.", "error"); return; }
  if (!city)      { toast("Enter your city.", "error"); return; }
  if (!state)     { toast("Select your state.", "error"); return; }
  if (!whatsapp)  { toast("Enter your WhatsApp number.", "error"); return; }
  if (!isValidPhone(whatsapp)) { toast("Enter a valid WhatsApp number.", "error"); return; }

  formData.ownerName  = name;
  formData.storeName  = storeName;
  formData.city       = city;
  formData.state      = state;
  formData.whatsapp   = normalisePhone(whatsapp);

  // Auto-set slug if not yet visited step 2
  if (!slugInput.value) {
    const auto = slugify(storeName);
    slugInput.value = auto;
    updateSlugPreview(auto);
    checkSlug(auto);
  }

  showStep(2);
});

document.getElementById("step2Back")?.addEventListener("click", () => showStep(1));
document.getElementById("step2Next")?.addEventListener("click", async () => {
  const slug = slugify(slugInput.value.trim());
  if (!slug || slug.length < 3) { toast("Enter a valid store URL (min 3 characters).", "error"); return; }
  if (slugStatus.classList.contains("taken")) { toast("That URL is taken. Choose another.", "error"); return; }

  const available = await checkSlugAvailable(slug, currentUser?.uid);
  if (!available) { toast("That URL is taken. Choose another.", "error"); return; }

  formData.slug    = slug;
  formData.tagline = document.getElementById("taglineInput").value.trim();
  formData.about   = document.getElementById("aboutInput").value.trim();

  // Update go-live URL
  document.getElementById("storeLiveUrl").href        = storeUrl(slug);
  document.getElementById("storeLiveUrl").textContent = storeUrl(slug);

  showStep(3);
});

document.getElementById("step3Back")?.addEventListener("click", () => showStep(2));
document.getElementById("step3Next")?.addEventListener("click", () => showStep(4));
document.getElementById("step4Back")?.addEventListener("click", () => showStep(3));

document.getElementById("step4Next")?.addEventListener("click", () => {
  if (!formData.bank.bankCode && !formData.bankVerified) {
    // Allow skipping bank — seller can add later
    toast("Bank account not verified — you can add it later in Settings.", "info");
  }
  showStep(5);
});

document.getElementById("step5Back")?.addEventListener("click", () => showStep(4));

// Copy URL
document.getElementById("copyStoreUrl")?.addEventListener("click", () => {
  copyToClipboard(storeUrl(formData.slug || "your-store"), "Store URL copied!");
});

// ── Final Submit: pay ₦1,000 starter pack ────────────────────
document.getElementById("goToDashboard")?.addEventListener("click", async () => {
  const btn = document.getElementById("goToDashboard");

  if (!window.PaystackPop) {
    toast("Payment library still loading — try again in a moment.", "error");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Opening payment…";

  // Open Paystack — we charge BEFORE creating the seller, so failed payment = no seller created
  const handler = window.PaystackPop.setup({
    key:      PAYSTACK_PUBLIC_KEY,
    email:    currentUser.email,
    amount:   STARTER_PACK.amount * 100, // kobo
    currency: "NGN",
    ref:      `STX_STARTER_${currentUser.uid}_${Date.now()}`,
    metadata: {
      custom_fields: [
        { display_name: "Type",       variable_name: "type",       value: "starter_pack" },
        { display_name: "User ID",    variable_name: "user_id",    value: currentUser.uid },
        { display_name: "Store",      variable_name: "store_name", value: formData.storeName },
      ],
    },
    callback: function (response) {
      // Payment succeeded — create the seller account
      finalizeSellerCreation(response.reference, btn);
    },
    onClose: function () {
      toast("Payment cancelled. Please complete payment to create your store.", "info");
      btn.disabled = false;
      btn.textContent = "Pay ₦1,000 & Launch Store →";
    },
  });

  handler.openIframe();
});

async function finalizeSellerCreation(paymentRef, btn) {
  btn.disabled = true;
  btn.textContent = "Creating your store…";

  try {
    // Upload logo if provided
    let logoUrl = "";
    if (formData.logoFile) {
      logoUrl = await uploadImage(currentUser.uid, formData.logoFile, "logo.png");
    }

    // Upload banner if provided
    let bannerUrl = "";
    if (formData.bannerFile) {
      bannerUrl = await uploadImage(currentUser.uid, formData.bannerFile, "banner.jpg");
    }

    // Calculate starter pack expiry: now + 30 days
    const starterExpiry = new Date();
    starterExpiry.setDate(starterExpiry.getDate() + STARTER_PACK.durationDays);

    // Create seller document with starter pack status
    await createSeller(currentUser.uid, {
      ownerName:     formData.ownerName,
      email:         currentUser.email,
      storeName:     formData.storeName,
      slug:          formData.slug,
      plan:          "pro",                    // Starter = Pro features
      planStatus:    "starter",                // Special status for new sellers
      starterExpiry: Timestamp.fromDate(starterExpiry),
      starterPaidAt: serverTimestamp(),
      starterPaymentRef: paymentRef,
      billing:       "monthly",
      categories:    formData.categories,
      city:          formData.city,
      state:         formData.state,
      whatsapp:      formData.whatsapp,
      tagline:       formData.tagline || "",
      about:         formData.about   || "",
      accentColor:   formData.accentColor,
      logoUrl,
      bannerUrl,
      bank:          formData.bank || {},
      bankVerified:  formData.bankVerified,
    });

    // Clean up session storage
    sessionStorage.removeItem("selectedPlan");
    sessionStorage.removeItem("selectedBilling");
    sessionStorage.removeItem("ownerName");

    toast("Store created! Welcome to Storvix.", "success");
    setTimeout(() => { window.location.href = "dashboard.html"; }, 1000);
  } catch (err) {
    console.error("Onboarding error:", err);
    toast("Payment received but store creation failed: " + err.message + ". Contact support with your payment reference.", "error");
    btn.disabled = false;
    btn.textContent = "Retry";
  }
}
