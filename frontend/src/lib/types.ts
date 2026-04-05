// src/lib/types.ts

export interface Session {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface CsaResponse {
  role: string;
  display_name: string;
  text: string;
}

export interface Round {
  session_id: string;
  round_number: number;
  pm_message: string;
  csa_responses: Record<string, CsaResponse>;
  dir_response: CsaResponse;
  created_at: string;
}

export interface Recommendation {
  id: string;
  session_id: string;
  doc_type: string;
  content: string;
  created_at: string;
}

export interface GroundingSource {
  id: string;
  session_id: string;
  position: number;
  filename: string;
  label: string;
  content: string;
  pinned: boolean;
  created_at: string;
}

export interface DocType {
  key: string;
  label: string;
  icon: string;
  filename: string;
}

// ── SSE event shapes (debate stream) ────────────────────────────────────
export type DebateEvent =
  | { type: 'csa_done'; role: string; display_name: string; text: string }
  | { type: 'dir_chunk'; text: string }
  | { type: 'round_complete'; round: Round }
  | { type: 'error'; message: string };

// ── SSE event shapes (recommendation stream) ────────────────────────────
export type RecommendationEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done'; rec: Recommendation }
  | { type: 'error'; message: string };
