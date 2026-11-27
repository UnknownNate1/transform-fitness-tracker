# TRANSFORM — Fitness Tracker

A mobile-first, installable fitness tracker designed for simple progress logging.

## Current MVP
- Weight entries and a simple trend chart
- Workout checklist and completed-session history
- Editable starting and goal weights
- Local-device storage (no account or backend)
- JSON export/import for backups
- Basic offline app-shell caching

## Personalization and safety
The starter workout avoids exercises requiring left-arm use or floor transfers. It includes optional movements that should only be attempted if the user already knows they can perform them safely and independently. This is a general tracker, not a medical or physical-therapy program. Stop any movement that causes pain, dizziness, instability, or unusual shortness of breath.

## Run locally
Open `index.html` in a browser. Service-worker/offline installation requires HTTPS or localhost.

## Publish with GitHub Pages
1. Open this repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **main** and folder **/(root)**, then Save.
5. Wait for the Pages deployment to finish. GitHub will show the site URL in the Pages section.

## Install on iPhone
1. Open the published HTTPS site in Safari.
2. Tap **Share → Add to Home Screen**.
3. Launch TRANSFORM from the Home Screen.

## Privacy and data
Workout and weight records are stored in browser local storage on the device. They are not committed to this repository or synced to a server. Export a JSON backup before clearing browser data or changing devices. Anyone with access to the unlocked device/browser profile may be able to access local data.

## Roadmap
- Accessibility improvements and larger touch targets
- Custom exercises and configurable routines
- Better progress summaries and goal pacing
- Optional reminders and backup workflow
- Testing on real iPhone screen sizes and offline behavior
