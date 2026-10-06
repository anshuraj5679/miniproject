# Vision OCR Service

Standalone Node.js OCR microservice using Google Vision API with a built-in upload UI.

## Setup

1. Open terminal in `SAFE/vision-ocr-service`.
2. Install dependencies:

```bash
npm install
```

3. Create `.env` from `.env.example` and set your credential file path.

## Run

```bash
npm start
```

Service starts on `http://localhost:8080` by default.

## API

- `POST /api/ocr`
  - `multipart/form-data`
  - file field name: `file`
  - supports: `application/pdf`, `image/*`

Response includes:

- `fullText`
- `lines`
- `fields` (invoiceNumber, dueDate, totalAmount, gstin, vendorName, poNumber)

## Notes

- Keep credentials in a file and pass path via `GOOGLE_APPLICATION_CREDENTIALS`.
- Do not commit secret files or `.env`.
