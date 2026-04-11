# Omnicore — Technical Documentation

## Table of Contents

| # | Document | Description |
|---|----------|-------------|
| 1 | [Architecture](./01-architecture.md) | System architecture, service map, request flow diagrams |
| 2 | [Technical Stack](./02-technical-stack.md) | Stack decisions, versions, coding standards |
| 3 | [Data Model](./03-data-model.md) | Database schema, entity relationships |
| 4 | [Security](./04-security.md) | Authentication, RBAC, inter-service security |
| 5 | [API Standards](./05-api-standards.md) | Error format, response conventions, error codes |
| 6 | [Deployment](./06-deployment.md) | Docker Compose setup, CI/CD pipeline, environment variables |

## Project Overview

**Omnicore** is a multi-tenant omnichannel e-commerce backend built as a microservices platform.
It exposes a single API Gateway that routes requests to specialized services for auth, users, products, orders, payments, and email.

All client traffic enters through the gateway at port `3010`. Internal services are not reachable from the host.
