# Website review — 2026-09-19

Reviewed the live homepage and gallery, the local HTML/CSS/JavaScript, and the app's email-submission implementation. Improvements below build on `8f58fdd`. Validation was performed locally before publication; GitHub Actions records deployment status.

## Implemented

| Finding | Change | Evidence |
| --- | --- | --- |
| A 1,790,527-byte icon served as a tiny logo and favicon | Reuse the app's existing 180px icon (34,495 bytes), with explicit logo dimensions, across the 14 pages that referenced it | 1,756,032 fewer bytes per uncached icon download, about 98.1%; original large asset retained |
| Main gallery waited for optional rankings and sign-in | Render public media and shared links independently; rankings have an eight-second timeout; Ninja media also loads independently of sign-in | Browser showed 20 cards while rankings were still loading; regression test leaves auth and rankings unresolved |
| Map scripts blocked initial parsing even when the demo map was unused | Load Leaflet CSS and JS together on first map use; share concurrent loads; allow retry after failure | No Leaflet script at initial load; camera-map view rendered after selection; failure/retry tests pass |
| Background work and demo images started unnecessarily | Observe demo visibility before loading its data, lazy-load demo list images, update the minute clock once per minute, pause terminal animation when hidden or reduced motion is requested | Source checks; no claim of a measured battery or Core Web Vitals improvement |
| Mobile action grid was overridden; tablet navigation clipped; 320px layout overflowed | Restore the mobile action grid, use the compact navigation below 1200px, allow hero columns to shrink, improve muted text contrast and touch targets | Browser checks at 320, 390, 1024 and 1280px; 320px primary button retains both side margins |
| Marketing copy implied automatic official submission | Explain moderation/publication separately from the email draft the user sends; label both phone demos; replace the unverified live-version badge | Matched against `pedal/lib/pages/signal.dart`; homepage FAQ structured data now matches its visible answers |
| Arrow keys in comments/login changed photos; keyboard focus escaped overlays | Ignore photo shortcuts during editing and nested dialogs, contain Tab focus, restore focus on close, add viewer dialog semantics and gallery skip links | Browser checks of comments, login, nested Escape, Tab wrapping and focus return; Ninja keyboard open/close checked |

Facebook navigation now displays **Soon** on all eight pages that included the old profile link. The old profile destination and the claim of an active Facebook channel were removed, including structured metadata. Visitor sharing to Facebook remains available in the gallery.

## Next priorities

1. **Generate gallery thumbnails and video posters.** Both public galleries currently set preview sources to original media URLs. Retain originals for the viewer, add thumbnail/poster URLs to the shared manifest, and update both app and website consumers deliberately. This needs a media-generation/backfill decision and measured CDN byte counts; it is not part of this local frontend patch.
2. **Investigate ranking availability.** Both ranking requests failed during this browser session. The main gallery now remains usable. Verify CDN response headers, CORS and snapshot availability before changing production settings; this observation alone does not establish a universal outage.
3. **Preserve old share links.** The generator removes `share/` and recreates only the current selection. Design retention together with moderation/removal requirements so old public links remain useful without retaining withdrawn content.
4. **Simplify the landing-page demo.** The many simulated modules compete with the main reporting flow. A later product pass could foreground capture, moderation and gallery browsing, with other demo modules behind an explicit secondary action. Demo data must stay visibly distinguished from actual app capabilities.
5. **Review data freshness and supporting-page accessibility.** The black map displays source and website snapshot dates separately; refreshing the snapshot does not refresh the upstream dataset. Supporting pages still have custom interactive elements and would benefit from a dedicated keyboard/screen-reader pass.

## Validation and limits

- All 15 top-level HTML pages have resolving local `src`/`href` paths.
- Inline JavaScript, top-level JavaScript, generator syntax, structured JSON and `git diff --check` pass.
- 12 regression tests pass: `node --test scripts/tests/*.test.mjs`.
- Local browser checks: homepage at four widths, on-demand demo map, usage-guide camera simulation, gallery early rendering, comment editing, nested login/comment/viewer keyboard flow, and Ninja keyboard opening/closing.
- No comments, reactions, sign-ins or official submissions were sent during testing.
- This is not a Lighthouse score, field Core Web Vitals measurement, authenticated production test or screen-reader certification. The measured byte saving is specifically the icon asset, not a claim about total page weight.
