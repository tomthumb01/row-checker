# Lyme Regis Row Checker — Web Version

This package gives you a **clean browser-based version** of the row checker so end users do **not** need to install Python.

## What is included
- `index.html` — the app shell
- `styles.css` — polished responsive styling
- `app.js` — scoring logic + UI
- `sample-forecast.json` — bundled preview data
- `api/metoffice-forecast.json` — placeholder live endpoint file
- `api/azure-function-example.js` — example backend stub

## How it works
### Option A — fastest demo / internal share
Host the folder as a static website (SharePoint static files, GitHub Pages, Azure Static Web Apps, Netlify, etc.).
- The app works immediately with the **sample forecast** button.
- Good for showing layout, workflow and scoring.
- Not truly live until you wire the backend.

### Option B — proper live version for club members
Host the front-end, then connect it to a **small backend endpoint** that fetches the Met Office Lyme Regis page server-side and returns normalised JSON.

The front-end is already written to request:
- `./api/metoffice-forecast.json`

This repo includes a local backend placeholder at `api/metoffice-forecast/index.js`, but the web app itself needs a server-side host to expose `/api/metoffice-forecast.json`.

If you want to run the full app locally without installing Node, use the included Python server:

```powershell
python local_server.py
```

Then open:
- `http://127.0.0.1:8000`

So in production you can:
- replace the local server with your own backend route, or
- change the fetch URL in `app.js` to your deployed API.

## Suggested zero-install deployment paths
### 1) Azure Static Web Apps + small serverless API
Best if you want a proper URL you can share with the club.

### 2) Netlify / Vercel + serverless function
Also good if you want a lightweight hosted site.

### 3) SharePoint site page + embedded static app
Possible if your distribution is internal only, though server-side weather fetching is still needed for live data.

## Recommended real-world setup
If the goal is “open a link and use it” for non-technical users, the simplest practical architecture is:
1. static front-end web app
2. one tiny backend endpoint that fetches/parses Met Office data
3. shareable public or club-only URL

## Next improvement
If you send the exact club **RED / AMBER thresholds**, the scoring can be updated so the web tool reflects the real policy far more closely.