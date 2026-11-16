/* Quick health check for Lucien Home and the two apps. Run: node launcher/test/check.js
   - every .js file parses
   - every inline <script> in the HTML pages parses (launcher renderer, bundled apps, apps/*)
   - the shared calculations (calc.js) run on made-up sample data and give sensible answers
   No personal data here: names are Person 1 / Person 2. */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const walk = (d, ext, out = []) => { for (const f of fs.readdirSync(d)) { if (f === "node_modules" || f.startsWith(".")) continue; const p = path.join(d, f), st = fs.statSync(p);
  if (st.isDirectory()) walk(p, ext, out); else if (p.endsWith(ext)) out.push(p); } return out; };

// 1. syntax
for (const f of walk(path.join(ROOT, "launcher", "app"), ".js")) { try { new Function(fs.readFileSync(f, "utf8").replace(/^#!.*/, "")); ok(true, "parses " + path.relative(ROOT, f)); } catch (e) {
  // modules with require() at top level still parse as functions; a real syntax error lands here
  ok(false, "parses " + path.relative(ROOT, f) + ": " + e.message); } }
const pages = [...walk(path.join(ROOT, "launcher", "app"), ".html"), ...walk(path.join(ROOT, "apps"), ".html")];
for (const f of pages) { const s = fs.readFileSync(f, "utf8"); const scripts = [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let bad = ""; scripts.forEach((js, i) => { try { new Function(js); } catch (e) { bad = `script ${i + 1}: ${e.message}`; } });
  ok(!bad, `inline scripts parse in ${path.relative(ROOT, f)}${bad ? " (" + bad + ")" : ""}`); }
for (const f of walk(path.join(ROOT, "apps"), ".gs")) { try { new Function(fs.readFileSync(f, "utf8")); ok(true, "parses " + path.relative(ROOT, f)); } catch (e) { ok(false, "parses " + path.relative(ROOT, f) + ": " + e.message); } }

// 2. versions line up
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "launcher", "app", "package.json"), "utf8"));
ok(/^\d+\.\d+\.\d+$/.test(pkg.version), "launcher version " + pkg.version);
ok(fs.existsSync(path.join(ROOT, "launcher", "notes", pkg.version + ".md")), "release notes exist for " + pkg.version);
const bv = (fs.readFileSync(path.join(ROOT, "apps", "budget", "Code.gs"), "utf8").match(/APP_VERSION = '([^']+)'/) || [])[1];
const bc = (fs.readFileSync(path.join(ROOT, "apps", "budget", "Index.html"), "utf8").match(/CLIENT_VERSION="([^"]+)"/) || [])[1];
ok(bv && bv === bc, `Budget Code.gs (${bv}) and Index.html (${bc}) versions match`);

// 3. calculations on sample data
const Calc = require(path.join(ROOT, "launcher", "app", "renderer", "calc.js"));
const pad = n => String(n).padStart(2, "0"), d0 = new Date(), ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const T = ymd(d0), add = n => { const d = new Date(d0); d.setDate(d.getDate() + n); return ymd(d); };
const B = { ok: true, today: T, me: "Person 1", people: ["Person 1", "Person 2"], version: "test",
  transactions: [{ person: "Person 1", date: T, amount: 40, category: "Living Expenses", sub: "Groceries", method: "Debit Card", desc: "Store", type: "Expense" }],
  salaries: [{ person: "Person 1", date: add(-3), amount: 2000, frequency: "Biweekly", source: "Work", type: "Income" }],
  budgets: [{ person: "Person 1", date: T.slice(0, 8) + "01", budget: 3000 }], cards: [], categoryBudgets: [], goals: [], goalMoves: [],
  bills: [{ id: "b1", name: "Rent", owner: "Household", amount: 1500, frequency: "Monthly", start: add(5), autopay: true, split: true }],
  billPaid: [], loans: [], loanPayments: [],
  accounts: [{ id: "a1", name: "Joint", kind: "Savings", owner: "Household", base: 5000, asOf: add(-1), getsPay: false, perPaycheck: 100, fromPerson: "Person 1", perPurchase: 1, purchasePerson: "Person 2", paysLoans: [] },
    { id: "a2", name: "P1 checking", kind: "Checking", owner: "Person 1", base: 1000, asOf: add(-1), getsPay: true, paysLoans: [] }] };
try {
  const b = Calc.budget(B, "Household"); ok(b && b.month && b.month.mtd === 40, "budget: spent this month = 40");
  const tl = Calc.timeline(null, B, "Person 1", add(-30), add(40)); ok(tl.some(x => x.name === "Rent"), "timeline has the Rent bill");
  const bk = Calc.bank(B, "Person 1", "Household"); const j = bk.accounts.find(a => a.name === "Joint"), c = bk.accounts.find(a => a.name === "P1 checking");
  ok(c && c.live === 960, "bank: checking 1000 − 40 spending = 960 (got " + (c && c.live) + ")");
  ok(j && j.next.some(e => e.label.startsWith("Rent")), "bank: Rent comes out of the joint account");
} catch (e) { ok(false, "calculations threw: " + e.stack); }

console.log(fails ? `\n${fails} check(s) failed` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
