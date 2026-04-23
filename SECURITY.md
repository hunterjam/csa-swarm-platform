# Security Policy

## Supported Versions

This project is a reference implementation. Only the `main` branch receives security fixes.

## Reporting a Vulnerability

If you discover a security issue, **please do not open a public GitHub issue**. Instead, open a private vulnerability report via GitHub's [Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) feature on this repository, or contact the maintainers directly.

Please include:

- A description of the issue and its potential impact
- Steps to reproduce, or a proof-of-concept
- The commit hash or release the issue was found in

You can expect an initial response within a few business days.

## Security Model

The platform is designed around a zero-secret architecture:

| Concern | Approach |
|---|---|
| Authentication | Microsoft Entra ID via MSAL (browser) + JWT validation against the tenant's JWKS endpoint (backend) |
| Service-to-service auth | All Azure SDK calls use `DefaultAzureCredential`; in Container Apps this resolves to the system-assigned managed identity |
| Cosmos DB network exposure | Private endpoint only; `publicNetworkAccess: Disabled` |
| Cosmos DB data plane auth | RBAC role `Cosmos DB Built-in Data Contributor`; account keys are never used and `disableLocalAuth: true` |
| Azure OpenAI auth | RBAC role `Cognitive Services OpenAI User`; no API keys |
| Container image pull | Managed identity with `AcrPull`; ACR admin user disabled |
| Multi-tenant data isolation | Every Cosmos query is filtered by `user_id` derived from the validated JWT |
| LLM hallucination control | A grounding preamble is hardcoded into every agent system prompt; agents are instructed to refuse claims that are not present in the session grounding context or official Microsoft documentation |

## What Is Out of Scope

- Issues only reproducible against forks that have removed managed-identity auth or re-enabled public network access on Cosmos DB
- Best-practice suggestions that do not correspond to an exploitable vulnerability (these are welcome as regular issues)
- Vulnerabilities in upstream dependencies (please report those to the upstream project; we will track and update)

## Operational Notes for Operators

- Rotate the Entra ID app registration's client secret if you ever create one (the default flow uses confidential-client redirects, no secret needed).
- The `AUTH_ENABLED=false` flag is provided for **local development only**. Never set it in a deployed environment.
- `CORS_ORIGINS` should be locked down to the frontend's deployed origin in production.
