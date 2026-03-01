# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This is an **npm workspace monorepo**. A shared `@omnicore/db` package owns the single Prisma schema, all migrations, and the seed script. Each service imports the Prisma client from `@omnicore/db` — no service maintains its own schema.

| Package / Service | Dir | Internal Port | Docker host port | Module system |
|-------------------|-----|--------------|-----------------|---------------|
| Shared DB package | `omnicore-db/` | — | — | CommonJS |
| API Gateway | `omnicore-gateway/` | 3000 | **3010** | CommonJS |
| Product Service | `omnicore-product/` | 3001 | 3001 | CommonJS |
| User Service | `omnicore-user/` | 3002 | 3002 | ESM |
| Auth Service | `omnicore-auth/` | 3003 | 3003 | ESM |
| Order Service | `omnicore-order/` | 3004 | 3004 | CommonJS |

> Gateway is mapped to **host port 3010** in Docker because port 3000 may be taken by other local services.

`npm install` must be run from the **root** (not inside a service dir) to keep the single `package-lock.json` up to date.

## Common Commands (per service)

```bash
npm run dev              # Start with nodemon (hot reload)
npm start                # Production start
npm test                 # Run tests (gateway, product)
npm run test:unit        # Tests with coverage (gateway, product)
npm run test:watch       # Tests in watch mode (gateway, product)
npm run lint             # ESLint check (gateway, product)
npm run lint:fix         # Auto-fix ESLint (gateway, product)
```

**`@omnicore/db` scripts (run from `omnicore-db/` or with `--workspace`):**
```bash
npm run prisma:migrate          --workspace=@omnicore/db   # Create a new migration
npm run prisma:migrate:deploy   --workspace=@omnicore/db   # Apply migrations
npm run prisma:generate         --workspace=@omnicore/db   # Regenerate Prisma Client
npm run prisma:studio           --workspace=@omnicore/db   # Open Prisma Studio GUI
npm run seed                    --workspace=@omnicore/db   # Seed roles
```

**Gateway-only scripts:**
```bash
npm run seed:roles            # Seed roles (wrapper around @omnicore/db seed — kept for convenience)
npm run bootstrap:principal   # Create the first Principal user: node scripts/bootstrap-principal.js <email>
npm run security:audit        # Audit dependencies
```

**Product-only scripts:**
```bash
npm run test:integration      # Newman/Postman integration tests against live server
```

## Running with Docker Compose

A `docker-compose.yml` at the root starts **all 7 containers** (postgres db + omnicore-db migration runner + 5 services) together.

```bash
cp env-exemple .env        # edit POSTGRES_PASSWORD; set GATEWAY_PORT if 3000 is taken
docker compose up --build  # first run (builds all images)
docker compose up          # subsequent runs
docker compose down        # stop and remove containers
```

The root `.env` only needs postgres credentials and optional port overrides. Each service reads its own `.env` file for app-level config (`JWT_SECRET`, `CLOUDINARY_*`, etc.). The docker-compose `environment:` block overrides `DATABASE_URL` and service URLs to use Docker service names.

### First-time setup after `docker compose up`

**Migrations and seeding now run automatically.** The `omnicore-db` container runs `prisma migrate deploy && node prisma/seed.js` and then exits. All other services wait for it to complete (`condition: service_completed_successfully`) before starting.

After all containers are healthy, the only manual step is bootstrapping the first Principal:

```bash
# 1. Sign up a user via /auth/signup (gateway must be healthy first)

# 2. Bootstrap the Principal role for that user
docker exec omnicore-omnicore-gateway-1 node scripts/bootstrap-principal.js admin@example.com
```

## Environment Variables (per-service dev)

Each service requires a `.env` file. Copy the example file:
- `omnicore-auth/` and `omnicore-user/`: copy `env_exemple` → `.env`
- `omnicore-gateway/` and `omnicore-product/`: copy `.env.example` → `.env`

Gateway-specific vars (beyond the common `PORT`, `DATABASE_URL`):
```
JWT_SECRET=...
JWT_EXPIRATION=1h
AUTH_SERVICE_URL=http://localhost:3003
PRODUCT_SERVICE_URL=http://localhost:3001
USER_SERVICE_URL=http://localhost:3002
```

Product-specific optional vars (only for file-upload image features):
```
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

## Architecture Overview

The **Gateway** (`omnicore-gateway`) is the single entry point for all client requests. It:
1. Applies security middlewares (Helmet, CORS, rate limiting, correlation ID, Pino logging)
2. Validates JWT tokens locally (`src/middlewares/authenticate.js`) — does **not** call the auth service
3. Enforces RBAC via deny-by-default regex pattern matching (`src/permissions/rbac.js`)
4. Enforces country-level isolation for Tenant users (`src/middlewares/country-scope.js`) — see country-scope note below
5. Reverse-proxies the request to the appropriate downstream service via `http-proxy-middleware`

Gateway proxy routes and their targets:
- `/auth/*` → `omnicore-auth` (signup/login/refresh public; logout authenticated)
- `/api/users`, `/api/user-roles`, `/api/user-addresses`, `/api/user-preferences`, `/api/user-audit-logs` → `omnicore-user`
- `/api/countries`, `/api/products`, `/api/country-products` → `omnicore-product`
- `/api/roles` — gateway-local (managed in gateway DB, Principal only)

**Critical proxy detail — user service path rewrite**: The user service mounts routes at `/users`, `/user-roles`, etc. (no `/api` prefix). The gateway's `user.proxy.js` strips the `/api` prefix before forwarding:
```js
req.url = req.originalUrl.replace(/^\/api/, '');
```
The product service mounts at `/api/...` so no rewrite is needed there.

**Important**: `express.json()` is intentionally NOT applied globally in the gateway — only on gateway-local routes — so that proxied routes receive the raw body.

**Country-scope middleware** (`src/middlewares/country-scope.js`) — two important behaviours:
- For `PUT/PATCH/DELETE` on country-scoped routes, it GETs the resource from the product service to verify `countryId` matches the Tenant's country. It fetches the **base resource URL** (`/api/country-products/:id`), stripping any trailing action suffix (e.g. `/stock`) — otherwise `GET /:id/stock` would return 404 and the check would silently pass.
- `extractResourceId` scans **all** path segments for a UUID (not just the last one), so paths like `PATCH /:id/stock` still resolve the correct resource ID.

### RBAC Roles

Three roles are seeded by `npm run seed:roles`:
- **Principal** — global admin, full CRUD, can assign/revoke roles
- **Tenant** — country-scoped admin, manages products and stock for their assigned country only
- **User** — read-only, can browse products, countries, and stock

Role definitions live in `omnicore-gateway/src/permissions/rbac.js`. It is **deny-by-default** — any route/method not listed returns 403. Adding a new protected route requires adding an entry there.

Full RBAC coverage — **verified by 86-check automated test** (all passing):

| Resource | Anonymous | Principal | Tenant | User |
|----------|-----------|-----------|--------|------|
| `GET /health` | ✅ 200 | — | — | — |
| Any API (no token) | ✅ 401 | — | — | — |
| Countries — GET | ✅ 401 | ✅ 200 | ✅ 200 | ✅ 200 |
| Countries — POST/PUT/DELETE | ✅ 401 | ✅ 2xx | ✅ 403 | ✅ 403 |
| Products — GET | ✅ 401 | ✅ 200 | ✅ 200 | ✅ 200 |
| Products — POST/PUT/PATCH | ✅ 401 | ✅ 2xx | ✅ 2xx | ✅ 403 |
| Products — DELETE | ✅ 401 | ✅ 204 | ✅ 403 | ✅ 403 |
| CountryProducts — GET | ✅ 401 | ✅ 200 | ✅ 200 | ✅ 200 |
| CountryProducts — write (own country) | ✅ 401 | ✅ 2xx | ✅ 2xx | ✅ 403 |
| CountryProducts — write (other country) | ✅ 401 | ✅ 2xx | ✅ 403 | ✅ 403 |
| `PATCH /:id/stock` (own country) | ✅ 401 | ✅ 200 | ✅ 200 | ✅ 403 |
| `PATCH /:id/stock` (other country) | ✅ 401 | ✅ 200 | ✅ 403 | ✅ 403 |
| Users — GET | ✅ 401 | ✅ 200 | ✅ 200 | ✅ 403 |
| Users — POST/PUT/DELETE | ✅ 401 | ✅ 2xx | ✅ 403 | ✅ 403 |
| User-roles / Roles / Audit-logs | ✅ 401 | ✅ 2xx | ✅ 403 | ✅ 403 |
| Roles assign/revoke | ✅ 401 | ✅ 201 | ✅ 403 | ✅ 403 |
| User-addresses / Preferences — GET | ✅ 401 | ✅ 200 | ✅ 200 | ✅ 200 |

**Tenant country-scoping requires**: the Tenant's `auth_users.country_id` column must be populated. The gateway reads `countryId` from the JWT (set at login time from `auth_users`). If it's null, all country-scoped write routes return 403.

### Shared Prisma Schema (`@omnicore/db`)

There is **one** schema file: `omnicore-db/prisma/schema.prisma`. It covers all models for the entire platform (Country, Product, CountryProduct, ProductImage, Role, AuthUser, AuthSession, User, UserRole, UserAddress, UserPreference, UserAuditLog, Order, OrderItem).

- To add a model: edit `omnicore-db/prisma/schema.prisma`, then run `npm run prisma:migrate --workspace=@omnicore/db -- --name <migration_name>`
- To regenerate the client (after a schema change): `npm run prisma:generate --workspace=@omnicore/db`
- All services automatically use the generated client via `require('@omnicore/db')` / `import … from '@omnicore/db'`
- The per-service `prisma/` directories are now obsolete stubs — do not run `prisma generate` inside individual services

### Data Model Key Points

- **Product** has no `price`, `sku`, or `stock` fields — those live on **CountryProduct** (per-country pricing). Creating a product only requires `name` and optionally `description`.
- **User.id** is the same UUID as **AuthUser.id** — auth service creates the auth record, user service creates the profile linked by the same ID via `auth_user_id`.
- User service uses **snake_case** field names (`auth_user_id`, `country_id`, `first_name`, `is_primary`, etc.).
- Product/gateway services use **camelCase** field names (`countryCode`, `isPrimary`, etc.).

### Image Upload Field Names

- `POST /api/products/upload` — multipart, field `images` (plural, up to 5 files) + product fields
- `POST /api/products/:id/images/upload` — multipart, field `image` (singular, one file)
- `POST /api/products/:id/images` — JSON body `{url, isPrimary}` (URL-based, no file upload)

### Internal Architecture Pattern (product, gateway)

```
routes/ → middlewares/ → controllers/ → services/ → repositories/ → Prisma
```

`omnicore-auth` and `omnicore-user` use a similar layered pattern but with ESM (`import`/`export`) syntax.

### API Documentation (Swagger)

Both gateway and product service expose Swagger UI:

| Service | URL |
|---------|-----|
| Gateway (all routes) | `http://localhost:3010/api-docs/` |
| Product service | `http://localhost:3001/api-docs/` |

**Gateway Swagger setup** (`omnicore-gateway`):
- Packages: `swagger-jsdoc` + `swagger-ui-express` (in `dependencies`)
- Spec definition: `src/config/swagger.js` — OpenAPI 3.0, all schemas (Auth, Role, User, Product, Country, CountryProduct…)
- JSDoc `@swagger` comments on all route files in `src/routes/`
- Mounted in `app.js` with `helmet({ contentSecurityPolicy: false })` — CSP must be disabled for Swagger UI assets to load
- `apis: ['./src/routes/*.js']` in the swagger-jsdoc options

### Service-Specific Notes

- **omnicore-product**: Swagger UI at `/api-docs`. Uses `express-validator` for validation. Cloudinary for product image CDN (configured and working).
- **omnicore-auth**: Issues JWT tokens with `sub` (user ID), `email`, `roles[]`, and `countryId` claims. Refresh tokens stored as `AuthSession` records. `dotenv` must be in **`dependencies`** (not devDependencies) — required at runtime in Docker. The `countryId` field in the JWT is set from the `auth_users.country_id` column — update it directly in the DB or via the auth-users API to ensure Tenant country-scoping works.
- **omnicore-user**: Uses ESM. All request/response fields are snake_case.
- **omnicore-gateway**: After running `seed:roles`, run `bootstrap-principal.js <email>` to assign the Principal role. The user must have already signed up via `/auth/signup`. Login again after bootstrapping to get a token with the Principal role.

## Test Accounts (Docker dev environment)

Three accounts exist in the shared database for testing. All reach the gateway at `http://localhost:3010`.

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Principal | `admin@omnicore.dev` | `Admin@1234` | Full access to everything |
| Tenant | `tenant@omnicore.dev` | `Tenant@1234` | Country-scoped to France (`7ac6fdca-…`) |
| User | `regular@omnicore.dev` | `Regular@123` | Read-only; has a profile in the user service |

The Tenant's `country_id` is set in `auth_users`. The User's profile was created via `POST /api/users` (by the Principal). If the database is reset, re-run first-time setup and recreate these accounts.

## Submodule Workflow

Each service has a `dev` and `main` branch. The typical flow:

```bash
# Work on dev, then merge to main and update root repo pointer:
git -C omnicore-<service> checkout main
git -C omnicore-<service> merge dev
git -C omnicore-<service> push origin main
git -C omnicore-<service> checkout dev

git add omnicore-<service>
git commit -m "chore: update omnicore-<service> submodule ref"
git push origin main
```

When the root repo is behind `origin/main`, always pull with merge (`git pull --no-rebase`) and resolve submodule pointer conflicts manually by choosing the most recent `main` commit of the affected submodule.
