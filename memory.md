# Project Memory

## Name
Codex PDF Canvas

## Goal
Local-first web app for working with PDFs using local `codex app-server` auth (ChatGPT account), with no app-level cloud PDF storage.

## Current Architecture
- Backend: Node/Express in `server.js`
- Codex runtime bridge: `lib/codexSupervisor.js`
- PDF workspace manager: `lib/pdfStore.js`
- PDF helper script: `scripts/pdf_ops.py` (`pypdf` + `pdfplumber`)
- Frontend: `public/index.html`, `public/styles.css`, `public/app.js`

## Key UX Direction
- PDF-first canvas layout
- Sidebar controls for upload/edit/export
- Per-document analysis windows over the canvas (multi-window, dedicated threads)
- Per-window model selection, draggable/resizable window layout, and collapsible tool rail
- PDF annotation tools: add text, highlight, and drawn signature
- Click-to-place annotations with an in-canvas placement layer:
  - Text and signature place on click
  - Highlights place via click-drag region
  - Text styling supports font family, color, bold, italic, and underline
  - Highlight supports color and opacity
- Placement alignment uses a PDF.js-rendered local preview canvas during placement so coordinates match the actual page area.
- Placement preview loads PDF.js from `legacy/build` for browser compatibility with runtimes missing newer JS APIs.

## Important Runtime Notes
- App expects Codex CLI binary; override with `CODEX_BIN` when needed.
- Local run:
  - `python3 -m pip install -r "./requirements.txt"`
  - `npm install`
  - `CODEX_BIN="/Volumes/X9 Pro/mac_home/applications/Codex.app/Contents/Resources/codex" npm run dev`

## API Notes
- Inline PDF view: `GET /api/docs/:docId/view`
- Download PDF: `GET /api/docs/:docId/download`
- Models: `GET /api/codex/models`
- Analyze: `POST /api/codex/analyze` supports optional `threadId`
- Annotations:
  - `POST /api/docs/:docId/add-text`
  - `POST /api/docs/:docId/highlight`
  - `POST /api/docs/:docId/add-signature`

## Data Handling
- Uploaded PDFs and generated files live in local temp workspace directories.
- Workspace is cleaned up on shutdown.
