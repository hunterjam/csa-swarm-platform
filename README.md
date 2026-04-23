# CSA Swarm Platform

A multi-user, cloud-native platform that simulates a structured design session between AI-powered Cloud Solution Architect (CSA) personas and a Director CSA — producing grounded, enterprise-grade architecture deliverables for the Oil & Gas Energy (OGE) observability domain.

---

## What It Does

The platform replaces a manual, asynchronous process where a PM has to interview multiple CSAs and synthesize their inputs. Instead, a PM describes a design problem in plain language, and a **swarm of specialized AI agents** debates it in real time — each agent advocating from a distinct domain perspective — before a Director agent synthesizes the outcome. The session ends with AI-generated, audit-ready deliverables scoped to what was actually discussed.

---

## End-to-End User Workflow

```
1. Sign In (Entra ID / MSAL)
       ↓
2. Create a Session (name it, choose a model)
       ↓
3. Upload Grounding Context  ← optional but powerful
   (customer interview transcripts, PDFs, URLs, GitHub repos)
       ↓
4. Configure Agent Personas  ← optional
   (edit CSA display names, domains, analytical lenses, system prompts
    or auto-generate a new persona from a transcript using Bootstrap)
       ↓
5. Run Debate Rounds  ← core experience
   (PM types a question / design prompt → agents respond live via SSE;
    all prior rounds are visible inline with timestamps)
       ↓
6. Generate Deliverables
   (Architecture Recommendation, Project Plan, Technical Specs, Roadmap, Diagram;
    all rounds and deliverables are persisted in Cosmos DB per user per session)
```

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Browser (Next.js 14)                          │
│       Sessions │ Context │ Agent Config │ Debate │ Deliverables        │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTPS + Entra ID Bearer JWT
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend (Azure Container Apps)                │
│                                                                         │
│  /api/sessions        – session CRUD                                    │
│  /api/sessions/:id/context    – grounding source management             │
│  /api/sessions/:id/agent-config/bootstrap  – LLM persona generation     │
│  /api/sessions/:id/rounds     – debate orchestration  [SSE stream]      │
│  /api/sessions/:id/recommendations – deliverable generation [SSE stream]│
└─────┬──────────────────────────────────────────┬───────────────────────┘
      │ DefaultAzureCredential (Managed Identity) │
      ▼                                           ▼
┌─────────────┐                         ┌─────────────────────────────────┐
│  Cosmos DB  │                         │  Azure AI Services              │
│  NoSQL      │                         │  (Azure OpenAI endpoint)        │
│  (private   │                         │  gpt-4o / gpt-4.1 / o4-mini    │
│   endpoint) │                         │  Microsoft Agent Framework SDK  │
└─────────────┘                         └─────────────────────────────────┘
```

**Key infrastructure decisions:**
- Both Container Apps run inside a VNet-injected Container Apps Environment, reaching Cosmos DB over a private endpoint — `publicNetworkAccess` is disabled on Cosmos.
- All credentials are eliminated via Azure Managed Identity + RBAC; no secrets in app settings.
- Authentication is Microsoft Entra ID only: the frontend uses MSAL and sends a Bearer JWT; the backend validates it against the Entra tenant's JWKS endpoint.

---

## Components

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind | SPA UI; consumes SSE streams for live agent output |
| Backend API | Python 3.12, FastAPI | Auth, session management, orchestration entry points |
| Debate Workflow | `workflows/debate_workflow.py` | Parallel CSA dispatch + sequential Director synthesis |
| Agent Layer | `agents/role_agents.py` + Microsoft Agent Framework | Creates Azure OpenAI Assistants per role, enforces grounding constraints |
| Swarm Orchestrator | `swarm/orchestrator.py` | Deliverable generation using debate transcript as source of truth |
| Context Loader | `swarm/context_loader.py` | Parses uploaded files (PDF, DOCX, TXT, MD) and fetches URLs/GitHub repos |
| Persistence | Azure Cosmos DB NoSQL (serverless) | Multi-user session isolation; single container, partition key: `/session_id` |
| Identity | Azure Managed Identity + Entra ID | Zero-secret architecture end-to-end |
| Infrastructure | Bicep (ACA, Cosmos, ACR, AI Services, VNet) | Fully reproducible with `azd up` |

---

## The Agentic Framework and Debate Process

This is the core of the platform. Understanding it is key to understanding why the outputs are trustworthy.

### What is the Microsoft Agent Framework here?

Each agent is an OpenAI **Assistant** (Azure OpenAI Assistants API) created on demand for a single debate round via `AzureOpenAIChatClient.as_agent()`. The framework manages the thread lifecycle, tool calling surface, and streaming. A fresh assistant instance is created per round per role — there is no shared state between rounds at the agent level. History is instead passed explicitly as structured context in each user message.

### Role Configuration (`config/roles.yaml`)

Agents are not generic AI personas. Each one is loaded from `roles.yaml`, which defines:

- `display_name` — the label shown in the UI (e.g., *CSA – Observability & Standardization*)
- `domain` — the technical specialty the agent grounds into (e.g., *Oil & Gas operational monitoring*)
- `lens` — the analytical frame the agent argues from (e.g., *Operational standardization and efficiency*)
- `system_prompt` — a detailed instruction block that defines output format, decision heuristics, and precisely what the agent is and is not allowed to say

The system prompt is prepended with a **non-negotiable grounding constraint** that prohibits the agent from citing any vendor, tool, or product not explicitly present in either the session grounding context or official Microsoft documentation. This prevents hallucination at the persona level.

### The Grounding Context Block

Before any debate round runs, the PM can upload grounding sources — customer interview transcripts, architecture PDFs, Azure documentation URLs, or entire GitHub repositories. These are stored in Cosmos DB per session and assembled into a single `grounding_block` string. This block is injected into every CSA user message at the top of each round, giving all agents the same factual foundation.

### A Single Debate Round — Step by Step

```
PM types: "What should the baseline Azure monitoring architecture look like?"
                              │
                              ▼
           run_round_streaming() is called
                              │
                              ├── loads all prior rounds from Cosmos (round history)
                              ├── loads grounding_block from Cosmos
                              └── merges session-level agent_config overrides on top of roles.yaml defaults
                              │
            ┌─────────────────┴──────────────────────────────┐
            │         Phase 1 — CSAs run in PARALLEL          │
            │                                                  │
            │  asyncio.gather(                                 │
            │    _run_csa("csa_1"),   ← CSA Observability    │
            │    _run_csa("csa_2"),   ← CSA IT Operations    │
            │    _run_csa("csa_3"),   ← CSA Customer Voice   │
            │  )                                               │
            │                                                  │
            │  Each CSA receives the same user message:        │
            │    [grounding_block]                             │
            │    [prior round summaries, truncated to 600 ch.] │
            │    PM: <pm_message>                              │
            │                                                  │
            │  Each CSA responds from its own domain + lens.   │
            │  Disagreements with other CSAs are explicit and  │
            │  must be grounded in stated facts.               │
            └──────────────────┬─────────────────────────────-┘
                               │  all CSA responses collected
                               ▼
            ┌──────────────────────────────────────────────────┐
            │       Phase 2 — Director CSA runs SEQUENTIALLY    │
            │                                                   │
            │  Director receives:                               │
            │    [prior round summaries]                        │
            │    PM message this round: <pm_message>            │
            │    === CSA RESPONSES THIS ROUND ===               │
            │      CSA Observability   (full text)              │
            │      CSA IT Operations   (full text)              │
            │      CSA Customer Voice  (full text)              │
            │    === END CSA RESPONSES ===                      │
            │    "As Director CSA, please synthesize..."        │
            │                                                   │
            │  Director response is STREAMED token-by-token     │
            │  to the browser via SSE as it generates.          │
            └──────────────────┬────────────────────────────────┘
                               │  round_complete event emitted
                               ▼
                  Round saved to Cosmos DB
```

### Why Run CSAs in Parallel?

Each CSA has a distinct domain and lens. They are not meant to see each other's answers in real time — that would anchor them to the first response. Running them in parallel with `asyncio.gather` ensures each CSA argues independently from their grounding, producing genuinely different perspectives for the Director to synthesize. The Director is specifically designed to surface disagreements, flag unaddressed gaps, and choose viability over consensus.

### SSE Streaming — How the UI Stays Live

The backend does not wait for all agents to finish before responding. It uses FastAPI's `StreamingResponse` with `text/event-stream` and yields events as they occur:

| Event Type | When | What It Contains |
|---|---|---|
| `csa_complete` | After each CSA finishes | Full response text + display metadata |
| `dir_chunk` | On every token from Director | Incremental text chunk |
| `round_complete` | After Director finishes | Full structured round object |
| `error` | On any exception | Error message |
| `[DONE]` | Always last | Sentinel to close the stream |

The frontend consumes these via a custom `streamDebateRound()` function and renders each CSA card as its event arrives, and streams the Director response character-by-character.

### Role Customisation and Bootstrap

Session-level role overrides can be applied without changing `roles.yaml`. A PM can:
- **Manually edit** `display_name`, `domain`, `lens`, or `system_prompt` for any role via the Agent Config page
- **Bootstrap a new persona** from a real meeting transcript — the backend sends the transcript to the same LLM with a meta-prompt that extracts domain, lens, and a full structured system prompt, then returns a draft for PM review before saving it to the session

This means the swarm can be tuned to a specific customer reality within minutes, without any code changes.

---

## Deliverable Generation

After one or more debate rounds, the PM can generate any of the following documents:

| Document Type | Content |
|---|---|
| Architecture Recommendation | Executive summary, agreed principles, layered architecture by component, open risks, next steps |
| Project Plan | Phased timeline (honours any explicit duration stated in the debate), milestones, resource requirements |
| Technical Specifications | Per-component specs, data flow, integration table, non-functional requirements, decisions log |
| Detailed Roadmap | Short / mid / long-term workstreams derived from debate outcomes |
| Risk Register | Identified risks with likelihood, impact, and mitigation owners |
| GSA Compliance Assessment | Mapping of the proposed architecture to GSA / federal compliance controls |
| User Stories & Tasks | Importable Azure DevOps and GitHub Projects CSV with Epics, User Stories, and Tasks |

All documents are generated by the Synthesis Orchestrator (`swarm/orchestrator.py`), which sends the full round history as context to the model under the same grounding constraint: every statement in the document must trace back to what was said in the debate or to official Microsoft documentation. The output is streamed to the browser and persisted to Cosmos DB.

---

## Data Model (Cosmos DB)

All data lives in a single container, partitioned by `session_id`. Documents are discriminated by a `type` field:

| Type | Key Fields |
|---|---|
| `session` | `session_id`, `user_id`, `title`, `agent_config` |
| `round` | `session_id`, `round_number`, `pm_message`, `csa_responses{}`, `dir_response{}` |
| `recommendation` | `session_id`, `doc_type`, `content` |
| `grounding` | `session_id`, `position`, `source_type`, `content`, `pinned` |

Each user only sees their own sessions — all queries filter by `user_id` derived from the validated JWT.

---

## Security Model

| Concern | Approach |
|---|---|
| Authentication | Entra ID MSAL (frontend) + JWT validation against JWKS (backend) |
| No credentials in config | All Azure SDK calls use `DefaultAzureCredential` (Managed Identity in ACA) |
| Cosmos DB network isolation | Private endpoint; `publicNetworkAccess: Disabled` |
| Cosmos DB data plane auth | RBAC (`Cosmos DB Built-in Data Contributor`) — no account keys |
| Azure OpenAI auth | RBAC (`Cognitive Services OpenAI Contributor`) — no API keys |
| Container image pull | Managed Identity with `AcrPull` — no registry credentials |
| Grounding constraint enforcement | Hardcoded preamble in every agent's system prompt |

See [SECURITY.md](SECURITY.md) for the full threat model and how to report vulnerabilities.

---

## Quick Start — Deploy to Azure

The entire platform can be deployed end-to-end with the [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/) (`azd`).

### Prerequisites

- Azure subscription with permission to create resource groups and role assignments
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) and [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) (`azd`)
- [Docker](https://docs.docker.com/get-docker/) (used by `azd` to build container images)
- An Azure region with **gpt-4o** capacity (e.g., `eastus2`, `westus3`, `swedencentral`)
- **Your own Microsoft Entra ID app registration** for SSO. This repo does not ship a shared client ID — you must create one in your own tenant before deploying. Configure it as:
  - **Supported account types**: single-tenant (or as required by your organisation)
  - **Platform**: Single-page application (SPA)
  - **Redirect URIs**: `http://localhost:3000` for local dev, plus your eventual frontend Container App URL after the first `azd up`
  - **API → Expose an API**: an `Application ID URI` and a delegated scope (e.g. `access_as_user`); the `postprovision` script will set the URI to the deployed backend FQDN automatically
  - Note the **Application (client) ID** and **Directory (tenant) ID** — you will pass these to `azd env set` below

### Deploy

```bash
# 1. Authenticate
az login
azd auth login

# 2. Initialise an azd environment (you'll be prompted for a name and location)
azd env new <env-name>
azd env set ENTRA_CLIENT_ID <your-app-registration-client-id>
azd env set ENTRA_TENANT_ID <your-aad-tenant-id>

# 3. Provision infrastructure and deploy both apps
azd up
```

`azd up` will:

1. Provision all Azure resources via Bicep (`infra/main.bicep`) — VNet, Container Apps Environment, ACR, Cosmos DB (private endpoint), AI Services + gpt-4o deployment, Log Analytics, Key Vault, Storage, AI Foundry hub/project.
2. Build the backend and frontend Docker images and push them to the new ACR.
3. Deploy both Container Apps with managed identities and the necessary RBAC role assignments.
4. Run the `postprovision` hook in [scripts/](scripts/) to set the Entra ID app registration `identifierUris` to the deployed backend URL.

When complete, `azd` prints the frontend URL. Sign in with an account in your tenant to begin a session.

### Local Development

```bash
# Backend (Python 3.12)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # then fill in COSMOS_ENDPOINT, FOUNDRY_OPENAI_ENDPOINT
uvicorn main:app --reload  # http://localhost:8000

# Frontend (Node.js 20+)
cd frontend
npm install
cp .env.local.example .env.local
npm run dev                # http://localhost:3000
```

For local dev the backend uses `DefaultAzureCredential`, so `az login` against an account that has the `Cognitive Services OpenAI User` and `Cosmos DB Built-in Data Contributor` roles on the deployed resources.

Set `AUTH_ENABLED=false` in `.env` to bypass JWT validation for fast iteration.

### Tear Down

```bash
azd down --purge
```

---

## Repository Layout

```
agents/      Per-role agent factory (Microsoft Agent Framework wrapper)
api/         FastAPI app, routes, JWT auth
config/      Settings loader and roles.yaml (CSA persona definitions)
frontend/    Next.js 14 App Router UI
infra/       Bicep templates (main + cosmos + containerapp modules)
scripts/     azd lifecycle hooks (e.g. set-app-identifier-uri.sh)
swarm/       Cosmos store, context loader, deliverable orchestrator
workflows/   Debate workflow (parallel CSAs + sequential Director)
Dockerfile.backend / Dockerfile.frontend
azure.yaml   azd service map
```

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow. For security issues, please follow the disclosure process in [SECURITY.md](SECURITY.md).

---

## License

Released under the [MIT License](LICENSE).
