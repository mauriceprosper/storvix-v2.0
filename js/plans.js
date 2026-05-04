// ============================================================
//  STORVIX — Plan Definitions & Access Control (js/plans.js)
//  Single source of truth for all plan logic.
//  IMPORTANT: Create Paystack plans on your dashboard first,
//  then fill in the plan codes below.
// ============================================================

// ─── TEST/LIVE TOGGLE ────────────────────────────────────────
// Set TEST_MODE = false when going live to production.
// When test mode, Paystack uses test keys + test cards work.
// When live mode, real cards charge real money.
export const TEST_MODE = true;

const PAYSTACK_KEYS = {
  test: "pk_test_3b8fa7936778cc23dbda491c5c5086d5bff41a56",
  live: "pk_live_51a8f2a4d502029c54e9141167aff10daf1e384b",
};

export const PAYSTACK_PUBLIC_KEY = TEST_MODE ? PAYSTACK_KEYS.test : PAYSTACK_KEYS.live;

// ── Paystack Plan Codes (create these on Paystack dashboard) ──
// Go to: dashboard.paystack.com → Subscriptions → Plans → Create Plan
export const PAYSTACK_PLAN_CODES = {
  lite:  { monthly: "PLN_lite_monthly_code",  annual: "PLN_lite_annual_code"  },
  basic: { monthly: "PLN_basic_monthly_code", annual: "PLN_basic_annual_code" },
  plus:  { monthly: "PLN_plus_monthly_code",  annual: "PLN_plus_annual_code"  },
  pro:   { monthly: "PLN_pro_monthly_code",   annual: "PLN_pro_annual_code"   },
};

// ── Plan Definitions ──────────────────────────────────────────
export const PLANS = {
  lite: {
    id: "lite", name: "Lite",
    monthly: 2100, annual: 21000, annualMonthly: 1750,
    products: 25, staff: 0,
    color: "#64748B",
    tagline: "Perfect for getting started",
    features: {
      storefront: true, orders: true, customers: true, basicDiscounts: true,
      localPayments: true, whatsapp: true, dva: true, payout24h: true,
      shipbubble: true,
      hideBranding: false, fullCustomization: false, seo: false, coupons: false,
      paymentLinks: false, testimonials: false, analytics: false,
      priorityPayouts: false, cartTracking: false, analytics90d: false,
      abandonedCart: false, globalPayments: false, sameDayPayouts: false,
      customDomain: false, csvExport: false, salesReports: false,
      dedicatedSupport: false,
    },
  },
  basic: {
    id: "basic", name: "Basic",
    monthly: 4850, annual: 48500, annualMonthly: 4042,
    products: 100, staff: 0,
    color: "#3B82F6",
    tagline: "For growing brands",
    features: {
      storefront: true, orders: true, customers: true, basicDiscounts: true,
      localPayments: true, whatsapp: true, dva: true, payout24h: true,
      shipbubble: true,
      hideBranding: true, fullCustomization: true, seo: true, coupons: true,
      paymentLinks: true, testimonials: true, analytics: true,
      priorityPayouts: true,
      cartTracking: false, analytics90d: false, abandonedCart: false,
      globalPayments: false, sameDayPayouts: false,
      customDomain: false, csvExport: false, salesReports: false,
      dedicatedSupport: false,
    },
  },
  plus: {
    id: "plus", name: "Storvix Plus",
    monthly: 9800, annual: 98000, annualMonthly: 8167,
    products: 1000, staff: 2,
    color: "#8B5CF6",
    tagline: "For serious sellers",
    popular: true,
    features: {
      storefront: true, orders: true, customers: true, basicDiscounts: true,
      localPayments: true, whatsapp: true, dva: true, payout24h: true,
      shipbubble: true,
      hideBranding: true, fullCustomization: true, seo: true, coupons: true,
      paymentLinks: true, testimonials: true, analytics: true,
      priorityPayouts: true, cartTracking: true, analytics90d: true,
      abandonedCart: true, globalPayments: true, sameDayPayouts: true,
      customDomain: "soon",
      csvExport: false, salesReports: false, dedicatedSupport: false,
    },
  },
  pro: {
    id: "pro", name: "Storvix Pro",
    monthly: 15600, annual: 156000, annualMonthly: 13000,
    products: Infinity, staff: 5,
    color: "#F59E0B",
    tagline: "Maximum power, zero limits",
    features: {
      storefront: true, orders: true, customers: true, basicDiscounts: true,
      localPayments: true, whatsapp: true, dva: true, payout24h: true,
      shipbubble: true,
      hideBranding: true, fullCustomization: true, seo: true, coupons: true,
      paymentLinks: true, testimonials: true, analytics: true,
      priorityPayouts: true, cartTracking: true, analytics90d: true,
      abandonedCart: true, globalPayments: true, sameDayPayouts: true,
      customDomain: "soon",
      csvExport: true, salesReports: true, dedicatedSupport: true,
    },
  },
};

// ── Starter Pack (compulsory new-seller fee) ──────────────────
export const STARTER_PACK = {
  amount:    1000,                      // ₦1,000 one-time
  durationDays: 30,                     // 30 days of full Pro access
  name:      "Starter Pack",
  features:  "all",                     // all Pro features unlocked
};

// ── Plan Access Check ──────────────────────────────────────────
export function canAccess(seller, feature) {
  if (!seller) return false;
  const status = seller.planStatus;

  // Starter pack: full Pro features for 30 days
  if (status === "starter") {
    // Check if starter still valid
    const expiry = seller.starterExpiry?.toDate?.() || (seller.starterExpiry ? new Date(seller.starterExpiry) : null);
    if (expiry && expiry > new Date()) {
      return !!PLANS.pro.features[feature];
    }
    return false; // Expired starter — needs subscription
  }

  if (!["trial", "active", "grace"].includes(status)) return false;
  const plan = PLANS[seller.plan] || PLANS.lite;
  return !!plan.features[feature];
}

// ── Suspension Check (for storefront + dashboard gating) ──────
// Returns: { suspended: bool, reason: string, daysLeft: number|null }
export function getAccountStatus(seller) {
  if (!seller) return { suspended: true, reason: "No account", daysLeft: null };
  if (seller.suspended) return { suspended: true, reason: "Account suspended by admin", daysLeft: null };

  const status = seller.planStatus;
  const now = new Date();

  // Starter pack
  if (status === "starter") {
    const expiry = seller.starterExpiry?.toDate?.() || (seller.starterExpiry ? new Date(seller.starterExpiry) : null);
    if (!expiry) return { suspended: true, reason: "Invalid starter pack", daysLeft: null };
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) {
      return { suspended: true, reason: "Starter pack expired — pick a plan to continue", daysLeft: 0 };
    }
    return { suspended: false, reason: "starter", daysLeft };
  }

  // Active subscription
  if (status === "active") {
    const expiry = seller.planExpiry?.toDate?.() || (seller.planExpiry ? new Date(seller.planExpiry) : null);
    if (!expiry) return { suspended: false, reason: "active", daysLeft: null };
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) {
      return { suspended: true, reason: "Subscription expired — renew to continue", daysLeft: 0 };
    }
    return { suspended: false, reason: "active", daysLeft };
  }

  // Trial / grace
  if (status === "trial" || status === "grace") {
    return { suspended: false, reason: status, daysLeft: null };
  }

  // Anything else (no plan, expired) → suspended
  return { suspended: true, reason: "No active subscription", daysLeft: null };
}

// ── Plan Limit Check ──────────────────────────────────────────
export function isAtLimit(seller, type) {
  if (!seller) return true;
  const plan = PLANS[seller.plan] || PLANS.lite;
  if (type === "products") {
    const limit = plan.products;
    if (limit === Infinity) return false;
    return (seller.productCount || 0) >= limit;
  }
  if (type === "staff") {
    return (seller.staffCount || 0) >= plan.staff;
  }
  return false;
}

// ── Upgrade Messages ───────────────────────────────────────────
export const UPGRADE_MESSAGES = {
  products:       (plan) => `You've reached your ${PLANS[plan]?.products || 25} product limit. Upgrade to access more.`,
  paymentLinks:   () => "Payment Links & Invoices are available on Basic and above.",
  analytics:      () => "Analytics are available on Basic and above.",
  cartTracking:   () => "Cart Tracking is a Storvix Plus feature.",
  csvExport:      () => "Customer data export is a Storvix Pro feature.",
  abandonedCart:  () => "Abandoned Cart WhatsApp is a Storvix Plus feature.",
  globalPayments: () => "Global Payments are available on Plus and above.",
  salesReports:   () => "Sales report downloads are a Storvix Pro feature.",
  staff:          (plan) => plan === "plus"
    ? "Storvix Plus includes up to 2 staff accounts. Upgrade to Pro for 5."
    : "Staff accounts are available on Plus and above.",
};

export function getPlan(planId) {
  return PLANS[planId] || PLANS.lite;
}
