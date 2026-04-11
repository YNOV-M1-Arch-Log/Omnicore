# Technical Stack

## 1. Runtime & Language

| Technology | Version | Scope |
|------------|---------|-------|
| Node.js | 22.x LTS | All services |
| JavaScript | ES2022 | All services |
| PostgreSQL | 15 (Alpine) | Shared database |

> **No TypeScript** — identified as a gap vs current industry standard. Planned for a future migration.

---

## 2. Per-Layer Stack Decisions

### Web Framework
| Choice | Library | Version |
|--------|---------|---------|
| HTTP server | Express | 5.x |
| Security headers | Helmet | latest |
| CORS | cors | latest |
| Rate limiting | express-rate-limit | latest |

### ORM & Database
| Choice | Library | Notes |
|--------|---------|-------|
| ORM | Prisma | 6.x |
| Schema location | `omnicore-db/prisma/schema.prisma` | Single source of truth |
| Client import | `require('@omnicore/db')` (CJS) / `import from '@omnicore/db'` (ESM) | Via npm workspace symlink |

### Authentication
| Choice | Library | Notes |
|--------|---------|-------|
| Token format | JWT | Verified locally at gateway — no auth service roundtrip |
| Library | jsonwebtoken | 9.x |
| Claims | `sub`, `email`, `roles[]`, `countryId` | |
| Sessions | Prisma `AuthSession` model | Refresh tokens stored in DB |

### Logging
| Choice | Library | Notes |
|--------|---------|-------|
| Logger | Pino | 8.x — structured JSON output |
| HTTP logging | pino-http | All services |
| Correlation | Custom middleware | UUID per request, attached to all log entries |

### Validation
| Service | Library | Note |
|---------|---------|------|
| omnicore-product | express-validator | Middleware chain |
| omnicore-gateway | express-validator | Middleware chain |
| omnicore-order | express-validator | Middleware chain |
| omnicore-auth | Manual / Joi | ESM service — inconsistency to resolve |
| omnicore-user | Manual | ESM service — inconsistency to resolve |

> **Known gap**: validation library is inconsistent across services. Target: `express-validator` everywhere once ESM services are migrated to CJS.

### API Documentation
| Service | Tool | URL |
|---------|------|-----|
| omnicore-gateway | swagger-jsdoc + swagger-ui-express | `/api-docs` |
| omnicore-product | swagger-jsdoc + swagger-ui-express | `/api-docs` |
| omnicore-payment | swagger-jsdoc + swagger-ui-express | `/api-docs` |

### Payment
| Choice | Library | Notes |
|--------|---------|-------|
| Provider | Stripe | stripe SDK |
| Webhook verification | HMAC signature | Raw body preserved before `express.json()` |

### Email
| Choice | Library | Notes |
|--------|---------|-------|
| Provider | Mailjet | `node-mailjet` |
| Usage | Internal only | `omnicore-smtp` called by `omnicore-auth`, not exposed through gateway |

### Image Upload
| Choice | Library | Notes |
|--------|---------|-------|
| CDN | Cloudinary | Product images only (`omnicore-product`) |
| Upload middleware | Multer | Memory storage → Cloudinary stream |

---

## 3. Module System

| Services | Module System | Reason |
|----------|---------------|--------|
| gateway, product, order, payment, db | **CommonJS** | npm workspace symlinks, Jest compatibility |
| auth, user, smtp | **ESM** | Written before CJS decision was standardised |

> **Known gap**: mixed module systems cause inconsistent error shapes and make shared utility code harder. Target: full CJS.

---

## 4. Monorepo Structure

```
omnicore/                        ← root (npm workspaces)
├── package.json                 ← workspace declaration
├── package-lock.json            ← single lockfile (never run npm install inside a service)
├── docker-compose.yml
├── .github/workflows/ci.yml     ← centralized CI/CD
├── omnicore-db/                 ← @omnicore/db — shared Prisma schema + migrations + seed
├── omnicore-gateway/
├── omnicore-auth/
├── omnicore-user/
├── omnicore-product/
├── omnicore-order/
├── omnicore-payment/
└── omnicore-smtp/
```

Each service directory is also an **independent git submodule** with its own `main`/`dev` branch cycle.

---

## 5. Testing Strategy

| Level | Tool | Scope |
|-------|------|-------|
| Unit | Jest | Controllers, services, middlewares |
| Integration | Newman (Postman) | End-to-end, all 71 endpoints |
| Coverage | Jest `--coverage` | gateway, product |
| Security audit | `npm audit` + Docker Scout | CI pipeline |

---

## 6. CI/CD Pipeline

Single GitHub Actions workflow at `.github/workflows/ci.yml`:

```
Push / PR to main
       │
       ▼
  quality job
  ├── npm ci
  ├── prisma generate
  ├── npm run lint (gateway, product)
  ├── npm test (gateway, product)
  └── npm audit
       │
       ▼
  docker job
  ├── Build all 7 images
  └── Docker Scout CVE scan
```

Weekly schedule: every Monday 06:00 UTC.
