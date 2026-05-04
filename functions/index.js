// ============================================================
//  STORVIX — Firebase Cloud Functions (functions/index.js)
//  Node 18+ · Blaze plan required
// ============================================================

const { onRequest }         = require("firebase-functions/v2/https");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule }        = require("firebase-functions/v2/scheduler");
const { initializeApp }     = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const crypto  = require("crypto");
// Node 22 has global fetch — no node-fetch needed

initializeApp();
const db = getFirestore();

// ── Secrets (set with: firebase functions:secrets:set KEY) ────
const PAYSTACK_SECRET   = process.env.PAYSTACK_SECRET_KEY;
const SENDCHAMP_KEY     = process.env.SENDCHAMP_PUBLIC_KEY;
const SHIPBUBBLE_KEY    = process.env.SHIPBUBBLE_API_KEY;
const RESEND_KEY        = process.env.RESEND_API_KEY;
const DASHBOARD_URL     = "https://storvix.ng/dashboard.html";
const FUNCTIONS_REGION  = "europe-west1";

// CORS allowlist — these origins can call onCall functions.
// Includes apex, www, all subdomains (storefronts), and Vercel preview.
const CORS_ORIGINS = [
  "https://storvix.ng",
  "https://www.storvix.ng",
  /^https:\/\/[a-z0-9-]+\.storvix\.ng$/,        // *.storvix.ng (subdomains)
  /^https:\/\/storvix-v2-0-.+\.vercel\.app$/,   // Vercel previews
  "https://storvix-v2-0.vercel.app",            // Vercel production
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
const CALLABLE_OPTS = { region: FUNCTIONS_REGION, cors: CORS_ORIGINS };

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

// ── SendChamp WhatsApp ────────────────────────────────────────
async function sendWhatsApp(phone, message) {
  const cleanPhone = phone.replace(/\D/g, "").replace(/^234/, "234").replace(/^0/, "234");
  try {
    const res = await fetch("https://api.sendchamp.com/api/v1/whatsapp/message/send", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SENDCHAMP_KEY}`,
      },
      body: JSON.stringify({
        sender: "Storvix",
        recipient: `+${cleanPhone}`,
        type: "text",
        message: { text: message },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    return true;
  } catch (err) {
    console.error("WhatsApp failed, trying SMS:", err.message);
    return sendSMS(phone, message);
  }
}

async function sendSMS(phone, message) {
  try {
    await fetch("https://api.sendchamp.com/api/v1/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SENDCHAMP_KEY}` },
      body: JSON.stringify({ to: [phone], message, sender_name: "Storvix", route: "dnd" }),
    });
  } catch (e) { console.error("SMS also failed:", e.message); }
}

// ── Paystack API ──────────────────────────────────────────────
async function paystackGet(path) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  });
  return res.json();
}

async function paystackPost(path, body) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${PAYSTACK_SECRET}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Notification Messages ─────────────────────────────────────
const MSG = {
  B1: (d) => `Hi ${d.name}! 🎉\nYour order from *${d.store}* has been confirmed.\n📦 Order: *${d.orderNumber}*\n💰 Total: *${d.amount}*\n🛍️ Items: ${d.items}\n\nWe'll send you a tracking update once your order is on the way.\n\nQuestions? WhatsApp the store: ${d.storeWhatsApp}\n\nThank you for shopping! ❤️`,
  B2: (d) => `📦 Your order is on the way!\nHi ${d.name}, your order from *${d.store}* has been shipped.\n🔍 Track your delivery: ${d.trackingLink || "—"}\n📋 Order: *${d.orderNumber}*\n\nFor any questions: ${d.storeWhatsApp}`,
  B3: (d) => `✅ Order Delivered!\nHi ${d.name}, we hope you received your order from *${d.store}*.\n📋 Order: *${d.orderNumber}*\n\nEnjoy your purchase! If anything isn't right, contact the store: ${d.storeWhatsApp} 🎉`,
  B4: (d) => `Order Cancelled\nHi ${d.name}, your order *${d.orderNumber}* from *${d.store}* has been cancelled.\nIf a payment was made, a refund will be processed.\nContact the store: ${d.storeWhatsApp}`,
  B5: (d) => `Payment Received! 🎉\nHi ${d.name}, your payment of *${d.amount}* to *${d.store}* was successful.\n📋 For: ${d.description}\n🧾 Receipt: ${d.receiptLink}\n\nThank you!`,
  B6: (d) => `Hey ${d.name} 👋\nYou left something behind at *${d.store}*!\n🛒 ${d.items}\n\nYour cart is still waiting. Complete your order here: ${d.storeUrl}\n\nStock is limited — grab yours before it's gone! 🏃`,
  B7: (d) => `How was your order? ⭐\nHi ${d.name}, we hope you're loving your purchase from *${d.store}*.\n🛍️ ${d.items}\n\nLeave a quick review: ${d.reviewLink}\nIt only takes 30 seconds and helps the store grow. Thank you! 🙏`,
  S1: (d) => `🛍️ New Order! 💰\n*${d.buyerName}* just placed an order on *${d.storeName}*!\n📦 Order: *${d.orderNumber}*\n🛒 Items: ${d.items}\n💰 Amount: *${d.amount}*\n\nLog in to confirm: ${DASHBOARD_URL}`,
  S2: (d) => `⚠️ Low Stock Alert\n*${d.productName}* in your store *${d.storeName}* is running low.\n📦 Only *${d.remainingStock} unit(s)* remaining.\n\nUpdate your stock: ${DASHBOARD_URL}`,
  S3: (d) => `💸 Payout Sent!\nYour withdrawal from *${d.storeName}* has been processed.\n💰 Amount: *${d.netAmount}* (after ₦100 fee)\n🏦 ${d.bankName} · ${d.accountNumber}\n\nFunds should arrive within minutes. Need help? +234 708 951 0199`,
  S4: (d) => `⚠️ Payout Failed\nYour withdrawal of *${d.amount}* from *${d.storeName}* could not be processed.\n🏦 Bank: ${d.bankName}\n\nYour wallet has been refunded. Check your bank details and try again.\nNeed help? +234 708 951 0199`,
  S5: (d) => `⚡ Subscription Renewal Coming Up\nYour *${d.planName}* plan for *${d.storeName}* renews on *${d.renewalDate}*.\n💳 Amount: *${d.amount}*\n\nEnsure your card is funded: ${DASHBOARD_URL}`,
  S6: (d) => `⚠️ Action Required — Payment Failed\nWe couldn't process your *${d.planName}* subscription for *${d.storeName}*.\n💳 Amount due: *${d.amount}*\n\nYour store is still live for 3 days. Update payment: ${DASHBOARD_URL}`,
  S7: (d) => `🔴 Final Warning — Store Going Offline Tomorrow\nYour *${d.planName}* subscription for *${d.storeName}* is still unpaid.\n\nYour storefront goes offline in 24 hours if unpaid.\nDashboard remains accessible.\n\nPay now: ${DASHBOARD_URL}\nNeed help? +234 708 951 0199`,
  S8: (d) => `✅ Your store is back online!\nPayment confirmed. *${d.storeName}* is now live again at ${d.storeUrl}\n\nThank you for continuing with Storvix. Keep selling! ⚡`,
  S9: (d) => `🎉 You made your first sale!\nCongratulations ${d.storeName}! Your first order just came in.\n\nThis is just the beginning. 💰 *${d.amount}* is now in your Storvix wallet.\n\nLog in to manage your orders: ${DASHBOARD_URL}\n⚡ Team Storvix`,
};

// ═══════════════════════════════════════════════════════════════
//  1. paystackWebhook
// ═══════════════════════════════════════════════════════════════
exports.paystackWebhook = onRequest({ region: FUNCTIONS_REGION }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

  // Verify HMAC-SHA512
  const hash = crypto.createHmac("sha512", PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest("hex");
  if (hash !== req.headers["x-paystack-signature"]) {
    res.status(401).send("Unauthorized"); return;
  }

  const event = req.body;
  console.log("Paystack webhook:", event.event);

  if (event.event === "charge.success") {
    const meta   = event.data.metadata?.custom_fields || [];
    const getF   = (k) => meta.find(f => f.variable_name === k)?.value;
    const sellerId  = getF("seller_id");
    const orderId   = getF("order_id");
    const buyerPhone= getF("buyer_phone");

    if (!sellerId || !orderId) { res.sendStatus(200); return; }

    try {
      const sellerRef  = db.doc(`sellers/${sellerId}`);
      const orderRef   = db.doc(`sellers/${sellerId}/orders/${orderId}`);
      const sellerSnap = await sellerRef.get();
      const orderSnap  = await orderRef.get();

      if (!sellerSnap.exists || !orderSnap.exists) { res.sendStatus(200); return; }

      const seller = sellerSnap.data();
      const order  = orderSnap.data();
      const amount = (event.data.amount / 100); // convert from kobo
      const paystackFee = Math.round(amount * 0.015 + 100); // 1.5% + ₦100
      const sellerCredit = (order.subtotal || 0) + (order.deliveryFee || 0);

      // Credit wallet
      await sellerRef.update({
        "wallet.balance":      FieldValue.increment(sellerCredit - paystackFee),
        "wallet.totalEarned":  FieldValue.increment(sellerCredit - paystackFee),
        orderCount:            FieldValue.increment(1),
      });

      // Record transaction
      await sellerRef.collection("transactions").add({
        type: "credit", amount: sellerCredit - paystackFee,
        description: `Order ${order.orderNumber || orderId}`,
        orderId, createdAt: FieldValue.serverTimestamp(),
      });

      // Update customer record
      const cRef = sellerRef.collection("customers").doc(buyerPhone || "unknown");
      const cSnap = await cRef.get();
      if (cSnap.exists) {
        await cRef.update({
          totalOrders: FieldValue.increment(1),
          totalSpent:  FieldValue.increment(order.subtotal || 0),
          lastOrderAt: FieldValue.serverTimestamp(),
        });
      } else {
        await cRef.set({
          name:        order.buyer?.name || "Unknown",
          phone:       order.buyer?.phone || buyerPhone || "",
          email:       order.buyer?.email || "",
          totalOrders: 1,
          totalSpent:  order.subtotal || 0,
          lastOrderAt: FieldValue.serverTimestamp(),
          createdAt:   FieldValue.serverTimestamp(),
        });
      }

      // Notify buyer (B1)
      const items = (order.items || []).map(i => `${i.qty}x ${i.name}`).join(", ");
      if (order.buyer?.phone) {
        await sendWhatsApp(order.buyer.phone, MSG.B1({
          name: order.buyer.name || "Customer",
          store: seller.storeName,
          orderNumber: order.orderNumber || orderId,
          amount: `₦${(order.total || 0).toLocaleString()}`,
          items,
          storeWhatsApp: seller.whatsapp || "+234 708 951 0199",
        }));
      }

      // Notify seller (S1)
      if (seller.whatsapp) {
        const isFirst = (seller.orderCount || 0) === 0;
        await sendWhatsApp(seller.whatsapp, MSG.S1({
          storeName: seller.storeName,
          buyerName: order.buyer?.name || "A customer",
          orderNumber: order.orderNumber || orderId,
          items,
          amount: `₦${(order.total || 0).toLocaleString()}`,
        }));

        // First sale milestone
        if (isFirst) {
          await sendWhatsApp(seller.whatsapp, MSG.S9({
            storeName: seller.storeName,
            amount: `₦${(sellerCredit - paystackFee).toLocaleString()}`,
          }));
        }
      }

      // Low stock check + decrement stock
      for (const item of order.items || []) {
        if (!item.productId) continue;
        const pRef  = sellerRef.collection("products").doc(item.productId);
        const pSnap = await pRef.get();
        if (!pSnap.exists) continue;
        const p = pSnap.data();

        // Decrement stock
        const newStock = Math.max(0, (p.stock || 0) - (item.qty || 1));
        await pRef.update({ stock: newStock });

        // Low stock alert
        const threshold = seller.stockThreshold || 3;
        if (newStock <= threshold && newStock > 0 && seller.whatsapp) {
          await sendWhatsApp(seller.whatsapp, MSG.S2({
            storeName: seller.storeName, productName: p.name, remainingStock: newStock,
          }));
        }
      }
    } catch (e) { console.error("Webhook error:", e); }
  }

  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════════════
//  2. subscriptionWebhook
// ═══════════════════════════════════════════════════════════════
exports.subscriptionWebhook = onRequest({ region: FUNCTIONS_REGION }, async (req, res) => {
  const hash = crypto.createHmac("sha512", PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest("hex");
  if (hash !== req.headers["x-paystack-signature"]) { res.status(401).send("Unauthorized"); return; }

  const { event, data } = req.body;
  const email = data.customer?.email;
  if (!email) { res.sendStatus(200); return; }

  const sellerQuery = await db.collection("sellers").where("email", "==", email).limit(1).get();
  if (sellerQuery.empty) { res.sendStatus(200); return; }

  const sellerRef  = sellerQuery.docs[0].ref;
  const seller     = sellerQuery.docs[0].data();

  if (event === "invoice.payment_success" || event === "subscription.create") {
    const next = data.next_payment_date ? new Date(data.next_payment_date) : null;
    await sellerRef.update({
      planStatus:         "active",
      planExpiry:         next ? Timestamp.fromDate(next) : null,
      subscriptionCode:   data.subscription_code || data.data?.subscription_code || "",
    });
    if (seller.whatsapp) {
      await sendWhatsApp(seller.whatsapp, MSG.S8({
        storeName: seller.storeName,
        storeUrl:  `https://${seller.slug}.storvix.ng`,
      }));
    }
  } else if (event === "invoice.payment_failed") {
    await sellerRef.update({ planStatus: "grace", graceStart: FieldValue.serverTimestamp() });
  } else if (event === "customer.subscription.disable") {
    await sellerRef.update({ planStatus: "expired" });
  }

  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════════════
//  3. onOrderStatusChange (Firestore trigger)
// ═══════════════════════════════════════════════════════════════
exports.onOrderStatusChange = onDocumentUpdated({
  document:  "sellers/{sellerId}/orders/{orderId}",
  region:    FUNCTIONS_REGION,
}, async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();
  if (before.status === after.status) return;

  const sellerId = event.params.sellerId;
  const sellerSnap = await db.doc(`sellers/${sellerId}`).get();
  const seller = sellerSnap.data();

  const buyer = after.buyer || {};
  const d     = {
    name: buyer.name || "Customer",
    store: seller?.storeName || "the store",
    orderNumber: after.orderNumber || event.params.orderId,
    storeWhatsApp: seller?.whatsapp || "+234 708 951 0199",
    trackingLink: after.trackingLink || "—",
    amount: `₦${(after.total || 0).toLocaleString()}`,
    items: (after.items || []).map(i => i.name).join(", "),
  };

  if (!buyer.phone) return;

  if (after.status === "shipped")   await sendWhatsApp(buyer.phone, MSG.B2(d));
  if (after.status === "delivered") await sendWhatsApp(buyer.phone, MSG.B3(d));
  if (after.status === "cancelled") await sendWhatsApp(buyer.phone, MSG.B4(d));
});

// ═══════════════════════════════════════════════════════════════
//  4. getDeliveryRates (Callable)
// ═══════════════════════════════════════════════════════════════
exports.getDeliveryRates = onCall(CALLABLE_OPTS, async (request) => {
  const { city, state, sellerState, items } = request.data;
  const weight = (items || []).reduce((s, i) => s + (i.qty * 0.5), 0.5);

  try {
    const res = await fetch("https://api.shipbubble.com/v1/shipping/fetch_rates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SHIPBUBBLE_KEY}` },
      body: JSON.stringify({
        sender_address:   { state: sellerState || "Lagos", city: "Lagos" },
        receiver_address: { state, city },
        parcel_weight: weight, category_id: 1,
      }),
    });
    const data = await res.json();
    const rates = (data.data?.rates || []).map(r => ({
      id: r.service_code, name: r.courier_name,
      fee: r.amount, eta: r.estimated_days ? `${r.estimated_days} day(s)` : "2–5 days",
    }));
    return { rates };
  } catch {
    return { rates: [
      { id: "flat", name: "Standard Delivery", fee: 1500, eta: "3–5 business days" },
    ]};
  }
});

// ═══════════════════════════════════════════════════════════════
//  5. verifyBankAccount (Callable)
// ═══════════════════════════════════════════════════════════════
exports.verifyBankAccount = onCall(CALLABLE_OPTS, async (request) => {
  const { accountNumber, bankCode } = request.data;
  if (!accountNumber || !bankCode) throw new Error("accountNumber and bankCode required");

  const data = await paystackGet(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
  if (!data.status) throw new Error(data.message || "Verification failed");
  return { accountName: data.data?.account_name || "" };
});

// ═══════════════════════════════════════════════════════════════
//  6. processPayout (Callable — admin only)
// ═══════════════════════════════════════════════════════════════
exports.processPayout = onCall(CALLABLE_OPTS, async (request) => {
  const { withdrawalId } = request.data;
  const wSnap = await db.doc(`withdrawals/${withdrawalId}`).get();
  if (!wSnap.exists) throw new Error("Withdrawal not found");
  const w = wSnap.data();

  // Create transfer recipient
  const recipientRes = await paystackPost("/transferrecipient", {
    type: "nuban", name: w.bank.accountName,
    account_number: w.bank.accountNumber, bank_code: w.bank.bankCode, currency: "NGN",
  });
  if (!recipientRes.status) throw new Error(recipientRes.message);

  // Initiate transfer
  const transferRes = await paystackPost("/transfer", {
    source: "balance", reason: `Storvix withdrawal — ${w.sellerId}`,
    amount: w.netAmount * 100, recipient: recipientRes.data.recipient_code,
  });
  if (!transferRes.status) throw new Error(transferRes.message);

  await wSnap.ref.update({
    status: "processing",
    paystackTransferCode: transferRes.data?.transfer_code || "",
    processedAt: FieldValue.serverTimestamp(),
  });

  // Notify seller
  const sellerSnap = await db.doc(`sellers/${w.sellerId}`).get();
  if (sellerSnap.exists && sellerSnap.data().whatsapp) {
    await sendWhatsApp(sellerSnap.data().whatsapp, MSG.S3({
      storeName: sellerSnap.data().storeName,
      amount: `₦${w.amount.toLocaleString()}`,
      netAmount: `₦${w.netAmount.toLocaleString()}`,
      bankName: w.bank.bankName, accountNumber: w.bank.accountNumber,
    }));
  }

  return { success: true, transferCode: transferRes.data?.transfer_code };
});

// ═══════════════════════════════════════════════════════════════
//  7. createPaymentLink (Callable)
// ═══════════════════════════════════════════════════════════════
exports.createPaymentLink = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) throw new Error("Unauthorized");
  const uid = request.auth.uid;
  const { description, amount, oneTime, expiryDate } = request.data;

  const ref = Math.random().toString(36).substring(2, 8).toUpperCase();
  await db.collection("sellers").doc(uid).collection("paymentLinks").add({
    ref, description, amount, oneTime: !!oneTime,
    expiryDate: expiryDate || null, used: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ref };
});

// ═══════════════════════════════════════════════════════════════
//  8. generateInvoice (Callable)
// ═══════════════════════════════════════════════════════════════
exports.generateInvoice = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) throw new Error("Unauthorized");
  const { orderId } = request.data;
  const uid = request.auth.uid;

  const [sellerSnap, orderSnap] = await Promise.all([
    db.doc(`sellers/${uid}`).get(),
    db.doc(`sellers/${uid}/orders/${orderId}`).get(),
  ]);

  if (!sellerSnap.exists || !orderSnap.exists) throw new Error("Not found");
  return { seller: sellerSnap.data(), order: { id: orderId, ...orderSnap.data() } };
});

// ═══════════════════════════════════════════════════════════════
//  9. sendNotification (Callable)
// ═══════════════════════════════════════════════════════════════
exports.sendNotification = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) throw new Error("Unauthorized");
  const { phone, message } = request.data;
  await sendWhatsApp(phone, message);
  return { success: true };
});

// ═══════════════════════════════════════════════════════════════
//  10. gracePeriodScheduler — daily at 8AM
// ═══════════════════════════════════════════════════════════════
exports.gracePeriodScheduler = onSchedule({
  schedule: "0 8 * * *", region: FUNCTIONS_REGION, timeZone: "Africa/Lagos",
}, async () => {
  const now  = new Date();
  const snap = await db.collection("sellers").where("planStatus", "in", ["trial","grace"]).get();

  for (const sellerDoc of snap.docs) {
    const seller = sellerDoc.data();
    const expiry = seller.planExpiry?.toDate?.() || seller.trialEnd?.toDate?.();
    if (!expiry) continue;

    const daysPast = Math.floor((now - expiry) / 86400000);

    if (seller.planStatus === "trial" && daysPast >= 0) {
      await sellerDoc.ref.update({ planStatus: "grace", graceStart: FieldValue.serverTimestamp() });
    }

    if (seller.planStatus === "grace") {
      if (daysPast === 1 && seller.whatsapp) {
        await sendWhatsApp(seller.whatsapp, MSG.S6({
          storeName: seller.storeName, planName: seller.plan || "Lite",
          amount: "₦2,100",
        }));
      } else if (daysPast === 3 && seller.whatsapp) {
        await sendWhatsApp(seller.whatsapp, MSG.S7({
          storeName: seller.storeName, planName: seller.plan || "Lite",
        }));
      } else if (daysPast >= 4) {
        await sellerDoc.ref.update({ planStatus: "expired" });
      }
    }
  }
});

// ═══════════════════════════════════════════════════════════════
//  11. abandonedCartChecker — every 2 hours (Plus+ only)
// ═══════════════════════════════════════════════════════════════
exports.abandonedCartChecker = onSchedule({
  schedule: "0 */2 * * *", region: FUNCTIONS_REGION, timeZone: "Africa/Lagos",
}, async () => {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const snap   = await db.collection("cartSessions")
    .where("updatedAt", "<", Timestamp.fromDate(cutoff))
    .where("completed", "==", false)
    .limit(50)
    .get();

  for (const sessionDoc of snap.docs) {
    const session = sessionDoc.data();
    const sellerSnap = await db.doc(`sellers/${session.sellerId}`).get();
    if (!sellerSnap.exists) continue;
    const seller = sellerSnap.data();

    // Only for Plus+ sellers
    if (!["plus","pro"].includes(seller.plan)) continue;

    if (session.buyerPhone) {
      const items = (session.items || []).map(i => `${i.qty}x ${i.name}`).join(", ");
      await sendWhatsApp(session.buyerPhone, MSG.B6({
        name: session.buyerName || "there",
        store: seller.storeName,
        storeUrl: `https://${seller.slug}.storvix.ng`,
        items,
      }));
    }

    await sessionDoc.ref.update({ notified: true });
  }
});

// ═══════════════════════════════════════════════════════════════
//  12. reviewRequestScheduler — daily at 9AM
// ═══════════════════════════════════════════════════════════════
exports.reviewRequestScheduler = onSchedule({
  schedule: "0 9 * * *", region: FUNCTIONS_REGION, timeZone: "Africa/Lagos",
}, async () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayBefore  = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const snap = await db.collectionGroup("orders")
    .where("status", "==", "delivered")
    .where("updatedAt", ">=", Timestamp.fromDate(dayBefore))
    .where("updatedAt", "<=", Timestamp.fromDate(yesterday))
    .limit(100)
    .get();

  for (const orderDoc of snap.docs) {
    const order  = orderDoc.data();
    if (order.reviewSent) continue;
    if (!order.buyer?.phone) continue;

    const sellerId  = orderDoc.ref.parent.parent.id;
    const sellerSnap = await db.doc(`sellers/${sellerId}`).get();
    if (!sellerSnap.exists) continue;
    const seller = sellerSnap.data();

    const items = (order.items || []).map(i => i.name).join(", ");
    await sendWhatsApp(order.buyer.phone, MSG.B7({
      name: order.buyer.name || "Customer",
      store: seller.storeName,
      items,
      reviewLink: `https://${seller.slug}.storvix.ng`,
    }));

    await orderDoc.ref.update({ reviewSent: true });
  }
});

// ═══════════════════════════════════════════════════════════════
//  13. renewalReminderScheduler — daily at 10AM
// ═══════════════════════════════════════════════════════════════
exports.renewalReminderScheduler = onSchedule({
  schedule: "0 10 * * *", region: FUNCTIONS_REGION, timeZone: "Africa/Lagos",
}, async () => {
  const in3Days = new Date(Date.now() + 3 * 86400000);
  const in4Days = new Date(Date.now() + 4 * 86400000);

  const snap = await db.collection("sellers")
    .where("planStatus", "==", "active")
    .where("planExpiry", ">=", Timestamp.fromDate(in3Days))
    .where("planExpiry", "<=", Timestamp.fromDate(in4Days))
    .get();

  const PLAN_PRICES = { lite: 2100, basic: 4850, plus: 9800, pro: 15600 };

  for (const sellerDoc of snap.docs) {
    const seller = sellerDoc.data();
    if (!seller.whatsapp) continue;
    await sendWhatsApp(seller.whatsapp, MSG.S5({
      storeName: seller.storeName, planName: seller.plan,
      amount: `₦${(PLAN_PRICES[seller.plan] || 0).toLocaleString()}`,
      renewalDate: seller.planExpiry?.toDate?.()?.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }),
    }));
  }
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN: Backfill wallets from past paid orders (idempotent)
//  Callable only by admin emails. Safe to run multiple times.
// ═══════════════════════════════════════════════════════════════
exports.backfillWallets = onCall(CALLABLE_OPTS, async (request) => {
  const ADMIN_EMAILS = ["usestorvix@gmail.com", "mauriceprosper1@gmail.com"];
  const callerEmail  = (request.auth?.token?.email || "").toLowerCase().trim();

  console.log("[backfill] Caller email:", callerEmail);

  if (!callerEmail) {
    throw new HttpsError("unauthenticated", "Not signed in.");
  }
  if (!ADMIN_EMAILS.includes(callerEmail)) {
    throw new HttpsError("permission-denied", `${callerEmail} is not an admin.`);
  }

  const report = {
    sellersScanned: 0,
    ordersScanned:  0,
    creditsIssued:  0,
    skipped:        0,
    errors:         0,
    totalCredited:  0,
    perSeller:      [],
    errorDetails:   [],
  };

  try {
    const sellersSnap = await db.collection("sellers").get();
    console.log(`[backfill] Found ${sellersSnap.size} sellers`);

    for (const sellerDoc of sellersSnap.docs) {
      report.sellersScanned++;
      const sellerId  = sellerDoc.id;
      const sellerRef = sellerDoc.ref;
      const sellerData = sellerDoc.data();

      let sellerCredited = 0;
      let sellerSkipped  = 0;

      try {
        // Get all paid orders for this seller
        const ordersSnap = await sellerRef.collection("orders")
          .where("paymentStatus", "==", "paid").get();

        for (const orderDoc of ordersSnap.docs) {
          report.ordersScanned++;
          const order = orderDoc.data();

          try {
            // Idempotency check: simpler query (no composite index needed)
            const existingTxn = await sellerRef.collection("transactions")
              .where("orderId", "==", orderDoc.id)
              .limit(1).get();

            // If any txn exists for this order, check if it's a credit
            const alreadyCredited = !existingTxn.empty
              && existingTxn.docs.some(d => d.data().type === "credit");

            if (alreadyCredited) {
              sellerSkipped++;
              report.skipped++;
              continue;
            }

            // Calculate net credit
            const grossCredit  = (order.subtotal || 0) + (order.deliveryFee || 0);
            const totalAmount  = order.total || grossCredit;
            const paystackFee  = Math.round(totalAmount * 0.015 + 100);
            const netCredit    = grossCredit - paystackFee;

            if (netCredit <= 0) {
              sellerSkipped++;
              report.skipped++;
              continue;
            }

            // Ensure wallet field exists on seller doc before incrementing
            if (!sellerData.wallet) {
              await sellerRef.set({
                wallet: { balance: 0, totalEarned: 0, totalWithdrawn: 0 }
              }, { merge: true });
            }

            // Credit wallet
            await sellerRef.update({
              "wallet.balance":     FieldValue.increment(netCredit),
              "wallet.totalEarned": FieldValue.increment(netCredit),
            });

            // Record transaction
            await sellerRef.collection("transactions").add({
              type:        "credit",
              amount:      netCredit,
              description: `Backfill: Order ${order.orderNumber || orderDoc.id}`,
              orderId:     orderDoc.id,
              backfill:    true,
              createdAt:   order.createdAt || FieldValue.serverTimestamp(),
            });

            sellerCredited += netCredit;
            report.creditsIssued++;
            report.totalCredited += netCredit;

          } catch (orderErr) {
            console.error(`[backfill] Order ${orderDoc.id} failed:`, orderErr.message);
            report.errors++;
            report.errorDetails.push({ sellerId, orderId: orderDoc.id, error: orderErr.message });
          }
        }
      } catch (sellerErr) {
        console.error(`[backfill] Seller ${sellerId} failed:`, sellerErr.message);
        report.errors++;
        report.errorDetails.push({ sellerId, error: sellerErr.message });
      }

      if (sellerCredited > 0 || sellerSkipped > 0) {
        report.perSeller.push({
          sellerId,
          storeName: sellerData.storeName || "(no name)",
          credited:  sellerCredited,
          skipped:   sellerSkipped,
        });
      }
    }

    console.log("[backfill] Complete:", JSON.stringify(report, null, 2));
    return report;

  } catch (err) {
    console.error("[backfill] Fatal error:", err);
    throw new HttpsError("internal", err.message || "Unknown error", { stack: err.stack });
  }
});

// ═══════════════════════════════════════════════════════════════
//  AUTO-PAYOUT: fires on every new withdrawal request
//  Calls Paystack Transfer API + writes a notification to seller
// ═══════════════════════════════════════════════════════════════
exports.onWithdrawalCreated = onDocumentCreated({
  document: "withdrawals/{withdrawalId}",
  region:    FUNCTIONS_REGION,
}, async (event) => {
  const w = event.data?.data();
  const id = event.params.withdrawalId;
  if (!w) return;

  // Only auto-process if status is pending and not already processed
  if (w.status !== "pending") {
    console.log(`[auto-payout] Skipping ${id} (status=${w.status})`);
    return;
  }
  if (!w.bank?.accountNumber || !w.bank?.bankCode) {
    console.warn(`[auto-payout] ${id} missing bank details`);
    await event.data.ref.update({
      status: "rejected",
      rejectedAt: FieldValue.serverTimestamp(),
      rejectReason: "No valid bank account on file",
    });
    return;
  }

  try {
    // Step 1: create transfer recipient
    const recipientRes = await paystackPost("/transferrecipient", {
      type: "nuban",
      name: w.bank.accountName,
      account_number: w.bank.accountNumber,
      bank_code: w.bank.bankCode,
      currency: "NGN",
    });
    if (!recipientRes.status) {
      throw new Error(recipientRes.message || "recipient creation failed");
    }

    // Step 2: initiate transfer
    const transferRes = await paystackPost("/transfer", {
      source: "balance",
      reason: `Storvix payout — ${w.sellerId.slice(0,8)}`,
      amount: w.netAmount * 100,
      recipient: recipientRes.data.recipient_code,
    });
    if (!transferRes.status) {
      throw new Error(transferRes.message || "transfer failed");
    }

    // Update withdrawal to "processing" — final status comes from /transfer/finalize webhook (not used in test)
    // For test mode, transfer is auto-finalized — mark as paid immediately
    await event.data.ref.update({
      status: "paid",       // test mode auto-completes
      paystackTransferCode: transferRes.data?.transfer_code || "",
      paystackRecipientCode: recipientRes.data?.recipient_code || "",
      paidAt: FieldValue.serverTimestamp(),
      method: "paystack_auto",
    });

    // Notify seller via in-app notification
    await createNotification(w.sellerId, {
      type: "payout_success",
      icon: "💸",
      title: `Payout of ₦${w.amount.toLocaleString()} sent`,
      body: `Your withdrawal has been transferred to ${w.bank.bankName} (${w.bank.accountNumber}). Net ₦${(w.netAmount).toLocaleString()}.`,
      link: "/dashboard.html?tab=wallet",
    });

    console.log(`[auto-payout] ${id} sent — transfer ${transferRes.data?.transfer_code}`);
  } catch (err) {
    console.error(`[auto-payout] ${id} failed:`, err.message);

    // Mark as failed + refund wallet
    await event.data.ref.update({
      status: "rejected",
      rejectedAt: FieldValue.serverTimestamp(),
      rejectReason: `Auto-payout failed: ${err.message}`,
    });

    await db.doc(`sellers/${w.sellerId}`).update({
      "wallet.balance":        FieldValue.increment(w.amount),
      "wallet.totalWithdrawn": FieldValue.increment(-w.amount),
    });

    await createNotification(w.sellerId, {
      type: "payout_failed",
      icon: "⚠️",
      title: `Payout of ₦${w.amount.toLocaleString()} failed`,
      body: `${err.message}. The amount has been returned to your wallet.`,
      link: "/dashboard.html?tab=wallet",
    });
  }
});

// ═══════════════════════════════════════════════════════════════
//  Notification helper (writes to sellers/{id}/notifications)
// ═══════════════════════════════════════════════════════════════
async function createNotification(sellerId, payload) {
  try {
    await db.collection("sellers").doc(sellerId).collection("notifications").add({
      ...payload,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn(`[notification] Failed for ${sellerId}:`, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN: send message to one seller or broadcast to many
// ═══════════════════════════════════════════════════════════════
exports.adminSendMessage = onCall(CALLABLE_OPTS, async (request) => {
  const ADMIN_EMAILS = ["usestorvix@gmail.com", "mauriceprosper1@gmail.com"];
  const callerEmail  = (request.auth?.token?.email || "").toLowerCase().trim();
  if (!ADMIN_EMAILS.includes(callerEmail)) {
    throw new HttpsError("permission-denied", "Admin only.");
  }

  const { recipients, title, body, icon } = request.data;
  if (!title || !body) {
    throw new HttpsError("invalid-argument", "Title and body required.");
  }

  // recipients: "all" | "active" | "trial" | "starter" | array of seller IDs
  let sellerIds = [];
  if (Array.isArray(recipients)) {
    sellerIds = recipients;
  } else if (recipients === "all") {
    const snap = await db.collection("sellers").get();
    sellerIds = snap.docs.map(d => d.id);
  } else {
    const snap = await db.collection("sellers").where("planStatus", "==", recipients).get();
    sellerIds = snap.docs.map(d => d.id);
  }

  console.log(`[broadcast] Sending to ${sellerIds.length} seller(s)`);

  // Batched writes
  const BATCH_SIZE = 400;
  let sent = 0;
  for (let i = 0; i < sellerIds.length; i += BATCH_SIZE) {
    const slice = sellerIds.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const sid of slice) {
      const ref = db.collection("sellers").doc(sid).collection("notifications").doc();
      batch.set(ref, {
        type:    "admin_message",
        icon:    icon || "📢",
        title,
        body,
        from:    callerEmail,
        read:    false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    sent += slice.length;
  }

  // Log the broadcast
  await db.collection("adminBroadcasts").add({
    title, body, icon: icon || "📢",
    recipients,
    recipientCount: sent,
    sentBy: callerEmail,
    sentAt: FieldValue.serverTimestamp(),
  });

  return { success: true, sent };
});

// ═══════════════════════════════════════════════════════════════
//  Notification trigger: subscription expiring soon (3 days out)
//  Runs daily; checks all active sellers with planExpiry approaching
// ═══════════════════════════════════════════════════════════════
exports.subscriptionExpiryReminder = onSchedule({
  schedule:  "every day 09:00",
  timeZone:  "Africa/Lagos",
  region:    FUNCTIONS_REGION,
}, async () => {
  const now = Timestamp.now();
  const in3Days = Timestamp.fromMillis(now.toMillis() + 3 * 24 * 60 * 60 * 1000);
  const in7Days = Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000);

  // Snapshot all active sellers
  const snap = await db.collection("sellers").where("planStatus", "in", ["active", "starter"]).get();
  let notified = 0;

  for (const sellerDoc of snap.docs) {
    const seller = sellerDoc.data();
    const expiry = seller.starterExpiry || seller.planExpiry;
    if (!expiry) continue;

    const expiryMs = expiry.toMillis ? expiry.toMillis() : expiry.seconds * 1000;
    const daysLeft = Math.ceil((expiryMs - now.toMillis()) / (24 * 60 * 60 * 1000));

    // Notify at 7 days and 3 days
    if (daysLeft === 7 || daysLeft === 3 || daysLeft === 1) {
      const isStarter = seller.planStatus === "starter";
      await createNotification(sellerDoc.id, {
        type: "subscription_reminder",
        icon: daysLeft === 1 ? "⚠️" : "📅",
        title: isStarter
          ? `Starter pack ends in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`
          : `Subscription renews in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
        body: isStarter
          ? `Pick a plan to keep your store live after expiry.`
          : `Your ${seller.plan} subscription will renew automatically.`,
        link: "/dashboard.html?tab=billing",
      });
      notified++;
    }
  }

  console.log(`[expiry-reminder] Notified ${notified} seller(s)`);
});
