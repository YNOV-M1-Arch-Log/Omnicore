# Data Model

## 1. Overview

There is **one** Prisma schema for the entire platform, located at `omnicore-db/prisma/schema.prisma`.  
No service maintains its own schema or runs its own migrations.

All models map to a single PostgreSQL database (`zaraomni_db` in production Docker).

---

## 2. Entity Relationship Diagram

```mermaid
erDiagram
    Country {
        uuid id PK
        string name
        string countryCode UK
        string currency
        boolean isActive
    }

    Product {
        uuid id PK
        string name
        string description
        boolean isActive
    }

    CountryProduct {
        uuid id PK
        uuid productId FK
        uuid countryId FK
        string sku
        decimal price
        string currency
        int quantity
        boolean isAvailable
    }

    ProductImage {
        uuid id PK
        uuid productId FK
        string url
        string publicId
        boolean isPrimary
    }

    AuthUser {
        uuid id PK
        string email UK
        string passwordHash
        uuid countryId FK
        boolean isActive
        boolean emailVerified
        datetime lastLoginAt
    }

    AuthSession {
        uuid id PK
        uuid userId FK
        string refreshToken
        datetime expiresAt
        string ipAddress
        string userAgent
    }

    User {
        uuid id PK "= AuthUser.id"
        uuid countryId FK
        string firstName
        string lastName
        string phoneNumber
        string status
    }

    Role {
        uuid id PK
        string name
        string description
    }

    UserRole {
        uuid userId FK
        uuid roleId FK
        datetime assignedAt
    }

    UserAddress {
        uuid id PK
        uuid userId FK
        uuid countryId FK
        string street
        string city
        string postalCode
        boolean isPrimary
    }

    UserPreference {
        uuid id PK
        uuid userId FK
        string language
        string timezone
        boolean notificationsEnabled
    }

    UserAuditLog {
        uuid id PK
        uuid userId FK
        string action
        string performedBy
    }

    Order {
        uuid id PK
        uuid userId
        uuid countryId
        string status
        decimal totalAmount
        string currency
        json shippingAddress
        string trackingNumber
        datetime confirmedAt
        datetime shippedAt
        datetime deliveredAt
        datetime cancelledAt
    }

    OrderItem {
        uuid id PK
        uuid orderId FK
        uuid countryProductId FK
        int quantity
        decimal unitPrice
        string currency
    }

    Payment {
        uuid id PK
        uuid orderId FK "unique"
        string stripePaymentIntentId UK
        string stripeClientSecret
        decimal amount
        string currency
        string status
        string refundId
        datetime paidAt
        datetime refundedAt
    }

    Country ||--o{ CountryProduct : "has"
    Country ||--o{ AuthUser : "belongs to"
    Country ||--o{ User : "belongs to"
    Country ||--o{ UserAddress : "belongs to"

    Product ||--o{ CountryProduct : "available in"
    Product ||--o{ ProductImage : "has"

    CountryProduct ||--o{ OrderItem : "ordered via"

    AuthUser ||--o| User : "has profile"
    AuthUser ||--o{ AuthSession : "has sessions"
    AuthUser ||--o{ UserRole : "has roles"

    User ||--o{ UserAddress : "has"
    User ||--o| UserPreference : "has"
    User ||--o{ UserAuditLog : "audited by"

    Role ||--o{ UserRole : "assigned via"

    Order ||--o{ OrderItem : "contains"
    Order ||--o| Payment : "paid by"
```

---

## 3. Key Design Decisions

### Product has no price or stock
`Product` stores only `name` and `description`. All pricing and inventory lives in `CountryProduct` — the junction between a product and the country it is sold in. This enables per-country pricing with the same product catalog.

### User identity is split across two models
`AuthUser` holds credentials (email, password hash, country, sessions).  
`User` holds the profile (name, phone, addresses). Both share the **same UUID** — `User.id = AuthUser.id`. The auth service creates the `AuthUser`; the user service creates the `User` profile linked by that same ID.

### Order status lifecycle
```
pending → confirmed → shipped → delivered   (terminal)
       ↘              ↘
        cancelled             cancelled     (terminal)
```
Status transitions are enforced in `omnicore-order/src/services/order.service.js`.

### Payment status lifecycle
```
pending → processing → succeeded   (terminal)
                    ↘ failed       (terminal)
         succeeded  → refunded     (terminal)
```
Stripe drives transitions via webhook. On full refund the linked order is automatically cancelled and stock is restored.

### CountryProduct stock is transactional
When an order is created, stock decrement is performed via `prisma.$transaction` (order + items in one transaction), then a service call to product patches `quantity`. If the product call fails, the order is still created but stock is noted as pending — an acknowledged gap for future event-driven architecture.

---

## 4. Migrations

All migrations live in `omnicore-db/prisma/migrations/`. They are applied automatically at startup by the `omnicore-db` Docker container running `prisma migrate deploy`.

To create a new migration:
```bash
npm run prisma:migrate -w @omnicore/db -- --name <migration_name>
```

To regenerate the Prisma client after a schema change:
```bash
npm run prisma:generate -w @omnicore/db
```
