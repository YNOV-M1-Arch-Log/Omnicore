# Architecture

## 1. System Overview

Omnicore follows the **API Gateway + Microservices** pattern. A single gateway is the only entry point for clients. Each downstream service owns a specific business domain. All services share one PostgreSQL database managed through a single Prisma schema.

---

## 2. Service Map

| Service | Directory | Internal Port | Domain |
|---------|-----------|--------------|--------|
| API Gateway | `omnicore-gateway/` | 3000 (host: **3010**) | Routing, auth, RBAC |
| Auth Service | `omnicore-auth/` | 3003 | Signup, login, JWT, sessions |
| User Service | `omnicore-user/` | 3002 | User profiles, addresses, preferences |
| Product Service | `omnicore-product/` | 3001 | Products, countries, stock/pricing |
| Order Service | `omnicore-order/` | 3004 | Order lifecycle |
| Payment Service | `omnicore-payment/` | 3005 | Stripe integration, webhooks |
| SMTP Service | `omnicore-smtp/` | 3006 | Transactional email (Mailjet) |
| DB Runner | `omnicore-db/` | — | Migrations + seed (one-shot) |

> Internal services are reachable **only within the Docker network**. Only the gateway port is published to the host.

---

## 3. System Architecture Diagram

```mermaid
graph TB
    Client(["Client<br/>(Browser / Mobile / Postman)"])

    subgraph Docker Network — omnicore-network
        GW["API Gateway<br/>:3010 → :3000<br/>JWT · RBAC · Rate limit · Proxy"]

        subgraph Services
            AUTH["omnicore-auth<br/>:3003<br/>ESM"]
            USER["omnicore-user<br/>:3002<br/>ESM"]
            PROD["omnicore-product<br/>:3001<br/>CJS"]
            ORDER["omnicore-order<br/>:3004<br/>CJS"]
            PAY["omnicore-payment<br/>:3005<br/>CJS"]
            SMTP["omnicore-smtp<br/>:3006<br/>ESM"]
        end

        DB[("PostgreSQL :5432<br/>Single shared DB")]
        DBRUN["omnicore-db<br/>Migration runner<br/>(exits after seed)"]
    end

    Stripe(["Stripe API<br/>(external)"])

    Client -->|"HTTPS :3010"| GW

    GW -->|"/auth/*"| AUTH
    GW -->|"/api/users · addresses · preferences · audit-logs"| USER
    GW -->|"/api/products · countries · country-products"| PROD
    GW -->|"/api/orders"| ORDER
    GW -->|"/api/payments"| PAY
    GW -->|"X-Internal-Service-Token"| AUTH
    GW -->|"X-Internal-Service-Token"| USER
    GW -->|"X-Internal-Service-Token"| PROD
    GW -->|"X-Internal-Service-Token"| ORDER
    GW -->|"X-Internal-Service-Token"| PAY

    AUTH -->|"POST /mail/send"| SMTP
    ORDER -->|"PATCH /api/country-products/:id/stock"| PROD
    PAY -->|"GET · PATCH /api/orders/:id"| ORDER

    Stripe -->|"Webhook POST /webhooks/stripe"| GW

    AUTH --> DB
    USER --> DB
    PROD --> DB
    ORDER --> DB
    PAY --> DB
    GW --> DB
    DBRUN --> DB
```

---

## 4. Request Flow — Authenticated API Call

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as Gateway
    participant SVC as Downstream Service
    participant DB as PostgreSQL

    C->>GW: HTTP request + Authorization: Bearer <JWT>
    GW->>GW: 1. Generate correlationId
    GW->>GW: 2. Verify JWT locally (no auth service call)
    GW->>GW: 3. RBAC check (deny-by-default regex)
    GW->>GW: 4. Country-scope check (Tenant only)
    GW->>GW: 5. Inject X-Internal-Service-Token header
    GW->>SVC: Proxied request
    SVC->>SVC: Validate X-Internal-Service-Token
    SVC->>DB: Prisma query
    DB-->>SVC: Result
    SVC-->>GW: JSON response
    GW-->>C: Forward response
```

---

## 5. Request Flow — Payment (Stripe Webhook)

```mermaid
sequenceDiagram
    participant Stripe as Stripe
    participant GW as Gateway
    participant PAY as omnicore-payment
    participant ORDER as omnicore-order
    participant DB as PostgreSQL

    Stripe->>GW: POST /webhooks/stripe (raw body)
    note over GW: No JWT check on /webhooks/*
    GW->>PAY: Forward raw Buffer (no JSON parse)
    PAY->>PAY: Verify Stripe signature (HMAC)
    PAY->>DB: Update payment status
    PAY->>ORDER: PATCH /api/orders/:id/status → confirmed
    ORDER->>DB: Update order status
    ORDER-->>PAY: 200 OK
    PAY-->>GW: { received: true }
    GW-->>Stripe: 200 OK
```

---

## 6. Internal Architecture Pattern (CJS services)

All CJS services (gateway, product, order, payment) follow the same layered pattern:

```
HTTP Request
    │
    ▼
routes/          → express.Router, validation rules (express-validator)
    │
    ▼
middlewares/     → auth, correlation, pino-http, error-handler
    │
    ▼
controllers/     → req/res handling only, delegates to service
    │
    ▼
services/        → business logic, orchestration
    │
    ▼
repositories/    → Prisma calls only, no business logic
    │
    ▼
@omnicore/db     → shared Prisma client singleton
    │
    ▼
PostgreSQL
```

---

## 7. Startup Dependency Order

```mermaid
graph LR
    DB[(postgres)] --> DBRUN[omnicore-db<br/>migrate + seed]
    DBRUN --> AUTH[omnicore-auth]
    DBRUN --> USER[omnicore-user]
    DBRUN --> PROD[omnicore-product]
    PROD --> ORDER[omnicore-order]
    DBRUN --> ORDER
    DBRUN --> PAY[omnicore-payment]
    ORDER --> PAY
    AUTH --> GW[omnicore-gateway]
    USER --> GW
    PROD --> GW
    ORDER --> GW
    PAY --> GW
    SMTP[omnicore-smtp] --> AUTH
```

`omnicore-db` runs migrations and seeds, then exits. All services wait for `service_completed_successfully` before starting.
