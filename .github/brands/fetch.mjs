// Brand icons for the app's expense rows, for the brands the open icon
// library (Simple Icons) does not carry. Run by .github/workflows/brands.yml
// on request: every candidate a brand's own site offers (its declared icons,
// its web manifest, apple-touch-icon) plus two favicon services, normalised
// to 128px PNG next to each other, so a person can pick the right one per
// brand. Nothing here is served to the app directly.
//
//   node fetch.mjs list.json out/
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';

const [listPath, OUT] = process.argv.slice(2);
const list = JSON.parse(readFileSync(listPath, 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const slug = (s) => s.toLowerCase().replace(/\+/g, 'plus').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function get(url, ms = 12000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'it,en;q=0.8' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok) return null;
    return { url: r.url, type: r.headers.get('content-type') ?? '', body: Buffer.from(await r.arrayBuffer()) };
  } catch { return null; } finally { clearTimeout(t); }
}

function candidatesFromHtml(html, baseUrl) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) ?? [])[1]?.toLowerCase() ?? '';
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) ?? [])[1];
    if (!href) continue;
    if (rel.includes('icon') || rel === 'manifest' || rel.includes('mask-icon')) {
      const sizes = (tag.match(/\bsizes\s*=\s*["']([^"']+)["']/i) ?? [])[1] ?? '';
      try { out.push({ rel, sizes, href: new URL(href, baseUrl).href }); } catch {}
    }
  }
  return out;
}

const report = [];
for (const [name, domain] of list) {
  const id = slug(name);
  const dir = `${OUT}/${id}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cands = [];
  const home = await get(`https://${domain}/`) ?? await get(`https://www.${domain}/`);
  if (home && /html/.test(home.type)) {
    const html = home.body.toString('utf8');
    for (const c of candidatesFromHtml(html, home.url)) {
      if (c.rel === 'manifest') {
        const man = await get(c.href);
        try {
          const j = JSON.parse(man.body.toString('utf8'));
          for (const ic of j.icons ?? []) cands.push({ src: `manifest ${ic.sizes ?? ''} ${ic.purpose ?? ''}`.trim(), href: new URL(ic.src, c.href).href });
        } catch {}
      } else cands.push({ src: `${c.rel} ${c.sizes}`.trim(), href: c.href });
    }
  }
  const origin = home ? new URL(home.url).origin : `https://${domain}`;
  cands.push({ src: 'apple-touch-icon', href: `${origin}/apple-touch-icon.png` });
  cands.push({ src: 'google-s2', href: `https://www.google.com/s2/favicons?domain=${domain}&sz=256` });
  cands.push({ src: 'duckduckgo', href: `https://icons.duckduckgo.com/ip3/${domain}.ico` });
  const seen = new Set(); let n = 0; const got = [];
  for (const c of cands) {
    if (seen.has(c.href)) continue; seen.add(c.href);
    const r = await get(c.href);
    if (!r || r.body.length < 100) continue;
    const ext = /svg/.test(r.type) || /\.svg(\?|$)/i.test(c.href) ? 'svg' : /icon|ico/.test(r.type) || /\.ico(\?|$)/i.test(c.href) ? 'ico' : /webp/.test(r.type) ? 'webp' : /jpe?g/.test(r.type) ? 'jpg' : 'png';
    n++;
    const raw = `${dir}/${n}.${ext}`;
    writeFileSync(raw, r.body);
    // Normalised for the side-by-side look: 128px, largest frame of an .ico.
    try {
      const src = ext === 'ico' ? `${raw}` : raw;
      execFileSync('convert', ['-background', 'none', '-density', '384', src, '-thumbnail', '128x128', '-gravity', 'center', '-extent', '128x128', '-delete', '0--2', `${dir}/${n}.png.norm.png`], { stdio: 'ignore' });
    } catch { /* not an image ImageMagick reads */ }
    let px = '';
    try { px = execFileSync('identify', ['-format', '%wx%h ', raw]).toString().trim().split(' ').pop(); } catch {}
    got.push({ n, src: c.src, ext, px, bytes: r.body.length, href: c.href.slice(0, 140) });
  }
  report.push({ name, id, domain, home: home ? home.url : null, got });
  console.log(`${name.padEnd(16)} ${got.length} candidate(s): ${got.map((g) => `${g.n}:${g.src.split(' ')[0]}(${g.px || g.ext})`).join(' ')}`);
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
