import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, signInWithCustomToken,
} from 'firebase/auth';
import {
  getFirestore, collection, addDoc, onSnapshot, query,
  deleteDoc, doc, updateDoc, orderBy, setDoc, getDoc,
} from 'firebase/firestore';
import {
  Layout, AlertCircle, Trash2, CheckCircle2, ChevronLeft, ChevronRight,
  Zap, LogOut, User, Edit3, FileText, BarChart3, PieChart as PieIcon,
  Calendar, Clock, TrendingUp, Share2, BrainCircuit, MapPin, Upload,
  Search, RefreshCcw, ClipboardList, Users, CalendarDays, Copy,
  Activity, SunMedium, ChevronDown, ChevronUp, PlayCircle, Download,
  Plus, CheckSquare, PenLine, Timer,
} from 'lucide-react';

// ── Gemini model intentionally left as-is until API proxy is set up ──
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY;
const SLACK_WEBHOOK_URL = process.env.REACT_APP_SLACK_WEBHOOK_URL;

// ── PDF loader ──
const loadPdfJs = (() => {
  let promise = null;
  return () => {
    if (promise) return promise;
    promise = new Promise((resolve, reject) => {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error('Failed to load PDF.js'));
      document.head.appendChild(s);
    });
    return promise;
  };
})();

const extractTextFromPdf = async (file) => {
  const pdfjsLib = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join('\n');
};

// ── Excel export (SheetJS via CDN) ──
const loadSheetJs = (() => {
  let promise = null;
  return () => {
    if (promise) return promise;
    promise = new Promise((resolve, reject) => {
      if (window.XLSX) { resolve(window.XLSX); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Failed to load SheetJS'));
      document.head.appendChild(s);
    });
    return promise;
  };
})();

const exportToExcel = async (events, tasks, issues, month) => {
  const XLSX = await loadSheetJs();

  // Filter by month if provided (format: "2026-06")
  const filterByMonth = (dateStr) => {
    if (!month) return true;
    return (dateStr || '').slice(0, 7) === month;
  };

  const filteredEvents = events.filter(e => filterByMonth(e.startDate));
  const filteredTasks = tasks.filter(t =>
    t.status === 'complete' || t.status === 'done' || t.status === 'completed'
  ).filter(t => filterByMonth(t.dueDate || t.timestamp));

  // Events sheet
  const eventsData = filteredEvents.map(e => ({
    'Event Name': e.eventName || '',
    'Start Date': e.startDate || '',
    'End Date': e.endDate || '',
    'Week Of': e.weekOf || '',
    'Classification': e.classification || '',
    'Session Type': e.sessionType || '',
    'Room': e.eventLocation || '',
    'Location': e.location || 'NYIH',
    'Attendees': e.attendees || '',
    'Equipment / Demo': e.demo || '',
    'SELECT Lead': e.selectPoc || '',
    'Event POC': e.eventPoc || '',
    'Support Team': e.supportTeam || '',
    'Risk Level': e.riskLevel || '',
    'Event Status': e.eventStatus || '',
    'Source': e.source || 'Manual',
    'Run of Show': e.runOfShow || '',
    'Notes': e.notes || '',
    'Post-Event Notes': e.postEventNotes || '',
    'Total Hours Logged': (e.timeLogs || []).reduce((s, l) => s + (parseFloat(l.hours) || 0), 0) || '',
  }));

  // Tasks sheet
  const tasksData = filteredTasks.map(t => {
    const totalHours = (t.timeLogs || []).reduce((s, l) => s + (parseFloat(l.hours) || 0), 0);
    return {
      'Task Title': t.title || '',
      'Assignee': t.assignee || '',
      'Status': t.status || '',
      'Due Date': t.dueDate || '',
      'Linked Event': t.linkedEvent || '',
      'Source': t.source || '',
      'Time Spent (hrs)': t.timeSpent || totalHours || '',
      'Details / Notes': (t.details || '').slice(0, 500),
    };
  });

  // Time logs sheet (all event time logs flattened)
  const timeLogsData = [];
  events.forEach(e => {
    (e.timeLogs || []).forEach(log => {
      if (!month || (log.date || '').slice(0, 7) === month) {
        timeLogsData.push({
          'Date': log.date || '',
          'Event': e.eventName || '',
          'Team Member': log.user || '',
          'Hours': log.hours || '',
          'Note': log.note || '',
          'Room': e.eventLocation || '',
          'Classification': e.classification || '',
        });
      }
    });
  });

  const wb = XLSX.utils.book_new();
  if (eventsData.length) {
    const ws1 = XLSX.utils.json_to_sheet(eventsData);
    ws1['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 25 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Events');
  }
  if (tasksData.length) {
    const ws2 = XLSX.utils.json_to_sheet(tasksData);
    ws2['!cols'] = [{ wch: 35 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 25 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Completed Tasks');
  }
  if (timeLogsData.length) {
    const ws3 = XLSX.utils.json_to_sheet(timeLogsData);
    ws3['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 16 }, { wch: 8 }, { wch: 30 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Time Logs');
  }

  const label = month || new Date().toISOString().slice(0, 7);
  XLSX.writeFile(wb, `SELECT_Hub_Export_${label}.xlsx`);
};

// ── Constants ──
const TEAM_MEMBERS = ["Eric.Guzman","Tommy.Flinch","Donald.Salazar","Mistral.Rojas"];
const ROOMS = ["Interchange","Vision","Tank","Training Room","Meadow","Common Grounds","Ginsberg","Globe","Office Tour"];
const DURATION_OPTIONS = ["0.5 Hours","1 Hour","2 Hours","4 Hours","6 Hours","8 Hours","Full Day (10h)","Multi-Day (24h)"];
const SUPPORT_TEAMS = ["NYIH SELECT","CIC","TXA Assist","Other"];
const CLASSIFICATIONS = ["Internal","Client","Leadership","Community","Confidential","Public / External","TBD"];
const SESSION_TYPES = ["Demo","Client","Leadership","Workshop","Meeting","Conference / Boardroom","Town Hall","Other","TBD"];
const EVENT_STATUSES = ["Not Started","In Progress","Wrapped"];

const QUICK_FILL_CARDS = [
  { name:'Proto', demo:'Proto hologram', sessionType:'Demo', note:'Hologram demo' },
  { name:'Vu AI', demo:'Vu AI', sessionType:'Demo', note:'AI video wall' },
  { name:'Spot', demo:'Spot', sessionType:'Demo', note:'Boston Dynamics' },
  { name:'Cyviz', demo:'Cyviz', sessionType:'Meeting', note:'Room / VC' },
  { name:'Surface Hub', demo:'Surface Hub', sessionType:'Meeting', note:'Whiteboard / VC' },
  { name:'Signage', demo:'Signage only', sessionType:'Leadership', note:'Lobby signage' },
];

const DK = 'bg-[#0D0D15] border border-[#2A2A3E] text-[#E8E8F0] rounded-xl p-3.5 text-sm outline-none focus:border-[#A100FF] transition placeholder-[#4A4A6A]';

const blankEventForm = () => ({
  eventName:'', startDate:'', endDate:'', eventPoc:'', selectPoc:'', location:'NYIH',
  eventLocation:'', classification:'Internal', sessionType:'Demo', attendees:'', demo:'',
  selectResources:'', sessionDays:'', sessionSupportDuration:'', supportTeam:'NYIH SELECT',
  weekOf:'', notes:'', runOfShow:'', source:'Manual', eventStatus:'Not Started',
  checklist:'', postEventNotes:'', timeLogs:[],
});

// ── Helpers ──
const sanitizeForPrompt = (text) => {
  if (typeof text !== 'string') return '';
  return text.slice(0,60000).replace(/[<>]/g,'').replace(/ignore (all )?instructions?/gi,'[redacted]').trim();
};
const safeParseJson = (text) => {
  try { const c=text?.replace(/```json|```/g,'').trim(); const p=JSON.parse(c); if(typeof p!=='object'||Array.isArray(p)||p===null) return {}; return p; } catch { return {}; }
};
const ALLOWED_EVENT_KEYS = [
  'eventName','startDate','endDate','eventPoc','selectPoc','location','eventLocation',
  'classification','sessionType','attendees','demo','selectResources','sessionDays',
  'sessionSupportDuration','supportTeam','weekOf','notes','runOfShow','source',
  'riskLevel','readinessScore','automationSummary','equipmentDetected','riskReasons',
  'eventStatus','checklist','postEventNotes',
];
const sanitizeEventData = (obj) => {
  const safe = {};
  for (const key of ALLOWED_EVENT_KEYS) {
    if (obj[key] !== undefined) {
      if (Array.isArray(obj[key])) safe[key] = obj[key].slice(0,20);
      else safe[key] = String(obj[key]).slice(0,700);
    }
  }
  return safe;
};
const weekOfFromDateTime = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const x = new Date(d); x.setDate(x.getDate()-x.getDay());
  return new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,10);
};
const classBadgeColor = (cls) => {
  if (cls==='Leadership') return '#F59E0B';
  if (cls==='Client') return '#22C55E';
  if (cls==='Confidential') return '#EF4444';
  return '#6B6B8A';
};
const normalizeText = (v) => String(v||'').toLowerCase();
const getAttendeeCount = (v) => { const n=parseInt(String(v||'').replace(/[^\d]/g,''),10); return Number.isNaN(n)?0:n; };
const getTodayStr = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

const detectEquipment = (event) => {
  const h=[event.demo,event.selectResources,event.notes,event.eventName,event.eventLocation,event.sessionType].join(' ').toLowerCase();
  const found=[];
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
  const room=normalizeText(event.eventLocation);
  const eq=normalizeText(`${event.demo} ${event.selectResources} ${event.notes}`);
  if(eq.includes('cyviz')||room.includes('vision')||room.includes('interchange')) return 'Donald.Salazar';
  if(eq.includes('proto')||eq.includes('hologram')||eq.includes('spot')||eq.includes('boston dynamics')) return 'Tommy.Flinch';
  if(eq.includes('signage')||eq.includes('tour')||eq.includes('makers lab')||eq.includes('liquid studios')) return 'Mistral.Rojas';
  if(eq.includes('broadcast')||eq.includes('vu ai')||eq.includes('alleo')||eq.includes('hypervsn')) return 'Donald.Salazar';
  if(room.includes('tank')||room.includes('fka theater')||room.includes('exco')) return 'Tommy.Flinch';
  if(room.includes('common grounds')&&(eq.includes('mic')||eq.includes('music'))) return 'Mistral.Rojas';
  return event.selectPoc||'Eric.Guzman';
};
const calculateRisk = (event) => {
  const attendees=getAttendeeCount(event.attendees);
  const equipment=detectEquipment(event);
  const room=normalizeText(event.eventLocation);
  const classification=event.classification||'';
  const issues=[];
  if(!event.selectPoc) issues.push('No SELECT lead assigned');
  if(!event.eventLocation) issues.push('No room/location listed');
  if(!event.startDate||!event.endDate) issues.push('Missing start/end time');
  if(attendees>=50&&!equipment.includes('Audio')) issues.push('Large event may need audio/mic validation');
  if(['Leadership','Client','Confidential'].includes(classification)) issues.push(`${classification} event requires tighter readiness`);
  if((room.includes('vision')||room.includes('interchange'))&&!equipment.includes('Cyviz')) issues.push('Room may require Cyviz validation');
  if(equipment.length>=3) issues.push('Multiple technology dependencies');
  let riskLevel='Low';
  if(issues.length>=3||attendees>=100||classification==='Confidential') riskLevel='High';
  else if(issues.length>=1||attendees>=50||['Leadership','Client'].includes(classification)) riskLevel='Medium';
  return { riskLevel, riskReasons:issues };
};
const getRiskColor = (risk) => risk==='High'?'#EF4444':risk==='Medium'?'#F59E0B':'#22C55E';

const buildDefaultChecklist = (event) => {
  const equipment=detectEquipment(event);
  const attendees=getAttendeeCount(event.attendees);
  const room=normalizeText(event.eventLocation);
  const lines=[];
  lines.push('☐ Review event details (time, room, POC, attendees, classification)');
  lines.push('☐ Confirm SELECT owner and backup coverage');
  lines.push('☐ Pre-check room (display, audio, camera, network, cables)');
  if(equipment.includes('Cyviz')||room.includes('vision')||room.includes('interchange')) lines.push('☐ Cyviz: test routing, screen layout, Teams/Cisco, content sharing');
  if(equipment.includes('Proto')) lines.push('☐ Proto: validate content, network, audio, placement, run-of-show');
  if(equipment.includes('Surface Hub')) lines.push('☐ Surface Hub: whiteboard, Teams join, camera, mic, sharing');
  if(equipment.includes('Vu AI')) lines.push('☐ Vu AI / video wall: content source, display behavior, fallback');
  if(equipment.includes('Spot')) lines.push('☐ Spot: battery, route, safety, demo script, operator readiness');
  if(equipment.includes('Signage')) lines.push('☐ Signage: welcome message, timing, naming, placement');
  if(equipment.includes('MTR / VC')) lines.push('☐ MTR/VC: meeting join, camera, mic, speakers, dialing, sharing');
  if(equipment.includes('Audio')||attendees>=50) lines.push('☐ Audio: mics, speakers, clickers, volume, presenter movement');
  if(equipment.includes('Loaner Laptop')) lines.push('☐ Loaner laptop: availability, charger, adapters, login, content');
  lines.push('☐ Day-of: confirm event start, presenter support, escalation path');
  lines.push('☐ Post-event: capture issues, lessons learned, follow-ups');
  return lines.join('\n');
};

const buildAutomationSummary = (event) => {
  const equipment=detectEquipment(event);
  const risk=calculateRisk(event);
  return { equipmentDetected:equipment, riskLevel:risk.riskLevel, riskReasons:risk.riskReasons, readinessScore:0, automationSummary:`${equipment.length||0} tech dependencies detected. Risk: ${risk.riskLevel}.` };
};
// ── Firebase setup ──
const appId = typeof __app_id!=='undefined'?__app_id:'accenture-hub-v1';
let firebaseConfig={};
if(typeof __firebase_config!=='undefined'&&__firebase_config){ firebaseConfig=JSON.parse(__firebase_config); }
else{ try{ firebaseConfig={ apiKey:process.env.REACT_APP_FIREBASE_API_KEY, authDomain:process.env.REACT_APP_FIREBASE_AUTH_DOMAIN, projectId:process.env.REACT_APP_FIREBASE_PROJECT_ID, storageBucket:process.env.REACT_APP_FIREBASE_STORAGE_BUCKET||`${process.env.REACT_APP_FIREBASE_PROJECT_ID}.appspot.com`, messagingSenderId:process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID, appId:process.env.REACT_APP_FIREBASE_APP_ID }; }catch(e){} }
const app=getApps().length===0?initializeApp(firebaseConfig):getApps()[0];
const auth=getAuth(app);
const db=getFirestore(app);
const col=(c)=>collection(db,'artifacts',appId,'public','data',c);

const logActivity=async(message,user='')=>{ try{ await addDoc(col('shared_activity'),{message,user:user||'',timestamp:new Date().toISOString()}); }catch(e){ console.warn('Activity log failed',e); } };
const sendSlackAlert=async(text)=>{ if(!SLACK_WEBHOOK_URL) return; try{ await fetch(SLACK_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); }catch(e){ console.warn('Slack alert failed',e); } };

const createTasksForEvent=async(eventId,event)=>{
  await addDoc(col('shared_tasks'),{
    title:`SELECT support: ${event.eventName}`,
    details:'',
    assignee:inferSelectOwner(event),
    dueDate:event.startDate?String(event.startDate).slice(0,10):'',
    timeSpent:'',timeLogs:[],status:'backlog',eventId,
    linkedEvent:event.eventName||'',source:'Auto-generated',
    timestamp:new Date().toISOString(),
  });
};

// ── Shared UI ──
function StatCard({icon,value,label}){
  return(
    <div className="rounded-xl p-4 bg-[#0D0D15] border border-[#2A2A3E] hover:border-[#A100FF] transition">
      <div className="text-[#A100FF]">{icon}</div>
      <div className="text-2xl font-black text-white mt-1.5">{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-widest text-[#6B6B8A] mt-1">{label}</div>
    </div>
  );
}
function NavBtn({a,o,l,i}){
  return(
    <button onClick={o} className={`px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition flex items-center gap-1.5 ${a?'bg-[#A100FF] text-white shadow-lg shadow-[#A100FF]/20':'bg-[#1A1A2E] text-[#6B6B8A] hover:bg-[#2A2A3E] hover:text-white'}`}>
      {i}{l}
    </button>
  );
}
function MemberPill({name,active,onClick}){
  const ini=String(name).split('.').map(p=>p[0]).join('').slice(0,2).toUpperCase();
  return(<button onClick={onClick} title={name} className={`w-8 h-8 rounded-lg text-[10px] font-black transition flex items-center justify-center ${active?'bg-[#A100FF] text-white':'bg-[#1A1A2E] text-[#6B6B8A] hover:bg-[#2A2A3E] hover:text-white'}`}>{ini}</button>);
}

// ── Checklist editor (shared between event card and expand) ──
function ChecklistEditor({value,onChange,readOnly}){
  const lines=(value||'').split('\n').filter(Boolean);
  const toggle=(i)=>{
    const updated=[...lines];
    if(updated[i].startsWith('☐')) updated[i]='☑'+updated[i].slice(1);
    else if(updated[i].startsWith('☑')) updated[i]='☐'+updated[i].slice(1);
    onChange(updated.join('\n'));
  };
  const addLine=()=>onChange((value?value+'\n':'')+'☐ ');
  const removeLine=(i)=>{ const u=[...lines]; u.splice(i,1); onChange(u.join('\n')); };
  const editLine=(i,text)=>{ const u=[...lines]; u[i]=u[i].slice(0,1)+' '+text; onChange(u.join('\n')); };

  const done=lines.filter(l=>l.startsWith('☑')).length;
  const total=lines.length;
  const pct=total?Math.round((done/total)*100):0;

  return(
    <div>
      {total>0&&(
        <div className="mb-3">
          <div className="flex justify-between text-[9px] font-bold mb-1">
            <span className="text-[#A100FF] uppercase tracking-wider">Progress</span>
            <span className={done===total?'text-[#22C55E]':'text-[#6B6B8A]'}>{done}/{total} — {pct}%</span>
          </div>
          <div className="h-1.5 bg-[#0D0D15] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{width:`${pct}%`,background:done===total?'#22C55E':'#A100FF'}}/>
          </div>
        </div>
      )}
      <div className="space-y-1">
        {lines.map((line,i)=>{
          const checked=line.startsWith('☑');
          const unchecked=line.startsWith('☐');
          const text=line.slice(2);
          return(
            <div key={i} className="flex items-center gap-2 group/cl">
              {(checked||unchecked)&&(
                <button onClick={()=>toggle(i)} className={`flex-shrink-0 text-sm ${checked?'text-[#22C55E]':'text-[#4A4A6A] hover:text-[#A100FF]'} transition`}>
                  {checked?'☑':'☐'}
                </button>
              )}
              {readOnly?(
                <span className={`text-xs flex-1 ${checked?'line-through text-[#4A4A6A]':'text-[#9B9BB0]'}`}>{text}</span>
              ):(
                <input value={text} onChange={e=>editLine(i,e.target.value)}
                  className={`flex-1 text-xs bg-transparent outline-none border-b border-transparent focus:border-[#2A2A3E] ${checked?'line-through text-[#4A4A6A]':'text-[#9B9BB0]'}`}/>
              )}
              {!readOnly&&(
                <button onClick={()=>removeLine(i)} className="opacity-0 group-hover/cl:opacity-100 text-[#2A2A3E] hover:text-red-400 transition"><Trash2 size={10}/></button>
              )}
            </div>
          );
        })}
      </div>
      {!readOnly&&(
        <button onClick={addLine} className="mt-2 flex items-center gap-1 text-[10px] text-[#A100FF] font-bold uppercase hover:text-[#B733FF] transition">
          <Plus size={10}/> Add item
        </button>
      )}
    </div>
  );
}

// ── Auth page ──
function AuthPage({showMsg}){
  const[isLogin,setIsLogin]=useState(true);
  const submit=async(e)=>{
    e.preventDefault();
    const{email,password}=Object.fromEntries(new FormData(e.target));
    try{
      if(isLogin) await signInWithEmailAndPassword(auth,email,password);
      else await createUserWithEmailAndPassword(auth,email,password);
    }catch(err){showMsg(err.message,true);}
  };
  return(
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F] p-4">
      <div className="w-full max-w-sm bg-[#111119] p-8 rounded-2xl border border-[#2A2A3E] text-center">
        <div className="w-14 h-14 bg-[#A100FF] rounded-xl flex items-center justify-center mx-auto mb-5"><Layout size={24} className="text-white"/></div>
        <h1 className="text-2xl font-black text-white mb-1"><span className="text-[#A100FF]">SELECT</span> Hub</h1>
        <p className="text-[10px] text-[#6B6B8A] font-bold uppercase tracking-[.2em] mb-6">Powered by Accenture</p>
        <form onSubmit={submit} className="space-y-3">
          <input name="email" type="email" placeholder="Email" required className={`w-full ${DK}`}/>
          <input name="password" type="password" placeholder="Password" required className={`w-full ${DK}`}/>
          <button type="submit" className={`w-full font-bold py-3 rounded-xl text-sm uppercase tracking-wider transition ${isLogin?'bg-[#A100FF] text-white hover:bg-[#B733FF]':'bg-[#A3E635] text-[#0A0A0F] hover:bg-[#8CD02F]'}`}>
            {isLogin?'Sign In':'Create Account'}
          </button>
        </form>
        <button onClick={()=>setIsLogin(!isLogin)} className="mt-5 text-[11px] text-[#6B6B8A] hover:text-[#A100FF] font-bold uppercase tracking-wider transition">
          {isLogin?'Create Account':'Back to Sign In'}
        </button>
      </div>
    </div>
  );
}
// ── Today Page ──
function TodayPage({events,handoffNotes,showMsg,currentUser,fetchGemini,setModal}){
  const todayStr=getTodayStr();
  const[handoff,setHandoff]=useState(handoffNotes?.notes||'');
  const[savingHandoff,setSavingHandoff]=useState(false);
  const[aiNotes,setAiNotes]=useState('');
  const[aiLoading,setAiLoading]=useState(false);
  const[logTarget,setLogTarget]=useState(null);
  const[logHours,setLogHours]=useState('');
  const[logNote,setLogNote]=useState('');

  useEffect(()=>setHandoff(handoffNotes?.notes||''),[handoffNotes]);

  const todayEvents=useMemo(()=>events.filter(e=>{
    const sd=(e.startDate||'').slice(0,10);
    const ed=(e.endDate||'').slice(0,10);
    return sd===todayStr||(sd<=todayStr&&ed>=todayStr);
  }).sort((a,b)=>(a.startDate||'').localeCompare(b.startDate||'')),[events,todayStr]);

  const now=new Date();
  const nowMins=now.getHours()*60+now.getMinutes();
  const getEventMins=(dt)=>{ if(!dt) return null; const d=new Date(dt); return Number.isNaN(d.getTime())?null:d.getHours()*60+d.getMinutes(); };
  const isCurrentEvent=(e)=>{ const sm=getEventMins(e.startDate); const em=getEventMins(e.endDate); if(sm===null||em===null) return false; return nowMins>=sm&&nowMins<=em; };
  const isPast=(e)=>{ const em=getEventMins(e.endDate); return em!==null&&nowMins>em; };
  const statusColor=(s)=>s==='In Progress'?'#A100FF':s==='Wrapped'?'#22C55E':'#6B6B8A';

  const updateEventStatus=async(eventId,eventStatus,eventName)=>{
    await updateDoc(doc(db,'artifacts',appId,'public','data','shared_events',eventId),{eventStatus});
    await logActivity(`${currentUser} marked "${eventName}" as ${eventStatus}`,currentUser);
    showMsg(`Marked ${eventStatus}.`);
  };

  const saveHandoff=async()=>{
    setSavingHandoff(true);
    await setDoc(doc(db,'artifacts',appId,'public','data','shared_handoff',todayStr),{
      notes:handoff,updatedBy:currentUser,updatedAt:new Date().toISOString(),date:todayStr,
    });
    await logActivity(`${currentUser} updated shift handoff notes`,currentUser);
    setSavingHandoff(false);showMsg('Handoff notes saved.');
  };

  const submitTimeLog=async()=>{
    if(!logTarget||!logHours) return;
    const hrs=parseFloat(logHours);
    if(isNaN(hrs)||hrs<=0){showMsg('Enter valid hours.',true);return;}
    const entry={user:currentUser,hours:hrs,note:logNote,date:todayStr,timestamp:new Date().toISOString()};
    const existing=logTarget.timeLogs||[];
    await updateDoc(doc(db,'artifacts',appId,'public','data','shared_events',logTarget.id),{timeLogs:[...existing,entry]});
    await logActivity(`${currentUser} logged ${hrs}h on "${logTarget.eventName}"`,currentUser);
    setLogTarget(null);setLogHours('');setLogNote('');showMsg(`Logged ${hrs}h on ${logTarget.eventName}.`);
  };

  const aiDocumentDay=async()=>{
    if(!aiNotes.trim()){showMsg('Describe what you did first.',true);return;}
    setAiLoading(true);
    const result=await fetchGemini(
      `You are a documentation assistant for the SELECT AV/tech team at Accenture NYIH. The user will describe their day in plain English. Format it as a structured daily work log with these sections: Summary (1-2 sentences), Events Supported (bullet list), Tasks Completed (bullet list), Issues Encountered (bullet list, or "None"), Time Logged (if mentioned), Notes for Next Shift. Keep it professional but concise. Today's date: ${todayStr}. Team member: ${currentUser}.`,
      aiNotes
    );
    setAiLoading(false);
    if(!result||(typeof result==='string'&&result.startsWith('AI Error:'))){showMsg(result||'AI error.',true);return;}
    setModal({
      title:'Your Daily Work Log',content:result,actionLabel:'Copy',
      action:()=>{navigator.clipboard.writeText(result);showMsg('Copied to clipboard.');},
    });
  };

  const todayHours=todayEvents.reduce((sum,e)=>{
    return sum+(e.timeLogs||[]).filter(l=>l.date===todayStr&&l.user===currentUser).reduce((s,l)=>s+(parseFloat(l.hours)||0),0);
  },0);

  return(
    <div className="space-y-5 anim-in">
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<CalendarDays size={16}/>} value={todayEvents.length} label="Today's Events"/>
        <StatCard icon={<PlayCircle size={16}/>} value={todayEvents.filter(e=>e.eventStatus==='In Progress').length} label="In Progress"/>
        <StatCard icon={<Timer size={16}/>} value={`${todayHours.toFixed(1)}h`} label="My Hours Today"/>
      </div>

      {/* AI Document My Day */}
      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3"><PenLine size={14} className="text-[#A100FF]"/> Document My Day</h2>
        <p className="text-[10px] text-[#6B6B8A] mb-3">Describe what you did today in plain English — AI formats it into a structured work log you can copy.</p>
        <textarea value={aiNotes} onChange={e=>setAiNotes(e.target.value)}
          placeholder={`e.g. "I supported the Proto demo for a client visit, helped set up Cyviz in the Vision Room, logged 2 hours. Fixed a mic issue in common grounds. Tommy and I ran the afternoon workshop."`}
          rows="3" className={`w-full resize-none ${DK} mb-3`}/>
        <button onClick={aiDocumentDay} disabled={aiLoading}
          className="bg-[#A100FF] text-white font-bold px-5 py-2.5 rounded-xl text-xs uppercase hover:bg-[#B733FF] transition disabled:opacity-50 flex items-center gap-2">
          <BrainCircuit size={13} className={aiLoading?'animate-spin':''}/>{aiLoading?'Writing...':'Generate Work Log'}
        </button>
      </div>

      {/* Shift handoff */}
      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3"><SunMedium size={14} className="text-[#F59E0B]"/> Shift Handoff — {todayStr}</h2>
        {handoffNotes?.updatedBy&&<p className="text-[10px] text-[#6B6B8A] mb-2">Last updated by {handoffNotes.updatedBy} at {handoffNotes.updatedAt?new Date(handoffNotes.updatedAt).toLocaleTimeString():''}</p>}
        <textarea value={handoff} onChange={e=>setHandoff(e.target.value)}
          placeholder="Leave notes for the next shift — equipment quirks, room status, anything the team needs to know..."
          rows="3" className={`w-full resize-none ${DK} mb-3`}/>
        <button onClick={saveHandoff} disabled={savingHandoff}
          className="bg-[#F59E0B] text-[#0A0A0F] font-bold px-5 py-2 rounded-xl text-xs uppercase hover:bg-[#EAB308] transition disabled:opacity-50">
          {savingHandoff?'Saving...':'Save Handoff Notes'}
        </button>
      </div>

      {/* Time log modal */}
      {logTarget&&(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 anim-in">
          <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] max-w-sm w-full p-6">
            <h3 className="text-base font-black text-white mb-1 flex items-center gap-2"><Timer size={15} className="text-[#A100FF]"/>Log Time</h3>
            <p className="text-[11px] text-[#6B6B8A] mb-4">{logTarget.eventName}</p>
            <div className="space-y-3">
              <input value={logHours} onChange={e=>setLogHours(e.target.value)} type="number" min="0.25" step="0.25" placeholder="Hours (e.g. 1.5)" className={`w-full ${DK}`}/>
              <input value={logNote} onChange={e=>setLogNote(e.target.value)} placeholder="Note (optional — e.g. setup + demo)" className={`w-full ${DK}`}/>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={submitTimeLog} className="flex-1 bg-[#A100FF] text-white font-bold py-2.5 rounded-xl text-xs uppercase hover:bg-[#B733FF] transition">Log Time</button>
              <button onClick={()=>setLogTarget(null)} className="flex-1 bg-[#1A1A2E] text-[#6B6B8A] font-bold py-2.5 rounded-xl text-xs uppercase hover:text-white transition">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Event schedule */}
      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4"><Calendar size={16} className="text-[#A100FF]"/> Today's Schedule</h2>
        {!todayEvents.length&&<div className="text-center text-[#4A4A6A] text-xs font-bold py-10 border border-dashed border-[#2A2A3E] rounded-xl">No events scheduled for today. Add events in the Events tab.</div>}
        <div className="space-y-3">
          {todayEvents.map(e=>{
            const isCurrent=isCurrentEvent(e);
            const past=isPast(e);
            const bc=classBadgeColor(e.classification);
            const myHoursToday=(e.timeLogs||[]).filter(l=>l.date===todayStr&&l.user===currentUser).reduce((s,l)=>s+(parseFloat(l.hours)||0),0);
            return(
              <div key={e.id} className={`rounded-xl border p-4 transition ${isCurrent?'border-[#A100FF] bg-[#A100FF]/5':past?'border-[#2A2A3E] opacity-60 bg-[#0A0A0F]':'border-[#2A2A3E] bg-[#0D0D15]'}`}>
                <div className="flex justify-between items-start flex-wrap gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {isCurrent&&<span className="text-[9px] font-black uppercase tracking-wider text-[#A100FF] bg-[#A100FF]/10 px-2 py-0.5 rounded-full animate-pulse">Live now</span>}
                      {past&&e.eventStatus!=='Wrapped'&&<span className="text-[9px] font-black uppercase text-[#F59E0B] bg-[#F59E0B]/10 px-2 py-0.5 rounded-full">Past</span>}
                      <span className="text-xs font-bold text-white">{e.eventName}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase" style={{background:`${bc}20`,color:bc}}>{e.classification||'TBD'}</span>
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-[#1A1A2E] text-[#6B6B8A]">{e.sessionType}</span>
                    </div>
                    <div className="text-[10px] text-[#6B6B8A] space-y-0.5">
                      <p className="flex items-center gap-1"><Clock size={9}/>{e.startDate?new Date(e.startDate).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''} — {e.endDate?new Date(e.endDate).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</p>
                      <p className="flex items-center gap-1"><MapPin size={9}/>{e.eventLocation||'No room'}</p>
                      <p className="flex items-center gap-1"><User size={9}/>SELECT: {e.selectPoc||'TBD'}</p>
                      {(e.demo||e.selectResources)&&<p className="flex items-center gap-1 text-[#A100FF]"><Zap size={9}/>Equipment: {e.demo||e.selectResources}</p>}
                      {e.runOfShow&&<p className="flex items-center gap-1"><FileText size={9}/>Run of show: {e.runOfShow}</p>}
                    </div>
                    {myHoursToday>0&&(
                      <p className="text-[10px] text-[#22C55E] mt-1.5 font-bold flex items-center gap-1"><Timer size={9}/>My hours today: {myHoursToday.toFixed(1)}h</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {EVENT_STATUSES.map(s=>(
                      <button key={s} onClick={()=>updateEventStatus(e.id,s,e.eventName)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition border whitespace-nowrap ${e.eventStatus===s?'border-transparent text-white':'border-[#2A2A3E] text-[#6B6B8A] hover:border-[#A100FF] hover:text-white'}`}
                        style={e.eventStatus===s?{background:statusColor(s)}:{}}>
                        {s}
                      </button>
                    ))}
                    <button onClick={()=>setLogTarget(e)}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border border-[#2A2A3E] text-[#A100FF] hover:bg-[#A100FF]/10 transition flex items-center gap-1 justify-center">
                      <Timer size={9}/>Log Time
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
// ── Calendar ──
function CalendarView({events}){
  const[month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);});
  const today=new Date();
  const todayStr=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const year=month.getFullYear();const mo=month.getMonth();
  const firstDay=new Date(year,mo,1).getDay();const daysInMonth=new Date(year,mo+1,0).getDate();
  const prevDays=new Date(year,mo,0).getDate();const cells=[];
  for(let i=0;i<firstDay;i++) cells.push({day:prevDays-firstDay+1+i,cur:false});
  for(let i=1;i<=daysInMonth;i++) cells.push({day:i,cur:true});
  const rem=42-cells.length;for(let i=1;i<=rem;i++) cells.push({day:i,cur:false});
  const getEventsForDay=(day)=>{
    const ds=`${year}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return events.filter(e=>{const sd=(e.startDate||'').slice(0,10);const ed=(e.endDate||'').slice(0,10);return(sd<=ds&&(ed>=ds||sd===ds));});
  };
  const moNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  return(
    <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5 anim-in">
      <div className="flex justify-between items-center mb-5">
        <button onClick={()=>setMonth(new Date(year,mo-1,1))} className="p-2 rounded-lg bg-[#1A1A2E] text-[#6B6B8A] hover:text-white hover:bg-[#2A2A3E] transition"><ChevronLeft size={16}/></button>
        <h2 className="text-lg font-black text-white">{moNames[mo]} {year}</h2>
        <button onClick={()=>setMonth(new Date(year,mo+1,1))} className="p-2 rounded-lg bg-[#1A1A2E] text-[#6B6B8A] hover:text-white hover:bg-[#2A2A3E] transition"><ChevronRight size={16}/></button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-[#2A2A3E] rounded-xl overflow-hidden">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div key={d} className="bg-[#0D0D15] py-2.5 text-center text-[10px] font-bold text-[#6B6B8A] uppercase tracking-wider">{d}</div>)}
        {cells.map((c,idx)=>{
          const ds=`${year}-${String(mo+1).padStart(2,'0')}-${String(c.day).padStart(2,'0')}`;
          const isToday=c.cur&&ds===todayStr;
          const dayEvents=c.cur?getEventsForDay(c.day):[];
          return(
            <div key={idx} className={`bg-[#0D0D15] min-h-[90px] p-1.5 ${!c.cur?'opacity-25':''} ${isToday?'ring-2 ring-inset ring-[#A100FF]':''}`}>
              <span className={`text-[11px] font-bold block mb-0.5 ${isToday?'text-[#A100FF]':c.cur?'text-[#9B9BB0]':'text-[#4A4A6A]'}`}>{c.day}</span>
              <div className="space-y-0.5 overflow-hidden max-h-[55px]">
                {dayEvents.slice(0,3).map((ev,i)=><div key={i} className="text-[8px] font-bold truncate px-1.5 py-0.5 rounded" style={{background:`${classBadgeColor(ev.classification)}22`,color:classBadgeColor(ev.classification)}}>{ev.eventName}</div>)}
                {dayEvents.length>3&&<div className="text-[8px] text-[#6B6B8A] font-bold pl-1">+{dayEvents.length-3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Kanban ── (lightweight cards — checklist pill only)
function KanbanPage({tasks,showMsg,currentUser}){
  const[editingId,setEditingId]=useState(null);
  const[expandedId,setExpandedId]=useState(null);
  const[filterMember,setFilterMember]=useState('');

  const handleAdd=async(e)=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const d={title:fd.get('t'),assignee:fd.get('a'),dueDate:fd.get('d'),timeSpent:fd.get('du'),details:fd.get('det'),timeLogs:[],status:'todo',timestamp:new Date().toISOString()};
    if(d.title){await addDoc(col('shared_tasks'),d);await logActivity(`${currentUser} added task "${d.title}"`,currentUser);e.target.reset();showMsg('Task added.');}
  };
  const move=async(id,s,title)=>{await updateDoc(doc(db,'artifacts',appId,'public','data','shared_tasks',id),{status:s});await logActivity(`${currentUser} moved "${title}" to ${s}`,currentUser);};
  const del=async(id)=>{if(window.confirm('Delete task?')){await deleteDoc(doc(db,'artifacts',appId,'public','data','shared_tasks',id));showMsg('Deleted.');}};
  const saveEdit=async(e,id,title)=>{
    e.preventDefault();const fd=new FormData(e.target);
    await updateDoc(doc(db,'artifacts',appId,'public','data','shared_tasks',id),{title:fd.get('t'),assignee:fd.get('a'),dueDate:fd.get('d'),timeSpent:fd.get('du'),details:fd.get('det')});
    await logActivity(`${currentUser} updated task "${title}"`,currentUser);setEditingId(null);showMsg('Updated.');
  };
  const logTime=async(task,hours,note)=>{
    const hrs=parseFloat(hours);if(isNaN(hrs)||hrs<=0) return;
    const entry={user:currentUser,hours:hrs,note,date:getTodayStr(),timestamp:new Date().toISOString()};
    const existing=task.timeLogs||[];
    const totalHrs=existing.reduce((s,l)=>s+(parseFloat(l.hours)||0),0)+hrs;
    await updateDoc(doc(db,'artifacts',appId,'public','data','shared_tasks',task.id),{timeLogs:[...existing,entry],timeSpent:String(totalHrs.toFixed(1))});
    await logActivity(`${currentUser} logged ${hrs}h on task "${task.title}"`,currentUser);
  };

  const filterByStatus=(t,key)=>{
    const s=String(t.status||'todo').toLowerCase().replace(/[\s-_]+/g,'');
    const map={todo:'todo',backlog:'todo','':  'todo',doing:'doing',active:'doing',inprogress:'doing',complete:'complete',done:'complete',completed:'complete'};
    return(map[s]||s)===key;
  };

  const visibleTasks=filterMember?tasks.filter(t=>t.assignee===filterMember):tasks;
  const statuses=[{key:'todo',label:'To Do',color:'#6B6B8A'},{key:'doing',label:'Doing',color:'#F59E0B'},{key:'complete',label:'Complete',color:'#22C55E'}];

  const getChecklistProgress=(details)=>{
    if(!details) return null;
    const lines=details.split('\n');
    const boxes=lines.filter(l=>l.startsWith('☐')||l.startsWith('☑'));
    if(!boxes.length) return null;
    const done=boxes.filter(l=>l.startsWith('☑')).length;
    return{done,total:boxes.length};
  };

  const renderCard=(t)=>{
    const isExpanded=expandedId===t.id;
    const progress=getChecklistProgress(t.details);
    if(editingId===t.id) return(
      <form key={t.id} onSubmit={e=>saveEdit(e,t.id,t.title)} className="bg-[#0D0D15] border border-[#A100FF] rounded-xl p-3 space-y-2 anim-in">
        <input name="t" defaultValue={t.title} required className={`w-full text-xs ${DK}`}/>
        <textarea name="det" defaultValue={t.details} placeholder="Notes..." rows="2" className={`w-full text-xs resize-none ${DK}`}/>
        <div className="grid grid-cols-2 gap-2">
          <select name="a" defaultValue={t.assignee} className={`text-xs ${DK}`}><option value="">Assign...</option>{TEAM_MEMBERS.map(m=><option key={m} value={m}>{m}</option>)}</select>
          <input name="du" defaultValue={t.timeSpent} placeholder="Hours total" className={`text-xs ${DK}`}/>
        </div>
        <input name="d" type="date" defaultValue={t.dueDate} className={`w-full text-xs ${DK}`}/>
        <div className="flex gap-2">
          <button type="submit" className="flex-1 bg-[#A100FF] text-white text-[10px] font-bold py-1.5 rounded-lg uppercase">Save</button>
          <button type="button" onClick={()=>setEditingId(null)} className="flex-1 bg-[#1A1A2E] text-[#6B6B8A] text-[10px] font-bold py-1.5 rounded-lg uppercase">Cancel</button>
        </div>
      </form>
    );
    return(
      <div key={t.id} className="bg-[#0D0D15] border border-[#2A2A3E] rounded-xl p-3.5 group hover:border-[#A100FF]/40 transition">
        <div className="flex justify-between items-start mb-2">
          <p className="text-xs font-bold text-white leading-snug flex-1 pr-2">{t.title}</p>
          <button onClick={()=>del(t.id)} className="text-[#2A2A3E] group-hover:text-red-400 transition flex-shrink-0"><Trash2 size={12}/></button>
        </div>
        <div className="bg-[#111119] rounded-lg p-2 space-y-1 text-[9px] font-bold text-[#6B6B8A] mb-2">
          <div className="flex items-center gap-1"><User size={9} className="text-[#A100FF]"/>{t.assignee||'Unassigned'}</div>
          {t.linkedEvent&&<div className="flex items-center gap-1 text-[#A100FF]"><ClipboardList size={9}/>{t.linkedEvent}</div>}
          {t.dueDate&&<div className="flex items-center gap-1"><CalendarDays size={9}/>{t.dueDate}</div>}
          {(t.timeSpent||((t.timeLogs||[]).length>0))&&<div className="flex items-center gap-1"><Timer size={9}/>{t.timeSpent||((t.timeLogs||[]).reduce((s,l)=>s+(parseFloat(l.hours)||0),0).toFixed(1))}h logged</div>}
        </div>
        {/* Checklist pill — compact */}
        {progress&&(
          <button onClick={()=>setExpandedId(isExpanded?null:t.id)}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[10px] font-bold mb-2 transition ${isExpanded?'bg-[#A100FF]/15 text-[#A100FF]':'bg-[#1A1A2E] text-[#6B6B8A] hover:bg-[#2A2A3E] hover:text-white'}`}>
            <span className="flex items-center gap-1"><CheckSquare size={10}/> Checklist {progress.done}/{progress.total}</span>
            {progress.done===progress.total?<CheckCircle2 size={10} className="text-[#22C55E]"/>:(isExpanded?<ChevronUp size={10}/>:<ChevronDown size={10}/>)}
          </button>
        )}
        {/* Expanded checklist */}
        {isExpanded&&progress&&(
          <div className="bg-[#111119] border border-[#2A2A3E] rounded-xl p-3 mb-2 anim-in">
            <ChecklistEditor
              value={t.details}
              onChange={async(newVal)=>{
                await updateDoc(doc(db,'artifacts',appId,'public','data','shared_tasks',t.id),{details:newVal});
              }}
            />
          </div>
        )}
        {/* Quick time log */}
        <TimeLogInline task={t} onLog={logTime}/>
        <div className="flex justify-between opacity-0 group-hover:opacity-100 transition mt-1">
          <div className="flex gap-1">
            {t.status!=='todo'&&<button onClick={()=>move(t.id,t.status==='complete'?'doing':'todo',t.title)} className="p-1 rounded bg-[#1A1A2E] text-[#6B6B8A] hover:text-white"><ChevronLeft size={12}/></button>}
            {t.status!=='complete'&&<button onClick={()=>move(t.id,t.status==='todo'?'doing':'complete',t.title)} className="p-1 rounded bg-[#1A1A2E] text-[#6B6B8A] hover:text-white"><ChevronRight size={12}/></button>}
          </div>
          <button onClick={()=>setEditingId(t.id)} className="text-[9px] text-[#A100FF] font-bold uppercase flex items-center gap-0.5"><Edit3 size={9}/> Edit</button>
        </div>
      </div>
    );
  };

  return(
    <div className="anim-in space-y-5">
      <form onSubmit={handleAdd} className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-4">
        <div className="grid md:grid-cols-5 gap-3">
          <input name="t" placeholder="Task title..." required className={`md:col-span-2 ${DK}`}/>
          <select name="a" className={DK}><option value="">Assign...</option>{TEAM_MEMBERS.map(m=><option key={m} value={m}>{m}</option>)}</select>
          <input name="d" type="date" className={DK}/>
          <button type="submit" className="bg-[#A100FF] text-white font-bold py-3 rounded-xl text-xs uppercase hover:bg-[#B733FF] transition">Add</button>
        </div>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <input name="du" placeholder="Hours" className={DK}/>
          <textarea name="det" placeholder="Notes..." rows="1" className={`resize-none ${DK}`}/>
        </div>
      </form>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-[#6B6B8A] font-bold uppercase tracking-wider">Filter:</span>
        <button onClick={()=>setFilterMember('')} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition ${filterMember===''?'bg-[#A100FF] text-white':'bg-[#1A1A2E] text-[#6B6B8A] hover:bg-[#2A2A3E] hover:text-white'}`}>All</button>
        {TEAM_MEMBERS.map(m=><MemberPill key={m} name={m} active={filterMember===m} onClick={()=>setFilterMember(filterMember===m?'':m)}/>)}
        {filterMember&&<span className="text-[10px] text-[#A100FF] font-bold">{filterMember} — {visibleTasks.length} task{visibleTasks.length!==1?'s':''}</span>}
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {statuses.map(({key,label,color})=>(
          <div key={key} className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-4 min-h-[300px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider" style={{color}}>{label}</h3>
              <span className="text-[10px] font-bold bg-[#0D0D15] border border-[#2A2A3E] px-2 py-0.5 rounded" style={{color}}>{visibleTasks.filter(t=>filterByStatus(t,key)).length}</span>
            </div>
            <div className="space-y-3">{visibleTasks.filter(t=>filterByStatus(t,key)).map(renderCard)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeLogInline({task,onLog}){
  const[open,setOpen]=useState(false);
  const[h,setH]=useState('');
  const[n,setN]=useState('');
  if(!open) return(
    <button onClick={()=>setOpen(true)} className="w-full flex items-center gap-1 text-[10px] text-[#6B6B8A] hover:text-[#A100FF] font-bold uppercase transition mb-2">
      <Timer size={9}/> Log time
    </button>
  );
  return(
    <div className="flex gap-1.5 mb-2 anim-in">
      <input value={h} onChange={e=>setH(e.target.value)} type="number" min="0.25" step="0.25" placeholder="hrs" className={`w-16 text-xs ${DK} py-1.5 px-2`}/>
      <input value={n} onChange={e=>setN(e.target.value)} placeholder="note" className={`flex-1 text-xs ${DK} py-1.5 px-2`}/>
      <button onClick={async()=>{await onLog(task,h,n);setH('');setN('');setOpen(false);}} className="bg-[#A100FF] text-white text-[10px] font-bold px-2 py-1.5 rounded-lg uppercase">+</button>
      <button onClick={()=>setOpen(false)} className="text-[#6B6B8A] hover:text-white text-[10px] font-bold px-2 py-1.5">✕</button>
    </div>
  );
}
// ── Schedule / Events page ──
function SchedulePage({events,showMsg,fetchGemini,setModal,currentUser}){
  const[editingId,setEditingId]=useState(null);
  const[expandedId,setExpandedId]=useState(null);
  const[formData,setFormData]=useState(blankEventForm());
  const[beoText,setBeoText]=useState('');
  const[importBanner,setImportBanner]=useState('');
  const[aiLoading,setAiLoading]=useState(false);
  const[pdfLoading,setPdfLoading]=useState(false);
  const[previewEvents,setPreviewEvents]=useState(null);
  const[searchTerm,setSearchTerm]=useState('');
  const[classificationFilter,setClassificationFilter]=useState('');
  const[sourceFilter,setSourceFilter]=useState('');
  const fileRef=useRef(null);

  const totalStats=useMemo(()=>({
    events:events.length,
    imported:events.filter(e=>e.source==='Imported').length,
    attendees:events.reduce((s,e)=>s+(parseInt(String(e.attendees||'').replace(/[^\d]/g,''),10)||0),0),
    high:events.filter(e=>['Leadership','Client'].includes(e.classification)).length,
  }),[events]);

  const filteredEvents=useMemo(()=>events.filter(e=>{
    const h=[e.eventName,e.eventPoc,e.selectPoc,e.demo,e.eventLocation,e.selectResources,e.notes,e.supportTeam,e.source,e.classification].join(' ').toLowerCase();
    return(!searchTerm||h.includes(searchTerm.toLowerCase()))&&(!classificationFilter||e.classification===classificationFilter)&&(!sourceFilter||(e.source||'Manual')===sourceFilter);
  }),[events,searchTerm,classificationFilter,sourceFilter]);

  const updateField=(key,value)=>setFormData(p=>({...p,[key]:value,...(key==='startDate'&&!p.weekOf?{weekOf:weekOfFromDateTime(value)}:{})}));
  const resetForm=()=>{setEditingId(null);setFormData(blankEventForm());};

  const openDetails=(e)=>{
    const c=`Event: ${e.eventName||''}\nStart: ${e.startDate||''}\nEnd: ${e.endDate||''}\nPOC: ${e.eventPoc||''}\nSELECT POC: ${e.selectPoc||''}\nRoom: ${e.eventLocation||''}\nClassification: ${e.classification||''}\nType: ${e.sessionType||''}\nAttendees: ${e.attendees||''}\nEquipment: ${e.demo||''}\nRun of Show: ${e.runOfShow||''}\nNotes: ${e.notes||''}\nPost-Event Notes: ${e.postEventNotes||''}`;
    setModal({title:'Event Details',content:c,actionLabel:'Copy',action:()=>{navigator.clipboard.writeText(c);showMsg('Copied.');}});
  };

  const duplicateEvent=(e)=>{
    setEditingId(null);
    setFormData({eventName:e.eventName+' (Copy)',startDate:'',endDate:'',eventPoc:e.eventPoc||'',selectPoc:e.selectPoc||'',location:e.location||'NYIH',eventLocation:e.eventLocation||'',classification:e.classification||'Internal',sessionType:e.sessionType||'Demo',attendees:e.attendees||'',demo:e.demo||'',selectResources:e.selectResources||'',sessionDays:e.sessionDays||'',sessionSupportDuration:e.sessionSupportDuration||'',supportTeam:e.supportTeam||'NYIH SELECT',weekOf:'',notes:e.notes||'',runOfShow:e.runOfShow||'',source:'Manual',eventStatus:'Not Started',checklist:e.checklist||'',postEventNotes:'',timeLogs:[]});
    window.scrollTo({top:0,behavior:'smooth'});showMsg('Form pre-filled — update dates and save.');
  };

  const startEdit=(e)=>{
    setEditingId(e.id);
    setFormData({eventName:e.eventName||'',startDate:e.startDate||'',endDate:e.endDate||'',eventPoc:e.eventPoc||'',selectPoc:e.selectPoc||'',location:e.location||'NYIH',eventLocation:e.eventLocation||'',classification:e.classification||'Internal',sessionType:e.sessionType||'Demo',attendees:e.attendees||'',demo:e.demo||'',selectResources:e.selectResources||'',sessionDays:e.sessionDays||'',sessionSupportDuration:e.sessionSupportDuration||'',supportTeam:e.supportTeam||'NYIH SELECT',weekOf:e.weekOf||'',notes:e.notes||'',runOfShow:e.runOfShow||'',source:e.source||'Manual',eventStatus:e.eventStatus||'Not Started',checklist:e.checklist||'',postEventNotes:e.postEventNotes||'',timeLogs:e.timeLogs||[]});
    window.scrollTo({top:0,behavior:'smooth'});
  };

  const handleCommit=async(e)=>{
    e.preventDefault();
    const automation=buildAutomationSummary(formData);
    const checklist=formData.checklist||buildDefaultChecklist(formData);
    const d=sanitizeEventData({...formData,...automation,checklist,selectPoc:formData.selectPoc||inferSelectOwner(formData),source:formData.source||(editingId?(events.find(x=>x.id===editingId)?.source||'Manual'):'Manual'),weekOf:formData.weekOf||weekOfFromDateTime(formData.startDate)});
    if(!d.eventName||!d.eventPoc){showMsg('Event name and POC required.',true);return;}
    try{
      if(editingId){
        await updateDoc(doc(db,'artifacts',appId,'public','data','shared_events',editingId),d);
        await logActivity(`${currentUser} updated event "${d.eventName}"`,currentUser);
        setEditingId(null);showMsg('Event updated.');
      }else{
        const ref=await addDoc(col('shared_events'),{...d,timeLogs:[],timestamp:new Date().toISOString()});
        await createTasksForEvent(ref.id,d);
        await logActivity(`${currentUser} created event "${d.eventName}"`,currentUser);
        if(d.riskLevel==='High') await sendSlackAlert(`🔴 *High-risk event:* ${d.eventName} | Room: ${d.eventLocation||'TBD'} | SELECT: ${d.selectPoc||'TBD'}`);
        showMsg('Event saved with auto-checklist and task.');
      }
      resetForm();
    }catch(err){console.error(err);showMsg('Save failed.',true);}
  };

  const handleSmartImport=async()=>{
    try{
      let text=beoText||'';
      const file=fileRef.current?.files?.[0];
      if(!text.trim()&&file){
        try{setPdfLoading(true);setImportBanner('Reading file...');
          if(file.name.toLowerCase().endsWith('.pdf')){text=await extractTextFromPdf(file);}
          else{text=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result||''));r.onerror=err=>no(new Error('FileReader failed: '+err));r.readAsText(file);});}
          setPdfLoading(false);setBeoText(text);
        }catch(err){setPdfLoading(false);setImportBanner(`File read failed: ${err.message}`);showMsg(`Could not read file: ${err.message}`,true);return;}
      }
      if(!text.trim()){showMsg('Upload a PDF or paste BEO text first.',true);setImportBanner('No text to process.');return;}
      if(text.trim().length<50){const msg='This PDF appears to be image-scanned. Try pasting BEO text directly instead.';showMsg(msg,true);setImportBanner(msg);return;}
      setAiLoading(true);setImportBanner(`Sending ${text.length.toLocaleString()} chars to AI...`);
      const aiPrompt=`You are an event data extraction specialist for the Accenture NYIH SELECT team. Read the BEO and extract SELECT-relevant events. Return ONLY a JSON array. No markdown, no prose. If zero SELECT events: return []. Each event object: eventName, startDate (YYYY-MM-DDTHH:mm), endDate, eventPoc, selectPoc, location (default NYIH), eventLocation, classification (Internal/Client/Leadership/Community/Confidential/TBD), sessionType, attendees, demo (equipment), selectResources, supportTeam (default NYIH SELECT), sessionDays, notes (WRES: id | Host: name | Equipment: list | Special: notes). Include WRES blocks if: *SELECT Required, or SELECT team member named, or Proto/Spot/Cyviz/Vu AI/Surface Hub/Hypervsn/Alleo/broadcast/MTR mentioned, or in Tank/Vision/Interchange/ExCo rooms, or loaner laptops/clickers with TXA. Skip pure TXA or Facilities.`;
      const result=await fetchGemini(aiPrompt,text,false);
      if(!result||(typeof result==='string'&&result.startsWith('AI Error:'))){setAiLoading(false);setImportBanner(result||'AI returned no response.');showMsg(result||'AI error.',true);return;}
      let parsed=[];
      try{const cleaned=String(result).replace(/```json|```/g,'').trim();const obj=JSON.parse(cleaned);parsed=Array.isArray(obj)?obj:[obj];}
      catch{try{const m=String(result).match(/\[[\s\S]*\]/);if(m) parsed=JSON.parse(m[0]);}catch{}}
      parsed=parsed.filter(e=>e&&typeof e==='object'&&(e.eventName||e.eventPoc||e.demo));
      if(!parsed.length){setAiLoading(false);setImportBanner('No SELECT events found.');showMsg('No SELECT events detected.',true);return;}
      setPreviewEvents(parsed.map(raw=>({...blankEventForm(),...Object.fromEntries(ALLOWED_EVENT_KEYS.filter(k=>raw[k]!==undefined&&raw[k]!==null).map(k=>[k,String(raw[k]||'').slice(0,500)])),source:'Imported',supportTeam:raw.supportTeam||'NYIH SELECT',location:raw.location||'NYIH',weekOf:weekOfFromDateTime(raw.startDate),_isDupe:events.some(x=>x.eventName===raw.eventName&&x.startDate===raw.startDate&&x.eventLocation===raw.eventLocation),_skip:false})));
      setAiLoading(false);setImportBanner(`AI found ${parsed.length} event(s) — review below before saving.`);
    }catch(outerErr){setPdfLoading(false);setAiLoading(false);setImportBanner(`Error: ${outerErr.message}`);showMsg(`Import failed: ${outerErr.message}`,true);}
  };

  const commitPreview=async()=>{
    if(!previewEvents?.length) return;
    let saved=0;let skipped=0;
    for(const evt of previewEvents){
      if(evt._isDupe||evt._skip){skipped++;continue;}
      const{_isDupe,_skip,...cleanEvt}=evt;
      const automation=buildAutomationSummary(cleanEvt);
      const checklist=buildDefaultChecklist(cleanEvt);
      const finalEvt=sanitizeEventData({...cleanEvt,...automation,checklist,selectPoc:cleanEvt.selectPoc||inferSelectOwner(cleanEvt)});
      const eventRef=await addDoc(col('shared_events'),{...finalEvt,timeLogs:[],timestamp:new Date().toISOString()});
      await createTasksForEvent(eventRef.id,finalEvt);saved++;
    }
    await logActivity(`${currentUser} imported ${saved} BEO event(s)`,currentUser);
    setPreviewEvents(null);setBeoText('');if(fileRef.current) fileRef.current.value='';
    setImportBanner(`Saved ${saved} event(s)${skipped>0?` • ${skipped} skipped`:''}.`);
    showMsg(`Imported ${saved} event(s).`);
  };

  return(
    <div className="space-y-5 anim-in">
      {/* BEO Import */}
      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-1"><Upload size={16} className="text-[#A100FF]"/> Smart BEO Import</h2>
        <p className="text-[11px] text-[#6B6B8A] mb-4">Upload a BEO PDF or paste text. AI extracts <span className="text-[#A100FF] font-bold">SELECT</span> events for review before saving. Note: remove client names from BEOs before importing.</p>
        {importBanner&&(<div className="bg-[#A100FF]/10 border border-[#A100FF]/30 rounded-xl p-3 text-xs text-[#C0C0D8] font-bold mb-4 flex items-center gap-2">{aiLoading?<RefreshCcw size={13} className="animate-spin text-[#A100FF]"/>:<CheckCircle2 size={13} className="text-[#A100FF]"/>}{importBanner}</div>)}
        {!previewEvents&&(
          <div className="grid md:grid-cols-[1fr,auto] gap-4 items-end">
            <div className="space-y-3">
              <textarea value={beoText} onChange={e=>setBeoText(e.target.value)} className={`w-full h-28 resize-none text-xs font-mono ${DK}`} placeholder="Paste BEO text here... or upload a file below"/>
              <input ref={fileRef} type="file" accept=".pdf,.txt,.csv,.json" className={`w-full text-xs ${DK}`}/>
            </div>
            <button onClick={handleSmartImport} disabled={aiLoading||pdfLoading} className="bg-[#A100FF] text-white px-8 py-4 rounded-xl text-sm font-bold uppercase tracking-wider hover:bg-[#B733FF] transition disabled:opacity-50 flex items-center gap-2 h-fit whitespace-nowrap">
              {pdfLoading?(<><RefreshCcw size={14} className="animate-spin"/>Reading...</>):aiLoading?(<><BrainCircuit size={14} className="animate-spin"/>Extracting...</>):(<><Zap size={14}/>Import SELECT</>)}
            </button>
          </div>
        )}
        {previewEvents&&(
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-sm font-bold text-white">Review {previewEvents.length} extracted event{previewEvents.length!==1?'s':''}</p>
              <div className="flex gap-2">
                <button onClick={()=>{setPreviewEvents(null);setImportBanner('');}} className="px-4 py-2 rounded-lg bg-[#1A1A2E] text-[#6B6B8A] text-xs font-bold uppercase hover:text-white transition">Cancel</button>
                <button onClick={commitPreview} className="px-4 py-2 rounded-lg bg-[#A3E635] text-[#0A0A0F] text-xs font-bold uppercase hover:bg-[#8CD02F] transition">Save {previewEvents.filter(e=>!e._isDupe&&!e._skip).length} Events</button>
              </div>
            </div>
            {previewEvents.map((evt,idx)=>(
              <div key={idx} className={`bg-[#0D0D15] border rounded-xl p-3 ${evt._isDupe?'border-[#F59E0B]/40 opacity-60':evt._skip?'border-[#2A2A3E] opacity-40':'border-[#A100FF]/30'}`}>
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1 space-y-2">
                    <input value={evt.eventName} onChange={e=>{const p=[...previewEvents];p[idx]={...p[idx],eventName:e.target.value};setPreviewEvents(p);}} className={`w-full text-xs font-bold ${DK} py-2`} placeholder="Event name"/>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={evt.startDate} onChange={e=>{const p=[...previewEvents];p[idx]={...p[idx],startDate:e.target.value};setPreviewEvents(p);}} type="datetime-local" className={`text-xs ${DK} py-2`}/>
                      <input value={evt.eventLocation} onChange={e=>{const p=[...previewEvents];p[idx]={...p[idx],eventLocation:e.target.value};setPreviewEvents(p);}} className={`text-xs ${DK} py-2`} placeholder="Room"/>
                    </div>
                    <input value={evt.demo} onChange={e=>{const p=[...previewEvents];p[idx]={...p[idx],demo:e.target.value};setPreviewEvents(p);}} className={`w-full text-xs ${DK} py-2`} placeholder="Equipment"/>
                    {evt._isDupe&&<p className="text-[10px] text-[#F59E0B] font-bold">⚠ Duplicate — already exists</p>}
                  </div>
                  <button onClick={()=>{const p=[...previewEvents];p[idx]={...p[idx],_skip:!p[idx]._skip};setPreviewEvents(p);}} className={`text-[10px] font-bold px-3 py-1.5 rounded-lg uppercase flex-shrink-0 ${evt._skip?'bg-[#22C55E]/10 text-[#22C55E]':'bg-red-500/10 text-red-400'}`}>{evt._skip?'Include':'Skip'}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[1.3fr,.7fr] gap-5">
        {/* Form */}
        <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
          <div className="flex justify-between items-start mb-4 flex-wrap gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2"><ClipboardList size={16} className="text-[#A100FF]"/>{editingId?'Edit Event':'New Event'}</h2>
              <p className="text-[11px] text-[#6B6B8A] mt-0.5">{editingId?'Editing event':'Add manually or import above'}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {['Demo','Client','Leadership','Workshop'].map(t=>(<button key={t} type="button" onClick={()=>updateField('sessionType',t)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition ${formData.sessionType===t?'bg-[#A100FF] text-white':'bg-[#0D0D15] border border-[#2A2A3E] text-[#6B6B8A] hover:border-[#A100FF]'}`}>{t}</button>))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {QUICK_FILL_CARDS.map(c=>(<button key={c.name} type="button" onClick={()=>setFormData(p=>({...p,demo:c.demo,sessionType:c.sessionType}))} className="text-left p-3 rounded-xl bg-[#0D0D15] border border-[#2A2A3E] hover:border-[#A100FF]/50 transition"><div className="text-[11px] font-bold text-white">{c.name}</div><div className="text-[9px] text-[#6B6B8A]">{c.note}</div></button>))}
          </div>
          <form onSubmit={handleCommit} className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <input value={formData.eventName} onChange={e=>updateField('eventName',e.target.value)} placeholder="Event Name *" required className={DK}/>
              <input value={formData.eventPoc} onChange={e=>updateField('eventPoc',e.target.value)} placeholder="Event POC *" required className={DK}/>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="text-[9px] font-bold text-[#6B6B8A] uppercase">Start<input value={formData.startDate} onChange={e=>updateField('startDate',e.target.value)} type="datetime-local" required className={`w-full mt-1 ${DK}`}/></div>
              <div className="text-[9px] font-bold text-[#6B6B8A] uppercase">End<input value={formData.endDate} onChange={e=>updateField('endDate',e.target.value)} type="datetime-local" required className={`w-full mt-1 ${DK}`}/></div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <select value={formData.selectPoc} onChange={e=>updateField('selectPoc',e.target.value)} className={DK}><option value="">SELECT Lead...</option>{TEAM_MEMBERS.map(m=><option key={m} value={m}>{m}</option>)}</select>
              <select value={formData.eventLocation} onChange={e=>updateField('eventLocation',e.target.value)} className={DK}><option value="">Room...</option>{ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</select>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <select value={formData.classification} onChange={e=>updateField('classification',e.target.value)} className={DK}>{CLASSIFICATIONS.map(c=><option key={c} value={c}>{c}</option>)}</select>
              <select value={formData.sessionType} onChange={e=>updateField('sessionType',e.target.value)} className={DK}>{SESSION_TYPES.map(s=><option key={s} value={s}>{s}</option>)}</select>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <input value={formData.attendees} onChange={e=>updateField('attendees',e.target.value)} placeholder="Attendees" className={DK}/>
              <input value={formData.demo} onChange={e=>updateField('demo',e.target.value)} placeholder="Demo / Equipment" className={DK}/>
            </div>
            <input value={formData.selectResources} onChange={e=>updateField('selectResources',e.target.value)} placeholder="SELECT Resources" className={`w-full ${DK}`}/>
            <div className="grid md:grid-cols-2 gap-3">
              <input value={formData.sessionDays} onChange={e=>updateField('sessionDays',e.target.value)} placeholder="Session Days" className={DK}/>
              <select value={formData.sessionSupportDuration} onChange={e=>updateField('sessionSupportDuration',e.target.value)} className={DK}><option value="">Duration...</option>{DURATION_OPTIONS.map(d=><option key={d} value={d}>{d}</option>)}</select>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <select value={formData.supportTeam} onChange={e=>updateField('supportTeam',e.target.value)} className={DK}>{SUPPORT_TEAMS.map(t=><option key={t} value={t}>{t}</option>)}</select>
              <div className="text-[9px] font-bold text-[#6B6B8A] uppercase">Week Of<input value={formData.weekOf} onChange={e=>updateField('weekOf',e.target.value)} type="date" className={`w-full mt-1 ${DK}`}/></div>
            </div>
            <textarea value={formData.runOfShow} onChange={e=>updateField('runOfShow',e.target.value)} placeholder="Run of show / timing (e.g. 9:00 welcome, 9:15 Proto demo)..." rows="2" className={`w-full resize-none ${DK}`}/>
            <textarea value={formData.notes} onChange={e=>updateField('notes',e.target.value)} placeholder="Notes..." rows="2" className={`w-full resize-none ${DK}`}/>
            <div className="flex gap-2">
              <button type="submit" className={`flex-1 font-bold py-3 rounded-xl text-sm uppercase transition ${editingId?'bg-[#A3E635] text-[#0A0A0F] hover:bg-[#8CD02F]':'bg-[#A100FF] text-white hover:bg-[#B733FF]'}`}>{editingId?'Update Event':'Save Event'}</button>
              {editingId&&<button type="button" onClick={resetForm} className="px-5 bg-[#1A1A2E] text-[#6B6B8A] font-bold py-3 rounded-xl text-sm uppercase hover:text-white transition flex items-center gap-1"><RefreshCcw size={13}/> Cancel</button>}
            </div>
          </form>
        </div>

        {/* Event queue */}
        <div className="space-y-5">
          <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-4">
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard icon={<ClipboardList size={16}/>} value={totalStats.events} label="Events"/>
              <StatCard icon={<Upload size={16}/>} value={totalStats.imported} label="Imported"/>
              <StatCard icon={<Users size={16}/>} value={totalStats.attendees} label="Attendees"/>
              <StatCard icon={<TrendingUp size={16}/>} value={totalStats.high} label="High Priority"/>
            </div>
          </div>
          <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-4">
            <div className="space-y-2.5 mb-3">
              <div className="flex items-center gap-2 rounded-xl bg-[#0D0D15] border border-[#2A2A3E] p-2.5 focus-within:border-[#A100FF] transition">
                <Search size={13} className="text-[#4A4A6A]"/>
                <input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="Search events..." className="w-full bg-transparent outline-none text-sm text-[#E8E8F0] placeholder-[#4A4A6A]"/>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <select value={classificationFilter} onChange={e=>setClassificationFilter(e.target.value)} className={`flex-1 min-w-[120px] text-xs ${DK}`}><option value="">All types</option>{CLASSIFICATIONS.map(c=><option key={c} value={c}>{c}</option>)}</select>
                {['','Imported','Manual'].map(s=>(<button key={s||'all'} onClick={()=>setSourceFilter(s)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition ${sourceFilter===s?'bg-[#A100FF] text-white':'bg-[#0D0D15] border border-[#2A2A3E] text-[#6B6B8A] hover:border-[#A100FF]'}`}>{s||'All'}</button>))}
              </div>
            </div>
          </div>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            {!filteredEvents.length&&<div className="text-center text-[#4A4A6A] text-xs font-bold py-8 border border-dashed border-[#2A2A3E] rounded-xl">No events yet. Add an event using the form or import from a BEO.</div>}
            {filteredEvents.map(entry=>{
              const bc=classBadgeColor(entry.classification);
              const isExpanded=expandedId===entry.id;
              const checklistLines=(entry.checklist||'').split('\n').filter(Boolean);
              const done=checklistLines.filter(l=>l.startsWith('☑')).length;
              const total=checklistLines.length;
              const totalHours=(entry.timeLogs||[]).reduce((s,l)=>s+(parseFloat(l.hours)||0),0);
              return(
                <div key={entry.id} className="bg-[#111119] rounded-xl border border-[#2A2A3E] hover:border-[#A100FF]/40 transition group border-l-4" style={{borderLeftColor:editingId===entry.id?'#A3E635':bc}}>
                  {/* Card header */}
                  <div className="p-4">
                    <p className="text-xs font-bold text-white mb-1.5">{entry.eventName}</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase" style={{background:`${bc}20`,color:bc}}>{entry.classification||'TBD'}</span>
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-[#0D0D15] text-[#6B6B8A]">{entry.sessionType||'Session'}</span>
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-[#0D0D15] text-[#6B6B8A]">{entry.source||'Manual'}</span>
                      {entry.riskLevel&&<span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase" style={{background:`${getRiskColor(entry.riskLevel)}20`,color:getRiskColor(entry.riskLevel)}}>{entry.riskLevel} Risk</span>}
                      {entry.eventStatus&&entry.eventStatus!=='Not Started'&&<span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase" style={{background:entry.eventStatus==='Wrapped'?'#22C55E20':'#A100FF20',color:entry.eventStatus==='Wrapped'?'#22C55E':'#A100FF'}}>{entry.eventStatus}</span>}
                    </div>
                    <div className="space-y-0.5 text-[10px] text-[#6B6B8A]">
                      <p className="flex items-center gap-1"><CalendarDays size={9}/>{entry.startDate||'—'}{entry.endDate?` → ${entry.endDate}`:''}</p>
                      <p className="flex items-center gap-1"><MapPin size={9}/>{entry.location||'NYIH'} • {entry.eventLocation||'No room'}</p>
                      <p className="flex items-center gap-1"><User size={9}/>{entry.eventPoc||'No POC'} | SELECT: {entry.selectPoc||'TBD'}</p>
                    </div>
                    {(entry.demo||entry.selectResources)&&<p className="text-[10px] text-[#A100FF] mt-1.5 line-clamp-1">Equipment: {entry.demo||entry.selectResources||'—'}</p>}
                    {total>0&&(
                      <div className="mt-2">
                        <div className="flex justify-between text-[9px] font-bold mb-0.5">
                          <span className="text-[#A100FF]">Checklist</span>
                          <span className={done===total?'text-[#22C55E]':'text-[#6B6B8A]'}>{done}/{total}</span>
                        </div>
                        <div className="h-1 bg-[#0D0D15] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width:`${total?(done/total)*100:0}%`,background:done===total?'#22C55E':'#A100FF'}}/></div>
                      </div>
                    )}
                    {totalHours>0&&<p className="text-[10px] text-[#22C55E] mt-1.5 flex items-center gap-1 font-bold"><Timer size={9}/>{totalHours.toFixed(1)}h total logged</p>}
                    <div className="flex gap-3 mt-2.5">
                      <button onClick={()=>setExpandedId(isExpanded?null:entry.id)} className="text-[10px] text-[#A100FF] font-bold uppercase flex items-center gap-1 hover:text-[#B733FF] transition">{isExpanded?<ChevronUp size={10}/>:<ChevronDown size={10}/>}{isExpanded?'Less':'Details'}</button>
                      <button onClick={()=>startEdit(entry)} className="text-[10px] text-[#6B6B8A] font-bold uppercase flex items-center gap-1 hover:text-white transition"><Edit3 size={10}/> Edit</button>
                      <button onClick={()=>duplicateEvent(entry)} className="text-[10px] text-[#6B6B8A] font-bold uppercase flex items-center gap-1 hover:text-white transition"><Copy size={10}/> Dup</button>
                      <button onClick={async()=>{if(window.confirm('Delete this event?')){await deleteDoc(doc(db,'artifacts',appId,'public','data','shared_events',entry.id));showMsg('Event deleted.');}}} className="text-[10px] text-[#6B6B8A] font-bold uppercase flex items-center gap-1 hover:text-red-400 transition"><Trash2 size={10}/> Del</button>
                    </div>
                  </div>
                  {/* Expanded panel */}
                  {isExpanded&&(
                    <div className="border-t border-[#2A2A3E] p-4 space-y-4 anim-in bg-[#0D0D15] rounded-b-xl">
                      {entry.runOfShow&&(
                        <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#6B6B8A] mb-1">Run of Show</p><p className="text-xs text-[#9B9BB0]">{entry.runOfShow}</p></div>
                      )}
                      {entry.notes&&(
                        <div><p className="text-[9px] font-bold uppercase tracking-wider text-[#6B6B8A] mb-1">Notes</p><p className="text-xs text-[#9B9BB0]">{entry.notes}</p></div>
                      )}
                      {/* Editable checklist */}
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-[#A100FF] mb-2 flex items-center gap-1"><CheckSquare size={10}/>Event Checklist</p>
                        <ChecklistEditor
                          value={entry.checklist||buildDefaultChecklist(entry)}
                          onChange={async(newVal)=>{ await updateDoc(doc(db,'artifacts',appId,'public','data','shared_events',entry.id),{checklist:newVal}); }}
                        />
                      </div>
                      {/* Post-event notes */}
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-[#6B6B8A] mb-1 flex items-center gap-1"><PenLine size={10}/>Post-Event Notes {entry.eventStatus==='Wrapped'&&<span className="text-[#A100FF] ml-1">← Add debrief</span>}</p>
                        <textarea
                          defaultValue={entry.postEventNotes||''}
                          onBlur={async(e)=>{ await updateDoc(doc(db,'artifacts',appId,'public','data','shared_events',entry.id),{postEventNotes:e.target.value}); showMsg('Notes saved.'); }}
                          placeholder="What happened? Any issues, lessons learned, or follow-ups for the team..."
                          rows="3" className={`w-full resize-none text-xs ${DK}`}/>
                      </div>
                      {/* Time logs for this event */}
                      {(entry.timeLogs||[]).length>0&&(
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-[#6B6B8A] mb-1 flex items-center gap-1"><Timer size={10}/>Time Logged</p>
                          <div className="space-y-1">
                            {(entry.timeLogs||[]).map((log,i)=>(
                              <div key={i} className="flex items-center gap-2 text-[10px] text-[#9B9BB0]">
                                <span className="text-[#22C55E] font-bold">{log.hours}h</span>
                                <span className="text-[#6B6B8A]">{log.user}</span>
                                {log.note&&<span>— {log.note}</span>}
                                <span className="text-[#4A4A6A] ml-auto">{log.date}</span>
                              </div>
                            ))}
                            <div className="text-[10px] font-bold text-[#A100FF] pt-1 border-t border-[#2A2A3E]">Total: {totalHours.toFixed(1)}h</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
// ── Issues Page ──
function IssuesPage({issues,showMsg,fetchGemini,setModal,currentUser}){
  const[aiLoading,setAiLoading]=useState(false);
  const[resolvingId,setResolvingId]=useState(null);
  const[resolutionNote,setResolutionNote]=useState('');
  const[searchResolved,setSearchResolved]=useState('');
  const[showResolved,setShowResolved]=useState(false);

  const handleAdd=async(e)=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const d={title:fd.get('title'),device:fd.get('device'),location:fd.get('location'),urgency:fd.get('urgency')||'Normal',status:'Open',reporter:fd.get('reporter')||'',notes:fd.get('notes')||'',resolutionNotes:'',timestamp:new Date().toISOString()};
    if(!d.title){showMsg('Title required.',true);return;}
    try{
      await addDoc(col('shared_issues'),d);
      await logActivity(`${currentUser} logged issue "${d.title}" (${d.urgency})`,currentUser);
      if(d.urgency==='Urgent') await sendSlackAlert(`🚨 *Urgent issue:* ${d.title} | Device: ${d.device||'N/A'} | Location: ${d.location||'N/A'}`);
      e.target.reset();showMsg('Issue logged.');
    }catch{showMsg('Save failed.',true);}
  };

  const updateStatus=async(id,status,title)=>{
    if(status==='Resolved'){setResolvingId(id);setResolutionNote('');return;}
    await updateDoc(doc(db,'artifacts',appId,'public','data','shared_issues',id),{status});
    await logActivity(`${currentUser} marked issue "${title}" as ${status}`,currentUser);
    showMsg(`Marked ${status}.`);
  };

  const commitResolve=async(id,title)=>{
    await updateDoc(doc(db,'artifacts',appId,'public','data','shared_issues',id),{status:'Resolved',resolutionNotes:resolutionNote,resolvedAt:new Date().toISOString(),resolvedBy:currentUser});
    await logActivity(`${currentUser} resolved "${title}" — ${resolutionNote||'no notes'}`,currentUser);
    setResolvingId(null);setResolutionNote('');showMsg('Issue resolved.');
  };

  const del=async(id)=>{if(window.confirm('Delete this issue?')){await deleteDoc(doc(db,'artifacts',appId,'public','data','shared_issues',id));showMsg('Deleted.');}};
  const aiSuggest=async(issue)=>{
    setAiLoading(true);
    const result=await fetchGemini('You are a senior IT/AV support engineer at Accenture NYIH. Provide a SHORT (3-5 bullets) troubleshooting plan.',`Title: ${issue.title}\nDevice: ${issue.device}\nLocation: ${issue.location}\nNotes: ${issue.notes}`);
    setAiLoading(false);
    if(!result||(typeof result==='string'&&result.startsWith('AI Error:'))){showMsg(result||'AI error.',true);return;}
    setModal({title:`AI Fix: ${issue.title}`,content:result,actionLabel:'Copy',action:()=>{navigator.clipboard.writeText(result);showMsg('Copied.');}});
  };

  const urgencyColor=(u)=>u==='Urgent'?'#EF4444':u==='High'?'#F59E0B':u==='Low'?'#22C55E':'#6B6B8A';
  const statusColor=(s)=>s==='Open'?'#EF4444':s==='In Progress'?'#F59E0B':s==='Resolved'?'#22C55E':'#6B6B8A';

  const activeIssues=issues.filter(i=>i.status!=='Resolved');
  const resolvedIssues=issues.filter(i=>i.status==='Resolved').filter(i=>!searchResolved||((i.title+' '+(i.resolutionNotes||'')+' '+(i.device||'')).toLowerCase().includes(searchResolved.toLowerCase())));

  const renderIssue=(i)=>(
    <div key={i.id} className="bg-[#0D0D15] border border-[#2A2A3E] rounded-xl p-4 border-l-4" style={{borderLeftColor:urgencyColor(i.urgency)}}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1">
          <p className="text-sm font-bold text-white">{i.title}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{background:`${urgencyColor(i.urgency)}20`,color:urgencyColor(i.urgency)}}>{i.urgency||'Normal'}</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{background:`${statusColor(i.status)}20`,color:statusColor(i.status)}}>{i.status||'Open'}</span>
            {i.device&&<span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[#1A1A2E] text-[#6B6B8A]">{i.device}</span>}
            {i.location&&<span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[#1A1A2E] text-[#6B6B8A]">{i.location}</span>}
          </div>
        </div>
        <button onClick={()=>del(i.id)} className="text-[#2A2A3E] hover:text-red-400 transition"><Trash2 size={14}/></button>
      </div>
      {i.notes&&<p className="text-xs text-[#6B6B8A] mt-2">{i.notes}</p>}
      {i.reporter&&<p className="text-[10px] text-[#4A4A6A] mt-1">Reported by: {i.reporter}</p>}
      {i.resolutionNotes&&(
        <div className="mt-2 bg-[#22C55E]/5 border border-[#22C55E]/20 rounded-lg p-2">
          <p className="text-[9px] font-bold text-[#22C55E] uppercase tracking-wider mb-0.5">Resolution</p>
          <p className="text-[10px] text-[#9B9BB0]">{i.resolutionNotes}</p>
          {i.resolvedBy&&<p className="text-[9px] text-[#4A4A6A] mt-0.5">by {i.resolvedBy}{i.resolvedAt?` at ${new Date(i.resolvedAt).toLocaleString()}`:''}</p>}
        </div>
      )}
      {resolvingId===i.id&&(
        <div className="mt-3 bg-[#1A1A2E] border border-[#22C55E]/30 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-bold text-[#22C55E] uppercase">What fixed it?</p>
          <textarea value={resolutionNote} onChange={e=>setResolutionNote(e.target.value)} placeholder="Describe the fix so the team knows for next time..." rows="2" className={`w-full resize-none text-xs ${DK}`}/>
          <div className="flex gap-2">
            <button onClick={()=>commitResolve(i.id,i.title)} className="flex-1 bg-[#22C55E] text-white text-[10px] font-bold py-1.5 rounded-lg uppercase hover:bg-[#16A34A] transition">Mark Resolved</button>
            <button onClick={()=>setResolvingId(null)} className="px-4 bg-[#0D0D15] text-[#6B6B8A] text-[10px] font-bold py-1.5 rounded-lg uppercase">Cancel</button>
          </div>
        </div>
      )}
      {resolvingId!==i.id&&(
        <div className="flex flex-wrap gap-2 mt-3">
          {i.status!=='In Progress'&&<button onClick={()=>updateStatus(i.id,'In Progress',i.title)} className="text-[10px] bg-[#1A1A2E] text-[#F59E0B] font-bold px-3 py-1.5 rounded-lg uppercase hover:bg-[#2A2A3E] transition">Mark In Progress</button>}
          {i.status!=='Resolved'&&<button onClick={()=>updateStatus(i.id,'Resolved',i.title)} className="text-[10px] bg-[#1A1A2E] text-[#22C55E] font-bold px-3 py-1.5 rounded-lg uppercase hover:bg-[#2A2A3E] transition">Mark Resolved</button>}
          <button onClick={()=>aiSuggest(i)} disabled={aiLoading} className="text-[10px] bg-[#A100FF]/10 text-[#A100FF] font-bold px-3 py-1.5 rounded-lg uppercase hover:bg-[#A100FF]/20 transition flex items-center gap-1 disabled:opacity-50"><Zap size={10}/>{aiLoading?'Thinking...':'AI Suggest Fix'}</button>
        </div>
      )}
    </div>
  );

  return(
    <div className="anim-in space-y-5">
      <form onSubmit={handleAdd} className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-3"><BrainCircuit size={16} className="text-[#A100FF]"/> Log Tech Issue</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <input name="title" placeholder="Issue title *" required className={DK}/>
          <input name="device" placeholder="Device" className={DK}/>
          <input name="location" placeholder="Location / Room" className={DK}/>
          <select name="urgency" className={DK}><option value="Normal">Normal</option><option value="Low">Low</option><option value="High">High</option><option value="Urgent">Urgent</option></select>
          <input name="reporter" placeholder="Reporter (optional)" className={DK}/>
        </div>
        <textarea name="notes" placeholder="Notes / symptoms..." rows="2" className={`w-full mt-3 resize-none ${DK}`}/>
        <button type="submit" className="mt-3 bg-[#A100FF] text-white font-bold py-3 px-6 rounded-xl text-xs uppercase hover:bg-[#B733FF] transition">Log Issue</button>
      </form>

      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2"><AlertCircle size={16} className="text-[#A100FF]"/> Active Issues ({activeIssues.length})</h2>
        {!activeIssues.length&&<div className="text-center text-[#4A4A6A] text-xs font-bold py-8 border border-dashed border-[#2A2A3E] rounded-xl">No open issues. Great shape!</div>}
        <div className="space-y-3">{activeIssues.map(renderIssue)}</div>
      </div>

      {/* Resolved / resolution library */}
      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-base font-bold text-white flex items-center gap-2"><CheckCircle2 size={16} className="text-[#22C55E]"/> Resolution Library ({issues.filter(i=>i.status==='Resolved').length})</h2>
          <button onClick={()=>setShowResolved(!showResolved)} className="text-[10px] text-[#6B6B8A] font-bold uppercase hover:text-white transition">{showResolved?'Hide':'Show'}</button>
        </div>
        {showResolved&&(
          <>
            <div className="flex items-center gap-2 rounded-xl bg-[#0D0D15] border border-[#2A2A3E] p-2.5 focus-within:border-[#A100FF] transition mb-3">
              <Search size={13} className="text-[#4A4A6A]"/>
              <input value={searchResolved} onChange={e=>setSearchResolved(e.target.value)} placeholder="Search resolved issues and fixes..." className="w-full bg-transparent outline-none text-sm text-[#E8E8F0] placeholder-[#4A4A6A]"/>
            </div>
            {!resolvedIssues.length&&<div className="text-center text-[#4A4A6A] text-xs font-bold py-4">No resolved issues{searchResolved?' matching your search':''}.</div>}
            <div className="space-y-3">{resolvedIssues.slice(0,10).map(renderIssue)}</div>
          </>
        )}
        {!showResolved&&<p className="text-[11px] text-[#6B6B8A]">Expand to search past resolutions — find out what fixed a device issue last time.</p>}
      </div>
    </div>
  );
}

// ── Export Page ──
function ExportPage({events,tasks,issues,showMsg,fetchGemini,setModal,currentUser}){
  const[month,setMonth]=useState(new Date().toISOString().slice(0,7));
  const[exporting,setExporting]=useState(false);
  const[aiExporting,setAiExporting]=useState(false);

  const filteredEvents=events.filter(e=>(e.startDate||'').slice(0,7)===month);
  const completedTasks=tasks.filter(t=>{const s=String(t.status||'').toLowerCase();return(s==='complete'||s==='done'||s==='completed')&&((t.dueDate||t.timestamp||'').slice(0,7)===month);});
  const totalHours=filteredEvents.reduce((s,e)=>s+(e.timeLogs||[]).reduce((a,l)=>a+(parseFloat(l.hours)||0),0),0)+tasks.reduce((s,t)=>s+(t.timeLogs||[]).reduce((a,l)=>a+(parseFloat(l.hours)||0),0),0);

  const handleExport=async()=>{
    setExporting(true);
    try{ await exportToExcel(events,tasks,issues,month);showMsg(`Exported ${month} data to Excel.`); }
    catch(err){showMsg(`Export failed: ${err.message}`,true);}
    setExporting(false);
  };

  const generateLeadReport=async()=>{
    setAiExporting(true);
    const evtSummary=filteredEvents.map(e=>`- ${e.eventName} (${e.startDate?.slice(0,10)}, ${e.classification}, ${e.attendees||'?'} attendees, SELECT: ${e.selectPoc||'TBD'}, ${(e.timeLogs||[]).reduce((s,l)=>s+(parseFloat(l.hours)||0),0).toFixed(1)}h logged)`).join('\n');
    const taskSummary=completedTasks.map(t=>`- ${t.title} | ${t.assignee||'Unassigned'} | ${t.timeSpent||'?'}h`).join('\n');
    const issueSummary=issues.filter(i=>i.status==='Resolved'&&(i.resolvedAt||'').slice(0,7)===month).map(i=>`- ${i.title} (${i.device||'?'}) — fixed: ${i.resolutionNotes||'see notes'}`).join('\n');
    const result=await fetchGemini(
      `You are writing a monthly summary report for the Accenture NYIH SELECT technology team to send to leadership. Format it professionally with these sections: Executive Summary (2-3 sentences), Events Supported (brief table-style list), Completed Tasks, Technical Issues Resolved, Hours Logged (total), and Key Wins / Highlights. Keep it concise but data-rich. Month: ${month}. Team member reporting: ${currentUser}.`,
      `Events this month:\n${evtSummary||'None'}\n\nCompleted tasks:\n${taskSummary||'None'}\n\nResolved issues:\n${issueSummary||'None'}\n\nTotal hours logged: ${totalHours.toFixed(1)}h`
    );
    setAiExporting(false);
    if(!result||(typeof result==='string'&&result.startsWith('AI Error:'))){showMsg(result||'AI error.',true);return;}
    setModal({title:`Monthly Report — ${month}`,content:result,actionLabel:'Copy',action:()=>{navigator.clipboard.writeText(result);showMsg('Report copied to clipboard.');}});
  };

  return(
    <div className="anim-in space-y-5">
      <div className="grid md:grid-cols-3 gap-3">
        <StatCard icon={<CalendarDays size={16}/>} value={filteredEvents.length} label={`${month} Events`}/>
        <StatCard icon={<CheckCircle2 size={16}/>} value={completedTasks.length} label="Tasks Completed"/>
        <StatCard icon={<Timer size={16}/>} value={`${totalHours.toFixed(1)}h`} label="Hours Logged"/>
      </div>

      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4"><Download size={16} className="text-[#A100FF]"/> Data Export</h2>
        <div className="flex items-end gap-4 flex-wrap mb-5">
          <div className="text-[9px] font-bold text-[#6B6B8A] uppercase">Export Month
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)} className={`w-full mt-1 ${DK}`}/>
          </div>
          <button onClick={handleExport} disabled={exporting}
            className="bg-[#A3E635] text-[#0A0A0F] font-bold px-6 py-3 rounded-xl text-xs uppercase hover:bg-[#8CD02F] transition disabled:opacity-50 flex items-center gap-2">
            <Download size={13} className={exporting?'animate-bounce':''}/>{exporting?'Exporting...':'Export to Excel (.xlsx)'}
          </button>
        </div>
        <div className="bg-[#0D0D15] border border-[#2A2A3E] rounded-xl p-4 space-y-1 text-[11px] text-[#6B6B8A]">
          <p className="font-bold text-[#9B9BB0]">Export includes 3 sheets:</p>
          <p>• <span className="text-white">Events</span> — all fields: name, dates, room, equipment, classification, attendees, SELECT lead, status, notes, total hours</p>
          <p>• <span className="text-white">Completed Tasks</span> — task title, assignee, linked event, time spent</p>
          <p>• <span className="text-white">Time Logs</span> — every time entry by date, team member, event, and hours</p>
        </div>
      </div>

      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-2"><BrainCircuit size={16} className="text-[#A100FF]"/> AI Monthly Report</h2>
        <p className="text-[11px] text-[#6B6B8A] mb-4">Generate a formatted summary of the selected month — events, completed tasks, resolved issues, hours — ready to send to your lead.</p>
        <button onClick={generateLeadReport} disabled={aiExporting}
          className="bg-[#A100FF] text-white font-bold px-6 py-3 rounded-xl text-xs uppercase hover:bg-[#B733FF] transition disabled:opacity-50 flex items-center gap-2">
          <BrainCircuit size={13} className={aiExporting?'animate-spin':''}/>{aiExporting?'Generating...':'Generate Monthly Report'}
        </button>
      </div>
    </div>
  );
}
// ── Room Status ──
function RoomStatusPage({rooms,showMsg,currentUser}){
  const[editingId,setEditingId]=useState(null);
  const[form,setForm]=useState({title:'',owner:'',backupOwner:'',status:'Operational',devices:'',notes:''});
  const statusColor=(s)=>s==='Operational'?'#22C55E':s==='Monitor'?'#F59E0B':s==='Escalate'?'#EF4444':'#6B6B8A';
  const getInitials=(name='')=>String(name).split('.').map(p=>p[0]).join('').slice(0,2).toUpperCase();
  const resetForm=()=>{setEditingId(null);setForm({title:'',owner:'',backupOwner:'',status:'Operational',devices:'',notes:''});};
  const handleSave=async(e)=>{
    e.preventDefault();if(!form.title){showMsg('Room / device name required.',true);return;}
    const payload={...form,lastUpdated:new Date().toISOString(),updatedBy:auth.currentUser?.email||'unknown',timestamp:new Date().toISOString()};
    try{if(editingId){await updateDoc(doc(db,'artifacts',appId,'public','data','shared_rooms',editingId),payload);showMsg('Room updated.');}else{await addDoc(col('shared_rooms'),payload);showMsg('Room added.');}resetForm();}
    catch(err){console.error(err);showMsg('Room save failed.',true);}
  };
  const updateRoomStatus=async(room,status)=>{
    try{
      await updateDoc(doc(db,'artifacts',appId,'public','data','shared_rooms',room.id),{status,lastUpdated:new Date().toISOString(),updatedBy:auth.currentUser?.email||'unknown'});
      await logActivity(`${currentUser} set ${room.title} to ${status}`,currentUser);
      if(status==='Escalate') await sendSlackAlert(`🔴 *Room escalated:* ${room.title} | Owner: ${room.owner||'N/A'} — check immediately.`);
      showMsg(`${room.title} marked ${status}.`);
    }catch(err){console.error(err);showMsg('Status update failed.',true);}
  };
  const editRoom=(room)=>{setEditingId(room.id);setForm({title:room.title||'',owner:room.owner||'',backupOwner:room.backupOwner||'',status:room.status||'Operational',devices:room.devices||'',notes:room.notes||''});window.scrollTo({top:0,behavior:'smooth'});};
  const deleteRoom=async(id)=>{if(!window.confirm('Delete this room/device?')) return;try{await deleteDoc(doc(db,'artifacts',appId,'public','data','shared_rooms',id));showMsg('Room deleted.');}catch(err){showMsg('Delete failed.',true);}};
  const seedDefaultRooms=async()=>{
    const defaults=[
      {title:'Vision Room',owner:'Donald.Salazar',backupOwner:'Eric.Guzman',status:'Operational',devices:'Cyviz, Vu',notes:'Primary experience room / client support'},
      {title:'Broadcast Cyviz',owner:'Donald.Salazar',backupOwner:'Eric.Guzman',status:'Operational',devices:'Cyviz, Vu, Broadcast',notes:'Broadcast-enabled Cyviz space'},
      {title:'65th Floor',owner:'Mistral.Rojas',backupOwner:'Eric.Guzman',status:'Operational',devices:'Cyviz, Audio, Video, Britelite',notes:'65th floor readiness'},
      {title:'CIC Space',owner:'Eric.Guzman',backupOwner:'Donald.Salazar',status:'Operational',devices:'Cyviz, Kiosk, Projection',notes:'CIC readiness and vendor coordination'},
      {title:'Proto',owner:'Eric.Guzman',backupOwner:'Donald.Salazar',status:'Operational',devices:'Proto hologram',notes:'Proto sessions and content readiness'},
      {title:'Hypervsn',owner:'Eric.Guzman',backupOwner:'Donald.Salazar',status:'Monitor',devices:'Hypervsn display',notes:'Monitor content and hardware status'},
      {title:'Surface Hubs',owner:'Travis.Alexander',backupOwner:'Eric.Guzman',status:'Monitor',devices:'Surface Hub fleet',notes:'Offline hubs / remediation tracking'},
      {title:'Alleo',owner:'Mistral.Rojas',backupOwner:'Donald.Salazar',status:'Operational',devices:'Alleo',notes:'Documentation and support readiness'},
      {title:'Ceco Ceco',owner:'Mistral.Rojas',backupOwner:'Donald.Salazar',status:'Operational',devices:'Ceco Ceco',notes:'Documentation and support readiness'},
    ];
    try{for(const room of defaults) await addDoc(col('shared_rooms'),{...room,lastUpdated:new Date().toISOString(),updatedBy:auth.currentUser?.email||'seed',timestamp:new Date().toISOString()});showMsg('Default room ownership loaded.');}
    catch(err){showMsg('Seed failed.',true);}
  };
  const stats=useMemo(()=>({total:rooms.length,operational:rooms.filter(r=>r.status==='Operational').length,monitor:rooms.filter(r=>r.status==='Monitor').length,escalate:rooms.filter(r=>r.status==='Escalate').length}),[rooms]);
  const ownershipRows=useMemo(()=>{const people={};rooms.forEach(room=>{const owner=room.owner||'Unassigned';if(!people[owner]) people[owner]={owner,primary:[],backup:[],monitor:0,escalate:0};people[owner].primary.push(room.title);if(room.status==='Monitor') people[owner].monitor+=1;if(room.status==='Escalate') people[owner].escalate+=1;if(room.backupOwner){if(!people[room.backupOwner]) people[room.backupOwner]={owner:room.backupOwner,primary:[],backup:[],monitor:0,escalate:0};people[room.backupOwner].backup.push(room.title);}});return Object.values(people);},[rooms]);
  return(
    <div className="anim-in space-y-5">
      <div className="grid md:grid-cols-4 gap-3">
        <StatCard icon={<Layout size={16}/>} value={stats.total} label="Rooms / Devices"/>
        <StatCard icon={<CheckCircle2 size={16}/>} value={stats.operational} label="Operational"/>
        <StatCard icon={<Clock size={16}/>} value={stats.monitor} label="Monitor"/>
        <StatCard icon={<AlertCircle size={16}/>} value={stats.escalate} label="Escalate"/>
      </div>
      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
          <div><h2 className="text-base font-bold text-white flex items-center gap-2"><Layout size={16} className="text-[#A100FF]"/>{editingId?'Edit Room / Device':'Add Room / Device'}</h2><p className="text-[11px] text-[#6B6B8A] mt-0.5">Track ownership, room health, backup coverage, and device notes.</p></div>
          {!rooms.length&&<button type="button" onClick={seedDefaultRooms} className="bg-[#A100FF] text-white px-4 py-2 rounded-lg text-[10px] font-bold uppercase hover:bg-[#B733FF] transition">Load Default Matrix</button>}
        </div>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid md:grid-cols-4 gap-3">
            <input value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="Room / Device name *" className={`md:col-span-2 ${DK}`} required/>
            <select value={form.owner} onChange={e=>setForm(p=>({...p,owner:e.target.value}))} className={DK}><option value="">Primary owner...</option>{TEAM_MEMBERS.map(m=><option key={m} value={m}>{m}</option>)}</select>
            <select value={form.backupOwner} onChange={e=>setForm(p=>({...p,backupOwner:e.target.value}))} className={DK}><option value="">Backup owner...</option>{TEAM_MEMBERS.map(m=><option key={m} value={m}>{m}</option>)}</select>
          </div>
          <div className="grid md:grid-cols-4 gap-3">
            <select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className={DK}><option value="Operational">Operational</option><option value="Monitor">Monitor</option><option value="Escalate">Escalate</option></select>
            <input value={form.devices} onChange={e=>setForm(p=>({...p,devices:e.target.value}))} placeholder="Devices / systems" className={`md:col-span-2 ${DK}`}/>
            <button type="submit" className={`font-bold py-3 rounded-xl text-xs uppercase transition ${editingId?'bg-[#A3E635] text-[#0A0A0F] hover:bg-[#8CD02F]':'bg-[#A100FF] text-white hover:bg-[#B733FF]'}`}>{editingId?'Update':'Add'}</button>
          </div>
          <textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="Notes / support details..." rows="2" className={`w-full resize-none ${DK}`}/>
          {editingId&&<button type="button" onClick={resetForm} className="bg-[#1A1A2E] text-[#6B6B8A] px-4 py-2 rounded-lg text-[10px] font-bold uppercase hover:text-white transition">Cancel Edit</button>}
        </form>
      </div>
      <div className="grid lg:grid-cols-[1.5fr,.9fr] gap-5">
        <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
          <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4"><MapPin size={16} className="text-[#A100FF]"/>Live Room Status</h2>
          {!rooms.length&&<div className="text-center text-[#4A4A6A] text-xs font-bold py-8 border border-dashed border-[#2A2A3E] rounded-xl">No rooms loaded yet. Use "Load Default Matrix" or add a room above.</div>}
          <div className="grid md:grid-cols-2 gap-4">
            {rooms.map(room=>{const color=statusColor(room.status);return(
              <div key={room.id} className="bg-[#0D0D15] rounded-2xl border border-[#2A2A3E] p-4 border-l-4 hover:border-[#A100FF]/50 transition group" style={{borderLeftColor:color}}>
                <div className="flex justify-between items-start mb-3">
                  <div><h3 className="text-sm font-black text-white">{room.title}</h3><p className="text-[10px] text-[#6B6B8A] mt-1">Owner: <span className="text-[#C0C0D8] font-bold">{room.owner||'Unassigned'}</span></p><p className="text-[10px] text-[#6B6B8A]">Backup: <span className="text-[#C0C0D8] font-bold">{room.backupOwner||'None'}</span></p></div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={()=>editRoom(room)} className="p-1.5 rounded-lg bg-[#1A1A2E] text-[#A100FF] hover:bg-[#2A2A3E]"><Edit3 size={12}/></button>
                    <button onClick={()=>deleteRoom(room.id)} className="p-1.5 rounded-lg bg-[#1A1A2E] text-red-400 hover:bg-[#2A2A3E]"><Trash2 size={12}/></button>
                  </div>
                </div>
                {room.devices&&<p className="text-[10px] text-[#A100FF] mb-2 line-clamp-1">Devices: {room.devices}</p>}
                {room.notes&&<p className="text-[10px] text-[#6B6B8A] mb-3 line-clamp-2">{room.notes}</p>}
                <div className="grid grid-cols-3 gap-2">
                  {['Operational','Monitor','Escalate'].map(s=>{const active=room.status===s;return(<button key={s} onClick={()=>updateRoomStatus(room,s)} className="py-2 rounded-lg text-[10px] font-bold uppercase transition border" style={{background:active?statusColor(s):'#111119',borderColor:active?statusColor(s):'#2A2A3E',color:active?'#FFFFFF':'#8A8AA3'}}>{s}</button>);})}</div>
                {room.lastUpdated&&<p className="text-[9px] text-[#4A4A6A] mt-3">Updated: {new Date(room.lastUpdated).toLocaleString()}</p>}
              </div>
            );})}
          </div>
        </div>
        <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
          <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4"><Users size={16} className="text-[#A100FF]"/>Ownership Matrix</h2>
          {!ownershipRows.length&&<div className="text-center text-[#4A4A6A] text-xs font-bold py-8 border border-dashed border-[#2A2A3E] rounded-xl">Ownership matrix will appear after rooms are added.</div>}
          <div className="space-y-3">
            {ownershipRows.map(row=>(
              <div key={row.owner} className="bg-[#0D0D15] border border-[#2A2A3E] rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-[#A100FF]/20 text-[#A100FF] flex items-center justify-center text-[10px] font-black">{getInitials(row.owner)}</div><div><p className="text-xs font-bold text-white">{row.owner}</p><p className="text-[9px] text-[#6B6B8A]">Primary: {row.primary.length} • Backup: {row.backup.length}</p></div></div>
                {!!row.primary.length&&(<div className="mb-2"><p className="text-[9px] font-bold uppercase tracking-wider text-[#A100FF] mb-1">Primary</p><div className="flex flex-wrap gap-1">{row.primary.map(item=><span key={item} className="px-2 py-1 rounded bg-[#1A1A2E] text-[#C0C0D8] text-[9px] font-bold">{item}</span>)}</div></div>)}
                {!!row.backup.length&&(<div><p className="text-[9px] font-bold uppercase tracking-wider text-[#6B6B8A] mb-1">Backup</p><div className="flex flex-wrap gap-1">{row.backup.map(item=><span key={item} className="px-2 py-1 rounded bg-[#111119] border border-[#2A2A3E] text-[#6B6B8A] text-[9px] font-bold">{item}</span>)}</div></div>)}
                {(row.monitor>0||row.escalate>0)&&(<div className="mt-3 flex gap-2">{row.monitor>0&&<span className="text-[9px] font-bold px-2 py-1 rounded bg-[#F59E0B]/10 text-[#F59E0B]">{row.monitor} Monitor</span>}{row.escalate>0&&<span className="text-[9px] font-bold px-2 py-1 rounded bg-[#EF4444]/10 text-[#EF4444]">{row.escalate} Escalate</span>}</div>)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Activity Feed ──
function ActivityFeedPage({activity}){
  return(
    <div className="anim-in">
      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4"><Activity size={16} className="text-[#A100FF]"/> Team Activity Feed</h2>
        {!activity.length&&<div className="text-center text-[#4A4A6A] text-xs font-bold py-10 border border-dashed border-[#2A2A3E] rounded-xl">No activity yet. Actions across the app appear here in real time.</div>}
        <div className="space-y-1">
          {activity.map((a,idx)=>(
            <div key={a.id||idx} className="flex items-start gap-3 py-2.5 border-b border-[#1A1A2E] last:border-0">
              <div className="w-7 h-7 rounded-lg bg-[#A100FF]/10 flex items-center justify-center flex-shrink-0 mt-0.5"><Activity size={12} className="text-[#A100FF]"/></div>
              <div className="flex-1 min-w-0"><p className="text-xs text-[#C0C0D8] leading-snug">{a.message}</p><p className="text-[10px] text-[#4A4A6A] mt-0.5">{a.timestamp?new Date(a.timestamp).toLocaleString():''}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Analytics ──
function AnalyticsDashboard({events,tasks,issues}){
  const stats=useMemo(()=>{
    const byClass={};const bySession={};const byRoom={};
    events.forEach(e=>{const c=e.classification||'TBD';const t=e.sessionType||'Other';const r=e.eventLocation||'Unknown';byClass[c]=(byClass[c]||0)+1;bySession[t]=(bySession[t]||0)+1;byRoom[r]=(byRoom[r]||0)+1;});
    const norm=(t)=>{const s=String(t.status||'todo').toLowerCase().replace(/[\s-_]+/g,'');const map={todo:'todo',backlog:'todo','':  'todo',doing:'doing',active:'doing',inprogress:'doing',complete:'complete',done:'complete',completed:'complete'};return map[s]||s;};
    const taskByStatus={todo:tasks.filter(t=>norm(t)==='todo').length,doing:tasks.filter(t=>norm(t)==='doing').length,complete:tasks.filter(t=>norm(t)==='complete').length};
    const knownEquipment=['Proto','Cyviz','Surface Hub','Vu AI','Spot','Hypervsn','Signage','MTR / VC','Audio','Loaner Laptop'];
    const equipmentIssueMap={};
    knownEquipment.forEach(eq=>{const count=issues.filter(i=>(i.title+' '+(i.notes||'')+' '+(i.device||'')).toLowerCase().includes(eq.toLowerCase().split(' ')[0])).length;if(count>0) equipmentIssueMap[eq]=count;});
    const totalHoursAllTime=events.reduce((s,e)=>s+(e.timeLogs||[]).reduce((a,l)=>a+(parseFloat(l.hours)||0),0),0)+tasks.reduce((s,t)=>s+(t.timeLogs||[]).reduce((a,l)=>a+(parseFloat(l.hours)||0),0),0);
    return{byClass,bySession,byRoom,taskByStatus,equipmentIssueMap,highRiskEvents:events.filter(e=>e.riskLevel==='High').length,autoPlannedEvents:events.filter(e=>e.automationSummary).length,autoGeneratedTasks:tasks.filter(t=>t.source==='Auto-generated').length,totalHoursAllTime};
  },[events,tasks,issues]);
  const Bar=({label,value,max,color})=>(<div className="mb-2"><div className="flex justify-between text-[10px] font-bold text-[#9B9BB0] mb-1"><span>{label}</span><span style={{color}}>{value}</span></div><div className="h-2 bg-[#0D0D15] rounded-full overflow-hidden"><div className="h-full rounded-full transition-all" style={{width:`${max?(value/max)*100:0}%`,background:color}}/></div></div>);
  const sortedClass=Object.entries(stats.byClass).sort((a,b)=>b[1]-a[1]);
  const sortedSession=Object.entries(stats.bySession).sort((a,b)=>b[1]-a[1]);
  const sortedRoom=Object.entries(stats.byRoom).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const sortedEquip=Object.entries(stats.equipmentIssueMap).sort((a,b)=>b[1]-a[1]);
  const maxClass=Math.max(...Object.values(stats.byClass),1);const maxSession=Math.max(...Object.values(stats.bySession),1);const maxRoom=Math.max(...Object.values(stats.byRoom),1);const maxEquip=Math.max(...Object.values(stats.equipmentIssueMap),1);
  return(
    <div className="anim-in space-y-5">
      <div className="grid md:grid-cols-4 gap-3">
        <StatCard icon={<ClipboardList size={16}/>} value={events.length} label="Total Events"/>
        <StatCard icon={<TrendingUp size={16}/>} value={stats.autoGeneratedTasks} label="Auto Tasks"/>
        <StatCard icon={<AlertCircle size={16}/>} value={stats.highRiskEvents} label="High Risk"/>
        <StatCard icon={<Timer size={16}/>} value={`${stats.totalHoursAllTime.toFixed(0)}h`} label="Total Hours Logged"/>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5"><h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4"><PieIcon size={14} className="text-[#A100FF]"/> By Classification</h2>{sortedClass.length?sortedClass.map(([k,v])=><Bar key={k} label={k} value={v} max={maxClass} color={classBadgeColor(k)}/>):<p className="text-xs text-[#4A4A6A] text-center py-4">No data yet.</p>}</div>
        <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5"><h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4"><BarChart3 size={14} className="text-[#A100FF]"/> By Session Type</h2>{sortedSession.length?sortedSession.map(([k,v])=><Bar key={k} label={k} value={v} max={maxSession} color="#A100FF"/>):<p className="text-xs text-[#4A4A6A] text-center py-4">No data yet.</p>}</div>
        <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5"><h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4"><MapPin size={14} className="text-[#A100FF]"/> Top Rooms</h2>{sortedRoom.length?sortedRoom.map(([k,v])=><Bar key={k} label={k} value={v} max={maxRoom} color="#A3E635"/>):<p className="text-xs text-[#4A4A6A] text-center py-4">No data yet.</p>}</div>
        <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5"><h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4"><Layout size={14} className="text-[#A100FF]"/> Task Pipeline</h2><div className="grid grid-cols-3 gap-3 text-center"><div className="bg-[#0D0D15] rounded-xl p-4 border border-[#2A2A3E]"><div className="text-2xl font-black text-[#6B6B8A]">{stats.taskByStatus.todo}</div><div className="text-[9px] font-bold text-[#6B6B8A] uppercase tracking-wider mt-1">To Do</div></div><div className="bg-[#0D0D15] rounded-xl p-4 border border-[#2A2A3E]"><div className="text-2xl font-black text-[#F59E0B]">{stats.taskByStatus.doing}</div><div className="text-[9px] font-bold text-[#F59E0B] uppercase tracking-wider mt-1">Doing</div></div><div className="bg-[#0D0D15] rounded-xl p-4 border border-[#2A2A3E]"><div className="text-2xl font-black text-[#22C55E]">{stats.taskByStatus.complete}</div><div className="text-[9px] font-bold text-[#22C55E] uppercase tracking-wider mt-1">Complete</div></div></div><p className="text-[10px] text-[#4A4A6A] text-center mt-4">{tasks.length?`${Math.round((stats.taskByStatus.complete/tasks.length)*100)}% complete`:'No tasks yet'}</p></div>
        <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5 md:col-span-2"><h2 className="text-sm font-bold text-white flex items-center gap-2 mb-1"><AlertCircle size={14} className="text-[#EF4444]"/> Equipment Failure Frequency</h2><p className="text-[10px] text-[#6B6B8A] mb-4">Issues cross-referenced with known equipment — identify chronic hardware problems.</p>{sortedEquip.length?(<div className="grid md:grid-cols-2 gap-x-8">{sortedEquip.map(([k,v])=><Bar key={k} label={k} value={v} max={maxEquip} color={v>=3?'#EF4444':v>=2?'#F59E0B':'#6B6B8A'}/>)}</div>):<p className="text-xs text-[#4A4A6A] text-center py-4">No equipment issues logged yet.</p>}</div>
      </div>
    </div>
  );
}
// ── Root App ──
export default function App(){
  const[user,setUser]=useState(null);
  const[loading,setLoading]=useState(true);
  const[currentPage,setCurrentPage]=useState('today');
  const[message,setMessage]=useState({text:'',isError:false});
  const[modal,setModal]=useState(null);
  const[isBriefingLoading,setIsBriefingLoading]=useState(false);
  const[events,setEvents]=useState([]);
  const[tasks,setTasks]=useState([]);
  const[issues,setIssues]=useState([]);
  const[rooms,setRooms]=useState([]);
  const[activity,setActivity]=useState([]);
  const[handoffNotes,setHandoffNotes]=useState(null);
  const[navOpen,setNavOpen]=useState(false);

  useEffect(()=>{
    if(!firebaseConfig.apiKey){setLoading(false);return;}
    (async()=>{try{if(typeof __initial_auth_token!=='undefined'&&__initial_auth_token) await signInWithCustomToken(auth,__initial_auth_token);}catch(err){console.error('Auth init:',err);}})();
    return onAuthStateChanged(auth,u=>{setUser(u);setLoading(false);});
  },[]);

  useEffect(()=>{
    if(!user||!firebaseConfig.apiKey) return;
    const u1=onSnapshot(query(col('shared_events'),orderBy('timestamp','desc')),s=>setEvents(s.docs.map(d=>({id:d.id,...d.data()}))));
    const u2=onSnapshot(query(col('shared_tasks'),orderBy('timestamp','desc')),s=>setTasks(s.docs.map(d=>({id:d.id,...d.data()}))));
    const u3=onSnapshot(query(col('shared_issues'),orderBy('timestamp','desc')),s=>setIssues(s.docs.map(d=>({id:d.id,...d.data()}))));
    const u4=onSnapshot(query(col('shared_rooms'),orderBy('timestamp','desc')),s=>setRooms(s.docs.map(d=>({id:d.id,...d.data()}))));
    const u5=onSnapshot(query(col('shared_activity'),orderBy('timestamp','desc')),s=>setActivity(s.docs.slice(0,60).map(d=>({id:d.id,...d.data()}))));
    const todayStr=getTodayStr();
    const u6=onSnapshot(doc(db,'artifacts',appId,'public','data','shared_handoff',todayStr),s=>setHandoffNotes(s.exists()?s.data():null));
    return()=>{u1();u2();u3();u4();u5();u6();};
  },[user]);

  const showMsg=(text,isError=false)=>{setMessage({text,isError});setTimeout(()=>setMessage({text:'',isError:false}),5000);};

  const fetchGemini=async(sys,usr='',json=false)=>{
    if(!GEMINI_API_KEY) return json?{}:'AI Error: Missing REACT_APP_GEMINI_API_KEY in Vercel env vars.';
    try{
      const prompt=usr?`${sys}\n\n---USER DATA---\n${sanitizeForPrompt(usr)}\n---END---`:sys;
      const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
      const body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.1,maxOutputTokens:8192,topP:0.95,topK:40,...(json?{responseMimeType:'application/json'}:{})}};
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!r.ok){const errText=await r.text();throw new Error(`Gemini ${r.status}: ${errText.slice(0,200)}`);}
      const d=await r.json();if(d.error) throw new Error(d.error.message);
      const t=d.candidates?.[0]?.content?.parts?.[0]?.text;
      return json?safeParseJson(t):t;
    }catch(e){console.error('[Gemini] Error:',e);return json?{}:`AI Error: ${e.message}`;}
  };

  const generateLeadBriefing=async()=>{
    setIsBriefingLoading(true);
    const upcomingEvents=events.filter(e=>e.startDate).sort((a,b)=>a.startDate.localeCompare(b.startDate)).slice(0,5);
    const highRisk=events.filter(e=>e.riskLevel==='High').map(e=>e.eventName);
    const urgentIssues=issues.filter(i=>i.urgency==='Urgent'||i.status==='Open').map(i=>i.title);
    const tasksDoing=tasks.filter(t=>String(t.status||'').toLowerCase().includes('doing')).length;
    const totalHours=events.reduce((s,e)=>s+(e.timeLogs||[]).reduce((a,l)=>a+(parseFloat(l.hours)||0),0),0)+tasks.reduce((s,t)=>s+(t.timeLogs||[]).reduce((a,l)=>a+(parseFloat(l.hours)||0),0),0);
    const contextData=[
      `Upcoming events: ${upcomingEvents.map(e=>`${e.eventName} (${e.startDate?.slice(0,10)}, ${e.classification})`).join('; ')||'None'}`,
      `High-risk events: ${highRisk.join(', ')||'None'}`,
      `Open/urgent issues: ${urgentIssues.join(', ')||'None'}`,
      `Tasks: ${tasksDoing} in progress out of ${tasks.length} total`,
      `Total hours logged: ${totalHours.toFixed(1)}h`,
    ].join('\n');
    const briefing=await fetchGemini('Act as an Accenture SELECT team lead. Provide exactly THREE concise bullet points for a leadership status update. Cover: upcoming events & readiness, any risks or blockers, and task/team status. Be specific and data-driven.',contextData);
    setModal({title:'Leadership Brief',content:briefing,actionLabel:'Copy',action:()=>{navigator.clipboard.writeText(briefing);showMsg('Copied.');}});
    setIsBriefingLoading(false);
  };

  const currentUser=user?.email||'Unknown';
  const navItems=[
    {key:'today',label:'Today',icon:<SunMedium size={13}/>},
    {key:'schedule',label:'Events',icon:<Calendar size={13}/>},
    {key:'calendar',label:'Calendar',icon:<CalendarDays size={13}/>},
    {key:'kanban',label:'Tasks',icon:<Layout size={13}/>},
    {key:'issues',label:'Tech Feed',icon:<BrainCircuit size={13}/>},
    {key:'rooms',label:'Rooms',icon:<MapPin size={13}/>},
    {key:'export',label:'Export',icon:<Download size={13}/>},
    {key:'activity',label:'Activity',icon:<Activity size={13}/>},
    {key:'analytics',label:'Insights',icon:<BarChart3 size={13}/>},
  ];

  if(loading) return(<div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0F]"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-[#A100FF]"/><p className="mt-4 text-[#6B6B8A] text-[10px] font-bold uppercase tracking-widest">Loading systems...</p></div>);
  if(!firebaseConfig.apiKey) return(<div className="min-h-screen flex items-center justify-center bg-[#0A0A0F] p-4"><div className="bg-[#111119] p-10 rounded-2xl border border-red-500/30 text-center max-w-md w-full"><AlertCircle size={40} className="mx-auto text-red-500 mb-4"/><h1 className="text-xl font-black text-white mb-4">Connection Error</h1><button onClick={()=>window.location.reload()} className="w-full bg-[#1A1A2E] text-[#E8E8F0] py-3 rounded-xl font-bold text-xs uppercase hover:bg-[#2A2A3E] transition">Retry</button></div></div>);
  if(!user) return <AuthPage showMsg={showMsg}/>;

  return(
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
        *{font-family:'Graphik','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
        body{background:#0A0A0F;margin:0;}
        ::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:#0A0A0F;}::-webkit-scrollbar-thumb{background:#2A2A3E;border-radius:3px;}::-webkit-scrollbar-thumb:hover{background:#A100FF;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
        .anim-in{animation:fadeIn .3s ease-out;}
      `}</style>
      <div className="min-h-screen bg-[#0A0A0F] p-3 md:p-6 flex flex-col items-center text-[#E8E8F0]">
        <div className="w-full max-w-7xl bg-[#111119] rounded-2xl border border-[#2A2A3E] p-4 mb-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h1 className="text-xl md:text-3xl font-black tracking-tight"><span className="text-[#A100FF]">SELECT</span> Hub</h1>
              <p className="text-[10px] text-[#6B6B8A] font-bold uppercase tracking-[.25em] mt-0.5">Powered by Accenture</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={generateLeadBriefing} disabled={isBriefingLoading} className="bg-[#A100FF] text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-[#B733FF] transition disabled:opacity-50 flex items-center gap-1.5"><Zap size={11} className={isBriefingLoading?'animate-spin':''}/>{isBriefingLoading?'Working...':'Lead Brief'}</button>
              <button onClick={()=>signOut(auth)} className="text-[#6B6B8A] hover:text-red-400 transition p-2 rounded-lg hover:bg-[#1A1A2E]"><LogOut size={16}/></button>
            </div>
          </div>
          {/* Desktop nav */}
          <div className="hidden md:flex gap-1.5 mt-4 flex-wrap">
            {navItems.map(n=><NavBtn key={n.key} a={currentPage===n.key} o={()=>setCurrentPage(n.key)} l={n.label} i={n.icon}/>)}
          </div>
          {/* Mobile nav */}
          <div className="md:hidden mt-3">
            <button onClick={()=>setNavOpen(!navOpen)} className="w-full flex items-center justify-between px-4 py-2.5 bg-[#1A1A2E] rounded-xl text-[11px] font-bold uppercase text-[#6B6B8A] hover:text-white transition">
              <span className="flex items-center gap-2">{navItems.find(n=>n.key===currentPage)?.icon}{navItems.find(n=>n.key===currentPage)?.label||'Menu'}</span>
              {navOpen?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
            </button>
            {navOpen&&(<div className="mt-2 grid grid-cols-3 gap-1.5">{navItems.map(n=>(<button key={n.key} onClick={()=>{setCurrentPage(n.key);setNavOpen(false);}} className={`px-3 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition flex items-center gap-1.5 ${currentPage===n.key?'bg-[#A100FF] text-white':'bg-[#1A1A2E] text-[#6B6B8A] hover:text-white'}`}>{n.icon}{n.label}</button>))}</div>)}
          </div>
        </div>

        {message.text&&(<div className={`w-full max-w-7xl p-3.5 mb-4 rounded-xl border-l-4 text-sm font-bold flex items-center gap-2 anim-in ${message.isError?'bg-red-500/10 border-red-500 text-red-300':'bg-[#A100FF]/10 border-[#A100FF] text-[#A100FF]'}`}>{message.isError?<AlertCircle size={15}/>:<CheckCircle2 size={15}/>}{message.text}</div>)}

        <div className="w-full max-w-7xl flex-grow anim-in">
          {currentPage==='today'&&<TodayPage events={events} handoffNotes={handoffNotes} showMsg={showMsg} currentUser={currentUser} fetchGemini={fetchGemini} setModal={setModal}/>}
          {currentPage==='schedule'&&<SchedulePage events={events} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} currentUser={currentUser}/>}
          {currentPage==='calendar'&&<CalendarView events={events}/>}
          {currentPage==='kanban'&&<KanbanPage tasks={tasks} showMsg={showMsg} currentUser={currentUser}/>}
          {currentPage==='issues'&&<IssuesPage issues={issues} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} currentUser={currentUser}/>}
          {currentPage==='rooms'&&<RoomStatusPage rooms={rooms} showMsg={showMsg} currentUser={currentUser}/>}
          {currentPage==='export'&&<ExportPage events={events} tasks={tasks} issues={issues} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} currentUser={currentUser}/>}
          {currentPage==='activity'&&<ActivityFeedPage activity={activity}/>}
          {currentPage==='analytics'&&<AnalyticsDashboard events={events} tasks={tasks} issues={issues}/>}
        </div>

        {modal&&(
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 anim-in" onClick={()=>setModal(null)}>
            <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] max-w-2xl w-full p-6" onClick={e=>e.stopPropagation()}>
              <h3 className="text-lg font-black text-white mb-4 flex items-center gap-2"><Zap size={16} className="text-[#A100FF]"/>{modal.title}</h3>
              <div className="bg-[#0D0D15] border border-[#2A2A3E] rounded-xl p-4 text-sm text-[#C0C0D8] whitespace-pre-wrap max-h-[50vh] overflow-y-auto font-mono leading-relaxed">{modal.content}</div>
              <div className="flex gap-2 mt-5">
                {modal.action&&(<button onClick={modal.action} className="flex-1 bg-[#A100FF] text-white font-bold py-2.5 rounded-xl text-xs uppercase hover:bg-[#B733FF] transition flex items-center justify-center gap-1.5"><Share2 size={12}/>{modal.actionLabel||'Copy'}</button>)}
                <button onClick={()=>setModal(null)} className="flex-1 bg-[#1A1A2E] text-[#6B6B8A] font-bold py-2.5 rounded-xl text-xs uppercase hover:bg-[#2A2A3E] hover:text-white transition">Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
