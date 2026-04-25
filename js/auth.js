// ============================================================
//  STORVIX — Auth Page Logic (js/auth.js)
//  Handles: login, signup, Google OAuth, plan selection
// ============================================================

import {
  auth, onAuthStateChanged, logIn, signUp, googleSignIn,
  resetPassword, setDisplayName, getSeller,
} from "./firebase-config.js";
import { toast, btnLoading, getParam } from "./utils.js";
import { PLANS } from "./plans.js";

// ── State ─────────────────────────────────────────────────
let waitingForPlan = false; // prevents redirect until plan is chosen
let selectedPlan    = "lite";
let selectedBilling = "monthly";

// ── Tab Switching ──────────────────────────────────────────
const tabs        = document.querySelectorAll(".auth-tab");
const loginPanel  = document.getElementById("loginPanel");
const signupPanel = document.getElementById("signupPanel");

function showTab(tab) {
  tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  loginPanel .classList.toggle("active", tab === "login");
  signupPanel.classList.toggle("active", tab === "signup");
}

tabs.forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));
document.getElementById("goToSignup")?.addEventListener("click", (e) => {
  e.preventDefault(); showTab("signup");
});

// Honor ?tab= param
if (getParam("tab") === "signup") showTab("signup");

// ── Auth State ──────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  if (waitingForPlan) return; // Plan selection in progress

  try {
    const seller = await getSeller(user.uid);
    if (!seller) {
      // Check if plan already chosen (e.g. Google sign-in on signup path)
      const plan = sessionStorage.getItem("selectedPlan");
      if (!plan) {
        waitingForPlan = true;
        showPlanSection();
        return;
      }
      window.location.href = `onboarding.html?plan=${plan}&billing=${sessionStorage.getItem("selectedBilling") || "monthly"}`;
    } else {
      window.location.href = "dashboard.html";
    }
  } catch {
    window.location.href = "dashboard.html";
  }
});

// ── Google Sign-In ──────────────────────────────────────────
["googleLoginBtn", "googleSignupBtn"].forEach(id => {
  document.getElementById(id)?.addEventListener("click", async () => {
    const btn = document.getElementById(id);
    btnLoading(btn, true, btn.textContent);
    try {
      await googleSignIn();
      // onAuthStateChanged handles redirect
    } catch (err) {
      toast(friendlyError(err.code), "error");
      btnLoading(btn, false, "Continue with Google");
    }
  });
});

// ── Login ───────────────────────────────────────────────────
document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn      = e.target.querySelector("button[type=submit]");

  if (!email || !password) { toast("Please enter your email and password.", "error"); return; }
  btnLoading(btn, true, "Log In");

  try {
    await logIn(email, password);
    // onAuthStateChanged handles redirect
  } catch (err) {
    toast(friendlyError(err.code), "error");
    btnLoading(btn, false, "Log In");
  }
});

// ── Signup ──────────────────────────────────────────────────
document.getElementById("signupForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name     = document.getElementById("signupName").value.trim();
  const email    = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const btn      = e.target.querySelector("button[type=submit]");

  if (!name)            { toast("Please enter your name.", "error"); return; }
  if (!email)           { toast("Please enter your email.", "error"); return; }
  if (password.length < 6) { toast("Password must be at least 6 characters.", "error"); return; }

  btnLoading(btn, true, "Create Account →");
  try {
    const cred = await signUp(email, password);
    await setDisplayName(cred.user, name);

    // Store name for onboarding to pre-fill
    sessionStorage.setItem("ownerName", name);

    // Show plan selection (don't redirect yet)
    waitingForPlan = true;
    showPlanSection();
    btnLoading(btn, false, "Create Account →");
  } catch (err) {
    toast(friendlyError(err.code), "error");
    btnLoading(btn, false, "Create Account →");
  }
});

// ── Forgot Password ─────────────────────────────────────────
document.getElementById("forgotBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  if (!email) { toast("Enter your email address first.", "error"); return; }
  try {
    await resetPassword(email);
    toast("Reset link sent! Check your inbox.", "success");
  } catch (err) {
    toast(friendlyError(err.code), "error");
  }
});

// ── Plan Selection ──────────────────────────────────────────
function showPlanSection() {
  document.getElementById("authSection").style.display = "none";
  document.getElementById("planSection").style.display  = "block";
  renderPlanCards();
}

function renderPlanCards() {
  const grid = document.getElementById("planCardsGrid");
  if (!grid) return;

  grid.innerHTML = Object.values(PLANS).map(p => {
    const price   = selectedBilling === "annual" ? p.annualMonthly : p.monthly;
    const period  = selectedBilling === "annual" ? "/mo (billed annually)" : "/mo";
    const popular = p.popular ? "popular" : "";

    return `
      <div class="plan-card ${popular} ${selectedPlan === p.id ? "selected" : ""}"
           data-plan="${p.id}" role="button" tabindex="0">
        <div class="plan-card-name">${p.name}</div>
        <div class="plan-card-price">₦${price.toLocaleString()}<span>${period}</span></div>
        <div class="plan-card-products">
          ${p.products === Infinity ? "Unlimited products" : p.products + " products"}
        </div>
      </div>`;
  }).join("");

  // Attach click handlers
  grid.querySelectorAll(".plan-card").forEach(card => {
    card.addEventListener("click", () => {
      selectedPlan = card.dataset.plan;
      grid.querySelectorAll(".plan-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
    });
  });
}

// Billing toggle
document.querySelectorAll(".plan-billing-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedBilling = btn.dataset.billing;
    document.querySelectorAll(".plan-billing-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderPlanCards();
  });
});

// Plan select CTA
document.getElementById("planSelectBtn")?.addEventListener("click", () => {
  sessionStorage.setItem("selectedPlan",    selectedPlan);
  sessionStorage.setItem("selectedBilling", selectedBilling);
  waitingForPlan = false;
  window.location.href = `onboarding.html?plan=${selectedPlan}&billing=${selectedBilling}`;
});

// ── Password Toggle ─────────────────────────────────────────
document.querySelectorAll(".pass-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
    btn.textContent = input.type === "password" ? "👁" : "🙈";
  });
});

// ── Error Messages ──────────────────────────────────────────
function friendlyError(code) {
  const map = {
    "auth/user-not-found":          "No account found with this email.",
    "auth/wrong-password":          "Incorrect password. Try again.",
    "auth/email-already-in-use":    "An account already exists with this email.",
    "auth/invalid-email":           "Please enter a valid email address.",
    "auth/weak-password":           "Password too weak. Use at least 6 characters.",
    "auth/too-many-requests":       "Too many attempts. Please try again later.",
    "auth/network-request-failed":  "Network error. Check your connection.",
    "auth/popup-closed-by-user":    "Google sign-in was cancelled.",
    "auth/invalid-credential":      "Incorrect email or password.",
    "auth/unauthorized-domain":     "Sign-in not allowed from this domain.",
    "auth/operation-not-allowed":   "This sign-in method is not enabled.",
  };
  return map[code] || "Something went wrong. Please try again.";
}
