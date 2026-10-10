"use client";

// Public "Talk to the Aangan assistant" button: asks our server for a Vaani web-call session,
// then joins the LiveKit room with the visitor's microphone. No phone number needed.

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import styles from "./home.module.css";

type Status = "idle" | "starting" | "live" | "ended" | "error";

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

  async function start() {
    setMessage(null);
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
    const data = (await res.json()) as { ok: boolean; reason?: string; token?: string; connectionUrl?: string; maxMinutes?: number };
    if (!data.ok || !data.token || !data.connectionUrl) {
      setStatus("error");
      setMessage(data.reason ?? "Couldn't start the call.");
      return;
    }

    const room = new Room({ adaptiveStream: true });
    roomRef.current = room;
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) audioRef.current?.appendChild(track.attach());
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      setAgentSpeaking(speakers.some((p) => p.identity !== room.localParticipant.identity));
    });
    room.on(RoomEvent.Disconnected, () => {
      setStatus("ended");
      setAgentSpeaking(false);
      if (audioRef.current) audioRef.current.innerHTML = "";
      fetch("/api/webcall")
        .then((r) => r.json())
        .then(setAvail)
        .catch(() => {});
    });

    try {
      await room.connect(data.connectionUrl, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);
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
  const disabled = status === "starting" || status === "live" || (avail !== null && !avail.enabled);

  return (
    <div className={styles.callBox}>
      {status === "live" ? (
        <>
          <div className={styles.liveRow}>
            <span className={`${styles.pulse} ${agentSpeaking ? styles.pulseOn : ""}`} aria-hidden />
            <span>{agentSpeaking ? "Assistant is speaking…" : "Listening, go ahead and speak"}</span>
            <span className={styles.timer} aria-label="Time left">
              {mm}:{ss}
            </span>
          </div>
          <button type="button" className={styles.endBtn} onClick={() => roomRef.current?.disconnect()}>
            End call
          </button>
        </>
      ) : (
        <button type="button" className={styles.callBtn} onClick={start} disabled={disabled}>
          {status === "starting" ? "Connecting…" : status === "ended" ? "Call again" : "Talk to the Aangan assistant"}
        </button>
      )}
      <p className={styles.callNote}>
        {message ??
          (avail && !avail.enabled
            ? avail.reason
            : status === "ended"
              ? "Call ended. It will appear on the dashboard within about a minute."
              : `Uses your microphone. Calls last up to ${avail?.maxMinutes ?? 3} minutes${avail ? ` · ${avail.remainingToday} left today` : ""}.`)}
      </p>
      <div ref={audioRef} hidden />
    </div>
  );
}
