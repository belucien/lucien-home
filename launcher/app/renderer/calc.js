/* Lucien Home: turns each app's summary feed into what the launcher shows.
   The rules match the apps themselves (Planner countdowns, Budget Log pace, bills and debt). */
(function (root) {
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseD = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const days = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
  const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
  const sum = a => a.reduce((s, x) => s + (+x || 0), 0);
  const mkey = d => String(d || "").slice(0, 7);
  const dim = k => { const [y, m] = k.split("-").map(Number); return new Date(y, m, 0).getDate(); };
  const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ---------------- Planner ---------------- */
  const nthDow = (y, m, dow, n) => { const d = new Date(y, m, 1); const off = (dow - d.getDay() + 7) % 7; return new Date(y, m, 1 + off + 7 * (n - 1)); };
  function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
  const HOLIDAYS = [
    ["newyear", "New Year's Day", y => new Date(y, 0, 1)], ["valentines", "Valentine's Day", y => new Date(y, 1, 14)],
    ["easter", "Easter", y => easter(y)], ["mothers", "Mother's Day", y => nthDow(y, 4, 0, 2)], ["fathers", "Father's Day", y => nthDow(y, 5, 0, 3)],
    ["july4", "Independence Day", y => new Date(y, 6, 4)], ["halloween", "Halloween", y => new Date(y, 9, 31)],
    ["thanksgiving", "Thanksgiving", y => nthDow(y, 10, 4, 4)], ["blackfriday", "Black Friday", y => { const t = nthDow(y, 10, 4, 4); return new Date(y, 10, t.getDate() + 1); }],
    ["christmas", "Christmas", y => new Date(y, 11, 25)], ["nye", "New Year's Eve", y => new Date(y, 11, 31)]
  ];
  const KIND = { party: "Party", concert: "Concert", vacation: "Trip", birthday: "Birthday", appointment: "Appointment", other: "Event", holiday: "Holiday", baby: "Baby" };

  function plannerCountdowns(S, t) {
    const events = S.events || [], out = [];
    const hide = new Set(events.filter(e => e.kind === "hidden").map(e => String(e.id).replace(/^hide-/, "")));
    const y0 = parseD(t).getFullYear();
    HOLIDAYS.forEach(([key, name, fn]) => { if (hide.has(key)) return; let d = ymd(fn(y0)); if (d < t) d = ymd(fn(y0 + 1)); out.push({ id: "hol:" + key, name, kind: "holiday", start: d, end: "" }); });
    if (isYmd(S.due) && days(t, S.due) <= 30 && S.due >= t) out.push({ id: "baby", name: "Baby's due date", kind: "baby", start: S.due, end: "" });
    events.filter(e => e.kind !== "hidden" && isYmd(e.start)).forEach(e => {
      let s = e.start, en = isYmd(e.end) ? e.end : "";
      if (e.yearly) { const span = en ? days(s, en) : 0;
        for (const yy of [y0 - 1, y0, y0 + 1]) { const ns = yy + s.slice(4), ne = span ? addDays(ns, span) : ""; if ((ne || ns) >= t) { s = ns; en = ne; break; } } }
      out.push({ id: e.id, name: e.name, kind: e.kind || "other", start: s, end: en, time: e.time || "", place: e.place || "", by: e.by || "" });
    });
    return out.map(c => { const last = c.end || c.start, d = days(t, c.start), past = last < t, now = !past && c.start <= t;
      return Object.assign(c, { days: d, past, now, label: KIND[c.kind] || "Event" }); })
      .filter(c => !c.past).sort((a, b) => a.start.localeCompare(b.start) || (a.time || "").localeCompare(b.time || ""));
  }

  function weekOf(s) { const d = parseD(s); d.setDate(d.getDate() - d.getDay()); return ymd(d); }

  function planner(S, link) {
    const t = S.today || ymd(new Date());
    const people = S.people || [];
    let me = link && link.me ? people.find(p => p.toLowerCase() === String(link.me).toLowerCase()) || null : null;
    const lists = (S.lists || []).map(l => {
      const its = (S.items || []).filter(i => i.cat === l.id);
      return { id: l.id, name: l.label || l.name || l.id, total: its.length, done: its.filter(i => i.bought).length };
    });
    const shopCount = (S.items || []).filter(i => i.cat === "groceries" && !i.bought).length;
    const recipeName = id => { const r = (S.recipes || []).find(r => r.id === id || r.name === id); return r ? r.name : ""; };
    const wk = weekOf(t), dow = parseD(t).getDay();
    const nights = Array(7).fill(null); (S.plan || []).filter(p => p.week === wk && !(p.slot === "breakfast" || p.slot === "drink")).forEach(p => { if (p.day >= 0 && p.day < 7) nights[p.day] = p; });
    const nightLabel = n => !n ? "" : n.kind === "skip" ? "No dinner" : n.kind === "takeout" || n.kind === "out" ? "Takeout" : n.recipe ? recipeName(n.recipe) : "";
    const tonight = nightLabel(nights[dow]) || null;
    const planned = nights.filter(n => n && (n.recipe || n.kind !== "meal")).length;
    const cds = plannerCountdowns(S, t);
    const babyDays = isYmd(S.due) ? days(t, S.due) : null;
    const baby = lists.find(l => /baby/i.test(l.name));
    const wkPlan = (S.plan || []).filter(p => p.week === wk && p.recipe);
    const extras = { breakfast: wkPlan.filter(p => p.slot === "breakfast").length, drink: wkPlan.filter(p => p.slot === "drink").length };
    const todayX = wkPlan.filter(p => p.day === dow && (p.slot === "breakfast" || p.slot === "drink")).map(p => ({ slot: p.slot, name: recipeName(p.recipe) })).filter(x => x.name);
    const week = nights.map((n, i) => ({ day: i, date: addDays(wk, i), label: nightLabel(n) }));
    const tomorrow = dow < 6 ? nightLabel(nights[dow + 1]) || null : null;
    const recent = (S.items || []).filter(i => i.bought && i.cat !== "groceries").length;
    return { ok: true, app: "planner", appName: S.appName || "Lucien Family Planner", version: S.version || "", today: t, me, people,
      due: S.due, babyDays, countdowns: cds, lists, shopCount, tonight, tomorrow, mealsPlanned: planned, baby, extras, todayX, week, doneItems: recent,
      itemsLeft: sum(lists.filter(l => l.id !== "groceries").map(l => l.total - l.done)) };
  }

  /* ---------------- Budget Log ---------------- */
  function addMonthsKeepDay(s, n, day) { const [y, m, d] = s.split("-").map(Number), t = new Date(y, m - 1 + n, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); return ymd(new Date(t.getFullYear(), t.getMonth(), Math.min(day || d, last))); }
  function occurrences(b, from, to) {
    const out = [], st = b.start; if (!isYmd(st)) return out;
    if (b.frequency === "One-time") { if (st >= from && st <= to) out.push(st); return out; }
    const months = { Monthly: 1, Quarterly: 3, Yearly: 12 }[b.frequency], dd = { Weekly: 7, Biweekly: 14 }[b.frequency];
    if (!months && !dd) return out;
    for (let i = 0; i < 800; i++) { const d = months ? addMonthsKeepDay(st, i * months) : addDays(st, i * dd); if (d > to) break; if (d >= from) out.push(d); }
    return out;
  }
  function liveLoan(D, l, t) {
    let bal = l.balance, last = l.asOf || l.start || t;
    (D.loanPayments || []).filter(p => p.loanId === l.id && p.date >= last).sort((a, b) => a.date.localeCompare(b.date)).forEach(p => {
      const dd = Math.max(0, days(last, p.date)); bal += bal * l.apr / 100 * dd / 365; bal = Math.max(0, bal - p.amount); last = p.date; });
    return bal;
  }
  function amortize(bal, apr, pay) { const r = apr / 1200; let n = 0; if (bal <= 0.005) return 0; if (pay <= bal * r + 0.005) return Infinity; while (bal > 0.005 && n < 1200) { bal = bal + bal * r - pay; n++; } return n; }
  function loanDues(l, from, to, t) { const st = (l.asOf || l.start || t).slice(0, 8) + "01", out = [];
    for (let i = 0; i < 240; i++) { const d = addMonthsKeepDay(st, i, l.dueDay); if (d > to) break; if (d >= from && d > (l.asOf || "")) out.push(d); } return out; }
  function loanPaidFor(D, l, due) { return (D.loanPayments || []).find(p => p.loanId === l.id && (p.note === "due:" + due || (!/^due:/.test(p.note || "") && p.date >= addDays(due, -20) && p.date <= addDays(due, 10)))); }

  /* scope = "Household" or a person's name, exactly like the tabs in the app */
  function budget(D, scope) {
    const t = D.today || ymd(new Date()), people = D.people || [];
    if (scope !== "Household" && people.indexOf(scope) < 0) scope = "Household";
    const ps = scope === "Household" ? people : [scope];
    const isSpend = x => x.type === "Expense" && x.category !== "Credit Card";
    const k = mkey(t), day = +t.slice(8, 10), n = dim(k);
    const txns = D.transactions || [];
    const mtd = sum(txns.filter(x => ps.includes(x.person) && isSpend(x) && mkey(x.date) === k && +String(x.date).slice(8, 10) <= day).map(x => x.amount));
    let total = 0, any = false; ps.forEach(p => { const b = (D.budgets || []).find(b => b.person === p && mkey(b.date) === k); if (b) { total += b.budget; any = true; } });
    const inc = sum([...(D.salaries || []).filter(s => ps.includes(s.person) && (s.type === "Income" || s.type === "Tax Return") && mkey(s.date) === k).map(s => s.amount),
                     ...txns.filter(x => ps.includes(x.person) && x.type === "Income" && x.category !== "Credit Card" && mkey(x.date) === k).map(x => x.amount)]);
    const lk = mkey(addMonthsKeepDay(k + "-01", -1, 1)), ldim = dim(lk);
    const lastSame = sum(txns.filter(x => ps.includes(x.person) && isSpend(x) && mkey(x.date) === lk && +String(x.date).slice(8, 10) <= Math.min(day, ldim)).map(x => x.amount));
    const lastAll = sum(txns.filter(x => ps.includes(x.person) && isSpend(x) && mkey(x.date) === lk).map(x => x.amount));
    const cm = {}; txns.filter(x => ps.includes(x.person) && isSpend(x) && mkey(x.date) === k).forEach(x => { const c = x.sub || x.category || "Other"; cm[c] = (cm[c] || 0) + x.amount; });
    const cats = Object.entries(cm).map(([name, amt]) => ({ name, amt })).sort((a, b) => b.amt - a.amt).slice(0, 5);
    // for the charts: running total by day (this month and last), and the last 6 months
    const cum = (key, len) => { const d = Array(len).fill(0); txns.filter(x => ps.includes(x.person) && isSpend(x) && mkey(x.date) === key).forEach(x => { const i = Math.min(len, Math.max(1, +String(x.date).slice(8, 10))) - 1; d[i] += x.amount; });
      for (let i = 1; i < len; i++) d[i] += d[i - 1]; return d; };
    const daily = cum(k, n).slice(0, day), lastDaily = cum(lk, ldim);
    const history = [];
    for (let i = 5; i >= 0; i--) { const hk = mkey(addMonthsKeepDay(k + "-01", -i, 1)); let bt = 0, anyB = false;
      ps.forEach(p => { const bb = (D.budgets || []).find(b => b.person === p && mkey(b.date) === hk); if (bb) { bt += bb.budget; anyB = true; } });
      history.push({ k: hk, label: MON[+hk.slice(5, 7) - 1], spent: sum(txns.filter(x => ps.includes(x.person) && isSpend(x) && mkey(x.date) === hk).map(x => x.amount)), budget: anyB ? bt : null, current: i === 0 }); }
    const month = { k, label: MON[+k.slice(5, 7) - 1], day, n, left: n - day, mtd, budget: any ? total : null, remaining: any ? total - mtd : null, forecast: day >= 5 ? mtd / day * n : null, income: inc, lastSame, lastAll, lastLabel: MON[+lk.slice(5, 7) - 1], cats, daily, lastDaily, history };

    // bills (unpaid; past-due ones first), exactly what the app's Dates tab shows for this scope
    const from = addDays(t, -60), to = addDays(t, 45), cnt = Math.max(1, people.length), bills = [];
    (D.bills || []).filter(b => b.owner === scope || (scope !== "Household" && b.owner === "Household" && b.split)).forEach(b => occurrences(b, from, to).forEach(due => {
      if ((D.billPaid || []).some(p => p.billId === b.id && p.due === due)) return;
      if (b.autopay && due <= t) return;
      const share = b.owner === "Household" && scope !== "Household";
      bills.push({ type: "bill", id: b.id, name: b.name, due, days: days(t, due), amount: share ? Math.round(b.amount / cnt * 100) / 100 : b.amount, full: b.amount,
        share, split: !!b.split, owner: b.owner, autopay: !!b.autopay, card: b.category === "Credit Card" });
    }));
    const loans = (D.loans || []).filter(l => ps.includes(l.person)).map(l => { const live = liveLoan(D, l, t), m = amortize(live, l.apr, l.payment);
      let payoff = null; if (isFinite(m) && m > 0) { const d = parseD(t); d.setMonth(d.getMonth() + m); payoff = MON[d.getMonth()] + " " + d.getFullYear(); }
      return { id: l.id, name: l.name, person: l.person, kind: l.kind, live, payment: l.payment, payoff }; });
    if (scope !== "Household") (D.loans || []).filter(l => l.person === scope && liveLoan(D, l, t) > 0.005).forEach(l => loanDues(l, from, to, t).forEach(due => {
      if (!loanPaidFor(D, l, due)) bills.push({ type: "loan", id: l.id, name: l.name, due, days: days(t, due), amount: l.payment, full: l.payment, loan: true });
    }));
    bills.sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
    // this month's bills: what's been paid (by hand or autopay) and what's still to pay
    const mFrom = k + "-01", mTo = k + "-" + pad(n), mb = { paid: 0, paidAmt: 0, auto: 0, left: 0, leftAmt: 0 };
    (D.bills || []).filter(b => b.owner === scope || (scope !== "Household" && b.owner === "Household" && b.split)).forEach(b => occurrences(b, mFrom, mTo).forEach(due => {
      const share = b.owner === "Household" && scope !== "Household", amt = share ? b.amount / cnt : b.amount;
      const pd = (D.billPaid || []).find(p => p.billId === b.id && p.due === due);
      if (pd || (b.autopay && due <= t)) { mb.paid++; mb.paidAmt += amt; if (b.autopay) mb.auto++; } else { mb.left++; mb.leftAmt += amt; }
    }));
    const ctx = txns.filter(x => x.category === "Credit Card");
    const cards = (D.cards || []).filter(c => ps.includes(c.person)).map(c => ({ name: c.name, person: c.person, limit: c.limit,
      live: c.balance + sum(ctx.filter(x => x.person === c.person && x.sub === c.name).map(x => x.amount)) }));
    const goals = (D.goals || []).filter(g => !g.archived).map(g => ({ name: g.name, target: g.target,
      saved: (g.starting || 0) + sum((D.goalMoves || []).filter(m => m.goalId === g.id).map(m => m.amount)) }));
    return { ok: true, app: "budget", appName: D.appName || "Family Budget Log", version: D.version || "", today: t, me: D.me || null, people, scope,
      month, bills, billsMonth: mb, loans, cards, cardTotal: sum(cards.map(c => c.live)), loanTotal: sum(loans.map(l => l.live)), goals };
  }

  /* Everything on a calendar between two dates, past and future, from both apps.
     Bills: Household plus "me"'s own. Paid ones are marked paid (or autopaid); loans show payments made and dues ahead. */
  function timeline(Pd, Bd, me, from, to) {
    const t = (Pd && Pd.today) || (Bd && Bd.today) || ymd(new Date()), out = [];
    if (Pd) {
      const events = Pd.events || [], hide = new Set(events.filter(e => e.kind === "hidden").map(e => String(e.id).replace(/^hide-/, "")));
      const y1 = +from.slice(0, 4), y2 = +to.slice(0, 4);
      for (let y = y1; y <= y2; y++) HOLIDAYS.forEach(([key, name, fn]) => { if (hide.has(key)) return; const d = ymd(fn(y)); if (d >= from && d <= to) out.push({ src: "planner", kind: "Holiday", ek: "holiday", name, date: d }); });
      if (isYmd(Pd.due) && Pd.due >= from && Pd.due <= to) out.push({ src: "planner", kind: "Baby", ek: "baby", name: "Baby's due date", date: Pd.due });
      events.filter(e => e.kind !== "hidden" && isYmd(e.start)).forEach(e => {
        const span = isYmd(e.end) ? Math.max(0, days(e.start, e.end)) : 0;
        const starts = e.yearly ? Array.from({ length: y2 - y1 + 2 }, (_, i) => (y1 - 1 + i) + e.start.slice(4)) : [e.start];
        starts.forEach(s => { const en = span ? addDays(s, span) : ""; if ((en || s) < from || s > to) return;
          out.push({ src: "planner", kind: KIND[e.kind] || "Event", ek: e.kind || "other", name: e.name, date: s, end: en, time: e.time || "", place: e.place || "", by: e.by || "" }); });
      });
    }
    if (Bd) {
      const people = Bd.people || [], cnt = Math.max(1, people.length), who = people.includes(me) ? me : null, paid = Bd.billPaid || [];
      (Bd.bills || []).filter(b => b.owner === "Household" || (who && b.owner === who)).forEach(b => occurrences(b, from, to).forEach(due => {
        const pd = paid.find(p => p.billId === b.id && p.due === due), past = due < t;
        const status = pd ? (/auto/i.test(pd.how || "") ? "autopaid" : "paid") : b.autopay && due <= t ? "autopaid" : past ? (days(due, t) <= 60 ? "late" : "unmarked") : "due";
        out.push({ src: "budget", kind: b.category === "Credit Card" ? "Card payment" : b.owner === "Household" ? "Household bill" : "Your bill", name: b.name, date: due,
          amount: b.amount, full: b.amount, split: !!b.split, autopay: !!b.autopay, owner: b.owner, status, paidOn: pd ? pd.date : "", paidBy: pd ? pd.person : "" });
      }));
      (Bd.loans || []).filter(l => !who || l.person === who).forEach(l => {
        (Bd.loanPayments || []).filter(p => p.loanId === l.id && p.date >= from && p.date <= to).forEach(p =>
          out.push({ src: "budget", kind: "Loan payment", name: l.name, date: p.date, amount: p.amount, full: p.amount, loan: true, status: "paid", paidOn: p.date, paidBy: p.person || l.person }));
        if (liveLoan(Bd, l, t) > 0.005) loanDues(l, t > from ? t : from, to, t).forEach(due => { if (!loanPaidFor(Bd, l, due))
          out.push({ src: "budget", kind: "Loan payment", name: l.name, date: due, amount: l.payment, full: l.payment, loan: true, status: "due" }); });
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "") || a.name.localeCompare(b.name));
  }

  const Calc = { timeline, planner, budget, plannerCountdowns, occurrences, ymd, parseD, days, addDays, MON };
  root.Calc = Calc;
  if (typeof module !== "undefined" && module.exports) module.exports = Calc;
})(typeof window !== "undefined" ? window : globalThis);
