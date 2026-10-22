# Ti-Eye A16 Camera Fix — V0.3.1

This is a corrected, lightweight static PWA package for early field testing on a Samsung Galaxy A16. It is a best-effort rebuilt package based on the Ti-Eye features and camera failure description available in the conversation; it is not the inaccessible original ZIP binary and it is not an APK.

## Main corrections

- Camera access only starts when the user taps **Start Camera**.
- Secure-context and `getUserMedia` support checks are shown in the diagnostics panel.
- Rear camera is preferred using *ideal* settings, with fallbacks to less restrictive constraints and then `{ video: true, audio: false }`.
- The same single MediaStream powers preview; no second camera open is made for recording.
- The video element uses muted/autoplay/playsinline and `srcObject`, waits for metadata, calls `play()`, and reports failures.
- AI is a separate optional action. If the AI libraries/model cannot download or inference fails, camera preview remains available.
- Recording uses the canvas-framed output when `MediaRecorder` and `canvas.captureStream` are supported. It downloads a WebM file when stopped. A short test recording is recommended.
- Match score, clock, event bookmarks, and CSV export are included.
- Service worker uses a versioned cache and deletes older `ti-eye-*` caches; external AI libraries/models are not cached by it.

## IMPORTANT: how to open the camera

The phone camera requires a secure context. A normal `file://` link to `index.html` is expected to fail. Upload these files to a static HTTPS host such as GitHub Pages, Cloudflare Pages, or another free HTTPS static host, then open the public `https://...` address directly in Chrome on the phone. Do not use an embedded preview in an editor.

1. Extract this ZIP.
2. Upload the contents of the `Ti-Eye-A16-Camera-Fix` folder to a static HTTPS host (the `index.html` must be at the published root).
3. Open the public HTTPS URL in Chrome on your Samsung A16.
4. Tap **Start Camera** and choose **Allow** when asked.
5. If it was previously denied, open Chrome's site settings for the URL and allow Camera; also confirm Android Settings → Apps → Chrome → Permissions → Camera.
6. Try a short camera test first, then a 10-second recording and check the downloaded WebM.

## AI limitations

The optional experimental ball detector loads TensorFlow.js and COCO-SSD from a CDN, so it requires internet access when enabling AI. It is a generic `sports ball` detector and is not a trained football match detector. For this reason, the camera preview does not depend on AI loading. On a far-away pitch, the ball may be missed or confused with other objects.

## Testing status

This package has not been physically tested on the user's Samsung Galaxy A16. Browsers, site permissions, firmware, and hosting configuration can differ. Use the visible diagnostics panel to identify whether failure is due to insecure hosting, missing camera API, permission, camera contention, or playback.

## Files

- `index.html` — app layout
- `app.js` — camera, diagnostics, digital framing, optional AI, recording, match desk
- `styles.css` — responsive interface
- `manifest.webmanifest` — PWA settings
- `sw.js` — versioned/offline shell caching
- `icons/` — app icons
