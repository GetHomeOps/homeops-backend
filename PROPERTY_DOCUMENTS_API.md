# Property Documents API – Frontend Integration Guide

Use this summary to wire the frontend to the property documents backend endpoints.

## Base URL

All endpoints are under `/propertyDocuments`. The API base URL depends on your environment (e.g. `http://localhost:3000` or your deployed backend URL).

**Authentication:** All endpoints use `authenticateJWT`. Send the JWT in the `Authorization` header:

```
Authorization: Bearer <token>
```

---

## Endpoints

### 1. Create a property document

**`POST /propertyDocuments`**

**Request body (JSON):**

```json
{
  "property_id": 1,
  "document_name": "AC Maintenance Receipt 2024",
  "document_date": "2024-06-15",
  "document_key": "documents/123/1709123456-abc12345.pdf",
  "document_type": "receipt",
  "system_key": "ac"
}
```

| Field           | Type   | Required | Description                                                |
|----------------|--------|----------|------------------------------------------------------------|
| `property_id`  | number | ✓        | Internal property ID                                       |
| `document_name`| string | ✓        | Display name of the document                               |
| `document_date`| string | ✓        | Date in `YYYY-MM-DD` format                                |
| `document_key` | string | ✓        | S3 object key from `POST /documents/upload` response        |
| `document_type`| string | ✓        | Type of document (e.g. `receipt`, `manual`, `warranty`)    |
| `system_key`   | string | ✓        | System key (e.g. `heating`, `ac`, `plumbing`)              |

**Response (201):**

```json
{
  "document": {
    "id": 1,
    "property_id": 1,
    "document_name": "AC Maintenance Receipt 2024",
    "document_date": "2024-06-15",
    "document_key": "documents/123/1709123456-abc12345.pdf",
    "document_type": "receipt",
    "system_key": "ac",
    "created_at": "2024-06-15T12:00:00.000Z",
    "updated_at": "2024-06-15T12:00:00.000Z"
  }
}
```

**Typical flow:**  
1. Upload file via `POST /documents/upload` to get `{ document: { key, url } }`.  
2. Call this endpoint with `document_key` set to the returned `key`.

---

### 2. Get all documents for a property

**`GET /propertyDocuments/property/:propertyId`**

**Path parameter:** `propertyId` — internal property ID (number).

**Response (200):**

```json
{
  "documents": [
    {
      "id": 1,
      "property_id": 1,
      "document_name": "AC Maintenance Receipt 2024",
      "document_date": "2024-06-15",
      "document_key": "documents/123/1709123456-abc12345.pdf",
      "document_type": "receipt",
      "system_key": "ac",
      "created_at": "2024-06-15T12:00:00.000Z",
      "updated_at": "2024-06-15T12:00:00.000Z"
    }
  ]
}
```

Use `document_key` to get a presigned URL: `GET /documents/presigned-preview?key=<document_key>`.

Documents are ordered by `document_date` descending, then `document_name`.

---

### 3. Get a single document

**`GET /propertyDocuments/:id`**

**Path parameter:** `id` — document ID (number).

**Response (200):**

```json
{
  "document": {
    "id": 1,
    "property_id": 1,
    "document_name": "AC Maintenance Receipt 2024",
    "document_date": "2024-06-15",
    "document_key": "documents/123/1709123456-abc12345.pdf",
    "document_type": "receipt",
    "system_key": "ac",
    "created_at": "2024-06-15T12:00:00.000Z",
    "updated_at": "2024-06-15T12:00:00.000Z"
  }
}
```

Use `document_key` to get a presigned URL: `GET /documents/presigned-preview?key=<document_key>`.

---

### 4. Delete a document

**`DELETE /propertyDocuments/:id`**

**Path parameter:** `id` — document ID (number).

**Response (200):**

```json
{
  "deleted": 1
}
```

---

## Error responses

All errors follow this shape:

```json
{
  "error": {
    "message": "Error description",
    "status": 404
  }
}
```

| Status | Meaning                                                                 |
|--------|-------------------------------------------------------------------------|
| 400    | Bad request — missing/invalid fields or validation error               |
| 401    | Unauthorized — missing or invalid JWT                                  |
| 404    | Not found — document or property not found                             |
| 500    | Server error                                                            |

---

## Example usage (fetch)

```javascript
const API_BASE = "http://localhost:3000"; // or your backend URL

// Create
const createDocument = async (data) => {
  const res = await fetch(`${API_BASE}/propertyDocuments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  return res.json();
};

// List by property
const getDocumentsByProperty = async (propertyId) => {
  const res = await fetch(`${API_BASE}/propertyDocuments/property/${propertyId}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const { documents } = await res.json();
  return documents;
};

// Get one
const getDocument = async (id) => {
  const res = await fetch(`${API_BASE}/propertyDocuments/${id}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const { document } = await res.json();
  return document;
};

// Delete
const deleteDocument = async (id) => {
  const res = await fetch(`${API_BASE}/propertyDocuments/${id}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` },
  });
  return res.json();
};

// Get presigned URL for preview/open (use document_key from document payload)
const getPresignedUrl = async (documentKey) => {
  const res = await fetch(
    `${API_BASE}/documents/presigned-preview?key=${encodeURIComponent(documentKey)}`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );
  const { url } = await res.json();
  return url;
};
```

---

## End-to-end document flow

1. **Upload file** → `POST /documents/upload` (multipart/form-data with `file` field).
2. **Backend returns** `{ document: { key, url } }`.
3. **Create property document** → `POST /propertyDocuments` with `document_key` set to the returned `key`, plus metadata (`property_id`, `document_name`, `document_date`, `document_type`, `system_key`).
4. **Preview / open in new tab** → Frontend calls `GET /documents/presigned-preview?key=<document_key>` to get a temporary presigned URL; use the returned `url` for preview or opening in a new tab.
