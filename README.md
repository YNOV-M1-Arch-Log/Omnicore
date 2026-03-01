# Omnicore

Omnicore is an omnichannel backend platform built as a microservices monorepo. A single API gateway handles authentication, authorization, and proxying to three downstream services: auth, user, and product.

## Services

| Service | Port | Responsibility |
|---|---|---|
| `omnicore-gateway` | 3000 | Single entry point — JWT validation, RBAC, reverse proxy |
| `omnicore-product` | 3001 | Products, countries, country-scoped stock & pricing, image uploads (Cloudinary) |
| `omnicore-user` | 3002 | User profiles, addresses, preferences, roles, audit logs |
| `omnicore-auth` | 3003 | Signup, login, JWT issuance, refresh tokens |

All services share a single PostgreSQL database with an identical Prisma schema.

---

## Running with Docker Compose

### Prerequisites

- [Docker](https://www.docker.com/) with Compose v2
- Each service must have its own `.env` file (see [Per-service .env files](#per-service-env-files))

### 1. Configure the root `.env`

```bash
cp env-exemple .env
```

Edit `.env` and set a secure postgres password:

```env
POSTGRES_USER=omnicore
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=omnicore

# Change GATEWAY_PORT if port 3000 is already in use on your machine
GATEWAY_PORT=3000
PRODUCT_PORT=3001
USER_PORT=3002
AUTH_PORT=3003
```

### 2. Build and start all services

```bash
docker compose up --build
```

On subsequent runs (no code changes):

```bash
docker compose up
```

All 5 containers will start in order: `db` → `auth + user + product` (parallel) → `gateway`. The stack is ready when all containers show `(healthy)`.

### 3. Run database migrations (first time only)

In a separate terminal, apply the Prisma migrations to create all tables:

```bash
docker exec omnicore-omnicore-auth-1    npx prisma migrate deploy
docker exec omnicore-omnicore-user-1    npx prisma migrate deploy
docker exec omnicore-omnicore-product-1 npx prisma migrate deploy
```

> The gateway has no migrations to run.

### 4. Seed roles and create the first admin (first time only)

```bash
# Seed the 3 core roles: Principal, Tenant, User
docker exec omnicore-omnicore-gateway-1 node scripts/seed-roles.js

# Sign up your first user via the API
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin@1234","username":"admin"}'

# Assign the Principal (global admin) role to that user
docker exec omnicore-omnicore-gateway-1 node scripts/bootstrap-principal.js admin@example.com
```

The Principal user can now log in and use all API endpoints.

### 5. Verify everything is running

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{"status":"OK","service":"omnicore-gateway"}
```

---

## Stopping the stack

```bash
docker compose down          # stop containers, keep the database volume
docker compose down -v       # stop containers AND wipe the database
```

---

## Per-service `.env` files

Each service reads its own `.env` for app-level configuration. The docker-compose only overrides `DATABASE_URL` and service URLs. You must create these files before running `docker compose up`.

### `omnicore-auth/.env`

```env
PORT=3003
DATABASE_URL=postgresql://omnicore:your_password@localhost:5432/omnicore
JWT_SECRET=your_jwt_secret_min_32_chars
JWT_EXPIRES_IN=15m
REFRESH_EXPIRES_IN=30d
```

### `omnicore-user/.env`

```env
PORT=3002
DATABASE_URL=postgresql://omnicore:your_password@localhost:5432/omnicore
```

### `omnicore-product/.env`

```env
PORT=3001
DATABASE_URL=postgresql://omnicore:your_password@localhost:5432/omnicore
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

> Cloudinary is only required for product image upload endpoints. Other product endpoints work without it.

### `omnicore-gateway/.env`

```env
PORT=3000
DATABASE_URL=postgresql://omnicore:your_password@localhost:5432/omnicore
JWT_SECRET=your_jwt_secret_min_32_chars   # must match omnicore-auth
JWT_EXPIRATION=15m
AUTH_SERVICE_URL=http://localhost:3003
PRODUCT_SERVICE_URL=http://localhost:3001
USER_SERVICE_URL=http://localhost:3002
```

> `JWT_SECRET` must be identical in both `omnicore-auth` and `omnicore-gateway`.

---

## API Overview

All requests go through the gateway at `http://localhost:3000`. The gateway enforces authentication and role-based access control (RBAC) before proxying to downstream services.

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/signup` | No | Register a new account |
| `POST` | `/auth/login` | No | Login, returns `accessToken` + `refreshToken` |
| `POST` | `/auth/refresh` | No | Exchange refresh token for a new access token |
| `POST` | `/auth/validate` | No | Validate a JWT and return its payload |
| `POST` | `/auth/logout` | Yes | Invalidate refresh token |

Pass the access token as a Bearer header on all authenticated requests:

```
Authorization: Bearer <accessToken>
```

### Roles

RBAC is enforced by the gateway. Three roles exist:

| Role | Permissions |
|---|---|
| **Principal** | Global admin — full CRUD on everything, manage roles |
| **Tenant** | Country-scoped — manage products and stock for their assigned country |
| **User** | Read-only — browse products, countries, stock |

Role management (Principal only):

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/roles` | List all roles |
| `GET` | `/api/roles/users/:userId` | Get roles assigned to a user |
| `POST` | `/api/roles/assign` | Assign a role: `{"userId":"...","roleName":"Tenant"}` |
| `POST` | `/api/roles/revoke` | Revoke a role: `{"userId":"...","roleName":"Tenant"}` |

### Countries

| Method | Path | Roles |
|---|---|---|
| `POST` | `/api/countries` | Principal |
| `GET` | `/api/countries` | All |
| `GET` | `/api/countries/:id` | All |
| `PUT` | `/api/countries/:id` | Principal |
| `DELETE` | `/api/countries/:id` | Principal |

```json
{ "name": "France", "countryCode": "FR", "currency": "EUR", "isActive": true }
```

### Products

| Method | Path | Roles |
|---|---|---|
| `POST` | `/api/products` | Principal, Tenant |
| `POST` | `/api/products/upload` | Principal, Tenant |
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

```json
{ "name": "Blue T-Shirt", "description": "100% cotton" }
```

Image upload: `POST /api/products/:id/images/upload` uses multipart field `image` (singular). `POST /api/products/upload` uses multipart field `images` (plural, up to 5 files).

### Country-Products (stock & pricing per country)

| Method | Path | Roles |
|---|---|---|
| `POST` | `/api/country-products` | Principal, Tenant |
| `GET` | `/api/country-products` | All |
| `GET` | `/api/country-products/country/:countryId` | All |
| `GET` | `/api/country-products/:id` | All |
| `PUT` | `/api/country-products/:id` | Principal, Tenant |
| `PATCH` | `/api/country-products/:id/stock` | Principal, Tenant |
| `DELETE` | `/api/country-products/:id` | Principal, Tenant |

```json
{ "productId": "...", "countryId": "...", "price": 29.99, "currency": "EUR", "quantity": 100, "isAvailable": true }
```

### Users

| Method | Path | Roles |
|---|---|---|
| `POST` | `/api/users` | Principal |
| `GET` | `/api/users` | Principal, Tenant |
| `GET` | `/api/users/:id` | Principal, Tenant |
| `PUT` | `/api/users/:id` | Principal |
| `DELETE` | `/api/users/:id` | Principal |

```json
{ "auth_user_id": "...", "country_id": "...", "first_name": "Jane", "last_name": "Doe", "phone_number": "+33600000001", "status": "active" }
```

### User Addresses, Preferences, Audit Logs

All follow standard CRUD at `/api/user-addresses`, `/api/user-preferences`, `/api/user-audit-logs`. Addresses and preferences are accessible to all roles (self-service). Audit logs are Principal only.

---

## Architecture

```
Client
  │
  ▼
omnicore-gateway :3000
  ├── JWT validation (local, no auth service call)
  ├── RBAC (deny-by-default, src/permissions/rbac.js)
  ├── Country-scope enforcement (Tenant users)
  │
  ├── /auth/*          → omnicore-auth    :3003
  ├── /api/users*      → omnicore-user    :3002  (strips /api prefix)
  ├── /api/user-*      → omnicore-user    :3002  (strips /api prefix)
  ├── /api/countries*  → omnicore-product :3001
  ├── /api/products*   → omnicore-product :3001
  ├── /api/country-*   → omnicore-product :3001
  └── /api/roles       → gateway-local (DB)

All services ──► PostgreSQL :5432 (shared DB, isolated schemas via Prisma)
```

---

## Development (without Docker)

Run each service locally with its own `.env` pointing to a local postgres instance:

```bash
cd omnicore-auth && npm run dev    # :3003
cd omnicore-user && npm run dev    # :3002
cd omnicore-product && npm run dev # :3001
cd omnicore-gateway && npm run dev # :3000
```

Run migrations locally:

```bash
cd omnicore-<service> && npm run prisma:migrate
```

---

## Repository

This repo uses Git submodules. After cloning:

```bash
git submodule update --init --recursive
```

Each service has a `dev` branch (active development) and a `main` branch (stable/production).
