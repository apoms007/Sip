// Copies the web app into www/ for Capacitor. The source of truth stays at the
// repo root so GitHub Pages can serve it directly with no build step.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "www");
const FILES = ["index.html", "style.css", "app.js", "sw.js", "manifest.json"];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "icons"), { recursive: true });

for (const f of FILES) fs.copyFileSync(path.join(root, f), path.join(out, f));

for (const f of fs.readdirSync(path.join(root, "icons"))) {
  if (f.endsWith(".png")) fs.copyFileSync(path.join(root, "icons", f), path.join(out, "icons", f));
}

console.log("www/ built:", FILES.length + fs.readdirSync(path.join(out, "icons")).length, "files");
