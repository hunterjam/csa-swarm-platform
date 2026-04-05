"""
swarm/context_loader.py

Utilities for loading grounding context from uploaded files and URLs.
Supports:
  - Plain text files (.txt, .md, .csv)
  - PDF files (.pdf) via pypdf
  - GitHub repo URLs  → fetches README + top-level directory listing
  - Generic URLs      → head-fetches raw text content

All functions return a plain string.  Content is truncated at
MAX_CHARS per source to stay within token budget.
"""
from __future__ import annotations

import io
import re
from typing import BinaryIO

# Per-source char limit (~8 k tokens)
MAX_CHARS = 32_000


# ---------------------------------------------------------------------------
# File loaders
# ---------------------------------------------------------------------------

def load_text_file(file_bytes: bytes, filename: str) -> str:
    """Decode a plain-text / markdown / CSV file."""
    try:
        text = file_bytes.decode("utf-8", errors="replace")
    except Exception as exc:
        return f"[Could not decode {filename}: {exc}]"
    return _truncate(text, filename)


def load_pdf_file(file_bytes: bytes, filename: str) -> str:
    """Extract text from a PDF using pypdf (graceful fallback if not installed)."""
    try:
        import pypdf  # optional dep
    except ImportError:
        return f"[pypdf not installed — cannot read {filename}. Run: pip install pypdf]"

    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n\n".join(pages)
    except Exception as exc:
        return f"[PDF read error for {filename}: {exc}]"

    return _truncate(text, filename)


def load_docx_file(file_bytes: bytes, filename: str) -> str:
    """Extract text from a .docx file using python-docx (graceful fallback if not installed)."""
    try:
        import docx  # python-docx
    except ImportError:
        return f"[python-docx not installed — cannot read {filename}. Run: pip install python-docx]"

    try:
        doc = docx.Document(io.BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        text = "\n\n".join(paragraphs)
    except Exception as exc:
        return f"[DOCX read error for {filename}: {exc}]"

    return _truncate(text, filename)


def load_uploaded_file(file_bytes: bytes, filename: str) -> str:
    """Dispatch to the correct loader based on file extension."""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return load_pdf_file(file_bytes, filename)
    if lower.endswith(".docx"):
        return load_docx_file(file_bytes, filename)
    # txt / md / csv / yaml / json / anything else → treat as text
    return load_text_file(file_bytes, filename)


# ---------------------------------------------------------------------------
# URL loaders
# ---------------------------------------------------------------------------

_GITHUB_REPO_RE = re.compile(
    r"https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/?\s]+)/?", re.IGNORECASE
)


def load_url(url: str) -> tuple[str, str]:
    """
    Fetch content from a URL.

    Returns (source_label, content_text).
    Handles GitHub repo URLs specially to pull README + directory tree.
    For any other URL, fetches raw text (up to MAX_CHARS).
    """
    try:
        import requests  # standard lib alternative; available in venv
    except ImportError:
        return url, "[requests not installed — cannot fetch URL]"

    m = _GITHUB_REPO_RE.match(url.strip())
    if m:
        return _load_github_repo(m.group("owner"), m.group("repo"), requests)

    # Generic URL — fetch raw text
    try:
        resp = requests.get(url.strip(), timeout=10, headers={"User-Agent": "OGESwarm/1.0"})
        resp.raise_for_status()
        ct = resp.headers.get("content-type", "")
        if "text" in ct or "json" in ct or "xml" in ct or "yaml" in ct:
            return url, _truncate(resp.text, url)
        return url, f"[Non-text content-type '{ct}' — skipping body]"
    except Exception as exc:
        return url, f"[Fetch error for {url}: {exc}]"


def _load_github_repo(owner: str, repo: str, requests) -> tuple[str, str]:
    """
    Fetch GitHub repo grounding data:
      1. README (raw)
      2. Top-level directory tree (via API)
    """
    label = f"github.com/{owner}/{repo}"
    parts: list[str] = [f"# GitHub Repository: {owner}/{repo}\n"]

    # 1. Try to fetch README
    for branch in ("main", "master"):
        raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/README.md"
        try:
            r = requests.get(raw_url, timeout=10, headers={"User-Agent": "OGESwarm/1.0"})
            if r.status_code == 200:
                parts.append(f"## README\n\n{r.text[:12_000]}")
                break
        except Exception:
            pass

    # 2. Directory tree via GitHub API (no auth for public repos)
    api_url = f"https://api.github.com/repos/{owner}/{repo}/contents"
    try:
        r = requests.get(api_url, timeout=10, headers={"User-Agent": "OGESwarm/1.0"})
        if r.status_code == 200:
            items = r.json()
            tree_lines = [
                f"  {'📁' if i.get('type') == 'dir' else '📄'} {i['name']}"
                for i in items
            ]
            parts.append("## Top-level file structure\n\n" + "\n".join(tree_lines))
    except Exception:
        pass

    return label, _truncate("\n\n".join(parts), label)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _truncate(text: str, label: str) -> str:
    if len(text) > MAX_CHARS:
        trunc = text[:MAX_CHARS]
        trunc += f"\n\n[... truncated at {MAX_CHARS} chars from {label}]"
        return trunc
    return text
