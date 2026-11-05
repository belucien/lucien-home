/**
 * Family Budget Log — phone web app (v2). The year in its name updates itself.
 * Reads and writes the SAME Google Sheet your PC app uses, so both stay in sync.
 * v2 adds three tabs of its own (CategoryBudgets, Goals, GoalMoves). The PC app ignores them.
 *
 * SETUP (once):
 *   1. Set PIN below to a 6–10 digit number you both know.
 *   2. Run ▸ checkSetup  — confirms it can reach your Sheet and its tabs.
 *   3. Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone.
 */

const PIN = 'CHANGE-ME';   // <-- 6 to 10 digits, never send the link and PIN in the same message.

const SPREADSHEET_ID = 'PASTE-YOUR-SHEET-ID';  // from the Sheet's address: docs.google.com/spreadsheets/d/<THIS PART>/edit
const PEOPLE = ['Person 1', 'Person 2'];   // <-- your names

/* Dropdown choices. Edit these lists freely; existing rows are never changed. */
const CATEGORIES = ['Living Expenses', 'Personal', 'Medical', 'Vehicle', 'Other'];
const SUB_CATEGORIES = [
  'Rent', 'Utilities', 'Subscriptions', 'Groceries', 'Rental Insurance',
  'Fuel', 'Maintenance', 'Insurance', 'Hygiene', 'Gifts',
  'Entertainment', 'Tax Payment', 'Food', 'Misc.', 'Vacation',
  'Clothing', 'Electronics', 'Baby', 'Household', 'Education',
  'Car Insurance', 'Car Payment'
];
const BILL_FREQS = ['Weekly', 'Biweekly', 'Monthly', 'Quarterly', 'Yearly', 'One-time'];
const LOAN_KINDS = ['Car', 'Personal', 'Student', 'Mortgage', 'Other'];
const PAYMENT_METHODS = ['Debit Card', 'Apple Pay', 'Amazon Pay', 'Privacy Card', 'Cash', 'Bank Account', 'PayPal'];
const PAY_TYPES = ['Income', 'Savings', 'Stock', 'Tax Return'];
const FREQUENCIES = ['Monthly', 'Biweekly', 'One-Time'];

/* Tabs and their columns. The first four are the PC app's, in its order. */
const TABS = {
  Transactions:    ['Person', 'Date', 'Amount', 'Category', 'Sub-category', 'Payment Method', 'Description', 'Type'],
  Salaries:        ['Person', 'Date', 'Amount', 'Frequency', 'Source', 'Type'],
  Budgets:         ['Person', 'Date', 'Budget'],
  CreditCards:     ['Person', 'Date', 'Card Name', 'Credit Limit', 'APR', 'Current Balance'],
  CategoryBudgets: ['Person', 'Month', 'Category', 'Budget'],
  Goals:           ['Id', 'Name', 'Owner', 'Target', 'Target Date', 'Starting', 'Created', 'Archived'],
  GoalMoves:       ['Goal Id', 'Date', 'Person', 'Amount', 'Note'],
  Bills:           ['Id', 'Name', 'Owner', 'Amount', 'Frequency', 'Start Date', 'Category', 'Sub-category', 'Method', 'Autopay', 'Notes', 'Split'],
  BillPaid:        ['Bill Id', 'Due Date', 'Paid Date', 'Person', 'Amount'],
  Loans:           ['Id', 'Person', 'Name', 'Kind', 'Lender', 'Original', 'Balance', 'As Of Date', 'APR', 'Payment', 'Due Day', 'Start Date'],
  LoanPayments:    ['Loan Id', 'Date', 'Person', 'Amount', 'Note']
};
const HOUSEHOLD = 'Household';

const MAX_TRIES = 8;          // wrong PINs allowed…
const LOCK_MINUTES = 15;      // …per this many minutes, for everyone

/* ================= web app ================= */

const APP_VERSION = '2026.11.06';   // shown at the bottom of the app. Code.gs and Index.html should match.

function appName_() {
  const pr = PropertiesService.getScriptProperties();
  const name = pr.getProperty('APP_NAME') || 'Family Budget Log';
  const addYear = pr.getProperty('APP_ADD_YEAR') !== 'no';
  return { name: name, addYear: addYear, display: name + (addYear ? ' ' + new Date().getFullYear() : '') };
}

/* n = {name, addYear}. Renames the app for everyone. */
function setAppName(pin, n) {
  auth_(pin);
  n = n || {};
  const name = String(n.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) throw new Error('Type a name for the app.');
  const pr = PropertiesService.getScriptProperties();
  pr.setProperty('APP_NAME', name);
  pr.setProperty('APP_ADD_YEAR', n.addYear === false ? 'no' : 'yes');
  return loadAll_();
}

/* Launcher feed: <web app link>?api=summary&u=<personal link code>. Read-only JSON for the desktop launcher.
   Only personal links work here (never the PIN), so the PIN never travels in a web address. */
function summaryJson_(p) {
  let out;
  try {
    if (!p.u) throw new Error('LINK: Use your personal link (the one with ?u=) in the launcher.');
    const who = auth_('t:' + p.u);
    out = Object.assign(loadAll_(), { me: who, app: 'budget', appName: appName_().display, version: APP_VERSION });
  } catch (err) { out = { error: String((err && err.message) || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

const RPC = { unlock, getAll, addTransaction, addPay, setBudget, setCategoryBudget, addCard, addGoal, addGoalMove, addBill, markBillPaid, addLoan, addLoanPayment, updateRow, deleteRow, setAppName };   // shorthand: each name is the app's own function

/* Launcher sign-in: POST {api:'connect', pin, person}. Checks the PIN (same lockout as the app) and returns
   that person's personal-link code, so the launcher never has to show or ask for a personal link. */
function doPost(e) {
  let out;
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (b.api === 'rpc') {   // Lucien Home saves through here; each function checks the PIN / personal code itself
      if (!Object.prototype.hasOwnProperty.call(RPC, b.fn)) throw new Error('Unknown request.');
      const value = RPC[b.fn].apply(null, Array.isArray(b.args) ? b.args : []);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, value: value === undefined ? null : value, version: APP_VERSION })).setMimeType(ContentService.MimeType.JSON);
    }
    if (b.api !== 'connect') throw new Error('Unknown request.');
    checkPin_(String(b.pin || ''));
    const who = PEOPLE.indexOf(b.person) >= 0 ? b.person : null;
    if (!who) throw new Error('Pick who is using this PC.');
    out = { ok: true, token: tokenFor_(who), me: who, people: PEOPLE, version: APP_VERSION };
  } catch (err) { out = { error: String((err && err.message) || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* The person's existing personal-link code, or a new one (other people's links keep working). */
function tokenFor_(who) {
  return withLock_(() => {
    const pr = PropertiesService.getScriptProperties();
    const map = JSON.parse(pr.getProperty('LINK_TOKENS') || '{}');
    const have = Object.keys(map).find(t => map[t] === who);
    if (have) return have;
    const t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    map[t] = who; pr.setProperty('LINK_TOKENS', JSON.stringify(map));
    return t;
  });
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.api === 'summary') return summaryJson_(p);
  const a = appName_();
  const safe = a.display.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = HtmlService.createHtmlOutputFromFile('Index').getContent().replace(/__APP_NAME__/g, safe);
  return HtmlService.createHtmlOutput(html)
    .setTitle(a.display)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ================= PIN & personal links ================= */

/* Accepts the shared PIN, or a personal-link code ("t:…").
   Returns the person a personal link belongs to, or null for the PIN. */
function auth_(cred) {
  cred = String(cred || '');
  if (cred.indexOf('t:') === 0) {
    const map = JSON.parse(PropertiesService.getScriptProperties().getProperty('LINK_TOKENS') || '{}');
    const who = map[cred.slice(2)];
    if (who && PEOPLE.indexOf(who) >= 0) return who;
    throw new Error('LINK: This personal link no longer works. Enter the PIN, or make new links.');
  }
  checkPin_(cred);
  return null;
}

/* Run from the editor (after deploying) to make one private link per person.
   Each link opens the app as that person with no PIN. Running it again
   replaces the links, and the old ones stop working (use this if a link leaks). */

/* The app's public address. Paste your Web app URL here (Deploy ▸ Manage deployments, the one ending in /exec).
   Needed because, run from the editor, Google reports a private /dev test address that only the owner can open. */
const APP_URL = '';

function appUrl_() {
  const url = String(APP_URL || ScriptApp.getService().getUrl() || '').trim();
  if (!/\/exec$/.test(url)) {
    Logger.log('⚠ Paste your Web app URL (it ends in /exec) into APP_URL at the top of Code.gs, save, and run this again. ' +
               'Find it under Deploy ▸ Manage deployments. Links ending in /dev only work for you.');
    return null;
  }
  return url;
}

function makePersonalLinks() {
  const url = appUrl_();
  if (!url) return;
  const map = {};
  PEOPLE.forEach(p => {
    const t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    map[t] = p;
    Logger.log(p + ': ' + url + '?u=' + t);
  });
  PropertiesService.getScriptProperties().setProperty('LINK_TOKENS', JSON.stringify(map));
  Logger.log('Each link is private to that person. Any older personal links no longer work.');
}

function checkPin_(pin) {
  if (!/^\d{6,10}$/.test(PIN)) throw new Error('The app owner needs to set a 6–10 digit PIN in Code.gs.');
  const cache = CacheService.getScriptCache();
  const tries = Number(cache.get('badPins') || 0);
  if (tries >= MAX_TRIES) throw new Error('LOCKED: Too many wrong PINs. Try again in ' + LOCK_MINUTES + ' minutes.');
  if (!safeEqual_(String(pin || ''), PIN)) {
    cache.put('badPins', String(tries + 1), LOCK_MINUTES * 60);
    const left = MAX_TRIES - tries - 1;
    throw new Error('PIN: That PIN isn\'t right.' + (left <= 3 ? ' ' + left + ' tries left before a ' + LOCK_MINUTES + '-minute lock.' : ''));
  }
}

function safeEqual_(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/* ================= API (each call needs the PIN) ================= */

function unlock(pin) { const who = auth_(pin); return Object.assign(loadAll_(), { me: who }); }
function getAll(pin) { auth_(pin); return loadAll_(); }

/* t = {person, date, amount, category, sub, method, desc, type, split?:{pct}}
   split.pct = the other person's share in percent; saves two rows. */
function addTransaction(pin, t) {
  auth_(pin);
  const split = t && t.split && Number(t.split.pct) > 0 ? Math.min(100, Number(t.split.pct)) : 0;
  const base = cleanTxn_(t);
  let rows = [base];
  if (split && base.category !== 'Credit Card') {
    const other = PEOPLE.find(p => p !== base.person);
    const theirs = Math.round(base.amount * split) / 100;
    const mine = Math.round((base.amount - theirs) * 100) / 100;
    const desc = base.desc + ' (split)';
    rows = [Object.assign({}, base, { amount: mine, desc }), Object.assign({}, base, { person: other, amount: theirs, desc })]
      .filter(r => r.amount > 0);
  }
  return withLock_(() => {
    const existing = readTab_('Transactions');
    rows.forEach(r => { if (isDupTxn_(existing, r)) throw new Error('This transaction already exists.'); });
    rows.forEach(r => appendRow_('Transactions', txnRow_(r)));
    return loadAll_();
  });
}

/* p = {person, date, amount, frequency, source, type} */
function addPay(pin, p) {
  auth_(pin);
  const r = cleanPay_(p);
  return withLock_(() => {
    if (readTab_('Salaries').some(x => x.Person === r.Person && x.Date === r.Date &&
        num_(x.Amount) === r.Amount && low_(x.Source) === low_(r.Source)))
      throw new Error('This pay entry already exists.');
    appendRow_('Salaries', r);
    return loadAll_();
  });
}

/* b = {person, month:'YYYY-MM', budget}. Replaces that month's budget if one exists. */
function setBudget(pin, b) {
  auth_(pin);
  const person = oneOf_(b.person, PEOPLE, 'person');
  const month = month_(b.month);
  const budget = positive_(b.budget);
  return withLock_(() => {
    const hit = readTab_('Budgets').find(r => r.Person === person && String(r.Date).slice(0, 7) === month);
    if (hit) setCells_('Budgets', hit._row, { 'Budget': budget });
    else appendRow_('Budgets', { 'Person': person, 'Date': month + '-01', 'Budget': budget });
    return loadAll_();
  });
}

/* c = {person, month:'YYYY-MM', category (a sub-category), budget}.
   Applies from that month on until changed. budget 0 = stop budgeting it from that month. */
function setCategoryBudget(pin, c) {
  auth_(pin);
  const person = oneOf_(c.person, PEOPLE.concat([HOUSEHOLD]), 'person');
  const month = month_(c.month);
  const category = oneOf_(c.category, SUB_CATEGORIES, 'category');
  const budget = Math.round(Number(c.budget) * 100) / 100;
  if (!(budget >= 0)) throw new Error('Budget can\'t be negative.');
  return withLock_(() => {
    const hit = readTab_('CategoryBudgets').find(r => r.Person === person && monthOf_(r.Month) === month && r.Category === category);
    if (hit) setCells_('CategoryBudgets', hit._row, { 'Budget': budget });
    else appendRow_('CategoryBudgets', { 'Person': person, 'Month': "'" + month, 'Category': category, 'Budget': budget });
    return loadAll_();
  });
}

/* c = {person, date, name, limit, apr, balance} */
function addCard(pin, c) {
  auth_(pin);
  const r = cleanCard_(c);
  return withLock_(() => {
    if (readTab_('CreditCards').some(x => x.Person === r.Person && low_(x['Card Name']) === low_(r['Card Name'])))
      throw new Error('This credit card already exists for ' + r.Person + '.');
    appendRow_('CreditCards', r);
    return loadAll_();
  });
}

/* g = {name, owner, target, targetDate, starting} */
function addGoal(pin, g) {
  auth_(pin);
  const r = cleanGoal_(g);
  r['Id'] = 'g' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  r['Created'] = today_();
  r['Archived'] = false;
  return withLock_(() => { appendRow_('Goals', r); return loadAll_(); });
}

/* m = {goalId, date, person, amount (negative = withdrawal), note} */
function addGoalMove(pin, m) {
  auth_(pin);
  const amount = Math.round(Number(m.amount) * 100) / 100;
  if (!amount) throw new Error('Amount can\'t be $0.');
  return withLock_(() => {
    if (!readTab_('Goals').some(g => g.Id === m.goalId)) throw new Error('That goal was deleted.');
    appendRow_('GoalMoves', { 'Goal Id': m.goalId, 'Date': date_(m.date), 'Person': oneOf_(m.person, PEOPLE, 'person'),
                              'Amount': amount, 'Note': String(m.note || '').trim().slice(0, 200) });
    return loadAll_();
  });
}

/* ---------- bills ---------- */
function addBill(pin, b) {
  auth_(pin);
  const r = cleanBill_(b);
  r['Id'] = 'b' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  return withLock_(() => { appendRow_('Bills', r); return loadAll_(); });
}

/* p = {billId, due, date, amount, person, log, method}. log = also save it as spending (or a card payment). */
function markBillPaid(pin, p) {
  auth_(pin);
  p = p || {};
  const due = date_(p.due), date = date_(p.date || today_()), amount = positive_(p.amount);
  const person = oneOf_(p.person, PEOPLE, 'person');
  return withLock_(() => {
    const bill = readTab_('Bills').find(x => x.Id === p.billId);
    if (!bill) throw new Error('That bill was deleted.');
    if (readTab_('BillPaid').some(x => x['Bill Id'] === bill.Id && x['Due Date'] === due)) throw new Error('Already marked paid.');
    appendRow_('BillPaid', { 'Bill Id': bill.Id, 'Due Date': "'" + due, 'Paid Date': date, 'Person': person, 'Amount': amount });
    if (p.log) {
      let who = bill.Owner === HOUSEHOLD ? person : bill.Owner;
      if (bill.Category === 'Credit Card') {   // a card payment belongs to the card's owner, so it lowers that card's balance
        const card = readTab_('CreditCards').find(c => c['Card Name'] === bill['Sub-category'] && (bill.Owner === HOUSEHOLD || c.Person === bill.Owner));
        if (card) who = card.Person;
      }
      const split = bill.Owner === HOUSEHOLD && bill.Category !== 'Credit Card' && (bill.Split === true || String(bill.Split).toUpperCase() === 'TRUE');
      if (split) {   // one spending row per person, even shares (cents left over go to the payer)
        const each = Math.floor(amount / PEOPLE.length * 100) / 100;
        PEOPLE.forEach(pp => {
          const amt = pp === person ? Math.round((amount - each * (PEOPLE.length - 1)) * 100) / 100 : each;
          appendRow_('Transactions', txnRow_(cleanTxn_({ person: pp, date, amount: amt, category: bill.Category, sub: bill['Sub-category'],
            method: PAYMENT_METHODS.indexOf(p.method) >= 0 ? p.method : (bill.Method || PAYMENT_METHODS[0]), desc: bill.Name + ' (split)', type: 'Expense' })));
        });
        return loadAll_();
      }
      const t = bill.Category === 'Credit Card'
        ? cleanTxn_({ person: who, date, amount: -amount, category: 'Credit Card', sub: bill['Sub-category'], method: 'Credit Card', desc: bill.Name + ' (bill)', type: 'Debt' })
        : cleanTxn_({ person: who, date, amount, category: bill.Category, sub: bill['Sub-category'], method: PAYMENT_METHODS.indexOf(p.method) >= 0 ? p.method : (bill.Method || PAYMENT_METHODS[0]), desc: bill.Name, type: 'Expense' });
      appendRow_('Transactions', txnRow_(t));
    }
    return loadAll_();
  });
}

/* ---------- loans ---------- */
function addLoan(pin, l) {
  auth_(pin);
  const r = cleanLoan_(l);
  r['Id'] = 'l' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  return withLock_(() => { appendRow_('Loans', r); return loadAll_(); });
}

/* p = {loanId, date, amount, person, note, log, method}. log = also save it as spending (Car Payment for car loans). */
function addLoanPayment(pin, p) {
  auth_(pin);
  p = p || {};
  const date = date_(p.date || today_()), amount = positive_(p.amount);
  const person = oneOf_(p.person, PEOPLE, 'person');
  return withLock_(() => {
    const loan = readTab_('Loans').find(x => x.Id === p.loanId);
    if (!loan) throw new Error('That loan was deleted.');
    const note = String(p.note || '').slice(0, 120);
    if (/^due:/.test(note) && readTab_('LoanPayments').some(x => x['Loan Id'] === loan.Id && x.Note === note)) throw new Error('Already marked paid.');
    appendRow_('LoanPayments', { 'Loan Id': loan.Id, 'Date': date, 'Person': person, 'Amount': amount, 'Note': note });
    if (p.log) {
      const car = loan.Kind === 'Car';
      appendRow_('Transactions', txnRow_(cleanTxn_({ person: loan.Person, date, amount, category: car ? 'Vehicle' : 'Other',
        sub: car ? 'Car Payment' : 'Misc.', method: PAYMENT_METHODS.indexOf(p.method) >= 0 ? p.method : 'Bank Account', desc: loan.Name + ' payment', type: 'Expense' })));
    }
    return loadAll_();
  });
}

function cleanBill_(b) {
  b = b || {};
  const owner = oneOf_(b.owner, PEOPLE.concat([HOUSEHOLD]), 'owner');
  const cat = String(b.category || '');
  let sub;
  if (cat === 'Credit Card') sub = text_(b.sub, 'Card');
  else { oneOf_(cat, CATEGORIES, 'category'); sub = oneOf_(b.sub, SUB_CATEGORIES, 'sub-category'); }
  return { 'Name': text_(b.name, 'Bill name').slice(0, 80), 'Owner': owner, 'Amount': positive_(b.amount),
           'Frequency': oneOf_(b.frequency, BILL_FREQS, 'how often'), 'Start Date': "'" + date_(b.start),
           'Category': cat, 'Sub-category': sub, 'Method': PAYMENT_METHODS.indexOf(b.method) >= 0 ? b.method : '',
           'Autopay': !!b.autopay, 'Notes': String(b.notes || '').trim().slice(0, 200),
           'Split': owner === HOUSEHOLD && cat !== 'Credit Card' && !!b.split };   // split = each person carries an even share
}
function cleanLoan_(l) {
  l = l || {};
  const apr = Number(l.apr); if (!(apr >= 0 && apr < 100)) throw new Error('Enter the APR (0 if none).');
  const day = Math.round(Number(l.dueDay) || 0); if (!(day >= 1 && day <= 31)) throw new Error('Pick the day of the month the payment is due.');
  const balance = positive_(l.balance, 'Current balance');
  return { 'Person': oneOf_(l.person, PEOPLE, 'person'), 'Name': text_(l.name, 'Loan name').slice(0, 80), 'Kind': oneOf_(l.kind, LOAN_KINDS, 'loan type'),
           'Lender': String(l.lender || '').trim().slice(0, 80), 'Original': Math.max(balance, Number(l.original) || 0), 'Balance': balance,
           'As Of Date': "'" + date_(l.asOf || today_()), 'APR': apr, 'Payment': positive_(l.payment, 'Monthly payment'), 'Due Day': day,
           'Start Date': l.start ? "'" + date_(l.start) : '' };
}

/* Edit one row. `fp` is the fingerprint the page saw, so a row someone else
   changed in the meantime is never overwritten by mistake. */
function updateRow(pin, tabName, row, fp, obj) {
  auth_(pin);
  return withLock_(() => {
    const r = findByFp_(tabName, row, fp);
    let cells;
    if (tabName === 'Transactions') cells = txnRow_(cleanTxn_(obj));
    else if (tabName === 'Salaries') cells = cleanPay_(obj);
    else if (tabName === 'CreditCards') {
      cells = cleanCard_(obj);
      const clash = readTab_('CreditCards').some(x => x._row !== r._row && x.Person === cells.Person && low_(x['Card Name']) === low_(cells['Card Name']));
      if (clash) throw new Error('Another card already has that name.');
      // keep this card's charges and payments attached after a rename or a move to the other person
      if (r['Card Name'] !== cells['Card Name'] || r.Person !== cells.Person) {
        readTab_('Transactions').forEach(t => {
          if (t.Category === 'Credit Card' && t.Person === r.Person && t['Sub-category'] === r['Card Name'])
            setCells_('Transactions', t._row, { 'Sub-category': cells['Card Name'], 'Person': cells.Person });
        });
      }
    }
    else if (tabName === 'Goals') { cells = cleanGoal_(obj); if ('archived' in obj) cells['Archived'] = !!obj.archived; }
    else if (tabName === 'Bills') cells = cleanBill_(obj);
    else if (tabName === 'Loans') cells = cleanLoan_(obj);
    else throw new Error('That kind of entry can\'t be edited here.');
    setCells_(tabName, r._row, cells);
    return loadAll_();
  });
}

/* Delete one row (fingerprint-checked). Deleting a goal, bill or loan also deletes its deposits/payments. */
function deleteRow(pin, tabName, row, fp) {
  auth_(pin);
  if (!TABS[tabName]) throw new Error('Unknown tab.');
  return withLock_(() => {
    const r = findByFp_(tabName, row, fp);
    const kids = { Goals: ['GoalMoves', 'Goal Id'], Bills: ['BillPaid', 'Bill Id'], Loans: ['LoanPayments', 'Loan Id'] }[tabName];
    if (kids) {
      readTab_(kids[0]).filter(m => m[kids[1]] === r.Id).map(m => m._row).sort((a, b) => b - a).forEach(n => tab_(kids[0]).deleteRow(n));
    }
    tab_(tabName).deleteRow(r._row);
    return loadAll_();
  });
}

/* ================= setup check (run from the editor) ================= */

function checkSetup() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log('Connected to: ' + ss.getName());
  Object.keys(TABS).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) { Logger.log('• ' + name + ': not there yet — it will be created the first time it\'s needed.'); return; }
    const head = headers_(sh);
    const missing = TABS[name].filter(c => head.indexOf(c) < 0);
    Logger.log('• ' + name + ': ' + (sh.getLastRow() - 1) + ' rows' +
               (missing.length ? '  ⚠ missing columns: ' + missing.join(', ') : '  ✓'));
  });
  Logger.log(/^\d{6,10}$/.test(PIN) ? 'PIN is set ✓' : '⚠ Set PIN at the top of Code.gs to 6–10 digits.');
}

/* ================= helpers ================= */

function loadAll_() {
  const pack = (r, o) => Object.assign({ row: r._row, fp: fingerprint_(r) }, o);
  return {
    appName: appName_().name, addYear: appName_().addYear, version: APP_VERSION,
    people: PEOPLE, categories: CATEGORIES, subCategories: SUB_CATEGORIES,
    paymentMethods: PAYMENT_METHODS, payTypes: PAY_TYPES, frequencies: FREQUENCIES, billFreqs: BILL_FREQS, loanKinds: LOAN_KINDS,
    today: today_(),
    transactions: readTab_('Transactions').map(r => pack(r, { person: r.Person, date: r.Date, amount: num_(r.Amount),
      category: r.Category, sub: r['Sub-category'], method: r['Payment Method'], desc: r.Description, type: r.Type })),
    salaries: readTab_('Salaries').map(r => pack(r, { person: r.Person, date: r.Date, amount: num_(r.Amount),
      frequency: r.Frequency, source: r.Source, type: r.Type })),
    budgets: readTab_('Budgets').map(r => pack(r, { person: r.Person, date: r.Date, budget: num_(r.Budget) })),
    cards: readTab_('CreditCards').map(r => pack(r, { person: r.Person, date: r.Date, name: r['Card Name'],
      limit: num_(r['Credit Limit']), apr: num_(r.APR), balance: num_(r['Current Balance']) })),
    catBudgets: readTab_('CategoryBudgets').map(r => pack(r, { person: r.Person, month: monthOf_(r.Month),
      category: r.Category, budget: num_(r.Budget) })),
    goals: readTab_('Goals').map(r => pack(r, { id: r.Id, name: r.Name, owner: r.Owner, target: num_(r.Target),
      targetDate: r['Target Date'] || '', starting: num_(r.Starting), created: r.Created,
      archived: r.Archived === true || String(r.Archived).toUpperCase() === 'TRUE' })),
    goalMoves: readTab_('GoalMoves').map(r => pack(r, { goalId: r['Goal Id'], date: r.Date, person: r.Person,
      amount: num_(r.Amount), note: r.Note })),
    bills: readTab_('Bills').map(r => pack(r, { id: r.Id, name: r.Name, owner: r.Owner, amount: num_(r.Amount), frequency: r.Frequency,
      start: r['Start Date'], category: r.Category, sub: r['Sub-category'], method: r.Method, notes: r.Notes,
      autopay: r.Autopay === true || String(r.Autopay).toUpperCase() === 'TRUE',
      split: r.Split === true || String(r.Split).toUpperCase() === 'TRUE' })),
    billPaid: readTab_('BillPaid').map(r => pack(r, { billId: r['Bill Id'], due: r['Due Date'], date: r['Paid Date'], person: r.Person, amount: num_(r.Amount) })),
    loans: readTab_('Loans').map(r => pack(r, { id: r.Id, person: r.Person, name: r.Name, kind: r.Kind, lender: r.Lender, original: num_(r.Original),
      balance: num_(r.Balance), asOf: r['As Of Date'], apr: num_(r.APR), payment: num_(r.Payment), dueDay: num_(r['Due Day']), start: r['Start Date'] })),
    loanPayments: readTab_('LoanPayments').map(r => pack(r, { loanId: r['Loan Id'], date: r.Date, person: r.Person, amount: num_(r.Amount), note: r.Note }))
  };
}

let ss__ = null;
function ss_() { return ss__ || (ss__ = SpreadsheetApp.openById(SPREADSHEET_ID)); }
function today_() { return Utilities.formatDate(new Date(), ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd'); }

function tab_(name) {
  let sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function headers_(sh) {
  const w = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, w).getValues()[0].map(h => String(h).trim());
}

/* Rows as objects keyed by header. Dates come back as 'YYYY-MM-DD'. */
function readTab_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) return [];
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const head = headers_(sh);
  const tz = ss_().getSpreadsheetTimeZone();
  const vals = sh.getRange(2, 1, n, head.length).getValues();
  const out = [];
  vals.forEach((v, i) => {
    if (v.every(x => x === '' || x === null)) return;
    const o = { _row: i + 2 };
    head.forEach((h, j) => {
      let x = v[j];
      if (x instanceof Date) x = Utilities.formatDate(x, tz, 'yyyy-MM-dd');
      else if (/Date|Created/.test(h) && x !== '') x = normDate_(x);
      o[h] = (typeof x === 'string') ? x.trim() : x;
    });
    out.push(o);
  });
  return out;
}

function appendRow_(name, obj) {
  const sh = tab_(name);
  let head = headers_(sh);
  if (head.every(h => !h)) {
    head = TABS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  }
  TABS[name].forEach(c => {                       // add any missing column at the end
    if (head.indexOf(c) < 0) { sh.getRange(1, head.length + 1).setValue(c).setFontWeight('bold'); head.push(c); }
  });
  sh.appendRow(head.map(h => (h in obj) ? obj[h] : ''));
}

function setCells_(name, row, obj) {
  const sh = tab_(name), head = headers_(sh);
  Object.keys(obj).forEach(k => {
    if (head.indexOf(k) < 0 && (TABS[name] || []).indexOf(k) >= 0) { sh.getRange(1, head.length + 1).setValue(k).setFontWeight('bold'); head.push(k); }
    const j = head.indexOf(k);
    if (j >= 0) sh.getRange(row, j + 1).setValue(obj[k]);
  });
}

function findByFp_(name, row, fp) {
  if (!TABS[name]) throw new Error('Unknown tab.');
  const r = readTab_(name).find(x => x._row === Number(row));
  if (!r || fingerprint_(r) !== fp) throw new Error('That entry changed or was deleted. The list has been refreshed.');
  return r;
}

function fingerprint_(r) {
  return Object.keys(r).filter(k => k !== '_row').sort().map(k => String(r[k])).join('|');
}

function isDupTxn_(rows, t) {
  return rows.some(r => r.Person === t.person && r.Date === t.date && num_(r.Amount) === t.amount &&
    low_(r.Description) === low_(t.desc) && (t.category !== 'Credit Card' || low_(r['Sub-category']) === low_(t.sub)));
}

function txnRow_(t) {
  return { 'Person': t.person, 'Date': t.date, 'Amount': t.amount, 'Category': t.category,
           'Sub-category': t.sub, 'Payment Method': t.method, 'Description': t.desc, 'Type': t.type };
}

function cleanTxn_(t) {
  t = t || {};
  const person = oneOf_(t.person, PEOPLE, 'person');
  const date = date_(t.date);
  if (t.category === 'Credit Card') {
    const amount = Math.round(Number(t.amount) * 100) / 100;
    if (!amount) throw new Error('Amount must be more than $0.');
    return { person, date, amount, category: 'Credit Card', sub: text_(t.sub, 'Card'),
             method: 'Credit Card', desc: text_(t.desc, 'Description'), type: 'Debt' };
  }
  return {
    person, date, amount: positive_(t.amount),
    category: oneOf_(t.category, CATEGORIES, 'category'),
    sub: oneOf_(t.sub, SUB_CATEGORIES, 'sub-category'),
    method: oneOf_(t.method, PAYMENT_METHODS, 'payment method'),
    desc: text_(t.desc, 'Description'),
    type: oneOf_(t.type, ['Expense', 'Income'], 'type')
  };
}

function cleanPay_(p) {
  p = p || {};
  return { 'Person': oneOf_(p.person, PEOPLE, 'person'), 'Date': date_(p.date), 'Amount': positive_(p.amount),
           'Frequency': oneOf_(p.frequency, FREQUENCIES, 'frequency'), 'Source': text_(p.source, 'Employer / Source'),
           'Type': oneOf_(p.type, PAY_TYPES, 'type') };
}

function cleanCard_(c) {
  c = c || {};
  const apr = Number(c.apr);
  if (!(apr >= 0)) throw new Error('APR can\'t be negative.');
  return { 'Person': oneOf_(c.person, PEOPLE, 'person'), 'Date': date_(c.date), 'Card Name': text_(c.name, 'Card name'),
           'Credit Limit': positive_(c.limit, 'Credit limit'), 'APR': apr, 'Current Balance': Number(c.balance) || 0 };
}

function cleanGoal_(g) {
  g = g || {};
  const td = String(g.targetDate || '');
  if (td && !/^\d{4}-\d{2}-\d{2}$/.test(td)) throw new Error('Pick a target date or leave it blank.');
  const starting = Math.round(Number(g.starting || 0) * 100) / 100;
  if (!(starting >= 0)) throw new Error('Starting amount can\'t be negative.');
  return { 'Name': text_(g.name, 'Goal name').slice(0, 60), 'Owner': oneOf_(g.owner, PEOPLE.concat(['Both']), 'owner'),
           'Target': positive_(g.target, 'Target'), 'Target Date': td ? "'" + td : '', 'Starting': starting };
}

function oneOf_(v, list, what) {
  if (list.indexOf(v) < 0) throw new Error('Pick a ' + what + '.');
  return v;
}
function text_(v, what) {
  v = String(v || '').trim();
  if (!v) throw new Error(what + ' is required.');
  return v.slice(0, 200);
}
function positive_(v, what) {
  const n = Math.round(Number(v) * 100) / 100;
  if (!(n > 0)) throw new Error((what || 'Amount') + ' must be more than $0.');
  return n;
}
function date_(v) {
  v = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Pick a date.');
  return v;
}
function month_(v) {
  v = String(v || '');
  if (!/^\d{4}-\d{2}$/.test(v)) throw new Error('Pick a month.');
  return v;
}
function monthOf_(x) {
  if (x instanceof Date) return Utilities.formatDate(x, ss_().getSpreadsheetTimeZone(), 'yyyy-MM');
  return String(x || '').replace(/^'/, '').slice(0, 7);
}
function normDate_(x) {
  const s = String(x).trim().replace(/^'/, '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return s;
}
function num_(x) { const n = Number(String(x).replace(/[$,\s]/g, '')); return isFinite(n) ? n : 0; }
function low_(x) { return String(x == null ? '' : x).trim().toLowerCase(); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
