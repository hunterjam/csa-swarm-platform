"""
swarm/teams_loader.py

Microsoft Teams transcript loader via Microsoft Graph.

Given a Teams meeting Join URL and an OAuth2 access token with the
required Graph delegated scopes (OnlineMeetings.Read,
OnlineMeetingArtifact.Read.All), fetches the most-recent meeting
transcript, parses the WebVTT payload to a "Speaker: text" form,
and returns ``(label, text)`` ready to be stored as a grounding source.

The token is acquired by the frontend (MSAL incremental consent) and
forwarded to this loader; the backend never persists the Graph token.

Required delegated scopes (admin consent typically required):
  - OnlineMeetings.Read              — resolve meeting from JoinWebUrl
  - OnlineMeetingArtifact.Read.All   — list & download meeting transcripts
"""
from __future__ import annotations

import re
from typing import Any

import httpx

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Same per-source limit used by other context loaders.
MAX_CHARS = 32_000


class TeamsLoaderError(Exception):
    """Raised when the Teams transcript cannot be fetched."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def _odata_quote(value: str) -> str:
    """Escape a value for inclusion inside OData single quotes."""
    return value.replace("'", "''")


async def _graph_get(
    client: httpx.AsyncClient,
    url: str,
    token: str,
    *,
    accept: str = "application/json",
) -> httpx.Response:
    resp = await client.get(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": accept,
            "User-Agent": "CSA-Swarm-Platform/1.0",
        },
    )
    if resp.status_code == 401:
        raise TeamsLoaderError(
            "Microsoft Graph rejected the access token. Re-authenticate and try again.",
            status_code=401,
        )
    if resp.status_code == 403:
        raise TeamsLoaderError(
            "Access denied by Microsoft Graph. The signed-in user (or tenant admin) "
            "must consent to OnlineMeetings.Read and OnlineMeetingArtifact.Read.All.",
            status_code=403,
        )
    return resp


async def resolve_meeting_from_join_url(
    client: httpx.AsyncClient,
    token: str,
    join_url: str,
) -> dict[str, Any]:
    """Look up the onlineMeeting record for a Teams Join URL.

    Uses ``/me/onlineMeetings?$filter=JoinWebUrl eq '...'`` which only
    succeeds when the signed-in user is the organizer of the meeting.
    """
    join_url = join_url.strip()
    if not join_url.startswith("https://teams.microsoft.com/"):
        raise TeamsLoaderError(
            "URL does not look like a Teams meeting Join URL (expected "
            "https://teams.microsoft.com/...).",
            status_code=400,
        )

    filter_expr = f"JoinWebUrl eq '{_odata_quote(join_url)}'"
    url = f"{GRAPH_BASE}/me/onlineMeetings"
    resp = await client.get(
        url,
        params={"$filter": filter_expr},
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "CSA-Swarm-Platform/1.0",
        },
    )
    if resp.status_code == 401:
        raise TeamsLoaderError(
            "Microsoft Graph rejected the access token. Re-authenticate and try again.",
            status_code=401,
        )
    if resp.status_code == 403:
        raise TeamsLoaderError(
            "Access denied. The signed-in user must be the meeting organizer, and the "
            "app must have OnlineMeetings.Read delegated permission consented.",
            status_code=403,
        )
    if resp.status_code >= 400:
        raise TeamsLoaderError(
            f"Graph returned HTTP {resp.status_code} resolving the meeting: {resp.text[:300]}",
            status_code=502,
        )

    payload = resp.json()
    items = payload.get("value", [])
    if not items:
        raise TeamsLoaderError(
            "No onlineMeeting matched that Join URL for the signed-in user. "
            "Only the meeting organizer can retrieve transcripts via /me/onlineMeetings.",
            status_code=404,
        )
    return items[0]


async def list_transcripts(
    client: httpx.AsyncClient,
    token: str,
    meeting_id: str,
) -> list[dict[str, Any]]:
    url = f"{GRAPH_BASE}/me/onlineMeetings/{meeting_id}/transcripts"
    resp = await _graph_get(client, url, token)
    if resp.status_code >= 400:
        raise TeamsLoaderError(
            f"Graph returned HTTP {resp.status_code} listing transcripts: {resp.text[:300]}",
            status_code=502,
        )
    return resp.json().get("value", [])


async def fetch_transcript_vtt(
    client: httpx.AsyncClient,
    token: str,
    meeting_id: str,
    transcript_id: str,
) -> str:
    url = (
        f"{GRAPH_BASE}/me/onlineMeetings/{meeting_id}/transcripts/"
        f"{transcript_id}/content?$format=text/vtt"
    )
    resp = await _graph_get(client, url, token, accept="text/vtt")
    if resp.status_code >= 400:
        raise TeamsLoaderError(
            f"Graph returned HTTP {resp.status_code} downloading transcript content: "
            f"{resp.text[:300]}",
            status_code=502,
        )
    return resp.text


# WebVTT speaker tags look like ``<v Speaker Name>Their utterance</v>``.
_VTT_SPEAKER_RE = re.compile(r"<v\s+([^>]+?)>(.*?)</v>", re.DOTALL)
_VTT_TIMESTAMP_RE = re.compile(r"^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->")
_VTT_TAG_RE = re.compile(r"<[^>]+>")


def parse_vtt(vtt: str) -> str:
    """Convert a WebVTT transcript into a plain "Speaker: text" log.

    Lines from the same speaker that appear consecutively are merged.
    Tags other than ``<v ...>`` are stripped; timestamps and NOTE blocks
    are dropped.
    """
    lines: list[tuple[str, str]] = []  # [(speaker, text)]
    current_speaker = ""
    current_text_parts: list[str] = []

    for raw in vtt.splitlines():
        line = raw.strip()
        if not line or line.upper().startswith("WEBVTT") or line.startswith("NOTE"):
            continue
        if _VTT_TIMESTAMP_RE.match(line):
            continue
        # Cue identifier lines (just a number) — skip.
        if line.isdigit():
            continue

        speaker_match = _VTT_SPEAKER_RE.search(line)
        if speaker_match:
            speaker = speaker_match.group(1).strip()
            text = _VTT_TAG_RE.sub("", speaker_match.group(2)).strip()
        else:
            speaker = ""
            text = _VTT_TAG_RE.sub("", line).strip()

        if not text:
            continue

        if speaker == current_speaker and lines:
            current_text_parts.append(text)
            lines[-1] = (current_speaker, " ".join(current_text_parts))
        else:
            current_speaker = speaker
            current_text_parts = [text]
            lines.append((current_speaker, text))

    rendered: list[str] = []
    for speaker, text in lines:
        if speaker:
            rendered.append(f"{speaker}: {text}")
        else:
            rendered.append(text)
    out = "\n".join(rendered).strip()
    if len(out) > MAX_CHARS:
        out = out[:MAX_CHARS] + f"\n\n[... truncated at {MAX_CHARS} chars ...]"
    return out


async def load_teams_meeting_transcript(
    join_url: str,
    graph_token: str,
    *,
    transcript_index: int = -1,
    timeout: float = 30.0,
) -> tuple[str, str]:
    """Fetch the most-recent transcript for a Teams meeting.

    Returns ``(label, text)`` where ``label`` is a human-readable
    description (meeting subject + transcript timestamp) and ``text`` is
    the plain "Speaker: text" transcript.

    ``transcript_index`` defaults to ``-1`` (latest by createdDateTime).
    """
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        meeting = await resolve_meeting_from_join_url(client, graph_token, join_url)
        meeting_id = meeting.get("id")
        if not meeting_id:
            raise TeamsLoaderError("Meeting record had no id.", status_code=502)
        subject = (meeting.get("subject") or "Teams meeting").strip()

        transcripts = await list_transcripts(client, graph_token, meeting_id)
        if not transcripts:
            raise TeamsLoaderError(
                "Meeting has no transcripts. Transcription must be enabled and the "
                "meeting must have ended before transcripts become available.",
                status_code=404,
            )
        transcripts.sort(key=lambda t: t.get("createdDateTime", ""))
        try:
            picked = transcripts[transcript_index]
        except IndexError:
            picked = transcripts[-1]
        transcript_id = picked.get("id")
        if not transcript_id:
            raise TeamsLoaderError("Transcript record had no id.", status_code=502)
        created = picked.get("createdDateTime", "")

        vtt = await fetch_transcript_vtt(client, graph_token, meeting_id, transcript_id)

    text = parse_vtt(vtt)
    if not text:
        raise TeamsLoaderError(
            "Transcript was empty after parsing. The meeting may not have any spoken content.",
            status_code=422,
        )

    label = f"Teams: {subject}"
    if created:
        label = f"{label} ({created[:10]})"
    return label, text
