# Security

## 1. Security Layers Overview

```
Client Request
      │
      ▼
[ Rate Limiting ]          express-rate-limit — global per IP
      │
      ▼
[ Security Headers ]       Helmet — CSP, HSTS, X-Frame-Options, etc.
      │
      ▼
[ CORS ]                   Configured per environment
      │
      ▼
[ JWT Verification ]       Local — gateway reads public key, no auth service call
      │
      ▼
[ RBAC ]                   Deny-by-default regex matching on path + method
      │
      ▼
[ Country Scope ]          Tenant writes scoped to their assigned country
      │
      ▼
[ Internal Token ]         X-Internal-Service-Token injected by gateway
      │
      ▼
[ Service Validation ]     Each service re-validates the internal token
      │
      ▼
[ Input Validation ]       express-validator on all write endpoints (CJS services)
```

---

## 2. Authentication — JWT

The gateway validates JWT tokens **locally** without calling `omnicore-auth`. This removes a network round-trip on every request and prevents auth becoming a single point of failure.

### JWT Claims
```json
{
  "sub": "uuid",
  "email": "user@example.com",
  "roles": ["Tenant"],
  "countryId": "uuid-or-null",
  "iat": 1234567890,
  "exp": 1234567890
}
```

### Token Lifecycle
```
POST /auth/signup   → creates AuthUser
POST /auth/login    → returns { accessToken, refreshToken }
POST /auth/refresh  → validates refreshToken from AuthSession, returns new pair
POST /auth/logout   → deletes AuthSession record
```

Access token expiry: `JWT_EXPIRATION` env var (default `1h`).  
Refresh tokens are stored as `AuthSession` records in PostgreSQL.

---

## 3. RBAC — Role-Based Access Control

Defined in `omnicore-gateway/src/permissions/rbac.js`. **Deny-by-default** — any route not explicitly listed returns `403`.

### Roles

| Role | Scope | Capabilities |
|------|-------|-------------|
| **Principal** | Global | Full CRUD on everything, role assignment/revocation |
| **Tenant** | Country-scoped | Manage products and stock for their assigned country only |
| **User** | Own data | Read products/countries, manage own orders/addresses/preferences |

### Country Scoping (Tenant)

For `PUT / PATCH / DELETE` on country-scoped resources, the gateway middleware:
1. Extracts the resource UUID from any path segment (handles `PATCH /:id/stock`)
2. Fetches the resource from the product service to read its `countryId`
3. Compares against `countryId` from the Tenant's JWT
4. Returns `403` if they don't match

A Tenant with `countryId = null` in the JWT cannot perform any write — all country-scoped routes return `403`.

### Permission Matrix (summary)

| Resource | Principal | Tenant | User |
|----------|-----------|--------|------|
| Countries — read | ✅ | ✅ | ✅ |
| Countries — write | ✅ | ❌ | ❌ |
| Products — read | ✅ | ✅ | ✅ |
| Products — write | ✅ | ✅ own country | ❌ |
| Products — delete | ✅ | ❌ | ❌ |
| Stock — update | ✅ | ✅ own country | ❌ |
| Users — read | ✅ | ✅ | ❌ |
| Users — write | ✅ | ❌ | ❌ |
| Orders — read/create | ✅ | ✅ | ✅ |
| Orders — status update | ✅ | ✅ | ❌ |
| Payments — create intent | ✅ | ✅ | ✅ |
| Payments — read | ✅ | ✅ | ❌ |
| Payments — refund | ✅ | ❌ | ❌ |
| Roles — assign/revoke | ✅ | ❌ | ❌ |

---

## 4. Inter-Service Security

All service-to-service calls are authenticated using a **shared secret token**.

### Flow
```
Gateway                       Downstream Service
  │                                  │
  ├─ Remove any client-sent          │
  │  X-Internal-Service-Token        │
  │                                  │
  ├─ Inject server-side token ──────►│
  │  X-Internal-Service-Token        │
  │  (from INTERNAL_SERVICE_TOKEN    │
  │   env var)                       │
  │                                  ├─ Validate token
  │                                  ├─ Match? → continue
  │                                  └─ No match? → 401
```

The gateway **removes** any client-sent `X-Internal-Service-Token` before injecting its own. This prevents clients from impersonating internal services.

### Dual Validation (product, order)

Endpoints that can be called both by the gateway (with internal token) and by other services (which have a JWT) use dual validation:

```
if X-Internal-Service-Token present:
    validate token → accept or 401
else if Authorization: Bearer <JWT> present:
    validate JWT → accept or 401
else:
    401
```

---

## 5. Docker Network Isolation

```yaml
# Internal services — not reachable from host
expose:
  - "3001"   # only within Docker network

# Only the gateway is published
ports:
  - "3010:3000"
```

This means developers and clients can only reach `localhost:3010`. Direct access to product, order, payment, auth, user, smtp ports from outside the Docker network is blocked.

---

## 6. Stripe Webhook Security

The payment webhook at `POST /webhooks/stripe` has no JWT requirement (Stripe cannot provide one). Instead:

1. `express.raw({ type: 'application/json' })` captures the raw Buffer **before** `express.json()` processes it — preserving the body exactly as Stripe sent it
2. `stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)` verifies the HMAC signature
3. If signature verification fails → `400 INVALID_SIGNATURE`

Never add `express.json()` middleware before the webhook route.

---

## 7. Environment Security

- Secrets (`JWT_SECRET`, `INTERNAL_SERVICE_TOKEN`, `STRIPE_SECRET_KEY`, Cloudinary keys, Mailjet keys) are **never** committed to git
- `.env` files are gitignored; `.env.example` / `env_exemple` are committed with placeholder values
- Docker Compose reads secrets from the root `.env` and per-service `.env` files — never hardcoded in `docker-compose.yml`
- `newman-env.json` (contains real Stripe test key) is gitignored via root `.gitignore`
