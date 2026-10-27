# Ti-Eye by Tisini — Blue Full-Screen UI v1

This package simplifies the existing Ti-Eye phone-camera interface for field testing on a Samsung Galaxy A16. The camera acquisition, canvas rendering, optional ball detector, MediaRecorder capture, and video download/save code from the supplied project have been retained. The new interface has not yet been field-tested; test it on the phone before replacing the live version.

## What's changed

- Blue Tisini-style background and Tisini branding in the header. The official logo is loaded from `https://www.tisini.co.ke/tisini-logo.png`; a text fallback appears if it cannot load.
- The camera preview is the main focus. Advanced digital framing and the match desk are collapsed until opened.
- Added a **Full screen** button. Where supported, it enters native browser full screen and requests landscape orientation; otherwise it uses a full-viewport layout inside the browser.
- Larger, clearer **Start Recording** and **Stop & Save** controls are kept beside the preview.
- Bumped the service-worker cache name so GitHub Pages clients can pick up the new UI.

## Deploy with GitHub Desktop

1. Keep a backup of the currently live repository first.
2. Extract this ZIP on your computer. Open the `Ti-Eye-V.1-main` folder and copy its contents (`index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icons/`, and `README.md`) into the root of your existing `Ti-Eye-V.1` repository. Do not delete the `.git` folder in your repository.
3. Use GitHub Desktop to review the changed files, commit with a message such as `Simplify Ti-Eye UI and add full-screen camera`, then push to `main`. GitHub Pages should redeploy automatically.
4. Open the deployed HTTPS link in Chrome on the Samsung A16. If the old cached page appears, refresh the page or close and reopen it.
5. Test in this order: Start Camera, confirm live preview, Start Recording for 10 seconds, Stop & Save, and play the downloaded WebM. Then tap **Full screen** and repeat a short test.

## Important

- This ZIP does not itself update the public GitHub Pages site. The changes go live only after you commit and push them to the repository.
- The camera requires an HTTPS page and user permission. Do not test via a `file://` URL.
- Full-screen and orientation-lock support varies between mobile browsers. The layout falls back to filling the available page viewport if native full screen is unavailable.
- Video is downloaded as WebM using the existing browser recording path. Confirm the downloaded file on your phone before recording a full match.
- AI ball detection remains experimental, optional, and dependent on downloading its libraries/model. Core camera recording does not depend on AI loading.
