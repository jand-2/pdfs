import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexSupervisor } from "./lib/codexSupervisor.js";
import { PdfStore } from "./lib/pdfStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3210);
const MAX_UPLOAD_SIZE_BYTES = 80 * 1024 * 1024;

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES
  }
});

const pdfStore = new PdfStore();
const codex = new CodexSupervisor();

const MIME_BY_EXTENSION = new Map([
  [".md", "text/markdown"],
  [".txt", "text/plain"],
  [".json", "application/json"],
  [".csv", "text/csv"],
  [".html", "text/html"],
  [".xml", "application/xml"],
  [".js", "text/javascript"],
  [".ts", "text/plain"],
  [".py", "text/x-python"],
  [".pdf", "application/pdf"]
]);

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

function parseBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function buildCodexPrompt(userPrompt) {
  return `You are working in a local PDF workspace.

Available files:
- current.pdf (latest editable PDF)
- input.txt (local text extraction from the current PDF)
- tools/pdf_ops.py (local helper for inspect/extract/rotate/delete/extract-pages/merge)

Task:
${userPrompt}

Rules:
1. Keep all processing local to this workspace.
2. Prefer \`python3 tools/pdf_ops.py --help\` for PDF manipulations when needed.
3. Never write, edit, or save files anywhere in this workspace.
4. If the user wants a downloadable file, return it inline using this exact format:
<<DOWNLOAD:filename.ext>>
\`\`\`text
file contents here
\`\`\`
<<END_DOWNLOAD>>
5. You may include a short summary outside the download block, but do not mention exports or created files.`;
}

function sanitizeDownloadName(value) {
  const trimmed = String(value || "").trim();
  const base = path.basename(trimmed).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || `download-${Date.now()}.txt`;
}

function mimeTypeForFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXTENSION.get(ext) || "application/octet-stream";
}

function parseInlineDownloads(output) {
  const downloads = [];
  const pattern = /<<DOWNLOAD:([^\n>]+)>>\s*```(?:[a-zA-Z0-9_+-]+)?\n([\s\S]*?)```[\t ]*\n?<<END_DOWNLOAD>>/g;

  const cleaned = String(output || "").replace(pattern, (_match, rawName, rawContent) => {
    const filename = sanitizeDownloadName(rawName);
    const content = String(rawContent || "").replace(/\n$/, "");
    downloads.push({
      filename,
      mimeType: mimeTypeForFile(filename),
      sizeBytes: Buffer.byteLength(content, "utf8"),
      contentBase64: Buffer.from(content, "utf8").toString("base64")
    });
    return `\nPrepared download: ${filename}\n`;
  }).replace(/\n{3,}/g, "\n\n").trim();

  if (!downloads.length) {
    return {
      output: String(output || "").trim(),
      downloads
    };
  }

  return {
    output: cleaned || `Prepared ${downloads.length === 1 ? "download" : "downloads"}: ${downloads.map((file) => file.filename).join(", ")}`,
    downloads
  };
}

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/vendor/pdfjs", express.static(path.join(__dirname, "node_modules", "pdfjs-dist")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    codexConnected: codex.isConnected(),
    loadedDocs: pdfStore.listDocs().length
  });
});

app.get(
  "/api/codex/account",
  asyncHandler(async (_req, res) => {
    const account = await codex.getAccount();
    res.json(account);
  })
);

app.get(
  "/api/codex/models",
  asyncHandler(async (_req, res) => {
    const models = await codex.listModels();
    res.json(models);
  })
);

app.post(
  "/api/codex/login/start",
  asyncHandler(async (_req, res) => {
    const login = await codex.startChatgptLogin();
    res.json(login);
  })
);

app.post(
  "/api/codex/logout",
  asyncHandler(async (_req, res) => {
    await codex.logout();
    res.json({ ok: true });
  })
);

app.get(
  "/api/codex/login/status/:loginId",
  asyncHandler(async (req, res) => {
    const { loginId } = req.params;
    const status = codex.getLoginStatus(loginId);

    if (status?.success) {
      const account = await codex.getAccount();
      res.json({ status, account });
      return;
    }

    res.json({ status: status ?? { success: false, pending: true } });
  })
);

app.get(
  "/api/docs",
  asyncHandler(async (_req, res) => {
    res.json({ data: pdfStore.listDocs() });
  })
);

app.post(
  "/api/docs/upload",
  upload.single("pdf"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new Error("Missing PDF file");
    }

    if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
      throw new Error("Upload must be a PDF file");
    }

    const created = await pdfStore.createDocFromUpload({
      filename: req.file.originalname,
      buffer: req.file.buffer
    });

    res.json({ document: created });
  })
);

app.get(
  "/api/docs/:docId",
  asyncHandler(async (req, res) => {
    const doc = await pdfStore.getDoc(req.params.docId);
    res.json({
      document: {
        id: doc.id,
        filename: doc.filename,
        pageCount: doc.pageCount,
        pageSizes: doc.pageSizes,
        forms: doc.forms,
        hasForms: doc.forms.length > 0,
        sizeBytes: doc.sizeBytes,
        updatedAt: new Date(doc.updatedAt).toISOString(),
        codexThreadId: doc.codexThreadId,
        signatures: doc.signatures,
        hasSignatures: doc.signatures.length > 0
      }
    });
  })
);

app.get(
  "/api/docs/:docId/view",
  asyncHandler(async (req, res) => {
    const doc = await pdfStore.getDoc(req.params.docId);
    const pdfBuffer = await pdfStore.getCurrentPdfBuffer(req.params.docId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=\"${doc.filename}\"`);
    res.send(pdfBuffer);
  })
);

app.get(
  "/api/docs/:docId/download",
  asyncHandler(async (req, res) => {
    const doc = await pdfStore.getDoc(req.params.docId);
    const pdfBuffer = await pdfStore.getCurrentPdfBuffer(req.params.docId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${doc.filename}\"`);
    res.send(pdfBuffer);
  })
);

app.delete(
  "/api/docs/:docId",
  asyncHandler(async (req, res) => {
    await pdfStore.deleteDoc(req.params.docId);
    res.json({ ok: true });
  })
);

app.post(
  "/api/docs/:docId/extract-text",
  asyncHandler(async (req, res) => {
    const pages = req.body?.pages ? String(req.body.pages) : null;
    const extracted = await pdfStore.extractText(req.params.docId, pages);
    res.json(extracted);
  })
);

app.post(
  "/api/docs/:docId/rotate",
  asyncHandler(async (req, res) => {
    const pages = String(req.body?.pages ?? "").trim();
    const degrees = Number(req.body?.degrees);
    if (!pages) {
      throw new Error("Provide pages to rotate (for example: 1,3-5)");
    }

    const updated = await pdfStore.rotatePages(req.params.docId, pages, degrees);
    res.json({ document: updated });
  })
);

app.post(
  "/api/docs/:docId/delete-pages",
  asyncHandler(async (req, res) => {
    const pages = String(req.body?.pages ?? "").trim();
    if (!pages) {
      throw new Error("Provide pages to delete (for example: 2,4-6)");
    }

    const updated = await pdfStore.deletePages(req.params.docId, pages);
    res.json({ document: updated });
  })
);

app.post(
  "/api/docs/:docId/add-text",
  asyncHandler(async (req, res) => {
    const text = String(req.body?.text ?? "").trim();
    if (!text) {
      throw new Error("Text is required");
    }

    const updated = await pdfStore.addText(req.params.docId, {
      page: Number(req.body?.page ?? 1),
      x: Number(req.body?.x ?? 72),
      y: Number(req.body?.y ?? 72),
      text,
      fontSize: Number(req.body?.fontSize ?? 14),
      fontFamily: String(req.body?.fontFamily ?? "helvetica"),
      bold: parseBoolean(req.body?.bold),
      italic: parseBoolean(req.body?.italic),
      underline: parseBoolean(req.body?.underline),
      color: String(req.body?.color ?? "#111111")
    });

    res.json({ document: updated });
  })
);

app.post(
  "/api/docs/:docId/highlight",
  asyncHandler(async (req, res) => {
    const updated = await pdfStore.addHighlight(req.params.docId, {
      page: Number(req.body?.page ?? 1),
      x: Number(req.body?.x ?? 72),
      y: Number(req.body?.y ?? 72),
      width: Number(req.body?.width ?? 180),
      height: Number(req.body?.height ?? 30),
      color: String(req.body?.color ?? "#ffe16b"),
      opacity: Number(req.body?.opacity ?? 0.35)
    });

    res.json({ document: updated });
  })
);

app.post(
  "/api/docs/:docId/fill-form-fields",
  asyncHandler(async (req, res) => {
    const fields = req.body?.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) {
      throw new Error("Provide at least one form field value");
    }

    const updated = await pdfStore.fillFormFields(req.params.docId, fields);
    res.json({ document: updated });
  })
);

app.post(
  "/api/docs/:docId/add-signature",
  asyncHandler(async (req, res) => {
    const imageBase64 = String(req.body?.imageBase64 ?? "").trim();
    if (!imageBase64) {
      throw new Error("Signature image is required");
    }

    const updated = await pdfStore.addSignature(req.params.docId, {
      page: Number(req.body?.page ?? 1),
      x: Number(req.body?.x ?? 72),
      y: Number(req.body?.y ?? 72),
      width: Number(req.body?.width ?? 220),
      height: Number(req.body?.height ?? 72),
      imageBase64
    });

    res.json({ document: updated });
  })
);

app.post(
  "/api/docs/:docId/sign",
  upload.single("certificate"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new Error("Upload a .p12 or .pfx certificate to sign this PDF");
    }
    if (!/\.(p12|pfx)$/i.test(req.file.originalname || "")) {
      throw new Error("Certificate upload must be a .p12 or .pfx file");
    }

    const updated = await pdfStore.signDocument(req.params.docId, {
      certificateBuffer: req.file.buffer,
      certificateName: req.file.originalname,
      password: String(req.body?.password ?? ""),
      page: Number(req.body?.page ?? 1),
      x: Number(req.body?.x ?? 72),
      y: Number(req.body?.y ?? 72),
      width: Number(req.body?.width ?? 220),
      height: Number(req.body?.height ?? 72),
      fieldName: req.body?.fieldName ? String(req.body.fieldName) : undefined,
      name: req.body?.name ? String(req.body.name) : undefined,
      reason: req.body?.reason ? String(req.body.reason) : undefined,
      location: req.body?.location ? String(req.body.location) : undefined,
      contactInfo: req.body?.contactInfo ? String(req.body.contactInfo) : undefined,
      timestampUrl: req.body?.timestampUrl ? String(req.body.timestampUrl) : undefined,
      certify: parseBoolean(req.body?.certify),
      docMdpPermissions: req.body?.docMdpPermissions ? String(req.body.docMdpPermissions) : undefined,
      appearanceMode: req.body?.appearanceMode ? String(req.body.appearanceMode) : undefined,
      appearanceText: req.body?.appearanceText ? String(req.body.appearanceText) : undefined,
      appearanceImageBase64: req.body?.appearanceImage ? String(req.body.appearanceImage) : undefined
    });

    res.json({ document: updated });
  })
);

app.post(
  "/api/docs/:docId/extract-pages",
  asyncHandler(async (req, res) => {
    const pages = String(req.body?.pages ?? "").trim();
    if (!pages) {
      throw new Error("Provide pages to extract");
    }

    const targetFileName = req.body?.filename ? String(req.body.filename) : undefined;
    const created = await pdfStore.extractPages(req.params.docId, pages, targetFileName);
    res.json({ document: created });
  })
);

app.post(
  "/api/docs/:docId/undo",
  asyncHandler(async (req, res) => {
    const updated = await pdfStore.undoLastChange(req.params.docId);
    res.json({ document: updated });
  })
);

app.post(
  "/api/docs/:docId/redo",
  asyncHandler(async (req, res) => {
    const updated = await pdfStore.redoLastChange(req.params.docId);
    res.json({ document: updated });
  })
);

app.post(
  "/api/docs/merge",
  asyncHandler(async (req, res) => {
    const docIds = req.body?.docIds;
    const filename = req.body?.filename ? String(req.body.filename) : undefined;
    const merged = await pdfStore.mergeDocuments(docIds, filename);
    res.json({ document: merged });
  })
);

app.get(
  "/api/docs/:docId/workspace-files",
  asyncHandler(async (req, res) => {
    const files = await pdfStore.listWorkspaceFiles(req.params.docId);
    res.json({ data: files });
  })
);

app.get(
  "/api/docs/:docId/workspace-file",
  asyncHandler(async (req, res) => {
    const relativePath = req.query.path ? String(req.query.path) : "";
    const absolutePath = await pdfStore.resolveWorkspaceFile(req.params.docId, relativePath);
    res.download(absolutePath);
  })
);

app.post(
  "/api/docs/:docId/promote-pdf",
  asyncHandler(async (req, res) => {
    const relativePath = String(req.body?.path ?? "").trim();
    if (!relativePath) {
      throw new Error("Missing path to workspace PDF");
    }

    const updated = await pdfStore.promoteWorkspacePdf(req.params.docId, relativePath);
    res.json({ document: updated });
  })
);

app.post(
  "/api/codex/analyze",
  asyncHandler(async (req, res) => {
    const docId = String(req.body?.docId ?? "").trim();
    const userPrompt = String(req.body?.prompt ?? "").trim();
    const requestedThreadId = req.body?.threadId ? String(req.body.threadId).trim() : null;
    const requestedModel = req.body?.model ? String(req.body.model).trim() : null;

    if (!docId) {
      throw new Error("Missing document id");
    }
    if (!userPrompt) {
      throw new Error("Prompt is required");
    }

    const doc = await pdfStore.getDoc(docId);
    await pdfStore.extractText(docId, null);

    let threadId = requestedThreadId || doc.codexThreadId;
    if (!threadId) {
      const thread = await codex.startThread(doc.workspaceDir);
      threadId = thread.thread.id;
      if (!requestedThreadId) {
        pdfStore.setCodexThreadId(docId, threadId);
      }
    }

    let turn;
    try {
      turn = await codex.runTurn({
        threadId,
        cwd: doc.workspaceDir,
        text: buildCodexPrompt(userPrompt),
        model: requestedModel
      });
    } catch (_error) {
      const freshThread = await codex.startThread(doc.workspaceDir);
      threadId = freshThread.thread.id;
      if (!requestedThreadId) {
        pdfStore.setCodexThreadId(docId, threadId);
      }
      turn = await codex.runTurn({
        threadId,
        cwd: doc.workspaceDir,
        text: buildCodexPrompt(userPrompt),
        model: requestedModel
      });
    }

    const parsed = parseInlineDownloads(turn.output);

    res.json({
      threadId,
      turnId: turn.turnId,
      status: turn.status,
      error: turn.error,
      output: parsed.output,
      downloads: parsed.downloads
    });
  })
);

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, _req, res, _next) => {
  const message = error?.message || "Unexpected server error";
  const statusCode = message.toLowerCase().includes("missing") || message.toLowerCase().includes("invalid") ? 400 : 500;

  res.status(statusCode).json({
    ok: false,
    error: message
  });
});

let server = null;

async function bootstrap() {
  await pdfStore.init();
  await codex.start();

  server = app.listen(PORT, () => {
    console.log(`codex-pdf-local-app listening on http://localhost:${PORT}`);
  });

  server.on("error", (error) => {
    console.error(`Server failed: ${error.message}`);
    process.exit(1);
  });
}

const shutdown = async () => {
  if (server) {
    server.close();
  }
  await codex.stop();
  await pdfStore.cleanupAll();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

bootstrap().catch((error) => {
  console.error(`Failed to start app: ${error.message}`);
  process.exit(1);
});
