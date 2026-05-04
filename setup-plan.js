// ============================================================
//  STORVIX — Paystack Plans Setup Script (setup-plans.js)
//
//  Creates the 4 subscription plans (Lite, Basic, Plus, Pro)
//  on your Paystack account via API, then prints the plan codes
//  to paste into js/plans.js.
//
//  Usage:
//    node setup-plans.js test    # use test keys
//    node setup-plans.js live    # use live keys
//
//  Or just: node setup-plans.js  (defaults to test)
// ============================================================

// ─── Your Paystack secret keys ───────────────────────────────
const SECRETS = {
  test: "sk_test_3feb85f3a4cde707a3382a577d124ec86929b29a",
  live: "sk_live_df6ac8c86ec4ed7c602897d7f40c5338bbba8028",
};

const mode   = (process.argv[2] || "test").toLowerCase();
const secret = SECRETS[mode];
if (!secret) {
  console.error(`❌ Unknown mode "${mode}". Use "test" or "live".`);
  process.exit(1);
}

// ─── Plan definitions (must match plans.js) ──────────────────
const PLANS = [
  { name: "Storvix Lite",  amount: 2100,   interval: "monthly", description: "25 products · Storefront · Basic" },
  { name: "Storvix Basic", amount: 4850,   interval: "monthly", description: "100 products · Coupons · Payment Links · Analytics" },
  { name: "Storvix Plus",  amount: 9800,   interval: "monthly", description: "1000 products · Cart Tracking · Same-day payouts · Abandoned cart" },
  { name: "Storvix Pro",   amount: 15600,  interval: "monthly", description: "Unlimited products · CSV export · Priority support" },

  { name: "Storvix Lite (Annual)",  amount: 21000,   interval: "annually", description: "Lite plan billed yearly" },
  { name: "Storvix Basic (Annual)", amount: 48500,   interval: "annually", description: "Basic plan billed yearly" },
  { name: "Storvix Plus (Annual)",  amount: 98000,   interval: "annually", description: "Plus plan billed yearly" },
  { name: "Storvix Pro (Annual)",   amount: 156000,  interval: "annually", description: "Pro plan billed yearly" },
];

// ─── Helpers ──────────────────────────────────────────────────
async function callPaystack(path, method = "GET", body = null) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${secret}`,
      "Content-Type":  "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.status) throw new Error(data.message || "Paystack API error");
  return data;
}

async function listExistingPlans() {
  const data = await callPaystack("/plan?perPage=100");
  return data.data || [];
}

async function createPlan(plan) {
  const data = await callPaystack("/plan", "POST", {
    name:        plan.name,
    amount:      plan.amount * 100,         // Paystack expects kobo
    interval:    plan.interval,
    description: plan.description,
    currency:    "NGN",
  });
  return data.data;
}

// ─── Main ─────────────────────────────────────────────────────
(async () => {
  console.log(`\n🚀 Storvix — Paystack Plans Setup (${mode.toUpperCase()} mode)\n`);

  let existing;
  try {
    existing = await listExistingPlans();
    console.log(`Found ${existing.length} existing plan(s) on this account.\n`);
  } catch (err) {
    console.error("❌ Could not connect to Paystack:", err.message);
    console.error("   Check your secret key and internet connection.");
    process.exit(1);
  }

  const codeMap = {};

  for (const plan of PLANS) {
    process.stdout.write(`  ${plan.name.padEnd(28)} `);

    // Skip if already exists with same name
    const dupe = existing.find(p =>
      p.name === plan.name &&
      p.amount === plan.amount * 100 &&
      p.interval === plan.interval
    );
    if (dupe) {
      console.log(`✓  exists  ${dupe.plan_code}`);
      codeMap[plan.name] = dupe.plan_code;
      continue;
    }

    try {
      const created = await createPlan(plan);
      console.log(`✓  created ${created.plan_code}`);
      codeMap[plan.name] = created.plan_code;
    } catch (err) {
      console.log(`✗  failed: ${err.message}`);
    }
  }

  // ─── Print snippet to paste into plans.js ──────────────────
  console.log("\n" + "═".repeat(60));
  console.log("\n📋 Paste this into js/plans.js:\n");

  const out = {
    lite:  { monthly: codeMap["Storvix Lite"]            || "MISSING",
             annual:  codeMap["Storvix Lite (Annual)"]   || "MISSING" },
    basic: { monthly: codeMap["Storvix Basic"]           || "MISSING",
             annual:  codeMap["Storvix Basic (Annual)"]  || "MISSING" },
    plus:  { monthly: codeMap["Storvix Plus"]            || "MISSING",
             annual:  codeMap["Storvix Plus (Annual)"]   || "MISSING" },
    pro:   { monthly: codeMap["Storvix Pro"]             || "MISSING",
             annual:  codeMap["Storvix Pro (Annual)"]    || "MISSING" },
  };

  console.log("export const PAYSTACK_PLAN_CODES = {");
  for (const [tier, codes] of Object.entries(out)) {
    console.log(`  ${tier.padEnd(6)}: { monthly: "${codes.monthly}", annual: "${codes.annual}" },`);
  }
  console.log("};\n");

  console.log("═".repeat(60));
  console.log("\n✅ Done!\n");
})();