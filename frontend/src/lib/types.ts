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

/** A persona building block, from GET /roleplay/personas. */
export type PersonaOption = {
  key: string;
  label: string;
  summary: string;
};

export type PersonaCatalogue = {
  specialties: PersonaOption[];
  personalities: PersonaOption[];
};

export type RoleplaySession = {
  id: string;
  persona_specialty: string;
  persona_personality: string;
  persona_description: string;
  product: string;
  status: string;
  created_at: string;
  completed_at: string | null;
};

export type StartSessionResult =
  | { kind: "idle" }
  | { kind: "success"; session: RoleplaySession }
  | { kind: "error"; message: string };

export type PersonaPreview = {
  description: string;
  product: string;
  system_prompt: string;
};

/** One coached session in the progress view. */
export type ProgressSession = {
  session_id: string;
  persona_specialty: string;
  persona_personality: string;
  persona_description: string;
  product: string;
  created_at: string;
  coached_at: string;
  overall_score: number;
  product_knowledge: number;
  communication: number;
  objection_handling: number;
  clinical_accuracy: number;
};

export type Progress = {
  summary: {
    sessions_coached: number;
    average_overall: number | null;
    averages: {
      product_knowledge: number | null;
      communication: number | null;
      objection_handling: number | null;
      clinical_accuracy: number | null;
    };
    first_session_at: string | null;
    latest_session_at: string | null;
  };
  sessions: ProgressSession[];
};

export type ProgressResult =
  | { ok: true; data: Progress }
  | { ok: false; message: string };

/** A coaching report for a completed roleplay session. */
export type CoachingReport = {
  id: string;
  roleplay_session_id: string;
  overall_score: number;
  scores: {
    product_knowledge: number;
    communication: number;
    objection_handling: number;
    clinical_accuracy: number;
  };
  narratives: Record<string, string>;
  recommendations: string[];
  sources: ChatSource[];
  created_at: string;
};

/** One entry in a roleplay transcript. */
export type RoleplayTurn = {
  role: "physician" | "rep";
  content: string;
  ts: string;
};

