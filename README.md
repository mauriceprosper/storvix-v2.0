# ⚡ Storvix — Nigerian E-Commerce SaaS Platform

**Built by Maurice Prosper · Saleford Digital Limited · Lagos, Nigeria**

A multi-tenant e-commerce platform where Nigerian product brands get their own branded online store at `slug.storvix.ng`. Inspired by Bumpa.

---

## 📁 Project Structure

```
storvix/
├── index.html              ← Landing page
├── auth.html               ← Login + signup + plan selection
├── onboarding.html         ← 5-step store setup wizard
├── dashboard.html          ← Seller dashboard (all tabs)
├── store.html              ← Buyer storefront (subdomain-loaded)
├── admin.html              ← Platform admin panel
├── pay.html                ← Custom payment link page
├── invoice.html            ← Invoice + receipt
│
├── css/
│   ├── global.css          ← Variables, reset, shared
│   ├── landing.css         ← Landing page
│   ├── auth.css            ← Auth + plan selection
│   ├── dashboard.css       ← Dashboard + onboarding + invoice
│   ├── store.css           ← Storefront + pay
│   └── admin.css           ← Admin panel
│
├── js/
│   ├── firebase-config.js  ← Firebase init + helpers
│   ├── plans.js            ← Plan definitions + canAccess()
│   ├── utils.js            ← fmt, toast, slugify, etc.
│   ├── auth.js             ← Auth + plan selection logic
│   ├── onboarding.js       ← 5-step wizard
│   ├── dashboard.js        ← All dashboard tabs
│   ├── store.js            ← Storefront + Paystack checkout
│   └── admin.js            ← Admin panel
│
├── functions/
│   ├── index.js            ← All 13 Cloud Functions
│   └── package.json
│
├── assets/                 ← Logo, favicon, OG image
├── server.js               ← Railway Express subdomain server
├── package.json            ← Railway deps
├── firebase.json           ← Firebase config
├── firestore.rules         ← Security rules
├── firestore.indexes.json  ← Composite indexes
├── storage.rules           ← Storage security
├── vercel.json             ← Vercel rewrites
├── .env.example            ← Environment template
└── .gitignore
```

---

## 🚀 Deployment Guide

### **Quick Start (Automated)**

Most of the setup is automated. From the project folder:

```bash
# 1. Install Firebase CLI (one-time)
npm install -g firebase-tools
firebase login
firebase use storvix-95bc8

# 2. Install dependencies
npm install
cd functions && npm install && cd ..

# 3. Run automated setup — creates Paystack plans + sets secrets
npm run setup
```

The `setup` script will:
- ✅ Create the 8 Paystack subscription plans via Paystack's API
- ✅ Write the returned plan codes back into `js/plans.js`
- ✅ Set all 4 Cloud Function secrets (Paystack secret, SendChamp, Shipbubble, Resend)
- ⚠️ Tell you which two steps still need manual action (no public API exists for them)

### **Manual Steps (No API Exists)**

These two steps cannot be automated — Google and GO54 don't expose APIs for them:

#### 1. Firebase Authorized Domains

Go to [Firebase Console → Authentication → Settings → Authorized domains](https://console.firebase.google.com/project/storvix-95bc8/authentication/settings) and add:
- `storvix.ng`
- `localhost`
- Your Vercel preview domain (e.g. `storvix.vercel.app`)
- Your Railway domain (e.g. `storvix.up.railway.app`)

#### 2. GO54 Wildcard DNS

Log into your GO54 cPanel → DNS Zone Editor and add:

| Type | Name | Value |
|------|------|-------|
| A or CNAME | `@` | (Vercel target — for `storvix.ng`) |
| CNAME | `*` | (Railway CNAME target — for `*.storvix.ng`) |

This way:
- `storvix.ng` → Vercel (landing, dashboard, etc.)
- `amaka-closet.storvix.ng` → Railway → serves `store.html`

### **Deploy**

```bash
# Deploy Cloud Functions, Firestore rules, indexes, Storage rules
firebase deploy --only functions,firestore,storage

# Push to GitHub
git init && git add . && git commit -m "Launch"
gh repo create storvix --public --source=.
git push -u origin main

# Vercel: import the repo at vercel.com/new (no build command needed)
# Railway: connect the repo at railway.app/new (start command: node server.js)
```

### **Local Development**

```bash
# Run Railway server locally (for subdomain testing fallback)
npm start
# Visit: http://localhost:3000/store.html?slug=amaka-closet

# Or for static pages
npx serve .
```

---

## 🔑 Key Architecture Points

### URL Routing
| URL | Hosted by | Serves |
|-----|-----------|--------|
| `storvix.ng` | Vercel | `index.html` |
| `storvix.ng/auth` | Vercel | `auth.html` |
| `storvix.ng/dashboard` | Vercel | `dashboard.html` |
| `storvix.ng/store?slug=amaka` | Vercel | `store.html` (fallback) |
| `amaka.storvix.ng` | Railway | `store.html` (subdomain) |

### Subscription Flow
1. Seller signs up → picks plan in `auth.html` → 14-day trial begins (no card required)
2. After 14 days → Paystack subscription kicks in → automatic charge
3. If charge fails → 3-day grace period → S6 (day 1) + S7 (day 3) WhatsApp alerts
4. After grace → storefront shows "Store Not Available", but dashboard still works

### Money Flow
```
Buyer pays:        Subtotal + Delivery + ₦100 Storvix fee
Paystack deducts:  1.5% + ₦100 from Storvix's balance
Seller wallet gets: Subtotal + Delivery − Paystack's 1.5%+₦100
Storvix margin:    ₦100 buyer fee − ₦325 Paystack fee = small loss/profit per order
```

### Cloud Functions (13 total)
1. `paystackWebhook` — Charge success → credit wallet, decrement stock, send WhatsApp
2. `subscriptionWebhook` — Subscription events → update plan status
3. `onOrderStatusChange` — Firestore trigger → WhatsApp on shipped/delivered/cancelled
4. `getDeliveryRates` — Shipbubble API (callable)
5. `verifyBankAccount` — Paystack Resolve API (callable)
6. `processPayout` — Paystack Transfer API (admin callable)
7. `createPaymentLink` — Generate 6-char ref (callable)
8. `generateInvoice` — Build invoice data (callable)
9. `sendNotification` — Manual WhatsApp send (callable)
10. `gracePeriodScheduler` — Daily 8AM, manage grace/expiry
11. `abandonedCartChecker` — Every 2 hours (Plus+ only)
12. `reviewRequestScheduler` — Daily 9AM, send review requests 24h after delivery
13. `renewalReminderScheduler` — Daily 10AM, S5 reminder 3 days before renewal

---

## ⚠️ Critical Setup Notes

1. **Logo file missing**: Add `assets/logo.png` (PNG, ~512x512). A favicon at `assets/favicon.ico` is also expected.
2. **Firebase Authorized Domains**: Add ALL the domains you'll use, including `localhost` for dev and your Railway domain.
3. **Paystack Plan Codes**: Until you create the Paystack plans and paste the codes into `plans.js`, the subscription buttons will toast an error — but everything else (signup, trial, store, payments) works.
4. **Wildcard DNS**: `*.storvix.ng` MUST point to Railway. Without this, subdomain stores won't work — but the `?slug=` fallback will.
5. **CORS**: Cloud Functions are deployed in `europe-west1`. If you change region, update `js/firebase-config.js` line `getFunctions(app, "europe-west1")`.

---

## 📞 Support

- Email: `usestorvix@gmail.com`
- WhatsApp: `+234 708 951 0199`
- Founder: Maurice Prosper

---

**⚡ Storvix · Built in Lagos · April 2026**
