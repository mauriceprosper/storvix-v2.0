// ============================================================
//  STORVIX — Firebase Config & Helpers (js/firebase-config.js)
//  Import from here everywhere Firebase is needed.
// ============================================================

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, updateProfile,
  sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, collectionGroup, query, where, orderBy, limit, onSnapshot,
  serverTimestamp, increment, Timestamp, startAfter, limitToLast, getCountFromServer,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import {
  getFunctions, httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

// ── Config ────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBFAI1Ga5SMJ9_fFPaWW-9HNFvwyhE8JSg",
  authDomain:        "storvix-95bc8.firebaseapp.com",
  projectId:         "storvix-95bc8",
  storageBucket:     "storvix-95bc8.firebasestorage.app",
  messagingSenderId: "217953091611",
  appId:             "1:217953091611:web:4fbc78c16227600e9bb8be",
};

const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getFirestore(app);
const storage   = getStorage(app);
const gProvider = new GoogleAuthProvider();
const functions = getFunctions(app, "europe-west1");

// ── Exports ───────────────────────────────────────────────────
export {
  app, auth, db, storage, functions,
  onAuthStateChanged, serverTimestamp, Timestamp, increment, writeBatch,
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, collectionGroup, query, where, orderBy, limit,
  onSnapshot, startAfter, limitToLast, getCountFromServer,
  storageRef, uploadBytes, getDownloadURL, deleteObject,
};

// ── Auth Helpers ──────────────────────────────────────────────
export const logIn          = (e, p) => signInWithEmailAndPassword(auth, e, p);
export const signUp         = (e, p) => createUserWithEmailAndPassword(auth, e, p);
export const googleSignIn   = ()     => signInWithPopup(auth, gProvider);
export const resetPassword  = (e)    => sendPasswordResetEmail(auth, e);
export const logOut         = ()     => signOut(auth);
export const setDisplayName = (u, n) => updateProfile(u, { displayName: n });

export const ADMIN_EMAILS = ["usestorvix@gmail.com", "mauriceprosper1@gmail.com"];
export const isAdmin = (email) => !!email && ADMIN_EMAILS.includes(email.toLowerCase().trim());

// ── Seller CRUD ───────────────────────────────────────────────
export async function getSeller(uid) {
  const snap = await getDoc(doc(db, "sellers", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getSellerBySlug(slug) {
  const q    = query(collection(db, "sellers"), where("slug", "==", slug), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function createSeller(uid, data) {
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);
  await setDoc(doc(db, "sellers", uid), {
    ownerId:      uid,
    plan:         data.plan || "lite",
    billing:      data.billing || "monthly",
    planStatus:   "trial",
    trialStart:   serverTimestamp(),
    trialEnd:     Timestamp.fromDate(trialEnd),
    wallet:       { balance: 0, totalEarned: 0, totalWithdrawn: 0 },
    productCount: 0,
    orderCount:   0,
    suspended:    false,
    holidayMode:  false,
    stockThreshold: 3,
    createdAt:    serverTimestamp(),
    updatedAt:    serverTimestamp(),
    ...data,
  });
}

export async function updateSeller(uid, data) {
  await updateDoc(doc(db, "sellers", uid), { ...data, updatedAt: serverTimestamp() });
}

export async function checkSlugAvailable(slug, currentUid = null) {
  const q    = query(collection(db, "sellers"), where("slug", "==", slug), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return true;
  if (currentUid && snap.docs[0].id === currentUid) return true;
  return false;
}

// ── Products ─────────────────────────────────────────────────
export async function getProducts(sellerId, opts = {}) {
  // Always order by createdAt; filter active products in code (avoids Firestore != combo limit)
  const q    = query(collection(db, "sellers", sellerId, "products"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  let items  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!opts.includeInactive) items = items.filter(p => p.active !== false);
  if (!opts.includeDrafts)   items = items.filter(p => p.draft !== true);
  return items;
}

export async function addProduct(sellerId, data) {
  const ref = await addDoc(collection(db, "sellers", sellerId, "products"), {
    active: true, draft: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...data,
  });
  await updateDoc(doc(db, "sellers", sellerId), { productCount: increment(1) });
  return ref;
}

export async function updateProduct(sellerId, productId, data) {
  return updateDoc(doc(db, "sellers", sellerId, "products", productId), {
    ...data, updatedAt: serverTimestamp(),
  });
}

export async function deleteProduct(sellerId, productId) {
  await updateDoc(doc(db, "sellers", sellerId, "products", productId), { active: false });
  await updateDoc(doc(db, "sellers", sellerId), { productCount: increment(-1) });
}

// ── Orders ───────────────────────────────────────────────────
export function listenOrders(sellerId, cb, filter = null) {
  const c = [orderBy("createdAt", "desc"), limit(200)];
  if (filter) c.unshift(where("status", "==", filter));
  return onSnapshot(query(collection(db, "sellers", sellerId, "orders"), ...c),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function updateOrderStatus(sellerId, orderId, status, extra = {}) {
  return updateDoc(doc(db, "sellers", sellerId, "orders", orderId), {
    status, updatedAt: serverTimestamp(), ...extra,
  });
}

// ── Customers ─────────────────────────────────────────────────
export async function getCustomers(sellerId) {
  // Use plain getDocs (no orderBy) to include any docs missing lastOrderAt
  const snap = await getDocs(collection(db, "sellers", sellerId, "customers"));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.lastOrderAt?.toMillis?.() || 0) - (a.lastOrderAt?.toMillis?.() || 0));
}

// ── Discounts ─────────────────────────────────────────────────
export async function getDiscounts(sellerId) {
  const q    = query(collection(db, "sellers", sellerId, "discounts"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Payment Links ─────────────────────────────────────────────
export async function getPaymentLinks(sellerId) {
  const q    = query(collection(db, "sellers", sellerId, "paymentLinks"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Transactions ──────────────────────────────────────────────
export async function getTransactions(sellerId, lim = 50) {
  const q    = query(collection(db, "sellers", sellerId, "transactions"), orderBy("createdAt", "desc"), limit(lim));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Testimonials ──────────────────────────────────────────────
export async function getTestimonials(sellerId) {
  const q    = query(collection(db, "sellers", sellerId, "testimonials"), where("active", "==", true), orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Storage Upload ────────────────────────────────────────────
export async function uploadImage(sellerId, file, path) {
  const ref  = storageRef(storage, `sellers/${sellerId}/${path}`);
  const snap = await uploadBytes(ref, file);
  return getDownloadURL(snap.ref);
}

// ── Withdrawal ────────────────────────────────────────────────
export async function requestWithdrawal(sellerId, amount, bank) {
  const seller = await getSeller(sellerId);
  if (!seller) throw new Error("Seller not found");
  const balance = seller.wallet?.balance || 0;
  if (!amount || amount <= 0) throw new Error("Enter a valid amount.");
  if (amount < 100)     throw new Error("Withdrawals must be at least ₦100.");
  if (amount > balance) throw new Error(`Insufficient balance. Available: ₦${balance.toLocaleString()}`);
  // Withdrawal fee: 1% of amount, capped at ₦100, minimum ₦10
  const fee = Math.max(10, Math.min(100, Math.round(amount * 0.01)));
  const net = amount - fee;

  await updateDoc(doc(db, "sellers", sellerId), {
    "wallet.balance":        increment(-amount),
    "wallet.totalWithdrawn": increment(amount),
  });

  const wRef = await addDoc(collection(db, "withdrawals"), {
    sellerId, amount, netAmount: net, bank,
    status: "pending", requestedAt: serverTimestamp(),
  });

  await addDoc(collection(db, "sellers", sellerId, "transactions"), {
    type: "debit", amount, netAmount: net,
    description: `Withdrawal — ${bank.bankName}`,
    withdrawalId: wRef.id, createdAt: serverTimestamp(),
  });

  return wRef.id;
}

// ── Cloud Function Callers ────────────────────────────────────
export const callGetDeliveryRates  = d => httpsCallable(functions, "getDeliveryRates")(d);
export const callVerifyBankAccount = d => httpsCallable(functions, "verifyBankAccount")(d);
export const callProcessPayout     = d => httpsCallable(functions, "processPayout")(d);
export const callCreatePaymentLink = d => httpsCallable(functions, "createPaymentLink")(d);
export const callGenerateInvoice   = d => httpsCallable(functions, "generateInvoice")(d);
export const callSendNotification  = d => httpsCallable(functions, "sendNotification")(d);
export const callBackfillWallets   = d => httpsCallable(functions, "backfillWallets")(d || {});
export const callAdminSendMessage  = d => httpsCallable(functions, "adminSendMessage")(d);
