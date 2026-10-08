import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, signInWithCustomToken,
  sendEmailVerification,
} from 'firebase/auth';
import {
  getFirestore, collection, addDoc, onSnapshot, query, where, getDocs,
  deleteDoc, doc, updateDoc, orderBy, setDoc, arrayUnion,
} from 'firebase/firestore';

// ── Constants ──
const DEFAULT_TEAM = ["Eric.Guzman","Tommy.Flinch","Donald.Salazar","Mistral.Rojas","Wilson.Ferreira"];
const ROOMS = ["Interchange","Vision","Tank","Training Room","Meadow","Common Grounds","Ginsberg","Globe","Office Tour"];
const DURATION_OPTIONS = ["0.5 Hours","1 Hour","2 Hours","4 Hours","6 Hours","8 Hours","Full Day (10h)","Multi-Day (24h)"];
const SUPPORT_TEAMS = ["NYIH SELECT","CIC","TXA Assist","Other"];
const CLASSIFICATIONS = ["Internal","Client","Leadership","Community","Confidential","Public / External","TBD"];
const SESSION_TYPES = ["Demo","Client","Leadership","Workshop","Meeting","Conference / Boardroom","Town Hall","Other","TBD"];
const EVENT_STATUSES = ["Not Started","In Progress","Wrapped"];
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY;
const SLACK_WEBHOOK_URL = process.env.REACT_APP_SLACK_WEBHOOK_URL;

// Sign-up and app access are limited to this email domain.
// Keep it in sync with firestore.rules. Set to '' to turn the domain check off.
const ALLOWED_EMAIL_DOMAIN = 'accenture.com';

const QUICK_FILL_CARDS = [
  { name:'Proto', demo:'Proto hologram', sessionType:'Demo', note:'Hologram demo' },
  { name:'Vu AI', demo:'Vu AI', sessionType:'Demo', note:'AI video wall' },
  { name:'Spot', demo:'Spot', sessionType:'Demo', note:'Boston Dynamics' },
  { name:'Cyviz', demo:'Cyviz', sessionType:'Meeting', note:'Room / VC' },
  { name:'Surface Hub', demo:'Surface Hub', sessionType:'Meeting', note:'Whiteboard / VC' },
  { name:'Signage', demo:'Signage only', sessionType:'Leadership', note:'Lobby signage' },
];

// ── Firebase ──
const appId = typeof __app_id!=='undefined'?__app_id:'accenture-hub-v1';
let firebaseConfig = {};
if (typeof __firebase_config!=='undefined'&&__firebase_config) {
  firebaseConfig = JSON.parse(__firebase_config);
} else {
  try {
    firebaseConfig = {
      apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
      authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
      storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || `${process.env.REACT_APP_FIREBASE_PROJECT_ID}.appspot.com`,
      messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.REACT_APP_FIREBASE_APP_ID,
    };
  } catch(e) {}
}
const fbApp = getApps().length===0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const col = (c) => collection(db,'artifacts',appId,'public','data',c);
const docRef = (c,id) => doc(db,'artifacts',appId,'public','data',c,id);

// ── Helpers ──
const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const fmtTime = (dt) => {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
};
const weekOfFromDateTime = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const x = new Date(d); x.setDate(x.getDate()-x.getDay());
  return new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,10);
};
const initials = (name='') => String(name).split('.').map(p=>p[0]).join('').slice(0,2).toUpperCase();
const sanitizeForPrompt = (text) => {
  if (typeof text !== 'string') return '';
  return text.slice(0,60000).replace(/[<>]/g,'').replace(/ignore (all )?instructions?/gi,'[redacted]').trim();
};

const normalizeText = (v) => String(v||'').toLowerCase();
const getAttendeeCount = (v) => { const n=parseInt(String(v||'').replace(/[^\d]/g,''),10); return isNaN(n)?0:n; };
const sumHours = (logs) => (logs||[]).reduce((s,l)=>s+(parseFloat(l.hours)||0),0);

const normStatus = (t) => {
  const s = String(t.status||'todo').toLowerCase().replace(/[\s\-_]+/g,'');
  const m = {todo:'todo',backlog:'todo','':'todo',doing:'doing',active:'doing',inprogress:'doing',complete:'complete',done:'complete',completed:'complete'};
  return m[s]||'todo'; // unknown statuses land in "To do" instead of vanishing from the board
};

const isCheckLine = (l) => l.startsWith('☐')||l.startsWith('☑');
const checklistProgress = (text) => {
  const lines = String(text||'').split('\n').filter(isCheckLine);
  return { done: lines.filter(l=>l.startsWith('☑')).length, total: lines.length };
};

// Map a signed-in email (firstname.lastname@domain) to the matching roster name,
// so time logs and activity use the same First.Last names as assignees.
const resolveTeamName = (email, team) => {
  if (!email) return 'Unknown';
  const local = String(email).split('@')[0].toLowerCase();
  return team.find(m=>m.toLowerCase()===local) || email;
};

const emailDomainAllowed = (email) =>
  !ALLOWED_EMAIL_DOMAIN || String(email||'').trim().toLowerCase().endsWith('@'+ALLOWED_EMAIL_DOMAIN);

const authErrorText = (err) => ({
  'auth/invalid-credential':'Wrong email or password.',
  'auth/wrong-password':'Wrong email or password.',
  'auth/user-not-found':'Wrong email or password.',
  'auth/invalid-email':'That email address looks invalid.',
  'auth/missing-password':'Enter your password.',
  'auth/email-already-in-use':'An account with that email already exists. Sign in instead.',
  'auth/weak-password':'Password must be at least 6 characters.',
  'auth/too-many-requests':'Too many attempts. Wait a minute and try again.',
}[err?.code] || err?.message || 'Something went wrong.');

const detectEquipment = (event) => {
  const h = [event.demo,event.selectResources,event.notes,event.eventName,event.eventLocation,event.sessionType].join(' ').toLowerCase();
  const found = [];
  if(h.includes('proto')||h.includes('hologram')) found.push('Proto');
  if(h.includes('cyviz')) found.push('Cyviz');
  if(h.includes('surface hub')||h.includes('surfacehub')) found.push('Surface Hub');
  if(h.includes('vu ai')||h.includes('video wall')) found.push('Vu AI');
  if(h.includes('spot')||h.includes('boston dynamics')) found.push('Spot');
  if(h.includes('hypervsn')) found.push('Hypervsn');
  if(h.includes('signage')) found.push('Signage');
  if(h.includes('mtr')||h.includes('teams')||h.includes('cisco')) found.push('MTR / VC');
  if(h.includes('mic')||h.includes('microphone')||h.includes('clicker')) found.push('Audio');
  if(h.includes('loaner')||h.includes('laptop')) found.push('Loaner Laptop');
  return [...new Set(found)];
};

const inferSelectOwner = (event) => {
  const room = normalizeText(event.eventLocation);
  const eq = normalizeText(`${event.demo} ${event.selectResources} ${event.notes}`);
  if(eq.includes('cyviz')||room.includes('vision')||room.includes('interchange')) return 'Donald.Salazar';
  if(eq.includes('proto')||eq.includes('hologram')||eq.includes('spot')) return 'Tommy.Flinch';
  if(eq.includes('signage')||eq.includes('tour')||eq.includes('makers lab')) return 'Mistral.Rojas';
  if(eq.includes('broadcast')||eq.includes('vu ai')||eq.includes('alleo')||eq.includes('hypervsn')) return 'Donald.Salazar';
  if(room.includes('tank')||room.includes('fka theater')||room.includes('exco')) return 'Tommy.Flinch';
  if(room.includes('common grounds')&&(eq.includes('mic')||eq.includes('music'))) return 'Mistral.Rojas';
  return event.selectPoc||'Eric.Guzman';
};

const calculateRisk = (event) => {
  const attendees = getAttendeeCount(event.attendees);
  const equipment = detectEquipment(event);
  const room = normalizeText(event.eventLocation);
  const cls = event.classification||'';
  const issues = [];
  if(!event.selectPoc) issues.push('No SELECT lead assigned');
  if(!event.eventLocation) issues.push('No room/location listed');
  if(!event.startDate||!event.endDate) issues.push('Missing start/end time');
  if(attendees>=50&&!equipment.includes('Audio')) issues.push('Large event — audio validation needed');
  if(['Leadership','Client','Confidential'].includes(cls)) issues.push(`${cls} event — tighter readiness required`);
  if((room.includes('vision')||room.includes('interchange'))&&!equipment.includes('Cyviz')) issues.push('Room may require Cyviz validation');
  if(equipment.length>=3) issues.push('Multiple tech dependencies');
  let riskLevel = 'Low';
  if(issues.length>=3||attendees>=100||cls==='Confidential') riskLevel = 'High';
  else if(issues.length>=1||attendees>=50||['Leadership','Client'].includes(cls)) riskLevel = 'Medium';
  return { riskLevel, riskReasons: issues };
};

const buildDefaultChecklist = (event) => {
  const eq = detectEquipment(event);
  const attendees = getAttendeeCount(event.attendees);
  const room = normalizeText(event.eventLocation);
  const lines = [];
  lines.push('☐ Review event details (time, room, POC, attendees)');
  lines.push('☐ Confirm SELECT lead and backup coverage');
  lines.push('☐ Pre-check room (display, audio, camera, network, cables)');
  if(eq.includes('Cyviz')||room.includes('vision')||room.includes('interchange')) lines.push('☐ Cyviz: routing, screen layout, Teams/Cisco, content sharing');
  if(eq.includes('Proto')) lines.push('☐ Proto: content, network, audio, placement, run-of-show');
  if(eq.includes('Surface Hub')) lines.push('☐ Surface Hub: whiteboard, Teams join, camera, mic, sharing');
  if(eq.includes('Vu AI')) lines.push('☐ Vu AI: content source, display behavior, fallback plan');
  if(eq.includes('Spot')) lines.push('☐ Spot: battery, route, safety check, demo script, operator');
  if(eq.includes('Signage')) lines.push('☐ Signage: welcome message, timing, naming, placement');
  if(eq.includes('MTR / VC')) lines.push('☐ MTR/VC: meeting join, camera, mic, speakers, sharing');
  if(eq.includes('Audio')||attendees>=50) lines.push('☐ Audio: mics, speakers, clickers, volume levels');
  if(eq.includes('Loaner Laptop')) lines.push('☐ Loaner laptop: charged, adapters, login, content ready');
  lines.push('☐ Day-of: confirm start, presenter support, escalation path');
  lines.push('☐ Post-event: issues, lessons learned, follow-ups');
  return lines.join('\n');
};

const buildAutomationSummary = (event) => {
  const eq = detectEquipment(event);
  const risk = calculateRisk(event);
  return {
    equipmentDetected: eq,
    riskLevel: risk.riskLevel,
    riskReasons: risk.riskReasons,
    automationSummary: `${eq.length||0} tech dependencies. Risk: ${risk.riskLevel}.`,
  };
};

const ALLOWED_EVENT_KEYS = [
  'eventName','startDate','endDate','eventPoc','selectPoc','location','eventLocation',
  'classification','sessionType','attendees','demo','selectResources','sessionDays',
  'sessionSupportDuration','supportTeam','weekOf','notes','runOfShow','source',
  'riskLevel','automationSummary','equipmentDetected','riskReasons','eventStatus',
  'checklist','postEventNotes',
];
// Long free-text fields get a much higher cap so nothing is silently cut off on save.
const LONG_TEXT_LIMIT = 5000;
const LONG_FIELDS = ['notes','runOfShow','checklist','postEventNotes','selectResources'];
const fieldLimit = (k) => LONG_FIELDS.includes(k) ? LONG_TEXT_LIMIT : 700;
const sanitizeEventData = (obj) => {
  const safe = {};
  for (const key of ALLOWED_EVENT_KEYS) {
    if (obj[key]!==undefined && obj[key]!==null) {
      if (Array.isArray(obj[key])) safe[key] = obj[key].slice(0,20);
      else safe[key] = String(obj[key]).slice(0,fieldLimit(key));
    }
  }
  return safe;
};

const blankEventForm = () => ({
  eventName:'',startDate:'',endDate:'',eventPoc:'',selectPoc:'',location:'NYIH',
  eventLocation:'',classification:'Internal',sessionType:'Demo',attendees:'',demo:'',
  selectResources:'',sessionDays:'',sessionSupportDuration:'',supportTeam:'NYIH SELECT',
  weekOf:'',notes:'',runOfShow:'',source:'Manual',eventStatus:'Not Started',
  checklist:'',postEventNotes:'',
});

// Default date for a time entry: today if the event is today, otherwise the event's last day
// (so hours logged after the fact land in the right month).
const defaultLogDate = (e) => {
  const today = getTodayStr();
  const sd = String(e.startDate||'').slice(0,10);
  const ed = String(e.endDate||'').slice(0,10) || sd;
  if (!sd || sd>today || (sd<=today && ed>=today)) return today;
  return ed;
};

const logActivity = async (message, user='') => {
  try { await addDoc(col('shared_activity'),{message,user:user||'',timestamp:new Date().toISOString()}); }
  catch(e) { console.warn('Activity log failed',e); }
};

// Slack webhooks don't send CORS headers, so a JSON POST from the browser is blocked at preflight.
// A form-encoded `payload` is a "simple" request (no preflight), which Slack accepts.
const sendSlackAlert = async (text) => {
  if (!SLACK_WEBHOOK_URL) return;
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:'payload='+encodeURIComponent(JSON.stringify({text})),
    });
  } catch(e) { console.warn('Slack alert failed',e); }
};

const createSupportTask = async (eventId, event) => {
  await addDoc(col('shared_tasks'), {
    title: `SELECT support: ${event.eventName}`,
    details: buildDefaultChecklist(event),
    assignee: inferSelectOwner(event),
    dueDate: event.startDate ? String(event.startDate).slice(0,10) : '',
    timeSpent:'', timeLogs:[], status:'backlog', eventId,
    linkedEvent: event.eventName||'', source:'Auto-generated',
    timestamp: new Date().toISOString(),
  });
};

// arrayUnion appends atomically, so two people logging at once can't overwrite each other.
const logEventTime = async (event, user, { hours, note, date }) => {
  const entry = { user, hours, note, date, timestamp:new Date().toISOString() };
  await updateDoc(docRef('shared_events',event.id), { timeLogs: arrayUnion(entry) });
  await logActivity(`${user} logged ${hours}h on "${event.eventName}"`, user);
};

// Every time entry (events + tasks) dated within the given YYYY-MM month.
const monthLogs = (events, tasks, month) => [
  ...events.flatMap(e=>(e.timeLogs||[]).map(l=>({...l,source:'Event',name:e.eventName||'',room:e.eventLocation||'',classification:e.classification||''}))),
  ...tasks.flatMap(t=>(t.timeLogs||[]).map(l=>({...l,source:'Task',name:t.title||'',room:'',classification:''}))),
].filter(l=>String(l.date||'').slice(0,7)===month);

// ── SheetJS Excel export ──
const loadSheetJs = (() => {
  let p = null;
  return () => {
    if (p) return p;
    p = new Promise((res,rej) => {
      if (window.XLSX) { res(window.XLSX); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => res(window.XLSX);
      s.onerror = () => { p = null; rej(new Error('Failed to load SheetJS')); };
      document.head.appendChild(s);
    });
    return p;
  };
})();

// Returns false when the month has nothing to export (SheetJS throws on an empty workbook).
const exportToExcel = async (events, tasks, month) => {
  const inMonth = (d) => !month || String(d||'').slice(0,7)===month;
  const eventsData = events.filter(e=>inMonth(e.startDate)).map(e=>({
    'Event Name': e.eventName||'',
    'Start Date': e.startDate||'',
    'End Date': e.endDate||'',
    'Week Of': e.weekOf||'',
    'Classification': e.classification||'',
    'Session Type': e.sessionType||'',
    'Room': e.eventLocation||'',
    'Attendees': e.attendees||'',
    'Equipment': e.demo||'',
    'SELECT Lead': e.selectPoc||'',
    'Event POC': e.eventPoc||'',
    'Support Team': e.supportTeam||'',
    'Risk': e.riskLevel||'',
    'Status': e.eventStatus||'',
    'Run of Show': e.runOfShow||'',
    'Notes': e.notes||'',
    'Post-Event Notes': e.postEventNotes||'',
    'Hours Logged': sumHours(e.timeLogs)||'',
  }));
  const completedTasks = tasks.filter(t=>normStatus(t)==='complete' && inMonth(t.dueDate||t.timestamp)).map(t=>({
    'Task': t.title||'',
    'Assignee': t.assignee||'',
    'Status': t.status||'',
    'Due Date': t.dueDate||'',
    'Linked Event': t.linkedEvent||'',
    'Hours': sumHours(t.timeLogs)||t.timeSpent||'',
  }));
  const timeLogs = monthLogs(events, tasks, month)
    .sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')))
    .map(l=>({
      'Date': l.date||'',
      'Type': l.source,
      'Event / Task': l.name,
      'Team Member': l.user||'',
      'Hours': l.hours||'',
      'Note': l.note||'',
      'Room': l.room,
      'Classification': l.classification,
    }));
  if (!eventsData.length && !completedTasks.length && !timeLogs.length) return false;
  const XLSX = await loadSheetJs();
  const wb = XLSX.utils.book_new();
  if (eventsData.length) { const ws=XLSX.utils.json_to_sheet(eventsData); ws['!cols']=[{wch:30},{wch:18},{wch:18},{wch:12},{wch:14},{wch:16},{wch:18},{wch:10},{wch:25},{wch:16}]; XLSX.utils.book_append_sheet(wb,ws,'Events'); }
  if (completedTasks.length) { const ws=XLSX.utils.json_to_sheet(completedTasks); XLSX.utils.book_append_sheet(wb,ws,'Completed Tasks'); }
  if (timeLogs.length) { const ws=XLSX.utils.json_to_sheet(timeLogs); XLSX.utils.book_append_sheet(wb,ws,'Time Logs'); }
  XLSX.writeFile(wb, `SELECT_Hub_${month||getTodayStr().slice(0,7)}.xlsx`);
  return true;
};

// ── Design tokens & global styles ──
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0A0A0F; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; color: #E2E2EC; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2A2A3E; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #3A3A5E; }
  input, select, textarea, button { font-family: inherit; }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #7C6FF7; outline-offset: 1px; }
  @keyframes fadeSlideIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes spin { to { transform:rotate(360deg); } }
  .fade-in { animation: fadeSlideIn 0.2s ease-out; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }

  /* ── Phone layout ── */
  @media (max-width: 760px) {
    .app-shell { flex-direction: column-reverse !important; height: 100dvh !important; }
    .sidebar { width: 100% !important; height: 56px; flex-direction: row !important; justify-content: space-around;
      padding: 0 6px !important; border-right: none !important; border-top: 1px solid #1E1E2E; overflow-x: auto; }
    .sidebar-logo, .sidebar-spacer { display: none !important; }
    .topbar-sub { display: none; }
    .today-layout { flex-direction: column !important; overflow: auto !important; }
    .today-main { flex: none !important; overflow: visible !important; }
    .today-side { width: 100% !important; border-left: none !important; border-top: 1px solid #1E1E2E; overflow: visible !important; }
    .stat-row { grid-template-columns: repeat(2, 1fr) !important; }
    .grid-2, .grid-rooms { grid-template-columns: 1fr !important; }
    .kanban { grid-template-columns: 1fr !important; grid-auto-rows: max-content; align-content: start; overflow: auto !important; }
    .kanban-col { border-right: none !important; border-bottom: 1px solid #1E1E2E; overflow: visible !important; }
    .kanban-list { overflow: visible !important; }
  }
`;

// ── Token values ──
const C = {
  bg: '#0A0A0F',
  surface: '#111119',
  surfaceHover: '#16161F',
  border: '#1E1E2E',
  borderHover: '#2E2E4E',
  accent: '#7C6FF7',
  accentHover: '#9088F8',
  accentBg: 'rgba(124,111,247,0.1)',
  accentBorder: 'rgba(124,111,247,0.25)',
  green: '#34C98A',
  greenBg: 'rgba(52,201,138,0.1)',
  amber: '#F5A623',
  amberBg: 'rgba(245,166,35,0.1)',
  red: '#EF4665',
  redBg: 'rgba(239,70,101,0.1)',
  textPrimary: '#E2E2EC',
  textSecondary: '#8A8AA8',
  textMuted: '#4A4A6A',
};

// ── Base UI primitives ──
const card = (extra='') => ({
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  ...(extra==='pad' ? {padding:'16px'} : {}),
});

function Badge({ color='default', children, size='sm', style={} }) {
  const colors = {
    default: { bg:'rgba(138,138,168,0.12)', text:'#8A8AA8' },
    accent:  { bg: C.accentBg, text: C.accent },
    green:   { bg: C.greenBg, text: C.green },
    amber:   { bg: C.amberBg, text: C.amber },
    red:     { bg: C.redBg, text: C.red },
    purple:  { bg:'rgba(167,139,250,0.12)', text:'#A78BFA' },
  };
  const c = colors[color]||colors.default;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4,
      background: c.bg, color: c.text,
      fontSize: size==='xs'?9:10, fontWeight:600, letterSpacing:'0.04em',
      textTransform:'uppercase', borderRadius:20,
      padding: size==='xs'?'2px 6px':'3px 8px', ...style,
    }}>{children}</span>
  );
}

// type defaults to "button" so buttons inside a <form> never submit it by accident.
// Pass type="submit" on the one button that should.
function Btn({ variant='ghost', size='sm', type='button', onClick, disabled, children, style={} }) {
  const base = {
    display:'inline-flex', alignItems:'center', gap:6, cursor:disabled?'not-allowed':'pointer',
    border:'none', borderRadius:8, fontWeight:500, transition:'all 0.15s',
    opacity: disabled ? 0.45 : 1,
    fontSize: size==='sm'?12:size==='md'?13:14,
    padding: size==='sm'?'5px 10px':size==='md'?'7px 14px':'9px 18px',
  };
  const variants = {
    primary:  { background: C.accent,   color:'#fff' },
    danger:   { background: C.red,      color:'#fff' },
    success:  { background: C.green,    color:'#fff' },
    ghost:    { background:'transparent', color: C.textSecondary, border:`1px solid ${C.border}` },
    subtle:   { background: C.accentBg,  color: C.accent },
    amber:    { background: C.amberBg,   color: C.amber, border:`1px solid rgba(245,166,35,0.2)` },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{...base,...(variants[variant]||variants.ghost),...style}}>
      {children}
    </button>
  );
}

// Passes through name, list, maxLength, autoComplete, etc. — `name` is required for FormData forms.
function Input({ rows, type='text', style={}, ...rest }) {
  const base = {
    width:'100%', background:'#0D0D17', border:`1px solid ${C.border}`,
    borderRadius:8, color: C.textPrimary, fontSize:13,
    padding:'9px 12px', transition:'border-color 0.15s',
    fontFamily:'inherit', resize: rows?'vertical':'none',
  };
  if (rows) return <textarea rows={rows} {...rest} style={{...base,...style}}/>;
  return <input type={type} {...rest} style={{...base,...style}}/>;
}

function Select({ children, style={}, ...rest }) {
  return (
    <select {...rest} style={{
      width:'100%', background:'#0D0D17', border:`1px solid ${C.border}`,
      borderRadius:8, color: C.textPrimary, fontSize:13,
      padding:'9px 12px', fontFamily:'inherit', cursor:'pointer', ...style,
    }}>
      {children}
    </select>
  );
}

function Label({ children, style={} }) {
  return <p style={{fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em',color:C.textMuted,marginBottom:5,...style}}>{children}</p>;
}

function Divider() { return <div style={{height:1,background:C.border,margin:'12px 0'}}/> }

function Spinner({ size=14 }) {
  return <div style={{width:size,height:size,border:`2px solid ${C.border}`,borderTopColor:C.accent,borderRadius:'50%',animation:'spin 0.7s linear infinite',flexShrink:0}}/>;
}

function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'40px 20px',gap:10,textAlign:'center'}}>
      <span style={{fontSize:28,opacity:0.3}}>{icon}</span>
      <p style={{fontSize:13,fontWeight:500,color:C.textSecondary}}>{title}</p>
      {subtitle&&<p style={{fontSize:12,color:C.textMuted,maxWidth:260,lineHeight:1.5}}>{subtitle}</p>}
    </div>
  );
}

function Avatar({ name, size=28 }) {
  const colors = ['#7C6FF7','#34C98A','#F5A623','#EF4665','#A78BFA'];
  const n = String(name||'?');
  const idx = n.charCodeAt(0)%colors.length;
  return (
    <div style={{width:size,height:size,borderRadius:'50%',background:`${colors[idx]}22`,
      border:`1px solid ${colors[idx]}44`,display:'flex',alignItems:'center',justifyContent:'center',
      fontSize:size*0.35,fontWeight:600,color:colors[idx],flexShrink:0}}>
      {initials(n)}
    </div>
  );
}

function ProgressBar({ done, total, color }) {
  const pct = total ? Math.round((done/total)*100) : 0;
  const c = done===total ? C.green : (color||C.accent);
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <span style={{fontSize:10,color:C.textMuted}}>Checklist</span>
        <span style={{fontSize:10,color:done===total?C.green:C.textSecondary,fontWeight:500}}>{done}/{total}</span>
      </div>
      <div style={{height:3,background:'rgba(255,255,255,0.05)',borderRadius:4,overflow:'hidden'}}>
        <div style={{height:'100%',width:`${pct}%`,background:c,borderRadius:4,transition:'width 0.3s'}}/>
      </div>
    </div>
  );
}

function Toast({ msg }) {
  if (!msg.text) return null;
  return (
    <div role="status" style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',
      background:msg.isError?'rgba(239,70,101,0.12)':'rgba(124,111,247,0.12)',
      border:`1px solid ${msg.isError?C.red:C.accent}`,borderRadius:10,
      padding:'10px 18px',fontSize:13,color:msg.isError?C.red:C.accent,
      zIndex:400,display:'flex',alignItems:'center',gap:8,
      backdropFilter:'blur(8px)',animation:'fadeSlideIn 0.2s ease-out',
      maxWidth:'90vw',fontWeight:500}}>
      {msg.isError?'⚠':'✓'} {msg.text}
    </div>
  );
}

function Overlay({ children, onClose, maxWidth=340 }) {
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:16}}>
      <div onClick={e=>e.stopPropagation()} className="fade-in"
        style={{...card('pad'),width:'100%',maxWidth,display:'flex',flexDirection:'column',gap:12,maxHeight:'90vh',overflow:'auto'}}>
        {children}
      </div>
    </div>
  );
}

// ── Checklist Editor ──
// Ticks, removals and new items save immediately. Text edits stay local while you type and
// save when the field loses focus, so typing never fights with Firestore updates.
function ChecklistEditor({ value, onChange }) {
  const [draft, setDraft] = useState(value||'');
  const focused = useRef(false);
  useEffect(()=>{ if (!focused.current) setDraft(value||''); },[value]);

  const lines = draft.split('\n').filter(Boolean);
  const { done, total } = checklistProgress(draft);

  const commit = (next) => { setDraft(next); if (next!==(value||'')) onChange(next); };
  const toggle = (i) => {
    const u = [...lines];
    u[i] = u[i].startsWith('☐') ? '☑'+u[i].slice(1) : u[i].startsWith('☑') ? '☐'+u[i].slice(1) : u[i];
    commit(u.join('\n'));
  };
  const edit = (i, text) => {
    const u = [...lines];
    u[i] = isCheckLine(u[i]) ? u[i].slice(0,2)+text : text;
    setDraft(u.join('\n'));
  };
  const remove = (i) => { const u=[...lines]; u.splice(i,1); commit(u.join('\n')); };
  const add = () => commit((draft?draft+'\n':'')+'☐ ');

  return (
    <div>
      {total>0 && <div style={{marginBottom:10}}><ProgressBar done={done} total={total}/></div>}
      <div style={{display:'flex',flexDirection:'column',gap:2}}>
        {lines.map((line,i) => {
          const isCheck = isCheckLine(line);
          const checked = line.startsWith('☑');
          const text = isCheck ? line.slice(2) : line;
          return (
            <div key={i} style={{display:'flex',alignItems:'center',gap:6,padding:'3px 4px',borderRadius:6,transition:'background 0.1s'}}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.03)'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              {isCheck && (
                <button type="button" onClick={()=>toggle(i)} aria-label={checked?'Mark not done':'Mark done'}
                  style={{background:'none',border:'none',cursor:'pointer',
                  fontSize:14,color:checked?C.green:C.textMuted,flexShrink:0,padding:0,lineHeight:1}}>
                  {checked?'☑':'☐'}
                </button>
              )}
              <input value={text} onChange={e=>edit(i,e.target.value)}
                onFocus={()=>{focused.current=true;}}
                onBlur={()=>{focused.current=false; commit(draft);}}
                style={{flex:1,background:'transparent',border:'none',fontSize:12,
                  color:checked?C.textMuted:C.textPrimary,fontFamily:'inherit',
                  textDecoration:checked?'line-through':'none'}}/>
              <button type="button" onClick={()=>remove(i)} aria-label="Remove item" style={{background:'none',border:'none',cursor:'pointer',
                color:C.textMuted,padding:0,fontSize:11,opacity:0.5,lineHeight:1}}
                onMouseEnter={e=>e.currentTarget.style.opacity='1'}
                onMouseLeave={e=>e.currentTarget.style.opacity='0.5'}>✕</button>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={add} style={{marginTop:6,background:'none',border:'none',cursor:'pointer',
        fontSize:11,color:C.accent,fontWeight:500,padding:'3px 0'}}>
        + Add item
      </button>
    </div>
  );
}

// ── Log time modal (used on Today and Events) ──
function LogTimeModal({ title, defaultDate, onSubmit, onClose, showMsg }) {
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(defaultDate||getTodayStr());
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const hrs = parseFloat(hours);
    if (isNaN(hrs)||hrs<=0) { showMsg('Enter hours greater than 0.',true); return; }
    if (!date) { showMsg('Pick the date you did the work.',true); return; }
    setBusy(true);
    try { await onSubmit({ hours:hrs, note:note.trim(), date }); onClose(); }
    catch(err) { console.error(err); showMsg('Could not log time. Try again.',true); setBusy(false); }
  };
  return (
    <Overlay onClose={onClose}>
      <p style={{fontSize:14,fontWeight:600,color:C.textPrimary}}>Log time</p>
      <p style={{fontSize:12,color:C.textSecondary}}>{title}</p>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <div><Label>Hours</Label><Input value={hours} onChange={e=>setHours(e.target.value)} type="number" min="0" step="0.25" placeholder="1.5" autoFocus/></div>
        <div><Label>Date</Label><Input value={date} onChange={e=>setDate(e.target.value)} type="date"/></div>
      </div>
      <Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Note (optional)" maxLength={500}
        onKeyDown={e=>{ if(e.key==='Enter') submit(); }}/>
      <div style={{display:'flex',gap:8}}>
        <Btn variant="primary" size="md" onClick={submit} disabled={busy} style={{flex:1,justifyContent:'center'}}>{busy?'Logging…':'Log time'}</Btn>
        <Btn variant="ghost" size="md" onClick={onClose} style={{flex:1,justifyContent:'center'}}>Cancel</Btn>
      </div>
    </Overlay>
  );
}

// ── Auth ──
function AuthPage({ showMsg }) {
  const [isLogin, setIsLogin] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = String(fd.get('email')||'').trim();
    const password = String(fd.get('password')||'');
    if (!isLogin && !emailDomainAllowed(email)) { showMsg(`Use your @${ALLOWED_EMAIL_DOMAIN} email address.`,true); return; }
    setBusy(true);
    try {
      if (isLogin) await signInWithEmailAndPassword(auth, email, password);
      else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(cred.user);
        showMsg('Account created. Check your inbox for a verification link.');
      }
    } catch(err) { showMsg(authErrorText(err), true); }
    setBusy(false);
  };
  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,padding:16}}>
      <div style={{...card('pad'),width:'100%',maxWidth:360,textAlign:'center'}}>
        <div style={{width:48,height:48,background:C.accent,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px',fontSize:22}}>⚡</div>
        <h1 style={{fontSize:22,fontWeight:600,color:C.textPrimary,marginBottom:4}}>
          <span style={{color:C.accent}}>SELECT</span> Hub
        </h1>
        <p style={{fontSize:11,color:C.textMuted,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:24}}>Powered by Accenture</p>
        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:10}}>
          <Input name="email" type="email" autoComplete="email" required
            placeholder={ALLOWED_EMAIL_DOMAIN?`firstname.lastname@${ALLOWED_EMAIL_DOMAIN}`:'Email'}/>
          <Input name="password" type="password" placeholder="Password" required minLength={6}
            autoComplete={isLogin?'current-password':'new-password'}/>
          <Btn type="submit" variant="primary" size="lg" disabled={busy} style={{width:'100%',justifyContent:'center'}}>
            {busy?<><Spinner size={13}/>{isLogin?'Signing in…':'Creating account…'}</>:(isLogin?'Sign in':'Create account')}
          </Btn>
        </form>
        <button type="button" onClick={()=>setIsLogin(!isLogin)} style={{marginTop:14,background:'none',border:'none',cursor:'pointer',fontSize:12,color:C.textMuted}}>
          {isLogin?'Create account':'Back to sign in'}
        </button>
      </div>
    </div>
  );
}

// Shown when a signed-in account isn't on the allowed domain or hasn't verified its email.
function AccountGate({ user, reason, showMsg, onVerified }) {
  const [busy, setBusy] = useState(false);
  const isDomain = reason==='domain';
  const resend = async () => {
    setBusy(true);
    try { await sendEmailVerification(user); showMsg('Verification email sent.'); }
    catch(err) { showMsg(authErrorText(err), true); }
    setBusy(false);
  };
  const recheck = async () => {
    setBusy(true);
    try {
      await user.reload();
      if (auth.currentUser?.emailVerified) {
        await auth.currentUser.getIdToken(true); // refresh the token so Firestore rules see email_verified
        onVerified();
        return;
      }
      showMsg('Not verified yet. Open the link in the email first.', true);
    } catch(err) { showMsg(authErrorText(err), true); }
    setBusy(false);
  };
  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,padding:16}}>
      <div style={{...card('pad'),width:'100%',maxWidth:380,textAlign:'center',display:'flex',flexDirection:'column',gap:12}}>
        <p style={{fontSize:28}}>{isDomain?'🔒':'✉'}</p>
        <p style={{fontSize:15,fontWeight:600,color:C.textPrimary}}>{isDomain?'This account can’t use SELECT Hub':'Verify your email'}</p>
        <p style={{fontSize:13,color:C.textMuted,lineHeight:1.6}}>
          {isDomain
            ? `SELECT Hub is limited to @${ALLOWED_EMAIL_DOMAIN} accounts. You’re signed in as ${user.email}.`
            : `We sent a verification link to ${user.email}. Open it, then come back here and continue.`}
        </p>
        {!isDomain && (
          <>
            <Btn variant="primary" size="md" onClick={recheck} disabled={busy} style={{justifyContent:'center'}}>I’ve verified, continue</Btn>
            <Btn variant="ghost" size="md" onClick={resend} disabled={busy} style={{justifyContent:'center'}}>Resend verification email</Btn>
          </>
        )}
        <Btn variant="ghost" size="md" onClick={()=>signOut(auth)} style={{justifyContent:'center'}}>Sign out</Btn>
      </div>
    </div>
  );
}

// ── Sidebar nav ──
const NAV = [
  { key:'today',    icon:'☀',  label:'Today'    },
  { key:'events',   icon:'📋', label:'Events'   },
  { key:'tasks',    icon:'⬛', label:'Tasks'    },
  { key:'issues',   icon:'⚠',  label:'Issues'   },
  { key:'rooms',    icon:'📍', label:'Rooms'    },
  { key:'export',   icon:'⬇',  label:'Export'   },
  { key:'insights', icon:'📊', label:'Insights' },
]; // Settings lives at the bottom of the sidebar

function NavBtn({ active, title, onClick, danger, children }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      style={{
        width:36,height:36,borderRadius:8,border:'none',cursor:'pointer',flexShrink:0,
        background: active ? C.accentBg : 'transparent',
        color: active ? C.accent : C.textMuted,
        fontSize:16,transition:'all 0.15s',display:'flex',alignItems:'center',justifyContent:'center',
      }}
      onMouseEnter={e=>{ if(!active){ e.currentTarget.style.background=danger?'transparent':'rgba(255,255,255,0.05)'; e.currentTarget.style.color=danger?C.red:C.textPrimary; } }}
      onMouseLeave={e=>{ if(!active){ e.currentTarget.style.background='transparent'; e.currentTarget.style.color=C.textMuted; } }}
    >{children}</button>
  );
}

function Sidebar({ page, setPage }) {
  return (
    <div className="sidebar" style={{
      width:56,display:'flex',flexDirection:'column',alignItems:'center',
      padding:'12px 0',gap:2,borderRight:`1px solid ${C.border}`,
      background:C.surface,flexShrink:0,
    }}>
      <div className="sidebar-logo" style={{fontSize:18,fontWeight:700,color:C.accent,marginBottom:10,letterSpacing:-1}}>S</div>
      {NAV.map(n => <NavBtn key={n.key} active={page===n.key} title={n.label} onClick={()=>setPage(n.key)}>{n.icon}</NavBtn>)}
      <div className="sidebar-spacer" style={{flex:1}}/>
      <NavBtn active={page==='settings'} title="Settings" onClick={()=>setPage('settings')}>⚙</NavBtn>
      <NavBtn danger title="Sign out" onClick={()=>signOut(auth)}>↪</NavBtn>
    </div>
  );
}

// ── Top bar ──
function TopBar({ title, subtitle, actions, currentUser }) {
  return (
    <div style={{
      height:48,display:'flex',alignItems:'center',padding:'0 16px',gap:12,
      borderBottom:`1px solid ${C.border}`,background:C.surface,flexShrink:0,
    }}>
      <div>
        <span style={{fontSize:14,fontWeight:600,color:C.textPrimary}}>{title}</span>
        {subtitle && <span className="topbar-sub" style={{fontSize:12,color:C.textMuted,marginLeft:8}}>{subtitle}</span>}
      </div>
      <div style={{flex:1}}/>
      {actions}
      <Avatar name={currentUser} size={26}/>
    </div>
  );
}

// ── Stat cards row ──
function StatRow({ stats }) {
  return (
    <div className="stat-row" style={{display:'grid',gridTemplateColumns:`repeat(${stats.length},1fr)`,gap:8}}>
      {stats.map((s,i) => (
        <div key={i} style={{...card('pad'),padding:'10px 14px'}}>
          <div style={{fontSize:20,fontWeight:600,color:s.color||C.textPrimary}}>{s.value}</div>
          <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── TODAY PAGE ──
function TodayPage({ events, handoffFeed, rooms, showMsg, currentUser, myIds, fetchGemini, setModal }) {
  // Re-render every 30s so "Live now" and faded past events stay current.
  const [now, setNow] = useState(()=>new Date());
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),30000); return ()=>clearInterval(t); },[]);
  const todayStr = getTodayStr();

  const [handoffInput, setHandoffInput] = useState('');
  const [savingHandoff, setSavingHandoff] = useState(false);
  const [logTarget, setLogTarget] = useState(null);
  const [checklistId, setChecklistId] = useState(null);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [showAi, setShowAi] = useState(false);

  const todayEvents = useMemo(() => events.filter(e => {
    const sd = (e.startDate||'').slice(0,10);
    const ed = (e.endDate||'').slice(0,10);
    return sd===todayStr || (sd<=todayStr&&ed>=todayStr);
  }).sort((a,b)=>(a.startDate||'').localeCompare(b.startDate||'')),[events,todayStr]);

  // Compare full date-times so multi-day and overnight events are handled correctly.
  const toMs = (dt) => { if(!dt) return null; const t=new Date(dt).getTime(); return isNaN(t)?null:t; };
  const nowMs = now.getTime();
  const isLive = (e) => { const s=toMs(e.startDate),en=toMs(e.endDate); return s!==null&&en!==null&&nowMs>=s&&nowMs<=en; };
  const isPast = (e) => { const en=toMs(e.endDate); return en!==null&&nowMs>en; };
  const isMine = (u) => myIds.includes(u);

  const myHoursToday = todayEvents.reduce((s,e)=>s+sumHours((e.timeLogs||[]).filter(l=>l.date===todayStr&&isMine(l.user))),0);
  const checklistEvent = checklistId ? events.find(e=>e.id===checklistId) : null;

  const updateStatus = async (id, status, name) => {
    try {
      await updateDoc(docRef('shared_events',id),{eventStatus:status});
      await logActivity(`${currentUser} marked "${name}" as ${status}`,currentUser);
      showMsg(`${name} → ${status}`);
    } catch(err) { console.error(err); showMsg('Could not update status.',true); }
  };

  const saveHandoff = async () => {
    if (!handoffInput.trim()) return;
    setSavingHandoff(true);
    try {
      await addDoc(col('shared_handoff'), {
        note: handoffInput.trim(),
        author: currentUser,
        date: todayStr,
        timestamp: new Date().toISOString(),
      });
      setHandoffInput('');
      showMsg('Note added.');
    } catch(err) { console.error(err); showMsg('Could not save the note.',true); }
    setSavingHandoff(false);
  };

  const deleteHandoffEntry = async (id) => {
    try { await deleteDoc(docRef('shared_handoff',id)); }
    catch(err) { console.error(err); showMsg('Could not delete the note.',true); }
  };

  const aiDocument = async () => {
    if (!aiInput.trim()){showMsg('Describe your day first.',true);return;}
    setAiLoading(true);
    const result = await fetchGemini(
      `You are a documentation assistant for the SELECT AV/tech team at Accenture NYIH. Format the user's plain-English description of their workday into a structured work log with sections: Summary (1-2 sentences), Events Supported, Tasks Completed, Issues Encountered (or "None"), Time Logged (if mentioned), Notes for Next Shift. Professional but concise. Date: ${todayStr}. Team member: ${currentUser}.`,
      aiInput
    );
    setAiLoading(false);
    if (!result||(typeof result==='string'&&result.startsWith('AI Error:'))){showMsg(result||'AI error.',true);return;}
    setModal({title:'Work log — '+todayStr,content:result,actionLabel:'Copy',action:()=>{navigator.clipboard.writeText(result);showMsg('Copied.');}});
  };

  const statusColor = (s) => s==='In Progress'?C.accent:s==='Wrapped'?C.green:C.textMuted;
  const roomStatuses = rooms.slice(0,6);

  return (
    <div className="today-layout" style={{display:'flex',flex:1,overflow:'hidden'}}>
      {/* Main timeline */}
      <div className="today-main" style={{flex:1,overflow:'auto',padding:16,display:'flex',flexDirection:'column',gap:14}}>
        <StatRow stats={[
          {value:todayEvents.length,label:'Events today'},
          {value:todayEvents.filter(e=>e.eventStatus==='In Progress').length,label:'In progress',color:C.accent},
          {value:todayEvents.filter(e=>e.eventStatus==='Wrapped').length,label:'Wrapped',color:C.green},
          {value:`${myHoursToday.toFixed(1)}h`,label:'My hours today',color:C.amber},
        ]}/>

        {/* Timeline */}
        <div style={{...card(),overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:13,fontWeight:500,color:C.textPrimary}}>Today's schedule</span>
            <span style={{fontSize:11,color:C.textMuted}}>{todayStr}</span>
          </div>
          {!todayEvents.length && <EmptyState icon="📅" title="No events today" subtitle="Events added for today will appear here in time order."/>}
          <div style={{padding:16,display:'flex',flexDirection:'column',gap:0}}>
            {todayEvents.map((e) => {
              const live = isLive(e);
              const past = isPast(e) && e.eventStatus!=='In Progress';
              const myHrs = sumHours((e.timeLogs||[]).filter(l=>l.date===todayStr&&isMine(l.user)));
              const eq = detectEquipment(e);
              const cl = checklistProgress(e.checklist||buildDefaultChecklist(e));
              return (
                <div key={e.id} style={{display:'flex',gap:12,opacity:past?0.6:1}}>
                  {/* Time */}
                  <div style={{width:42,flexShrink:0,textAlign:'right',paddingTop:10}}>
                    <span style={{fontSize:11,color:C.textMuted}}>{fmtTime(e.startDate)}</span>
                  </div>
                  {/* Line + dot */}
                  <div style={{width:1,background:C.border,position:'relative',flexShrink:0,minHeight:60}}>
                    <div style={{
                      width:10,height:10,borderRadius:'50%',position:'absolute',
                      left:-4.5,top:12,flexShrink:0,
                      background: live ? C.accent : past ? C.green : C.border,
                      boxShadow: live ? `0 0 0 3px ${C.accentBg}` : 'none',
                      animation: live ? 'pulse 2s infinite' : 'none',
                    }}/>
                  </div>
                  {/* Card */}
                  <div style={{
                    flex:1,minWidth:0,margin:'6px 0 12px 10px',padding:'10px 14px',borderRadius:10,
                    background: live ? C.accentBg : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${live ? C.accentBorder : C.border}`,
                    transition:'all 0.15s',
                  }}>
                    {live && (
                      <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:5}}>
                        <div style={{width:6,height:6,borderRadius:'50%',background:C.accent,animation:'pulse 1.5s infinite'}}/>
                        <span style={{fontSize:10,fontWeight:600,color:C.accent,textTransform:'uppercase',letterSpacing:'0.05em'}}>Live now</span>
                      </div>
                    )}
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                      <div style={{flex:1,minWidth:0}}>
                        <p style={{fontSize:13,fontWeight:500,color:live?C.accent:C.textPrimary,marginBottom:3}}>{e.eventName}</p>
                        <p style={{fontSize:11,color:C.textSecondary}}>
                          {e.eventLocation||'No room'} · {e.selectPoc||'No lead'}
                          {e.endDate && ` · until ${fmtTime(e.endDate)}`}
                        </p>
                        {eq.length>0 && <p style={{fontSize:11,color:C.textMuted,marginTop:2}}>{eq.join(' · ')}</p>}
                        {myHrs>0 && <p style={{fontSize:11,color:C.green,marginTop:3}}>⏱ {myHrs.toFixed(1)}h logged by you</p>}
                        {e.runOfShow && <p style={{fontSize:11,color:C.textMuted,marginTop:3,fontStyle:'italic'}}>Run of show: {e.runOfShow}</p>}
                      </div>
                      {/* Status buttons */}
                      <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
                        {EVENT_STATUSES.map(s => (
                          <button type="button" key={s} onClick={()=>updateStatus(e.id,s,e.eventName)}
                            style={{
                              fontSize:10,fontWeight:500,padding:'3px 8px',borderRadius:6,
                              cursor:'pointer',border:'none',whiteSpace:'nowrap',
                              background: e.eventStatus===s ? statusColor(s) : 'rgba(255,255,255,0.05)',
                              color: e.eventStatus===s ? '#fff' : C.textMuted,
                              transition:'all 0.15s',
                            }}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Available before, during, and after the event */}
                    <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
                      <Btn variant={live?'subtle':'ghost'} size="sm" onClick={()=>setLogTarget(e)}>⏱ Log time</Btn>
                      <Btn variant="ghost" size="sm" onClick={()=>setChecklistId(e.id)}>☑ Checklist{cl.total?` ${cl.done}/${cl.total}`:''}</Btn>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="today-side" style={{width:210,borderLeft:`1px solid ${C.border}`,background:C.surface,display:'flex',flexDirection:'column',overflow:'auto',flexShrink:0}}>
        {/* Room status */}
        <div style={{padding:12,borderBottom:`1px solid ${C.border}`}}>
          <Label style={{marginBottom:8}}>Room status</Label>
          {!roomStatuses.length && <p style={{fontSize:11,color:C.textMuted}}>No rooms configured yet.</p>}
          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            {roomStatuses.map(r => {
              const c = r.status==='Operational'?C.green:r.status==='Monitor'?C.amber:C.red;
              return (
                <div key={r.id} style={{display:'flex',alignItems:'center',gap:7,padding:'5px 8px',background:'rgba(255,255,255,0.02)',borderRadius:7,border:`1px solid ${C.border}`}}>
                  <div style={{width:6,height:6,borderRadius:'50%',background:c,flexShrink:0}}/>
                  <span style={{fontSize:11,color:C.textSecondary,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.title}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Handoff feed */}
        <div style={{padding:12,borderBottom:`1px solid ${C.border}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <Label style={{marginBottom:0}}>Shift handoff</Label>
            <button type="button" onClick={()=>setShowHandoff(!showHandoff)}
              style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:C.accent}}>
              {showHandoff?'Hide':'+ Add note'}
            </button>
          </div>

          {handoffFeed.length===0 && (
            <p style={{fontSize:11,color:C.textMuted,fontStyle:'italic',marginBottom:showHandoff?8:0}}>
              No handoff notes yet today.
            </p>
          )}
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:showHandoff?8:0}}>
            {handoffFeed.map(entry=>(
              <div key={entry.id} style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${C.border}`,
                borderRadius:7,padding:'7px 9px',position:'relative'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:6}}>
                  <div style={{flex:1}}>
                    <p style={{fontSize:11,color:C.textSecondary,lineHeight:1.5,marginBottom:3}}>
                      {entry.note}
                    </p>
                    <p style={{fontSize:10,color:C.textMuted}}>
                      {entry.author?.split('@')[0] || entry.author}
                      {' · '}
                      {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : ''}
                    </p>
                  </div>
                  {isMine(entry.author) && (
                    <button type="button" onClick={()=>deleteHandoffEntry(entry.id)} aria-label="Delete note"
                      style={{background:'none',border:'none',cursor:'pointer',fontSize:12,
                        color:C.textMuted,padding:0,flexShrink:0,lineHeight:1,opacity:0.5}}
                      onMouseEnter={e=>e.currentTarget.style.opacity='1'}
                      onMouseLeave={e=>e.currentTarget.style.opacity='0.5'}>✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {showHandoff && (
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <textarea value={handoffInput} onChange={e=>setHandoffInput(e.target.value)}
                rows={3} maxLength={1000} placeholder="e.g. Proto rebooted at 10am — watch it this afternoon"
                style={{width:'100%',background:'#0D0D17',border:`1px solid ${C.border}`,
                  borderRadius:7,color:C.textPrimary,fontSize:11,padding:'7px 9px',
                  fontFamily:'inherit',resize:'vertical'}}/>
              <Btn variant="amber" size="sm" onClick={saveHandoff} disabled={savingHandoff||!handoffInput.trim()}>
                {savingHandoff?'Saving...':'Add note'}
              </Btn>
            </div>
          )}
        </div>

        {/* Document my day */}
        <div style={{padding:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <Label style={{marginBottom:0}}>Document my day</Label>
            <button type="button" onClick={()=>setShowAi(!showAi)} style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:C.accent}}>
              {showAi?'Hide':'Open'}
            </button>
          </div>
          {showAi && (
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <textarea value={aiInput} onChange={e=>setAiInput(e.target.value)} rows={4}
                placeholder="Describe your day in plain English — AI formats it into a structured work log."
                style={{width:'100%',background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:7,
                  color:C.textPrimary,fontSize:11,padding:'7px 9px',fontFamily:'inherit',resize:'vertical'}}/>
              <Btn variant="subtle" size="sm" onClick={aiDocument} disabled={aiLoading}>
                {aiLoading?<><Spinner size={11}/>Writing...</>:'⚡ Generate log'}
              </Btn>
            </div>
          )}
          {!showAi && <p style={{fontSize:11,color:C.textMuted,lineHeight:1.5}}>Describe your day — AI formats it into a work log you can copy.</p>}
        </div>
      </div>

      {logTarget && (
        <LogTimeModal title={logTarget.eventName} defaultDate={defaultLogDate(logTarget)} showMsg={showMsg}
          onClose={()=>setLogTarget(null)}
          onSubmit={async (v)=>{ await logEventTime(logTarget, currentUser, v); showMsg(`Logged ${v.hours}h.`); }}/>
      )}

      {checklistEvent && (
        <Overlay onClose={()=>setChecklistId(null)} maxWidth={480}>
          <div>
            <p style={{fontSize:14,fontWeight:600,color:C.textPrimary}}>Checklist</p>
            <p style={{fontSize:12,color:C.textSecondary,marginTop:2}}>{checklistEvent.eventName}</p>
          </div>
          <div style={{background:'rgba(0,0,0,0.2)',border:`1px solid ${C.border}`,borderRadius:8,padding:12}}>
            <ChecklistEditor key={checklistEvent.id}
              value={checklistEvent.checklist||buildDefaultChecklist(checklistEvent)}
              onChange={v=>updateDoc(docRef('shared_events',checklistEvent.id),{checklist:v.slice(0,LONG_TEXT_LIMIT)}).catch(()=>showMsg('Checklist save failed.',true))}/>
          </div>
          <Btn variant="ghost" size="md" onClick={()=>setChecklistId(null)} style={{justifyContent:'center'}}>Done</Btn>
        </Overlay>
      )}
    </div>
  );
}

// ── EVENTS PAGE ──
function EventsPage({ events, showMsg, fetchGemini, currentUser, teamMembers }) {
  const [view, setView] = useState('list'); // list | form | import
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [form, setForm] = useState(blankEventForm());
  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [beoText, setBeoText] = useState('');
  const [previewEvents, setPreviewEvents] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [importBanner, setImportBanner] = useState('');
  const [saving, setSaving] = useState(false);
  const [logTarget, setLogTarget] = useState(null);
  const fileRef = useRef(null);

  const uf = (k,v) => setForm(p=>({...p,[k]:v,...(k==='startDate'&&!p.weekOf?{weekOf:weekOfFromDateTime(v)}:{})}));

  const filtered = useMemo(()=>events.filter(e=>{
    const h=[e.eventName,e.eventPoc,e.selectPoc,e.demo,e.eventLocation,e.notes,e.classification].join(' ').toLowerCase();
    return (!search||h.includes(search.toLowerCase()))&&(!filterClass||e.classification===filterClass)&&(!filterStatus||e.eventStatus===filterStatus);
  }),[events,search,filterClass,filterStatus]);

  const resetForm = () => { setEditingId(null); setForm(blankEventForm()); setView('list'); };

  const startEdit = (e) => {
    setEditingId(e.id);
    setForm({eventName:e.eventName||'',startDate:e.startDate||'',endDate:e.endDate||'',
      eventPoc:e.eventPoc||'',selectPoc:e.selectPoc||'',location:e.location||'NYIH',
      eventLocation:e.eventLocation||'',classification:e.classification||'Internal',
      sessionType:e.sessionType||'Demo',attendees:e.attendees||'',demo:e.demo||'',
      selectResources:e.selectResources||'',sessionDays:e.sessionDays||'',
      sessionSupportDuration:e.sessionSupportDuration||'',supportTeam:e.supportTeam||'NYIH SELECT',
      weekOf:e.weekOf||'',notes:e.notes||'',runOfShow:e.runOfShow||'',
      source:e.source||'Manual',eventStatus:e.eventStatus||'Not Started',
      checklist:e.checklist||'',postEventNotes:e.postEventNotes||''});
    setView('form');
  };

  const handleSave = async (ev) => {
    ev.preventDefault();
    const auto = buildAutomationSummary(form);
    const d = sanitizeEventData({...form,...auto,
      checklist: form.checklist || buildDefaultChecklist(form),
      selectPoc: form.selectPoc||inferSelectOwner(form),
      source: form.source||'Manual',
      weekOf: form.weekOf||weekOfFromDateTime(form.startDate),
    });
    if (!d.eventName||!d.eventPoc){showMsg('Event name and POC required.',true);return;}
    setSaving(true);
    try {
      if (editingId) {
        // Checklist and post-event notes are edited on the event card, not in this form,
        // so don't overwrite changes teammates made while the form was open.
        delete d.checklist; delete d.postEventNotes;
        await updateDoc(docRef('shared_events',editingId),d);
        await logActivity(`${currentUser} updated "${d.eventName}"`,currentUser);
        showMsg('Event updated.');
      } else {
        const ref = await addDoc(col('shared_events'),{...d,timeLogs:[],timestamp:new Date().toISOString()});
        await createSupportTask(ref.id,d);
        await logActivity(`${currentUser} created "${d.eventName}"`,currentUser);
        if (d.riskLevel==='High') await sendSlackAlert(`🔴 High-risk event: ${d.eventName} | ${d.eventLocation||'TBD'} | SELECT: ${d.selectPoc||'TBD'}`);
        showMsg('Event saved + support task created.');
      }
      resetForm();
    } catch(err) { console.error(err); showMsg('Save failed.',true); }
    setSaving(false);
  };

  // Also removes the support task that was auto-generated for this event.
  const del = async (id) => {
    if (!window.confirm('Delete this event and its auto-generated support task?')) return;
    try {
      const linked = await getDocs(query(col('shared_tasks'), where('eventId','==',id)));
      await Promise.all(linked.docs.map(t=>deleteDoc(t.ref)));
      await deleteDoc(docRef('shared_events',id));
      await logActivity(`${currentUser} deleted an event and ${linked.size} linked task(s)`,currentUser);
      showMsg(linked.size ? `Event and ${linked.size} linked task${linked.size>1?'s':''} deleted.` : 'Event deleted.');
    } catch(err) { console.error(err); showMsg('Delete failed.',true); }
  };

  const duplicate = (e) => {
    setForm({...blankEventForm(),eventName:e.eventName+' (Copy)',eventPoc:e.eventPoc||'',
      selectPoc:e.selectPoc||'',location:e.location||'NYIH',eventLocation:e.eventLocation||'',
      classification:e.classification||'Internal',sessionType:e.sessionType||'Demo',
      attendees:e.attendees||'',demo:e.demo||'',selectResources:e.selectResources||'',
      supportTeam:e.supportTeam||'NYIH SELECT',notes:e.notes||'',runOfShow:e.runOfShow||''});
    setEditingId(null); setView('form');
    showMsg('Form pre-filled — set dates and save.');
  };

  const handleImport = async () => {
    let text = beoText;
    const file = fileRef.current?.files?.[0];
    if (!text.trim()&&file) {
      try {
        if (file.name.toLowerCase().endsWith('.pdf')) {
          const pdfjsLib = await new Promise((res,rej)=>{ if(window.pdfjsLib){res(window.pdfjsLib);return;} const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';res(window.pdfjsLib);};s.onerror=()=>rej(new Error('PDF.js failed'));document.head.appendChild(s); });
          const buf = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({data:buf}).promise;
          const pages = [];
          for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);const c=await p.getTextContent();pages.push(c.items.map(x=>x.str).join(' '));}
          text = pages.join('\n');
        } else {
          text = await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result||''));r.onerror=()=>no(new Error('Read failed'));r.readAsText(file);});
        }
        setBeoText(text);
      } catch(err) { showMsg(`File read failed: ${err.message}`,true); return; }
    }
    if (!text.trim()){showMsg('Paste BEO text or upload a file first.',true);return;}
    if (text.trim().length<50){showMsg('Text too short — this PDF may be image-scanned. Try pasting the text directly.',true);return;}
    setAiLoading(true);
    setImportBanner(`Sending ${text.length.toLocaleString()} chars to AI...`);
    const result = await fetchGemini(
      `Extract SELECT-relevant events from this BEO. Return ONLY a JSON array. Each object: eventName, startDate (YYYY-MM-DDTHH:mm), endDate, eventPoc, selectPoc, eventLocation, classification (Internal/Client/Leadership/TBD), sessionType, attendees, demo (equipment list), notes (WRES: id | Host: name | Equipment: list | Special: info). Include events with: *SELECT Required, SELECT team member named, Proto/Spot/Cyviz/Vu AI/Surface Hub/Hypervsn/Alleo/broadcast/MTR mentioned, Tank/Vision/Interchange/ExCo rooms, or loaner laptops/clickers with TXA. Return [] if none found. No markdown.`,
      text,
      { json:true }
    );
    setAiLoading(false);
    if (!result||(typeof result==='string'&&result.startsWith('AI Error:'))){setImportBanner(result||'AI error.');showMsg(result||'AI error.',true);return;}
    let parsed = [];
    try {const c=String(result).replace(/```json|```/g,'').trim();const o=JSON.parse(c);parsed=Array.isArray(o)?o:Array.isArray(o?.events)?o.events:[o];} catch {try{const m=String(result).match(/\[[\s\S]*\]/);if(m)parsed=JSON.parse(m[0]);}catch{}}
    parsed = parsed.filter(e=>e&&typeof e==='object'&&(e.eventName||e.demo));
    if (!parsed.length){setImportBanner('No SELECT events found in this BEO.');showMsg('No SELECT events detected.',true);return;}
    setPreviewEvents(parsed.map(raw=>({...blankEventForm(),...Object.fromEntries(ALLOWED_EVENT_KEYS.filter(k=>raw[k]!=null).map(k=>[k,String(raw[k]).slice(0,fieldLimit(k))])),source:'Imported',supportTeam:'NYIH SELECT',location:'NYIH',weekOf:weekOfFromDateTime(raw.startDate),_isDupe:events.some(x=>x.eventName===raw.eventName&&x.startDate===raw.startDate),_skip:false})));
    setImportBanner(`Found ${parsed.length} event(s) — review and confirm below.`);
  };

  const commitPreview = async () => {
    let saved=0,skipped=0;
    setSaving(true);
    try {
      for (const evt of previewEvents) {
        if (evt._isDupe||evt._skip){skipped++;continue;}
        const {_isDupe,_skip,...clean} = evt;
        const auto = buildAutomationSummary(clean);
        const checklist = buildDefaultChecklist(clean);
        const final = sanitizeEventData({...clean,...auto,checklist,selectPoc:clean.selectPoc||inferSelectOwner(clean)});
        const ref = await addDoc(col('shared_events'),{...final,timeLogs:[],timestamp:new Date().toISOString()});
        await createSupportTask(ref.id,final);
        saved++;
      }
      await logActivity(`${currentUser} imported ${saved} events`,currentUser);
      setPreviewEvents(null);setBeoText('');if(fileRef.current)fileRef.current.value='';
      setImportBanner(`Saved ${saved}${skipped>0?` (${skipped} skipped)`:''}.`);
      showMsg(`Imported ${saved} event(s).`);
    } catch(err) {
      console.error(err);
      showMsg(`Import stopped after ${saved} event(s). Check the list before retrying.`,true);
    }
    setSaving(false);
  };

  const savePostNotes = async (e, v) => {
    if (v===(e.postEventNotes||'')) return;
    try { await updateDoc(docRef('shared_events',e.id),{postEventNotes:v.slice(0,LONG_TEXT_LIMIT)}); showMsg('Notes saved.'); }
    catch(err) { console.error(err); showMsg('Could not save notes.',true); }
  };

  const clsBadgeColor = (c) => c==='Leadership'?'amber':c==='Client'?'green':c==='Confidential'?'red':'default';
  const statusDotColor = (s) => s==='Wrapped'?C.green:s==='In Progress'?C.accent:C.textMuted;

  // ── List view ──
  const renderList = () => (
    <div style={{display:'flex',flexDirection:'column',gap:12,padding:16}}>
      {/* Toolbar */}
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:180,display:'flex',alignItems:'center',gap:8,background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:8,padding:'0 12px'}}>
          <span style={{color:C.textMuted,fontSize:13}}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search events..."
            style={{flex:1,background:'transparent',border:'none',outline:'none',color:C.textPrimary,fontSize:13,padding:'8px 0',fontFamily:'inherit'}}/>
        </div>
        <select value={filterClass} onChange={e=>setFilterClass(e.target.value)}
          style={{background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:8,color:filterClass?C.textPrimary:C.textMuted,fontSize:12,padding:'8px 10px',fontFamily:'inherit'}}>
          <option value="">All types</option>
          {CLASSIFICATIONS.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
          style={{background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:8,color:filterStatus?C.textPrimary:C.textMuted,fontSize:12,padding:'8px 10px',fontFamily:'inherit'}}>
          <option value="">All status</option>
          {EVENT_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{display:'flex',gap:6,marginLeft:'auto'}}>
          <Btn variant="ghost" size="sm" onClick={()=>setView('import')}>⬆ Import BEO</Btn>
          <Btn variant="primary" size="sm" onClick={()=>{setEditingId(null);setForm(blankEventForm());setView('form');}}>+ New event</Btn>
        </div>
      </div>

      {/* Summary strip */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {[{v:events.length,l:'Total'},{v:events.filter(e=>e.riskLevel==='High').length,l:'High risk',c:C.red},{v:events.filter(e=>e.source==='Imported').length,l:'Imported'},{v:events.reduce((s,e)=>s+getAttendeeCount(e.attendees),0),l:'Attendees'}].map((s,i)=>(
          <div key={i} style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 12px',display:'flex',gap:8,alignItems:'baseline'}}>
            <span style={{fontSize:16,fontWeight:600,color:s.c||C.textPrimary}}>{s.v}</span>
            <span style={{fontSize:11,color:C.textMuted}}>{s.l}</span>
          </div>
        ))}
      </div>

      {!filtered.length && <EmptyState icon="📋" title={events.length?'No events match these filters':'No events yet'} subtitle={events.length?'Clear the search or filters to see everything.':'Add an event with + New event or import one from a BEO.'}/>}

      {filtered.map(e => {
        const isExp = expandedId===e.id;
        const { done, total } = checklistProgress(e.checklist);
        const totalHours = sumHours(e.timeLogs);

        return (
          <div key={e.id} style={{...card(),overflow:'hidden',transition:'border-color 0.15s'}}
            onMouseEnter={ev=>ev.currentTarget.style.borderColor=C.borderHover}
            onMouseLeave={ev=>ev.currentTarget.style.borderColor=C.border}>
            {/* Card header */}
            <div style={{padding:'12px 14px',display:'flex',gap:12,alignItems:'flex-start',cursor:'pointer'}} onClick={()=>setExpandedId(isExp?null:e.id)}>
              <div style={{width:3,background:statusDotColor(e.eventStatus),borderRadius:2,alignSelf:'stretch',flexShrink:0,minHeight:40}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
                  <span style={{fontSize:13,fontWeight:500,color:C.textPrimary}}>{e.eventName}</span>
                  <Badge color={clsBadgeColor(e.classification)} size="xs">{e.classification||'TBD'}</Badge>
                  {e.riskLevel&&e.riskLevel!=='Low'&&<Badge color={e.riskLevel==='High'?'red':'amber'} size="xs">{e.riskLevel} risk</Badge>}
                  {e.eventStatus&&e.eventStatus!=='Not Started'&&<Badge color={e.eventStatus==='Wrapped'?'green':'accent'} size="xs">{e.eventStatus}</Badge>}
                  {e.automationSummary&&<Badge color="purple" size="xs">Auto-planned</Badge>}
                </div>
                <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                  <span style={{fontSize:11,color:C.textMuted}}>📅 {e.startDate?fmtTime(e.startDate):'TBD'}{e.startDate&&e.startDate.length>10?' · '+e.startDate.slice(0,10):''}</span>
                  <span style={{fontSize:11,color:C.textMuted}}>📍 {e.eventLocation||'No room'}</span>
                  <span style={{fontSize:11,color:C.textMuted}}>👤 SELECT: {e.selectPoc||'TBD'}</span>
                  {e.demo&&<span style={{fontSize:11,color:C.accent}}>⚡ {e.demo.slice(0,40)}{e.demo.length>40?'…':''}</span>}
                </div>
                {total>0&&<div style={{marginTop:6}}><ProgressBar done={done} total={total}/></div>}
                {totalHours>0&&<p style={{fontSize:11,color:C.green,marginTop:4}}>⏱ {totalHours.toFixed(1)}h total logged</p>}
              </div>
              <div style={{display:'flex',gap:4,flexShrink:0,alignItems:'center'}}>
                <span style={{fontSize:11,color:C.textMuted}}>{isExp?'▲':'▼'}</span>
              </div>
            </div>

            {/* Expanded */}
            {isExp && (
              <div style={{borderTop:`1px solid ${C.border}`,padding:'14px',display:'flex',flexDirection:'column',gap:14,background:'rgba(0,0,0,0.15)'}} className="fade-in">
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <Btn variant="subtle" size="sm" onClick={()=>setLogTarget(e)}>⏱ Log time</Btn>
                  <Btn variant="ghost" size="sm" onClick={()=>startEdit(e)}>✏ Edit</Btn>
                  <Btn variant="ghost" size="sm" onClick={()=>duplicate(e)}>⎘ Duplicate</Btn>
                  <Btn variant="ghost" size="sm" onClick={()=>{const c=`Event: ${e.eventName}\nStart: ${e.startDate}\nEnd: ${e.endDate}\nRoom: ${e.eventLocation}\nPOC: ${e.eventPoc}\nSELECT: ${e.selectPoc}\nEquipment: ${e.demo}\nRun of show: ${e.runOfShow}\nNotes: ${e.notes}\nPost-event: ${e.postEventNotes}`;navigator.clipboard.writeText(c);showMsg('Copied.');}}>⎘ Copy details</Btn>
                  <Btn variant="ghost" size="sm" onClick={()=>del(e.id)} style={{color:C.red,marginLeft:'auto'}}>🗑 Delete</Btn>
                </div>
                {e.runOfShow&&<div><Label>Run of show</Label><p style={{fontSize:12,color:C.textSecondary,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{e.runOfShow}</p></div>}
                {e.notes&&<div><Label>Notes</Label><p style={{fontSize:12,color:C.textSecondary,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{e.notes}</p></div>}
                <div>
                  <Label>Event checklist</Label>
                  <div style={{background:'rgba(0,0,0,0.2)',border:`1px solid ${C.border}`,borderRadius:8,padding:12}}>
                    <ChecklistEditor key={e.id} value={e.checklist||buildDefaultChecklist(e)}
                      onChange={v=>updateDoc(docRef('shared_events',e.id),{checklist:v.slice(0,LONG_TEXT_LIMIT)}).catch(()=>showMsg('Checklist save failed.',true))}/>
                  </div>
                </div>
                <div>
                  <Label>Post-event notes {e.eventStatus==='Wrapped'&&<span style={{color:C.accent,fontWeight:400,textTransform:'none',letterSpacing:0}}> — add debrief</span>}</Label>
                  <textarea defaultValue={e.postEventNotes||''} rows={3} maxLength={LONG_TEXT_LIMIT}
                    onBlur={ev=>savePostNotes(e, ev.target.value)}
                    placeholder="What happened? Issues, lessons learned, follow-ups..."
                    style={{width:'100%',background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:8,color:C.textPrimary,fontSize:12,padding:'9px 12px',fontFamily:'inherit',resize:'vertical'}}/>
                </div>
                {(e.timeLogs||[]).length>0&&(
                  <div>
                    <Label>Time logged</Label>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      {(e.timeLogs||[]).map((l,i)=>(
                        <div key={i} style={{display:'flex',gap:10,fontSize:11,color:C.textSecondary,padding:'4px 8px',background:'rgba(255,255,255,0.02)',borderRadius:6,flexWrap:'wrap'}}>
                          <span style={{color:C.green,fontWeight:500}}>{l.hours}h</span>
                          <span>{l.user}</span>
                          {l.note&&<span style={{color:C.textMuted}}>— {l.note}</span>}
                          <span style={{marginLeft:'auto',color:C.textMuted}}>{l.date}</span>
                        </div>
                      ))}
                      <div style={{fontSize:12,fontWeight:500,color:C.green,paddingTop:4}}>Total: {totalHours.toFixed(1)}h</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Form view ──
  const renderForm = () => (
    <div style={{padding:16,maxWidth:680}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <Btn variant="ghost" size="sm" onClick={resetForm}>← Back</Btn>
        <h2 style={{fontSize:15,fontWeight:600,color:C.textPrimary}}>{editingId?'Edit event':'New event'}</h2>
      </div>
      {/* Quick fill */}
      <div style={{marginBottom:16}}>
        <Label>Quick fill</Label>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {QUICK_FILL_CARDS.map(c=>(
            <button type="button" key={c.name} onClick={()=>setForm(p=>({...p,demo:c.demo,sessionType:c.sessionType}))}
              style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${C.border}`,borderRadius:8,
                padding:'7px 12px',cursor:'pointer',fontSize:12,color:C.textSecondary,textAlign:'left',transition:'all 0.15s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;e.currentTarget.style.color=C.textPrimary;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.textSecondary;}}>
              <div style={{fontWeight:500,color:C.textPrimary}}>{c.name}</div>
              <div style={{fontSize:10,color:C.textMuted}}>{c.note}</div>
            </button>
          ))}
        </div>
      </div>
      <form onSubmit={handleSave} style={{display:'flex',flexDirection:'column',gap:12}}>
        <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div><Label>Event name *</Label><Input value={form.eventName} onChange={e=>uf('eventName',e.target.value)} placeholder="Event name" maxLength={700} required/></div>
          <div><Label>Event POC *</Label><Input value={form.eventPoc} onChange={e=>uf('eventPoc',e.target.value)} placeholder="POC name" maxLength={700} required/></div>
        </div>
        <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div><Label>Start</Label><Input value={form.startDate} onChange={e=>uf('startDate',e.target.value)} type="datetime-local" required/></div>
          <div><Label>End</Label><Input value={form.endDate} onChange={e=>uf('endDate',e.target.value)} type="datetime-local" required/></div>
        </div>
        <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div><Label>SELECT lead</Label><Select value={form.selectPoc} onChange={e=>uf('selectPoc',e.target.value)}><option value="">Auto-assign</option>{teamMembers.map(m=><option key={m} value={m}>{m}</option>)}</Select></div>
          <div>
            <Label>Room</Label>
            {/* One field: pick a suggested room or type any other room name */}
            <Input value={form.eventLocation} onChange={e=>uf('eventLocation',e.target.value)}
              list="select-room-options" placeholder="Pick a room or type one" maxLength={700}/>
            <datalist id="select-room-options">
              {ROOMS.map(r=><option key={r} value={r}/>)}
            </datalist>
          </div>
        </div>
        <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div><Label>Classification</Label><Select value={form.classification} onChange={e=>uf('classification',e.target.value)}>{CLASSIFICATIONS.map(c=><option key={c} value={c}>{c}</option>)}</Select></div>
          <div><Label>Session type</Label><Select value={form.sessionType} onChange={e=>uf('sessionType',e.target.value)}>{SESSION_TYPES.map(s=><option key={s} value={s}>{s}</option>)}</Select></div>
        </div>
        <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div><Label>Attendees</Label><Input value={form.attendees} onChange={e=>uf('attendees',e.target.value)} placeholder="Estimated count" maxLength={700}/></div>
          <div><Label>Support team</Label><Select value={form.supportTeam} onChange={e=>uf('supportTeam',e.target.value)}>{SUPPORT_TEAMS.map(t=><option key={t} value={t}>{t}</option>)}</Select></div>
        </div>
        <div><Label>Demo / equipment</Label><Input value={form.demo} onChange={e=>uf('demo',e.target.value)} placeholder="Proto, Cyviz, Surface Hub..." maxLength={700}/></div>
        <div><Label>SELECT resources</Label><Input value={form.selectResources} onChange={e=>uf('selectResources',e.target.value)} placeholder="Additional resources needed" maxLength={LONG_TEXT_LIMIT}/></div>
        <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div><Label>Duration</Label><Select value={form.sessionSupportDuration} onChange={e=>uf('sessionSupportDuration',e.target.value)}><option value="">Select duration</option>{DURATION_OPTIONS.map(d=><option key={d} value={d}>{d}</option>)}</Select></div>
          <div><Label>Week of</Label><Input value={form.weekOf} onChange={e=>uf('weekOf',e.target.value)} type="date"/></div>
        </div>
        <div><Label>Run of show / timing</Label><Input value={form.runOfShow} onChange={e=>uf('runOfShow',e.target.value)} placeholder="9:00 welcome · 9:15 Proto demo · 9:45 Q&A" rows={2} maxLength={LONG_TEXT_LIMIT}/></div>
        <div><Label>Notes</Label><Input value={form.notes} onChange={e=>uf('notes',e.target.value)} placeholder="Any additional notes..." rows={3} maxLength={LONG_TEXT_LIMIT}/></div>
        <Divider/>
        <div style={{display:'flex',gap:8}}>
          <Btn type="submit" variant="primary" size="md" disabled={saving} style={{flex:1,justifyContent:'center'}}>
            {saving?<><Spinner size={13}/>Saving…</>:(editingId?'Update event':'Save event')}
          </Btn>
          <Btn variant="ghost" size="md" onClick={resetForm} style={{justifyContent:'center'}}>Cancel</Btn>
        </div>
      </form>
    </div>
  );

  // ── Import view ──
  const previewInput = {background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:6,color:C.textSecondary,fontSize:11,padding:'5px 8px',fontFamily:'inherit'};
  const updatePreview = (idx, patch) => { const p=[...previewEvents]; p[idx]={...p[idx],...patch}; setPreviewEvents(p); };
  const renderImport = () => (
    <div style={{padding:16,maxWidth:680}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <Btn variant="ghost" size="sm" onClick={()=>{setView('list');setPreviewEvents(null);setImportBanner('');}}>← Back</Btn>
        <h2 style={{fontSize:15,fontWeight:600,color:C.textPrimary}}>Import from BEO</h2>
      </div>
      <p style={{fontSize:12,color:C.textMuted,marginBottom:14,lineHeight:1.6}}>
        Upload a BEO or paste text — AI extracts SELECT events for review before saving. Remove client names before importing.
      </p>
      {importBanner&&(
        <div style={{background:C.accentBg,border:`1px solid ${C.accentBorder}`,borderRadius:8,padding:'10px 14px',fontSize:12,color:C.accent,marginBottom:14,display:'flex',alignItems:'center',gap:8}}>
          {aiLoading?<Spinner size={12}/>:'✓'} {importBanner}
        </div>
      )}
      {!previewEvents&&(
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <textarea value={beoText} onChange={e=>setBeoText(e.target.value)} rows={8}
            placeholder="Paste BEO text here..."
            style={{width:'100%',background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:8,color:C.textPrimary,fontSize:12,padding:'10px 12px',fontFamily:'monospace',resize:'vertical'}}/>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.csv"
            style={{fontSize:12,color:C.textSecondary}}/>
          <Btn variant="primary" size="md" onClick={handleImport} disabled={aiLoading} style={{alignSelf:'flex-start'}}>
            {aiLoading?<><Spinner size={13}/>Extracting...</>:'⚡ Extract SELECT events'}
          </Btn>
        </div>
      )}
      {previewEvents&&(
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <p style={{fontSize:13,fontWeight:500,color:C.textPrimary}}>Review {previewEvents.length} event{previewEvents.length!==1?'s':''}</p>
            <div style={{display:'flex',gap:8}}>
              <Btn variant="ghost" size="sm" onClick={()=>{setPreviewEvents(null);setImportBanner('');}}>Cancel</Btn>
              <Btn variant="success" size="sm" onClick={commitPreview} disabled={saving}>
                {saving?<><Spinner size={11}/>Saving…</>:`Save ${previewEvents.filter(e=>!e._isDupe&&!e._skip).length} events`}
              </Btn>
            </div>
          </div>
          {previewEvents.map((evt,idx)=>(
            <div key={idx} style={{...card(),padding:12,opacity:evt._skip?0.4:1,border:`1px solid ${evt._isDupe?C.amber:evt._skip?C.border:C.accentBorder}`}}>
              <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:6}}>
                  <input value={evt.eventName} onChange={e=>updatePreview(idx,{eventName:e.target.value})}
                    style={{background:'transparent',border:'none',borderBottom:`1px solid ${C.border}`,color:C.textPrimary,fontSize:13,fontWeight:500,padding:'3px 0',fontFamily:'inherit',width:'100%'}}/>
                  <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                    <input value={evt.startDate} type="datetime-local" aria-label="Start" onChange={e=>updatePreview(idx,{startDate:e.target.value})} style={previewInput}/>
                    <input value={evt.endDate} type="datetime-local" aria-label="End" onChange={e=>updatePreview(idx,{endDate:e.target.value})} style={previewInput}/>
                  </div>
                  <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                    <input value={evt.eventLocation} placeholder="Room" list="select-room-options" onChange={e=>updatePreview(idx,{eventLocation:e.target.value})} style={previewInput}/>
                    <input value={evt.demo} placeholder="Equipment" onChange={e=>updatePreview(idx,{demo:e.target.value})} style={previewInput}/>
                  </div>
                  {evt._isDupe&&<span style={{fontSize:10,color:C.amber}}>⚠ Duplicate — already exists</span>}
                </div>
                <button type="button" onClick={()=>updatePreview(idx,{_skip:!evt._skip})}
                  style={{background:evt._skip?C.greenBg:C.redBg,border:'none',borderRadius:6,cursor:'pointer',
                    fontSize:10,fontWeight:600,color:evt._skip?C.green:C.red,padding:'5px 10px',flexShrink:0}}>
                  {evt._skip?'Include':'Skip'}
                </button>
              </div>
            </div>
          ))}
          <datalist id="select-room-options">{ROOMS.map(r=><option key={r} value={r}/>)}</datalist>
        </div>
      )}
    </div>
  );

  return (
    <div style={{flex:1,overflow:'auto'}}>
      {view==='list'&&renderList()}
      {view==='form'&&renderForm()}
      {view==='import'&&renderImport()}
      {logTarget && (
        <LogTimeModal title={logTarget.eventName} defaultDate={defaultLogDate(logTarget)} showMsg={showMsg}
          onClose={()=>setLogTarget(null)}
          onSubmit={async (v)=>{ await logEventTime(logTarget, currentUser, v); showMsg(`Logged ${v.hours}h on ${logTarget.eventName}.`); }}/>
      )}
    </div>
  );
}

// ── TASKS ──
// Defined at the top level (not inside TasksPage) so cards keep their state and focus
// when Firestore pushes updates.
const moveBtnStyle = {background:'rgba(255,255,255,0.05)',border:'none',borderRadius:5,color:C.textSecondary,cursor:'pointer',fontSize:11,padding:'3px 8px'};
const taskInputStyle = {background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:7,color:C.textPrimary,fontSize:12,padding:'7px 8px',fontFamily:'inherit'};

function TaskCard({ t, teamMembers, expanded, editing, onToggleExpand, onStartEdit, onCancelEdit, onSaveEdit, onMove, onDelete, onLogTime, onChecklistChange }) {
  const [logOpen, setLogOpen] = useState(false);
  const [logH, setLogH] = useState('');
  const [logN, setLogN] = useState('');
  const [logging, setLogging] = useState(false);
  const { done, total } = checklistProgress(t.details);
  const hasChecklist = total>0;
  const totalH = sumHours(t.timeLogs);
  const shownH = totalH>0 ? totalH.toFixed(1) : t.timeSpent;
  const st = normStatus(t);

  const submitLog = async () => {
    setLogging(true);
    const ok = await onLogTime(t, logH, logN);
    setLogging(false);
    if (ok) { setLogH(''); setLogN(''); setLogOpen(false); }
  };

  if (editing) return (
    <form onSubmit={e=>onSaveEdit(e,t)} style={{...card(),padding:12,display:'flex',flexDirection:'column',gap:8}}>
      <input name="t" defaultValue={t.title} required maxLength={300} style={{...taskInputStyle,border:`1px solid ${C.accent}`,fontSize:13,padding:'8px 10px',width:'100%'}}/>
      <textarea name="det" defaultValue={t.details} rows={4} maxLength={LONG_TEXT_LIMIT} placeholder="Checklist / notes..." style={{...taskInputStyle,padding:'8px 10px',resize:'vertical'}}/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <select name="a" defaultValue={t.assignee} style={taskInputStyle}>
          <option value="">Assign...</option>{teamMembers.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
        <input name="d" type="date" defaultValue={t.dueDate} style={taskInputStyle}/>
      </div>
      <div style={{display:'flex',gap:6}}>
        <Btn type="submit" variant="primary" size="sm" style={{flex:1,justifyContent:'center'}}>Save</Btn>
        <Btn variant="ghost" size="sm" onClick={onCancelEdit} style={{flex:1,justifyContent:'center'}}>Cancel</Btn>
      </div>
    </form>
  );

  return (
    <div style={{...card(),overflow:'hidden',transition:'border-color 0.15s'}}
      onMouseEnter={e=>e.currentTarget.style.borderColor=C.borderHover}
      onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
      <div style={{padding:'10px 12px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:6,marginBottom:6}}>
          <p style={{fontSize:12,fontWeight:500,color:C.textPrimary,lineHeight:1.4,flex:1}}>{t.title}</p>
          <button type="button" onClick={()=>onDelete(t)} aria-label="Delete task" style={{background:'none',border:'none',cursor:'pointer',fontSize:13,color:C.textMuted,padding:0,flexShrink:0,opacity:0.6}}
            onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}>✕</button>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:6}}>
          {t.assignee&&<div style={{display:'flex',alignItems:'center',gap:4}}><Avatar name={t.assignee} size={16}/><span style={{fontSize:10,color:C.textMuted}}>{t.assignee.split('.')[0]}</span></div>}
          {t.linkedEvent&&<Badge color="accent" size="xs">{t.linkedEvent.slice(0,20)}</Badge>}
          {t.dueDate&&<span style={{fontSize:10,color:C.textMuted}}>📅 {t.dueDate}</span>}
          {shownH&&<span style={{fontSize:10,color:C.green}}>⏱ {shownH}h</span>}
        </div>
        {hasChecklist&&(
          <div style={{marginBottom:6}}>
            <button type="button" onClick={onToggleExpand}
              style={{display:'flex',alignItems:'center',gap:6,background:expanded?C.accentBg:'rgba(255,255,255,0.03)',border:`1px solid ${expanded?C.accentBorder:C.border}`,borderRadius:6,padding:'4px 8px',cursor:'pointer',width:'100%'}}>
              <span style={{fontSize:10,color:expanded?C.accent:C.textMuted}}>☑ {done}/{total} items</span>
              <div style={{flex:1,height:2,background:'rgba(255,255,255,0.05)',borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${total?(done/total)*100:0}%`,background:done===total?C.green:C.accent,borderRadius:2}}/>
              </div>
              <span style={{fontSize:10,color:C.textMuted}}>{expanded?'▲':'▼'}</span>
            </button>
          </div>
        )}
        {expanded&&hasChecklist&&(
          <div style={{background:'rgba(0,0,0,0.2)',border:`1px solid ${C.border}`,borderRadius:7,padding:10,marginBottom:6}} className="fade-in">
            <ChecklistEditor value={t.details} onChange={v=>onChecklistChange(t,v)}/>
          </div>
        )}
        {/* Time log inline */}
        {!logOpen?(
          <button type="button" onClick={()=>setLogOpen(true)} style={{background:'none',border:'none',cursor:'pointer',fontSize:10,color:C.textMuted,padding:0}}
            onMouseEnter={e=>e.currentTarget.style.color=C.accent} onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}>+ Log time</button>
        ):(
          <div style={{display:'flex',gap:5,alignItems:'center'}} className="fade-in">
            <input value={logH} onChange={e=>setLogH(e.target.value)} type="number" min="0.25" step="0.25" placeholder="hrs" aria-label="Hours" autoFocus
              style={{width:54,background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:6,color:C.textPrimary,fontSize:11,padding:'4px 7px',fontFamily:'inherit'}}/>
            <input value={logN} onChange={e=>setLogN(e.target.value)} placeholder="note" aria-label="Note" maxLength={500}
              onKeyDown={e=>{ if(e.key==='Enter') submitLog(); }}
              style={{flex:1,minWidth:0,background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:6,color:C.textPrimary,fontSize:11,padding:'4px 7px',fontFamily:'inherit'}}/>
            <button type="button" onClick={submitLog} disabled={logging}
              style={{background:C.accent,border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:500,padding:'4px 8px',cursor:'pointer',opacity:logging?0.5:1}}>Log</button>
            <button type="button" onClick={()=>setLogOpen(false)} aria-label="Cancel" style={{background:'none',border:'none',cursor:'pointer',color:C.textMuted,fontSize:12}}>✕</button>
          </div>
        )}
        {/* Move + edit — always visible so they work on touch screens */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}>
          <div style={{display:'flex',gap:4}}>
            {st!=='todo'&&<button type="button" title={st==='complete'?'Move to Doing':'Move to To do'} onClick={()=>onMove(t,st==='complete'?'doing':'todo')} style={moveBtnStyle}>←</button>}
            {st!=='complete'&&<button type="button" title={st==='todo'?'Move to Doing':'Move to Done'} onClick={()=>onMove(t,st==='todo'?'doing':'complete')} style={moveBtnStyle}>→</button>}
          </div>
          <button type="button" onClick={onStartEdit} style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:C.accent,fontWeight:500}}>Edit</button>
        </div>
      </div>
    </div>
  );
}

function TasksPage({ tasks, showMsg, currentUser, teamMembers }) {
  const [filterMember, setFilterMember] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const handleAdd = async (e) => {
    e.preventDefault();
    const formEl = e.target;
    const fd = new FormData(formEl);
    const d = {title:String(fd.get('t')||'').trim(),assignee:fd.get('a')||'',dueDate:fd.get('d')||'',details:fd.get('det')||'',timeLogs:[],timeSpent:'',status:'todo',timestamp:new Date().toISOString()};
    if (!d.title) return;
    try {
      await addDoc(col('shared_tasks'),d);
      await logActivity(`${currentUser} added task "${d.title}"`,currentUser);
      formEl.reset(); showMsg('Task added.');
    } catch(err) { console.error(err); showMsg('Could not add the task.',true); }
  };

  const move = async (t,s) => {
    try {
      await updateDoc(docRef('shared_tasks',t.id),{status:s});
      await logActivity(`${currentUser} moved "${t.title}" to ${s}`,currentUser);
    } catch(err) { console.error(err); showMsg('Could not move the task.',true); }
  };

  const del = async (t) => {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    try { await deleteDoc(docRef('shared_tasks',t.id)); showMsg('Task deleted.'); }
    catch(err) { console.error(err); showMsg('Delete failed.',true); }
  };

  const saveEdit = async (e,t) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await updateDoc(docRef('shared_tasks',t.id),{title:fd.get('t'),assignee:fd.get('a'),dueDate:fd.get('d'),details:fd.get('det')});
      await logActivity(`${currentUser} updated "${t.title}"`,currentUser);
      setEditingId(null); showMsg('Task updated.');
    } catch(err) { console.error(err); showMsg('Could not save the task.',true); }
  };

  // Returns true on success so the card can clear its inputs.
  const logTime = async (task,hours,note) => {
    const hrs = parseFloat(hours);
    if (isNaN(hrs)||hrs<=0) { showMsg('Enter hours greater than 0.',true); return false; }
    const entry = {user:currentUser,hours:hrs,note:String(note||'').trim(),date:getTodayStr(),timestamp:new Date().toISOString()};
    try {
      await updateDoc(docRef('shared_tasks',task.id),{
        timeLogs: arrayUnion(entry),
        timeSpent: (sumHours(task.timeLogs)+hrs).toFixed(1), // display uses timeLogs; kept for older records
      });
      await logActivity(`${currentUser} logged ${hrs}h on "${task.title}"`,currentUser);
      showMsg(`Logged ${hrs}h.`);
      return true;
    } catch(err) { console.error(err); showMsg('Could not log time.',true); return false; }
  };

  const saveChecklist = (t,v) =>
    updateDoc(docRef('shared_tasks',t.id),{details:v.slice(0,LONG_TEXT_LIMIT)}).catch(()=>showMsg('Checklist save failed.',true));

  const visible = filterMember ? tasks.filter(t=>t.assignee===filterMember) : tasks;
  const cols = [
    {key:'todo',label:'To do',color:C.textMuted},
    {key:'doing',label:'Doing',color:C.amber},
    {key:'complete',label:'Done',color:C.green},
  ];
  const fieldStyle = {background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:8,color:C.textSecondary,fontSize:12,padding:'8px 10px',fontFamily:'inherit'};

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      {/* Add form */}
      <div style={{borderBottom:`1px solid ${C.border}`,padding:'12px 16px',background:C.surface}}>
        <form onSubmit={handleAdd} style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <input name="t" placeholder="Add a task..." required maxLength={300}
            style={{...fieldStyle,flex:1,minWidth:160,color:C.textPrimary,fontSize:13,padding:'8px 12px'}}/>
          <select name="a" style={fieldStyle}>
            <option value="">Assign...</option>{teamMembers.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
          <input name="d" type="date" aria-label="Due date" style={fieldStyle}/>
          <input name="det" placeholder="Notes..." maxLength={LONG_TEXT_LIMIT} style={{...fieldStyle,flex:1,minWidth:100,padding:'8px 12px'}}/>
          <Btn type="submit" variant="primary" size="sm">+ Add</Btn>
        </form>
        {/* Assignee filter */}
        <div style={{display:'flex',gap:6,marginTop:10,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:C.textMuted}}>Filter:</span>
          <button type="button" onClick={()=>setFilterMember('')} style={{background:filterMember===''?C.accentBg:'transparent',border:`1px solid ${filterMember===''?C.accent:C.border}`,borderRadius:6,color:filterMember===''?C.accent:C.textMuted,fontSize:11,padding:'3px 8px',cursor:'pointer'}}>All</button>
          {teamMembers.map(m=>(
            <button type="button" key={m} onClick={()=>setFilterMember(filterMember===m?'':m)} title={m} aria-label={`Show ${m}'s tasks`}
              style={{width:28,height:28,borderRadius:'50%',border:`1px solid ${filterMember===m?C.accent:C.border}`,
                background:filterMember===m?C.accentBg:'transparent',color:filterMember===m?C.accent:C.textMuted,
                fontSize:10,fontWeight:600,cursor:'pointer'}}>
              {initials(m)}
            </button>
          ))}
          {filterMember&&<span style={{fontSize:11,color:C.accent}}>{filterMember} · {visible.length} task{visible.length!==1?'s':''}</span>}
        </div>
      </div>
      {/* Kanban columns */}
      <div className="kanban" style={{flex:1,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:0,overflow:'hidden'}}>
        {cols.map(({key,label,color})=>{
          const colTasks = visible.filter(t=>normStatus(t)===key);
          return (
            <div key={key} className="kanban-col" style={{borderRight:key!=='complete'?`1px solid ${C.border}`:'none',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em',color}}>{label}</span>
                <span style={{fontSize:11,color:C.textMuted,background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'2px 7px'}}>{colTasks.length}</span>
              </div>
              <div className="kanban-list" style={{flex:1,overflow:'auto',padding:10,display:'flex',flexDirection:'column',gap:8}}>
                {colTasks.map(t=>(
                  <TaskCard key={t.id} t={t} teamMembers={teamMembers}
                    expanded={expandedId===t.id} editing={editingId===t.id}
                    onToggleExpand={()=>setExpandedId(expandedId===t.id?null:t.id)}
                    onStartEdit={()=>setEditingId(t.id)} onCancelEdit={()=>setEditingId(null)}
                    onSaveEdit={saveEdit} onMove={move} onDelete={del} onLogTime={logTime}
                    onChecklistChange={saveChecklist}/>
                ))}
                {!colTasks.length&&(
                  <div style={{textAlign:'center',padding:'20px 10px',color:C.textMuted,fontSize:11}}>
                    {key==='todo'?'No tasks queued':'Empty'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ISSUES PAGE ──
function IssuesPage({ issues, showMsg, fetchGemini, setModal, currentUser }) {
  const [aiLoadingId, setAiLoadingId] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [resNote, setResNote] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [resolvedSearch, setResolvedSearch] = useState('');

  const handleAdd = async (e) => {
    e.preventDefault();
    const formEl = e.target;
    const fd = new FormData(formEl);
    const d = {
      title:String(fd.get('title')||'').trim(), device:fd.get('device')||'', location:fd.get('location')||'',
      urgency:fd.get('urgency')||'Normal', status:'Open', reporter:fd.get('reporter')||currentUser,
      notes:fd.get('notes')||'', resolutionNotes:'', timestamp:new Date().toISOString(),
    };
    if (!d.title){showMsg('Title required.',true);return;}
    try {
      await addDoc(col('shared_issues'),d);
      await logActivity(`${currentUser} logged issue "${d.title}" (${d.urgency})`,currentUser);
      if (d.urgency==='Urgent') await sendSlackAlert(`🚨 Urgent issue: ${d.title} | Device: ${d.device||'N/A'} | Location: ${d.location||'N/A'}`);
      formEl.reset(); showMsg('Issue logged.');
    } catch(err) { console.error(err); showMsg('Could not log the issue.',true); }
  };

  const updateStatus = async (id,status,title) => {
    if (status==='Resolved'){setResolvingId(id);setResNote('');return;}
    try {
      await updateDoc(docRef('shared_issues',id),{status});
      await logActivity(`${currentUser} marked "${title}" as ${status}`,currentUser);
      showMsg(`Marked ${status}.`);
    } catch(err) { console.error(err); showMsg('Could not update the issue.',true); }
  };

  const commitResolve = async (id,title) => {
    try {
      await updateDoc(docRef('shared_issues',id),{status:'Resolved',resolutionNotes:resNote,resolvedAt:new Date().toISOString(),resolvedBy:currentUser});
      await logActivity(`${currentUser} resolved "${title}" — ${resNote||'no notes'}`,currentUser);
      setResolvingId(null);setResNote('');showMsg('Issue resolved.');
    } catch(err) { console.error(err); showMsg('Could not resolve the issue.',true); }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this issue?')) return;
    try { await deleteDoc(docRef('shared_issues',id)); showMsg('Issue deleted.'); }
    catch(err) { console.error(err); showMsg('Delete failed.',true); }
  };

  const aiSuggest = async (issue) => {
    setAiLoadingId(issue.id);
    const result = await fetchGemini('You are a senior IT/AV support engineer at Accenture NYIH. Give a SHORT (3-5 bullets) troubleshooting plan.',`Title: ${issue.title}\nDevice: ${issue.device}\nLocation: ${issue.location}\nNotes: ${issue.notes}`);
    setAiLoadingId(null);
    if (!result||(typeof result==='string'&&result.startsWith('AI Error:'))){showMsg(result||'AI error.',true);return;}
    setModal({title:`Fix suggestion: ${issue.title}`,content:result,actionLabel:'Copy',action:()=>{navigator.clipboard.writeText(result);showMsg('Copied.');}});
  };

  const ugColor = (u) => u==='Urgent'?C.red:u==='High'?C.amber:u==='Low'?C.green:C.textMuted;

  const active = issues.filter(i=>i.status!=='Resolved');
  const resolved = issues.filter(i=>i.status==='Resolved').filter(i=>!resolvedSearch||((i.title+' '+(i.resolutionNotes||'')+' '+(i.device||'')).toLowerCase().includes(resolvedSearch.toLowerCase())));

  const renderIssue = (i) => (
    <div key={i.id} style={{...card(),overflow:'hidden',borderLeft:`3px solid ${ugColor(i.urgency)}`,borderRadius:'0 10px 10px 0'}}>
      <div style={{padding:'11px 14px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:6}}>
          <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,flex:1}}>{i.title}</p>
          <button type="button" onClick={()=>del(i.id)} aria-label="Delete issue" style={{background:'none',border:'none',cursor:'pointer',color:C.textMuted,fontSize:13,opacity:0.6}}
            onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}>✕</button>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:6}}>
          <Badge color={i.urgency==='Urgent'?'red':i.urgency==='High'?'amber':i.urgency==='Low'?'green':'default'} size="xs">{i.urgency||'Normal'}</Badge>
          <Badge color={i.status==='Open'?'red':i.status==='In Progress'?'amber':'green'} size="xs">{i.status}</Badge>
          {i.device&&<Badge size="xs">{i.device}</Badge>}
          {i.location&&<Badge size="xs">{i.location}</Badge>}
        </div>
        {i.notes&&<p style={{fontSize:12,color:C.textSecondary,marginBottom:6,lineHeight:1.5,whiteSpace:'pre-wrap'}}>{i.notes}</p>}
        {i.reporter&&<p style={{fontSize:11,color:C.textMuted,marginBottom:6}}>Reported by: {i.reporter}</p>}
        {i.resolutionNotes&&(
          <div style={{background:C.greenBg,border:`1px solid rgba(52,201,138,0.2)`,borderRadius:7,padding:'8px 10px',marginBottom:6}}>
            <p style={{fontSize:10,fontWeight:600,color:C.green,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:3}}>Resolution</p>
            <p style={{fontSize:12,color:C.textSecondary,whiteSpace:'pre-wrap'}}>{i.resolutionNotes}</p>
            {i.resolvedBy&&<p style={{fontSize:10,color:C.textMuted,marginTop:3}}>by {i.resolvedBy}{i.resolvedAt?` · ${new Date(i.resolvedAt).toLocaleString()}`:''}</p>}
          </div>
        )}
        {resolvingId===i.id&&(
          <div style={{background:'rgba(52,201,138,0.05)',border:`1px solid rgba(52,201,138,0.2)`,borderRadius:8,padding:10,marginBottom:8,display:'flex',flexDirection:'column',gap:7}} className="fade-in">
            <p style={{fontSize:11,fontWeight:600,color:C.green}}>What fixed it?</p>
            <textarea value={resNote} onChange={e=>setResNote(e.target.value)} rows={2} maxLength={LONG_TEXT_LIMIT} placeholder="Describe the fix — the team will see this next time..."
              style={{background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:7,color:C.textPrimary,fontSize:12,padding:'8px 10px',fontFamily:'inherit',resize:'vertical'}}/>
            <div style={{display:'flex',gap:6}}>
              <Btn variant="success" size="sm" onClick={()=>commitResolve(i.id,i.title)}>Mark resolved</Btn>
              <Btn variant="ghost" size="sm" onClick={()=>setResolvingId(null)}>Cancel</Btn>
            </div>
          </div>
        )}
        {resolvingId!==i.id&&(
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {i.status!=='In Progress'&&i.status!=='Resolved'&&<Btn variant="amber" size="sm" onClick={()=>updateStatus(i.id,'In Progress',i.title)}>In progress</Btn>}
            {i.status!=='Resolved'&&<Btn variant="ghost" size="sm" onClick={()=>updateStatus(i.id,'Resolved',i.title)} style={{color:C.green}}>Resolve</Btn>}
            <Btn variant="subtle" size="sm" onClick={()=>aiSuggest(i)} disabled={aiLoadingId===i.id}>{aiLoadingId===i.id?<><Spinner size={11}/>Thinking…</>:'⚡ AI fix'}</Btn>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{flex:1,overflow:'auto',padding:16,display:'flex',flexDirection:'column',gap:14}}>
      {/* Log form */}
      <div style={{...card('pad')}}>
        <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:12}}>Log a tech issue</p>
        <form onSubmit={handleAdd} style={{display:'flex',flexDirection:'column',gap:10}}>
          <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div><Label>Issue *</Label><Input name="title" placeholder="What's wrong?" maxLength={300} required/></div>
            <div><Label>Device</Label><Input name="device" placeholder="Surface Hub, Cyviz..." maxLength={200}/></div>
            <div><Label>Location</Label><Input name="location" placeholder="Room / floor" maxLength={200}/></div>
            <div><Label>Urgency</Label>
              <Select name="urgency" defaultValue="Normal" style={{color:C.textSecondary}}>
                <option value="Normal">Normal</option><option value="Low">Low</option><option value="High">High</option><option value="Urgent">Urgent</option>
              </Select>
            </div>
            <div style={{gridColumn:'1/-1'}}><Label>Reporter</Label><Input name="reporter" placeholder={`Defaults to ${currentUser}`} maxLength={200}/></div>
          </div>
          <Input name="notes" placeholder="Notes / symptoms..." rows={2} maxLength={LONG_TEXT_LIMIT}/>
          <Btn type="submit" variant="primary" size="md" style={{alignSelf:'flex-start'}}>Log issue</Btn>
        </form>
      </div>

      {/* Active issues */}
      <div>
        <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:10}}>Active issues ({active.length})</p>
        {!active.length&&<EmptyState icon="✅" title="No open issues" subtitle="All clear. Log an issue above if something needs attention."/>}
        <div style={{display:'flex',flexDirection:'column',gap:8}}>{active.map(renderIssue)}</div>
      </div>

      {/* Resolution library */}
      <div style={{...card(),overflow:'hidden'}}>
        <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <p style={{fontSize:13,fontWeight:500,color:C.textPrimary}}>Resolution library ({issues.filter(i=>i.status==='Resolved').length})</p>
          <button type="button" onClick={()=>setShowResolved(!showResolved)} style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:C.accent}}>{showResolved?'Hide':'Show'}</button>
        </div>
        {showResolved&&(
          <div style={{padding:12,display:'flex',flexDirection:'column',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8,background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:8,padding:'0 12px'}}>
              <span style={{color:C.textMuted,fontSize:13}}>🔍</span>
              <input value={resolvedSearch} onChange={e=>setResolvedSearch(e.target.value)} placeholder="Search fixes... (e.g. Cyviz, Surface Hub)"
                style={{flex:1,background:'transparent',border:'none',outline:'none',color:C.textPrimary,fontSize:12,padding:'8px 0',fontFamily:'inherit'}}/>
            </div>
            {!resolved.length&&<p style={{fontSize:12,color:C.textMuted,textAlign:'center',padding:'12px 0'}}>No resolved issues{resolvedSearch?' matching your search':''}.</p>}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>{resolved.slice(0,10).map(renderIssue)}</div>
          </div>
        )}
        {!showResolved&&<p style={{fontSize:12,color:C.textMuted,padding:'10px 14px'}}>Expand to search past resolutions and find what fixed a device last time.</p>}
      </div>
    </div>
  );
}

// ── ROOMS PAGE ──
function RoomsPage({ rooms, showMsg, currentUser, teamMembers }) {
  const blankRoom = {title:'',owner:'',backupOwner:'',status:'Operational',devices:'',notes:''};
  const [form, setForm] = useState(blankRoom);
  const [editingId, setEditingId] = useState(null);
  const sf = (k,v) => setForm(p=>({...p,[k]:v}));
  const reset = () => { setEditingId(null); setForm(blankRoom); };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title){showMsg('Name required.',true);return;}
    const now = new Date().toISOString();
    try {
      if (editingId) { await updateDoc(docRef('shared_rooms',editingId),{...form,lastUpdated:now,updatedBy:currentUser}); showMsg('Room updated.'); }
      else { await addDoc(col('shared_rooms'),{...form,lastUpdated:now,updatedBy:currentUser,timestamp:now}); showMsg('Room added.'); }
      reset();
    } catch(err) { console.error(err); showMsg('Save failed.',true); }
  };

  const setStatus = async (room, status) => {
    try {
      await updateDoc(docRef('shared_rooms',room.id),{status,lastUpdated:new Date().toISOString(),updatedBy:currentUser});
      await logActivity(`${currentUser} set ${room.title} → ${status}`,currentUser);
      if (status==='Escalate') await sendSlackAlert(`🔴 Room escalated: ${room.title} | Owner: ${room.owner||'N/A'}`);
      showMsg(`${room.title} → ${status}`);
    } catch(err) { console.error(err); showMsg('Could not update the room.',true); }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this room?')) return;
    try { await deleteDoc(docRef('shared_rooms',id)); showMsg('Room deleted.'); }
    catch(err) { console.error(err); showMsg('Delete failed.',true); }
  };

  const editRoom = (r) => { setEditingId(r.id); setForm({title:r.title||'',owner:r.owner||'',backupOwner:r.backupOwner||'',status:r.status||'Operational',devices:r.devices||'',notes:r.notes||''}); };

  const seed = async () => {
    const defaults = [
      {title:'Vision Room',owner:'Donald.Salazar',backupOwner:'Eric.Guzman',status:'Operational',devices:'Cyviz, Vu',notes:'Primary experience room'},
      {title:'Broadcast Cyviz',owner:'Donald.Salazar',backupOwner:'Eric.Guzman',status:'Operational',devices:'Cyviz, Vu, Broadcast',notes:'Broadcast-enabled'},
      {title:'65th Floor',owner:'Mistral.Rojas',backupOwner:'Eric.Guzman',status:'Operational',devices:'Cyviz, Audio, Video, Britelite',notes:'65th floor readiness'},
      {title:'CIC Space',owner:'Eric.Guzman',backupOwner:'Donald.Salazar',status:'Operational',devices:'Cyviz, Kiosk, Projection',notes:'CIC readiness'},
      {title:'Proto',owner:'Eric.Guzman',backupOwner:'Donald.Salazar',status:'Operational',devices:'Proto hologram',notes:'Proto sessions'},
      {title:'Hypervsn',owner:'Eric.Guzman',backupOwner:'Donald.Salazar',status:'Monitor',devices:'Hypervsn display',notes:'Monitor status'},
      {title:'Surface Hubs',owner:'Travis.Alexander',backupOwner:'Eric.Guzman',status:'Monitor',devices:'Surface Hub fleet',notes:'Remediation tracking'},
      {title:'Alleo',owner:'Mistral.Rojas',backupOwner:'Donald.Salazar',status:'Operational',devices:'Alleo',notes:'Support readiness'},
      {title:'Ceco Ceco',owner:'Mistral.Rojas',backupOwner:'Donald.Salazar',status:'Operational',devices:'Ceco Ceco',notes:'Support readiness'},
    ];
    try {
      for (const r of defaults) await addDoc(col('shared_rooms'),{...r,lastUpdated:new Date().toISOString(),updatedBy:'seed',timestamp:new Date().toISOString()});
      showMsg('Default rooms loaded.');
    } catch(err) { console.error(err); showMsg('Could not load defaults.',true); }
  };

  const sc = (s) => s==='Operational'?C.green:s==='Monitor'?C.amber:C.red;
  const stats = useMemo(()=>({total:rooms.length,ok:rooms.filter(r=>r.status==='Operational').length,mon:rooms.filter(r=>r.status==='Monitor').length,esc:rooms.filter(r=>r.status==='Escalate').length}),[rooms]);

  const ownerMap = useMemo(()=>{
    const m = {};
    rooms.forEach(r=>{
      const o = r.owner||'Unassigned';
      if(!m[o]) m[o]={owner:o,primary:[],backup:[],issues:0};
      m[o].primary.push(r.title);
      if(r.status==='Escalate') m[o].issues++;
      if(r.backupOwner){ if(!m[r.backupOwner]) m[r.backupOwner]={owner:r.backupOwner,primary:[],backup:[],issues:0}; m[r.backupOwner].backup.push(r.title); }
    });
    return Object.values(m);
  },[rooms]);

  return (
    <div style={{flex:1,overflow:'auto',padding:16,display:'flex',flexDirection:'column',gap:14}}>
      <StatRow stats={[{value:stats.total,label:'Rooms / devices'},{value:stats.ok,label:'Operational',color:C.green},{value:stats.mon,label:'Monitor',color:C.amber},{value:stats.esc,label:'Escalate',color:C.red}]}/>

      {/* Add / edit form */}
      <div style={{...card('pad')}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <p style={{fontSize:13,fontWeight:500,color:C.textPrimary}}>{editingId?'Edit room':'Add room or device'}</p>
          {!rooms.length&&<Btn variant="subtle" size="sm" onClick={seed}>Load defaults</Btn>}
        </div>
        <form onSubmit={save} style={{display:'flex',flexDirection:'column',gap:10}}>
          <div className="grid-rooms" style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:10}}>
            <div><Label>Name *</Label><Input value={form.title} onChange={e=>sf('title',e.target.value)} placeholder="Vision Room, Proto..." maxLength={200} required/></div>
            <div><Label>Primary owner</Label><Select value={form.owner} onChange={e=>sf('owner',e.target.value)}><option value="">Select...</option>{teamMembers.map(m=><option key={m} value={m}>{m}</option>)}</Select></div>
            <div><Label>Backup owner</Label><Select value={form.backupOwner} onChange={e=>sf('backupOwner',e.target.value)}><option value="">Select...</option>{teamMembers.map(m=><option key={m} value={m}>{m}</option>)}</Select></div>
          </div>
          <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:10}}>
            <div><Label>Status</Label><Select value={form.status} onChange={e=>sf('status',e.target.value)}><option value="Operational">Operational</option><option value="Monitor">Monitor</option><option value="Escalate">Escalate</option></Select></div>
            <div><Label>Devices / systems</Label><Input value={form.devices} onChange={e=>sf('devices',e.target.value)} placeholder="Cyviz, Vu, Broadcast..." maxLength={700}/></div>
          </div>
          <Input value={form.notes} onChange={e=>sf('notes',e.target.value)} placeholder="Notes..." rows={2} maxLength={LONG_TEXT_LIMIT}/>
          <div style={{display:'flex',gap:8}}>
            <Btn type="submit" variant="primary" size="sm">{editingId?'Update room':'Add room'}</Btn>
            {editingId&&<Btn variant="ghost" size="sm" onClick={reset}>Cancel</Btn>}
          </div>
        </form>
      </div>

      {/* Room grid */}
      <div>
        <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:10}}>Live status</p>
        {!rooms.length&&<EmptyState icon="📍" title="No rooms yet" subtitle="Add rooms above or load the default matrix."/>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:10}}>
          {rooms.map(r=>(
            <div key={r.id} style={{...card(),borderLeft:`3px solid ${sc(r.status)}`,borderRadius:'0 10px 10px 0',overflow:'hidden',transition:'border-color 0.15s'}}
              onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 0 0 1px ${C.borderHover}`}
              onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
              <div style={{padding:'10px 12px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                  <p style={{fontSize:13,fontWeight:500,color:C.textPrimary}}>{r.title}</p>
                  <div style={{display:'flex',gap:4,opacity:0.6}} onMouseEnter={e=>e.currentTarget.style.opacity='1'} onMouseLeave={e=>e.currentTarget.style.opacity='0.6'}>
                    <button type="button" onClick={()=>editRoom(r)} aria-label="Edit room" style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:C.accent}}>✏</button>
                    <button type="button" onClick={()=>del(r.id)} aria-label="Delete room" style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:C.textMuted}} onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}>✕</button>
                  </div>
                </div>
                <p style={{fontSize:11,color:C.textMuted,marginBottom:2}}>Owner: <span style={{color:C.textSecondary}}>{r.owner||'Unassigned'}</span></p>
                <p style={{fontSize:11,color:C.textMuted,marginBottom:6}}>Backup: <span style={{color:C.textSecondary}}>{r.backupOwner||'None'}</span></p>
                {r.devices&&<p style={{fontSize:11,color:C.accent,marginBottom:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.devices}</p>}
                {r.notes&&<p style={{fontSize:11,color:C.textMuted,marginBottom:8,lineHeight:1.4,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{r.notes}</p>}
                <div style={{display:'flex',gap:5}}>
                  {['Operational','Monitor','Escalate'].map(s=>(
                    <button type="button" key={s} onClick={()=>setStatus(r,s)}
                      style={{flex:1,fontSize:10,fontWeight:500,padding:'4px 0',borderRadius:6,cursor:'pointer',border:'none',
                        background:r.status===s?sc(s):'rgba(255,255,255,0.04)',
                        color:r.status===s?'#fff':C.textMuted,transition:'all 0.15s'}}>
                      {s==='Operational'?'OK':s}
                    </button>
                  ))}
                </div>
                {r.lastUpdated&&<p style={{fontSize:10,color:C.textMuted,marginTop:5}}>Updated: {new Date(r.lastUpdated).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ownership matrix */}
      {ownerMap.length>0&&(
        <div>
          <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:10}}>Ownership matrix</p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:10}}>
            {ownerMap.map(row=>(
              <div key={row.owner} style={{...card('pad')}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                  <Avatar name={row.owner} size={28}/>
                  <div>
                    <p style={{fontSize:12,fontWeight:500,color:C.textPrimary}}>{row.owner}</p>
                    <p style={{fontSize:10,color:C.textMuted}}>Primary: {row.primary.length} · Backup: {row.backup.length}</p>
                  </div>
                </div>
                {row.primary.length>0&&(
                  <div style={{marginBottom:6}}>
                    <Label style={{marginBottom:4}}>Primary</Label>
                    <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                      {row.primary.map((p,i)=><span key={p+i} style={{fontSize:10,background:'rgba(124,111,247,0.1)',color:C.accent,padding:'2px 7px',borderRadius:4}}>{p}</span>)}
                    </div>
                  </div>
                )}
                {row.backup.length>0&&(
                  <div>
                    <Label style={{marginBottom:4}}>Backup</Label>
                    <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                      {row.backup.map((p,i)=><span key={p+i} style={{fontSize:10,background:'rgba(255,255,255,0.04)',color:C.textMuted,border:`1px solid ${C.border}`,padding:'2px 7px',borderRadius:4}}>{p}</span>)}
                    </div>
                  </div>
                )}
                {row.issues>0&&<Badge color="red" size="xs" style={{marginTop:8}}>{row.issues} escalated</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── EXPORT PAGE ──
function ExportPage({ events, tasks, issues, showMsg, fetchGemini, setModal, currentUser }) {
  const [month, setMonth] = useState(getTodayStr().slice(0,7)); // local time, not UTC
  const [exporting, setExporting] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const filtered = events.filter(e=>(e.startDate||'').slice(0,7)===month);
  const done = tasks.filter(t=>normStatus(t)==='complete'&&((t.dueDate||t.timestamp||'').slice(0,7)===month));
  const logs = useMemo(()=>monthLogs(events,tasks,month),[events,tasks,month]);
  const totalH = sumHours(logs); // only hours dated in the selected month

  const doExport = async () => {
    setExporting(true);
    try {
      const ok = await exportToExcel(events,tasks,month);
      if (ok) showMsg(`Exported ${month} to Excel.`);
      else showMsg(`Nothing to export for ${month}. Pick a month with events, completed tasks, or logged hours.`,true);
    } catch(err) { showMsg(`Export failed: ${err.message}`,true); }
    setExporting(false);
  };

  const aiReport = async () => {
    setAiLoading(true);
    const evtLines = filtered.map(e=>`- ${e.eventName} (${(e.startDate||'').slice(0,10)}, ${e.classification||'?'}, ${e.attendees||'?'} attendees, ${sumHours(e.timeLogs).toFixed(1)}h)`).join('\n');
    const taskLines = done.map(t=>`- ${t.title} | ${t.assignee||'?'} | ${sumHours(t.timeLogs)||t.timeSpent||'?'}h`).join('\n');
    const issueLines = issues.filter(i=>i.status==='Resolved'&&(i.resolvedAt||'').slice(0,7)===month).map(i=>`- ${i.title} (${i.device||'?'}) — ${i.resolutionNotes||'see notes'}`).join('\n');
    const result = await fetchGemini(
      `Write a professional monthly summary report for the Accenture NYIH SELECT technology team to send to leadership. Sections: Executive Summary (2-3 sentences), Events Supported, Tasks Completed, Issues Resolved, Hours Logged, Key Wins. Concise but data-rich. Month: ${month}. Author: ${currentUser}.`,
      `Events:\n${evtLines||'None'}\n\nTasks completed:\n${taskLines||'None'}\n\nIssues resolved:\n${issueLines||'None'}\n\nTotal hours logged this month: ${totalH.toFixed(1)}h`
    );
    setAiLoading(false);
    if (!result||(typeof result==='string'&&result.startsWith('AI Error:'))){showMsg(result||'AI error.',true);return;}
    setModal({title:`Monthly report — ${month}`,content:result,actionLabel:'Copy',action:()=>{navigator.clipboard.writeText(result);showMsg('Report copied.');}});
  };

  return (
    <div style={{flex:1,overflow:'auto',padding:16,display:'flex',flexDirection:'column',gap:14}}>
      <StatRow stats={[{value:filtered.length,label:`${month} events`},{value:done.length,label:'Tasks completed',color:C.green},{value:`${totalH.toFixed(1)}h`,label:'Hours logged',color:C.amber}]}/>

      {/* Month picker + Excel export */}
      <div style={{...card('pad')}}>
        <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:12}}>Excel export</p>
        <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap',marginBottom:14}}>
          <div>
            <Label>Month</Label>
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
              style={{background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:8,color:C.textPrimary,fontSize:13,padding:'8px 12px',fontFamily:'inherit'}}/>
          </div>
          <Btn variant="success" size="md" onClick={doExport} disabled={exporting}>
            {exporting?<><Spinner size={13}/>Exporting...</>:'⬇ Download .xlsx'}
          </Btn>
        </div>
        <div style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 14px',display:'flex',flexDirection:'column',gap:5}}>
          <p style={{fontSize:11,fontWeight:500,color:C.textSecondary,marginBottom:3}}>Export includes 3 sheets:</p>
          {[['Events','All fields — name, dates, room, equipment, classification, attendees, SELECT lead, status, notes, hours'],['Completed Tasks','Title, assignee, linked event, time spent'],['Time Logs','Every time entry for the month — events and tasks — by date, team member, and hours']].map(([t,d])=>(
            <div key={t} style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <span style={{fontSize:12,fontWeight:500,color:C.accent,minWidth:110}}>{t}</span>
              <span style={{fontSize:11,color:C.textMuted,flex:1,minWidth:180}}>{d}</span>
            </div>
          ))}
        </div>
      </div>

      {/* AI report */}
      <div style={{...card('pad')}}>
        <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:4}}>AI monthly report</p>
        <p style={{fontSize:12,color:C.textMuted,marginBottom:12,lineHeight:1.5}}>Generate a formatted summary of the selected month — events, tasks, issues, hours — ready to paste and send to your lead.</p>
        <Btn variant="subtle" size="md" onClick={aiReport} disabled={aiLoading}>
          {aiLoading?<><Spinner size={13}/>Generating...</>:'⚡ Generate report'}
        </Btn>
      </div>

      {/* Preview of what's in the export */}
      {filtered.length>0&&(
        <div style={{...card(),overflow:'hidden'}}>
          <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.border}`}}>
            <p style={{fontSize:12,fontWeight:500,color:C.textSecondary}}>{month} — {filtered.length} event{filtered.length!==1?'s':''} in this export</p>
          </div>
          <div style={{padding:10,display:'flex',flexDirection:'column',gap:4}}>
            {filtered.slice(0,8).map(e=>(
              <div key={e.id} style={{display:'flex',gap:10,padding:'5px 8px',borderRadius:6,alignItems:'center'}}>
                <span style={{fontSize:11,color:C.textSecondary,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.eventName}</span>
                <span style={{fontSize:10,color:C.textMuted,flexShrink:0}}>{(e.startDate||'').slice(0,10)}</span>
                <Badge color={e.classification==='Client'?'green':e.classification==='Leadership'?'amber':'default'} size="xs">{e.classification||'TBD'}</Badge>
                <span style={{fontSize:10,color:C.green,flexShrink:0}}>{sumHours(e.timeLogs).toFixed(1)}h</span>
              </div>
            ))}
            {filtered.length>8&&<p style={{fontSize:11,color:C.textMuted,padding:'4px 8px'}}>+{filtered.length-8} more events in export</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── INSIGHTS PAGE ──
function BarChart({ data, colorFn }) {
  const sorted = Object.entries(data).sort((a,b)=>b[1]-a[1]);
  const max = Math.max(...Object.values(data),1);
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {!sorted.length&&<p style={{fontSize:12,color:C.textMuted,textAlign:'center',padding:'12px 0'}}>No data yet.</p>}
      {sorted.map(([k,v])=>(
        <div key={k}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
            <span style={{fontSize:12,color:C.textSecondary}}>{k}</span>
            <span style={{fontSize:12,fontWeight:500,color:colorFn?colorFn(k):C.textPrimary}}>{v}</span>
          </div>
          <div style={{height:4,background:'rgba(255,255,255,0.04)',borderRadius:4,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${(v/max)*100}%`,background:colorFn?colorFn(k):C.accent,borderRadius:4,transition:'width 0.5s'}}/>
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightsPage({ events, tasks, issues }) {
  const stats = useMemo(()=>{
    const byClass={},bySession={},byRoom={};
    events.forEach(e=>{
      const c=e.classification||'TBD',t=e.sessionType||'Other',r=e.eventLocation||'Unknown';
      byClass[c]=(byClass[c]||0)+1;bySession[t]=(bySession[t]||0)+1;byRoom[r]=(byRoom[r]||0)+1;
    });
    const byTask={todo:tasks.filter(t=>normStatus(t)==='todo').length,doing:tasks.filter(t=>normStatus(t)==='doing').length,complete:tasks.filter(t=>normStatus(t)==='complete').length};
    const knownEq=['Proto','Cyviz','Surface Hub','Vu AI','Spot','Hypervsn','Signage','MTR / VC','Audio','Loaner Laptop'];
    const eqIssues={};
    knownEq.forEach(eq=>{const n=issues.filter(i=>(i.title+' '+(i.notes||'')+' '+(i.device||'')).toLowerCase().includes(eq.toLowerCase().split(' ')[0])).length;if(n>0)eqIssues[eq]=n;});
    const totalH=events.reduce((s,e)=>s+sumHours(e.timeLogs),0)+tasks.reduce((s,t)=>s+sumHours(t.timeLogs),0);
    return{byClass,bySession,byRoom,byTask,eqIssues,totalH,highRisk:events.filter(e=>e.riskLevel==='High').length,totalAttendees:events.reduce((s,e)=>s+getAttendeeCount(e.attendees),0)};
  },[events,tasks,issues]);

  const clsColor = (c) => c==='Leadership'?C.amber:c==='Client'?C.green:c==='Confidential'?C.red:C.accent;

  return (
    <div style={{flex:1,overflow:'auto',padding:16,display:'flex',flexDirection:'column',gap:14}}>
      <StatRow stats={[
        {value:events.length,label:'Total events'},
        {value:stats.totalAttendees.toLocaleString(),label:'Total attendees'},
        {value:`${stats.totalH.toFixed(0)}h`,label:'Hours logged',color:C.amber},
        {value:stats.highRisk,label:'High risk events',color:C.red},
      ]}/>

      <div className="grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <div style={{...card('pad')}}>
          <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:12}}>By classification</p>
          <BarChart data={stats.byClass} colorFn={clsColor}/>
        </div>
        <div style={{...card('pad')}}>
          <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:12}}>By session type</p>
          <BarChart data={stats.bySession}/>
        </div>
        <div style={{...card('pad')}}>
          <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:12}}>Top rooms</p>
          <BarChart data={Object.fromEntries(Object.entries(stats.byRoom).sort((a,b)=>b[1]-a[1]).slice(0,6))} colorFn={()=>C.green}/>
        </div>
        <div style={{...card('pad')}}>
          <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:12}}>Task pipeline</p>
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            {[['To do',stats.byTask.todo,C.textMuted],['Doing',stats.byTask.doing,C.amber],['Done',stats.byTask.complete,C.green]].map(([l,v,c])=>(
              <div key={l} style={{flex:1,background:'rgba(255,255,255,0.02)',border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 0',textAlign:'center'}}>
                <div style={{fontSize:22,fontWeight:600,color:c}}>{v}</div>
                <div style={{fontSize:10,color:C.textMuted,marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
          {tasks.length>0&&<div style={{height:3,background:'rgba(255,255,255,0.04)',borderRadius:4,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.round((stats.byTask.complete/tasks.length)*100)}%`,background:C.green,borderRadius:4}}/></div>}
          <p style={{fontSize:11,color:C.textMuted,marginTop:5,textAlign:'center'}}>{tasks.length?`${Math.round((stats.byTask.complete/tasks.length)*100)}% complete`:'No tasks yet'}</p>
        </div>
      </div>

      {/* Equipment failures */}
      {Object.keys(stats.eqIssues).length>0&&(
        <div style={{...card('pad')}}>
          <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:4}}>Equipment failure frequency</p>
          <p style={{fontSize:11,color:C.textMuted,marginBottom:12}}>Issues cross-referenced with known equipment — identify chronic hardware problems.</p>
          <BarChart data={stats.eqIssues} colorFn={(k)=>{const v=stats.eqIssues[k];return v>=3?C.red:v>=2?C.amber:C.textMuted;}}/>
        </div>
      )}
    </div>
  );
}

// ── SETTINGS PAGE ──
function SettingsPage({ teamMembers, showMsg, currentUser }) {
  const [members, setMembers] = useState([...teamMembers]);
  const [newMember, setNewMember] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(()=>setMembers([...teamMembers]),[teamMembers]);

  const save = async () => {
    const cleaned = members.map(m=>m.trim()).filter(Boolean);
    if (!cleaned.length){showMsg('Need at least one team member.',true);return;}
    setSaving(true);
    try {
      await setDoc(docRef('shared_settings','team'),{
        members: cleaned,
        updatedBy: currentUser,
        updatedAt: new Date().toISOString(),
      });
      showMsg('Team updated — changes apply everywhere immediately.');
    } catch(err) { console.error(err); showMsg('Could not save the team.',true); }
    setSaving(false);
  };

  const add = () => {
    const v = newMember.trim();
    if (!v) return;
    if (members.some(m=>m.toLowerCase()===v.toLowerCase())){showMsg('Already in the list.',true);return;}
    setMembers(p=>[...p,v]);
    setNewMember('');
  };

  const remove = (m) => setMembers(p=>p.filter(x=>x!==m));

  const inputStyle = {
    background:'#0D0D17',border:`1px solid ${C.border}`,borderRadius:8,
    color:C.textPrimary,fontSize:13,padding:'9px 12px',
    fontFamily:'inherit',width:'100%',
  };

  return (
    <div style={{flex:1,overflow:'auto',padding:16,display:'flex',flexDirection:'column',gap:16,maxWidth:560}}>
      <div style={{...card('pad')}}>
        <p style={{fontSize:14,fontWeight:600,color:C.textPrimary,marginBottom:4}}>Team members</p>
        <p style={{fontSize:12,color:C.textMuted,marginBottom:14,lineHeight:1.5}}>
          Everyone listed here appears in the assignee dropdowns across the whole app — events, tasks, and rooms. Click Save team to apply changes for everyone.
        </p>

        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:14}}>
          {members.map(m=>(
            <div key={m} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',
              background:'rgba(255,255,255,0.02)',border:`1px solid ${C.border}`,borderRadius:8}}>
              <Avatar name={m} size={24}/>
              <span style={{flex:1,fontSize:13,color:C.textPrimary}}>{m}</span>
              <button type="button" onClick={()=>remove(m)}
                style={{background:'none',border:'none',cursor:'pointer',fontSize:12,
                  color:C.textMuted,padding:'2px 6px',borderRadius:4}}
                onMouseEnter={e=>{e.currentTarget.style.color=C.red;e.currentTarget.style.background=C.redBg;}}
                onMouseLeave={e=>{e.currentTarget.style.color=C.textMuted;e.currentTarget.style.background='none';}}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <Label>Add team member</Label>
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          <input
            value={newMember}
            onChange={e=>setNewMember(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&add()}
            placeholder="Firstname.Lastname (e.g. Wilson.Ferreira)"
            style={inputStyle}
          />
          <Btn variant="subtle" size="sm" onClick={add} style={{whiteSpace:'nowrap'}}>+ Add</Btn>
        </div>

        <Btn variant="primary" size="md" onClick={save} disabled={saving}>
          {saving?<><Spinner size={13}/>Saving...</>:'Save team'}
        </Btn>
      </div>

      <div style={{...card('pad')}}>
        <p style={{fontSize:13,fontWeight:500,color:C.textPrimary,marginBottom:4}}>Name format</p>
        <p style={{fontSize:12,color:C.textMuted,lineHeight:1.6}}>
          Use <span style={{color:C.accent,fontFamily:'monospace'}}>Firstname.Lastname</span> format, matching the first part of each person's email. That way initials display correctly and hours logged by someone are credited to their roster name. For example: <span style={{color:C.accent,fontFamily:'monospace'}}>Wilson.Ferreira</span> for wilson.ferreira@{ALLOWED_EMAIL_DOMAIN||'company.com'}.
        </p>
      </div>
    </div>
  );
}

// ── ROOT APP ──
export default function App() {
  const [user, setUser] = useState(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('today');
  const [msg, setMsg] = useState({text:'',isError:false});
  const [modal, setModal] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [issues, setIssues] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [handoffFeed, setHandoffFeed] = useState([]);
  const [teamMembers, setTeamMembers] = useState(DEFAULT_TEAM);
  const [dataError, setDataError] = useState('');
  const [today, setToday] = useState(getTodayStr());
  const toastTimer = useRef(null);

  // Roll the date over at midnight for anyone who leaves the app open.
  useEffect(()=>{ const t=setInterval(()=>setToday(getTodayStr()),60000); return ()=>clearInterval(t); },[]);

  useEffect(()=>{
    if (!firebaseConfig.apiKey){setLoading(false);return;}
    (async()=>{ try{ if(typeof __initial_auth_token!=='undefined'&&__initial_auth_token) await signInWithCustomToken(auth,__initial_auth_token); }catch(err){console.error(err);} })();
    return onAuthStateChanged(auth,u=>{ setUser(u); setVerified(!!u?.emailVerified); setLoading(false); });
  },[]);

  // Accounts with an email must be on the allowed domain and verified before loading data.
  const gate = !user || !user.email ? null
    : !emailDomainAllowed(user.email) ? 'domain'
    : !verified ? 'verify'
    : null;
  const ready = !!user && !gate;

  useEffect(()=>{
    if (!ready||!firebaseConfig.apiKey) return;
    setDataError('');
    const onErr = (err) => { console.error('[Firestore]',err); setDataError(err?.code==='permission-denied'?'permission':'other'); };
    const listen = (c,setter) => onSnapshot(
      query(col(c),orderBy('timestamp','desc')),
      s=>setter(s.docs.map(d=>({id:d.id,...d.data()}))),
      onErr
    );
    const unsubs = [
      listen('shared_events',setEvents),
      listen('shared_tasks',setTasks),
      listen('shared_issues',setIssues),
      listen('shared_rooms',setRooms),
      onSnapshot(docRef('shared_settings','team'), s=>{
        const m = s.exists() ? s.data().members : null;
        setTeamMembers(Array.isArray(m)&&m.length ? m : DEFAULT_TEAM);
      }, onErr),
    ];
    return ()=>unsubs.forEach(u=>u());
  },[ready]);

  // Only today's handoff notes are fetched. Sorted here so no composite index is needed.
  useEffect(()=>{
    if (!ready||!firebaseConfig.apiKey) return;
    return onSnapshot(
      query(col('shared_handoff'),where('date','==',today)),
      s=>setHandoffFeed(s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.timestamp||'').localeCompare(String(b.timestamp||'')))),
      err=>console.error('[Firestore handoff]',err)
    );
  },[ready,today]);

  const showMsg = useCallback((text,isError=false)=>{
    setMsg({text,isError});
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(()=>setMsg({text:'',isError:false}),4500);
  },[]);

  // opts.json → ask Gemini for strict JSON output (used by BEO import).
  const fetchGemini = useCallback(async (sys,usr='',opts={}) => {
    if (!GEMINI_API_KEY) return 'AI Error: Missing REACT_APP_GEMINI_API_KEY.';
    try {
      const prompt = usr ? `${sys}\n\n---\n${sanitizeForPrompt(usr)}\n---` : sys;
      const generationConfig = {temperature:0.15,maxOutputTokens:opts.json?8192:4096,topP:0.95,topK:40};
      if (opts.json) generationConfig.responseMimeType = 'application/json';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig}),
      });
      if (!r.ok){const t=await r.text();throw new Error(`Gemini ${r.status}: ${t.slice(0,200)}`);}
      const d = await r.json();
      if (d.error) throw new Error(d.error.message);
      const parts = d.candidates?.[0]?.content?.parts||[];
      return parts.filter(p=>!p.thought).map(p=>p.text||'').join('');
    } catch(e){ console.error('[Gemini]',e); return `AI Error: ${e.message}`; }
  },[]);

  const currentUser = resolveTeamName(user?.email, teamMembers);
  const myIds = useMemo(()=>[currentUser, user?.email].filter(Boolean),[currentUser,user]);

  const generateBrief = async () => {
    setBriefLoading(true);
    const todayStr = getTodayStr();
    const isUpcoming = (e) => (e.startDate||'') >= todayStr; // today onward, not the oldest events on record
    const upcoming = events.filter(isUpcoming).sort((a,b)=>a.startDate.localeCompare(b.startDate)).slice(0,5);
    const highRisk = events.filter(e=>e.riskLevel==='High'&&isUpcoming(e));
    const monthHours = sumHours(monthLogs(events,tasks,todayStr.slice(0,7)));
    const result = await fetchGemini(
      'As the Accenture SELECT team lead, write exactly THREE concise bullet points for a leadership status update: (1) upcoming events & readiness, (2) risks or blockers, (3) task & team status. Specific, data-driven.',
      `Today: ${todayStr}\nUpcoming events: ${upcoming.map(e=>`${e.eventName} (${(e.startDate||'').slice(0,10)}, ${e.classification})`).join('; ')||'None'}\nUpcoming high-risk: ${highRisk.map(e=>e.eventName).join(', ')||'None'}\nOpen issues: ${issues.filter(i=>i.status==='Open').length}\nTasks in progress: ${tasks.filter(t=>normStatus(t)==='doing').length} of ${tasks.length}\nHours logged this month: ${monthHours.toFixed(1)}h`
    );
    setBriefLoading(false);
    if (!result||result.startsWith('AI Error:')) { showMsg(result||'AI error.',true); return; }
    setModal({title:'Leadership brief',content:result,actionLabel:'Copy',action:()=>{navigator.clipboard.writeText(result);showMsg('Copied.');}});
  };

  const pageTitle = {today:'Today',events:'Events',tasks:'Tasks',issues:'Tech issues',rooms:'Rooms',export:'Export',insights:'Insights',settings:'Settings'};
  const pageSub = {
    today: today,
    events: `${events.length} event${events.length!==1?'s':''}`,
    tasks: `${tasks.length} task${tasks.length!==1?'s':''}`,
    issues: `${issues.filter(i=>i.status==='Open').length} open`,
    rooms: `${rooms.length} configured`,
    export: 'Excel + AI report',
    insights: 'Analytics',
    settings: 'Manage team & preferences',
  };

  // Global styles and the toast render on every screen, including sign-in.
  const shell = (content) => (<><style>{STYLES}</style>{content}<Toast msg={msg}/></>);

  if (loading) return shell(
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:C.bg,gap:12}}>
      <div style={{width:32,height:32,border:`2px solid ${C.border}`,borderTopColor:C.accent,borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
      <p style={{fontSize:11,color:C.textMuted,letterSpacing:'0.1em',textTransform:'uppercase'}}>Loading…</p>
    </div>
  );
  if (!firebaseConfig.apiKey) return shell(
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,padding:16}}>
      <div style={{...card('pad'),maxWidth:380,textAlign:'center'}}>
        <p style={{fontSize:28,marginBottom:12}}>⚠</p>
        <p style={{fontSize:15,fontWeight:500,color:C.textPrimary,marginBottom:8}}>Connection error</p>
        <p style={{fontSize:13,color:C.textMuted,marginBottom:16}}>Firebase is not configured. Check your environment variables.</p>
        <Btn variant="primary" size="md" onClick={()=>window.location.reload()}>Retry</Btn>
      </div>
    </div>
  );
  if (!user) return shell(<AuthPage showMsg={showMsg}/>);
  if (gate) return shell(<AccountGate user={user} reason={gate} showMsg={showMsg} onVerified={()=>setVerified(true)}/>);

  return shell(
    <>
      <div className="app-shell" style={{display:'flex',height:'100vh',overflow:'hidden',background:C.bg}}>
        <Sidebar page={page} setPage={setPage}/>
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>
          <TopBar
            title={pageTitle[page]}
            subtitle={pageSub[page]}
            currentUser={currentUser}
            actions={
              <div style={{display:'flex',gap:6}}>
                <Btn variant="subtle" size="sm" onClick={generateBrief} disabled={briefLoading}>
                  {briefLoading?<><Spinner size={11}/>Working...</>:'⚡ Lead brief'}
                </Btn>
              </div>
            }
          />
          {dataError && (
            <div role="alert" style={{padding:'8px 16px',background:C.redBg,borderBottom:`1px solid ${C.border}`,fontSize:12,color:C.red,lineHeight:1.5}}>
              {dataError==='permission'
                ? `Can't load team data: access denied. Sign in with a verified${ALLOWED_EMAIL_DOMAIN?` @${ALLOWED_EMAIL_DOMAIN}`:''} account, or ask the app owner to check the Firestore rules.`
                : 'Having trouble loading data. Check your connection, then refresh.'}
            </div>
          )}
          <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
            {page==='today'&&<TodayPage events={events} handoffFeed={handoffFeed} rooms={rooms} showMsg={showMsg} currentUser={currentUser} myIds={myIds} fetchGemini={fetchGemini} setModal={setModal}/>}
            {page==='events'&&<EventsPage events={events} showMsg={showMsg} fetchGemini={fetchGemini} currentUser={currentUser} teamMembers={teamMembers}/>}
            {page==='tasks'&&<TasksPage tasks={tasks} showMsg={showMsg} currentUser={currentUser} teamMembers={teamMembers}/>}
            {page==='issues'&&<IssuesPage issues={issues} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} currentUser={currentUser}/>}
            {page==='rooms'&&<RoomsPage rooms={rooms} showMsg={showMsg} currentUser={currentUser} teamMembers={teamMembers}/>}
            {page==='export'&&<ExportPage events={events} tasks={tasks} issues={issues} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} currentUser={currentUser}/>}
            {page==='insights'&&<InsightsPage events={events} tasks={tasks} issues={issues}/>}
            {page==='settings'&&<SettingsPage teamMembers={teamMembers} showMsg={showMsg} currentUser={currentUser}/>}
          </div>
        </div>
      </div>

      {/* AI result modal */}
      {modal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:16}}
          onClick={()=>setModal(null)}>
          <div style={{...card('pad'),maxWidth:580,width:'100%',display:'flex',flexDirection:'column',gap:14}} onClick={e=>e.stopPropagation()}>
            <p style={{fontSize:15,fontWeight:600,color:C.textPrimary}}>{modal.title}</p>
            <div style={{background:'#0A0A0F',border:`1px solid ${C.border}`,borderRadius:8,padding:'12px 14px',
              fontSize:13,color:C.textSecondary,whiteSpace:'pre-wrap',maxHeight:'55vh',overflow:'auto',
              lineHeight:1.6,fontFamily:'monospace'}}>
              {modal.content}
            </div>
            <div style={{display:'flex',gap:8}}>
              {modal.action&&<Btn variant="primary" size="md" onClick={modal.action} style={{flex:1,justifyContent:'center'}}>{modal.actionLabel||'Copy'}</Btn>}
              <Btn variant="ghost" size="md" onClick={()=>setModal(null)} style={{flex:1,justifyContent:'center'}}>Close</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
