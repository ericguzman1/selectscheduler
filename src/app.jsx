import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  signInWithCustomToken,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  deleteDoc,
  doc,
  updateDoc,
  orderBy,
} from 'firebase/firestore';
import {
  Layout,
  AlertCircle,
  Trash2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Zap,
  LogOut,
  User,
  Edit3,
  FileText,
  BarChart3,
  PieChart as PieIcon,
  Calendar,
  Clock,
  TrendingUp,
  Share2,
  BrainCircuit,
  MapPin,
  Upload,
  Search,
  Filter,
  CopyPlus,
  RefreshCcw,
  ClipboardList,
  Users,
  CalendarDays,
} from 'lucide-react';

const QUICK_FILL_CARDS = [
  { name: 'Proto', demo: 'Proto hologram', sessionType: 'Demo', note: 'Fast-fill demo' },
  { name: 'Vu AI', demo: 'Vu AI', sessionType: 'Demo', note: 'Fast-fill demo' },
  { name: 'Spot', demo: 'Spot', sessionType: 'Demo', note: 'Fast-fill demo' },
  { name: 'Cyviz', demo: 'Cyviz', sessionType: 'Meeting', note: 'Room / VC support' },
  { name: 'Surface Hub', demo: 'Surface Hub', sessionType: 'Meeting', note: 'Room / VC support' },
  { name: 'Signage', demo: 'Signage only', sessionType: 'Leadership', note: 'Lobby / room signage' },
];

const TEAM_MEMBERS = ["Eric.Guzman", "Tommy.Flinch", "Donald.Salazar", "Mistral.Rojas"];
const ROOMS = ["Interchange", "Vision", "Tank", "Training Room", "Meadow", "Common Grounds", "Ginsberg", "Globe", "Office Tour", "212W64", "214W64", "215W64"];
const DURATION_OPTIONS = ["0.5 Hours", "1 Hour", "2 Hours", "4 Hours", "5 Hour", "6 Hours", "8 Hours", "Full Day (10h)", "Multi-Day (24h)"];
const SUPPORT_TEAMS = ["NYIH SELECT", "CIC", "TXA Assist", "Other"];
const CLASSIFICATIONS = ["Internal", "Client", "Leadership", "Community", "Confidential", "Public / External", "TBD"];
const SESSION_TYPES = ["Demo", "Meeting", "Workshop", "Client", "Leadership", "External", "Community", "TBD"];

const SELECT_HINTS = [
  'select', 'tech enablement', 'cyviz', 'surface hub', 'proto', 'vu ai', 'spot',
  'signage', 'web conference', 'loaner laptop', 'clicker', 'txa', 'support',
  'music', 'mic', 'teams call',
];

const sanitizeForPrompt = (text) => {
  if (typeof text !== 'string') return '';
  return text.slice(0, 4000).replace(/[<>]/g, '').replace(/ignore (all )?instructions?/gi, '[redacted]').trim();
};

const blankEventForm = () => ({
  eventName: '', startDate: '', endDate: '', eventPoc: '', selectPoc: '', location: 'NYIH',
  eventLocation: '', classification: 'Internal', sessionType: 'Demo', attendees: '', demo: '',
  selectResources: '', sessionDays: '', sessionSupportDuration: '', supportTeam: 'NYIH SELECT',
  weekOf: '', notes: '', source: 'Manual',
});

const safeParseJson = (text) => {
  try {
    // FIXED: Using new RegExp to prevent ESLint parsing crashes on backticks
    const cleaned = text?.replace(new RegExp('```json|```', 'g'), '').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) return {};
    return parsed;
  } catch { return {}; }
};

const ALLOWED_EVENT_KEYS = [
  'eventName', 'startDate', 'endDate', 'eventPoc', 'selectPoc', 'location',
  'eventLocation', 'classification', 'sessionType', 'attendees', 'demo',
  'selectResources', 'sessionDays', 'sessionSupportDuration',
  'supportTeam', 'weekOf', 'notes', 'source'
];

const sanitizeEventData = (obj) => {
  const safe = {};
  for (const key of ALLOWED_EVENT_KEYS) {
    if (obj[key] !== undefined) safe[key] = String(obj[key]).slice(0, 500);
  }
  return safe;
};

const normalizeLine = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

const parseDateTime = (v) => {
  const t = String(v || '').trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 16);
  const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m) {
    let [, mm, dd, yy, hh, mi, ap] = m;
    const year = yy.length === 2 ? `20${yy}` : yy;
    let hour = parseInt(hh, 10);
    if (ap.toUpperCase() === 'PM' && hour !== 12) hour += 12;
    if (ap.toUpperCase() === 'AM' && hour === 12) hour = 0;
    return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${mi}`;
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return '';
};

const weekOfFromDateTime = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const scoreSelectRelevance = (e) => {
  const hay = [
    e.eventName, e.eventPoc, e.selectPoc, e.location, e.eventLocation, e.classification,
    e.sessionType, e.attendees, e.demo, e.selectResources, e.sessionSupportDuration, e.notes, e.supportTeam
  ].join(' ').toLowerCase();
  let score = 0;
  SELECT_HINTS.forEach((k) => { if (hay.includes(k)) score += 1; });
  if ((e.selectResources || '').trim()) score += 2;
  if ((e.demo || '').trim() && !['n/a', 'tbd'].includes((e.demo || '').trim().toLowerCase())) score += 2;
  if ((e.eventName || '').toLowerCase().includes('workshop')) score += 1;
  if ((e.location || '').toLowerCase().includes('nyih')) score += 1;
  return score;
};

const classBadgeColor = (cls) => {
  if (cls === 'Leadership') return '#F59E0B';
  if (cls === 'Client') return '#22C55E';
  if (cls === 'Confidential') return '#EF4444';
  return '#94A3B8';
};

const appId = typeof __app_id !== 'undefined' ? __app_id : 'accenture-hub-v1';
let firebaseConfig = {};
let GEMINI_API_KEY = "";

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
    GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY;
  } catch (e) {}
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

/* --- MAIN APP WRAPPER --- */
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('schedule');
  const [message, setMessage] = useState({ text: '', isError: false });
  const [aiEnabled, setAiEnabled] = useState(true);
  const [modal, setModal] = useState(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);

  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [issues, setIssues] = useState([]);

  useEffect(() => {
    if (!firebaseConfig.apiKey) { setLoading(false); return; }
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        }
      } catch (err) { console.error("Auth init failed:", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !firebaseConfig.apiKey) return;
    const path = (col) => collection(db, 'artifacts', appId, 'public', 'data', col);
    const unsubEvents = onSnapshot(query(path('shared_events'), orderBy('timestamp', 'desc')), (snap) => setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const unsubTasks = onSnapshot(query(path('shared_tasks'), orderBy('timestamp', 'desc')), (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const unsubIssues = onSnapshot(query(path('shared_issues'), orderBy('timestamp', 'desc')), (snap) => setIssues(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => { unsubEvents(); unsubTasks(); unsubIssues(); };
  }, [user]);

  const showMsg = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage({ text: '', isError: false }), 5000);
  };

  const fetchGemini = async (systemPrompt, userContent = '', isJson = false) => {
    if (!aiEnabled) return isJson ? {} : "AI Service Unavailable";
    try {
      const fullPrompt = userContent ? `${systemPrompt}\n\n---BEGIN USER DATA---\n${sanitizeForPrompt(userContent)}\n---END USER DATA---` : systemPrompt;
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: isJson ? { responseMimeType: "application/json" } : {} })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return isJson ? safeParseJson(text) : text;
    } catch (e) { return isJson ? {} : `AI Link Error: ${e.message}`; }
  };

  const generateLeadBriefing = async () => {
    if (!aiEnabled) return;
    setIsBriefingLoading(true);
    const eventContext = events.slice(0, 3).map((e) => `${e.eventName}`).join(', ');
    const blockerContext = issues.filter((i) => i.urgency === 'Urgent').map((i) => i.title).join(', ');
    const briefing = await fetchGemini(
      `Act as an Accenture PM. Provide exactly TWO high-impact bullet points for leadership update. It should reflect what the team did, what the supported event was, what technology was used and the success.`,
      `Context: Events (${eventContext}), Blockers (${blockerContext}).`
    );
    setModal({
      title: "Leadership Intelligence Brief", content: briefing, actionLabel: "Copy to Teams", action: () => {
        navigator.clipboard.writeText(briefing);
        showMsg("Summary copied to clipboard.");
      }
    });
    setIsBriefingLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-slate-500">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#424A9F]"></div>
        <p className="mt-4 font-bold uppercase tracking-widest text-[10px]">Syncing Hub Systems...</p>
      </div>
    );
  }

  if (!firebaseConfig.apiKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 font-sans text-slate-900">
        <div className="max-w-md w-full bg-white p-10 rounded-3xl shadow-2xl text-center border-t-8 border-red-500">
          <AlertCircle size={48} className="mx-auto text-red-500 mb-4" />
          <h1 className="text-2xl font-black text-[#424A9F] mb-4 uppercase italic tracking-tighter">Handshake Error</h1>
          <button onClick={() => window.location.reload()} className="w-full bg-gray-100 py-3 rounded-xl font-bold uppercase text-xs hover:bg-gray-200 transition">Retry Link</button>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage showMsg={showMsg} />;

  return (
    <div className="min-h-screen bg-gray-100 p-4 flex flex-col items-center font-sans text-slate-900">
      <div className="w-full max-w-6xl bg-white p-6 rounded-[2rem] shadow-xl mb-6 border border-gray-50">
        <div className="flex justify-between items-center mb-2 flex-wrap gap-3">
          <h1 className="text-3xl md:text-4xl font-black text-[#17132A] uppercase italic tracking-tighter leading-none flex items-center">
            <span className="text-[#A3E635] mr-2 text-4xl">{">"}</span> Accenture <span className="text-[#424A9F] ml-2">Hub</span>
          </h1>
          <div className="flex items-center space-x-4 flex-wrap">
            <button onClick={generateLeadBriefing} disabled={isBriefingLoading} className="bg-[#17132A] text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#2A2254] transition shadow-lg disabled:opacity-50 flex items-center border border-[#3B2F75]">
              <Zap size={12} className={`mr-2 text-[#A3E635] ${isBriefingLoading ? 'animate-spin' : ''}`} />
              {isBriefingLoading ? 'COMPILING...' : 'LEAD UPDATE'}
            </button>
            <button onClick={() => signOut(auth)} className="bg-gray-100 text-gray-400 font-bold px-4 py-2.5 rounded-xl hover:text-red-500 transition text-[10px] uppercase tracking-widest flex items-center shadow-sm">
              <LogOut size={12} className="mr-2" /> EXIT
            </button>
          </div>
        </div>

        <p className="text-center text-gray-400 font-bold uppercase text-[10px] tracking-[0.3em] mb-6">High Performance. Delivered.</p>

        <div className="flex justify-center space-x-2 flex-wrap gap-y-2">
          <NavBtn active={currentPage === 'schedule'} onClick={() => setCurrentPage('schedule')} label="Meetings" icon={<Calendar size={12} />} />
          <NavBtn active={currentPage === 'kanban'} onClick={() => setCurrentPage('kanban')} label="Task Board" icon={<Layout size={12} />} />
          <NavBtn active={currentPage === 'issues'} onClick={() => setCurrentPage('issues')} label="Tech Feed" icon={<BrainCircuit size={12} />} />
          <NavBtn active={currentPage === 'analytics'} onClick={() => setCurrentPage('analytics')} label="Insights" icon={<BarChart3 size={12} />} />
        </div>
      </div>

      {message.text && (
        <div className={`w-full max-w-6xl p-4 mb-4 rounded-xl shadow-lg border-l-4 transition-all ${message.isError ? 'bg-red-50 border-red-500 text-red-700' : 'bg-lime-50 border-[#A3E635] text-slate-800'}`}>
          <p className="font-bold text-sm leading-relaxed tracking-tight italic flex items-center">
            {message.isError ? <AlertCircle size={16} className="mr-2" /> : <CheckCircle2 size={16} className="mr-2 text-[#424A9F]" />}
            {message.text}
          </p>
        </div>
      )}

      <div className="w-full max-w-6xl flex-grow">
        {currentPage === 'schedule' && <SchedulePage events={events} issues={issues} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} />}
        {currentPage === 'kanban' && <KanbanPage tasks={tasks} showMsg={showMsg} />}
        {currentPage === 'issues' && <IssuesPage issues={issues} showMsg={showMsg} fetchGemini={fetchGemini} />}
        {currentPage === 'analytics' && <AnalyticsDashboard events={events} tasks={tasks} />}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-[#17132A]/80 flex items-center justify-center p-4 z-50 animate-fade-in backdrop-blur-sm" onClick={() => setModal(null)}>
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl max-w-2xl w-full border border-gray-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-[#17132A] mb-6 uppercase italic border-b pb-2 flex items-center">
              <Zap size={20} className="mr-2 text-[#A3E635]" /> {modal.title}
            </h3>
            <div className="text-gray-700 text-sm italic whitespace-pre-wrap leading-relaxed font-mono bg-gray-50 p-6 rounded-2xl border border-gray-100 shadow-inner max-h-[60vh] overflow-y-auto custom-scrollbar">
              {modal.content}
            </div>
            <div className="flex gap-2 mt-8">
              {modal.action && (
                <button onClick={modal.action} className="flex-1 bg-[#A3E635] text-[#17132A] font-black py-3 rounded-xl hover:bg-[#8CD02F] uppercase text-xs italic shadow-md transition-all flex items-center justify-center">
                  <Share2 size={14} className="mr-2" /> {modal.actionLabel || 'Copy Content'}
                </button>
              )}
              <button onClick={() => setModal(null)} className="flex-1 bg-gray-100 font-bold py-3 rounded-xl hover:bg-gray-200 uppercase text-xs italic text-gray-500">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavBtn({ active, onClick, label, icon }) {
  return (
    <button onClick={onClick} className={`px-6 py-2.5 rounded-xl font-black uppercase text-xs tracking-widest transition-all flex items-center ${active ? 'bg-[#A3E635] text-[#17132A] shadow-lg scale-105' : 'bg-white text-gray-400 hover:bg-gray-50 shadow-sm border border-gray-100'}`}>
      {icon && <span className="mr-2">{icon}</span>} {label}
    </button>
  );
}

/* --- AUTH PAGE --- */
function AuthPage({ showMsg }) {
  const [isLogin, setIsLogin] = useState(true);
  const authSubmit = async (e) => {
    e.preventDefault();
    const { email, password } = Object.fromEntries(new FormData(e.target));
    try {
      if (isLogin) await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) { showMsg(err.message, true); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#17132A] p-4 font-sans text-slate-900">
      <div className="w-full max-w-md bg-white p-10 rounded-[2.5rem] shadow-2xl border-t-8 border-[#A3E635] text-center">
        <div className="flex justify-center mb-8 font-black"><div className="bg-[#17132A] p-4 rounded-3xl text-[#A3E635] shadow-lg"><Layout size={32} /></div></div>
        <h1 className="text-3xl font-black text-[#17132A] mb-6 uppercase italic tracking-tighter flex justify-center items-center">
          <span className="text-[#A3E635] mr-2">{">"}</span> Accenture <span className="text-[#424A9F] ml-2">Hub</span>
        </h1>
        <form onSubmit={authSubmit} className="space-y-4">
          <input name="email" type="email" placeholder="Corporate ID (Email)" required className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none focus:border-[#424A9F] bg-gray-50 font-bold" />
          <input name="password" type="password" placeholder="Key Phrase" required className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none focus:border-[#424A9F] bg-gray-50 font-bold" />
          <button type="submit" className={`w-full font-black py-4 rounded-2xl shadow-xl mt-4 transition ${isLogin ? 'bg-[#17132A] text-white hover:bg-[#2A2254]' : 'bg-[#A3E635] text-[#17132A] hover:bg-[#8CD02F]'}`}>
            {isLogin ? 'INITIATE LOGIN' : 'CREATE PROFILE'}
          </button>
        </form>
        <button onClick={() => setIsLogin(!isLogin)} className="mt-8 text-xs font-black text-gray-400 hover:text-[#424A9F] uppercase tracking-widest transition">
          {isLogin ? "Register Access" : "Back to Login"}
        </button>
      </div>
    </div>
  );
}

/* --- KANBAN PAGE (FULLY FUNCTIONAL) --- */
export function KanbanPage({ tasks, showMsg }) {
  const [editingId, setEditingId] = useState(null);

  const handleAdd = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      title: fd.get('t'),
      assignee: fd.get('a'),
      dueDate: fd.get('d'),
      timeSpent: fd.get('du'),
      details: fd.get('det'),
      status: 'todo',
      timestamp: new Date().toISOString()
    };
    if (data.title) {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_tasks'), data);
      e.target.reset();
      showMsg("Task committed to board.");
    }
  };

  const updateTaskStatus = async (id, newStatus) => {
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', id), { status: newStatus });
  };

  const deleteTask = async (id) => {
    if (window.confirm("Permanently delete this task?")) {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', id));
      showMsg("Task removed.");
    }
  };

  const handleUpdate = async (e, id) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', id), {
      title: fd.get('t'),
      assignee: fd.get('a'),
      dueDate: fd.get('d'),
      timeSpent: fd.get('du'),
      details: fd.get('det'),
    });
    setEditingId(null);
    showMsg("Task intelligence updated.");
  };

  const renderTask = (task) => {
    if (editingId === task.id) {
      return (
        <form key={task.id} onSubmit={(e) => handleUpdate(e, task.id)} className="bg-white p-4 rounded-2xl shadow-md border-2 border-[#A3E635] space-y-3 animate-fade-in">
          <input name="t" defaultValue={task.title} placeholder="Task Title" required className="w-full p-2 text-xs border rounded-lg outline-none font-black text-slate-800 bg-gray-50 focus:border-[#424A9F]" />
          <textarea name="det" defaultValue={task.details} placeholder="Notes / Details..." className="w-full p-2 text-xs border rounded-lg outline-none resize-none font-bold italic text-slate-600 bg-gray-50 focus:border-[#424A9F]" rows="2" />
          <div className="grid grid-cols-2 gap-2">
            <select name="a" defaultValue={task.assignee} className="p-2 text-xs border rounded-lg outline-none font-bold text-slate-600 bg-gray-50">
              <option value="">Assignee...</option>
              {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input name="du" defaultValue={task.timeSpent} placeholder="Time (hrs)" className="p-2 text-xs border rounded-lg outline-none font-bold text-slate-600 bg-gray-50" />
          </div>
          <input name="d" type="date" defaultValue={task.dueDate} className="w-full p-2 text-xs border rounded-lg outline-none font-bold text-slate-600 bg-gray-50" />
          <div className="flex gap-2 pt-2">
            <button type="submit" className="flex-1 bg-[#17132A] text-[#A3E635] text-[10px] font-black py-2 rounded-lg uppercase tracking-widest hover:bg-[#2A2254] transition">Save</button>
            <button type="button" onClick={() => setEditingId(null)} className="flex-1 bg-gray-100 text-gray-500 text-[10px] font-black py-2 rounded-lg uppercase tracking-widest hover:bg-gray-200 transition">Cancel</button>
          </div>
        </form>
      );
    }

    return (
      <div key={task.id} className="bg-white p-4 rounded-2xl shadow-sm border border-l-4 border-l-[#424A9F] hover:shadow-md transition flex flex-col h-full group">
        <div className="flex justify-between items-start mb-2">
          <p className="font-black text-slate-800 uppercase text-xs italic leading-tight">{task.title}</p>
          <button onClick={() => deleteTask(task.id)} className="text-gray-200 hover:text-red-500 transition opacity-0 group-hover:opacity-100"><Trash2 size={12} /></button>
        </div>
        {task.details && <p className="text-[10px] text-gray-500 font-bold italic mb-3 line-clamp-3 leading-relaxed">{task.details}</p>}

        <div className="mt-auto space-y-1 bg-gray-50 p-3 rounded-xl border border-dashed mb-3">
          <p className="text-[9px] text-slate-500 font-black uppercase flex items-center"><User size={10} className="mr-1 text-[#A3E635]" /> {task.assignee || 'Unassigned'}</p>
          {task.dueDate && <p className="text-[9px] text-slate-500 font-black uppercase flex items-center mt-1"><CalendarDays size={10} className="mr-1 text-[#424A9F]" /> {task.dueDate}</p>}
          {task.timeSpent && <p className="text-[9px] text-slate-500 font-black uppercase flex items-center mt-1"><Clock size={10} className="mr-1 text-[#424A9F]" /> {task.timeSpent} hrs</p>}
        </div>

        <div className="flex justify-between items-center pt-3 border-t mt-auto">
          <button onClick={() => updateTaskStatus(task.id, task.status === 'done' ? 'progress' : 'todo')} className={`p-1.5 rounded-lg hover:bg-gray-100 transition ${task.status === 'todo' ? 'invisible' : 'text-gray-400 hover:text-[#424A9F]'}`}><ChevronLeft size={14} /></button>
          <button onClick={() => setEditingId(task.id)} className="text-[9px] font-black uppercase text-[#424A9F] hover:text-[#A3E635] flex items-center transition"><Edit3 size={10} className="mr-1" /> Edit Info</button>
          <button onClick={() => updateTaskStatus(task.id, task.status === 'todo' ? 'progress' : 'done')} className={`p-1.5 rounded-lg hover:bg-gray-100 transition ${task.status === 'done' ? 'invisible' : 'text-gray-400 hover:text-[#424A9F]'}`}><ChevronRight size={14} /></button>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white p-6 md:p-10 rounded-[3rem] shadow-2xl border border-gray-100 animate-fade-in">
      <div className="bg-[#17132A] rounded-[2rem] p-6 shadow-lg mb-8 border border-[#2A2254]">
        <h2 className="text-xl font-black text-white uppercase italic tracking-tight flex items-center mb-4">
          <ClipboardList size={18} className="mr-2 text-[#A3E635]" /> Create New Task
        </h2>
        <form onSubmit={handleAdd} className="grid gap-4 font-bold text-sm italic">
          <div className="grid md:grid-cols-2 gap-4">
            <input name="t" placeholder="Task Title*" required className="w-full p-4 border border-[#3B2F75] rounded-2xl bg-[#2A2254] text-white outline-none focus:border-[#A3E635] placeholder-gray-400" />
            <select name="a" className="p-4 border border-[#3B2F75] rounded-2xl bg-[#2A2254] text-[#C9D2F2] outline-none focus:border-[#A3E635]">
              <option value="">Assignee...</option>
              {TEAM_MEMBERS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <input name="d" type="date" className="w-full p-4 border border-[#3B2F75] rounded-2xl bg-[#2A2254] text-gray-400 outline-none focus:border-[#A3E635]" />
            <input name="du" placeholder="Time Spent (e.g. 2.5)" className="w-full p-4 border border-[#3B2F75] rounded-2xl bg-[#2A2254] text-white outline-none focus:border-[#A3E635] placeholder-gray-400" />
            <input name="det" placeholder="Quick Notes..." className="w-full p-4 border border-[#3B2F75] rounded-2xl bg-[#2A2254] text-white outline-none focus:border-[#A3E635] placeholder-gray-400" />
          </div>
          <button type="submit" className="bg-[#A3E635] text-[#17132A] font-black py-4 rounded-2xl shadow-xl transition uppercase italic mt-2 hover:bg-[#8CD02F]">
            Add Task to Board
          </button>
        </form>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-gray-50 p-5 rounded-[2rem] border border-gray-100 shadow-inner">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-black text-xs uppercase tracking-widest text-[#424A9F] italic">To Do</h3>
            <span className="bg-white text-[#424A9F] text-[10px] font-black px-2 py-1 rounded-lg border shadow-sm">{tasks.filter(t => t.status === 'todo').length}</span>
          </div>
          <div className="space-y-4">{tasks.filter(t => t.status === 'todo').map(renderTask)}</div>
        </div>
        <div className="bg-gray-50 p-5 rounded-[2rem] border border-gray-100 shadow-inner">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-black text-xs uppercase tracking-widest text-[#F59E0B] italic">In Progress</h3>
            <span className="bg-white text-[#F59E0B] text-[10px] font-black px-2 py-1 rounded-lg border shadow-sm">{tasks.filter(t => t.status === 'progress').length}</span>
          </div>
          <div className="space-y-4">{tasks.filter(t => t.status === 'progress').map(renderTask)}</div>
        </div>
        <div className="bg-[#17132A]/5 p-5 rounded-[2rem] border border-[#17132A]/10 shadow-inner">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-black text-xs uppercase tracking-widest text-[#22C55E] italic">Done</h3>
            <span className="bg-white text-[#22C55E] text-[10px] font-black px-2 py-1 rounded-lg border shadow-sm">{tasks.filter(t => t.status === 'done').length}</span>
          </div>
          <div className="space-y-4">{tasks.filter(t => t.status === 'done').map(renderTask)}</div>
        </div>
      </div>
    </div>
  );
}

/* --- SCHEDULE / MEETINGS PAGE --- */
function SchedulePage({ events, issues, showMsg, fetchGemini, setModal }) {
  const [aiLoading, setAiLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(blankEventForm());
  const [beoText, setBeoText] = useState('');
  const [parserPreview, setParserPreview] = useState('No BEO parsed yet.');
  const [importBanner, setImportBanner] = useState('Tip: imported events are staged into the live stream immediately. Edit anything below if the BEO had mistakes.');
  const [searchTerm, setSearchTerm] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const fileRef = useRef(null);

  const totalStats = useMemo(() => ({
    events: events.length,
    imported: events.filter((e) => e.source === 'Imported').length,
    attendees: events.reduce((sum, e) => sum + (parseInt(String(e.attendees || '').replace(/[^\d]/g, ''), 10) || 0), 0),
    high: events.filter((e) => ['Leadership', 'Client'].includes(e.classification)).length,
  }), [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      const hay = [
        e.eventName, e.eventPoc, e.selectPoc, e.demo, e.eventLocation, e.selectResources, e.notes, e.supportTeam, e.source, e.classification
      ].join(' ').toLowerCase();
      return (!searchTerm || hay.includes(searchTerm.toLowerCase())) && (!classificationFilter || e.classification === classificationFilter) && (!sourceFilter || (e.source || 'Manual') === sourceFilter);
    });
  }, [events, searchTerm, classificationFilter, sourceFilter]);

  const updateField = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value, ...(key === 'startDate' && !prev.weekOf ? { weekOf: weekOfFromDateTime(value) } : {}) }));
  };

  const resetForm = () => { setEditingId(null); setFormData(blankEventForm()); };

  const openFullIntel = (e) => {
    const content = `Event Name: ${e.eventName || ''}\nStart Date: ${e.startDate || ''}\nEnd Date: ${e.endDate || ''}\nEvent POC: ${e.eventPoc || ''}\nSELECT POC: ${e.selectPoc || ''}\nLocation: ${e.location || 'NYIH'}\nEvent Location: ${e.eventLocation || ''}\nClassification: ${e.classification || ''}\nSession Type: ${e.sessionType || ''}\nAttendees: ${e.attendees || ''}\nDemo: ${e.demo || ''}\nSELECT Resources: ${e.selectResources || ''}\nSession Days: ${e.sessionDays || ''}\nSession Support Duration: ${e.sessionSupportDuration || ''}\nSupport Team / Hub: ${e.supportTeam || ''}\nWeek Of: ${e.weekOf || ''}\nNotes: ${e.notes || ''}`;
    setModal({
      title: "Operational Intelligence Summary", content, actionLabel: "Copy Intelligence", action: () => {
        navigator.clipboard.writeText(content); showMsg("Copied for pasting.");
      }
    });
  };

  const startEdit = (e) => {
    setEditingId(e.id);
    setFormData({
      eventName: e.eventName || '', startDate: e.startDate || '', endDate: e.endDate || '', eventPoc: e.eventPoc || '',
      selectPoc: e.selectPoc || '', location: e.location || 'NYIH', eventLocation: e.eventLocation || '', classification: e.classification || 'Internal',
      sessionType: e.sessionType || 'Demo', attendees: e.attendees || '', demo: e.demo || '', selectResources: e.selectResources || '',
      sessionDays: e.sessionDays || '', sessionSupportDuration: e.sessionSupportDuration || '', supportTeam: e.supportTeam || 'NYIH SELECT',
      weekOf: e.weekOf || '', notes: e.notes || '', source: e.source || 'Manual',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCommit = async (e) => {
    e.preventDefault();
    const data = sanitizeEventData({
      ...formData, source: formData.source || (editingId ? (events.find((x) => x.id === editingId)?.source || 'Manual') : 'Manual'), weekOf: formData.weekOf || weekOfFromDateTime(formData.startDate),
    });
    if (!data.eventName || !data.eventPoc) { showMsg("Event name and POC are required.", true); return; }
    try {
      if (editingId) {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_events', editingId), data);
        setEditingId(null);
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_events'), { ...data, timestamp: new Date().toISOString() });
      }
      resetForm(); showMsg("Operational entry synchronized.");
    } catch (err) { showMsg("Could not save entry. Please try again.", true); }
  };

  const handleAiAutoCommit = async () => {
    const text = beoText || document.getElementById('ai-input')?.value || '';
    if (!text.trim()) return;
    setAiLoading(true);
    const result = await fetchGemini(`Extract event details from BEO text into JSON.\nKeys: eventName, startDate, endDate, eventPoc, selectPoc, location, eventLocation, classification, sessionType, attendees, demo, selectResources, sessionDays, sessionSupportDuration, supportTeam, weekOf, notes, source.\nReturn one object only for the clearest SELECT-related event.`, text, true);
    if (result && result.eventName) {
      const safeResult = sanitizeEventData({ ...blankEventForm(), ...result, source: 'Imported', supportTeam: result.supportTeam || 'NYIH SELECT', weekOf: result.weekOf || weekOfFromDateTime(result.startDate), });
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_events'), { ...safeResult, timestamp: new Date().toISOString() });
      setBeoText(''); const aiInput = document.getElementById('ai-input'); if (aiInput) aiInput.value = ''; showMsg("AI Pipeline: extraction committed to stream.");
    }
    setAiLoading(false);
  };

  const mapField = (obj, key, val) => {
    const v = normalizeLine(val);
    if (key === 'Event Name') obj.eventName = v; else if (key === 'Start Date') obj.startDate = parseDateTime(v) || v;
    else if (key === 'End Date') obj.endDate = parseDateTime(v) || v; else if (key === 'Event POC') obj.eventPoc = v;
    else if (key === 'SELECT POC') obj.selectPoc = v; else if (key === 'Location') obj.location = v || 'NYIH';
    else if (key === 'Event Location') obj.eventLocation = v; else if (key === 'Classification') obj.classification = v || 'TBD';
    else if (key === 'Session Type') obj.sessionType = v || 'TBD'; else if (key === 'Attendees') obj.attendees = v;
    else if (key === 'Demo') obj.demo = v; else if (key === 'SELECT Resources') obj.selectResources = v;
    else if (key === 'Session Days') obj.sessionDays = v; else if (key === 'Session Support Duration') obj.sessionSupportDuration = v;
  };

  const parseBEOText = (text) => {
    const raw = String(text || ''); const lines = raw.split(/\r?\n/).map(normalizeLine).filter(Boolean);
    const blocks = []; let current = null; let notesBuffer = [];
    const makeBlankImported = () => ({ ...blankEventForm(), source: 'Imported', });
    const finalizeCurrent = () => {
      if (!current) return;
      if (notesBuffer.length) current.notes = notesBuffer.join(' | ');
      current.weekOf = current.weekOf || weekOfFromDateTime(current.startDate);
      blocks.push(current); current = null; notesBuffer = [];
    };
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^-{5,}$/.test(line)) { finalizeCurrent(); continue; }
      const m = line.match(/^(Event Name|Start Date|End Date|Event POC|SELECT POC|Location|Event Location|Classification|Session Type|Attendees|Demo|SELECT Resources|Session Days|Session Support Duration)\s*:\s*(.*)$/i);
      if (m) {
        const key = m[1].replace(/\s+/g, ' ').trim(); const val = m[2] || '';
        if (key === 'Event Name') { if (current && current.eventName) finalizeCurrent(); current = current || makeBlankImported(); }
        current = current || makeBlankImported(); mapField(current, key, val); continue;
      }
      if (current) notesBuffer.push(line);
    }
    finalizeCurrent();
    if (!blocks.length && raw.includes('Event Name') && raw.includes('Session Support Duration')) {
      const split = raw.split(/(?=Event Name\s*:)/g).map((s) => s.trim()).filter(Boolean);
      split.forEach((chunk) => {
        const obj = makeBlankImported();
        const matches = chunk.matchAll(/(Event Name|Start Date|End Date|Event POC|SELECT POC|Location|Event Location|Classification|Session Type|Attendees|Demo|SELECT Resources|Session Days|Session Support Duration)\s*:\s*([\s\S]*?)(?=(?:Event Name|Start Date|End Date|Event POC|SELECT POC|Location|Event Location|Classification|Session Type|Attendees|Demo|SELECT Resources|Session Days|Session Support Duration)\s*:|$)/g);
        for (const mm of matches) mapField(obj, mm[1], mm[2]);
        obj.weekOf = weekOfFromDateTime(obj.startDate); blocks.push(obj);
      });
    }
    const selected = blocks.filter((item) => scoreSelectRelevance(item) >= 2 && item.eventName);
    return { all: blocks, selected };
  };

  const showParserPreview = (result) => {
    const lines = []; lines.push(`Parsed event blocks: ${result.all.length}`); lines.push(`Auto-selected as SELECT-related: ${result.selected.length}`); lines.push('');
    result.selected.slice(0, 8).forEach((entry, idx) => {
      lines.push(`${idx + 1}. ${entry.eventName || '(Untitled)'}`); lines.push(`   ${entry.startDate || '—'} → ${entry.endDate || '—'}`);
      lines.push(`   Location: ${entry.location || '—'} | Event Location: ${entry.eventLocation || '—'}`); lines.push(`   Demo: ${entry.demo || '—'} | SELECT Resources: ${entry.selectResources || '—'}\n`);
    });
    if (!result.selected.length && result.all.length) lines.push('No entries passed the SELECT relevance filter. You can still copy a block into the form manually.');
    setParserPreview(lines.join('\n'));
  };

  const importParsed = async (result) => {
    let imported = 0;
    for (const entry of result.selected) {
      const exists = events.some((x) => (x.eventName || '') === (entry.eventName || '') && (x.startDate || '') === (entry.startDate || '') && (x.eventLocation || '') === (entry.eventLocation || ''));
      if (!exists) { await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_events'), { ...sanitizeEventData(entry), timestamp: new Date().toISOString() }); imported += 1; }
    }
    setImportBanner(imported ? `Imported ${imported} SELECT-related event(s) from BEO. Review and edit any mistakes below.` : 'No new SELECT-related events were imported. Check the parser preview and edit manually if needed.');
  };

  const parseAndImportBEO = async () => {
    let text = beoText || ''; const file = fileRef.current?.files?.[0];
    if (!text.trim() && file) {
      text = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = reject; reader.readAsText(file); });
      setBeoText(text);
    }
    if (!text.trim()) { showMsg("Paste BEO text or choose a text-based file first.", true); return; }
    const result = parseBEOText(text); showParserPreview(result); await importParsed(result); showMsg("BEO parser completed. Review imported entries below.");
  };

  return (
    <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-xl border border-gray-100 grid gap-8 animate-fade-in">
      
      <div className="bg-[#17132A] text-white border border-[#2A2254] rounded-[2rem] p-5 shadow-lg">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-black text-white uppercase italic tracking-tight flex items-center">
              <Upload size={18} className="mr-2 text-[#A3E635]" /> Import from BEO
            </h2>
            <p className="text-[#8C97BA] text-xs mt-2 font-bold italic">
              Paste BEO text or upload a text-based BEO export. Matching events are auto-populated into the live stream for review and editing.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <textarea
                value={beoText}
                onChange={(e) => setBeoText(e.target.value)}
                className="w-full h-44 p-4 rounded-2xl border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] resize-none outline-none text-sm font-mono transition"
                placeholder="Paste BEO text here..."
              />

              <div className="flex flex-col md:flex-row gap-2">
                <input ref={fileRef} type="file" accept=".txt,.csv,.json" className="flex-1 p-3 rounded-xl border border-[#3B2F75] bg-[#2A2254] text-[#C9D2F2] text-xs outline-none" />
                <button onClick={parseAndImportBEO} className="bg-[#A3E635] text-[#17132A] px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#8CD02F] transition shadow-lg flex items-center justify-center">
                  <Upload size={12} className="mr-2" /> Parse BEO
                </button>
              </div>

              <div className="p-3 rounded-xl border border-dashed border-[#3B2F75] bg-[#17132A] text-[11px] text-[#8C97BA] font-bold italic">
                This version keeps your existing Firebase/Auth/API wiring intact. BEO import works in-browser with pasted text or text-based files. No API changes needed.
              </div>

              <div className="flex flex-col md:flex-row gap-2">
                <textarea
                  id="ai-input"
                  className="flex-1 h-24 p-4 rounded-2xl border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] resize-none outline-none text-sm italic transition"
                  placeholder="Optional: use your current /api/ai route to extract a single BEO event with AI..."
                />
                <button onClick={handleAiAutoCommit} disabled={aiLoading} className="bg-[#424A9F] text-white px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#343D84] transition shadow-lg disabled:opacity-50 flex items-center justify-center min-w-[180px]">
                  <BrainCircuit size={12} className={`mr-2 ${aiLoading ? 'animate-spin' : 'text-[#A3E635]'}`} />
                  {aiLoading ? 'ANALYZING...' : 'AI EXTRACT'}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#8C97BA] italic">Parser Preview</div>
              <div className="h-[276px] overflow-auto rounded-2xl border border-[#3B2F75] bg-[#2A2254] text-white p-4 text-xs font-mono whitespace-pre-wrap custom-scrollbar">
                {parserPreview}
              </div>
            </div>
          </div>
        </div>
      </div>

      
      <div className="grid lg:grid-cols-[1.15fr,.85fr] gap-8">
        
        <div className="space-y-8">
          <div className="bg-[#17132A] text-white border border-[#2A2254] rounded-[2rem] p-5 shadow-lg">
            <div className="flex flex-col lg:flex-row justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-black text-white uppercase italic tracking-tight flex items-center">
                  <ClipboardList size={18} className="mr-2 text-[#A3E635]" /> Team Event Intake
                </h2>
                <p className="text-[#8C97BA] text-xs mt-2 font-bold italic">
                  Designed for all SELECT teams to log weekly support consistently while keeping the same Firestore collections and API route you already use.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {['Demo', 'Client', 'Leadership', 'Workshop'].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => updateField('sessionType', type)}
                    className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition ${formData.sessionType === type ? 'bg-[#A3E635] text-[#17132A]' : 'bg-[#2A2254] border border-[#3B2F75] text-[#C9D2F2] hover:border-[#424A9F]'}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#2A2254] border border-[#3B2F75] text-sm text-[#E9DFFF] font-bold italic">
              {importBanner}
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
              {QUICK_FILL_CARDS.map((card) => (
                <button
                  key={card.name}
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, demo: card.demo, sessionType: card.sessionType }))}
                  className="text-left p-4 rounded-2xl border bg-[#2A2254] border-[#3B2F75] text-[#C9D2F2] hover:border-[#A3E635] transition shadow-sm group"
                >
                  <div className="font-black uppercase text-xs italic text-white group-hover:text-[#A3E635] transition">{card.name}</div>
                  <div className="text-[10px] text-[#8C97BA] font-bold italic mt-1">{card.note}</div>
                </button>
              ))}
            </div>

            <form onSubmit={handleCommit} className="space-y-4 font-bold text-sm italic mt-6">
              <div className="grid md:grid-cols-2 gap-4">
                <input value={formData.eventName} onChange={(e) => updateField('eventName', e.target.value)} placeholder="Event Name*" required className="w-full p-4 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none transition" />
                <input value={formData.eventPoc} onChange={(e) => updateField('eventPoc', e.target.value)} placeholder="Event POC*" required className="w-full p-4 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none transition" />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="text-[9px] font-black uppercase text-[#8C97BA]">
                  Start Date
                  <input value={formData.startDate} onChange={(e) => updateField('startDate', e.target.value)} type="datetime-local" required className="w-full p-4 mt-1 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none transition" />
                </div>
                <div className="text-[9px] font-black uppercase text-[#8C97BA]">
                  End Date
                  <input value={formData.endDate} onChange={(e) => updateField('endDate', e.target.value)} type="datetime-local" required className="w-full p-4 mt-1 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none transition" />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <select value={formData.selectPoc} onChange={(e) => updateField('selectPoc', e.target.value)} className="p-4 border border-[#3B2F75] bg-[#2A2254] text-white focus:border-[#A3E635] rounded-2xl outline-none transition">
                  <option value="">SELECT Lead...</option>
                  {TEAM_MEMBERS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input value={formData.location} onChange={(e) => updateField('location', e.target.value)} placeholder="Location" className="p-4 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none transition" />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <select value={formData.eventLocation} onChange={(e) => updateField('eventLocation', e.target.value)} className="p-4 border border-[#3B2F75] bg-[#2A2254] text-white focus:border-[#A3E635] rounded-2xl outline-none transition">
                  <option value="">Room Location...</option>
                  {ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={formData.classification} onChange={(e) => updateField('classification', e.target.value)} className="p-4 border border-[#3B2F75] bg-[#2A2254] text-white focus:border-[#A3E635] rounded-2xl outline-none transition">
                  {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <select value={formData.sessionType} onChange={(e) => updateField('sessionType', e.target.value)} className="p-4 border border-[#3B2F75] bg-[#2A2254] text-white focus:border-[#A3E635] rounded-2xl outline-none transition">
                  {SESSION_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <input value={formData.attendees} onChange={(e) => updateField('attendees', e.target.value)} placeholder="Attendees" className="p-4 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none transition" />
              </div>

              <input value={formData.demo} onChange={(e) => updateField('demo', e.target.value)} placeholder="Demo Requirements" className="w-full p-4 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none transition" />
              <input value={formData.selectResources} onChange={(e) => updateField('selectResources', e.target.value)} placeholder="SELECT Resources" className="w-full p-4 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none transition" />

              <div className="grid md:grid-cols-2 gap-4">
                <input value={formData.sessionDays} onChange={(e) => updateField('sessionDays', e.target.value)} placeholder="Session Days" className="p-4 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none transition" />
                <select value={formData.sessionSupportDuration} onChange={(e) => updateField('sessionSupportDuration', e.target.value)} className="p-4 border border-[#3B2F75] bg-[#2A2254] text-white focus:border-[#A3E635] rounded-2xl outline-none transition">
                  <option value="">Support Duration...</option>
                  {DURATION_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <select value={formData.supportTeam} onChange={(e) => updateField('supportTeam', e.target.value)} className="p-4 border border-[#3B2F75] bg-[#2A2254] text-white focus:border-[#A3E635] rounded-2xl outline-none transition">
                  {SUPPORT_TEAMS.map((team) => <option key={team} value={team}>{team}</option>)}
                </select>
                <div className="text-[9px] font-black uppercase text-[#8C97BA]">
                  Week Of
                  <input value={formData.weekOf} onChange={(e) => updateField('weekOf', e.target.value)} type="date" className="w-full p-4 mt-1 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none transition" />
                </div>
              </div>

              <textarea value={formData.notes} onChange={(e) => updateField('notes', e.target.value)} placeholder="Notes / dependencies / setup details..." rows="4" className="w-full p-4 border border-[#3B2F75] bg-[#2A2254] text-white placeholder-gray-400 focus:border-[#A3E635] rounded-2xl outline-none resize-none transition"></textarea>

              <div className="flex gap-2 flex-wrap">
                <button type="submit" className={`flex-1 ${editingId ? 'bg-[#A3E635] text-[#17132A] hover:bg-[#8CD02F]' : 'bg-[#424A9F] text-white hover:bg-[#343D84]'} font-black py-4 rounded-2xl shadow-xl transition uppercase italic mt-2 flex items-center justify-center`}>
                  {editingId ? 'Update Intel' : 'Commit Intel'}
                </button>
                {editingId && (
                  <button type="button" onClick={resetForm} className="flex-none px-6 bg-[#2A2254] font-black py-4 rounded-2xl shadow-xl transition uppercase italic mt-2 text-[#8C97BA] flex items-center hover:bg-gray-800 hover:text-red-400 border border-[#3B2F75]">
                    <RefreshCcw size={14} className="mr-2" /> Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        
        <div className="space-y-8">
          <div className="bg-[#17132A] text-white border border-[#2A2254] rounded-[2rem] p-5 shadow-lg">
            <h2 className="text-xl font-black text-white uppercase italic tracking-tight flex items-center">
              <BarChart3 size={18} className="mr-2 text-[#A3E635]" /> Quick Stats
            </h2>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <StatCard icon={<ClipboardList size={18} />} value={totalStats.events} label="Events" />
              <StatCard icon={<Upload size={18} />} value={totalStats.imported} label="Imported" />
              <StatCard icon={<Users size={18} />} value={totalStats.attendees} label="Attendees" />
              <StatCard icon={<TrendingUp size={18} />} value={totalStats.high} label="Client / Leadership" />
            </div>
          </div>

          <div className="bg-[#17132A] text-white border border-[#2A2254] rounded-[2rem] p-5 shadow-lg">
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-xl font-black text-white uppercase italic tracking-tight flex items-center">
                  <Search size={18} className="mr-2 text-[#A3E635]" /> Weekly Event Queue
                </h2>
                <p className="text-[#8C97BA] text-xs mt-2 font-bold italic">
                  Imported + manual events. Search, filter, then edit or copy the full intel.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 rounded-2xl border border-[#3B2F75] bg-[#2A2254] p-3 focus-within:border-[#A3E635] transition">
                  <Search size={14} className="text-[#8C97BA]" />
                  <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search event, POC, demo, location..." className="w-full bg-transparent outline-none text-sm text-white placeholder-gray-500" />
                </div>

                <div className="flex flex-wrap gap-2">
                  <select value={classificationFilter} onChange={(e) => setClassificationFilter(e.target.value)} className="flex-1 min-w-[180px] p-3 rounded-xl bg-[#2A2254] border border-[#3B2F75] text-[#C9D2F2] outline-none focus:border-[#A3E635]">
                    <option value="">All classifications</option>
                    {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>

                  {['', 'Imported', 'Manual'].map((src) => (
                    <button
                      key={src || 'all'}
                      type="button"
                      onClick={() => setSourceFilter(src)}
                      className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition border border-[#3B2F75] ${sourceFilter === src ? 'bg-[#A3E635] text-[#17132A]' : 'bg-[#2A2254] text-[#C9D2F2] hover:border-[#424A9F]'}`}
                    >
                      <Filter size={10} className="inline mr-1" /> {src || 'All Sources'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 overflow-y-auto max-h-[72vh] pr-2 custom-scrollbar">
            {!filteredEvents.length && (
              <div className="p-8 rounded-3xl border-2 border-dashed border-gray-200 bg-gray-50 text-center text-slate-400 font-black uppercase text-xs tracking-widest italic">
                No events yet. Import a BEO or add an event manually.
              </div>
            )}

            {filteredEvents.map((entry) => {
              const badgeColor = classBadgeColor(entry.classification);
              return (
                <div key={entry.id} className={`bg-white p-5 rounded-2xl shadow-md border-l-8 ${editingId === entry.id ? 'border-[#A3E635] bg-lime-50/20' : 'border-[#424A9F]'} flex justify-between items-start group transition border border-gray-50 hover:bg-indigo-50/50`}>
                  <div className="flex-1 pr-4">
                    <p className="font-black text-slate-800 uppercase text-xs italic leading-none mb-1">{entry.eventName}</p>

                    <div className="flex flex-wrap gap-2 mt-2 mb-3">
                      <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest" style={{ backgroundColor: `${badgeColor}20`, color: badgeColor, border: `1px solid ${badgeColor}` }}>
                        {entry.classification || 'Unclassified'}
                      </span>
                      <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-500">{entry.sessionType || 'Session'}</span>
                      <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-500">{entry.source || 'Manual'}</span>
                    </div>

                    <p className="text-[10px] text-gray-400 font-bold uppercase italic flex items-center"><CalendarDays size={10} className="mr-1" /> {entry.startDate || '—'} {entry.endDate ? `→ ${entry.endDate}` : ''}</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase italic mt-1 flex items-center"><User size={10} className="mr-1" /> {entry.eventPoc || 'No POC'} | SELECT: {entry.selectPoc || 'TBD'}</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase italic mt-1 flex items-center"><MapPin size={10} className="mr-1" /> {entry.location || 'NYIH'} • {entry.eventLocation || 'No room set'}</p>

                    {(entry.demo || entry.selectResources) && (
                      <p className="text-[10px] text-gray-500 font-bold italic mt-2 line-clamp-2">
                        Demo: {entry.demo || '—'} • Resources: {entry.selectResources || '—'}
                      </p>
                    )}

                    <div className="flex gap-2 mt-3 flex-wrap">
                      <button onClick={() => startEdit(entry)} className="text-[9px] text-[#424A9F] font-black uppercase hover:text-[#A3E635] transition-all flex items-center"><Edit3 size={10} className="mr-1" /> Edit</button>
                      <button onClick={() => openFullIntel(entry)} className="text-[9px] text-indigo-500 font-black uppercase hover:text-[#A3E635] transition-all flex items-center"><FileText size={10} className="mr-1" /> View Full Intel</button>
                    </div>
                  </div>

                  <button onClick={async () => { if(window.confirm("Archive entry?")) await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_events', entry.id)); }} className="text-gray-200 hover:text-red-500 transition p-2">
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- TECH FEED / ISSUES PAGE --- */
function IssuesPage({ issues, showMsg, fetchGemini }) {
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [analysis, setAnalysis] = useState('');

  const runRiskAnalysis = async () => {
    if (!issues.length) { setAnalysis("No blockers logged. Operations are nominal."); return; }
    setIsAnalysing(true);
    const context = issues.map(i => `${i.title}: ${i.desc} (Urgency: ${i.urgency})`).join(' | ');
    const result = await fetchGemini("Act as an Accenture technical lead. Provide a 2-sentence operational risk analysis based strictly on these active infrastructure blockers.", context);
    setAnalysis(result);
    setIsAnalysing(false);
  };

  const handleAddIssue = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { title: fd.get('t'), desc: fd.get('d'), urgency: fd.get('u'), timestamp: new Date().toISOString() };
    if (data.title) {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_issues'), data);
      e.target.reset(); showMsg("Blocker successfully logged to the Tech Feed.");
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-8 animate-fade-in">
      <div className="bg-white p-6 md:p-8 rounded-[3rem] shadow-2xl border border-gray-100">
        <h2 className="text-2xl font-black text-[#17132A] mb-6 uppercase italic flex items-center">
          <BrainCircuit className="mr-3 text-[#A3E635]" /> Log Infrastructure Blocker
        </h2>
        <p className="text-xs text-slate-500 font-bold italic mb-6">Record operational bottlenecks, AV failures, or client-facing blockers directly into the live intelligence feed.</p>
        <form onSubmit={handleAddIssue} className="grid gap-4 font-bold text-sm italic">
          <input name="t" placeholder="Alert Title*" required className="p-4 border-2 rounded-2xl bg-gray-50 outline-none focus:border-[#424A9F]" />
          <textarea name="d" placeholder="Provide context, impact, or required dependencies..." required className="p-4 border-2 rounded-2xl bg-gray-50 outline-none resize-none h-32 custom-scrollbar focus:border-[#424A9F]" />
          <select name="u" className="p-4 border-2 rounded-2xl bg-gray-50 outline-none text-slate-600 focus:border-[#424A9F]">
            <option value="Normal">Normal Urgency</option>
            <option value="High">High Urgency</option>
            <option value="Urgent">Urgent / Showstopper</option>
          </select>
          <button type="submit" className="bg-[#17132A] text-[#A3E635] font-black py-4 rounded-2xl shadow-xl uppercase italic mt-2 hover:bg-[#2A2254] transition tracking-widest">
            Log into System
          </button>
        </form>
      </div>

      <div className="bg-gray-50 p-6 md:p-8 rounded-[3rem] shadow-inner border border-gray-100">
        <div className="mb-6 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#424A9F]">AI Risk Intel</span>
            <button onClick={runRiskAnalysis} className="text-[8px] bg-white border border-gray-100 px-3 py-1 rounded-full font-black uppercase text-gray-400 hover:text-[#424A9F] transition">Refresh Analysis</button>
          </div>
          <p className="text-[11px] text-slate-500 font-bold italic leading-relaxed">{isAnalysing ? "Analyzing trends..." : (analysis || "Log blockers to unlock intelligence.")}</p>
        </div>
        <div className="space-y-4 overflow-y-auto max-h-[400px] pr-2 custom-scrollbar">
          {issues.map(i => (
            <div key={i.id} className={`p-6 bg-white rounded-3xl shadow-md transition border-l-8 ${i.urgency?.includes('Urgent') ? 'border-red-600 bg-red-50/20' : i.urgency === 'High' ? 'border-yellow-400 bg-yellow-50/20' : 'border-[#424A9F] hover:bg-slate-50'}`}>
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-black text-slate-800 uppercase text-xs tracking-tight italic leading-tight">"{i.title}"</h3>
                <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_issues', i.id))} className="text-slate-200 hover:text-red-500 transition p-1"><Trash2 size={12} /></button>
              </div>
              <p className="text-[11px] text-slate-500 font-bold italic line-clamp-2 leading-relaxed">"{i.desc}"</p>
              <div className="mt-4">
                <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase shadow-sm tracking-widest ${i.urgency?.includes('Urgent') ? 'bg-red-600 text-white' : i.urgency === 'High' ? 'bg-yellow-400 text-yellow-900' : 'bg-[#17132A] text-white'}`}>{i.urgency}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --- ANALYTICS DASHBOARD --- */
function AnalyticsDashboard({ events, tasks }) {
  const stats = useMemo(() => {
    const data = TEAM_MEMBERS.reduce((acc, name) => { acc[name] = { hours: 0, impact: 0 }; return acc; }, {});
    const parseHours = (str) => { if (!str) return 0; const match = String(str).match(/[\d.]+/); return match ? parseFloat(match[0]) : 0; };
    events.forEach((e) => { if (data[e.selectPoc]) data[e.selectPoc].hours += parseHours(e.sessionSupportDuration); });
    tasks.forEach((t) => { if (data[t.assignee]) data[t.assignee].hours += parseHours(t.timeSpent); });
    return data;
  }, [events, tasks]);

  const totalHours = Object.values(stats).reduce((acc, s) => acc + s.hours, 0);
  const maxHours = Math.max(...Object.values(stats).map((s) => s.hours), 1);
  let cumulativePercent = 0;
  const pieSlices = TEAM_MEMBERS.map((name, i) => {
    const hours = stats[name].hours; const percent = totalHours > 0 ? (hours / totalHours) : 0;
    const [startX, startY] = [Math.cos(2 * Math.PI * cumulativePercent), Math.sin(2 * Math.PI * cumulativePercent)];
    cumulativePercent += percent;
    const [endX, endY] = [Math.cos(2 * Math.PI * cumulativePercent), Math.sin(2 * Math.PI * cumulativePercent)];
    const largeArcFlag = percent > 0.5 ? 1 : 0;
    const colors = ["#424A9F", "#A3E635", "#6366f1", "#17132A"];
    return { path: `M ${startX} ${startY} A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY} L 0 0`, color: colors[i % colors.length], label: name, percent: (percent * 100).toFixed(0) };
  });

  return (
    <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100 grid md:grid-cols-2 gap-12 animate-fade-in">
      <div>
        <h2 className="text-2xl font-black text-[#17132A] mb-8 uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8 flex items-center leading-none">
          <BarChart3 className="mr-3" /> Team Utilization
        </h2>
        <div className="space-y-8">
          {TEAM_MEMBERS.map((name) => (
            <div key={name}>
              <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 mb-2 italic"><span>{name}</span><span className="text-[#424A9F]">{stats[name].hours.toFixed(1)} hrs</span></div>
              <div className="w-full bg-gray-100 h-4 rounded-full border border-gray-200"><div className="bg-[#424A9F] h-full transition-all duration-1000 border-r-4 border-[#A3E635]" style={{ width: `${(stats[name].hours / maxHours) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-center">
        <h2 className="text-2xl font-black text-[#17132A] mb-8 uppercase italic flex items-center self-start">
          <PieIcon className="mr-3 text-[#A3E635]" /> Distribution
        </h2>
        <div className="relative w-48 h-48 mb-8">
          <svg viewBox="-1.2 -1.2 2.4 2.4" style={{ transform: 'rotate(-90deg)' }} className="w-full h-full drop-shadow-xl">
            {totalHours > 0 ? pieSlices.map((slice, i) => (<path key={i} d={slice.path} fill={slice.color} className="transition-all hover:opacity-80" />)) : <circle r="1" fill="#f3f4f6" />}
          </svg>
        </div>
        <div className="grid grid-cols-2 gap-4 w-full">
          {pieSlices.map((slice, i) => (
            <div key={i} className="flex items-center text-[10px] font-black uppercase italic text-slate-500">
              <div className="w-3 h-3 mr-2 rounded-sm shadow-sm border border-gray-200" style={{ backgroundColor: slice.color }} />{slice.label}: {slice.percent}%
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
