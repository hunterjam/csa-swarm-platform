"""
agents/role_agents.py

Creates Microsoft Agent Framework agents from roles.yaml config.
Each agent is returned as an async context manager via AzureAIClient.as_agent().

IMPORTANT — SDK pinned at agent-framework-azure-ai==1.0.0rc3
  - Use AzureAIClient (not AzureOpenAIChatClient)
  - Use azure.identity.aio.DefaultAzureCredential (async version)
  - Each agent needs its own AzureAIClient instance
  - WorkflowBuilder uses start_executor=... (not .set_start_executor())
  - Streaming: agent.run(input, stream=True) then await stream.get_final_response()
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import yaml
from azure.identity.aio import DefaultAzureCredential
from agent_framework.azure import AzureAIClient

from config import settings

_ROLES_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "roles.yaml")


def load_roles() -> dict:
    """Load and return all role configs from roles.yaml."""
    with open(_ROLES_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("roles", {})


def _build_system_prompt(role: dict) -> str:
    """Prepend domain/lens header to the base system prompt."""
    parts = []
    if role.get("domain"):
        parts.append(f"Domain: {role['domain']}")
    if role.get("lens"):
        parts.append(f"Analytical lens: {role['lens']}")
    header = "\n".join(parts)
    base = role.get("system_prompt", "")
    return f"{header}\n\n{base}" if header else base


@asynccontextmanager
async def make_agent(role_key: str, role: dict, credential: DefaultAzureCredential):
    """
    Async context manager that yields a live Agent Framework agent for a given role.
    Each call creates a fresh AzureAIClient instance (required — do not reuse).
    """
    instructions = _build_system_prompt(role)
    display_name = role.get("display_name", role_key)

    async with AzureAIClient(
        project_endpoint=settings.FOUNDRY_PROJECT_ENDPOINT,
        model_deployment_name=settings.FOUNDRY_MODEL_DEPLOYMENT_NAME,
        credential=credential,
    ).as_agent(
        name=display_name,
        instructions=instructions,
    ) as agent:
        yield agent


async def stream_agent_response(
    role_key: str,
    role: dict,
    user_message: str,
    credential: DefaultAzureCredential,
) -> AsyncGenerator[str, None]:
    """
    Yield text chunks from an agent's streaming response.
    Caller is responsible for accumulating the full text.
    """
    async with make_agent(role_key, role, credential) as agent:
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
) -> str:
    """Invoke an agent and return the full response text (non-streaming)."""
    async with make_agent(role_key, role, credential) as agent:
        stream = agent.run(user_message, stream=True)
        chunks: list[str] = []
        async for chunk in stream:
            if chunk.text:
                chunks.append(chunk.text)
        await stream.get_final_response()
        return "".join(chunks)
