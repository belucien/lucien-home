/**
 * Lucien Family Planner — shared lists, countdowns, meals and shopping.
 * Items are stored in the "Items" tab, list names in "Lists", your own
 * countdown events in "Events", and the meal planner in "Recipes", "MealPlan",
 * "MealChecks" and "Settings". All tabs are created automatically.
 * Groceries are ordinary items in the "groceries" list; the app shows them in the Shop tab.
 *
 * 1. Edit PEOPLE below to your two names.
 * 2. Run `setup` once (Run ▸ setup) to create the Items tab and starter items.
 * 3. Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone.
 */

const APP_NAME = 'Family Planner';   // <-- the app's name, shown at the top and on the browser tab
const PEOPLE = ['Person 1', 'Person 2'];   // <-- your names
const DUE_DATE = '';                     // optional: a baby's due date, like '2027-03-02'

const SHEET = 'Items';
const LISTS = 'Lists';                   // tab holding the list names
const DEFAULT_LISTS = [
  ['vehicle', 'Vehicle', 0], ['baby', 'Baby & leave prep', 1],
  ['bf', 'Black Friday', 2], ['groceries', 'Groceries', 3]
];
const COLORS = 6;                         // how many list colors the page has
const ID_KEY = 'SHEET_ID';
const COLS = ['id', 'cat', 'section', 'name', 'prio', 'est', 'paid', 'store',
              'notes', 'bought', 'by', 'boughtBy', 'created', 'boughtAt',
              'both', 'doneBy'];
// both   = TRUE when each person in PEOPLE has to check the item off themselves
// doneBy = who has checked it off so far (comma-separated names)

/* Run once from the editor (after deploying) to get each person's personal link.
   Opening your own link means the app always knows who you are on that phone. */

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

function showPersonalLinks() {
  const url = appUrl_();
  if (!url) return;
  PEOPLE.forEach(p => Logger.log(p + ': ' + url + '?me=' + encodeURIComponent(p)));
}

const APP_VERSION = '2026.11.09';   // changes with each update

/* Lucien Home (desktop launcher) saves through here: POST {api:'rpc', fn, args}.
   Only the functions the app's own screens use are allowed. */
const RPC = { getData, scanRecipe, addRecipe, updateRecipe, setFavorite, deleteRecipe, setWeekPlan, setNight, setShopCheck, clearBoughtGroceries, setSetting, setStoreFor, addEvent, updateEvent, deleteEvent, setHoliday, addList, renameList, deleteList, addItem, updateItem, markDone, deleteItem };   // shorthand: each name is the app's own function
function doPost(e) {
  let out;
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (b.api !== 'rpc' || !Object.prototype.hasOwnProperty.call(RPC, b.fn)) throw new Error('Unknown request.');
    out = { ok: true, value: RPC[b.fn].apply(null, Array.isArray(b.args) ? b.args : []), version: APP_VERSION };
  } catch (err) { out = { error: String((err && err.message) || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out === undefined ? null : out)).setMimeType(ContentService.MimeType.JSON);
}

/* Launcher feed: <web app link>?api=summary. Read-only JSON for the desktop launcher
   (the same lists, dates and meals anyone with the app link can already see). */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.api === 'summary') {
    let out;
    try {
      out = state_();
      out.recipes = out.recipes.map(r => ({ id: r.id, name: r.name }));
      out.app = 'planner'; out.version = APP_VERSION;
    } catch (err) { out = { error: String((err && err.message) || err) }; }
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);  // lets it be embedded in a Google Site
}

/* ---------- API called from the page ---------- */

function getData() {
  return state_();
}

function state_() {
  const today = Utilities.formatDate(new Date(), ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const wk = weekOf_(today), weeks = [addDays_(wk, -7), wk, addDays_(wk, 7)];
  return { appName: APP_NAME, people: PEOPLE, due: DUE_DATE, lists: readLists_(), items: readAll_(), events: readEvents_(), today: today,
           recipes: readRecipes_(), plan: readPlan_(weeks), checks: readChecks_(weeks), settings: readSettings_() };
}

/* ======================= RECIPE SCANNER ======================= */
/* Reads the text in a recipe photo with Google Drive's built-in text recognition (OCR).
   Needs the Drive API turned on: Apps Script editor ▸ Services (+) ▸ Drive API ▸ Add.
   The photo is saved to your Drive just long enough to read it, then moved to the trash. */
function scanRecipe(b64, mime) {
  if (typeof Drive === 'undefined' || !Drive.Files)
    throw new Error('SETUP: Recipe scanning needs the Drive API. In the Apps Script editor, click Services (+), add "Drive API", then publish a new version.');
  b64 = String(b64 || '');
  if (!b64 || b64.length > 11000000) throw new Error('That photo is too large. Try again with a closer shot of the recipe.');
  mime = /^image\/(jpeg|png|webp|heic)$/.test(String(mime)) ? String(mime) : 'image/jpeg';
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, 'recipe-scan');
  let id;
  try {
    if (typeof Drive.Files.create === 'function') {          // Drive API v3
      id = Drive.Files.create({ name: 'Recipe scan (temporary)', mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'en' }).id;
    } else {                                                 // Drive API v2
      id = Drive.Files.insert({ title: 'Recipe scan (temporary)', mimeType: mime }, blob, { ocr: true, ocrLanguage: 'en' }).id;
    }
    const text = DocumentApp.openById(id).getBody().getText();
    return { text: String(text || '').slice(0, 20000) };
  } finally {
    if (id) try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
  }
}

/* Run once from the editor after turning on the Drive API, so Google asks for permission up front. */
function authorizeScanner() {
  DriveApp.getRootFolder(); DocumentApp.getActiveDocument && true;
  Logger.log(typeof Drive !== 'undefined' ? 'Recipe scanner is ready ✓' : '⚠ Turn on the Drive API under Services (+) first.');
}

/* ======================= MEAL PLANNER ======================= */
/* Weeks start on Sunday. A plan row = one night: kind "meal" | "takeout" | "skip". */
const RECIPES = 'Recipes', PLAN = 'MealPlan', CHECKS = 'MealChecks', SETTINGS = 'Settings';
const RC_COLS = ['id', 'name', 'tags', 'servings', 'minutes', 'ingredients', 'steps', 'link', 'fav', 'by', 'created', 'type'];
const MEAL_TYPES = ['dinner', 'breakfast', 'drink'];   // a recipe is one of these; only dinners are drawn
const PL_COLS = ['week', 'day', 'kind', 'recipe', 'servings', 'leftovers', 'locked', 'cook', 'slot'];   // slot: dinner (blank), breakfast or drink
const CK_COLS = ['week', 'key', 'by', 'at'];
const TAGS = ['Vegan', 'Vegetarian', 'Pescatarian', 'Dairy-free', 'Gluten-free', 'Quick', 'Kid-friendly', 'Slow cooker'];

/* Starter recipes (4 servings). Ingredients: one per line. Delete any you don't want. */
const STARTER_RECIPES = [
  ['Black Bean Tacos', 'Vegan,Dairy-free,Gluten-free,Quick,Kid-friendly', 20, '2 cans black beans\n8 corn tortillas\n1 avocado\n1 lime\n1 cup salsa\n1 red onion\n1 bunch cilantro\n1 tsp cumin'],
  ['Chicken Stir-Fry', 'Dairy-free,Quick', 25, '1.5 lb chicken breast\n2 bell peppers\n1 head broccoli\n3 cloves garlic\n1 tbsp ginger\n1/3 cup soy sauce\n2 cups jasmine rice\n2 tbsp vegetable oil'],
  ['Spaghetti Bolognese', 'Kid-friendly', 45, '1 lb ground beef\n1 lb spaghetti\n1 jar marinara sauce\n1 onion\n2 cloves garlic\n1/2 cup parmesan'],
  ['Sheet-Pan Salmon & Veggies', 'Pescatarian,Dairy-free,Gluten-free,Quick', 30, '4 salmon fillets\n1 lb baby potatoes\n1 bunch asparagus\n1 lemon\n2 tbsp olive oil\n2 cloves garlic'],
  ['Chickpea Coconut Curry', 'Vegan,Dairy-free,Gluten-free', 35, '2 cans chickpeas\n1 can coconut milk\n1 can diced tomatoes\n1 onion\n3 cloves garlic\n2 tbsp curry powder\n1 bag spinach\n2 cups basmati rice'],
  ['Slow Cooker Turkey Chili', 'Dairy-free,Gluten-free,Slow cooker,Kid-friendly', 360, '1 lb ground turkey\n2 cans kidney beans\n1 can crushed tomatoes\n1 onion\n1 bell pepper\n2 tbsp chili powder\n1 tsp cumin'],
  ['Flatbread Margherita Pizza', 'Vegetarian,Quick,Kid-friendly', 20, '4 naan flatbreads\n1 cup marinara sauce\n8 oz fresh mozzarella\n2 tomatoes\n1 bunch basil'],
  ['Lemon Herb Chicken Thighs', 'Dairy-free,Gluten-free', 45, '8 chicken thighs\n1 lemon\n1 lb carrots\n1 lb baby potatoes\n2 tbsp olive oil\n1 tsp dried thyme'],
  ['Shrimp Fried Rice', 'Pescatarian,Dairy-free,Quick', 25, '1 lb shrimp\n4 cups cooked rice\n2 eggs\n1 bag frozen peas and carrots\n3 green onions\n3 tbsp soy sauce'],
  ['Lentil Soup', 'Vegan,Dairy-free,Gluten-free', 45, '1.5 cups dry lentils\n1 onion\n2 carrots\n2 celery stalks\n1 can diced tomatoes\n6 cups vegetable broth\n1 tsp cumin'],
  ['Beef Tacos', 'Quick,Kid-friendly', 25, '1 lb ground beef\n8 taco shells\n1 packet taco seasoning\n1 head lettuce\n1 cup shredded cheddar\n2 tomatoes\n1/2 cup sour cream'],
  ['Pasta Primavera', 'Vegetarian,Quick', 30, '1 lb penne\n1 zucchini\n1 bell pepper\n1 cup cherry tomatoes\n1/2 cup parmesan\n2 tbsp olive oil\n2 cloves garlic'],
  ['Teriyaki Tofu Bowls', 'Vegan,Dairy-free', 35, '14 oz extra-firm tofu\n2 cups jasmine rice\n1/2 cup teriyaki sauce\n1 head broccoli\n1 cucumber\n1 tbsp sesame seeds'],
  ['BBQ Pulled Pork Sandwiches', 'Dairy-free,Slow cooker,Kid-friendly', 480, '3 lb pork shoulder\n1.5 cups bbq sauce\n1 onion\n8 hamburger buns\n1 bag coleslaw mix'],
  ['Greek Chicken Pitas', 'Quick', 30, '1.5 lb chicken breast\n4 pita breads\n1 cucumber\n1 cup cherry tomatoes\n1 cup tzatziki\n1 red onion\n1 lemon'],
  ['Veggie Fajitas', 'Vegan,Dairy-free,Gluten-free,Quick', 25, '3 bell peppers\n1 onion\n8 oz mushrooms\n8 corn tortillas\n1 tbsp fajita seasoning\n1 avocado\n1 lime'],
  ['Baked Ziti', 'Vegetarian,Kid-friendly', 50, '1 lb ziti\n1 jar marinara sauce\n15 oz ricotta\n2 cups shredded mozzarella\n1/2 cup parmesan'],
  ['Fish Tacos', 'Pescatarian,Dairy-free,Gluten-free,Quick', 25, '1.5 lb cod\n8 corn tortillas\n1 bag coleslaw mix\n1 lime\n1 avocado\n1/2 cup mayonnaise\n1 tsp chili powder'],
  ['Minestrone', 'Vegan,Dairy-free', 40, '1 onion\n2 carrots\n2 celery stalks\n1 zucchini\n1 can cannellini beans\n1 can diced tomatoes\n6 cups vegetable broth\n1 cup small pasta'],
  ['Chicken Caesar Wraps', 'Quick', 20, '1 lb chicken breast\n4 large flour tortillas\n1 head romaine\n1/2 cup caesar dressing\n1/4 cup parmesan'],
  ['Sweet Potato & Black Bean Bowls', 'Vegan,Dairy-free,Gluten-free', 40, '2 sweet potatoes\n1 can black beans\n1.5 cups quinoa\n1 avocado\n1 cup salsa\n1 lime'],
  ['Beef & Broccoli', 'Dairy-free,Quick', 30, '1.5 lb flank steak\n2 heads broccoli\n1/3 cup soy sauce\n2 tbsp brown sugar\n3 cloves garlic\n2 cups jasmine rice'],
  ['Mushroom Risotto', 'Vegetarian,Gluten-free', 45, '1.5 cups arborio rice\n1 lb mushrooms\n1 onion\n6 cups vegetable broth\n1/2 cup parmesan\n2 tbsp butter'],
  ['Breakfast for Dinner', 'Vegetarian,Quick,Kid-friendly', 25, '8 eggs\n1 box pancake mix\n1 cup milk\n1 pint strawberries\n1/2 cup maple syrup'],
  ['Slow Cooker Chicken Tortilla Soup', 'Dairy-free,Gluten-free,Slow cooker', 360, '1.5 lb chicken breast\n1 can black beans\n1 can corn\n1 can diced tomatoes with green chiles\n4 cups chicken broth\n1 onion\n1 tsp cumin\n1 bag tortilla chips'],
  ['Pesto Gnocchi', 'Vegetarian,Quick', 20, '1 lb gnocchi\n1/2 cup pesto\n1 cup cherry tomatoes\n1 bag spinach']
];

function recipesSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(RECIPES);
  if (!sh) {
    sh = ss.insertSheet(RECIPES);
    sh.getRange(1, 1, 1, RC_COLS.length).setValues([RC_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    const rows = STARTER_RECIPES.map((r, i) => RC_COLS.map(c => ({ id: 'r' + String(i + 1).padStart(2, '0'), name: r[0], tags: r[1],
      servings: 4, minutes: r[2], ingredients: r[3], steps: '', link: '', fav: 0, by: '', created: i + 1 })[c]));
    sh.getRange(2, 1, rows.length, RC_COLS.length).setValues(rows);
  } else ensureHeaders_(sh, RC_COLS);
  return sh;
}
function readRecipes_() {
  const sh = recipesSheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, RC_COLS.length).getValues().filter(r => r[0] !== '' && r[1] !== '').map(r => {
    const o = {}; RC_COLS.forEach((c, i) => o[c] = r[i]);
    o.id = String(o.id); o.name = String(o.name); o.tags = String(o.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    o.servings = Number(o.servings) || 4; o.minutes = Number(o.minutes) || 0; o.fav = Number(o.fav) || 0;
    o.ingredients = String(o.ingredients || ''); o.steps = String(o.steps || ''); o.link = String(o.link || '');
    o.type = MEAL_TYPES.indexOf(String(o.type)) > 0 ? String(o.type) : 'dinner';
    return o;
  });
}
function cleanRecipe_(r) {
  r = r || {};
  const name = String(r.name || '').trim().slice(0, 80);
  if (!name) throw new Error('Name the recipe.');
  const tags = (Array.isArray(r.tags) ? r.tags : []).filter(t => TAGS.indexOf(t) >= 0);
  const servings = Math.max(1, Math.min(20, Math.round(Number(r.servings) || 4)));
  const minutes = Math.max(0, Math.min(1440, Math.round(Number(r.minutes) || 0)));
  const ingredients = String(r.ingredients || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 60).join('\n');
  if (!ingredients) throw new Error('Add at least one ingredient.');
  const link = String(r.link || '').trim();
  return { name, tags: tags.join(','), servings, minutes, ingredients, steps: String(r.steps || '').slice(0, 4000),
           link: /^https?:\/\//i.test(link) ? link.slice(0, 500) : '', type: MEAL_TYPES.indexOf(r.type) >= 0 ? r.type : 'dinner' };
}
function addRecipe(r) {
  const o = cleanRecipe_(r);
  return withLock_(() => {
    o.id = 'r' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); o.fav = 0; o.by = PEOPLE.indexOf(r.by) >= 0 ? r.by : ''; o.created = Date.now();
    recipesSheet_().appendRow(RC_COLS.map(c => o[c] == null ? '' : o[c]));
    return state_();
  });
}
function updateRecipe(id, r) {
  const o = cleanRecipe_(r);
  return withLock_(() => {
    const sh = recipesSheet_(), row = findRow_(sh, id);
    if (row < 0) throw new Error('That recipe was deleted by someone else.');
    RC_COLS.forEach((c, i) => { if (c in o) sh.getRange(row, i + 1).setValue(o[c]); });
    return state_();
  });
}
function setFavorite(id, fav) {
  return withLock_(() => {
    const sh = recipesSheet_(), row = findRow_(sh, id);
    if (row > 0) sh.getRange(row, RC_COLS.indexOf('fav') + 1).setValue(fav > 0 ? 1 : fav < 0 ? -1 : 0);
    return state_();
  });
}
function deleteRecipe(id) {
  return withLock_(() => {
    const sh = recipesSheet_(), row = findRow_(sh, id);
    if (row > 0) sh.deleteRow(row);
    return state_();
  });
}

function planSheet_() { return simpleSheet_(PLAN, PL_COLS); }
function readPlan_(weeks) {
  const sh = ss_().getSheetByName(PLAN); if (!sh) return [];
  const n = sh.getLastRow() - 1; if (n < 1) return [];
  return sh.getRange(2, 1, n, PL_COLS.length).getValues().map(r => {
    const o = {}; PL_COLS.forEach((c, i) => o[c] = r[i]);
    o.week = dateText_(o.week); o.day = Number(o.day); o.recipe = String(o.recipe || ''); o.kind = String(o.kind || 'meal');
    o.servings = Number(o.servings) || 0; o.leftovers = o.leftovers === true || String(o.leftovers).toUpperCase() === 'TRUE';
    o.locked = o.locked === true || String(o.locked).toUpperCase() === 'TRUE'; o.cook = String(o.cook || '');
    o.slot = slotOf_(o.slot);
    return o;
  }).filter(o => weeks.indexOf(o.week) >= 0);
}
const slotOf_ = s => (s === 'breakfast' || s === 'drink') ? s : 'dinner';
function cleanNight_(d) {
  d = d || {};
  const kind = ['meal', 'takeout', 'skip'].indexOf(d.kind) >= 0 ? d.kind : 'meal';
  return { kind, recipe: kind === 'meal' ? String(d.recipe || '').slice(0, 20) : '', servings: Math.max(0, Math.min(20, Math.round(Number(d.servings) || 0))),
           leftovers: !!d.leftovers, locked: !!d.locked, cook: PEOPLE.indexOf(d.cook) >= 0 ? d.cook : '', slot: slotOf_(d.slot) === 'dinner' ? '' : slotOf_(d.slot) };
}
/* Replace a whole week: nights = 7 objects, Sunday first. */
function setWeekPlan(week, nights) {
  week = String(week || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error('Bad week.');
  if (!Array.isArray(nights) || nights.length !== 7) throw new Error('A week needs 7 nights.');
  return withLock_(() => {
    const sh = planSheet_(); deleteWhere_(sh, PL_COLS, r => dateText_(r[0]) === week && slotOf_(r[8]) === 'dinner');   // breakfasts and drinks stay
    nights.forEach((d, i) => { const o = cleanNight_(Object.assign({}, d, { slot: '' })); o.week = "'" + week; o.day = i; sh.appendRow(PL_COLS.map(c => o[c])); });
    return state_();
  });
}
function setNight(week, day, d) {
  week = String(week || ''); day = Number(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !(day >= 0 && day <= 6)) throw new Error('Bad night.');
  return withLock_(() => {
    const slot = slotOf_(d && d.slot);
    const sh = planSheet_(); deleteWhere_(sh, PL_COLS, r => dateText_(r[0]) === week && Number(r[1]) === day && slotOf_(r[8]) === slot);
    const o = cleanNight_(d);
    if (slot === 'dinner' || o.recipe) { o.week = "'" + week; o.day = day; sh.appendRow(PL_COLS.map(c => o[c])); }   // an empty breakfast / drink is just removed
    return state_();
  });
}

function readChecks_(weeks) {
  const sh = ss_().getSheetByName(CHECKS); if (!sh) return [];
  const n = sh.getLastRow() - 1; if (n < 1) return [];
  return sh.getRange(2, 1, n, CK_COLS.length).getValues().map(r => ({ week: dateText_(r[0]), key: String(r[1]), by: String(r[2] || '') }))
    .filter(o => weeks.indexOf(o.week) >= 0);
}
/* Check or uncheck a meal ingredient on the Shop list for a week. */
function setShopCheck(week, key, checked, by) {
  week = String(week || ''); key = String(key || '').slice(0, 80);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !key) throw new Error('Bad item.');
  return withLock_(() => {
    const sh = simpleSheet_(CHECKS, CK_COLS);
    deleteWhere_(sh, CK_COLS, r => dateText_(r[0]) === week && (String(r[1]) === key || String(r[1]) === 'x:' + key));
    if (checked) sh.appendRow(["'" + week, "'" + key, PEOPLE.indexOf(by) >= 0 ? by : '', Date.now()]);
    return state_();
  });
}
/* Clear everything checked on the Shop list: bought grocery items are deleted, and checked recipe
   ingredients for that week are marked "cleared" ("x:" prefix) so they stay bought but leave the list. */
function clearBoughtGroceries(week) {
  return withLock_(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(week || ''))) {
      const ck = ss_().getSheetByName(CHECKS);
      if (ck && ck.getLastRow() > 1) {
        const v = ck.getRange(2, 1, ck.getLastRow() - 1, 2).getValues();
        v.forEach((r, i) => { if (dateText_(r[0]) === week && String(r[1]).indexOf('x:') !== 0) ck.getRange(i + 2, 2).setValue("'x:" + String(r[1]).replace(/^'/, '')); });
      }
    }
    const sh = sheet_(), n = sh.getLastRow() - 1;
    if (n > 0) {
      const v = sh.getRange(2, 1, n, COLS.length).getValues(), ci = COLS.indexOf('cat'), bi = COLS.indexOf('bought');
      for (let i = v.length - 1; i >= 0; i--) if (String(v[i][ci]) === 'groceries' && (v[i][bi] === true || String(v[i][bi]).toUpperCase() === 'TRUE')) sh.deleteRow(i + 2);
    }
    return state_();
  });
}

function readSettings_() {
  const sh = ss_().getSheetByName(SETTINGS); const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => { try { out[String(r[0])] = JSON.parse(String(r[1])); } catch (e) {} });
  return out;
}
function setSetting(key, value) {
  key = String(key || ''); if (['mealRules', 'staples', 'stores'].indexOf(key) < 0) throw new Error('Unknown setting.');
  const json = JSON.stringify(value == null ? null : value); if (json.length > 20000) throw new Error('That setting is too long.');
  return withLock_(() => {
    const sh = simpleSheet_(SETTINGS, ['key', 'value']);
    deleteWhere_(sh, ['key', 'value'], r => String(r[0]) === key);
    sh.appendRow([key, "'" + json]);
    return state_();
  });
}

/* Remember which store an item is usually bought at (merged one key at a time, so two phones never overwrite each other). */
function setStoreFor(key, store) {
  key = String(key || '').slice(0, 80); store = String(store || '').slice(0, 40);
  if (!key) throw new Error('Bad item.');
  return withLock_(() => {
    const cur = readSettings_().storeFor || {};
    if (store) cur[key] = store; else delete cur[key];
    const json = JSON.stringify(cur); if (json.length > 45000) throw new Error('Too many store choices saved.');
    const sh = simpleSheet_(SETTINGS, ['key', 'value']);
    deleteWhere_(sh, ['key', 'value'], r => String(r[0]) === 'storeFor');
    sh.appendRow(['storeFor', "'" + json]);
    return state_();
  });
}

function simpleSheet_(name, cols) {
  const ss = ss_(); let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold'); sh.setFrozenRows(1); }
  else ensureHeaders_(sh, cols);
  return sh;
}
/* Older sheets get any new column header added (e.g. 'slot', 'type'). */
function ensureHeaders_(sh, cols) {
  const head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
  cols.forEach((c, i) => { if (String(head[i] || '') === '') sh.getRange(1, i + 1).setValue(c).setFontWeight('bold'); });
}
function deleteWhere_(sh, cols, test) {
  const n = sh.getLastRow() - 1; if (n < 1) return;
  const v = sh.getRange(2, 1, n, cols.length).getValues();
  for (let i = v.length - 1; i >= 0; i--) if (test(v[i])) sh.deleteRow(i + 2);
}
function dateText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v || '').replace(/^'/, '');
}
function weekOf_(ymd) { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() - d.getDay()); return Utilities.formatDate(d, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd'); }
function addDays_(ymd, n) { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return Utilities.formatDate(d, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd'); }

/* ---------- countdown events ---------- */
/* kind: party | concert | vacation | birthday | appointment | other.
   Rows with kind "hidden" record holidays you've hidden (id = "hide-<holiday key>"). */
const EVENTS = 'Events';
const EV_COLS = ['id', 'name', 'kind', 'start', 'end', 'time', 'place', 'notes', 'yearly', 'list', 'by', 'created'];
const EV_KINDS = ['party', 'concert', 'vacation', 'birthday', 'appointment', 'other'];

function addEvent(e) {
  const r = cleanEvent_(e);
  return withLock_(() => {
    r.id = 'e' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    r.by = PEOPLE.indexOf(e.by) >= 0 ? e.by : '';
    r.created = Date.now();
    eventsSheet_().appendRow(EV_COLS.map(c => evCell_(c, r[c])));
    return state_();
  });
}

function updateEvent(id, e) {
  const r = cleanEvent_(e);
  return withLock_(() => {
    const sh = eventsSheet_(), row = findRow_(sh, id);
    if (row < 0) throw new Error('That event was deleted by someone else.');
    const cur = evRow_(sh.getRange(row, 1, 1, EV_COLS.length).getValues()[0]);
    const next = Object.assign(cur, r, { id: id });
    sh.getRange(row, 1, 1, EV_COLS.length).setValues([EV_COLS.map(c => evCell_(c, next[c]))]);
    return state_();
  });
}

function deleteEvent(id) {
  return withLock_(() => {
    const sh = eventsSheet_(), row = findRow_(sh, id);
    if (row > 0) sh.deleteRow(row);
    return state_();
  });
}

/* Hide or show a built-in holiday for both of you. */
function setHoliday(key, show) {
  key = String(key || '').replace(/[^a-z0-9-]/gi, '').slice(0, 30);
  if (!key) throw new Error('Unknown holiday.');
  return withLock_(() => {
    const sh = eventsSheet_(), id = 'hide-' + key, row = findRow_(sh, id);
    if (show && row > 0) sh.deleteRow(row);
    if (!show && row < 0) sh.appendRow(EV_COLS.map(c => evCell_(c, { id: id, name: key, kind: 'hidden', created: Date.now() }[c])));
    return state_();
  });
}

function cleanEvent_(e) {
  e = e || {};
  const name = String(e.name || '').trim().slice(0, 80);
  if (!name) throw new Error('Give the event a name.');
  const kind = EV_KINDS.indexOf(e.kind) >= 0 ? e.kind : 'other';
  const d = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
  const start = d(e.start);
  if (!start) throw new Error('Pick a date.');
  let end = d(e.end);
  if (end && end < start) throw new Error('The end date is before the start date.');
  if (end === start) end = '';
  const time = /^\d{2}:\d{2}$/.test(String(e.time || '')) ? String(e.time) : '';
  return { name, kind, start, end, time, place: String(e.place || '').trim().slice(0, 120),
           notes: String(e.notes || '').trim().slice(0, 300), yearly: !!e.yearly, list: String(e.list || '').slice(0, 40) };
}

function eventsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(EVENTS);
  if (!sh) {
    sh = ss.insertSheet(EVENTS);
    sh.getRange(1, 1, 1, EV_COLS.length).setValues([EV_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readEvents_() {
  const sh = ss_().getSheetByName(EVENTS);
  if (!sh) return [];
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, EV_COLS.length).getValues().filter(r => r[0] !== '').map(evRow_);
}

function evRow_(r) {
  const tz = ss_().getSpreadsheetTimeZone(), o = {};
  EV_COLS.forEach((c, i) => {
    let v = r[i];
    if (v instanceof Date) v = Utilities.formatDate(v, tz, c === 'time' ? 'HH:mm' : 'yyyy-MM-dd');
    if (c === 'yearly') v = v === true || String(v).toUpperCase() === 'TRUE';
    else if (c === 'created') v = Number(v) || 0;
    else v = String(v == null ? '' : v).replace(/^'/, '');
    o[c] = v;
  });
  // Hidden holidays are identified by their id ("hide-<key>"); Sheets can turn a name like "july4" into a date.
  if (o.kind === 'hidden') o.name = String(o.id).replace(/^hide-/, '');
  return o;
}

/* Dates and times are stored as text so Sheets doesn't reformat them. */
function evCell_(c, v) {
  if (v === null || v === undefined) return c === 'yearly' ? false : '';
  if (c === 'yearly') return v === true;
  if (['start', 'end', 'time', 'name', 'place', 'notes'].indexOf(c) >= 0 && v) return "'" + v;   // keep as plain text
  return v;
}

/* ---------- lists ---------- */

function addList(label) {
  label = String(label || '').trim();
  if (!label) throw new Error('Give the list a name.');
  return withLock_(() => {
    const sh = listsSheet_();
    const lists = readLists_();
    if (lists.some(l => l.label.toLowerCase() === label.toLowerCase()))
      throw new Error('There\'s already a list called ' + label + '.');
    const used = lists.map(l => l.color);
    let color = 0;
    for (let i = 0; i < COLORS; i++) if (used.indexOf(i) < 0) { color = i; break; }
    if (used.length >= COLORS) color = lists.length % COLORS;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20)
               + '-' + Utilities.getUuid().slice(0, 4);
    const order = lists.reduce((m, l) => Math.max(m, l.order), 0) + 1;
    sh.appendRow([id, label, color, order]);
    return state_();
  });
}

function renameList(id, label) {
  label = String(label || '').trim();
  if (!label) throw new Error('Give the list a name.');
  return withLock_(() => {
    const sh = listsSheet_();
    const r = findRow_(sh, id);
    if (r < 0) throw new Error('That list was deleted by someone else.');
    sh.getRange(r, 2).setValue(label);
    return state_();
  });
}

/* Deletes the list and every item on it. */
function deleteList(id) {
  return withLock_(() => {
    const ls = listsSheet_();
    const r = findRow_(ls, id);
    if (r > 0) ls.deleteRow(r);
    const sh = sheet_();
    const n = sh.getLastRow() - 1;
    if (n > 0) {
      const cats = sh.getRange(2, COLS.indexOf('cat') + 1, n, 1).getValues();
      for (let i = cats.length - 1; i >= 0; i--) if (String(cats[i][0]) === id) sh.deleteRow(i + 2);
    }
    return state_();
  });
}

function listsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(LISTS);
  if (!sh) {
    sh = ss.insertSheet(LISTS);
    sh.getRange(1, 1, 1, 4).setValues([['id', 'label', 'color', 'order']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, DEFAULT_LISTS.length, 4)
      .setValues(DEFAULT_LISTS.map((l, i) => [l[0], l[1], l[2], i + 1]));
  }
  return sh;
}

function readLists_() {
  const sh = listsSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 4).getValues()
    .filter(r => r[0] !== '' && r[1] !== '')
    .map(r => ({ id: String(r[0]), label: String(r[1]), color: Number(r[2]) || 0, order: Number(r[3]) || 0 }))
    .sort((a, b) => a.order - b.order);
}

function addItem(item) {
  return withLock_(() => {
    const sh = sheet_();
    const row = Object.assign({}, item, {
      id: Utilities.getUuid().slice(0, 8),
      bought: false, boughtBy: '', boughtAt: '', paid: '',
      created: Date.now()
    });
    sh.appendRow(COLS.map(c => toCell_(c, row[c])));
    return state_();
  });
}

function updateItem(id, patch) {
  return withLock_(() => {
    const sh = sheet_();
    const r = findRow_(sh, id);
    if (r < 0) throw new Error('That item was deleted by someone else.');
    const current = rowToObj_(sh.getRange(r, 1, 1, COLS.length).getValues()[0]);
    const next = Object.assign(current, patch, { id: id });
    if (next.both && 'both' in patch) {
      const done = splitNames_(next.doneBy);
      const all = PEOPLE.every(p => done.indexOf(p) >= 0);
      if (all !== next.bought) {
        next.bought = all; next.boughtAt = all ? Date.now() : null;
        if (!all) next.boughtBy = null;
      }
    }
    sh.getRange(r, 1, 1, COLS.length).setValues([COLS.map(c => toCell_(c, next[c]))]);
    return state_();
  });
}

/* For "both of us" items: one person checks (or unchecks) their own part.
   Done under a lock so two people ticking at the same moment both count. */
function markDone(id, name, done) {
  if (PEOPLE.indexOf(name) < 0) throw new Error('Pick who you are at the top of the page first.');
  return withLock_(() => {
    const sh = sheet_();
    const r = findRow_(sh, id);
    if (r < 0) throw new Error('That item was deleted by someone else.');
    const rng = sh.getRange(r, 1, 1, COLS.length);
    const o = rowToObj_(rng.getValues()[0]);
    let names = splitNames_(o.doneBy).filter(n => n !== name);
    if (done) names.push(name);
    names = PEOPLE.filter(p => names.indexOf(p) >= 0);
    const all = PEOPLE.every(p => names.indexOf(p) >= 0);
    o.doneBy = names.join(', ');
    o.bought = all;
    o.boughtBy = all ? name : null;
    o.boughtAt = all ? Date.now() : null;
    rng.setValues([COLS.map(c => toCell_(c, o[c]))]);
    return state_();
  });
}

function deleteItem(id) {
  return withLock_(() => {
    const sh = sheet_();
    const r = findRow_(sh, id);
    if (r > 0) sh.deleteRow(r);
    return state_();
  });
}

/* ---------- one-time setup ---------- */

function setup() {
  const ss = ss_();
  PropertiesService.getScriptProperties().setProperty(ID_KEY, ss.getId());
  let sh = ss.getSheetByName(SHEET);
  if (!sh) sh = ss.insertSheet(SHEET);
  if (sh.getLastRow() > 1) {
    Logger.log('Items tab already has data — setup left it alone.');
    return;
  }
  sh.clear();
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  sh.setFrozenRows(1);

  const S = [
    ['vehicle','Research & paperwork','Pick make/model and set total budget','must','Room for rear-facing car seat + stroller in trunk'],
    ['vehicle','Research & paperwork','Financing pre-approval','must','Compare credit union vs dealer rate'],
    ['vehicle','Research & paperwork','Insurance quotes','must',''],
    ['vehicle','Accessories','All-weather floor mats','nice',''],
    ['vehicle','Accessories','Seat protector for under the car seat','must','Check car seat manual allows one'],
    ['vehicle','Accessories','Rear window sunshades','nice',''],
    ['vehicle','Accessories','Dash cam','nice','Often discounted Black Friday'],
    ['vehicle','Maintenance','Oil change & service before baby arrives','must',''],
    ['vehicle','Maintenance','Tire check / replacement','nice',''],
    ['baby','Car & travel','Infant car seat','must','Needed to leave the hospital'],
    ['baby','Car & travel','Stroller / travel system','must','Check it fits the car seat'],
    ['baby','Car & travel','Extra car seat base for second car','nice',''],
    ['baby','Nursery','Crib or bassinet + mattress','must',''],
    ['baby','Nursery','Fitted crib sheets (3)','must',''],
    ['baby','Nursery','Baby monitor','must',''],
    ['baby','Nursery','Dresser / changing table','nice',''],
    ['baby','Nursery','Swaddles / sleep sacks','must',''],
    ['baby','Feeding','Bottles + bottle brush','must',''],
    ['baby','Feeding','Breast pump','must','Check what insurance covers first'],
    ['baby','Feeding','Burp cloths','must',''],
    ['baby','Diapering','Diapers (newborn + size 1)','must',''],
    ['baby','Diapering','Wipes','must',''],
    ['baby','Hospital bag','Going-home outfit for baby','must',''],
    ['baby','Hospital bag','Toiletries, long phone charger, snacks','must',''],
    ['baby','Hospital bag','Postpartum recovery supplies','must',''],
    ['baby','Leave planning','Submit leave paperwork to HR (both of us)','must','Confirm start dates and pay during leave'],
    ['baby','Leave planning','File state paid family leave / disability claim','must','If your state offers it'],
    ['baby','Leave planning','Choose pediatrician','must',''],
    ['baby','Leave planning','Add baby to health insurance','must','Plans set a short deadline after birth; check yours'],
    ['bf','Baby deals','Stock up on diapers & wipes','nice','Bulk deals usually run Black Friday through Cyber Monday'],
    ['bf','Electronics','TV / laptop / tablet (pick one)','nice','Note the regular price now to judge the deal'],
    ['bf','Home','Kitchen appliance','nice',''],
    ['bf','Gifts','Holiday gifts for family','must','Add one row per person']
  ];
  const rows = S.map((s, i) => COLS.map(c => toCell_(c, {
    id: 's' + String(i + 1).padStart(2, '0'), cat: s[0], section: s[1], name: s[2],
    prio: s[3], notes: s[4], est: '', paid: '', store: '', bought: false,
    by: '', boughtBy: '', created: i + 1, boughtAt: '',
    both: s[1] === 'Leave planning', doneBy: ''
  }[c])));
  sh.getRange(2, 1, rows.length, COLS.length).setValues(rows);
  sh.getRange(2, COLS.indexOf('bought') + 1, 500, 1).insertCheckboxes();
  sh.getRange(2, COLS.indexOf('both') + 1, 500, 1).insertCheckboxes();
  sh.getRange(2, COLS.indexOf('est') + 1, 500, 2).setNumberFormat('$#,##0.00');
  sh.autoResizeColumns(1, COLS.length);
  Logger.log('Done: Items tab created with ' + rows.length + ' starter items.');
}

/* ---------- helpers ---------- */

/* The spreadsheet this app saves to. Uses the ID saved by setup, so it works
   the same from the editor and from the web link. */
function ss_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(ID_KEY);
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This script isn\'t attached to a Sheet. Open your Sheet, go to Extensions ▸ Apps Script, and paste the code there.');
  props.setProperty(ID_KEY, ss.getId());
  return ss;
}

function sheet_() {
  let sh = ss_().getSheetByName(SHEET);
  if (!sh) { setup(); sh = ss_().getSheetByName(SHEET); }
  ensureCols_(sh);
  return sh;
}

/* Adds any columns a newer version of the app needs to an existing Items tab.
   The first time the "both" column appears, Leave planning items are set to it. */
let colsChecked_ = false;
function ensureCols_(sh) {
  if (colsChecked_) return;
  colsChecked_ = true;
  const width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  const missing = COLS.filter(c => head.indexOf(c) < 0);
  if (!missing.length) return;
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  const n = sh.getLastRow() - 1;
  if (missing.indexOf('both') >= 0) {
    const bc = COLS.indexOf('both') + 1;
    if (n > 0) {
      const secs = sh.getRange(2, COLS.indexOf('section') + 1, n, 1).getValues();
      sh.getRange(2, bc, n, 1).setValues(secs.map(r => [r[0] === 'Leave planning']));
    }
    sh.getRange(2, bc, 500, 1).insertCheckboxes();
  }
}

function splitNames_(s) {
  return String(s || '').split(',').map(x => x.trim()).filter(Boolean);
}

function readAll_() {
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, COLS.length).getValues()
    .filter(r => r[0] !== '' && r[3] !== '')
    .map(rowToObj_);
}

function rowToObj_(r) {
  const o = {};
  COLS.forEach((c, i) => {
    let v = r[i];
    if (c === 'est' || c === 'paid') v = (v === '' || v === null) ? null : Number(v);
    else if (c === 'bought' || c === 'both') v = v === true || v === 'TRUE';
    else if (c === 'created' || c === 'boughtAt') v = v === '' ? null : Number(v);
    else v = v === '' ? null : String(v);
    o[c] = v;
  });
  return o;
}

function toCell_(c, v) {
  if (v === null || v === undefined) return (c === 'bought' || c === 'both') ? false : '';
  if (c === 'bought' || c === 'both') return v === true;
  return v;
}

function findRow_(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}
