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
// The groups the app can match to a person's categories. Codes are COICOP.
const GROUPS = {
  CP011: 'food',            // food (groceries)
  CP111: 'eatingOut',       // restaurants, cafés, canteens
  CP0722: 'fuel',           // fuels for personal transport
  CP045: 'energy',          // electricity, gas and other fuels
  CP03: 'clothing',         // clothing and footwear
  CP00: 'all',              // everything (the headline figure)
};
async function hicp() {
  const now = new Date();
  const since = `${now.getUTCFullYear() - 4}-01`;
  const q = Object.keys(GROUPS).map((c) => `coicop=${c}`).join('&');
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_midx?format=JSON&lang=EN&${q}&sinceTimePeriod=${since}`;
  const js = await (await get(url)).json();
  const ids = js.id, size = js.size;
  const pos = Object.fromEntries(ids.map((d) => [d, js.dimension[d].category.index]));
  console.log('HICP dimensions:', ids.map((d, i) => `${d}(${size[i]})`).join(' '));
  console.log('HICP units:', Object.keys(pos.unit ?? {}).join(' '), '| coicop:', Object.keys(pos.coicop ?? {}).join(' '));
  // One index base, the newest the dataset carries (I25 after the 2026
  // rebase, I15 before). Ratios between months do not care which.
  const units = Object.keys(pos.unit ?? {});
  const unit = ['I25', 'I15', ...units].find((u) => units.includes(u));
  const stride = ids.map((_, i) => size.slice(i + 1).reduce((a, b) => a * b, 1));
  const series = {};
  const times = Object.entries(pos.time).sort((a, b) => a[1] - b[1]).map(([t]) => t);
  for (const geo of Object.keys(pos.geo)) {
    if (geo.length !== 2 && geo !== 'EL') continue; // countries only, not EU27_2020 / EA20
    for (const [code, name] of Object.entries(GROUPS)) {
      if (pos.coicop[code] === undefined) continue;
      const vals = {};
      for (const t of times) {
        const at = { freq: pos.freq ? Object.values(pos.freq)[0] : 0, unit: pos.unit[unit], coicop: pos.coicop[code], geo: pos.geo[geo], time: pos.time[t] };
        const flat = ids.reduce((s, d, i) => s + (at[d] ?? 0) * stride[i], 0);
        const v = js.value[flat];
        if (typeof v === 'number') vals[t] = v;
      }
      if (Object.keys(vals).length >= 13) ((series[geo === 'EL' ? 'GR' : geo] ??= {})[name] = vals);
    }
  }
  const latest = times.filter((t) => Object.values(series).some((g) => Object.values(g).some((s) => s[t] !== undefined))).at(-1);
  mkdirSync(`${OUT}/prices`, { recursive: true });
  const changed = writeIfChanged(`${OUT}/prices/hicp.json`, { source: 'Eurostat HICP (prc_hicp_midx)', unit, latest, groups: Object.values(GROUPS), series });
  console.log(`HICP: unit ${unit}, ${Object.keys(series).length} countries, latest ${latest}, ${changed ? 'changed' : 'unchanged'}`);
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
