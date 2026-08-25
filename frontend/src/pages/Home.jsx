import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "../socket.js";

function extractRoomId(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/\/meeting\/([A-Z0-9-]+)/i);
  return (match ? match[1] : trimmed).trim().toUpperCase();
}

function hostKey() {
  return crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Home({ onEnterMeeting }) {
  const [name, setName] = useState("");
  const [joinValue, setJoinValue] = useState("");
  const [generatedMeeting, setGeneratedMeeting] = useState(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledMeetings, setScheduledMeetings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("streamsphere-scheduled") || "[]"); }
    catch { return []; }
  });
  const [form, setForm] = useState({ title:"", date:"", time:"", duration:"30", description:"" });
  const baseUrl = useMemo(() => window.location.origin, []);

  useEffect(() => {
    localStorage.setItem("streamsphere-scheduled", JSON.stringify(scheduledMeetings));
  }, [scheduledMeetings]);

  const requireName = () => {
    if (!name.trim()) { alert("Please enter your display name first."); return false; }
    return true;
  };

  const createRoom = async () => {
    const key = hostKey();
    const response = await fetch(`${API_URL}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostKey:key, maxParticipants:8 }),
    });
    if (!response.ok) throw new Error("Unable to create meeting.");
    return { ...(await response.json()), hostKey:key };
  };

  const newMeeting = async () => {
    if (!requireName()) return;
    try {
      const room = await createRoom();
      onEnterMeeting({ roomId:room.roomId, name:name.trim(), hostKey:room.hostKey, isHost:true });
    } catch (e) { alert(e.message); }
  };

  const createLink = async () => {
    if (!requireName()) return;
    try {
      const room = await createRoom();
      setGeneratedMeeting({
        roomId:room.roomId,
        hostKey:room.hostKey,
        meetingLink:`${baseUrl}/meeting/${room.roomId}`
      });
    } catch (e) { alert(e.message); }
  };

  const join = () => {
    if (!requireName()) return;
    const roomId = extractRoomId(joinValue);
    if (!roomId) return alert("Enter a valid meeting code or link.");
    onEnterMeeting({ roomId, name:name.trim(), hostKey:"", isHost:false });
  };

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); alert("Copied."); }
    catch { alert("Unable to copy."); }
  };

  const share = async () => {
    if (!generatedMeeting) return;
    if (navigator.share) {
      try { await navigator.share({ title:"StreamSphere Meeting", text:"Join my meeting", url:generatedMeeting.meetingLink }); } catch {}
    } else copy(generatedMeeting.meetingLink);
  };

  const schedule = async () => {
    if (!requireName()) return;
    if (!form.title.trim() || !form.date || !form.time) return alert("Enter title, date and time.");
    try {
      const room = await createRoom();
      setScheduledMeetings((prev) => [...prev, {
        id:crypto?.randomUUID?.() || `${Date.now()}`,
        ...form, roomId:room.roomId, hostKey:room.hostKey,
        link:`${baseUrl}/meeting/${room.roomId}`
      }]);
      setForm({ title:"", date:"", time:"", duration:"30", description:"" });
      setShowSchedule(false);
    } catch (e) { alert(e.message); }
  };

  return (
    <main className="home-shell">
      <section className="home-dashboard">
        <div className="home-main-card">
          <div className="brand">StreamSphere</div>
          <p className="eyebrow">Secure real-time meetings</p>
          <h1>Meet. Share.<br/>Stay connected.</h1>
          <p className="subtext">Start instantly, create a shareable link, schedule a future session, or join using a room code or full link.</p>

          <div className="name-section">
            <label>Your display name</label>
            <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Enter your name" />
          </div>

          <div className="meeting-actions">
            <button className="primary action-card" onClick={newMeeting}>
              <span className="action-icon">+</span>
              <span><strong>New Meeting</strong><small>Start an instant room</small></span>
            </button>

            <button className="secondary action-card" onClick={createLink}>
              <span className="action-icon">🔗</span>
              <span><strong>Create Link</strong><small>Share now, join later</small></span>
            </button>

            <button className="secondary action-card" onClick={()=>setShowSchedule(true)}>
              <span className="action-icon">◷</span>
              <span><strong>Schedule</strong><small>Plan a future call</small></span>
            </button>
          </div>

          <div className="join-divider"><span>Join an existing meeting</span></div>
          <div className="join-row">
            <input value={joinValue} onChange={(e)=>setJoinValue(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&join()} placeholder="Enter meeting code or paste meeting link" />
            <button className="join-button" onClick={join}>Join</button>
          </div>
        </div>

        <aside className="home-side-card">
          <div className="side-card-header">
            <div><p className="side-eyebrow">Your meetings</p><h2>Scheduled</h2></div>
            <span className="meeting-count">{scheduledMeetings.length}</span>
          </div>

          {scheduledMeetings.length===0 ? (
            <div className="empty-meetings"><div className="empty-icon">◷</div><strong>Nothing scheduled yet</strong><p>Your upcoming meetings will appear here.</p></div>
          ) : (
            <div className="scheduled-list">
              {scheduledMeetings.map((item)=>(
                <article className="scheduled-card" key={item.id}>
                  <div className="scheduled-top"><div><span className="scheduled-date">{item.date}</span><h3>{item.title}</h3></div><span className="scheduled-time">{item.time}</span></div>
                  <div className="scheduled-meta"><span>{item.duration} min</span><span>Room {item.roomId}</span></div>
                  <div className="scheduled-actions">
                    <button onClick={()=>onEnterMeeting({roomId:item.roomId,name:name.trim()||"Host",hostKey:item.hostKey,isHost:true})}>Join Now</button>
                    <button onClick={()=>copy(item.link)}>Copy Link</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </aside>
      </section>

      {generatedMeeting && (
        <div className="modal-overlay">
          <section className="meeting-modal">
            <button className="modal-close" onClick={()=>setGeneratedMeeting(null)}>×</button>
            <div className="modal-symbol">✓</div>
            <p className="side-eyebrow">Meeting created</p>
            <h2>Your room is ready.</h2>
            <div className="meeting-detail"><label>Meeting Code</label><div className="detail-row"><strong>{generatedMeeting.roomId}</strong><button className="small-copy-button" onClick={()=>copy(generatedMeeting.roomId)}>Copy</button></div></div>
            <div className="meeting-detail"><label>Meeting Link</label><div className="detail-row"><div className="link-display">{generatedMeeting.meetingLink}</div><button className="small-copy-button" onClick={()=>copy(generatedMeeting.meetingLink)}>Copy</button></div></div>
            <div className="modal-actions">
              <button className="secondary" onClick={()=>copy(generatedMeeting.meetingLink)}>Copy Link</button>
              <button className="secondary" onClick={share}>Share</button>
              <button className="primary" onClick={()=>onEnterMeeting({roomId:generatedMeeting.roomId,name:name.trim(),hostKey:generatedMeeting.hostKey,isHost:true})}>Join Now</button>
            </div>
          </section>
        </div>
      )}

      {showSchedule && (
        <div className="modal-overlay">
          <section className="meeting-modal">
            <button className="modal-close" onClick={()=>setShowSchedule(false)}>×</button>
            <p className="side-eyebrow">Schedule meeting</p>
            <h2>Plan your next call.</h2>
            <div className="schedule-form">
              <label>Meeting title</label>
              <input value={form.title} onChange={(e)=>setForm((p)=>({...p,title:e.target.value}))} placeholder="Project discussion" />
              <div className="schedule-grid">
                <div><label>Date</label><input type="date" value={form.date} onChange={(e)=>setForm((p)=>({...p,date:e.target.value}))}/></div>
                <div><label>Time</label><input type="time" value={form.time} onChange={(e)=>setForm((p)=>({...p,time:e.target.value}))}/></div>
              </div>
              <label>Duration</label>
              <select value={form.duration} onChange={(e)=>setForm((p)=>({...p,duration:e.target.value}))}>
                <option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1 hour 30 minutes</option>
              </select>
              <label>Description</label>
              <textarea value={form.description} onChange={(e)=>setForm((p)=>({...p,description:e.target.value}))} placeholder="Optional meeting notes"/>
              <button className="primary schedule-submit" onClick={schedule}>Schedule Meeting</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
