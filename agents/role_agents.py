"""
agents/role_agents.py

Creates Microsoft Agent Framework agents from roles.yaml config.
Each agent is returned as an async context manager via AzureOpenAIChatClient.as_agent().

IMPORTANT — SDK pinned at agent-framework-azure-ai==1.0.0rc3
  - Use AzureOpenAIChatClient with FOUNDRY_OPENAI_ENDPOINT (Azure OpenAI endpoint)
  - Use azure.identity.aio.DefaultAzureCredential (async version)
  - Each agent needs its own client instance
  - Streaming: agent.run(input, stream=True) then await stream.get_final_response()
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import yaml
from azure.identity.aio import DefaultAzureCredential
from agent_framework.azure import AzureOpenAIChatClient

from config import settings

_ROLES_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "roles.yaml")

# Prepended to every agent system prompt — enforces strict grounding.
_GROUNDING_CONSTRAINT = """\
GROUNDING CONSTRAINT — NON-NEGOTIABLE
All content in your responses must be derived solely from one of two authoritative sources:
1. SESSION GROUNDING CONTEXT: Information explicitly present in the debate transcript,
   uploaded documents, or URLs provided in this session.
2. OFFICIAL PUBLIC MICROSOFT DOCUMENTATION: Publicly documented Microsoft product
   capabilities, announced features, and official architectural guidance (e.g., Azure Docs,
   Microsoft Learn, Azure Well-Architected Framework).

PROHIBITED:
- Do not cite, recommend, or reference any third-party product, vendor, service, or tool
  unless it is explicitly named in the session grounding context.
- Do not invent, assume, or extrapolate product features, pricing, service limits, quotas,
  or architectural patterns not explicitly present in the above sources.
- Do not assert facts about customer environments that were not stated in the debate
  transcript or grounding context.

If information required to answer a point is absent from both sources, state explicitly:
"Not addressed in the session or Microsoft documentation" — do not speculate.
"""


def load_roles() -> dict:
    """Load and return all role configs from roles.yaml."""
    with open(_ROLES_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("roles", {})


def _build_system_prompt(role: dict) -> str:
    """Prepend grounding constraint + domain/lens header to the base system prompt."""
    header_parts = []
    if role.get("domain"):
        header_parts.append(f"Domain: {role['domain']}")
    if role.get("lens"):
        header_parts.append(f"Analytical lens: {role['lens']}")
    header = "\n".join(header_parts)
    base = role.get("system_prompt", "")
    body = f"{header}\n\n{base}" if header else base
    return f"{_GROUNDING_CONSTRAINT}\n{body}"


@asynccontextmanager
async def make_agent(
    role_key: str,
    role: dict,
    credential: DefaultAzureCredential,
    model_name: str | None = None,
):
    """
    Async context manager that yields a live Agent Framework agent for a given role.
    Each call creates a fresh AzureOpenAIChatClient instance (required — do not reuse).
    Pass model_name to override the session-default deployment.
    """
    instructions = _build_system_prompt(role)
    deployment = model_name or settings.FOUNDRY_MODEL_DEPLOYMENT_NAME

    async with AzureOpenAIChatClient(
        endpoint=settings.FOUNDRY_OPENAI_ENDPOINT,
        deployment_name=deployment,
        credential=credential,
    ).as_agent(
        instructions=instructions,
    ) as agent:
        yield agent


async def stream_agent_response(
    role_key: str,
    role: dict,
    user_message: str,
    credential: DefaultAzureCredential,
    model_name: str | None = None,
) -> AsyncGenerator[str, None]:
    """
    Yield text chunks from an agent's streaming response.
    Caller is responsible for accumulating the full text.
    """
    async with make_agent(role_key, role, credential, model_name=model_name) as agent:
        stream = agent.run(user_message, stream=True)
        async for chunk in stream:
            if chunk.text:
                yield chunk.text
        await stream.get_final_response()


async def invoke_agent(
    role_key: str,
    role: dict,
    user_message: str,
    credential: DefaultAzureCredential,
    model_name: str | None = None,
) -> str:
    """Invoke an agent and return the full response text (non-streaming)."""
    async with make_agent(role_key, role, credential, model_name=model_name) as agent:
        stream = agent.run(user_message, stream=True)
        chunks: list[str] = []
        async for chunk in stream:
            if chunk.text:
                chunks.append(chunk.text)
        await stream.get_final_response()
        return "".join(chunks)
