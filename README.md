# tracklylab.com - landing + legal pages

This folder is the complete static site for **tracklylab.com**: a landing page
plus the Privacy Policy and Terms of Service, ready to deploy as-is.

- `index.html` - landing page (handwritten; edit freely). The story in the
  order of the Instagram posts and App Store screenshots, on the same dark
  blue; English, or Italian on an Italian browser (screens too) and a switch
  in the footer. Every "Get" goes to `get/`. No font, script or image from
  another server.
- `shots/` - the screens and widgets it shows, **generated**:
  `node scripts/store-screenshots/capture.mjs <raw dir>` (dev server on
  5199, 1080px wide), then `node scripts/site/shots.mjs <raw dir> site`.
  Cut from the App Store capture, never resampled, with room on top for the
  status bar the page draws; also writes `og.png`, the link preview.
- `media/` - the Apple Pay film: the Reel without its words, cut to where
  the action is (`SITE=1 node scripts/social/compose-reel.mjs <raw dir> <out>`,
  1080 x 1400), and its poster.
- `privacy.html`, `terms.html` - **generated** from `src/app/lib/legalContent.ts`
  by `pnpm site`. Do not edit these by hand - change the source module and
  regenerate, so the site and the in-app screens always say the same thing.
- `get/index.html` - **tracklylab.com/get**, the one link to share: it puts
  the iPhone app first on iPhone and iPad (TestFlight's public link today, the
  App Store's once live - one `href` to change), the web app first anywhere
  else, with a QR code on computers. Never redirects on its own: inside
  Instagram's browser a redirect to Apple often lands on a web page.
- `CNAME` - tells GitHub Pages the custom domain (ignored by other hosts)

## Deploying (choose one)

**Option A - second GitHub repo (recommended)**
1. Create a new repo, e.g. `tracklylab-site`, and push the *contents* of this
   folder to its default branch.
2. Repo Settings → Pages → deploy from that branch.
3. Settings → Pages → Custom domain: `tracklylab.com` (the CNAME file keeps it
   set across pushes). Enable "Enforce HTTPS" once the certificate is issued.
4. At your DNS provider, point the domain at GitHub Pages:
   - `A` records for `tracklylab.com` → 185.199.108.153, 185.199.109.153,
     185.199.110.153, 185.199.111.153
   - `CNAME` record for `www` → `<your-username>.github.io`

**Option B - Cloudflare Pages / Netlify**
Drag-and-drop this folder into a new project and attach the custom domain in
their dashboard. Delete `CNAME` if the host complains about it.

## After it is live: Google OAuth consent screen

1. **Verify the domain**: Google Search Console → add property
   `tracklylab.com` → DNS verification → add the TXT record at your DNS
   provider (same panel as the Resend records).
2. In Google Cloud Console → OAuth consent screen, fill in:
   - Authorised domain: `tracklylab.com`
   - Application home page: `https://tracklylab.com`
   - Privacy policy: `https://tracklylab.com/privacy.html`
   - Terms of service: `https://tracklylab.com/terms.html`
3. Leave the **logo** empty for now - uploading one triggers Google's brand
   verification review (days to weeks). Add it when the final logo is ready.

Note: while the branding is unverified, the consent screen says "to continue
to *xxxx*.supabase.co" - Google names the redirect's domain in place of the
app. Once Google Auth Platform → Branding reports the branding verified,
press **Publish branding** (the verified result lapses after 7 days if it
is not published); from then on the line reads "to continue to TracklyLab".
Verified and published on 15 Sep 2026. Uploading a logo later starts the
verification over, so add it only when the final logo is ready. The other
two ways - a Supabase custom auth domain (paid), or Google Identity
Services on our own page with `signInWithIdToken` - were not needed.
