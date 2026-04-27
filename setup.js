#!/usr/bin/env node
// ============================================================
//  STORVIX — Automated Setup Script (setup.js)
//  Run with: node setup.js
//
//  This script automates:
//  1. Creating the 8 Paystack subscription plans
//  2. Writing the plan codes back into js/plans.js
//  3. Setting the 4 Firebase Cloud Function secrets
//
//  It does NOT automate (Google/GO54 don't expose APIs for these):
//  - Adding Firebase authorized domains
//  - Setting up wildcard DNS at GO54
// ============================================================

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ── Credentials (from .env or hardcoded for first run) ──────
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY
  || "sk_live_df6ac8c86ec4ed7c602897d7f40c5338bbba8028";

const SECRETS = {
  PAYSTACK_SECRET_KEY:  process.env.PAYSTACK_SECRET_KEY  || "sk_live_df6ac8c86ec4ed7c602897d7f40c5338bbba8028",
  SENDCHAMP_PUBLIC_KEY: process.env.SENDCHAMP_PUBLIC_KEY || "sendchamp_live_$2a$10$psk9ugtML/.5fLmK44VGyuaVCAPYw4cbTp1rwG5MxSIiUG8B62Oe.",
  SHIPBUBBLE_API_KEY:   process.env.SHIPBUBBLE_API_KEY   || "sb_prod_13cb49c482e52a78b67065440ab3b3e690fe0496c021622895db1d5be7d5aaa3",
  RESEND_API_KEY:       process.env.RESEND_API_KEY       || "re_hH21MD7D_AQxg6HjgT2mKxiMd5thZpwg2",
};

// ── Plan Definitions ─────────────────────────────────────────
const PLANS = [
  { key: "lite",  billing: "monthly", name: "Storvix Lite Monthly",  amount: 210000,   interval: "monthly"  },
  { key: "lite",  billing: "annual",  name: "Storvix Lite Annual",   amount: 2100000,  interval: "annually" },
  { key: "basic", billing: "monthly", name: "Storvix Basic Monthly", amount: 485000,   interval: "monthly"  },
  { key: "basic", billing: "annual",  name: "Storvix Basic Annual",  amount: 4850000,  interval: "annually" },
  { key: "plus",  billing: "monthly", name: "Storvix Plus Monthly",  amount: 980000,   interval: "monthly"  },
  { key: "plus",  billing: "annual",  name: "Storvix Plus Annual",   amount: 9800000,  interval: "annually" },
  { key: "pro",   billing: "monthly", name: "Storvix Pro Monthly",   amount: 1560000,  interval: "monthly"  },
  { key: "pro",   billing: "annual",  name: "Storvix Pro Annual",    amount: 15600000, interval: "annually" },
];

// ── Helpers ──────────────────────────────────────────────────
function log(msg, color = "")  {
  const colors = { green: "\x1b[32m", red: "\x1b[31m", blue: "\x1b[34m", yellow: "\x1b[33m", reset: "\x1b[0m" };
  console.log((colors[color] || "") + msg + colors.reset);
}

async function paystackRequest(method, path, body) {
  const fetch = (await import("node-fetch")).default;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`https://api.paystack.co${path}`, opts);
  return res.json();
}

// ── Step 1: Get Existing Plans (avoid duplicates) ──────────
async function getExistingPlans() {
  const data = await paystackRequest("GET", "/plan?perPage=100");
  if (!data.status) throw new Error("Failed to fetch plans: " + data.message);
  return data.data || [];
}

// ── Step 2: Create or Reuse a Plan ─────────────────────────
async function ensurePlan(planDef, existing) {
  const match = existing.find(p =>
    p.name === planDef.name &&
    p.amount === planDef.amount &&
    p.interval === planDef.interval
  );
  if (match) {
    log(`  ↺  Reusing existing: ${planDef.name} → ${match.plan_code}`, "yellow");
    return match.plan_code;
  }

  const data = await paystackRequest("POST", "/plan", {
    name:     planDef.name,
    amount:   planDef.amount,
    interval: planDef.interval,
    currency: "NGN",
    description: `Storvix ${planDef.key} subscription (${planDef.billing})`,
  });
  if (!data.status) throw new Error(`Failed to create ${planDef.name}: ${data.message}`);
  log(`  ✓  Created: ${planDef.name} → ${data.data.plan_code}`, "green");
  return data.data.plan_code;
}

// ── Step 3: Create All Plans ───────────────────────────────
async function createAllPlans() {
  log("\n══════════════════════════════════════════════", "blue");
  log("  STEP 1 — Creating Paystack Subscription Plans", "blue");
  log("══════════════════════════════════════════════\n", "blue");

  const existing = await getExistingPlans();
  const result = { lite: {}, basic: {}, plus: {}, pro: {} };

  for (const plan of PLANS) {
    const code = await ensurePlan(plan, existing);
    result[plan.key][plan.billing] = code;
  }
  return result;
}

// ── Step 4: Update plans.js ────────────────────────────────
function updatePlansFile(planCodes) {
  log("\n══════════════════════════════════════════════", "blue");
  log("  STEP 2 — Updating js/plans.js", "blue");
  log("══════════════════════════════════════════════\n", "blue");

  const filePath = path.join(__dirname, "js", "plans.js");
  let content = fs.readFileSync(filePath, "utf-8");

  const newBlock = `export const PAYSTACK_PLAN_CODES = {
  lite:  { monthly: "${planCodes.lite.monthly}",  annual: "${planCodes.lite.annual}"  },
  basic: { monthly: "${planCodes.basic.monthly}", annual: "${planCodes.basic.annual}" },
  plus:  { monthly: "${planCodes.plus.monthly}",  annual: "${planCodes.plus.annual}"  },
  pro:   { monthly: "${planCodes.pro.monthly}",   annual: "${planCodes.pro.annual}"   },
};`;

  // Replace the existing PAYSTACK_PLAN_CODES block
  const re = /export const PAYSTACK_PLAN_CODES = \{[\s\S]*?\};/m;
  if (re.test(content)) {
    content = content.replace(re, newBlock);
  } else {
    log("  ✗  Could not find PAYSTACK_PLAN_CODES block to replace.", "red");
    return false;
  }

  fs.writeFileSync(filePath, content);
  log("  ✓  js/plans.js updated successfully", "green");
  return true;
}

// ── Step 5: Set Firebase Secrets ───────────────────────────
function setFirebaseSecrets() {
  log("\n══════════════════════════════════════════════", "blue");
  log("  STEP 3 — Setting Firebase Cloud Function Secrets", "blue");
  log("══════════════════════════════════════════════\n", "blue");

  // Verify firebase CLI installed
  try {
    execSync("firebase --version", { stdio: "ignore" });
  } catch {
    log("  ✗  Firebase CLI not found. Install with:  npm i -g firebase-tools", "red");
    log("     Then run:  firebase login  →  firebase use storvix-95bc8", "red");
    return false;
  }

  // Verify logged in
  try {
    execSync("firebase projects:list", { stdio: "ignore" });
  } catch {
    log("  ✗  You're not logged into Firebase CLI. Run:  firebase login", "red");
    return false;
  }

  for (const [name, value] of Object.entries(SECRETS)) {
    // Write secret to a temp file, then feed to Firebase CLI via --data-file
    // This avoids PowerShell's pipe handling issues with special chars like $
    const tmpFile = path.join(__dirname, `.tmp_secret_${name}`);
    try {
      fs.writeFileSync(tmpFile, value, { encoding: "utf8" });
      execSync(
        `firebase functions:secrets:set ${name} --data-file "${tmpFile}" --project storvix-95bc8 --force`,
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      log(`  ✓  Set: ${name}`, "green");
    } catch (e) {
      const msg = (e.stderr || e.stdout || e.message || "").toString();
      log(`  ✗  Failed to set ${name}`, "red");
      log(`     ${msg.split("\n")[0].slice(0, 120)}`, "red");
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }
  return true;
}

// ── Main ──────────────────────────────────────────────────
(async () => {
  log("\n⚡ STORVIX — Automated Setup\n", "blue");

  try {
    // 1. Create Paystack plans
    const planCodes = await createAllPlans();

    // 2. Update plans.js
    updatePlansFile(planCodes);

    // 3. Set Firebase secrets
    setFirebaseSecrets();

    // ── Done ────────────────────────────────────────────────
    log("\n══════════════════════════════════════════════", "green");
    log("  ✅ AUTOMATED SETUP COMPLETE", "green");
    log("══════════════════════════════════════════════\n", "green");

    log("Paystack plan codes saved:");
    log(JSON.stringify(planCodes, null, 2), "yellow");

    log("\n⚠️  Two manual steps remain (no API exists for these):\n", "yellow");
    log("  1. Firebase Authorized Domains", "yellow");
    log("     Go to: https://console.firebase.google.com/project/storvix-95bc8/authentication/settings", "blue");
    log("     Add: storvix.ng, localhost, your Vercel domain, your Railway domain\n", "yellow");
    log("  2. GO54 DNS Records", "yellow");
    log("     Log into your GO54 cPanel and add:", "yellow");
    log("       Type: A or CNAME · Name: @  · Value: <Vercel target>", "blue");
    log("       Type: CNAME       · Name: *  · Value: <Railway CNAME target>\n", "blue");

    log("Then deploy with:  firebase deploy --only functions,firestore,storage\n", "green");
  } catch (err) {
    log("\n✗ Setup failed: " + err.message + "\n", "red");
    process.exit(1);
  }
})();