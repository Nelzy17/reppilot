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
