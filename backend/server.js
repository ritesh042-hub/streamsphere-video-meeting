const express = require("express");
const http = require("http");
const cors = require("cors");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json({ limit: "3mb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin:"http://localhost:5173", methods:["GET","POST"] },
  maxHttpBufferSize: 3e6,
});

const rooms = new Map();

function makeRoomId() {
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id="";
  do { id=Array.from({length:8},()=>chars[Math.floor(Math.random()*chars.length)]).join(""); }
  while(rooms.has(id));
  return id;
}
const clean=(v)=>String(v||"").trim().toUpperCase();
const settings=(room)=>({locked:room.locked,chatEnabled:room.chatEnabled,screenShareEnabled:room.screenShareEnabled,maxParticipants:room.maxParticipants});

function broadcast(id) {
  const room=rooms.get(id); if(!room)return;
  io.to(id).emit("participants",[...room.participants.values()]);
  io.to(id).emit("room-settings",settings(room));
}
function moderator(room,socketId,hostKey) {
  const p=room.participants.get(socketId);
  return Boolean(p?.isHost||p?.isCoHost||(hostKey&&room.hostKey===hostKey));
}
function host(room,socketId,hostKey) {
  const p=room.participants.get(socketId);
  return Boolean(p?.isHost||(hostKey&&room.hostKey===hostKey));
}

app.get("/",(req,res)=>res.json({status:"online",service:"StreamSphere Meeting API"}));

app.post("/api/rooms",(req,res)=>{
  const roomId=makeRoomId();
  const hostKey=String(req.body.hostKey||crypto.randomUUID());
  const maxParticipants=Math.min(Math.max(Number(req.body.maxParticipants)||8,2),20);
  rooms.set(roomId,{roomId,hostKey,locked:false,chatEnabled:true,screenShareEnabled:true,maxParticipants,createdAt:Date.now(),emptySince:Date.now(),participants:new Map()});
  res.status(201).json({roomId,maxParticipants});
});

io.on("connection",(socket)=>{
  socket.on("join-room",({roomId,name,hostKey})=>{
    const id=clean(roomId), room=rooms.get(id);
    if(!room) return socket.emit("join-denied",{reason:"This meeting does not exist or has ended."});
    const isHost=Boolean(hostKey&&room.hostKey===hostKey);
    const exists=room.participants.has(socket.id);
    if(!exists&&room.locked&&!isHost) return socket.emit("join-denied",{reason:"This meeting is locked by the host."});
    if(!exists&&room.participants.size>=room.maxParticipants) return socket.emit("join-denied",{reason:"This meeting has reached its participant limit."});

    const existingUsers=[...room.participants.values()].filter((p)=>p.socketId!==socket.id);
    socket.join(id); socket.data.roomId=id; socket.data.name=String(name||"Participant");
    room.participants.set(socket.id,{
      socketId:socket.id,name:String(name||"Participant").slice(0,60),isHost,isCoHost:false,
      micOn:true,cameraOn:true,handRaised:false,speaking:false
    });
    room.emptySince=null;
    socket.emit("existing-users",existingUsers);
    socket.to(id).emit("user-joined",room.participants.get(socket.id));
    broadcast(id);
  });

  socket.on("webrtc-offer",({target,offer})=>io.to(target).emit("webrtc-offer",{sender:socket.id,offer}));
  socket.on("webrtc-answer",({target,answer})=>io.to(target).emit("webrtc-answer",{sender:socket.id,answer}));
  socket.on("ice-candidate",({target,candidate})=>io.to(target).emit("ice-candidate",{sender:socket.id,candidate}));

  socket.on("media-status",({roomId,micOn,cameraOn})=>{
    const id=clean(roomId),room=rooms.get(id),p=room?.participants.get(socket.id); if(!p)return;
    p.micOn=Boolean(micOn); p.cameraOn=Boolean(cameraOn); broadcast(id);
  });
  socket.on("speaking-status",({roomId,speaking})=>{
    const id=clean(roomId),room=rooms.get(id),p=room?.participants.get(socket.id); if(!p)return;
    p.speaking=Boolean(speaking); broadcast(id);
  });
  socket.on("toggle-hand",({roomId,handRaised})=>{
    const id=clean(roomId),room=rooms.get(id),p=room?.participants.get(socket.id); if(!p)return;
    p.handRaised=Boolean(handRaised); broadcast(id);
  });

  socket.on("send-message",({roomId,message,senderName})=>{
    const id=clean(roomId),room=rooms.get(id),p=room?.participants.get(socket.id); if(!room||!p)return;
    if(!room.chatEnabled&&!p.isHost&&!p.isCoHost)return;
    const text=String(message||"").trim().slice(0,2000); if(!text)return;
    io.to(id).emit("receive-message",{id:crypto.randomUUID(),type:"text",senderId:socket.id,senderName:String(senderName||p.name),message:text,time:new Date().toISOString()});
  });

  socket.on("send-file",({roomId,senderName,file})=>{
    const id=clean(roomId),room=rooms.get(id),p=room?.participants.get(socket.id); if(!room||!p)return;
    if(!room.chatEnabled&&!p.isHost&&!p.isCoHost)return;
    if(!file||Number(file.size)>2*1024*1024||typeof file.dataUrl!=="string"||!file.dataUrl.startsWith("data:"))return;
    io.to(id).emit("receive-message",{id:crypto.randomUUID(),type:"file",senderId:socket.id,senderName:String(senderName||p.name),
      file:{name:String(file.name||"file").slice(0,120),type:String(file.type||"application/octet-stream").slice(0,100),size:Number(file.size)||0,dataUrl:file.dataUrl},
      time:new Date().toISOString()});
  });

  socket.on("host-mute",({roomId,hostKey,target})=>{
    const id=clean(roomId),room=rooms.get(id); if(!room||!moderator(room,socket.id,hostKey))return;
    io.to(target).emit("force-mute");
  });
  socket.on("remove-participant",({roomId,hostKey,target})=>{
    const id=clean(roomId),room=rooms.get(id); if(!room||!moderator(room,socket.id,hostKey))return;
    const t=room.participants.get(target); if(!t||t.isHost)return;
    room.participants.delete(target); io.to(target).emit("removed-from-meeting"); io.in(target).socketsLeave(id);
    io.to(id).emit("user-left",{socketId:target}); broadcast(id);
  });
  socket.on("set-cohost",({roomId,hostKey,target,value})=>{
    const id=clean(roomId),room=rooms.get(id); if(!room||!host(room,socket.id,hostKey))return;
    const t=room.participants.get(target); if(!t||t.isHost)return; t.isCoHost=Boolean(value); broadcast(id);
  });
  socket.on("set-room-setting",({roomId,hostKey,setting,value})=>{
    const id=clean(roomId),room=rooms.get(id); if(!room||!moderator(room,socket.id,hostKey))return;
    if(!["locked","chatEnabled","screenShareEnabled"].includes(setting))return;
    room[setting]=Boolean(value); broadcast(id);
  });
  socket.on("end-meeting",({roomId,hostKey})=>{
    const id=clean(roomId),room=rooms.get(id); if(!room||!host(room,socket.id,hostKey))return;
    io.to(id).emit("meeting-ended"); io.in(id).socketsLeave(id); rooms.delete(id);
  });

  const leave=(id)=>{
    const room=rooms.get(id); if(!room)return;
    room.participants.delete(socket.id); socket.to(id).emit("user-left",{socketId:socket.id});
    if(room.participants.size===0) room.emptySince=Date.now(); else broadcast(id);
  };
  socket.on("leave-room",({roomId})=>{const id=clean(roomId);socket.leave(id);leave(id);});
  socket.on("disconnect",()=>leave(socket.data.roomId));
});

setInterval(()=>{
  const now=Date.now();
  for(const [id,room] of rooms) if(room.emptySince&&now-room.emptySince>30*60*1000) rooms.delete(id);
},60000);

server.listen(5000,()=>console.log("StreamSphere backend started at http://localhost:5000"));
