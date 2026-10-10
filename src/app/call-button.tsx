"use client";

// Public "Talk to the Aangan assistant" button: asks our server for a Vaani web-call session,
// then joins the LiveKit room with the visitor's microphone. No phone number needed.

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import styles from "./home.module.css";

type Status = "idle" | "starting" | "live" | "processing" | "ended" | "error";

interface Availability {
  enabled: boolean;
  reason: string | null;
  maxMinutes: number;
  remainingToday: number;
  remainingTotal: number;
}

export function CallButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [resultId, setResultId] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/webcall")
      .then((r) => r.json())
      .then(setAvail)
      .catch(() => setAvail(null));
    return () => {
      roomRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (status !== "live") return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          roomRef.current?.disconnect();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [status]);

  /** After hang-up: ask the server to pull the transcript and process it; poll until it's ready. */
  async function finish(roomName: string, seconds: number) {
    setStatus("processing");
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch("/api/webcall/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomName, seconds }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          pending?: boolean;
          callId?: string;
        };
        if (data.ok && data.callId) {
          setResultId(data.callId);
          setStatus("ended");
          return;
        }
        if (!data.ok) break;
      } catch {
        // network blip: keep polling
      }
      await new Promise((r) => setTimeout(r, 6000));
    }
    setStatus("ended");
    setMessage(
      "The call ended. It may take a few minutes to appear on the dashboard.",
    );
  }

  async function start() {
    setMessage(null);
    setResultId(null);
    setStatus("starting");
    try {
      // Ask for the microphone first so a blocked mic doesn't spend a call.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch {
      setStatus("error");
      setMessage("Please allow microphone access to talk to the assistant.");
      return;
    }

    const res = await fetch("/api/webcall", { method: "POST" });
    const data = (await res.json()) as {
      ok: boolean;
      reason?: string;
      token?: string;
      connectionUrl?: string;
      roomName?: string;
      maxMinutes?: number;
    };
    if (!data.ok || !data.token || !data.connectionUrl) {
      setStatus("error");
      setMessage(data.reason ?? "Couldn't start the call.");
      return;
    }

    const room = new Room({ adaptiveStream: true });
    roomRef.current = room;
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio)
        audioRef.current?.appendChild(track.attach());
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      setAgentSpeaking(
        speakers.some((p) => p.identity !== room.localParticipant.identity),
      );
    });
    let connectedAt = 0;
    room.on(RoomEvent.Disconnected, () => {
      setAgentSpeaking(false);
      if (connectedAt && data.roomName)
        void finish(
          data.roomName,
          Math.round((Date.now() - connectedAt) / 1000),
        );
      else setStatus("ended");
      if (audioRef.current) audioRef.current.innerHTML = "";
      fetch("/api/webcall")
        .then((r) => r.json())
        .then(setAvail)
        .catch(() => {});
    });

    try {
      await room.connect(data.connectionUrl, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      connectedAt = Date.now();
      setSecondsLeft((data.maxMinutes ?? 3) * 60);
      setStatus("live");
    } catch {
      setStatus("error");
      setMessage("Couldn't connect the call. Please try again.");
      room.disconnect();
    }
  }

  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const disabled =
    status === "starting" ||
    status === "live" ||
    status === "processing" ||
    (avail !== null && !avail.enabled);

  return (
    <div className={styles.callBox}>
      {status === "live" ? (
        <>
          <div className={styles.liveRow}>
            <span
              className={`${styles.pulse} ${agentSpeaking ? styles.pulseOn : ""}`}
              aria-hidden
            />
            <span>
              {agentSpeaking
                ? "Assistant is speaking…"
                : "Listening, go ahead and speak"}
            </span>
            <span className={styles.timer} aria-label="Time left">
              {mm}:{ss}
            </span>
          </div>
          <button
            type="button"
            className={styles.endBtn}
            onClick={() => roomRef.current?.disconnect()}
          >
            End call
          </button>
        </>
      ) : (
        <button
          type="button"
          className={styles.callBtn}
          onClick={start}
          disabled={disabled}
        >
          {status === "starting"
            ? "Connecting…"
            : status === "processing"
              ? "Processing the call…"
              : status === "ended"
                ? "Call again"
                : "Talk to the Aangan assistant"}
        </button>
      )}
      <p className={styles.callNote}>
        {message ??
          (avail && !avail.enabled
            ? avail.reason
            : status === "processing"
              ? "Fetching the transcript and classifying the call. This takes up to a minute."
              : status === "ended" && resultId
                ? "Done. The call has been classified and routed."
                : status === "ended"
                  ? "Call ended. It will appear on the dashboard within about a minute."
                  : `Uses your microphone. Calls last up to ${avail?.maxMinutes ?? 3} minutes${avail ? ` · ${avail.remainingToday} left today` : ""}.`)}
      </p>
      {status === "ended" && resultId ? (
        <a className={styles.resultLink} href={`/dashboard/calls/${resultId}`}>
          See how your call was classified →
        </a>
      ) : null}
      <div ref={audioRef} hidden />
    </div>
  );
}
