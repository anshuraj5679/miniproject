const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const vision = require("@google-cloud/vision");
require("dotenv").config();

const app = express();
const port = Number.parseInt(process.env.PORT || "8080", 10);
const maxFileSizeMb = Math.max(1, Number.parseInt(process.env.MAX_FILE_SIZE_MB || "20", 10));
const keyFilename = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();

if (!keyFilename) {
  throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS in .env");
}
if (!fs.existsSync(keyFilename)) {
  throw new Error(`Credential file not found: ${keyFilename}`);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const client = new vision.ImageAnnotatorClient({ keyFilename });

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
}

function parseAmount(raw) {
  const cleaned = String(raw || "")
    .replace(/[^0-9.,-]/g, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return null;
  const amount = Number.parseFloat(cleaned);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) return null;
  return Number(amount.toFixed(2));
}

function pushCandidate(candidates, value, score, source) {
  const v = cleanLine(value);
  if (!v) return;
  candidates.push({ value: v, score, source });
}

function bestCandidate(candidates) {
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.value.length - a.value.length;
  });
  return candidates[0].value;
}

function extractInvoiceNumber(text) {
  const candidates = [];
  const patterns = [
    { re: /\b(?:invoice(?:\s*\/\s*bill)?|tax invoice)\s*(?:no|number|#|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/gi, score: 100 },
    { re: /\binv(?:oice)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/gi, score: 90 },
    { re: /\b(INV[-/][A-Z0-9]{3,})\b/gi, score: 95 },
    { re: /\bbill\s*(?:no|number|#|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/gi, score: 70 },
    { re: /\border\s*(?:no|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{3,})/gi, score: 40 },
  ];

  for (const { re, score } of patterns) {
    for (const match of text.matchAll(re)) {
      const value = cleanLine(match[1]).replace(/[.,;:]+$/, "");
      if (!value) continue;
      const full = cleanLine(match[0]).toLowerCase();
      if (full.includes("po bill") || full.includes("purchase order")) continue;
      if (/^\d{15,}$/.test(value)) continue;
      const boostedScore = /^INV/i.test(value) ? score + 10 : score;
      pushCandidate(candidates, value, boostedScore, "invoice");
    }
  }
  return bestCandidate(candidates);
}

function extractInvoiceDate(text) {
  const patterns = [
    /\b(?:invoice\s*date|tax\s*invoice\s*date|bill\s*date|purchase\s*date|date\s*of\s*purchase|date)\s*[:#-]?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return cleanLine(m[1]);
  }
  return null;
}

function extractDueDate(text) {
  const m = text.match(
    /\b(?:due\s*date)\s*[:#-]?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})/i
  );
  return m?.[1] ? cleanLine(m[1]) : null;
}

function extractTotalAmount(text) {
  const candidates = [];
  const patterns = [
    { re: /\b(grand\s*total)\s*[:#-]?\s*(?:INR|Rs\.?|₹|\$)?\s*([0-9][0-9,]*\.?[0-9]{0,2})/gi, score: 100 },
    { re: /\b(total\s*amount|invoice\s*total|amount\s*payable|amount\s*due)\s*[:#-]?\s*(?:INR|Rs\.?|₹|\$)?\s*([0-9][0-9,]*\.?[0-9]{0,2})/gi, score: 90 },
    { re: /\b(total)\s*[:#-]?\s*(?:INR|Rs\.?|₹|\$)?\s*([0-9][0-9,]*\.?[0-9]{0,2})/gi, score: 60 },
  ];

  for (const { re, score } of patterns) {
    for (const match of text.matchAll(re)) {
      const label = (match[1] || "").toLowerCase();
      const amount = parseAmount(match[2]);
      if (amount === null) continue;
      let s = score;
      if (label.includes("grand")) s += 10;
      pushCandidate(candidates, String(amount), s, "amount");
    }
  }
  return bestCandidate(candidates);
}

function extractVendorName(lines) {
  const ignore = [
    "invoice",
    "tax invoice",
    "original for recipient",
    "bill to",
    "shipping to",
    "additional details",
    "gstin",
    "date",
    "total",
    "amount",
  ];

  for (const line of lines.slice(0, 18)) {
    const lowered = line.toLowerCase();
    if (ignore.some((token) => lowered.includes(token))) continue;
    if (line.length < 3 || line.length > 90) continue;
    if (/\d{4,}/.test(line)) continue;
    return line;
  }
  return null;
}

function extractProductName(lines) {
  const ignore = [
    "invoice",
    "tax invoice",
    "bill to",
    "shipping to",
    "gstin",
    "date",
    "total",
    "amount",
    "bank details",
    "account number",
    "ifsc",
    "po bill",
    "purchase order",
    "original for recipient",
  ];

  for (const line of lines) {
    const lowered = line.toLowerCase();
    if (ignore.some((token) => lowered.includes(token))) continue;
    if (line.length < 5 || line.length > 120) continue;
    if (/^\d+$/.test(line)) continue;
    if (/[₹$]|(?:\b(?:inr|rs\.?)\b)/i.test(line) && /\d/.test(line)) continue;
    if (/\b(?:qty|hsn|tax|discount)\b/i.test(line)) continue;
    if (/\b(?:machine|refrigerator|fridge|television|tv|laptop|mobile|phone|ac|air conditioner|tablet|monitor|printer|oven|microwave)\b/i.test(lowered)) {
      return line;
    }
  }
  return null;
}

function extractFields(fullText) {
  const text = String(fullText || "");
  const lines = toLines(text);
  const gstin = text.match(/\bGSTIN\s*[:#-]?\s*([0-9A-Z]{15})\b/i)?.[1] || null;
  const poNumber =
    text.match(/\b(?:PO\s*Bill\s*No|PO\s*No|Purchase\s*Order(?:\s*Number)?)\s*[:#-]?\s*([A-Z0-9-]+)/i)?.[1] ||
    null;

  return {
    invoiceNumber: extractInvoiceNumber(text),
    invoiceDate: extractInvoiceDate(text),
    dueDate: extractDueDate(text),
    totalAmount: extractTotalAmount(text),
    gstin,
    vendorName: extractVendorName(lines),
    productName: extractProductName(lines),
    poNumber,
  };
}

async function ocrPdf(buffer) {
  const [batchResponse] = await client.batchAnnotateFiles({
    requests: [
      {
        inputConfig: {
          mimeType: "application/pdf",
          content: buffer,
        },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      },
    ],
  });

  const fileResponse = batchResponse?.responses?.[0];
  const pageResponses = fileResponse?.responses || [];
  const fullText = pageResponses
    .map((page) => page?.fullTextAnnotation?.text || page?.textAnnotations?.[0]?.description || "")
    .join("\n")
    .trim();

  return {
    fullText,
    pages: Math.max(pageResponses.length, 1),
  };
}

async function ocrImage(buffer) {
  const [result] = await client.documentTextDetection({
    image: { content: buffer },
  });
  const fullText = (result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description || "").trim();
  return { fullText, pages: 1 };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Upload a file with form-data key: file" });
    }

    const mimeType = String(req.file.mimetype || "").toLowerCase();
    let output;

    if (mimeType === "application/pdf") {
      output = await ocrPdf(req.file.buffer);
    } else if (mimeType.startsWith("image/")) {
      output = await ocrImage(req.file.buffer);
    } else {
      return res.status(400).json({
        ok: false,
        error: "Only image/* and application/pdf are supported",
      });
    }

    const fullText = output.fullText || "";
    const lines = toLines(fullText);

    return res.json({
      ok: true,
      mimeType,
      pages: output.pages,
      fullText,
      lines,
      fields: extractFields(fullText),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OCR failed";
    return res.status(500).json({ ok: false, error: message });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      ok: false,
      error: `File too large. Max allowed size is ${maxFileSizeMb}MB.`,
    });
  }
  return res.status(500).json({ ok: false, error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Vision OCR service running on http://localhost:${port}`);
});
