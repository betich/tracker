import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, DeniedReason, Fix, ServerMessage, Update } from "@tracker/protocol";
import { socketUrl } from "./endpoint";

export type Status = "idle" | "connecting" | "open" | "offline" | "denied";

export interface TrackerState {
  status: Status;
  denied: DeniedReason | null;
  tracking: boolean;
  viewers: number;
  fix: Fix | null;
  /** Status updates, newest first. */
  updates: Update[];
  /** Skew between the server clock and this device's, in ms, for ageing fixes. */
  clockSkew: number;
  send: (message: ClientMessage) => void;
  retry: () => void;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

/**
 * Holds a socket open to the tracker, reconnecting with backoff. A refusal
 * (bad key, tracker already held) is terminal — retrying would just hammer the
 * worker — so it parks until the caller calls `retry`.
 */
export function useTracker(params: Record<string, string>, enabled = true): TrackerState {
  const [status, setStatus] = useState<Status>("connecting");
  const [denied, setDenied] = useState<DeniedReason | null>(null);
  const [tracking, setTracking] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [fix, setFix] = useState<Fix | null>(null);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [clockSkew, setClockSkew] = useState(0);

  const socket = useRef<WebSocket | null>(null);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [generation, setGeneration] = useState(0);

  // Serialised so a new object literal from the caller doesn't reopen the socket.
  const key = JSON.stringify(params);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");

      const ws = new WebSocket(socketUrl(JSON.parse(key) as Record<string, string>));
      socket.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        attempt.current = 0;
        setStatus("open");
      };

      ws.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }
        if (message.t === "state") {
          setTracking(message.tracking);
          setViewers(message.viewers);
          setFix(message.fix);
          if (message.fix) setClockSkew(message.fix.ts - Date.now());
        } else if (message.t === "updates") {
          setUpdates(message.updates);
        } else if (message.t === "update") {
          // Reconnects replay history, so guard against showing a post twice.
          setUpdates((current) =>
            current.some((entry) => entry.id === message.update.id)
              ? current
              : [message.update, ...current],
          );
        } else if (message.t === "likes") {
          setUpdates((current) =>
            current.map((entry) => (entry.id === message.id ? { ...entry, likes: message.likes } : entry)),
          );
        } else if (message.t === "denied") {
          setDenied(message.reason);
          setStatus("denied");
          disposed = true; // Refusals are terminal until the caller retries.
        }
      };

      ws.onclose = () => {
        if (disposed || socket.current !== ws) return;
        setStatus("offline");
        setTracking(false);
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt.current++);
        timer.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (timer.current) clearTimeout(timer.current);
      socket.current?.close();
      socket.current = null;
    };
  }, [key, generation, enabled]);

  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(message));
    }
  }, []);

  const retry = useCallback(() => {
    setDenied(null);
    setStatus("connecting");
    attempt.current = 0;
    setGeneration((n) => n + 1);
  }, []);

  return { status, denied, tracking, viewers, fix, updates, clockSkew, send, retry };
}
