// Shared UI types. Deliberately dependency-free so both server and client
// components can import them without dragging server-only modules into the
// browser bundle.

export type DocumentSummary = {
  id: string;
  filename: string;
  status: string;
  page_count: number | null;
  created_at: string;
};

/** Result of the dev-only "Process" action. */
export type ProcessResult =
  | { kind: "idle" }
  | {
      kind: "success";
      status: string;
      page_count: number | null;
      chunk_count: number;
      total_tokens: number;
    }
  | { kind: "error"; message: string };

/** One hit from POST /search. */
export type SearchHit = {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  score: number;
};

/** Result of the dev-only "Search" action. */
export type SearchResult =
  | { kind: "idle" }
  | { kind: "success"; query: string; hits: SearchHit[] }
  | { kind: "error"; message: string };

/** A cited chunk returned by POST /chat. */
export type ChatSource = {
  document: string;
  chunk_index: number;
  score: number;
};

/** The structured brief returned by POST /meeting-prep. */
export type MeetingBrief = {
  talking_points: string[];
  product_highlights: string[];
  likely_objections: { objection: string; suggested_response: string }[];
  follow_up_recommendations: string[];
  grounding_note: string;
};

export type MeetingPrepRecord = {
  id: string;
  physician_name: string | null;
  specialty: string | null;
  product: string;
  objective: string;
  brief: MeetingBrief;
  sources: ChatSource[];
  created_at: string;
};

export type PrepResult =
  | { kind: "idle" }
  | { kind: "success"; prep: MeetingPrepRecord }
  /** The documents genuinely can't support a brief — not a system failure. */
  | { kind: "no_coverage"; message: string }
  | { kind: "error"; message: string };

/** Result of the dev-only chat action. */
export type ChatResult =
  | { kind: "idle" }
  | {
      kind: "success";
      question: string;
      session_id: string;
      answer: string;
      grounded: boolean;
      sources: ChatSource[];
    }
  | { kind: "error"; message: string };

/** Result of the dev-only "Embed" action. */
export type EmbedResult =
  | { kind: "idle" }
  | {
      kind: "success";
      status: string;
      chunk_count: number;
      embedded_count: number;
      points_in_collection: number;
    }
  | { kind: "error"; message: string };
