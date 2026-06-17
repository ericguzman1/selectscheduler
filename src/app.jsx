import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, signInWithCustomToken,
} from 'firebase/auth';
import {
  getFirestore, collection, addDoc, onSnapshot, query,
  deleteDoc, doc, updateDoc, orderBy,
} from 'firebase/firestore';
import {
  Layout, AlertCircle, Trash2, CheckCircle2, ChevronLeft, ChevronRight,
  Zap, LogOut, User, Edit3, FileText, BarChart3, PieChart as PieIcon,
  Calendar, Clock, TrendingUp, Share2, BrainCircuit, MapPin, Upload,
  Search, Filter, RefreshCcw, ClipboardList, Users, CalendarDays,
} from 'lucide-react';

/* --- PDF.js CDN Loader --- */
const loadPdfJs = (() => {
  let promise = null;
  return () => {
    if (promise) return promise;
    promise = new Promise((resolve, reject) => {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '';
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
    pages.push(content.items.map((item) => item.str).join(' '));
  }
  return pages.join('\n');
};

/* --- CONSTANTS --- */
const TEAM_MEMBERS = ["Eric.Guzman","Tommy.Flinch","Donald.Salazar","Mistral.Rojas"];
const ROOMS = ["Interchange","Vision","Tank","Training Room","Meadow","Common Grounds","Ginsberg","Globe","Office Tour"];
const DURATION_OPTIONS = ["0.5 Hours","1 Hour","2 Hours","4 Hours","6 Hours","8 Hours","Full Day (10h)","Multi-Day (24h)"];
const SUPPORT_TEAMS = ["NYIH SELECT","CIC","TXA Assist","Other"];
const CLASSIFICATIONS = ["Internal","Client","Leadership","Community","Confidential","Public / External","TBD"];
const SESSION_TYPES = ["Demo","Client","Leadership","Workshop","Meeting","Conference / Boardroom","Town Hall","Other","TBD"];

const QUICK_FILL_CARDS = [
  { name:'Proto', demo:'Proto hologram', sessionType:'Demo', note:'Hologram demo' },
  { name:'Vu AI', demo:'Vu AI', sessionType:'Demo', note:'AI video wall' },
  { name:'Spot', demo:'Spot', sessionType:'Demo', note:'Boston Dynamics' },
  { name:'Cyviz', demo:'Cyviz', sessionType:'Meeting', note:'Room / VC' },
  { name:'Surface Hub', demo:'Surface Hub', sessionType:'Meeting', note:'Whiteboard / VC' },
  { name:'Signage', demo:'Signage only', sessionType:'Leadership', note:'Lobby signage' },
];

const SELECT_HINTS = [
  'select','tech enablement','cyviz','surface hub','proto','vu ai','spot',
  'signage','web conference','loaner laptop','clicker','txa','support','music','mic','teams call',
];

const DK = 'bg-[#0D0D15] border border-[#2A2A3E] text-[#E8E8F0] rounded-xl p-3.5 text-sm outline-none focus:border-[#A100FF] transition placeholder-[#4A4A6A]';

/* --- UTILITIES --- */
const blankEventForm = () => ({
  eventName:'',startDate:'',endDate:'',eventPoc:'',selectPoc:'',location:'NYIH',
  eventLocation:'',classification:'Internal',sessionType:'Demo',attendees:'',demo:'',
  selectResources:'',sessionDays:'',sessionSupportDuration:'',supportTeam:'NYIH SELECT',
  weekOf:'',notes:'',source:'Manual',
});

const sanitizeForPrompt = (text) => {
  if (typeof text !== 'string') return '';
  return text.slice(0,4000).replace(/[<>]/g,'').replace(/ignore (all )?instructions?/gi,'[redacted]').trim();
};

const safeParseJson = (text) => {
  try {
    const cleaned = text?.replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) return {};
    return parsed;
  } catch { return {}; }
};

const ALLOWED_EVENT_KEYS = [
  'eventName','startDate','endDate','eventPoc','selectPoc','location',
  'eventLocation','classification','sessionType','attendees','demo',
  'selectResources','sessionDays','sessionSupportDuration','supportTeam','weekOf','notes','source'
];

const sanitizeEventData = (obj) => {
  const safe = {};
  for (const key of ALLOWED_EVENT_KEYS) {
    if (obj[key] !== undefined) safe[key] = String(obj[key]).slice(0,500);
  }
  return safe;
};

const normalizeLine = (s) => String(s||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();

const parseDateTime = (v) => {
  const t = String(v||'').trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0,16);
  const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m) {
    let [,mm,dd,yy,hh,mi,ap] = m;
    const year = yy.length===2 ? `20${yy}` : yy;
    let hour = parseInt(hh,10);
    if (ap.toUpperCase()==='PM' && hour!==12) hour+=12;
    if (ap.toUpperCase()==='AM' && hour===12) hour=0;
    return `${year}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${mi}`;
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  return '';
};

const weekOfFromDateTime = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const x = new Date(d); x.setDate(x.getDate()-x.getDay());
  return new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,10);
};

const scoreSelectRelevance = (e) => {
  const hay = [e.eventName,e.eventPoc,e.selectPoc,e.location,e.eventLocation,e.classification,e.sessionType,e.attendees,e.demo,e.selectResources,e.sessionSupportDuration,e.notes,e.supportTeam].join(' ').toLowerCase();
  let score = 0;
  SELECT_HINTS.forEach((k) => { if (hay.includes(k)) score+=1; });
  if ((e.selectResources||'').trim()) score+=2;
  if ((e.demo||'').trim() && !['n/a','tbd'].includes((e.demo||'').trim().toLowerCase())) score+=2;
  if ((e.eventName||'').toLowerCase().includes('workshop')) score+=1;
  if ((e.location||'').toLowerCase().includes('nyih')) score+=1;
  return score;
};

const classBadgeColor = (cls) => {
  if (cls==='Leadership') return '#F59E0B';
  if (cls==='Client') return '#22C55E';
  if (cls==='Confidential') return '#EF4444';
  return '#6B6B8A';
};

/* --- FIREBASE --- */
const appId = typeof __app_id !== 'undefined' ? __app_id : 'accenture-hub-v1';
let firebaseConfig = {};
if (typeof __firebase_config !== 'undefined' && __firebase_config) {
  firebaseConfig = JSON.parse(__firebase_config);
} else {
  try {
    firebaseConfig = {
      apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
      authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
      storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || `${process.env.REACT_APP_FIREBASE_PROJECT_ID}.appspot.com`,
      messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.REACT_APP_FIREBASE_APP_ID
    };
  } catch (e) {}
}
const app = getApps().length===0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

/* --- STAT CARD --- */
function StatCard({ icon, value, label }) {
  return (
    <div className="rounded-xl p-4 bg-[#0D0D15] border border-[#2A2A3E] hover:border-[#A100FF] transition">
      <div className="text-[#A100FF]">{icon}</div>
      <div className="text-2xl font-black text-white mt-1.5">{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-widest text-[#6B6B8A] mt-1">{label}</div>
    </div>
  );
}

/* ======== MAIN APP ======== */
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('schedule');
  const [message, setMessage] = useState({ text: '', isError: false });
  const [aiEnabled] = useState(true);
  const [modal, setModal] = useState(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [issues, setIssues] = useState([]);

  useEffect(() => {
    if (!firebaseConfig.apiKey) { setLoading(false); return; }
    (async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token)
          await signInWithCustomToken(auth, __initial_auth_token);
      } catch (err) { console.error("Auth init:", err); }
    })();
    return onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!user || !firebaseConfig.apiKey) return;
    const p = (c) => collection(db, 'artifacts', appId, 'public', 'data', c);
    const u1 = onSnapshot(query(p('shared_events'), orderBy('timestamp','desc')), (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(query(p('shared_tasks'), orderBy('timestamp','desc')), (s) => setTasks(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(query(p('shared_issues'), orderBy('timestamp','desc')), (s) => setIssues(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); };
  }, [user]);

  const showMsg = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage({ text: '', isError: false }), 5000);
  };

  const fetchGemini = async (sys, usr = '', json = false) => {
    if (!aiEnabled) return json ? {} : "AI Unavailable";
    try {
      const prompt = usr ? `${sys}\n\n---USER DATA---\n${sanitizeForPrompt(usr)}\n---END---` : sys;
      const r = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: json ? { responseMimeType: "application/json" } : {} })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message);
      const t = d.candidates?.[0]?.content?.parts?.[0]?.text;
      return json ? safeParseJson(t) : t;
    } catch (e) { return json ? {} : `AI Error: ${e.message}`; }
  };

  const generateLeadBriefing = async () => {
    if (!aiEnabled) return;
    setIsBriefingLoading(true);
    const ec = events.slice(0,3).map((e) => e.eventName).join(', ');
    const bc = issues.filter((i) => i.urgency === 'Urgent').map((i) => i.title).join(', ');
    const briefing = await fetchGemini(
      'Act as an Accenture PM. Provide exactly TWO high-impact bullet points for leadership update reflecting what the team did, what event was supported, what technology was used, and the outcome.',
      `Events: ${ec}. Blockers: ${bc}.`
    );
    setModal({ title: "Leadership Brief", content: briefing, actionLabel: "Copy", action: () => { navigator.clipboard.writeText(briefing); showMsg("Copied."); } });
    setIsBriefingLoading(false);
  };

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0F]">
      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-[#A100FF]" />
      <p className="mt-4 text-[#6B6B8A] text-[10px] font-bold uppercase tracking-widest">Loading systems...</p>
    </div>
  );

  if (!firebaseConfig.apiKey) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F] p-4">
      <div className="bg-[#111119] p-10 rounded-2xl border border-red-500/30 text-center max-w-md w-full">
        <AlertCircle size={40} className="mx-auto text-red-500 mb-4" />
        <h1 className="text-xl font-black text-white mb-4">Connection Error</h1>
        <button onClick={() => window.location.reload()} className="w-full bg-[#1A1A2E] text-[#E8E8F0] py-3 rounded-xl font-bold text-xs uppercase hover:bg-[#2A2A3E] transition">Retry</button>
      </div>
    </div>
  );

  if (!user) return <AuthPage showMsg={showMsg} />;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
        * { font-family: 'Graphik', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        body { background: #0A0A0F; margin: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0A0A0F; }
        ::-webkit-scrollbar-thumb { background: #2A2A3E; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #A100FF; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .anim-in { animation: fadeIn .3s ease-out; }
      `}</style>

      <div className="min-h-screen bg-[#0A0A0F] p-4 md:p-6 flex flex-col items-center text-[#E8E8F0]">
        <div className="w-full max-w-7xl bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5 mb-5">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                <span className="text-[#A100FF]">SELECT</span> Hub
              </h1>
              <p className="text-[10px] text-[#6B6B8A] font-bold uppercase tracking-[.25em] mt-0.5">Powered by Accenture</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={generateLeadBriefing} disabled={isBriefingLoading}
                className="bg-[#A100FF] text-white px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-[#B733FF] transition disabled:opacity-50 flex items-center gap-1.5">
                <Zap size={11} className={isBriefingLoading ? 'animate-spin' : ''} />
                {isBriefingLoading ? 'Working...' : 'Lead Brief'}
              </button>
              <button onClick={() => signOut(auth)} className="text-[#6B6B8A] hover:text-red-400 transition p-2 rounded-lg hover:bg-[#1A1A2E]">
                <LogOut size={16} />
              </button>
            </div>
          </div>
          <div className="flex gap-1.5 mt-4 flex-wrap">
            <NavBtn a={currentPage==='schedule'} o={() => setCurrentPage('schedule')} l="Events" i={<Calendar size={13}/>} />
            <NavBtn a={currentPage==='calendar'} o={() => setCurrentPage('calendar')} l="Calendar" i={<CalendarDays size={13}/>} />
            <NavBtn a={currentPage==='kanban'} o={() => setCurrentPage('kanban')} l="Tasks" i={<Layout size={13}/>} />
            <NavBtn a={currentPage==='issues'} o={() => setCurrentPage('issues')} l="Tech Feed" i={<BrainCircuit size={13}/>} />
            <NavBtn a={currentPage==='analytics'} o={() => setCurrentPage('analytics')} l="Insights" i={<BarChart3 size={13}/>} />
          </div>
        </div>

        {message.text && (
          <div className={`w-full max-w-7xl p-3.5 mb-4 rounded-xl border-l-4 text-sm font-bold flex items-center gap-2 anim-in ${message.isError ? 'bg-red-500/10 border-red-500 text-red-300' : 'bg-[#A100FF]/10 border-[#A100FF] text-[#A100FF]'}`}>
            {message.isError ? <AlertCircle size={15}/> : <CheckCircle2 size={15}/>}
            {message.text}
          </div>
        )}

        <div className="w-full max-w-7xl flex-grow anim-in">
          {currentPage === 'schedule' && <SchedulePage events={events} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} />}
          {currentPage === 'calendar' && <CalendarView events={events} />}
          {currentPage === 'kanban' && <KanbanPage tasks={tasks} showMsg={showMsg} />}
          {currentPage === 'issues' && <IssuesPage issues={issues} showMsg={showMsg} fetchGemini={fetchGemini} />}
          {currentPage === 'analytics' && <AnalyticsDashboard events={events} tasks={tasks} />}
        </div>

        {modal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 anim-in" onClick={() => setModal(null)}>
            <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-black text-white mb-4 flex items-center gap-2"><Zap size={16} className="text-[#A100FF]"/> {modal.title}</h3>
              <div className="bg-[#0D0D15] border border-[#2A2A3E] rounded-xl p-4 text-sm text-[#C0C0D8] whitespace-pre-wrap max-h-[50vh] overflow-y-auto font-mono leading-relaxed">{modal.content}</div>
              <div className="flex gap-2 mt-5">
                {modal.action && <button onClick={modal.action} className="flex-1 bg-[#A100FF] text-white font-bold py-2.5 rounded-xl text-xs uppercase hover:bg-[#B733FF] transition flex items-center justify-center gap-1.5"><Share2 size={12}/>{modal.actionLabel||'Copy'}</button>}
                <button onClick={() => setModal(null)} className="flex-1 bg-[#1A1A2E] text-[#6B6B8A] font-bold py-2.5 rounded-xl text-xs uppercase hover:bg-[#2A2A3E] hover:text-white transition">Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function NavBtn({ a, o, l, i }) {
  return (
    <button onClick={o} className={`px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition flex items-center gap-1.5 ${a ? 'bg-[#A100FF] text-white shadow-lg shadow-[#A100FF]/20' : 'bg-[#1A1A2E] text-[#6B6B8A] hover:bg-[#2A2A3E] hover:text-white'}`}>
      {i} {l}
    </button>
  );
}

function AuthPage({ showMsg }) {
  const [isLogin, setIsLogin] = useState(true);
  const submit = async (e) => {
    e.preventDefault();
    const { email, password } = Object.fromEntries(new FormData(e.target));
    try {
      if (isLogin) await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) { showMsg(err.message, true); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F] p-4">
      <div className="w-full max-w-sm bg-[#111119] p-8 rounded-2xl border border-[#2A2A3E] text-center">
        <div className="w-14 h-14 bg-[#A100FF] rounded-xl flex items-center justify-center mx-auto mb-5">
          <Layout size={24} className="text-white" />
        </div>
        <h1 className="text-2xl font-black text-white mb-1"><span className="text-[#A100FF]">SELECT</span> Hub</h1>
        <p className="text-[10px] text-[#6B6B8A] font-bold uppercase tracking-[.2em] mb-6">Powered by Accenture</p>
        <form onSubmit={submit} className="space-y-3">
          <input name="email" type="email" placeholder="Email" required className={`w-full ${DK}`} />
          <input name="password" type="password" placeholder="Password" required className={`w-full ${DK}`} />
          <button type="submit" className={`w-full font-bold py-3 rounded-xl text-sm uppercase tracking-wider transition ${isLogin ? 'bg-[#A100FF] text-white hover:bg-[#B733FF]' : 'bg-[#A3E635] text-[#0A0A0F] hover:bg-[#8CD02F]'}`}>
            {isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>
        <button onClick={() => setIsLogin(!isLogin)} className="mt-5 text-[11px] text-[#6B6B8A] hover:text-[#A100FF] font-bold uppercase tracking-wider transition">
          {isLogin ? 'Create Account' : 'Back to Sign In'}
        </button>
      </div>
    </div>
  );
}

/* ======== CALENDAR VIEW ======== */
function CalendarView({ events }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const year = month.getFullYear();
  const mo = month.getMonth();
  const firstDay = new Date(year, mo, 1).getDay();
  const daysInMonth = new Date(year, mo + 1, 0).getDate();
  const prevDays = new Date(year, mo, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: prevDays - firstDay + 1 + i, cur: false });
  for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, cur: true });
  const rem = 42 - cells.length;
  for (let i = 1; i <= rem; i++) cells.push({ day: i, cur: false });

  const getEventsForDay = (day) => {
    const ds = `${year}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return events.filter((e) => {
      const sd = (e.startDate || '').slice(0, 10);
      const ed = (e.endDate || '').slice(0, 10);
      return (sd <= ds && (ed >= ds || sd === ds));
    });
  };
  const moNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5 anim-in">
      <div className="flex justify-between items-center mb-5">
        <button onClick={() => setMonth(new Date(year, mo - 1, 1))} className="p-2 rounded-lg bg-[#1A1A2E] text-[#6B6B8A] hover:text-white hover:bg-[#2A2A3E] transition"><ChevronLeft size={16}/></button>
        <h2 className="text-lg font-black text-white">{moNames[mo]} {year}</h2>
        <button onClick={() => setMonth(new Date(year, mo + 1, 1))} className="p-2 rounded-lg bg-[#1A1A2E] text-[#6B6B8A] hover:text-white hover:bg-[#2A2A3E] transition"><ChevronRight size={16}/></button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-[#2A2A3E] rounded-xl overflow-hidden">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="bg-[#0D0D15] py-2.5 text-center text-[10px] font-bold text-[#6B6B8A] uppercase tracking-wider">{d}</div>
        ))}
        {cells.map((c, idx) => {
          const ds = `${year}-${String(mo+1).padStart(2,'0')}-${String(c.day).padStart(2,'0')}`;
          const isToday = c.cur && ds === todayStr;
          const dayEvents = c.cur ? getEventsForDay(c.day) : [];
          return (
            <div key={idx} className={`bg-[#0D0D15] min-h-[100px] p-1.5 ${!c.cur ? 'opacity-25' : ''} ${isToday ? 'ring-2 ring-inset ring-[#A100FF]' : ''}`}>
              <span className={`text-[11px] font-bold block mb-0.5 ${isToday ? 'text-[#A100FF]' : c.cur ? 'text-[#9B9BB0]' : 'text-[#4A4A6A]'}`}>{c.day}</span>
              <div className="space-y-0.5 overflow-hidden max-h-[65px]">
                {dayEvents.slice(0, 3).map((ev, i) => (
                  <div key={i} className="text-[8px] font-bold truncate px-1.5 py-0.5 rounded" style={{ background: `${classBadgeColor(ev.classification)}22`, color: classBadgeColor(ev.classification) }}>
                    {ev.eventName}
                  </div>
                ))}
                {dayEvents.length > 3 && <div className="text-[8px] text-[#6B6B8A] font-bold pl-1">+{dayEvents.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ======== KANBAN / TASK BOARD ======== */
function KanbanPage({ tasks, showMsg }) {
  const [editingId, setEditingId] = useState(null);
  const handleAdd = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const d = { title: fd.get('t'), assignee: fd.get('a'), dueDate: fd.get('d'), timeSpent: fd.get('du'), details: fd.get('det'), status: 'todo', timestamp: new Date().toISOString() };
    if (d.title) { await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_tasks'), d); e.target.reset(); showMsg("Task added."); }
  };
  const move = async (id, s) => await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', id), { status: s });
  const del = async (id) => { if (window.confirm("Delete task?")) { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', id)); showMsg("Deleted."); } };
  const saveEdit = async (e, id) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', id), {
      title: fd.get('t'), assignee: fd.get('a'), dueDate: fd.get('d'), timeSpent: fd.get('du'), details: fd.get('det'),
    });
    setEditingId(null); showMsg("Updated.");
  };
  const statuses = [
    { key: 'todo', label: 'To Do', color: '#6B6B8A' },
    { key: 'progress', label: 'In Progress', color: '#F59E0B' },
    { key: 'done', label: 'Done', color: '#22C55E' },
  ];

  const renderCard = (t) => {
    if (editingId === t.id) return (
      <form key={t.id} onSubmit={(e) => saveEdit(e, t.id)} className="bg-[#0D0D15] border border-[#A100FF] rounded-xl p-3 space-y-2 anim-in">
        <input name="t" defaultValue={t.title} required className={`w-full text-xs ${DK}`} />
        <textarea name="det" defaultValue={t.details} placeholder="Notes..." rows="2" className={`w-full text-xs resize-none ${DK}`} />
        <div className="grid grid-cols-2 gap-2">
          <select name="a" defaultValue={t.assignee} className={`text-xs ${DK}`}>
            <option value="">Assign...</option>
            {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input name="du" defaultValue={t.timeSpent} placeholder="Hours" className={`text-xs ${DK}`} />
        </div>
        <input name="d" type="date" defaultValue={t.dueDate} className={`w-full text-xs ${DK}`} />
        <div className="flex gap-2">
          <button type="submit" className="flex-1 bg-[#A100FF] text-white text-[10px] font-bold py-1.5 rounded-lg uppercase">Save</button>
          <button type="button" onClick={() => setEditingId(null)} className="flex-1 bg-[#1A1A2E] text-[#6B6B8A] text-[10px] font-bold py-1.5 rounded-lg uppercase">Cancel</button>
        </div>
      </form>
    );
    return (
      <div key={t.id} className="bg-[#0D0D15] border border-[#2A2A3E] rounded-xl p-3.5 group hover:border-[#A100FF]/40 transition">
        <div className="flex justify-between items-start mb-2">
          <p className="text-xs font-bold text-white leading-snug">{t.title}</p>
          <button onClick={() => del(t.id)} className="text-[#2A2A3E] group-hover:text-red-400 transition"><Trash2 size={12}/></button>
        </div>
        {t.details && <p className="text-[10px] text-[#6B6B8A] mb-2 line-clamp-2">{t.details}</p>}
        <div className="bg-[#111119] rounded-lg p-2 space-y-1 text-[9px] font-bold text-[#6B6B8A] mb-2">
          <div className="flex items-center gap-1"><User size={9} className="text-[#A100FF]"/> {t.assignee || 'Unassigned'}</div>
          {t.dueDate && <div className="flex items-center gap-1"><CalendarDays size={9}/> {t.dueDate}</div>}
          {t.timeSpent && <div className="flex items-center gap-1"><Clock size={9}/> {t.timeSpent}</div>}
        </div>
        <div className="flex justify-between opacity-0 group-hover:opacity-100 transition">
          <div className="flex gap-1">
            {t.status !== 'todo' && <button onClick={() => move(t.id, t.status === 'done' ? 'progress' : 'todo')} className="p-1 rounded bg-[#1A1A2E] text-[#6B6B8A] hover:text-white"><ChevronLeft size={12}/></button>}
            {t.status !== 'done' && <button onClick={() => move(t.id, t.status === 'todo' ? 'progress' : 'done')} className="p-1 rounded bg-[#1A1A2E] text-[#6B6B8A] hover:text-white"><ChevronRight size={12}/></button>}
          </div>
          <button onClick={() => setEditingId(t.id)} className="text-[9px] text-[#A100FF] font-bold uppercase flex items-center gap-0.5"><Edit3 size={9}/> Edit</button>
        </div>
      </div>
    );
  };

  return (
    <div className="anim-in space-y-5">
      <form onSubmit={handleAdd} className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-4">
        <div className="grid md:grid-cols-5 gap-3">
          <input name="t" placeholder="Task title..." required className={`md:col-span-2 ${DK}`} />
          <select name="a" className={DK}><option value="">Assign...</option>{TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}</select>
          <input name="d" type="date" className={DK} />
          <button type="submit" className="bg-[#A100FF] text-white font-bold py-3 rounded-xl text-xs uppercase hover:bg-[#B733FF] transition">Add</button>
        </div>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <input name="du" placeholder="Time spent (hrs)" className={DK} />
          <input name="det" placeholder="Quick notes..." className={DK} />
        </div>
      </form>
      <div className="grid md:grid-cols-3 gap-4">
        {statuses.map(({ key, label, color }) => (
          <div key={key} className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-4 min-h-[400px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{label}</h3>
              <span className="text-[10px] font-bold bg-[#0D0D15] border border-[#2A2A3E] px-2 py-0.5 rounded" style={{ color }}>{tasks.filter(t => t.status === key).length}</span>
            </div>
            <div className="space-y-3">{tasks.filter(t => t.status === key).map(renderCard)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
/* ======== SCHEDULE PAGE v3 — BEO-Aware AI Import ======== */
function SchedulePage({ events, showMsg, fetchGemini, setModal }) {
  const [aiLoading, setAiLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(blankEventForm());
  const [beoText, setBeoText] = useState('');
  const [importBanner, setImportBanner] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const fileRef = useRef(null);

  const totalStats = useMemo(() => ({
    events: events.length,
    imported: events.filter((e) => e.source === 'Imported').length,
    attendees: events.reduce((s, e) => s + (parseInt(String(e.attendees || '').replace(/[^\d]/g, ''), 10) || 0), 0),
    high: events.filter((e) => ['Leadership', 'Client'].includes(e.classification)).length,
  }), [events]);

  const filteredEvents = useMemo(() => events.filter((e) => {
    const h = [e.eventName, e.eventPoc, e.selectPoc, e.demo, e.eventLocation, e.selectResources, e.notes, e.supportTeam, e.source, e.classification].join(' ').toLowerCase();
    return (!searchTerm || h.includes(searchTerm.toLowerCase())) && (!classificationFilter || e.classification === classificationFilter) && (!sourceFilter || (e.source || 'Manual') === sourceFilter);
  }), [events, searchTerm, classificationFilter, sourceFilter]);

  const updateField = (key, value) => setFormData((p) => ({
    ...p,
    [key]: value,
    ...(key === 'startDate' && !p.weekOf ? { weekOf: weekOfFromDateTime(value) } : {}),
  }));
  const resetForm = () => { setEditingId(null); setFormData(blankEventForm()); };

  const openFullIntel = (e) => {
    const c = `Event: ${e.eventName || ''}\nWRES: ${e.notes?.match?.(/WRES\d+/)?.[0] || ''}\nStart: ${e.startDate || ''}\nEnd: ${e.endDate || ''}\nPOC: ${e.eventPoc || ''}\nSELECT POC: ${e.selectPoc || ''}\nLocation: ${e.location || 'NYIH'}\nRoom: ${e.eventLocation || ''}\nClassification: ${e.classification || ''}\nType: ${e.sessionType || ''}\nAttendees: ${e.attendees || ''}\nDemo/Equipment: ${e.demo || ''}\nResources: ${e.selectResources || ''}\nDays: ${e.sessionDays || ''}\nDuration: ${e.sessionSupportDuration || ''}\nTeam: ${e.supportTeam || ''}\nWeek Of: ${e.weekOf || ''}\nNotes: ${e.notes || ''}`;
    setModal({ title: "Event Details", content: c, actionLabel: "Copy", action: () => { navigator.clipboard.writeText(c); showMsg("Copied."); } });
  };

  const startEdit = (e) => {
    setEditingId(e.id);
    setFormData({
      eventName: e.eventName || '', startDate: e.startDate || '', endDate: e.endDate || '',
      eventPoc: e.eventPoc || '', selectPoc: e.selectPoc || '', location: e.location || 'NYIH',
      eventLocation: e.eventLocation || '', classification: e.classification || 'Internal',
      sessionType: e.sessionType || 'Demo', attendees: e.attendees || '', demo: e.demo || '',
      selectResources: e.selectResources || '', sessionDays: e.sessionDays || '',
      sessionSupportDuration: e.sessionSupportDuration || '', supportTeam: e.supportTeam || 'NYIH SELECT',
      weekOf: e.weekOf || '', notes: e.notes || '', source: e.source || 'Manual',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCommit = async (e) => {
    e.preventDefault();
    const d = sanitizeEventData({
      ...formData,
      source: formData.source || (editingId ? (events.find(x => x.id === editingId)?.source || 'Manual') : 'Manual'),
      weekOf: formData.weekOf || weekOfFromDateTime(formData.startDate),
    });
    if (!d.eventName || !d.eventPoc) { showMsg("Event name and POC required.", true); return; }
    try {
      if (editingId) {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_events', editingId), d);
        setEditingId(null);
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_events'), { ...d, timestamp: new Date().toISOString() });
      }
      resetForm();
      showMsg("Event saved.");
    } catch { showMsg("Save failed.", true); }
  };

  /* ============================================================
     BEO-AWARE SMART IMPORT
     Reads real Accenture Daily BEO format, extracts *SELECT Required
     blocks, and auto-populates them into the event queue.
     ============================================================ */
  const handleSmartImport = async () => {
    try {
      let text = beoText || '';
      const file = fileRef.current?.files?.[0];

      console.log('[BEO Import] Starting...', { hasText: !!text.trim(), hasFile: !!file, fileName: file?.name });

      /* Step 1: Get text from file if textarea is empty */
      if (!text.trim() && file) {
        try {
          setPdfLoading(true);
          setImportBanner('Reading file...');

          if (file.name.toLowerCase().endsWith('.pdf')) {
            console.log('[BEO Import] Reading PDF:', file.name, file.size, 'bytes');
            text = await extractTextFromPdf(file);
          } else {
            console.log('[BEO Import] Reading text file:', file.name);
            text = await new Promise((ok, no) => {
              const reader = new FileReader();
              reader.onload = () => ok(String(reader.result || ''));
              reader.onerror = (err) => no(new Error('FileReader failed: ' + err));
              reader.readAsText(file);
            });
          }

          setPdfLoading(false);
          console.log('[BEO Import] Text extracted:', text.length, 'chars');
          console.log('[BEO Import] First 200 chars:', text.slice(0, 200));

          /* Keep extracted text visible in textarea so user can see it worked */
          setBeoText(text);

        } catch (err) {
          setPdfLoading(false);
          console.error('[BEO Import] File read error:', err);
          setImportBanner(`File read failed: ${err.message}. Try pasting the BEO text directly.`);
          showMsg(`Could not read file: ${err.message}`, true);
          return;
        }
      }

      /* Bail if still no text */
      if (!text.trim()) {
        showMsg('Upload a PDF or paste BEO text first.', true);
        setImportBanner('No text to process. Paste BEO text or pick a file and try again.');
        return;
      }

      if (text.trim().length < 50) {
        showMsg('Text is too short to be a BEO. Try a different file.', true);
        setImportBanner('Extracted text was too short. The PDF may be image-based (scanned). Try pasting the text manually.');
        return;
      }

      /* Step 2: Send to AI */
      setAiLoading(true);
      setImportBanner(`Sending ${text.length.toLocaleString()} chars to AI for extraction...`);

      const aiPrompt = `You are an expert at reading Accenture NYIH Daily BEO (Banquet Event Order) documents.

DOCUMENT FORMAT:
- Header line has the date, e.g. "DAILY BEO  Tuesday, June 16, 2026"
- Events are grouped by floor: "FLOOR 59   2 EVENTS", "FLOOR 60 ..." etc.
- Each block starts with a WRES ID like "WRES21413633"
- Then "Host: name" and "S&E: name"
- Then a support-type marker:
    - A lightning bolt emoji followed by "SELECT" then "*SELECT Required" = needs SELECT team support
    - A lightning bolt emoji followed by "TXA" then "*TXA Required" = needs TXA support (SKIP these)
    - A building emoji followed by "FACILITIES" = facilities only (SKIP these)
- After "*SELECT Required" there is usually: Time, POC name, and equipment needs (mics, surface hubs, signage, music, clickers, loaner laptops, etc.)
- After the FACILITIES section there are setup details (catering tables, signage, rope & stanchion, chairs, etc.)
- Named events appear as separate lines with format: "EventName  RoomNumber RoomName  StartTime - EndTime  CLASSIFICATION"
  where CLASSIFICATION is one of: INTERNAL, CLIENT VISIT, COMMUNITY, BUSINESS DEV, TRAINING, CLIENT PREP

YOUR TASK:
Extract ONLY the WRES blocks that contain "*SELECT Required". Ignore all TXA-only and Facilities-only blocks.

For each *SELECT Required block, return a JSON object with these exact keys:
- "eventName": The closest named event title if you can match one to this WRES block, otherwise "SELECT Support - Floor [number]"
- "startDate": Combine the BEO header date with the time from the *SELECT Required line. ISO format "YYYY-MM-DDTHH:mm". If no time, use the named event start time.
- "endDate": If an end time is found (from "Event: 4 PM - 7 PM" or named event line), ISO format. Otherwise "".
- "eventPoc": The POC name(s) from the *SELECT Required line
- "selectPoc": "" (leave blank)
- "location": "NYIH"
- "eventLocation": Room name from the nearby named event, or "Floor [number]"
- "classification": From the named event line (e.g. "CLIENT VISIT", "INTERNAL") or "TBD"
- "sessionType": Best guess (Demo, Meeting, Workshop, Town Hall, Other)
- "attendees": Number of people if mentioned, otherwise ""
- "demo": Tech/equipment from the *SELECT Required line (mics, surface hubs, music, etc.)
- "selectResources": Same as demo
- "sessionDays": Multi-day info if present, otherwise ""
- "sessionSupportDuration": Estimate from times if possible, otherwise ""
- "supportTeam": "NYIH SELECT"
- "weekOf": "" 
- "notes": ALL context — WRES ID, Host, S&E, all facilities/setup details, signage, furniture, catering, rope & stanchion, etc.

Return ONLY a valid JSON array. No markdown fences, no explanation.
Example: [{"eventName":"...","startDate":"2026-06-16T15:30", ...}]`;

      console.log('[BEO Import] Sending to AI, text length:', text.length);
      const result = await fetchGemini(aiPrompt, text, false);
      console.log('[BEO Import] AI response type:', typeof result);
      console.log('[BEO Import] AI response preview:', String(result).slice(0, 500));

      /* Check for AI errors */
      if (!result) {
        setAiLoading(false);
        setImportBanner('AI returned empty response. The /api/ai endpoint may not be configured.');
        showMsg('AI returned no response. Check your Gemini API setup.', true);
        return;
      }

      if (typeof result === 'string' && result.startsWith('AI Error:')) {
        setAiLoading(false);
        setImportBanner(result);
        showMsg(result, true);
        return;
      }

      /* Step 3: Parse JSON from response */
      let parsed = [];
      try {
        const cleaned = String(result).replace(/```json|```/g, '').trim();
        const obj = JSON.parse(cleaned);
        parsed = Array.isArray(obj) ? obj : [obj];
      } catch (jsonErr) {
        console.warn('[BEO Import] Direct JSON parse failed, trying regex...');
        try {
          const m = String(result).match(/\[[\s\S]*\]/);
          if (m) parsed = JSON.parse(m[0]);
        } catch (regexErr) {
          console.error('[BEO Import] All JSON parsing failed');
        }
      }

      parsed = parsed.filter(e => e && typeof e === 'object' && (e.eventName || e.eventPoc || e.demo));
      console.log('[BEO Import] Parsed events:', parsed.length, parsed);

      if (!parsed.length) {
        setAiLoading(false);
        const preview = String(result).slice(0, 300);
        setImportBanner(`No events parsed from AI response. Raw response preview: "${preview}..."`);
        showMsg('Could not parse events from AI response. Check console for details.', true);
        return;
      }

      /* Step 4: Deduplicate and save */
      let saved = 0;
      let skipped = 0;
      for (const raw of parsed) {
        const evt = {
          ...blankEventForm(),
          ...Object.fromEntries(
            ALLOWED_EVENT_KEYS.filter(k => raw[k] !== undefined && raw[k] !== null)
              .map(k => [k, String(raw[k] || '').slice(0, 500)])
          ),
          source: 'Imported',
          supportTeam: raw.supportTeam || 'NYIH SELECT',
          location: raw.location || 'NYIH',
          weekOf: weekOfFromDateTime(raw.startDate),
        };

        const isDupe = events.some(x =>
          x.eventName === evt.eventName &&
          x.startDate === evt.startDate &&
          x.eventLocation === evt.eventLocation
        );
        if (isDupe) { skipped++; continue; }

        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_events'), {
          ...sanitizeEventData(evt),
          timestamp: new Date().toISOString(),
        });
        saved++;
      }

      /* Step 5: Report */
      const banner = `Found ${parsed.length} SELECT event(s) \u2022 ${saved} saved${skipped > 0 ? ` \u2022 ${skipped} duplicate(s) skipped` : ''}`;
      setImportBanner(banner);
      setAiLoading(false);
      /* Only clear text on success */
      if (saved > 0) {
        setBeoText('');
        if (fileRef.current) fileRef.current.value = '';
      }
      showMsg(saved > 0 ? `Imported ${saved} SELECT event(s). Edit or delete below.` : 'No new events to import.');

    } catch (outerErr) {
      /* Catch-all so the button never silently fails */
      console.error('[BEO Import] Unexpected error:', outerErr);
      setPdfLoading(false);
      setAiLoading(false);
      setImportBanner(`Unexpected error: ${outerErr.message}`);
     showMsg(`Import failed: ${outerErr.message}`, true);
    }
  };

  return (
    <div className="space-y-5 anim-in">
      
      {/* ---- BEO SMART IMPORT ---- */}
      <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-1"><Upload size={16} className="text-[#A100FF]"/> Smart BEO Import</h2>
        <p className="text-[11px] text-[#6B6B8A] mb-4">Upload a Daily BEO PDF or paste the text. AI extracts only <span className="text-[#A100FF] font-bold">*SELECT Required</span> events and adds them to your queue.</p>

        {importBanner && (
          <div className="bg-[#A100FF]/10 border border-[#A100FF]/30 rounded-xl p-3 text-xs text-[#C0C0D8] font-bold mb-4 flex items-center gap-2">
            {aiLoading ? <RefreshCcw size={13} className="animate-spin text-[#A100FF]"/> : <CheckCircle2 size={13} className="text-[#A100FF]"/>}
            {importBanner}
          </div>
        )}

        <div className="grid md:grid-cols-[1fr,auto] gap-4 items-end">
          <div className="space-y-3">
            <textarea
              value={beoText}
              onChange={(e) => setBeoText(e.target.value)}
              className={`w-full h-32 resize-none text-xs font-mono ${DK}`}
              placeholder="Paste BEO text here... or upload a PDF below"
            />
            <input ref={fileRef} type="file" accept=".pdf,.txt,.csv,.json" className={`w-full text-xs ${DK}`} />
          </div>
          <button
            onClick={handleSmartImport}
            disabled={aiLoading || pdfLoading}
            className="bg-[#A100FF] text-white px-8 py-4 rounded-xl text-sm font-bold uppercase tracking-wider hover:bg-[#B733FF] transition disabled:opacity-50 flex items-center gap-2 h-fit whitespace-nowrap"
          >
            {pdfLoading ? (
              <><RefreshCcw size={14} className="animate-spin"/> Reading PDF...</>
            ) : aiLoading ? (
              <><BrainCircuit size={14} className="animate-spin"/> Extracting...</>
            ) : (
              <><Zap size={14}/> Import SELECT</>
            )}
          </button>
        </div>
      </div>

      {/* ---- MAIN LAYOUT ---- */}
      <div className="grid lg:grid-cols-[1.2fr,.8fr] gap-5">
        {/* LEFT: Event Form */}
        <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-5">
          <div className="flex justify-between items-start mb-4 flex-wrap gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2"><ClipboardList size={16} className="text-[#A100FF]"/> {editingId ? 'Edit Event' : 'New Event'}</h2>
              <p className="text-[11px] text-[#6B6B8A] mt-0.5">{editingId ? 'Editing imported or manual event' : 'Add event manually or use import above'}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {['Demo','Client','Leadership','Workshop'].map(t => (
                <button key={t} type="button" onClick={() => updateField('sessionType', t)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition ${formData.sessionType === t ? 'bg-[#A100FF] text-white' : 'bg-[#0D0D15] border border-[#2A2A3E] text-[#6B6B8A] hover:border-[#A100FF]'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {QUICK_FILL_CARDS.map(c => (
              <button key={c.name} type="button" onClick={() => setFormData(p => ({...p, demo: c.demo, sessionType: c.sessionType}))}
                className="text-left p-3 rounded-xl bg-[#0D0D15] border border-[#2A2A3E] hover:border-[#A100FF]/50 transition">
                <div className="text-[11px] font-bold text-white">{c.name}</div>
                <div className="text-[9px] text-[#6B6B8A]">{c.note}</div>
              </button>
            ))}
          </div>

          <form onSubmit={handleCommit} className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <input value={formData.eventName} onChange={e => updateField('eventName', e.target.value)} placeholder="Event Name *" required className={DK} />
              <input value={formData.eventPoc} onChange={e => updateField('eventPoc', e.target.value)} placeholder="Event POC *" required className={DK} />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="text-[9px] font-bold text-[#6B6B8A] uppercase">Start<input value={formData.startDate} onChange={e => updateField('startDate', e.target.value)} type="datetime-local" required className={`w-full mt-1 ${DK}`} /></div>
              <div className="text-[9px] font-bold text-[#6B6B8A] uppercase">End<input value={formData.endDate} onChange={e => updateField('endDate', e.target.value)} type="datetime-local" required className={`w-full mt-1 ${DK}`} /></div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <select value={formData.selectPoc} onChange={e => updateField('selectPoc', e.target.value)} className={DK}><option value="">SELECT Lead...</option>{TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}</select>
              <select value={formData.eventLocation} onChange={e => updateField('eventLocation', e.target.value)} className={DK}><option value="">Room...</option>{ROOMS.map(r => <option key={r} value={r}>{r}</option>)}</select>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <select value={formData.classification} onChange={e => updateField('classification', e.target.value)} className={DK}>{CLASSIFICATIONS.map(c => <option key={c} value={c}>{c}</option>)}</select>
              <select value={formData.sessionType} onChange={e => updateField('sessionType', e.target.value)} className={DK}>{SESSION_TYPES.map(s => <option key={s} value={s}>{s}</option>)}</select>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <input value={formData.attendees} onChange={e => updateField('attendees', e.target.value)} placeholder="Attendees" className={DK} />
              <input value={formData.demo} onChange={e => updateField('demo', e.target.value)} placeholder="Demo / Equipment" className={DK} />
            </div>
            <input value={formData.selectResources} onChange={e => updateField('selectResources', e.target.value)} placeholder="SELECT Resources" className={`w-full ${DK}`} />
            <div className="grid md:grid-cols-2 gap-3">
              <input value={formData.sessionDays} onChange={e => updateField('sessionDays', e.target.value)} placeholder="Session Days" className={DK} />
              <select value={formData.sessionSupportDuration} onChange={e => updateField('sessionSupportDuration', e.target.value)} className={DK}><option value="">Duration...</option>{DURATION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}</select>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <select value={formData.supportTeam} onChange={e => updateField('supportTeam', e.target.value)} className={DK}>{SUPPORT_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}</select>
              <div className="text-[9px] font-bold text-[#6B6B8A] uppercase">Week Of<input value={formData.weekOf} onChange={e => updateField('weekOf', e.target.value)} type="date" className={`w-full mt-1 ${DK}`} /></div>
            </div>
            <textarea value={formData.notes} onChange={e => updateField('notes', e.target.value)} placeholder="Notes / setup details..." rows="3" className={`w-full resize-none ${DK}`} />
            <div className="flex gap-2">
              <button type="submit" className={`flex-1 font-bold py-3 rounded-xl text-sm uppercase transition ${editingId ? 'bg-[#A3E635] text-[#0A0A0F] hover:bg-[#8CD02F]' : 'bg-[#A100FF] text-white hover:bg-[#B733FF]'}`}>{editingId ? 'Update Event' : 'Save Event'}</button>
              {editingId && <button type="button" onClick={resetForm} className="px-5 bg-[#1A1A2E] text-[#6B6B8A] font-bold py-3 rounded-xl text-sm uppercase hover:text-white transition flex items-center gap-1"><RefreshCcw size={13}/> Cancel</button>}
            </div>
          </form>
        </div>

        {/* RIGHT: Stats + Event Queue */}
        <div className="space-y-5">
          <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3"><BarChart3 size={14} className="text-[#A100FF]"/> Stats</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard icon={<ClipboardList size={16}/>} value={totalStats.events} label="Events"/>
              <StatCard icon={<Upload size={16}/>} value={totalStats.imported} label="Imported"/>
              <StatCard icon={<Users size={16}/>} value={totalStats.attendees} label="Attendees"/>
              <StatCard icon={<TrendingUp size={16}/>} value={totalStats.high} label="High Priority"/>
            </div>
          </div>

          <div className="bg-[#111119] rounded-2xl border border-[#2A2A3E] p-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3"><Search size={14} className="text-[#A100FF]"/> Event Queue</h2>
            <div className="space-y-2.5 mb-3">
              <div className="flex items-center gap-2 rounded-xl bg-[#0D0D15] border border-[#2A2A3E] p-2.5 focus-within:border-[#A100FF] transition">
                <Search size={13} className="text-[#4A4A6A]"/>
                <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search..." className="w-full bg-transparent outline-none text-sm text-[#E8E8F0] placeholder-[#4A4A6A]"/>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <select value={classificationFilter} onChange={e => setClassificationFilter(e.target.value)} className={`flex-1 min-w-[140px] text-xs ${DK}`}><option value="">All types</option>{CLASSIFICATIONS.map(c => <option key={c} value={c}>{c}</option>)}</select>
                {['','Imported','Manual'].map(s => (
                  <button key={s || 'all'} onClick={() => setSourceFilter(s)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition ${sourceFilter === s ? 'bg-[#A100FF] text-white' : 'bg-[#0D0D15] border border-[#2A2A3E] text-[#6B6B8A] hover:border-[#A100FF]'}`}>{s || 'All'}</button>
                ))}
              </div>
            </div>
          </div>

          {/* ---- Event Cards ---- */}
          <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
            {!filteredEvents.length && (
              <div className="text-center text-[#4A4A6A] text-xs font-bold py-8 border border-dashed border-[#2A2A3E] rounded-xl">
                No events yet. Import a BEO or add one manually.
              </div>
            )}
            {filteredEvents.map(entry => {
              const bc = classBadgeColor(entry.classification);
              return (
                <div key={entry.id} className="bg-[#111119] p-4 rounded-xl border border-[#2A2A3E] hover:border-[#A100FF]/40 transition group border-l-4" style={{ borderLeftColor: editingId === entry.id ? '#A3E635' : bc }}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1 pr-3">
                      <p className="text-xs font-bold text-white mb-1.5">{entry.eventName}</p>
                      <div className="flex flex-wrap gap-1 mb-2">
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase" style={{ background: `${bc}20`, color: bc }}>{entry.classification || 'TBD'}</span>
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-[#0D0D15] text-[#6B6B8A]">{entry.sessionType || 'Session'}</span>
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-[#0D0D15] text-[#6B6B8A]">{entry.source || 'Manual'}</span>
                      </div>
                      <div className="space-y-0.5 text-[10px] text-[#6B6B8A]">
                        <p className="flex items-center gap-1"><CalendarDays size={9}/> {entry.startDate || '—'} {entry.endDate ? `→ ${entry.endDate}` : ''}</p>
                        <p className="flex items-center gap-1"><User size={9}/> {entry.eventPoc || 'No POC'} | SELECT: {entry.selectPoc || 'TBD'}</p>
                        <p className="flex items-center gap-1"><MapPin size={9}/> {entry.location || 'NYIH'} • {entry.eventLocation || 'No room'}</p>
                      </div>
                      {(entry.demo || entry.selectResources) && (
                        <p className="text-[10px] text-[#A100FF] mt-1.5 line-clamp-1">
                          Equipment: {entry.demo || entry.selectResources || '—'}
                        </p>
                      )}
                      {entry.notes && (
                        <p className="text-[10px] text-[#4A4A6A] mt-1 line-clamp-2">{entry.notes}</p>
                      )}
                      <div className="flex gap-3 mt-2.5">
                        <button onClick={() => startEdit(entry)} className="text-[10px] text-[#A100FF] font-bold uppercase flex items-center gap-1 hover:text-[#B733FF] transition"><Edit3 size={10}/> Edit</button>
                        <button onClick={() => openFullIntel(entry)} className="text-[10px] text-[#6B6B8A] font-bold uppercase flex items-center gap-1 hover:text-white transition"><FileText size={10}/> Details</button>
                        <button onClick={async () => { if (window.confirm("Delete this event?")) { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_events', entry.id)); showMsg("Event deleted."); } }} className="text-[10px] text-[#6B6B8A] font-bold uppercase flex items-center gap-1 hover:text-red-400 transition"><Trash2 size={10}/> Delete</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
