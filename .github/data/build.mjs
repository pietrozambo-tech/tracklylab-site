// Public reference data the app reads, rebuilt once a day by
// .github/workflows/data.yml and served from tracklylab.com/data/.
//
// Why here and not called from the phones: the app asks only our own site,
// so no third party learns who uses it or when. The runner has the network;
// the files it writes are small, public and cacheable.
//
//   data/fx/ecb-<year>.json   ECB euro reference rates, one file per year:
//                             { base, source, year, dates: [...], rates: { USD: [...] } }
//                             rates[c][i] is units of c per 1 EUR on dates[i]
//                             (null where the ECB published none).
//   data/prices/hicp.json     Eurostat HICP price indices for a few groups of
//                             goods, by country, by month (last 40 months).
//
// Node 22, no dependencies.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const OUT = process.argv[2] ?? 'data';
const FIRST_YEAR = 2015;

const writeIfChanged = (path, obj) => {
  const text = JSON.stringify(obj);
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  writeFileSync(path, text);
  return true;
};

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'tracklylab-data/1.0' } });
      if (r.ok) return r;
      console.log(`  ${r.status} ${url}`);
    } catch (e) { console.log(`  ${e.message} ${url}`); }
    await new Promise((s) => setTimeout(s, 3000 * (i + 1)));
  }
  throw new Error(`could not fetch ${url}`);
}

// ── ECB reference rates ─────────────────────────────────────────────────
async function ecb() {
  const zip = Buffer.from(await (await get('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip')).arrayBuffer());
  writeFileSync('/tmp/ecb.zip', zip);
  const csv = execFileSync('unzip', ['-p', '/tmp/ecb.zip'], { maxBuffer: 64 << 20 }).toString('utf8');
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(',').map((s) => s.trim());
  if (head[0] !== 'Date') throw new Error(`unexpected ECB header: ${lines[0].slice(0, 80)}`);
  const codes = head.slice(1).filter(Boolean);
  const byYear = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((s) => s.trim());
    const date = cells[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const year = +date.slice(0, 4);
    if (year < FIRST_YEAR) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(cells);
  }
  mkdirSync(`${OUT}/fx`, { recursive: true });
  let changed = 0, newest = '';
  for (const [year, rows] of byYear) {
    rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const dates = rows.map((r) => r[0]);
    const rates = {};
    codes.forEach((c, k) => {
      const col = rows.map((r) => { const v = parseFloat(r[k + 1]); return Number.isFinite(v) && v > 0 ? v : null; });
      if (col.some((v) => v !== null)) rates[c] = col;
    });
    if (dates.at(-1) > newest) newest = dates.at(-1);
    if (writeIfChanged(`${OUT}/fx/ecb-${year}.json`, { base: 'EUR', source: 'ECB euro reference rates', year, dates, rates })) changed++;
  }
  console.log(`ECB: ${byYear.size} years, ${codes.length} currencies, newest ${newest}, ${changed} file(s) changed`);
}

// ── Eurostat HICP ───────────────────────────────────────────────────────
// Since 2026 the HICP is classified by ECOICOP ver.2, in prc_hicp_minr (the
// old prc_hicp_midx stops at 2025-12). The codes for each group are looked up
// in the dataset itself first, so a renamed code shows in the log instead of
// silently emptying a group.
const DATASET = 'prc_hicp_minr';
const GROUPS = {
  all: ['CP00', 'TOTAL'],          // everything (the headline figure)
  food: ['CP011'],                 // food (groceries)
  eatingOut: ['CP111', 'CP1111'],  // restaurants, cafés, canteens
  fuel: ['CP0722'],                // fuels for personal transport
  energy: ['CP045'],               // electricity, gas and other fuels
  clothing: ['CP03'],              // clothing and footwear
  rent: ['CP041'],                 // actual rentals for housing
};
const base = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${DATASET}?format=JSON&lang=EN`;
async function hicp() {
  const now = new Date();
  // What the dataset calls things: one country, one recent month.
  const probe = await (await get(`${base}&geo=IT&sinceTimePeriod=${now.getUTCFullYear() - 1}-06`)).json();
  console.log(`HICP ${DATASET}: dimensions ${probe.id.map((d) => `${d}(${Object.keys(probe.dimension[d].category.index).slice(0, 6).join(',')})`).join(' ')}`);
  // The classification's dimension is named after its version (coicop,
  // coicop18, ecoicop...): found by name, not assumed.
  const CL = probe.id.find((d) => /coicop/i.test(d));
  const UN = probe.id.find((d) => /^unit$/i.test(d)) ?? probe.id.find((d) => /unit/i.test(d));
  if (!CL || !UN) throw new Error(`no coicop/unit dimension in ${probe.id.join(' ')}`);
  const coicops = Object.keys(probe.dimension[CL].category.index);
  const units = Object.keys(probe.dimension[UN].category.index);
  console.log(`HICP: classification "${CL}" with ${coicops.length} codes (${coicops.slice(0, 15).join(' ')}...) | units ${units.join(' ')}`);
  const unit = ['I25', 'I15'].find((u) => units.includes(u)) ?? units.find((u) => /^I\d/.test(u));
  const codeOf = {};
  for (const [name, wants] of Object.entries(GROUPS)) {
    const code = wants.find((c) => coicops.includes(c));
    if (code) codeOf[name] = code;
    else console.log(`::warning::HICP: no code for ${name} (${wants.join('/')}); near: ${coicops.filter((c) => wants.some((w) => c.startsWith(w.slice(0, 4)))).slice(0, 12).join(' ')}`);
  }
  const since = `${now.getUTCFullYear() - 4}-01`;
  const js = await (await get(`${base}&${UN}=${unit}&${Object.values(codeOf).map((c) => `${CL}=${c}`).join('&')}&sinceTimePeriod=${since}`)).json();
  const ids = js.id, size = js.size;
  const pos = Object.fromEntries(ids.map((d) => [d, js.dimension[d].category.index]));
  const stride = ids.map((_, i) => size.slice(i + 1).reduce((a, b) => a * b, 1));
  const times = Object.entries(pos.time).sort((a, b) => a[1] - b[1]).map(([t]) => t);
  const series = {};
  for (const geo of Object.keys(pos.geo)) {
    if (geo.length !== 2) continue; // countries, not EU27_2020 / EA20
    for (const [name, code] of Object.entries(codeOf)) {
      if (pos[CL][code] === undefined) continue;
      const vals = {};
      for (const t of times) {
        const at = { [UN]: pos[UN][unit] ?? 0, [CL]: pos[CL][code], geo: pos.geo[geo], time: pos.time[t] };
        const flat = ids.reduce((sum, d, i) => sum + (at[d] ?? 0) * stride[i], 0);
        const v = js.value[flat];
        if (typeof v === 'number') vals[t] = v;
      }
      if (Object.keys(vals).length >= 13) ((series[geo === 'EL' ? 'GR' : geo] ??= {})[name] = vals);
    }
  }
  const latest = times.filter((t) => Object.values(series).some((g) => Object.values(g).some((x) => x[t] !== undefined))).at(-1);
  mkdirSync(`${OUT}/prices`, { recursive: true });
  const changed = writeIfChanged(`${OUT}/prices/hicp.json`, { source: `Eurostat HICP (${DATASET})`, unit, codes: codeOf, latest, series });
  console.log(`HICP: unit ${unit}, codes ${JSON.stringify(codeOf)}, ${Object.keys(series).length} countries, latest ${latest}, ${changed ? 'changed' : 'unchanged'}`);
  const ageMonths = (now.getUTCFullYear() * 12 + now.getUTCMonth()) - (+latest.slice(0, 4) * 12 + +latest.slice(5, 7) - 1);
  if (ageMonths > 3) { console.log(`::warning::HICP latest month ${latest} is ${ageMonths} months old - catalogue follows`); await hicpCatalogue(); }
}

// While the price series looks stale, list Eurostat's HICP datasets in the
// log, so the right one can be picked (2026: the COICOP 2018 move).
async function hicpCatalogue() {
  const toc = await (await get('https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc/txt?lang=en')).text();
  for (const line of toc.split('\n')) if (/hicp/i.test(line) && /prc_hicp/i.test(line)) console.log('  TOC', line.replace(/\s+/g, ' ').trim().slice(0, 220));
}

let failed = 0;
for (const [name, job] of [['ECB', ecb], ['HICP', hicp]]) {
  try { await job(); } catch (e) { failed++; console.log(`::error::${name}: ${e.message}`); }
}
process.exit(failed ? 1 : 0);
