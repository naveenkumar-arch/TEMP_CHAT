import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import QRCode from 'qrcode';
import { 
  MessageSquare, User, Check, CheckCheck, Send, Mic, Smile, 
  Sun, Moon, Info, X, Shield, Clock, Search, ArrowLeft
} from 'lucide-react';
import './index.css';

type Screen = 1 | 2 | 3;
type Theme = 'dark' | 'light';

interface Message {
  id: number;
  text: string;
  type: 'sent' | 'received';
  timestamp: number;
  status: 'sending' | 'sent' | 'delivered';
}

function App() {
  const [screen, setScreen] = useState<Screen>(1);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('tempchat-theme') as Theme) || 'dark');
  
  const [myId, setMyId] = useState('');
  const [myIdError, setMyIdError] = useState('');
  const [peerIdInput, setPeerIdInput] = useState('');
  const [peerId, setPeerId] = useState('');
  
  const [isInitializing, setIsInitializing] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [_isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{type: 'loading'|'success'|'error', text: string} | null>(null);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [forceRelay, setForceRelay] = useState(false);
  
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const msgIdCounter = useRef(0);
  const sessionStartRef = useRef<number | null>(null);

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem('tempchat-theme', theme);
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectTo = params.get('connect');
    if (connectTo) setPeerIdInput(connectTo);

    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const generateRandomId = () => {
    const rnd = Math.random().toString(36).substring(2,8).toUpperCase() + Math.floor(10 + Math.random()*90);
    setMyId(rnd);
    setMyIdError('');
  };

  // Auto-Update Logic: Check for new version every 5 minutes
  useEffect(() => {
    const currentVersion = "1.0.1";
    const checkVersion = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.version && data.version !== currentVersion) {
            // New version detected! If not in chat, reload.
            if (screen !== 3) {
              window.location.reload();
            }
          }
        }
      } catch (e) {}
    };
    const interval = setInterval(checkVersion, 1000 * 60 * 5); // 5 mins
    return () => clearInterval(interval);
  }, [screen]);

  const initPeer = async () => {
    const id = myId.trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      setMyIdError('Only letters and numbers allowed'); return;
    }
    if (id.length < 3) {
      setMyIdError('ID must be at least 3 characters'); return;
    }

    setMyIdError('');
    setIsInitializing(true);

    // Fallback TURN servers (community free — may be rate-limited)
    const fallbackIceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'turn:openrelay.metered.ca:80',                  username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443',                 username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp',   username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:80?transport=tcp',    username: 'openrelayproject', credential: 'openrelayproject' },
    ];

    // Fetch fresh TURN credentials from your dedicated Metered account
    let iceServers: RTCIceServer[] = fallbackIceServers;
    try {
      const res = await fetch("https://temp_chat.metered.live/api/v1/turn/credentials?apiKey=5312310ec55cc3294ad33497a6058e3e333d");
      if (res.ok) {
        const creds = await res.json();
        if (Array.isArray(creds) && creds.length > 0) {
          // Merge Metered servers with Google STUN for maximum reliability
          iceServers = [...fallbackIceServers, ...creds];
        }
      }
    } catch (err) {
      console.error("Failed to fetch TURN credentials:", err);
      console.warn("Using fallback ICE servers");
    }

    console.log("Initializing Peer with ICE Servers count:", iceServers.length);

    const peer = new Peer(id, {
      host: 'peerjs.com',
      port: 443,
      secure: true,
      key: 'peerjs',
      debug: 3,
      config: { 
        iceServers, 
        iceTransportPolicy: forceRelay ? 'relay' : 'all',
        iceCandidatePoolSize: 10
      },
    });

    // Capture logs for UI display on error
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => {
      originalLog(...args);
      setDebugLogs(prev => [...prev.slice(-4), args.join(' ')]);
    };
    console.error = (...args) => {
      originalError(...args);
      setDebugLogs(prev => [...prev.slice(-4), args.join(' ')]);
    };
    peerRef.current = peer;

    peer.on('open', (assignedId) => {
      setMyId(assignedId);
      setScreen(2);
      setIsInitializing(false);
      setIsReconnecting(false);
      setTimeout(() => generateQR(assignedId), 100);
    });

    // Signaling server dropped — automatically reconnect with same ID
    peer.on('disconnected', () => {
      if (!peer.destroyed) {
        setIsReconnecting(true);
        setTimeout(() => {
          if (!peer.destroyed) peer.reconnect();
        }, 2000);
      }
    });

    peer.on('error', (err) => {
      const networkErrors = ['network', 'server-error', 'socket-error', 'socket-closed'];
      if (err.type === 'unavailable-id') {
        setMyIdError('That ID is already taken');
        setIsInitializing(false);
      } else if (networkErrors.includes(err.type)) {
        setMyIdError('Network hiccup — reconnecting...');
        setIsReconnecting(true);
        setIsInitializing(false);
      } else {
        setMyIdError('Connection failed: ' + err.message);
        setIsInitializing(false);
      }
    });

    peer.on('connection', (conn) => {
      // If we're already in a chat, only allow a new connection if it's from the SAME peer
      // (helps recover from ghost connections or page refreshes)
      if (connRef.current && connRef.current.peer !== conn.peer && connRef.current.open) {
        console.warn("Rejecting connection: already busy with", connRef.current.peer);
        conn.close();
        return;
      }
      
      console.log("Incoming connection from", conn.peer);
      acceptConnection(conn);
    });
  };

  const generateQR = (id: string) => {
    if (!qrCanvasRef.current) return;
    const url = window.location.origin + window.location.pathname + '?connect=' + id;
    QRCode.toCanvas(qrCanvasRef.current, url, {
      width: 160, margin: 0,
      color: { dark: '#111b21', light: '#ffffff' }
    });
  };

  const acceptConnection = (conn: DataConnection) => {
    setPeerId(conn.peer);

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      setupConnection(conn);
    };

    // Don't check conn.open synchronously — it's often false on mobile at this point
    const poll = setInterval(() => {
      if (conn.open) settle();
    }, 500);

    conn.on('open', settle);
    conn.on('error', () => { settled = true; clearInterval(poll); });
    
    // Safety timeout — if connection negotiation takes too long, clean up
    setTimeout(() => { settled = true; clearInterval(poll); }, 60000);
  };

  const connectToPeer = () => {
    const id = peerIdInput.trim();
    if (!id) return;
    if (id === myId) {
      setConnectionStatus({type: 'error', text: 'Cannot connect to yourself'}); return;
    }

    setConnectionStatus({type: 'loading', text: `Reaching ${id}...`});
    setPeerId(id);

    if (!peerRef.current) return;
    const conn = peerRef.current.connect(id, { 
      serialization: 'json' 
    });

    // Guard: ensure setupConnection only runs once
    let settled = false;
    const settle = (success: boolean, errMsg?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(openPoll);
      if (success) {
        setupConnection(conn);
      } else if (errMsg) {
        setConnectionStatus({ type: 'error', text: errMsg });
      }
    };

    const timeout = setTimeout(() => {
      console.error("Connection attempt timed out after 45s");
      settle(false, 'Connection timed out. This usually happens if a firewall is blocking the connection or the other peer disconnected. Try refreshing on both sides.');
      conn.close();
    }, 45000);

    // PeerJS bug: conn.on('open') sometimes never fires on the initiator side
    // even though the connection IS open. Poll as a fallback.
    const openPoll = setInterval(() => {
      if (conn.open) settle(true);
    }, 300);

    conn.on('open', () => settle(true));

    conn.on('error', (err: any) => {
      settle(false, err?.type === 'peer-unavailable'
        ? `Peer "${id}" not found or offline`
        : `${id} not found or offline`);
    });
  };

  const setupConnection = (conn: DataConnection) => {
    connRef.current = conn;
    setIsConnected(true);
    setConnectionStatus({type: 'success', text: `Connected securely to ${conn.peer}`});
    sessionStartRef.current = Date.now();
    
    setTimeout(() => setScreen(3), 600);

    // Keep-alive ping to prevent NAT timeouts on mobile networks
    const pingInterval = setInterval(() => {
      if (conn.open) {
        try { conn.send({ type: 'ping' }); } catch (e) {}
      } else {
        clearInterval(pingInterval);
      }
    }, 3000);

    conn.on('data', (data: any) => {
      if (data.type === 'ping') return; // Ignore pings
      
      if (data.type === 'message') {
        const newMsg: Message = { id: data.id, text: data.text, timestamp: data.timestamp, type: 'received', status: 'delivered' };
        setMessages(prev => [...prev, newMsg]);
        conn.send({ type: 'ack', id: data.id });
        setIsTyping(false);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      }
      else if (data.type === 'ack') {
        setMessages(prev => prev.map(m => m.id === data.id ? { ...m, status: 'delivered' } : m));
      }
      else if (data.type === 'typing') {
        setIsTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 3000);
      }
    });

    conn.on('close', () => {
      console.log("Connection closed with peer");
      clearInterval(pingInterval);
      setIsConnected(false);
      setSessionEnded(true);
    });
  };

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text || !connRef.current) return;

    msgIdCounter.current += 1;
    const id = msgIdCounter.current;
    const msg: Message = { id, text, timestamp: Date.now(), type: 'sent', status: 'sending' };
    
    connRef.current.send({ type: 'message', id, text, timestamp: msg.timestamp });
    setMessages(prev => [...prev, msg]);
    setInputText('');
    
    // Simulate optimistic sent
    setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, status: 'sent' } : m));
    }, 200);
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (connRef.current && e.target.value.trim().length > 0) {
      connRef.current.send({ type: 'typing' });
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    let hours = d.getHours();
    let minutes: any = d.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
  };

  const endSession = () => {
    if (window.confirm('End this chat? All messages will be securely deleted.')) {
      if (connRef.current) connRef.current.close();
      setSessionEnded(true);
    }
  };

  return (
    <div className="app-wrapper">
      <div className="setup-bg"></div>

      {/* SCREEN 1: Setup */}
      <div className={`screen screen-center ${screen === 1 ? 'active' : 'past'}`} style={{display: screen === 1 ? 'flex' : 'none'}}>
        <div className="card">
          <div className="logo-block">
            <div className="logo-icon"><MessageSquare size={48} /></div>
            <div className="logo-title">TempChat</div>
            <div className="logo-tagline">Secure, peer-to-peer messaging.<br/>No servers, no logs.</div>
            <div style={{fontSize: '9px', color: 'var(--border)', marginTop: '8px'}}>Last Updated: May 16, 4:15 PM</div>
          </div>
          
          <div className="input-group">
            <label className="input-label">Your Temp ID</label>
            <input type="text" className="text-input" placeholder="e.g. nova99" value={myId} onChange={e => setMyId(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))} maxLength={20} />
            {myIdError && <div className="input-error" style={{display:'block'}}>{myIdError}</div>}
          </div>
          
          <button className="btn-secondary" onClick={generateRandomId}>
            <Search size={18} /> Generate Random
          </button>
          
          <button className="btn-primary" onClick={initPeer} disabled={isInitializing}>
            Continue
          </button>
          
          {isInitializing && (
            <div className="spinner-container">
              <div className="spinner"></div>
              <div className="spinner-text">Connecting to signaling server...</div>
            </div>
          )}

          {isReconnecting && (
            <div className="spinner-container">
              <div className="spinner" style={{borderTopColor: '#f0a500'}}></div>
              <div className="spinner-text" style={{color: '#f0a500'}}>Reconnecting to server...</div>
            </div>
          )}
        </div>
      </div>

      {/* SCREEN 2: Connect */}
      <div className={`screen screen-center ${screen === 2 ? 'active' : 'past'}`} style={{display: screen === 2 ? 'flex' : 'none'}}>
        <div className="card">
          <button className="back-btn" onClick={() => { if(peerRef.current) peerRef.current.destroy(); setScreen(1); }}>
            <ArrowLeft size={20} /> Back
          </button>

          <div className="input-label">Your Connection ID</div>
          <div className="id-badge">
            <div className="id-badge-left">
              <div className="status-dot online"></div>
              <div className="my-id-text">{myId}</div>
            </div>
            <button className="copy-icon-btn" onClick={() => navigator.clipboard.writeText(myId)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
          
          <div className="qr-block">
            <div className="input-label" style={{textAlign: 'center', marginBottom: '12px', fontSize: '12px'}}>Scan to connect directly</div>
            <canvas ref={qrCanvasRef} className="qr-canvas" width="160" height="160"></canvas>
          </div>
          
          <div style={{textAlign: 'center', color: 'var(--border)', fontSize: '13px', margin: '8px 0'}}>— OR —</div>
          
          <div className="input-group" style={{marginTop: '16px'}}>
            <label className="input-label" style={{display:'flex', alignItems:'center', gap:'8px', cursor:'pointer', marginBottom:'8px'}}>
              <input type="checkbox" checked={forceRelay} onChange={e => setForceRelay(e.target.checked)} />
              <span style={{fontSize:'12px'}}>Relay Mode (Fixes Mobile connection)</span>
            </label>
            <label className="input-label">Connect to Peer</label>
            <input type="text" className="text-input" placeholder="Enter their ID" value={peerIdInput} onChange={e => setPeerIdInput(e.target.value)} maxLength={20} />
          </div>
          
          <button className="btn-primary" onClick={connectToPeer}>
            Start Chat
          </button>
          
          {connectionStatus && (
            <div className="conn-status-area" style={{display:'flex'}}>
              <div className={`conn-msg ${connectionStatus.type === 'error' ? 'error' : connectionStatus.type === 'success' ? 'success' : ''}`}>
                {connectionStatus.type === 'loading' && <div style={{display:'flex', alignItems:'center', gap:'8px'}}><div className="spinner" style={{width:'16px',height:'16px'}}></div>{connectionStatus.text}</div>}
                {connectionStatus.type !== 'loading' && connectionStatus.text}
              </div>
              {connectionStatus.type === 'error' && (
                <div style={{display:'flex', flexDirection:'column', gap:'8px', width:'100%'}}>
                  <button 
                    className="btn-secondary" 
                    style={{width:'100%', padding:'8px 16px', margin:0}} 
                    onClick={connectToPeer}
                  >
                    Retry Connection
                  </button>
                  <div className="debug-log-view" style={{fontSize:'10px', color:'var(--text-secondary)', background:'rgba(0,0,0,0.1)', padding:'8px', borderRadius:'4px', marginTop:'8px', textAlign:'left'}}>
                    <strong>Debug Trace:</strong>
                    {debugLogs.map((log, i) => <div key={i} style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>• {log}</div>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SCREEN 3: Chat */}
      <div className={`screen ${screen === 3 ? 'active' : ''}`} style={{display: screen === 3 ? 'flex' : 'none'}}>
        <div className="chat-bg"></div>
        
        <div className="chat-header">
          <div className="header-profile"><User size={24} /></div>
          <div className="header-info">
            <div className="header-title">{peerId}</div>
            <div className="header-subtitle">Online</div>
          </div>
          <div className="header-right">
            <button className="icon-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button className="icon-btn" onClick={() => setShowInfo(!showInfo)}>
              <Info size={20} />
            </button>
            <button className="icon-btn danger" onClick={endSession}>
              <X size={20} />
            </button>
          </div>
        </div>
        
        <div className={`info-panel ${showInfo ? 'open' : ''}`}>
          <ul>
            <li><Shield size={18} /> <span><strong>End-to-End Encrypted:</strong> Messages never touch our servers. Sent peer-to-peer via WebRTC.</span></li>
            <li><Clock size={18} /> <span><strong>Ephemeral:</strong> Everything vanishes the moment this tab is closed. No history is saved.</span></li>
          </ul>
        </div>
        
        <div className="chat-messages">
          <div className="sys-msg"><div className="sys-msg-text"><Shield size={12} style={{display:'inline', marginRight:4}}/> Messages are end-to-end encrypted.</div></div>
          
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon"><MessageSquare size={40} /></div>
              <p>You're connected.<br/>Say hello to start chatting!</p>
            </div>
          )}
          
          {messages.map(msg => (
            <div key={msg.id} className={`msg-bubble ${msg.type === 'sent' ? 'msg-sent' : 'msg-recv'}`}>
              <div className="msg-text">{msg.text}</div>
              <div className="msg-meta">
                <span className="msg-time">{formatTime(msg.timestamp)}</span>
                {msg.type === 'sent' && (
                  <span className={`msg-status ${msg.status === 'delivered' ? 'read' : ''}`}>
                    {msg.status === 'sending' ? <Clock size={14} /> : msg.status === 'sent' ? <Check size={16} /> : <CheckCheck size={16} />}
                  </span>
                )}
              </div>
            </div>
          ))}
          
          {isTyping && (
            <div className="typing-indicator">
              <div className="typing-dot"></div><div className="typing-dot"></div><div className="typing-dot"></div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        
        <div className="chat-input-bar">
          <button className={`emoji-btn ${showEmoji ? 'active' : ''}`} onClick={() => setShowEmoji(!showEmoji)}>
            <Smile size={24} />
          </button>
          
          <div className="msg-input-container">
            <textarea 
              className="msg-input" 
              placeholder="Type a message" 
              value={inputText}
              onChange={handleInput}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              rows={1}
              maxLength={500}
            />
          </div>
          
          <div style={{position: 'relative', width: 44, height: 44, marginLeft: 8}}>
            <button className={`mic-btn ${inputText.trim().length > 0 ? 'hide' : ''}`}><Mic size={24} /></button>
            <button className={`send-btn ${inputText.trim().length > 0 ? 'active' : ''}`} onClick={sendMessage}>
              <Send size={20} style={{marginLeft: -2}} />
            </button>
          </div>
          
          {showEmoji && (
            <div className="emoji-picker open">
              {['😀','😂','😍','🥺','😎','😭','👍','👎','🙌','🤝','✌️','🤞','❤️','🔥','⚡','💯','✅','❌','🎉','🎯','💡','🔒','👀','🤔','😴','🥳','😤','🤯','👋','💬'].map(e => (
                <div key={e} className="emoji-cell" onClick={() => { setInputText(prev => prev + e); setShowEmoji(false); }}>{e}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {sessionEnded && (
        <div className="overlay" style={{display: 'flex'}}>
          <div className="ended-card">
            <div className="ended-icon"><Shield size={48} /></div>
            <h2>Session Ended</h2>
            <p>Duration: {sessionStartRef.current ? formatDuration(Date.now() - sessionStartRef.current) : '0:00'}</p>
            <p>Messages sent: {messages.filter(m => m.type === 'sent').length}</p>
            <p className="ended-note" style={{marginTop: 24, fontSize: 13}}>All messages have been securely deleted.</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>Start New Chat</button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default App;
