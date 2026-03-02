# Omnicore

Omnicore is an omnichannel backend platform built as a microservices monorepo. A single API gateway handles authentication, authorization, and proxying to five downstream services.

## Services

| Service | Internal port | Docker host port | Responsibility |
|---------|--------------|-----------------|----------------|
| `omnicore-gateway` | 3000 | **3010** | Single entry point — JWT validation, RBAC, reverse proxy |
| `omnicore-product` | 3001 | 3001 | Products, countries, country-scoped stock & pricing, image uploads (Cloudinary) |
| `omnicore-user` | 3002 | 3002 | User profiles, addresses, preferences, roles, audit logs |
| `omnicore-auth` | 3003 | 3003 | Signup, login, JWT issuance, refresh tokens |
| `omnicore-order` | 3004 | 3004 | Order lifecycle management, stock decrement on creation |
| `omnicore-payment` | 3005 | 3005 | Stripe payment intents, webhook processing, refunds |
| `omnicore-db` | — | — | Shared Prisma schema, migrations, and seed (runs once at startup) |

All services share a single PostgreSQL database managed by the `@omnicore/db` workspace package. The gateway is exposed on host port **3010** (port 3000 is often occupied locally).

---

## Running with Docker Compose

### Prerequisites

- [Docker](https://www.docker.com/) with Compose v2
- Each service must have its own `.env` file (see [Per-service `.env` files](#per-service-env-files))
- A [Stripe](https://stripe.com) account (free test mode) for payment features
- [Stripe CLI](https://stripe.com/docs/stripe-cli) for local webhook testing

### 1. Configure the root `.env`

```bash
cp env-exemple .env
```

Edit `.env` and set credentials:

```env
POSTGRES_USER=omnicore
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=omnicore

# Port overrides (change if these ports are already in use)
GATEWAY_PORT=3010
PRODUCT_PORT=3001
USER_PORT=3002
AUTH_PORT=3003
ORDER_PORT=3004
PAYMENT_PORT=3005
```

### 2. Build and start all services

```bash
docker compose up --build
```

On subsequent runs (no code changes):

```bash
docker compose up
```

All 7 containers start in dependency order: `db` → `omnicore-db` (migrations + seed, exits after success) → `auth + user + product` (parallel) → `order + payment` → `gateway`. The stack is ready when all remaining containers show `(healthy)`.

**Migrations and seeding run automatically.** The `omnicore-db` container applies all Prisma migrations and seeds the three core roles, then exits. You do not need to run migrations manually.

### 3. Bootstrap the first admin (first time only)

```bash
# 1. Sign up a user via the gateway
curl -X POST http://localhost:3010/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin@1234","username":"admin"}'

# 2. Assign the Principal (global admin) role
docker exec omnicore-omnicore-gateway-1 node scripts/bootstrap-principal.js admin@example.com
```

Log in again after bootstrapping to get a token with the `Principal` role.

### 4. Verify the stack

```bash
curl http://localhost:3010/health
```

Expected:

```json
{"status":"OK","service":"omnicore-gateway"}
```

### 5. (Optional) Set up Stripe webhook forwarding

To test payment flows locally, start the Stripe CLI listener in a separate terminal:

```bash
stripe listen --forward-to http://localhost:3010/webhooks/stripe
```

Copy the printed `whsec_…` value into `omnicore-payment/.env` as `STRIPE_WEBHOOK_SECRET`, then restart the payment container:

```bash
docker compose up -d --no-build omnicore-payment
```

---

## Stopping the stack

```bash
docker compose down          # stop containers, keep the database volume
docker compose down -v       # stop containers AND wipe the database
```

---

## Per-service `.env` files

Each service reads its own `.env` for app-level configuration. The `docker-compose.yml` overrides `DATABASE_URL` and inter-service URLs automatically. Create these files before running `docker compose up`.

### `omnicore-auth/.env`

```bash
cp omnicore-auth/env_exemple omnicore-auth/.env
```

```env
PORT=3003
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
JWT_SECRET=change_me
JWT_EXPIRES_IN=15m
REFRESH_EXPIRES_IN=30d
```

### `omnicore-user/.env`

```bash
cp omnicore-user/env_exemple omnicore-user/.env
```

```env
PORT=3002
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
```

### `omnicore-product/.env`

```bash
cp omnicore-product/.env.example omnicore-product/.env
```

```env
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

> Cloudinary is only required for image upload endpoints. All other product endpoints work without it.

### `omnicore-gateway/.env`

```bash
cp omnicore-gateway/.env.example omnicore-gateway/.env
```

```env
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
JWT_SECRET=change_me   # must match omnicore-auth JWT_SECRET exactly
JWT_EXPIRATION=15m
AUTH_SERVICE_URL=http://localhost:3003
PRODUCT_SERVICE_URL=http://localhost:3001
USER_SERVICE_URL=http://localhost:3002
ORDER_SERVICE_URL=http://localhost:3004
PAYMENT_SERVICE_URL=http://localhost:3005
```

> `JWT_SECRET` must be identical in both `omnicore-auth` and `omnicore-gateway`.

### `omnicore-order/.env`

```bash
cp omnicore-order/.env.example omnicore-order/.env
```

```env
PORT=3004
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
PRODUCT_SERVICE_URL=http://localhost:3001
```

### `omnicore-payment/.env`

```bash
cp omnicore-payment/.env.example omnicore-payment/.env
```

```env
PORT=3005
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here   # from: stripe listen --print-secret
ORDER_SERVICE_URL=http://localhost:3004
```

---

## API Overview

All requests go through the gateway at `http://localhost:3010`. The gateway enforces authentication and role-based access control (RBAC) before proxying to the appropriate service.

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/signup` | No | Register a new account |
| `POST` | `/auth/login` | No | Login — returns `accessToken` + `refreshToken` |
| `POST` | `/auth/refresh` | No | Exchange refresh token for a new access token |
| `POST` | `/auth/logout` | Yes | Invalidate the current refresh token |

Pass the access token as a Bearer header on all authenticated requests:

```
Authorization: Bearer <accessToken>
```

### Roles

Three roles are seeded automatically:

| Role | Permissions |
|------|-------------|
| **Principal** | Global admin — full CRUD on everything, manage roles |
| **Tenant** | Country-scoped — manage products and stock for their assigned country |
| **User** | Read-only on most resources; can place orders, manage their own addresses/preferences |

Role management (Principal only):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/roles` | List all roles |
| `GET` | `/api/roles/users/:userId` | Get roles assigned to a user |
| `POST` | `/api/roles/assign` | Assign a role: `{"userId":"…","roleName":"Tenant"}` |
| `POST` | `/api/roles/revoke` | Revoke a role |

### Countries

| Method | Path | Roles |
|--------|------|-------|
| `POST` | `/api/countries` | Principal |
| `GET` | `/api/countries` | All |
| `GET` | `/api/countries/:id` | All |
| `PUT` | `/api/countries/:id` | Principal |
| `DELETE` | `/api/countries/:id` | Principal |

### Products

| Method | Path | Roles |
|--------|------|-------|
| `POST` | `/api/products` | Principal, Tenant |
| `GET` | `/api/products` | All |
| `GET` | `/api/products/:id` | All |
| `PUT` | `/api/products/:id` | Principal, Tenant |
| `PATCH` | `/api/products/:id` | Principal, Tenant |
| `DELETE` | `/api/products/:id` | Principal |
| `POST` | `/api/products/:id/images` | Principal, Tenant |
| `POST` | `/api/products/:id/images/upload` | Principal, Tenant |
| `PUT` | `/api/products/:id/images/:imageId/primary` | Principal, Tenant |
| `DELETE` | `/api/products/images/:imageId` | Principal |

> Products have no `price`, `stock`, or `sku` — those are per-country and live on CountryProduct.

### Country-Products (stock & pricing per country)

| Method | Path | Roles |
|--------|------|-------|
| `POST` | `/api/country-products` | Principal, Tenant |
| `GET` | `/api/country-products` | All |
| `GET` | `/api/country-products/:id` | All |
| `PUT` | `/api/country-products/:id` | Principal, Tenant |
| `PATCH` | `/api/country-products/:id/stock` | Principal, Tenant |
| `DELETE` | `/api/country-products/:id` | Principal, Tenant |

### Users

| Method | Path | Roles |
|--------|------|-------|
| `POST` | `/api/users` | Principal |
| `GET` | `/api/users` | Principal, Tenant |
| `GET` | `/api/users/:id` | Principal, Tenant |
| `PUT` | `/api/users/:id` | Principal |
| `DELETE` | `/api/users/:id` | Principal |

User addresses and preferences (`/api/user-addresses`, `/api/user-preferences`) are accessible to all authenticated roles. Audit logs (`/api/user-audit-logs`) are Principal only.

### Orders

| Method | Path | Roles |
|--------|------|-------|
| `POST` | `/api/orders` | All |
| `GET` | `/api/orders` | All |
| `GET` | `/api/orders/:id` | All |
| `PATCH` | `/api/orders/:id/status` | Principal, Tenant |
| `DELETE` | `/api/orders/:id` | All |

Order creation auto-decrements stock in the product service. Cancellation restores stock. Status transitions: `pending → confirmed → shipped → delivered` (or `cancelled` from `pending`/`confirmed`).

### Payments

| Method | Path | Roles |
|--------|------|-------|
| `POST` | `/api/payments/intent` | All |
| `GET` | `/api/payments` | Principal, Tenant |
| `GET` | `/api/payments/:id` | Principal, Tenant |
| `GET` | `/api/payments/order/:orderId` | Principal, Tenant |
| `POST` | `/api/payments/:id/refund` | Principal |
| `POST` | `/webhooks/stripe` | No auth (Stripe only) |

Omit `amount` on refund for a full refund (order cancelled). Provide `amount < total` for a partial refund (order stays active).

---

## Architecture

```
Client
  │
  ▼
omnicore-gateway :3010
  ├── JWT validation (local — no auth service call)
  ├── RBAC (deny-by-default, src/permissions/rbac.js)
  ├── Country-scope enforcement (Tenant users)
  │
  ├── /webhooks/*       → omnicore-payment :3005  (no auth, raw body)
  ├── /auth/*           → omnicore-auth    :3003
  ├── /api/users*       → omnicore-user    :3002  (strips /api prefix)
  ├── /api/user-*       → omnicore-user    :3002  (strips /api prefix)
  ├── /api/countries*   → omnicore-product :3001
  ├── /api/products*    → omnicore-product :3001
  ├── /api/country-*    → omnicore-product :3001
  ├── /api/orders*      → omnicore-order   :3004
  ├── /api/payments*    → omnicore-payment :3005
  └── /api/roles        → gateway-local (DB)

All services ──► PostgreSQL :5432  (shared DB, single schema via @omnicore/db)

omnicore-payment ──► omnicore-order :3004  (internal — update order status after payment)
omnicore-order   ──► omnicore-product :3001 (internal — decrement/restore stock)
Stripe           ──► /webhooks/stripe  (external webhook, signature-verified)
```

---

## API Documentation (Swagger)

Both the gateway and each service expose a Swagger UI:

| Service | Swagger URL |
|---------|-------------|
| Gateway (all routes) | http://localhost:3010/api-docs |
| Product service | http://localhost:3001/api-docs |
| Order service | http://localhost:3004/api-docs |
| Payment service | http://localhost:3005/api-docs |

---

## Development (without Docker)

Run services locally with individual `.env` files pointing to a local PostgreSQL instance. Start from the root to keep the single `node_modules` tree:

```bash
npm install                        # install all workspace dependencies from root

cd omnicore-auth    && npm run dev  # :3003
cd omnicore-user    && npm run dev  # :3002
cd omnicore-product && npm run dev  # :3001
cd omnicore-order   && npm run dev  # :3004
cd omnicore-payment && npm run dev  # :3005
cd omnicore-gateway && npm run dev  # :3000
```

Run migrations and seed (once, from root):

```bash
npm run prisma:migrate  --workspace=@omnicore/db -- --name init
npm run seed            --workspace=@omnicore/db
```

---

## Repository

This repo uses Git submodules. After cloning:

```bash
git clone --recurse-submodules https://github.com/YNOV-M1-Arch-Log/Omnicore.git
# or, after a plain clone:
git submodule update --init --recursive
```

Each service has a `dev` branch (active development) and a `main` branch (stable).
