import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PYTHON_SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "pdf_ops.py");
const PDF_HELPER_COPY_NAME = "pdf_ops.py";
const MAX_HISTORY_ENTRIES = 30;

function runPdfScript(args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    execFile("python3", [PYTHON_SCRIPT_PATH, ...args], { maxBuffer: 100 * 1024 * 1024, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`PDF helper failed: ${stderr || error.message}`));
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(new Error(`PDF helper returned invalid JSON: ${stdout || stderr}`));
        return;
      }

      if (!parsed.ok) {
        reject(new Error(parsed.error || "Unknown PDF helper error"));
        return;
      }

      resolve(parsed);
    });
  });
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizePageSizes(rawPageSizes) {
  if (!Array.isArray(rawPageSizes)) {
    return [];
  }

  return rawPageSizes
    .map((row) => ({
      width: Number(row?.width ?? 0),
      height: Number(row?.height ?? 0)
    }))
    .filter((row) => Number.isFinite(row.width) && Number.isFinite(row.height) && row.width > 0 && row.height > 0);
}

function normalizeSignatureSummaries(rawSignatures) {
  if (!Array.isArray(rawSignatures)) {
    return [];
  }

  return rawSignatures.map((entry, index) => ({
    id: String(entry?.fieldName || entry?.signedAt || index),
    fieldName: String(entry?.fieldName || `Signature ${index + 1}`),
    signerName: entry?.signerName ? String(entry.signerName) : null,
    signerSubject: entry?.signerSubject ? String(entry.signerSubject) : null,
    signedAt: entry?.signedAt ? String(entry.signedAt) : null,
    docMdpLevel: entry?.docMdpLevel ? String(entry.docMdpLevel) : null,
    integrity: {
      coverage: entry?.integrity?.coverage ? String(entry.integrity.coverage) : null,
      docMdpOk: entry?.integrity?.docMdpOk !== undefined ? Boolean(entry.integrity.docMdpOk) : null,
      modificationLevel: entry?.integrity?.modificationLevel ? String(entry.integrity.modificationLevel) : null,
      changedFormFields: Array.isArray(entry?.integrity?.changedFormFields)
        ? entry.integrity.changedFormFields.map((value) => String(value))
        : [],
      error: entry?.integrity?.error ? String(entry.integrity.error) : null
    }
  }));
}

function normalizeFormFieldValue(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map((item) => (item === null || item === undefined ? "" : String(item)));
  }
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (rawValue === null || rawValue === undefined) {
    return "";
  }
  return String(rawValue);
}

function normalizeFormFields(rawForms) {
  if (!Array.isArray(rawForms)) {
    return [];
  }

  return rawForms
    .map((entry, index) => ({
      id: String(entry?.id || entry?.name || index),
      name: String(entry?.name || entry?.shortName || `field_${index + 1}`),
      shortName: entry?.shortName ? String(entry.shortName) : String(entry?.name || `field_${index + 1}`),
      label: entry?.label ? String(entry.label) : String(entry?.name || `Field ${index + 1}`),
      page: Number.isFinite(Number(entry?.page)) ? Number(entry.page) : null,
      type: String(entry?.type || "text"),
      rawType: entry?.rawType ? String(entry.rawType) : null,
      value: normalizeFormFieldValue(entry?.value),
      options: Array.isArray(entry?.options)
        ? entry.options.map((option, optionIndex) => ({
          value: String(option?.value ?? option?.label ?? optionIndex),
          label: String(option?.label ?? option?.value ?? `Option ${optionIndex + 1}`)
        }))
        : [],
      readOnly: Boolean(entry?.readOnly),
      required: Boolean(entry?.required),
      multiline: Boolean(entry?.multiline),
      combo: Boolean(entry?.combo),
      exportValue: entry?.exportValue ? String(entry.exportValue) : null
    }))
    .filter((entry) => Boolean(entry.name));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class PdfStore {
  constructor(options = {}) {
    this.rootDir = options.rootDir ?? path.join(os.tmpdir(), "codex-pdf-local-app");
    this.docs = new Map();
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  listDocs() {
    return [...this.docs.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((doc) => this.#toPublicDoc(doc));
  }

  async createDocFromUpload({ filename, buffer }) {
    const id = randomUUID();
    const safeName = sanitizeFileName(filename || `document-${id}.pdf`);
    const workspaceDir = path.join(this.rootDir, id);

    await fs.mkdir(path.join(workspaceDir, "exports"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "tools"), { recursive: true });
    await fs.copyFile(PYTHON_SCRIPT_PATH, path.join(workspaceDir, "tools", PDF_HELPER_COPY_NAME));

    const pdfPath = path.join(workspaceDir, "current.pdf");
    await fs.writeFile(pdfPath, buffer);

    const inspected = await runPdfScript(["inspect", "--input", pdfPath]);

    const now = Date.now();
    const doc = {
      id,
      filename: safeName,
      workspaceDir,
      pdfPath,
      pageCount: Number(inspected.pageCount ?? 0),
      pageSizes: normalizePageSizes(inspected.pageSizes),
      forms: normalizeFormFields(inspected.forms),
      signatures: normalizeSignatureSummaries(inspected.signatures),
      sizeBytes: buffer.byteLength,
      updatedAt: now,
      codexThreadId: null,
      undoStack: [],
      redoStack: []
    };

    this.docs.set(id, doc);
    await this.extractText(id, null);
    return this.#toPublicDoc(doc);
  }

  async getDocOrThrow(docId) {
    const doc = this.docs.get(docId);
    if (!doc) {
      throw new Error("Unknown document id");
    }
    return doc;
  }

  async getDoc(docId) {
    return this.getDocOrThrow(docId);
  }

  async deleteDoc(docId) {
    const doc = await this.getDocOrThrow(docId);
    this.docs.delete(docId);
    await fs.rm(doc.workspaceDir, { recursive: true, force: true });
  }

  async getCurrentPdfBuffer(docId) {
    const doc = await this.getDocOrThrow(docId);
    return fs.readFile(doc.pdfPath);
  }

  async extractText(docId, pagesSpec) {
    const doc = await this.getDocOrThrow(docId);

    const args = ["extract-text", "--input", doc.pdfPath];
    if (pagesSpec && String(pagesSpec).trim()) {
      args.push("--pages", String(pagesSpec).trim());
    }

    const extracted = await runPdfScript(args);

    if (!pagesSpec) {
      const textPath = path.join(doc.workspaceDir, "input.txt");
      await fs.writeFile(textPath, extracted.text || "", "utf8");
    }

    return {
      text: extracted.text || "",
      charCount: Number(extracted.charCount ?? 0),
      pageCount: Number(extracted.pageCount ?? doc.pageCount)
    };
  }

  async rotatePages(docId, pagesSpec, degrees) {
    const numericDegrees = Number(degrees);
    if (!Number.isFinite(numericDegrees) || ![90, 180, 270, -90, -180, -270].includes(numericDegrees)) {
      throw new Error("Rotation must be one of: 90, 180, 270, -90, -180, -270");
    }
    return this.#applyMutatingOp(docId, [
      "rotate",
      "--pages",
      String(pagesSpec),
      "--degrees",
      String(numericDegrees)
    ]);
  }

  async deletePages(docId, pagesSpec) {
    return this.#applyMutatingOp(docId, ["delete-pages", "--pages", String(pagesSpec)]);
  }

  async addText(docId, options) {
    const text = String(options?.text ?? "").trim();
    if (!text) {
      throw new Error("Text is required");
    }

    return this.#applyMutatingOp(docId, [
      "add-text",
      "--page",
      String(options?.page ?? 1),
      "--x",
      String(options?.x ?? 72),
      "--y",
      String(options?.y ?? 72),
      "--text",
      text,
      "--font-size",
      String(options?.fontSize ?? 14),
      "--font-family",
      String(options?.fontFamily ?? "helvetica"),
      "--color",
      String(options?.color ?? "#111111")
    ].concat(
      options?.bold ? ["--bold"] : [],
      options?.italic ? ["--italic"] : [],
      options?.underline ? ["--underline"] : []
    ));
  }

  async addHighlight(docId, options) {
    return this.#applyMutatingOp(docId, [
      "highlight",
      "--page",
      String(options?.page ?? 1),
      "--x",
      String(options?.x ?? 72),
      "--y",
      String(options?.y ?? 72),
      "--width",
      String(options?.width ?? 180),
      "--height",
      String(options?.height ?? 30),
      "--color",
      String(options?.color ?? "#ffe16b"),
      "--opacity",
      String(options?.opacity ?? 0.35)
    ]);
  }

  async addSignature(docId, options) {
    const imageBase64 = String(options?.imageBase64 ?? "").trim();
    if (!imageBase64) {
      throw new Error("Signature image is required");
    }

    return this.#applyMutatingOp(docId, [
      "add-signature",
      "--page",
      String(options?.page ?? 1),
      "--x",
      String(options?.x ?? 72),
      "--y",
      String(options?.y ?? 72),
      "--width",
      String(options?.width ?? 220),
      "--height",
      String(options?.height ?? 72),
      "--image-base64",
      imageBase64
    ]);
  }

  async fillFormFields(docId, values) {
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error("Form values must be an object");
    }

    return this.#applyMutatingOp(docId, [
      "fill-form-fields",
      "--values-json",
      JSON.stringify(values)
    ]);
  }

  async extractPages(docId, pagesSpec, targetFileName) {
    const sourceDoc = await this.getDocOrThrow(docId);
    this.#assertDocEditable(sourceDoc, "Extract pages into a new PDF before signing, or sign the derived PDF afterwards.");
    const outputPath = path.join(sourceDoc.workspaceDir, `extract-${Date.now()}.pdf`);

    await runPdfScript([
      "extract-pages",
      "--input",
      sourceDoc.pdfPath,
      "--output",
      outputPath,
      "--pages",
      String(pagesSpec)
    ]);

    const outputBuffer = await fs.readFile(outputPath);
    const created = await this.createDocFromUpload({
      filename: targetFileName || `${sourceDoc.filename.replace(/\.pdf$/i, "")}-extract.pdf`,
      buffer: outputBuffer
    });

    return created;
  }

  async mergeDocuments(docIds, targetFileName) {
    if (!Array.isArray(docIds) || docIds.length < 2) {
      throw new Error("Provide at least two document ids to merge");
    }

    const docs = await Promise.all(docIds.map((docId) => this.getDocOrThrow(docId)));
    for (const doc of docs) {
      this.#assertDocEditable(doc, "Signed PDFs cannot be merged into a new working document.");
    }
    const outputPath = path.join(this.rootDir, `merge-${Date.now()}.pdf`);

    const args = ["merge", "--output", outputPath, "--inputs", ...docs.map((doc) => doc.pdfPath)];
    await runPdfScript(args);

    const outputBuffer = await fs.readFile(outputPath);
    const created = await this.createDocFromUpload({
      filename: targetFileName || "merged.pdf",
      buffer: outputBuffer
    });

    return created;
  }

  setCodexThreadId(docId, threadId) {
    const doc = this.docs.get(docId);
    if (!doc) {
      return;
    }
    doc.codexThreadId = threadId;
    doc.updatedAt = Date.now();
  }

  async listWorkspaceFiles(docId) {
    const doc = await this.getDocOrThrow(docId);
    const files = [];

    async function walk(currentDir) {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolutePath);
          continue;
        }

        const stat = await fs.stat(absolutePath);
        const relativePath = path.relative(doc.workspaceDir, absolutePath).split(path.sep).join("/");

        files.push({
          path: relativePath,
          size: stat.size,
          modifiedAt: new Date(stat.mtimeMs).toISOString(),
          modifiedAtMs: stat.mtimeMs,
          isPdf: relativePath.toLowerCase().endsWith(".pdf")
        });
      }
    }

    await walk(doc.workspaceDir);

    return files
      .filter((file) => !["current.pdf", "input.txt"].includes(file.path))
      .sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
  }

  async snapshotWorkspace(docId) {
    const files = await this.listWorkspaceFiles(docId);
    const snapshot = new Map();
    for (const file of files) {
      snapshot.set(file.path, `${file.size}:${file.modifiedAtMs}`);
    }
    return snapshot;
  }

  async listUpdatedWorkspaceFiles(docId, baselineSnapshot) {
    const files = await this.listWorkspaceFiles(docId);
    return files.filter((file) => baselineSnapshot.get(file.path) !== `${file.size}:${file.modifiedAtMs}`);
  }

  async resolveWorkspaceFile(docId, relativePath) {
    const doc = await this.getDocOrThrow(docId);
    if (!relativePath || typeof relativePath !== "string") {
      throw new Error("Missing file path");
    }

    const absolutePath = path.resolve(doc.workspaceDir, relativePath);
    if (!absolutePath.startsWith(doc.workspaceDir + path.sep)) {
      throw new Error("Invalid file path");
    }

    if (!(await fileExists(absolutePath))) {
      throw new Error("File not found");
    }

    return absolutePath;
  }

  async promoteWorkspacePdf(docId, relativePath) {
    const doc = await this.getDocOrThrow(docId);
    this.#assertDocEditable(doc, "Signed PDFs cannot be replaced from workspace exports.");
    const source = await this.resolveWorkspaceFile(docId, relativePath);
    if (!source.toLowerCase().endsWith(".pdf")) {
      throw new Error("Only PDF files can be promoted");
    }

    const currentBuffer = await fs.readFile(doc.pdfPath);
    await fs.copyFile(source, doc.pdfPath);
    this.#pushUndoSnapshot(doc, currentBuffer);
    await this.#refreshDocMetadata(doc);
    await this.extractText(docId, null);

    return this.#toPublicDoc(doc);
  }

  async signDocument(docId, options) {
    const doc = await this.getDocOrThrow(docId);
    const certificateBuffer = options?.certificateBuffer;
    if (!certificateBuffer || !certificateBuffer.length) {
      throw new Error("A .p12 or .pfx certificate is required");
    }

    const currentBuffer = await fs.readFile(doc.pdfPath);
    const outputPath = path.join(doc.workspaceDir, `signed-${Date.now()}.pdf`);
    const certExt = String(options?.certificateName || "").toLowerCase().endsWith(".pfx") ? ".pfx" : ".p12";
    const certificatePath = path.join(doc.workspaceDir, `signing-${Date.now()}${certExt}`);

    await fs.writeFile(certificatePath, certificateBuffer);

    try {
      const args = [
        "sign-pkcs12",
        "--input",
        doc.pdfPath,
        "--output",
        outputPath,
        "--pfx",
        certificatePath,
        "--password",
        String(options?.password ?? ""),
        "--page",
        String(options?.page ?? 1),
        "--x",
        String(options?.x ?? 72),
        "--y",
        String(options?.y ?? 72),
        "--width",
        String(options?.width ?? 220),
        "--height",
        String(options?.height ?? 72),
        "--doc-mdp-permissions",
        String(options?.docMdpPermissions ?? "fill_forms"),
        "--appearance-mode",
        String(options?.appearanceMode ?? "type")
      ];

      if (options?.fieldName) {
        args.push("--field-name", String(options.fieldName));
      }
      if (options?.name) {
        args.push("--name", String(options.name));
      }
      if (options?.reason) {
        args.push("--reason", String(options.reason));
      }
      if (options?.location) {
        args.push("--location", String(options.location));
      }
      if (options?.contactInfo) {
        args.push("--contact-info", String(options.contactInfo));
      }
      if (options?.timestampUrl) {
        args.push("--timestamp-url", String(options.timestampUrl));
      }
      if (options?.certify) {
        args.push("--certify");
      }
      if (options?.appearanceText) {
        args.push("--appearance-text", String(options.appearanceText));
      }
      if (options?.appearanceImageBase64) {
        args.push("--appearance-image-base64", String(options.appearanceImageBase64));
      }

      await runPdfScript(args, 240_000);
      await fs.rename(outputPath, doc.pdfPath);
      this.#pushUndoSnapshot(doc, currentBuffer);
      await this.#refreshDocMetadata(doc);
      await this.extractText(doc.id, null);

      return this.#toPublicDoc(doc);
    } finally {
      await fs.rm(certificatePath, { force: true }).catch(() => {});
      await fs.rm(outputPath, { force: true }).catch(() => {});
    }
  }

  async undoLastChange(docId) {
    const doc = await this.getDocOrThrow(docId);
    if (!doc.undoStack.length) {
      throw new Error("Nothing to undo");
    }

    const currentBuffer = await fs.readFile(doc.pdfPath);
    const previousBuffer = doc.undoStack.pop();
    this.#pushHistoryEntry(doc.redoStack, currentBuffer);
    await fs.writeFile(doc.pdfPath, previousBuffer);
    await this.#refreshDocMetadata(doc);
    await this.extractText(docId, null);

    return this.#toPublicDoc(doc);
  }

  async redoLastChange(docId) {
    const doc = await this.getDocOrThrow(docId);
    if (!doc.redoStack.length) {
      throw new Error("Nothing to redo");
    }

    const currentBuffer = await fs.readFile(doc.pdfPath);
    const nextBuffer = doc.redoStack.pop();
    this.#pushHistoryEntry(doc.undoStack, currentBuffer);
    await fs.writeFile(doc.pdfPath, nextBuffer);
    await this.#refreshDocMetadata(doc);
    await this.extractText(docId, null);

    return this.#toPublicDoc(doc);
  }

  async cleanupAll() {
    await fs.rm(this.rootDir, { recursive: true, force: true });
    await fs.mkdir(this.rootDir, { recursive: true });
    this.docs.clear();
  }

  async #applyMutatingOp(docId, opArgs) {
    const doc = await this.getDocOrThrow(docId);
    this.#assertDocEditable(doc, "This PDF already contains digital signatures. Create or sign a new revision instead of editing the signed document.");
    const outputPath = path.join(doc.workspaceDir, `next-${Date.now()}.pdf`);
    const currentBuffer = await fs.readFile(doc.pdfPath);

    const args = [
      opArgs[0],
      "--input",
      doc.pdfPath,
      "--output",
      outputPath,
      ...opArgs.slice(1)
    ];

    await runPdfScript(args);
    await fs.rename(outputPath, doc.pdfPath);
    this.#pushUndoSnapshot(doc, currentBuffer);
    await this.#refreshDocMetadata(doc);
    await this.extractText(doc.id, null);

    return this.#toPublicDoc(doc);
  }

  #pushUndoSnapshot(doc, buffer) {
    this.#pushHistoryEntry(doc.undoStack, buffer);
    doc.redoStack = [];
  }

  #pushHistoryEntry(stack, buffer) {
    stack.push(Buffer.from(buffer));
    if (stack.length > MAX_HISTORY_ENTRIES) {
      stack.shift();
    }
  }

  async #refreshDocMetadata(doc) {
    const stat = await fs.stat(doc.pdfPath);
    const inspected = await runPdfScript(["inspect", "--input", doc.pdfPath]);

    doc.pageCount = Number(inspected.pageCount ?? doc.pageCount);
    doc.pageSizes = normalizePageSizes(inspected.pageSizes);
    doc.forms = normalizeFormFields(inspected.forms);
    doc.signatures = normalizeSignatureSummaries(inspected.signatures);
    doc.sizeBytes = stat.size;
    doc.updatedAt = Date.now();
  }

  #assertDocEditable(doc, signedMessage) {
    if (Array.isArray(doc.signatures) && doc.signatures.length) {
      throw new Error(signedMessage);
    }
  }

  #toPublicDoc(doc) {
    return {
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
      hasSignatures: doc.signatures.length > 0,
      canUndo: doc.undoStack.length > 0,
      canRedo: doc.redoStack.length > 0
    };
  }
}
