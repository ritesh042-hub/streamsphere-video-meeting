import React, { useEffect, useState } from "react";
import Home from "./pages/Home.jsx";
import MeetingRoom from "./pages/MeetingRoom.jsx";

const SESSION_KEY = "streamsphere-active-meeting";

function roomFromPath() {
  const match = window.location.pathname.match(/^\/meeting\/([A-Z0-9-]+)$/i);
  return match ? match[1].toUpperCase() : "";
}

export default function App() {
  const [meeting, setMeeting] = useState(() => {
    const roomId = roomFromPath();
    const saved = localStorage.getItem(SESSION_KEY);

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!roomId || parsed.roomId === roomId) return parsed;
      } catch {}
    }

    return roomId ? { roomId, name: "", hostKey: "", isHost: false, needsName: true } : null;
  });

  useEffect(() => {
    const onPop = () => {
      const roomId = roomFromPath();
      if (!roomId) return setMeeting(null);
      setMeeting((current) => current?.roomId === roomId ? current : {
        roomId, name: "", hostKey: "", isHost: false, needsName: true,
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const enterMeeting = (next) => {
    const normalized = { ...next, needsName: false };
    localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
    window.history.pushState({}, "", `/meeting/${normalized.roomId}`);
    setMeeting(normalized);
  };

  const leaveMeeting = () => {
    localStorage.removeItem(SESSION_KEY);
    window.history.pushState({}, "", "/");
    setMeeting(null);
  };

  if (meeting?.needsName) {
    return (
      <main className="link-lobby">
        <section className="lobby-card">
          <div className="brand">StreamSphere</div>
          <p className="eyebrow">Shared meeting link</p>
          <h1>Join room {meeting.roomId}</h1>
          <p className="subtext">Enter your display name to continue.</p>
          <input id="shared-link-name" placeholder="Your display name" />
          <button className="primary" onClick={() => {
            const name = document.getElementById("shared-link-name")?.value.trim();
            if (!name) return alert("Enter your name.");
            enterMeeting({ ...meeting, name });
          }}>Join meeting</button>
        </section>
      </main>
    );
  }

  return meeting
    ? <MeetingRoom meeting={meeting} onLeave={leaveMeeting} />
    : <Home onEnterMeeting={enterMeeting} />;
}
