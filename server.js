// ============================================================
//  STORVIX — Railway Subdomain Server (server.js)
//  Routes *.storvix.ng → store.html
//  Routes storvix.ng → redirect to main site
// ============================================================

const express = require("express");
const path    = require("path");
const fs      = require("fs");

const app  = express();
const PORT = process.env.PORT || 3000;

const ROOT_DOMAIN = "storvix.ng";
const MAIN_SITE   = "https://storvix.ng";

// Serve static assets (logo, favicon)
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/css",    express.static(path.join(__dirname, "css")));
app.use("/js",     express.static(path.join(__dirname, "js")));

// ── Subdomain Router ────────────────────────────────────────
app.use((req, res, next) => {
  const host = req.hostname || req.headers.host || "";
  const subdomain = host.replace(`.${ROOT_DOMAIN}`, "");

  // If the host is exactly storvix.ng or www.storvix.ng → redirect to Vercel
  if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}` || host.includes("railway.app")) {
    if (req.path === "/" || req.path === "") {
      return res.redirect(301, MAIN_SITE);
    }
    return res.redirect(301, `${MAIN_SITE}${req.path}`);
  }

  // If host has a subdomain (e.g. amaka-closet.storvix.ng) → serve store.html
  if (host.endsWith(`.${ROOT_DOMAIN}`) && subdomain && subdomain !== "www") {
    return res.sendFile(path.join(__dirname, "store.html"));
  }

  next();
});

// Fallback 404
app.use((req, res) => {
  res.redirect(301, MAIN_SITE);
});

app.listen(PORT, () => {
  console.log(`✅ Storvix subdomain server running on port ${PORT}`);
});
