# GridMaker

A photo collage / grid maker built as a Progressive Web App for iPhone. No backend, no accounts, no frameworks, no build step. Plain HTML/CSS/JS with ES modules. Works offline after the first load.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell, PWA meta tags, controls |
| `styles.css` | Layout, dark mode, safe-area insets, 44 pt touch targets |
| `app.js` | UI, Pointer Events gestures, persistence wiring, export/share flow |
| `layout.js` | Pure layout math: presets, aspect ratios, cell rectangles, pan/zoom |
| `render.js` | Draws a collage onto any 2D canvas (preview and export share it) |
| `images.js` | Decoding with EXIF orientation, downscaling, HEIC detection + conversion |
| `vendor/heic2any.min.js` | Bundled HEIC→JPEG decoder (libheif wasm, MIT), loaded on demand |
| `export.js` | 16 MP offscreen render, retry at lower size, share helpers |
| `storage.js` | IndexedDB persistence of settings and photo bytes |
| `sw.js` | Service worker: cache-first app shell, versioned cache |
| `manifest.webmanifest` | PWA manifest |
| `icons/` | Generated icons (SVG + 180/192/512 PNG) |
| `tests/layout.test.mjs` | Unit tests for `layout.js` |
| `server.mjs` | Zero-dependency static dev server |
| `scripts/make-icons.mjs` | Regenerates the icons (`npm run icons`) |

## Run locally

```sh
npm test        # unit tests for layout.js (node:test)
npm start       # http://localhost:5173 (also prints your LAN address)
```

`npx serve .` works too. Any static file server is fine; the app is just files.

### HTTPS on the phone

iOS Safari only enables service workers (offline mode) and the full standalone PWA experience on `https://` or `localhost`. Your phone cannot use `localhost` on your computer, so for testing on the device pick one of these:

1. **Tunnel (quickest).** Keep `npm start` running, then in another terminal:
   ```sh
   npx cloudflared tunnel --url http://localhost:5173
   # or
   npx localtunnel --port 5173
   ```
   Open the printed `https://…` URL in Safari on the phone.
2. **Local certificate.** Install [mkcert](https://github.com/FiloSottile/mkcert), run `mkcert -install` and `mkcert 192.168.1.77` (your LAN IP), serve with a TLS-capable server such as `npx http-server -S -C 192.168.1.77.pem -K 192.168.1.77-key.pem -p 5173`, and install the mkcert root CA on the phone (AirDrop the `rootCA.pem`, then enable it under Settings → General → About → Certificate Trust Settings).
3. **Deploy.** Push the folder to GitHub Pages or drag it onto Netlify Drop. Both serve HTTPS. Because every path in the app is relative (`./`), it works from a sub-path like `https://user.github.io/gridmaker/`.

Plain `http://<LAN IP>:5173` also loads on the phone and everything works except the service worker, so it is fine for a quick functional check.

## Add to Home Screen

1. Open the HTTPS URL in Safari on the iPhone.
2. Tap the Share button, then **Add to Home Screen**, then **Add**.
3. Launch GridMaker from the Home Screen. It opens full screen (standalone), respects the Dynamic Island and home indicator safe areas, and keeps working in Airplane Mode once the service worker has cached the shell.

To ship an update, bump `VERSION` in `sw.js`; the old cache is deleted on activation.

## Using it

- **Add photos** picks 2–9 photos from the photo library (`<input type="file" multiple>` accepting `image/*`, HEIC/HEIF, JPG/JPEG, PNG and WebP).

### Supported formats

| Format | How it is handled |
| --- | --- |
| JPEG / JPG, PNG, WebP, GIF | Decoded natively. EXIF orientation is applied (`createImageBitmap` with `imageOrientation: 'from-image'`, falling back to an `<img>` decode, which also honours EXIF). |
| HEIC / HEIF | Safari 17+ decodes HEIC natively, so on iOS it goes through the same path as JPEG. In browsers without native HEIC support (Chrome, Firefox, Edge, Android) the file is converted to JPEG (quality 0.95) in the browser with the bundled `vendor/heic2any.min.js` (libheif compiled to wasm, MIT). The decoder is only loaded the first time it is needed and is precached for offline use. The converted JPEG is what gets stored and exported. |
| Anything that still fails | Skipped with a toast naming the file. |

HEIC detection uses the file name/MIME type and, failing that, sniffs the `ftyp` box so files with a missing type still convert.
- **Tap** a cell to select it. **Drag** to pan the photo inside its cell, **pinch** to zoom (about the pinch point). **Double-tap** resets the cell. **Long-press, then drag** a photo onto another cell to swap them.
- **Aspect ratio** 1:1, 4:5, 3:4, 9:16, 16:9. **Layouts** shown depend on the number of photos.
- **Gap**, **margin** and **corner radius** are in preview pixels (relative to a 400 px shorter side) so they scale identically in the export.
- **Background**: white, black, or custom color.
- **Export 16 MP** renders JPEG (quality 0.92) or PNG, then shows the real pixel dimensions and file size. **Save to Photos…** opens the share sheet (Web Share API with files); choose **Save Image**. Where Web Share is unavailable the image opens in a new tab for long-press saving.
- The current project (layout, settings, photos as bytes) is saved to IndexedDB on every change and restored when you reopen the app, even after iOS evicts the tab.

## Export design (iOS limits)

- Export dimensions are computed from the aspect ratio so width × height ≈ 16,000,000, rounded to even numbers (4000×4000, 3578×4472, 3464×4618, 3000×5334, 5334×3000). All are under Safari's 16,777,216 px canvas limit.
- The export canvas is created at exactly that size, never larger. A probe pixel is written and read back to detect silent allocation failure.
- Each photo is decoded at just the size its cell needs (`createImageBitmap` with `resizeWidth`), drawn, and closed before the next one is decoded.
- If the canvas fails to allocate or `toBlob` returns `null`, the export retries once at 90% linear size (~13 MP) and the UI reports the actual output resolution.
- Preview and export call the same `layoutFor()` and `drawCollage()`; only the canvas size differs.

## Known iOS limitations

- Service worker and standalone mode need HTTPS (or `localhost`).
- Safari may discard the service worker cache and IndexedDB for a site that has not been used for about a week (ITP). Adding to the Home Screen helps: installed web apps are exempt from the 7-day eviction.
- A single canvas is limited to roughly 16.7 MP, and total canvas memory per page is limited; that is why the export is rendered off-DOM with photos decoded one at a time. Nine 48 MP photos may still trigger the fallback size on older devices.
- `<a download>` is unreliable, so saving uses the share sheet. `navigator.share` must be called from a tap, which is why export and save are two buttons.
- The 16 MP JPEG shared via the share sheet is saved as-is to Photos. PNG exports are large (tens of MB) and slower to encode.
- Safari ignores `user-scalable=no` in the browser tab, but honors it when launched from the Home Screen. The canvas uses `touch-action: none` and cancels touch/gesture events so pinching the collage never zooms the page.
- File inputs cannot preserve the original HEIC; iOS hands the app a JPEG re-encode.
