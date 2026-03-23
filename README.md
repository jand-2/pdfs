# Codex PDF Workspace

A local-first web app for PDF editing, signing, and analysis, backed by a local `codex app-server` session.

## Highlights

- Local authentication via Codex (ChatGPT account integration through the local app-server).
- Upload and manage PDFs in a local document shelf.
- Page tools for rotate, delete pages, extract pages, and merge PDFs.
- In-view page navigation with Previous/Next and direct page jump controls.
- Undo and redo for document edits.
- Annotation tools: add text, highlight, and place electronic signatures.
- Fill interactive PDF forms (AcroForm fields).
- Extract text and run Codex analysis or workspace export workflows.
- Local PDF.js viewer with viewport-aware placement and signature/text overlays.

## Local-Only Storage

This app is designed for private desktop-style usage and does not store PDFs in cloud storage. Documents are kept under the app’s local workspace directory in your OS temp area and managed in memory for active sessions. On server shutdown (`SIGINT`/`SIGTERM`), local workspaces are cleaned up.

## Requirements

- Node.js 20+
- Python 3.10+
- `codex` CLI installed and logged in (`codex login`)
- Python dependencies in `requirements.txt`
- Node dependencies in `package.json`

## Run

```bash
npm install
npm run dev
```

Open the app at [http://localhost:3210](http://localhost:3210). Set `PORT` to change the listener port if needed.

If `codex` is not on your `PATH`, run with:

```bash
CODEX_BIN="/absolute/path/to/codex" npm run dev
```

## API Summary

- `GET /api/health`
- `GET /api/codex/account`
- `GET /api/codex/models`
- `POST /api/codex/login/start`
- `GET /api/codex/login/status/:loginId`
- `POST /api/codex/logout`
- `GET /api/docs`
- `POST /api/docs/upload`
- `GET /api/docs/:docId`
- `GET /api/docs/:docId/view`
- `GET /api/docs/:docId/download`
- `DELETE /api/docs/:docId`
- `POST /api/docs/:docId/extract-text`
- `POST /api/docs/:docId/rotate`
- `POST /api/docs/:docId/delete-pages`
- `POST /api/docs/:docId/extract-pages`
- `POST /api/docs/merge`
- `POST /api/docs/:docId/add-text`
- `POST /api/docs/:docId/highlight`
- `POST /api/docs/:docId/add-signature`
- `POST /api/docs/:docId/fill-form-fields`
- `POST /api/docs/:docId/undo`
- `POST /api/docs/:docId/redo`
- `POST /api/docs/:docId/promote-pdf`
- `GET /api/docs/:docId/workspace-files`
- `GET /api/docs/:docId/workspace-file`
- `POST /api/codex/analyze`
