"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Ingestion (process -> embed) runs in the background after upload, so the
// server-rendered list is a snapshot. Re-fetch it while anything is still
// in flight, and stop as soon as everything has settled — with the dev buttons
// gone this is the only thing that moves the badge from 'processing' to 'ready'
// without a manual reload.
const POLL_MS = 3000;

export default function DocumentStatusPoller({
  pending,
}: {
  /** How many documents are not yet in a terminal state. */
  pending: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (pending === 0) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [pending, router]);

  return null;
}
