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
  test: "pk_test_3eb7b7068e4cd9013af8b40db9e10f3537ef0d50",  // Replace with your actual test pk
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

// ── Plan Access Check ──────────────────────────────────────────
export function canAccess(seller, feature) {
  if (!seller) return false;
  const status = seller.planStatus;
  if (!["trial", "active", "grace"].includes(status)) return false;
  const plan = PLANS[seller.plan] || PLANS.lite;
  return !!plan.features[feature];
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