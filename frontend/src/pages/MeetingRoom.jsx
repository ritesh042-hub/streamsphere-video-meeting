import React, { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../socket.js";

const ICE_SERVERS = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]};
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export default function MeetingRoom({ meeting, onLeave }) {
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef({});
  const audioContextRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const cleanupRef = useRef(false);
  const micEnabledRef = useRef(true);

  const [remoteStreams, setRemoteStreams] = useState({});
  const [participants, setParticipants] = useState([]);
  const [settings, setSettings] = useState({ locked:false, chatEnabled:true, screenShareEnabled:true, maxParticipants:8 });
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [panel, setPanel] = useState("");
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [quality, setQuality] = useState("Good");
  const [devices, setDevices] = useState({ cameras:[], microphones:[] });
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMic, setSelectedMic] = useState("");
  const [facingMode, setFacingMode] = useState("user");
  const [recording, setRecording] = useState(false);

  const me = useMemo(() => participants.find((p)=>p.socketId===socket.id), [participants]);
  const canModerate = Boolean(me?.isHost || me?.isCoHost || meeting.isHost);

  const formatDuration = (s) => {
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
    return h ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  };

  const stopResources = () => {
    if (cleanupRef.current) return;
    cleanupRef.current = true;
    try { if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop(); } catch {}
    screenStreamRef.current?.getTracks().forEach((t)=>t.stop());
    localStreamRef.current?.getTracks().forEach((t)=>t.stop());
    Object.values(peersRef.current).forEach((p)=>{ try { p.close(); } catch {} });
    peersRef.current = {};
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    try { audioContextRef.current?.close(); } catch {}
    if (socket.connected) socket.emit("leave-room", { roomId:meeting.roomId });
  };

  const createPeer = (userId) => {
    if (peersRef.current[userId]) return peersRef.current[userId];
    const peer = new RTCPeerConnection(ICE_SERVERS);
    localStreamRef.current?.getTracks().forEach((track)=>peer.addTrack(track, localStreamRef.current));
    peer.ontrack = (e) => {
      const stream = e.streams[0];
      if (stream) setRemoteStreams((prev)=>({...prev,[userId]:stream}));
    };
    peer.onicecandidate = (e) => {
      if (e.candidate) socket.emit("ice-candidate", { target:userId, candidate:e.candidate });
    };
    peer.onconnectionstatechange = () => {
      if (["failed","closed"].includes(peer.connectionState)) {
        peer.close();
        delete peersRef.current[userId];
        setRemoteStreams((prev)=>{ const next={...prev}; delete next[userId]; return next; });
      }
    };
    peersRef.current[userId] = peer;
    return peer;
  };

  const callUser = async (userId) => {
    const peer = createPeer(userId);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("webrtc-offer", { target:userId, offer });
  };

  const refreshDevices = async () => {
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices({
      cameras:list.filter((d)=>d.kind==="videoinput"),
      microphones:list.filter((d)=>d.kind==="audioinput"),
    });
  };

  const startSpeakingMonitor = (stream) => {
    try { audioContextRef.current?.close(); } catch {}
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      audioContextRef.current = ctx;
      let last = false;
      const tick = () => {
        if (cleanupRef.current) return;
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a,b)=>a+b,0)/data.length;
        const speaking = micEnabledRef.current && avg > 18;
        if (speaking !== last) {
          last = speaking;
          socket.emit("speaking-status", { roomId:meeting.roomId, speaking });
        }
        requestAnimationFrame(tick);
      };
      tick();
    } catch {}
  };

  const replaceTrack = async (kind, newTrack) => {
    for (const peer of Object.values(peersRef.current)) {
      const sender = peer.getSenders().find((s)=>s.track?.kind===kind);
      if (sender) await sender.replaceTrack(newTrack);
    }
  };

  const switchCameraDevice = async (deviceId) => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video:{deviceId:{exact:deviceId}}, audio:false });
      const newTrack = s.getVideoTracks()[0];
      const oldTrack = localStreamRef.current?.getVideoTracks()[0];
      if (oldTrack) { localStreamRef.current.removeTrack(oldTrack); oldTrack.stop(); }
      localStreamRef.current?.addTrack(newTrack);
      await replaceTrack("video", newTrack);
      if (!screenSharing && localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      setSelectedCamera(deviceId);
    } catch { setNotice("Unable to switch camera."); }
  };

  const switchMicDevice = async (deviceId) => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video:false,
        audio:{ deviceId:{exact:deviceId}, echoCancellation:true, noiseSuppression:true, autoGainControl:true }
      });
      const newTrack = s.getAudioTracks()[0];
      const oldTrack = localStreamRef.current?.getAudioTracks()[0];
      if (oldTrack) { localStreamRef.current.removeTrack(oldTrack); oldTrack.stop(); }
      newTrack.enabled = micOn;
      localStreamRef.current?.addTrack(newTrack);
      await replaceTrack("audio", newTrack);
      setSelectedMic(deviceId);
      startSpeakingMonitor(localStreamRef.current);
    } catch { setNotice("Unable to switch microphone."); }
  };

  const switchFacing = async () => {
    const next = facingMode==="user" ? "environment" : "user";
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video:{facingMode:{ideal:next}}, audio:false });
      const track = s.getVideoTracks()[0];
      const oldTrack = localStreamRef.current?.getVideoTracks()[0];
      if (oldTrack) { localStreamRef.current.removeTrack(oldTrack); oldTrack.stop(); }
      localStreamRef.current?.addTrack(track);
      await replaceTrack("video", track);
      if (!screenSharing && localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      setFacingMode(next);
    } catch { setNotice("Front/rear camera switching is not available on this device."); }
  };

  useEffect(() => {
    let mounted = true;
    cleanupRef.current = false;

    const timer = setInterval(()=>setDuration((d)=>d+1),1000);
    const statsTimer = setInterval(async ()=>{
      let loss=0,rtt=0,samples=0;
      for (const peer of Object.values(peersRef.current)) {
        try {
          const stats = await peer.getStats();
          stats.forEach((r)=>{
            if (r.type==="remote-inbound-rtp" && r.kind==="video") {
              if (typeof r.fractionLost==="number") loss += r.fractionLost;
              if (typeof r.roundTripTime==="number") rtt += r.roundTripTime;
              samples++;
            }
          });
        } catch {}
      }
      if (!samples) return;
      const q = loss/samples>0.08 || rtt/samples>0.45 ? "Poor" : loss/samples>0.03 || rtt/samples>0.25 ? "Fair" : "Good";
      setQuality(q);
      for (const peer of Object.values(peersRef.current)) {
        for (const sender of peer.getSenders()) {
          if (sender.track?.kind!=="video") continue;
          const params=sender.getParameters();
          if (!params.encodings?.length) params.encodings=[{}];
          params.encodings[0].maxBitrate=q==="Poor"?250000:1200000;
          params.encodings[0].scaleResolutionDownBy=q==="Poor"?2:1;
          try { await sender.setParameters(params); } catch {}
        }
      }
    },4000);

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video:{width:{ideal:1280},height:{ideal:720}},
          audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}
        });
        if (!mounted) { stream.getTracks().forEach((t)=>t.stop()); return; }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        await refreshDevices();
        setSelectedCamera(stream.getVideoTracks()[0]?.getSettings().deviceId||"");
        setSelectedMic(stream.getAudioTracks()[0]?.getSettings().deviceId||"");
        startSpeakingMonitor(stream);
        socket.emit("join-room",{roomId:meeting.roomId,name:meeting.name,hostKey:meeting.hostKey||""});
      } catch (e) {
        setError(e.name==="NotAllowedError"?"Camera or microphone permission was denied.":
          e.name==="NotFoundError"?"No camera or microphone was found.":
          e.name==="NotReadableError"?"Camera or microphone is already in use.":"Unable to access camera or microphone.");
      }
    };

    const rejoin = () => {
      if (localStreamRef.current) socket.emit("join-room",{roomId:meeting.roomId,name:meeting.name,hostKey:meeting.hostKey||""});
    };

    const existing = async (users) => {
      for (const u of users) if (u.socketId!==socket.id) try { await callUser(u.socketId); } catch {}
    };
    const offer = async ({sender,offer}) => {
      const peer=createPeer(sender);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer=await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("webrtc-answer",{target:sender,answer});
    };
    const answer = async ({sender,answer}) => {
      const peer=peersRef.current[sender];
      if (peer) await peer.setRemoteDescription(new RTCSessionDescription(answer));
    };
    const ice = async ({sender,candidate}) => {
      const peer=peersRef.current[sender];
      if (peer) try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    };
    const left = ({socketId}) => {
      peersRef.current[socketId]?.close();
      delete peersRef.current[socketId];
      setRemoteStreams((prev)=>{const next={...prev};delete next[socketId];return next;});
    };
    const forceMute = () => {
      const track=localStreamRef.current?.getAudioTracks()[0];
      if (track) track.enabled=false;
      micEnabledRef.current=false; setMicOn(false); setNotice("The host muted your microphone.");
      socket.emit("media-status",{roomId:meeting.roomId,micOn:false,cameraOn});
    };
    const removed=()=>{alert("You were removed from the meeting.");stopResources();onLeave();};
    const ended=()=>{alert("The host ended the meeting.");stopResources();onLeave();};
    const denied=({reason})=>{alert(reason||"Unable to join.");stopResources();onLeave();};
    const receive=(msg)=>setMessages((prev)=>[...prev,msg]);

    socket.on("connect",rejoin);
    socket.on("existing-users",existing);
    socket.on("webrtc-offer",offer);
    socket.on("webrtc-answer",answer);
    socket.on("ice-candidate",ice);
    socket.on("participants",setParticipants);
    socket.on("room-settings",setSettings);
    socket.on("user-left",left);
    socket.on("force-mute",forceMute);
    socket.on("removed-from-meeting",removed);
    socket.on("meeting-ended",ended);
    socket.on("join-denied",denied);
    socket.on("receive-message",receive);

    init();

    return () => {
      mounted=false; clearInterval(timer); clearInterval(statsTimer);
      socket.off("connect",rejoin); socket.off("existing-users",existing); socket.off("webrtc-offer",offer);
      socket.off("webrtc-answer",answer); socket.off("ice-candidate",ice); socket.off("participants",setParticipants);
      socket.off("room-settings",setSettings); socket.off("user-left",left); socket.off("force-mute",forceMute);
      socket.off("removed-from-meeting",removed); socket.off("meeting-ended",ended); socket.off("join-denied",denied);
      socket.off("receive-message",receive);
      stopResources();
    };
  }, [meeting]);

  useEffect(()=>{
    const h=()=>refreshDevices().catch(()=>{});
    navigator.mediaDevices?.addEventListener?.("devicechange",h);
    return ()=>navigator.mediaDevices?.removeEventListener?.("devicechange",h);
  },[]);

  const toggleMic=()=>{
    const track=localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled=!track.enabled; micEnabledRef.current=track.enabled; setMicOn(track.enabled);
    socket.emit("media-status",{roomId:meeting.roomId,micOn:track.enabled,cameraOn});
  };
  const toggleCamera=()=>{
    const track=localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled=!track.enabled; setCameraOn(track.enabled);
    socket.emit("media-status",{roomId:meeting.roomId,micOn,cameraOn:track.enabled});
  };

  const startShare=async()=>{
    if (!settings.screenShareEnabled && !canModerate) return setNotice("Screen sharing is disabled by the host.");
    try {
      const s=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
      screenStreamRef.current=s;
      const track=s.getVideoTracks()[0];
      await replaceTrack("video",track);
      if (localVideoRef.current) localVideoRef.current.srcObject=s;
      setScreenSharing(true);
      track.onended=stopShare;
    } catch {}
  };
  const stopShare=async()=>{
    const track=localStreamRef.current?.getVideoTracks()[0];
    if (track) await replaceTrack("video",track);
    screenStreamRef.current?.getTracks().forEach((t)=>t.stop());
    screenStreamRef.current=null;
    if (localVideoRef.current&&localStreamRef.current) localVideoRef.current.srcObject=localStreamRef.current;
    setScreenSharing(false);
  };

  const toggleHand=()=>{
    const value=!handRaised; setHandRaised(value);
    socket.emit("toggle-hand",{roomId:meeting.roomId,handRaised:value});
  };

  const sendMessage=()=>{
    const text=messageText.trim();
    if (!text) return;
    if (!settings.chatEnabled&&!canModerate) return setNotice("Chat is disabled by the host.");
    socket.emit("send-message",{roomId:meeting.roomId,message:text,senderName:meeting.name});
    setMessageText("");
  };

  const sendFile=(file)=>{
    if (!file) return;
    if (!settings.chatEnabled&&!canModerate) return setNotice("Chat is disabled by the host.");
    if (file.size>MAX_FILE_BYTES) return alert("Files must be 2 MB or smaller.");
    const reader=new FileReader();
    reader.onload=()=>socket.emit("send-file",{roomId:meeting.roomId,senderName:meeting.name,file:{name:file.name,type:file.type||"application/octet-stream",size:file.size,dataUrl:reader.result}});
    reader.readAsDataURL(file);
  };

  const startRecording=()=>{
    if (!me?.isHost) return setNotice("Only the host can create a local recording.");
    if (!window.MediaRecorder||!localStreamRef.current) return alert("Recording is not supported.");
    chunksRef.current=[];
    const recorder=new MediaRecorder(localStreamRef.current);
    recorderRef.current=recorder;
    recorder.ondataavailable=(e)=>e.data.size&&chunksRef.current.push(e.data);
    recorder.onstop=()=>{
      const blob=new Blob(chunksRef.current,{type:recorder.mimeType||"video/webm"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a"); a.href=url; a.download=`StreamSphere-${meeting.roomId}-${Date.now()}.webm`; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    recorder.start(); setRecording(true);
  };
  const stopRecording=()=>{ if (recorderRef.current?.state!=="inactive") recorderRef.current?.stop(); setRecording(false); };

  const hostAction=(event,payload={})=>socket.emit(event,{roomId:meeting.roomId,hostKey:meeting.hostKey||"",...payload});
  const leave=()=>{stopResources();onLeave();};
  const openPanel=(name)=>setPanel((p)=>p===name?"":name);

  return (
    <main className="meeting-shell">
      <header className="meeting-topbar">
        <div><strong>Room {meeting.roomId}</strong><span>{me?.isHost?"Host":me?.isCoHost?"Co-host":"Participant"}</span></div>
        <div className="meeting-header-info">
          <div className={`quality-pill quality-${quality.toLowerCase()}`}>● {quality}</div>
          <div className="call-duration">◷ {formatDuration(duration)}</div>
          <div className="live-pill">LIVE</div>
        </div>
      </header>

      {notice&&<div className="notice-bar"><span>{notice}</span><button onClick={()=>setNotice("")}>×</button></div>}

      <section className={`meeting-layout ${panel?"panel-layout-open":""}`}>
        <div className="video-stage">
          {error&&<div className="error-card">{error}</div>}
          <div className="video-grid">
            <div className={`video-card ${me?.speaking?"speaking-card":""}`}>
              <video ref={localVideoRef} autoPlay playsInline muted/>
              <div className="video-label">{meeting.name} • You{me?.isHost?" • Host":me?.isCoHost?" • Co-host":""}{handRaised?" • ✋":""}{screenSharing?" • Sharing":""}</div>
            </div>

            {Object.entries(remoteStreams).map(([userId,stream])=>{
              const p=participants.find((x)=>x.socketId===userId);
              return <RemoteVideo key={userId} stream={stream} participant={p}/>;
            })}
          </div>

          <div className="controls">
            <button className={`meet-control ${!micOn ? "control-off" : ""}`} onClick={toggleMic} aria-label={micOn ? "Mute microphone" : "Unmute microphone"} title={micOn ? "Mute microphone" : "Unmute microphone"}>
              {micOn ? (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M8 21h8"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1"/><path d="M15 9.3V5a3 3 0 0 0-5.6-1.5"/><path d="M5 11a7 7 0 0 0 11.8 5.1"/><path d="M19 11a7 7 0 0 1-.5 2.6"/><path d="M12 18v3"/><path d="M8 21h8"/></svg>
              )}
            </button>
            <button className={`meet-control ${!cameraOn ? "control-off" : ""}`} onClick={toggleCamera} aria-label={cameraOn ? "Turn camera off" : "Turn camera on"} title={cameraOn ? "Turn camera off" : "Turn camera on"}>
              {cameraOn ? (
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"/><path d="M16 16H5a2 2 0 0 1-2-2V8c0-1.1.9-2 2-2h3"/><path d="M16 8v2l5-3v10l-3.5-2.1"/></svg>
              )}
            </button>
            <button className={`meet-control ${screenSharing ? "active-control" : ""}`} onClick={screenSharing ? stopShare : startShare} aria-label={screenSharing ? "Stop screen sharing" : "Share screen"} title={screenSharing ? "Stop sharing" : "Share screen"}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/><path d="m8 11 4-4 4 4"/><path d="M12 7v7"/></svg>
            </button>
            <button className={`meet-control ${handRaised ? "active-control" : ""}`} onClick={toggleHand} aria-label={handRaised ? "Lower hand" : "Raise hand"} title={handRaised ? "Lower hand" : "Raise hand"}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11V5a2 2 0 1 1 4 0v5"/><path d="M12 10V4a2 2 0 1 1 4 0v7"/><path d="M16 11V6a2 2 0 1 1 4 0v7c0 5-3.2 8-8 8-3.8 0-6-2.1-7.7-5.2L2.6 13a2 2 0 0 1 3.1-2.4L8 13"/></svg>
            </button>
            <button className={`meet-control ${panel === "chat" ? "active-control" : ""}`} onClick={()=>openPanel("chat")} aria-label="Open chat" title="Chat">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/></svg>
            </button>
            <button className={`meet-control ${panel === "devices" ? "active-control" : ""}`} onClick={()=>openPanel("devices")} aria-label="Device settings" title="Devices">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4a1.7 1.7 0 0 0 1-1.6V2.2h4v.2A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.9.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>
            </button>
            {canModerate&&<button className={`meet-control ${panel === "host" ? "active-control" : ""}`} onClick={()=>openPanel("host")} aria-label="Host controls" title="Host controls">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-4"/></svg>
            </button>}
            {me?.isHost&&<button className={`meet-control ${recording ? "recording-control" : ""}`} onClick={recording?stopRecording:startRecording} aria-label={recording ? "Stop recording" : "Start recording"} title={recording ? "Stop recording" : "Record"}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg>
            </button>}
            <button className="leave-control" onClick={leave} aria-label="Leave meeting" title="Leave meeting">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 14.5c4.3-3.1 8.7-3.1 13 0"/><path d="M5.5 14.5 3 17.5l3.5 2 2.1-3.1"/><path d="m18.5 14.5 2.5 3-3.5 2-2.1-3.1"/></svg>
            </button>
          </div>
        </div>

        <aside className="sidebar">
  <div className="participants-header">
    <h3>Participants</h3>

    <span className="participant-count">
      {participants.length}
    </span>
  </div>

  <div className="participant-list">
    {participants.map((p) => (
      <div
        className={`participant ${
          p.handRaised
            ? "hand-raised-participant"
            : ""
        }`}
        key={p.socketId}
      >
        <div
          className={`avatar ${
            p.speaking
              ? "speaking-avatar"
              : ""
          }`}
        >
          {p.name
            ?.charAt(0)
            .toUpperCase()}
        </div>

        <div className="participant-copy">
          <div className="participant-name-row">
            <strong>
              {p.name}
            </strong>

            {p.handRaised && (
              <span className="raised-hand">
                ✋
              </span>
            )}
          </div>

          <span>
            {p.isHost
              ? "Host"
              : p.isCoHost
              ? "Co-host"
              : "Participant"}
          </span>
        </div>

        <div className="status-icons">
          {p.micOn ? (
            <svg
              viewBox="0 0 24 24"
              aria-label="Microphone on"
            >
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
              <path d="M8 21h8" />
            </svg>
          ) : (
            <svg
              className="status-off"
              viewBox="0 0 24 24"
              aria-label="Microphone off"
            >
              <path d="m3 3 18 18" />
              <path d="M9 9v2a3 3 0 0 0 5.1 2.1" />
              <path d="M15 9.3V5a3 3 0 0 0-5.6-1.5" />
              <path d="M5 11a7 7 0 0 0 11.8 5.1" />
              <path d="M19 11a7 7 0 0 1-.5 2.6" />
              <path d="M12 18v3" />
              <path d="M8 21h8" />
            </svg>
          )}

          {p.cameraOn ? (
            <svg
              viewBox="0 0 24 24"
              aria-label="Camera on"
            >
              <rect
                x="3"
                y="6"
                width="13"
                height="12"
                rx="2"
              />

              <path d="m16 10 5-3v10l-5-3" />
            </svg>
          ) : (
            <svg
              className="status-off"
              viewBox="0 0 24 24"
              aria-label="Camera off"
            >
              <path d="m3 3 18 18" />

              <path d="M16 16H5a2 2 0 0 1-2-2V8c0-1.1.9-2 2-2h3" />

              <path d="M16 8v2l5-3v10l-3.5-2.1" />
            </svg>
          )}
        </div>
      </div>
    ))}
  </div>
</aside>
        {panel==="chat"&&(
          <aside className="side-panel">
            <div className="panel-header"><div><p className="side-eyebrow">Meeting</p><h3>Chat</h3></div><button onClick={()=>setPanel("")}>×</button></div>
            <div className="chat-messages">
              {messages.length===0?<div className="chat-empty"><strong>No messages yet</strong><p>Start the conversation.</p></div>:
                messages.map((m)=>(
                  <div className={`chat-message ${m.senderId===socket.id?"own-message":""}`} key={m.id}>
                    <div className="chat-message-top"><strong>{m.senderId===socket.id?"You":m.senderName}</strong><span>{new Date(m.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span></div>
                    {m.type==="file"?<a className="file-message" href={m.file.dataUrl} download={m.file.name}>📎 {m.file.name} <small>{Math.ceil(m.file.size/1024)} KB</small></a>:<p>{m.message}</p>}
                  </div>
                ))
              }
            </div>
            <div className="emoji-row">{["👍","👏","❤️","😂","🎉","✅"].map((e)=><button key={e} onClick={()=>setMessageText((p)=>p+e)}>{e}</button>)}</div>
            <div className="file-row"><label className="file-button">📎 Attach<input type="file" hidden onChange={(e)=>sendFile(e.target.files?.[0])}/></label></div>
            <div className="chat-input-row"><input disabled={!settings.chatEnabled&&!canModerate} value={messageText} onChange={(e)=>setMessageText(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&sendMessage()} placeholder={settings.chatEnabled||canModerate?"Type a message...":"Chat disabled by host"}/><button onClick={sendMessage}>Send</button></div>
          </aside>
        )}

        {panel==="devices"&&(
          <aside className="side-panel">
            <div className="panel-header"><div><p className="side-eyebrow">Hardware</p><h3>Devices</h3></div><button onClick={()=>setPanel("")}>×</button></div>
            <div className="device-form">
              <label>Camera</label>
              <select value={selectedCamera} onChange={(e)=>switchCameraDevice(e.target.value)}>{devices.cameras.map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}</select>
              <button className="secondary" onClick={switchFacing}>↺ Switch front / rear</button>
              <label>Microphone</label>
              <select value={selectedMic} onChange={(e)=>switchMicDevice(e.target.value)}>{devices.microphones.map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||`Microphone ${i+1}`}</option>)}</select>
              <div className="security-note"><strong>Secure transport</strong><p>WebRTC media is encrypted in transit using DTLS-SRTP. StreamSphere does not claim a custom encryption protocol.</p></div>
            </div>
          </aside>
        )}

        {panel==="host"&&canModerate&&(
          <aside className="side-panel">
            <div className="panel-header"><div><p className="side-eyebrow">Moderation</p><h3>Host controls</h3></div><button onClick={()=>setPanel("")}>×</button></div>
            <div className="host-setting"><span>Meeting lock</span><button onClick={()=>hostAction("set-room-setting",{setting:"locked",value:!settings.locked})}>{settings.locked?"Unlock":"Lock"}</button></div>
            <div className="host-setting"><span>Participant chat</span><button onClick={()=>hostAction("set-room-setting",{setting:"chatEnabled",value:!settings.chatEnabled})}>{settings.chatEnabled?"Disable":"Enable"}</button></div>
            <div className="host-setting"><span>Screen sharing</span><button onClick={()=>hostAction("set-room-setting",{setting:"screenShareEnabled",value:!settings.screenShareEnabled})}>{settings.screenShareEnabled?"Disable":"Enable"}</button></div>
            <div className="host-participants">
              {participants.filter((p)=>p.socketId!==socket.id).map((p)=>(
                <div className="host-person" key={p.socketId}>
                  <div><strong>{p.name}</strong><span>{p.isCoHost?"Co-host":"Participant"}</span></div>
                  <div className="host-actions">
                    <button onClick={()=>hostAction("host-mute",{target:p.socketId})}>Mute</button>
                    {me?.isHost&&<button onClick={()=>hostAction("set-cohost",{target:p.socketId,value:!p.isCoHost})}>{p.isCoHost?"Remove co-host":"Make co-host"}</button>}
                    <button className="remove-btn" onClick={()=>hostAction("remove-participant",{target:p.socketId})}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            {me?.isHost&&<button className="end-meeting" onClick={()=>hostAction("end-meeting")}>End meeting for everyone</button>}
          </aside>
        )}
      </section>
    </main>
  );
}

function RemoteVideo({ stream, participant }) {
  const ref=useRef(null);
  useEffect(()=>{ if(ref.current&&stream) ref.current.srcObject=stream; return()=>{if(ref.current)ref.current.srcObject=null;};},[stream]);
  return <div className={`video-card ${participant?.speaking?"speaking-card":""}`}><video ref={ref} autoPlay playsInline/><div className="video-label">{participant?.name||"Participant"}{participant?.isCoHost?" • Co-host":""}{participant?.handRaised?" • ✋":""}</div></div>;
}
