# Deployment

## 1. Prerequisites

| Tool | Required for |
|------|-------------|
| Docker + Docker Compose | Running all services |
| Node.js 22.x + npm 10.x | Local development |
| Stripe CLI | Local payment webhook testing |
| Newman | Running the integration test suite |

---

## 2. Docker Compose — Full Stack

### First Run

```bash
# 1. Clone with submodules
git clone --recurse-submodules <repo-url>
cd Omnicore

# 2. Create root .env from example
cp env-exemple .env
# Edit .env: set a strong POSTGRES_PASSWORD, JWT_SECRET, INTERNAL_SERVICE_TOKEN

# 3. Create per-service .env files
cp omnicore-auth/env_exemple     omnicore-auth/.env
cp omnicore-user/env_exemple     omnicore-user/.env
cp omnicore-gateway/.env.example omnicore-gateway/.env
cp omnicore-product/.env.example omnicore-product/.env
# Edit each with the same JWT_SECRET and INTERNAL_SERVICE_TOKEN as root .env

# 4. Build and start
docker compose up --build
```

Migrations and seeding run automatically via the `omnicore-db` container.

### Bootstrap Principal User

After all containers are healthy:
```bash
# 1. Sign up the admin user via the API
curl -X POST http://localhost:3010/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin@1234"}'

# 2. Promote to Principal
docker exec omnicore-omnicore-gateway-1 \
  node scripts/bootstrap-principal.js admin@example.com

# 3. Log in again to get a token with the Principal role
```

### Subsequent Runs

```bash
docker compose up          # start
docker compose down        # stop and remove containers
docker compose logs -f     # stream logs
docker compose restart omnicore-payment  # force-recreate one service (e.g. after .env change)
```

> If you update secrets in a service `.env` file, a plain `docker compose restart` does **not** reload `env_file` values. Use `--force-recreate`:
> ```bash
> docker compose up -d --force-recreate omnicore-payment
> ```

---

## 3. Container Architecture

```
Host machine
├── localhost:3010  ──► omnicore-gateway (only published port)
│
Docker network: omnicore-network
├── db                  postgres:15-alpine
├── omnicore-db         migration runner (exits)
├── omnicore-gateway    :3000 (internal)
├── omnicore-auth       :3003 (internal only)
├── omnicore-user       :3002 (internal only)
├── omnicore-product    :3001 (internal only)
├── omnicore-order      :3004 (internal only)
├── omnicore-payment    :3005 (internal only)
└── omnicore-smtp       :3006 (internal only)
```

All service images use **multi-stage builds** (builder → runner):
- Builder: installs all deps, generates Prisma client, prunes dev deps
- Runner: non-root `nodejs` user, production `node_modules` only

---

## 4. Environment Variables

### Root `.env` (docker-compose only)

| Variable | Description |
|----------|-------------|
| `POSTGRES_USER` | PostgreSQL user |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `POSTGRES_DB` | PostgreSQL database name |
| `JWT_SECRET` | Must match across all services |
| `INTERNAL_SERVICE_TOKEN` | Shared inter-service token (generate with `openssl rand -hex 32`) |
| `GATEWAY_PORT` | Host port for gateway (default `3000`, set to `3010` if 3000 is taken) |

### Per-Service `.env`

**All services:**
| Variable | Description |
|----------|-------------|
| `PORT` | Service port |
| `DATABASE_URL` | Overridden by docker-compose to point to `db` container |
| `JWT_SECRET` | Same value as root `.env` |
| `INTERNAL_SERVICE_TOKEN` | Same value as root `.env` |

**omnicore-gateway only:**
| Variable | Description |
|----------|-------------|
| `AUTH_SERVICE_URL` | `http://omnicore-auth:3003` |
| `USER_SERVICE_URL` | `http://omnicore-user:3002` |
| `PRODUCT_SERVICE_URL` | `http://omnicore-product:3001` |
| `ORDER_SERVICE_URL` | `http://omnicore-order:3004` |
| `PAYMENT_SERVICE_URL` | `http://omnicore-payment:3005` |

**omnicore-product only:**
| Variable | Description |
|----------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account (image CDN) |
| `CLOUDINARY_API_KEY` | Cloudinary key |
| `CLOUDINARY_API_SECRET` | Cloudinary secret |

**omnicore-payment only:**
| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | `sk_test_...` from Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from `stripe listen` output |
| `ORDER_SERVICE_URL` | `http://omnicore-order:3004` |

**omnicore-smtp only:**
| Variable | Description |
|----------|-------------|
| `PUBLIC_API_KEY` | Mailjet public key |
| `PRIVATE_API_KEY` | Mailjet private key |

---

## 5. CI/CD Pipeline

Defined in `.github/workflows/ci.yml`.

### Triggers
- Push to `main`
- Pull request to `main`
- Weekly schedule (Monday 06:00 UTC)

### Jobs

**quality**
1. Checkout repo + all submodules recursively
2. `npm ci` (uses lockfile — reproducible install)
3. `npm run prisma:generate -w @omnicore/db`
4. `npm run lint` (gateway, product)
5. `npm test` (gateway, product)
6. `npm audit`

**docker** (depends on quality)
1. Build all 7 service images
2. Docker Scout CVE scan (requires `DOCKER_USERNAME` / `DOCKER_PASSWORD` secrets)

### Required GitHub Secrets

| Secret | Value |
|--------|-------|
| `DOCKER_USERNAME` | Docker Hub username (`andre1999`) |
| `DOCKER_PASSWORD` | Docker Hub access token |

---

## 6. Local Stripe Webhook Testing

```bash
# Terminal 1 — keep running during tests
stripe listen --forward-to http://localhost:3010/webhooks/stripe
# Copy the whsec_... secret printed and add to omnicore-payment/.env as STRIPE_WEBHOOK_SECRET

# Terminal 2 — run the full Newman suite
npx newman run omnicore-postman-collection.json \
  -e newman-env.json \
  --delay-request 500
```

Expected: **0 failures** across 71 requests.

---

## 7. Submodule Workflow

```bash
# Work on a service
git -C omnicore-<service> checkout dev
# ... make changes, commit ...

# Merge to main and update root pointer
git -C omnicore-<service> checkout main
git -C omnicore-<service> merge dev
git -C omnicore-<service> push origin main

# Update root repo
git add omnicore-<service>
git commit -m "chore: update omnicore-<service> submodule ref"
git push origin main
```

When pulling a repo that is behind:
```bash
git pull --no-rebase   # prefer merge over rebase for submodule pointer conflicts
git submodule update --init --recursive
```
