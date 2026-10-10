"use client";

// Public "Talk to the Aangan assistant" button: asks our server for a Vaani web-call session,
// then joins the LiveKit room with the visitor's microphone. No phone number needed.

import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
  type TranscriptionSegment,
} from "livekit-client";
import styles from "./home.module.css";

type Status = "idle" | "starting" | "live" | "processing" | "ended" | "error";

interface Caption {
  role: "agent" | "caller";
  text: string;
  at: number;
}

/** Captions in order, with consecutive lines from the same speaker joined into one turn. */
function toTurns(
  captions: Caption[],
): { role: "agent" | "caller"; text: string }[] {
  const turns: { role: "agent" | "caller"; text: string }[] = [];
  for (const c of captions) {
    const text = c.text.trim();
    if (!text) continue;
    const last = turns.at(-1);
    if (last && last.role === c.role) last.text += ` ${text}`;
    else turns.push({ role: c.role, text });
  }
  return turns;
}

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
  const [youSpeaking, setYouSpeaking] = useState(false);
  const [heardYou, setHeardYou] = useState(false);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const segmentsRef = useRef(new Map<string, Caption>());
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
      setLiveSeconds((n) => n + 1);
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
          body: JSON.stringify({
            roomName,
            seconds,
            turns: toTurns(
              [...segmentsRef.current.values()].sort((a, b) => a.at - b.at),
            ),
          }),
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
    setHeardYou(false);
    segmentsRef.current = new Map();
    setCaptions([]);
    setLiveSeconds(0);
    setNeedsAudioTap(false);
    setStatus("starting");
    // Create the room inside the click so the browser lets it play the assistant's voice.
    const room = new Room({ adaptiveStream: true });
    roomRef.current = room;
    void room.startAudio().catch(() => {});
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

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.autoplay = true;
      audioRef.current?.appendChild(el);
      el.play().catch(() => setNeedsAudioTap(true));
    });
    // Live captions. Vaani's agent publishes transcriptions of both sides; we show them and keep
    // them, because Vaani's stored transcript of a web call can miss the caller's lines.
    const upsert = (id: string, role: Caption["role"], text: string) => {
      const prev = segmentsRef.current.get(id);
      segmentsRef.current.set(id, { role, text, at: prev?.at ?? Date.now() });
      setCaptions(
        [...segmentsRef.current.values()].sort((a, b) => a.at - b.at).slice(-6),
      );
    };
    const isLocalTrack = (sid: string | undefined) =>
      !!sid && room.localParticipant.trackPublications.has(sid);
    room.registerTextStreamHandler("lk.transcription", async (reader, from) => {
      const attrs = reader.info.attributes ?? {};
      const id = attrs["lk.segment_id"] ?? reader.info.id;
      const role: Caption["role"] =
        from.identity === room.localParticipant.identity ||
        isLocalTrack(attrs["lk.transcribed_track_id"])
          ? "caller"
          : "agent";
      let text = "";
      for await (const chunk of reader) {
        text += chunk;
        upsert(id, role, text);
      }
    });
    room.on(
      RoomEvent.TranscriptionReceived,
      (segments: TranscriptionSegment[], participant?: Participant) => {
        const role: Caption["role"] =
          participant?.identity === room.localParticipant.identity
            ? "caller"
            : "agent";
        for (const seg of segments) upsert(seg.id, role, seg.text);
      },
    );
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      setNeedsAudioTap(!room.canPlaybackAudio);
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const me = room.localParticipant.identity;
      setAgentSpeaking(speakers.some((p) => p.identity !== me));
      const speaking = speakers.some((p) => p.identity === me);
      setYouSpeaking(speaking);
      if (speaking) setHeardYou(true);
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
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      await room.startAudio().catch(() => {});
      setNeedsAudioTap(!room.canPlaybackAudio);
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
                : youSpeaking
                  ? "Hearing you…"
                  : "Listening, go ahead and speak"}
            </span>
            <span className={styles.timer} aria-label="Time left">
              {mm}:{ss}
            </span>
          </div>
          {needsAudioTap ? (
            <button
              type="button"
              className={styles.callBtn}
              onClick={() => {
                void roomRef.current
                  ?.startAudio()
                  .then(() => setNeedsAudioTap(false));
              }}
            >
              Tap to hear the assistant
            </button>
          ) : null}
          {!heardYou && liveSeconds >= 8 ? (
            <p className={styles.callNote}>
              We can&apos;t hear you yet. Check that the right microphone is
              selected (the mic icon in your browser&apos;s address bar) and
              that it isn&apos;t muted.
            </p>
          ) : null}
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
      {captions.length && (status === "live" || status === "processing") ? (
        <div className={styles.captions} aria-live="polite">
          {captions.map((c, i) => (
            <p
              key={i}
              className={c.role === "agent" ? styles.capAgent : styles.capYou}
            >
              <strong>{c.role === "agent" ? "Assistant" : "You"}:</strong>{" "}
              {c.text}
            </p>
          ))}
        </div>
      ) : null}
      <div ref={audioRef} hidden />
    </div>
  );
}
