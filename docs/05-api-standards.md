# API Standards

## 1. Base URL

All client requests go through the gateway:
```
http://localhost:3010
```

Swagger documentation:
- Gateway (all routes): `http://localhost:3010/api-docs`
- Product service: `http://localhost:3001/api-docs` *(only accessible inside Docker network)*
- Payment service: `http://localhost:3005/api-docs` *(only accessible inside Docker network)*

---

## 2. Authentication Header

All protected endpoints require:
```
Authorization: Bearer <accessToken>
```

Public endpoints (no token required):
- `GET /health`
- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /webhooks/stripe`

---

## 3. Correlation ID

Every request and response carries a correlation ID for distributed tracing:

```
Request header (optional, generated if absent):
X-Correlation-Id: 550e8400-e29b-41d4-a716-446655440000

Response header (always):
X-Correlation-Id: 550e8400-e29b-41d4-a716-446655440000
```

The same ID appears in all log entries for that request across every service that handled it.

---

## 4. Success Response Format

Success responses are not wrapped — they return the resource directly:

```json
// Single resource
{ "id": "uuid", "name": "...", "createdAt": "..." }

// Collection
[{ "id": "uuid", ... }, { "id": "uuid", ... }]

// Created resource
HTTP 201
{ "id": "uuid", ... }

// No content
HTTP 204
(empty body)
```

---

## 5. Error Response Format (CJS services)

All CJS services (gateway, product, order, payment) return errors in this canonical shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Record not found",
    "status": 404,
    "correlationId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Machine-readable, `SCREAMING_SNAKE_CASE` |
| `message` | string | Human-readable description |
| `status` | number | HTTP status code (mirrors response status) |
| `correlationId` | string | Links to the full request trace in logs |

> ESM services (auth, user) currently return `{ message, details? }` — standardisation to the CJS format is planned.

---

## 6. Error Code Reference

### Database Errors (Prisma)
| Code | HTTP | Trigger |
|------|------|---------|
| `ALREADY_EXISTS` | 409 | Unique constraint violation (P2002) |
| `NOT_FOUND` | 404 | Record not found (P2025) |
| `INVALID_REFERENCE` | 400 | Foreign key violation (P2003) |
| `RELATION_VIOLATION` | 400 | Relation constraint (P2014) |
| `VALIDATION_ERROR` | 400 | Query validation error (P2009) |
| `DATABASE_ERROR` | 500 | Other Prisma error |

### Request Errors
| Code | HTTP | Trigger |
|------|------|---------|
| `INVALID_JSON` | 400 | Malformed JSON body |
| `FILE_REQUIRED` | 400 | Missing file in multipart upload |
| `REQUEST_ERROR` | 4xx | Generic client error with `err.code` not set |

### Auth & Security
| Code | HTTP | Trigger |
|------|------|---------|
| `MISSING_SIGNATURE` | 400 | Stripe webhook missing `stripe-signature` header |
| `INVALID_SIGNATURE` | 400 | Stripe HMAC verification failed |
| `WEBHOOK_ERROR` | 500 | Unhandled webhook processing error |

### Generic
| Code | HTTP | Trigger |
|------|------|---------|
| `INTERNAL_ERROR` | 500 | Unhandled exception — details hidden from client, logged server-side |

> Controllers can set `err.code` before calling `next(err)` to emit a specific code. The error handler uses it directly if present.

---

## 7. Validation Error Format

Input validation failures (express-validator) return `422` with field-level details:

```json
HTTP 422
{
  "errors": [
    { "field": "email", "message": "must be a valid email address" },
    { "field": "price", "message": "must be a positive number" }
  ]
}
```

---

## 8. Route Conventions

| Pattern | Usage |
|---------|-------|
| `GET /api/resources` | List all |
| `POST /api/resources` | Create |
| `GET /api/resources/:id` | Get one |
| `PUT /api/resources/:id` | Full update |
| `PATCH /api/resources/:id` | Partial update |
| `DELETE /api/resources/:id` | Delete |
| `PATCH /api/resources/:id/action` | State transition (e.g. `/stock`, `/status`) |
| `POST /api/resources/:id/sub` | Create sub-resource |

All resource IDs are UUIDs v4.
