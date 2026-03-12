import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  signInWithCustomToken,
  signInAnonymously
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
  orderBy
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
  Clipboard,
  FileText,
  BarChart3,
  Flame,
  PieChart as PieIcon,
  Calendar,
  Info,
  Clock
} from 'lucide-react';

/**
 * CONFIGURATION & CONSTANTS
 */
const TEAM_MEMBERS = ["Eric.Guzman", "Tommy.Flinch", "Donald.Salazar", "Mistral.Rojas"];
const DURATION_OPTIONS = ["0.5 Hours", "1 Hour", "2 Hours", "4 Hours", "6 Hours", "8 Hours", "Full Day (10h)", "Multi-Day"];

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
    if (!firebaseConfig.apiKey) {
      setLoading(false);
      return;
    }

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else if (!auth.currentUser) {
          try { await signInAnonymously(auth); } catch (err) { console.warn("Manual login required."); }
        }
      } catch (err) { console.error("Auth init failed:", err); }
    };

    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !firebaseConfig.apiKey) return;
    const path = (col) => collection(db, 'artifacts', appId, 'public', 'data', col);

    const unsubEvents = onSnapshot(query(path('shared_events'), orderBy('timestamp', 'desc')), (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubTasks = onSnapshot(query(path('shared_tasks'), orderBy('timestamp', 'desc')), (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubIssues = onSnapshot(query(path('shared_issues'), orderBy('timestamp', 'desc')), (snap) => {
      setIssues(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubEvents(); unsubTasks(); unsubIssues(); };
  }, [user]);

  const showMsg = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage({ text: '', isError: false }), 5000);
  };

  const fetchGemini = async (prompt, isJson = false) => {
    if (!aiEnabled || !GEMINI_API_KEY) return isJson ? {} : "AI Service Unavailable";
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: isJson ? { responseMimeType: "application/json" } : {}
        })
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return isJson ? JSON.parse(text) : text;
    } catch (e) { return isJson ? {} : "AI Connection Failure."; }
  };

  const generateLeadBriefing = async () => {
    if (!aiEnabled) return;
    setIsBriefingLoading(true);
    const eventContext = events.slice(0, 3).map(e => e.eventName).join(', ');
    const taskContext = tasks.filter(t => t.status === 'doing').map(t => t.title).join(', ');
    const blockerContext = issues.filter(i => i.urgency === 'Urgent').map(i => i.title).join(', ');

    const briefing = await fetchGemini(`Act as an Accenture PM. Provide exactly TWO professional bullet points summarizing status: Events (${eventContext}), Active Tasks (${taskContext}), Blockers (${blockerContext}). Style: High-performance.`);
    
    setModal({ title: "Leadership Intelligence Brief", content: briefing, action: () => { navigator.clipboard.writeText(briefing); showMsg("Summary copied."); } });
    setIsBriefingLoading(false);
  };

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 text-slate-500">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#424A9F]"></div>
      <p className="mt-4 font-bold uppercase tracking-widest text-[10px]">Synchronizing Hub...</p>
    </div>
  );

  if (!firebaseConfig.apiKey) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-sans text-slate-900">
      <div className="max-w-md w-full bg-white p-10 rounded-[2.5rem] shadow-2xl text-center border-t-8 border-red-500">
        <AlertCircle size={48} className="mx-auto text-red-500 mb-4" />
        <h1 className="text-2xl font-black text-[#424A9F] mb-4 uppercase italic">Config Sync Error</h1>
        <button onClick={() => window.location.reload()} className="w-full bg-gray-100 py-3 rounded-xl font-bold uppercase text-xs hover:bg-gray-200 transition">Retry Sync</button>
      </div>
    </div>
  );

  if (!user) return <AuthPage showMsg={showMsg} />;

  return (
    <div className="min-h-screen bg-gray-100 p-4 flex flex-col items-center font-sans text-slate-900">
      <div className="w-full max-w-6xl bg-white p-6 rounded-[2rem] shadow-xl mb-6 border border-gray-50">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl font-black text-[#424A9F] uppercase italic tracking-tighter leading-none">Accenture Hub</h1>
          <div className="flex items-center space-x-4">
            <button onClick={generateLeadBriefing} disabled={isBriefingLoading} className="bg-[#424A9F] text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#343D84] transition shadow-lg disabled:opacity-50">
              <Zap size={12} className={`mr-2 text-[#A3E635] ${isBriefingLoading ? 'animate-spin' : ''}`} />
              {isBriefingLoading ? 'Syncing...' : 'Lead Update'}
            </button>
            <button onClick={() => signOut(auth)} className="bg-gray-100 text-gray-400 font-bold px-4 py-2 rounded-xl hover:text-red-500 transition text-[10px] uppercase tracking-widest flex items-center shadow-sm">
              <LogOut size={12} className="mr-2" /> Logout
            </button>
          </div>
        </div>
        <p className="text-center text-gray-400 font-bold uppercase text-[10px] tracking-[0.3em] mb-6">High Performance. Delivered.</p>
        <div className="flex justify-center space-x-2">
          <NavBtn active={currentPage === 'schedule'} onClick={() => setCurrentPage('schedule')} label="Meetings" />
          <NavBtn active={currentPage === 'kanban'} onClick={() => setCurrentPage('kanban')} label="Task Board" />
          <NavBtn active={currentPage === 'issues'} onClick={() => setCurrentPage('issues')} label="Tech Feed" />
          <NavBtn active={currentPage === 'analytics'} onClick={() => setCurrentPage('analytics')} label="Team Insights" icon={<BarChart3 size={12} />} />
        </div>
      </div>

      <div className="w-full max-w-6xl flex-grow">
        {currentPage === 'schedule' && <SchedulePage events={events} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} />}
        {currentPage === 'kanban' && <KanbanPage tasks={tasks} showMsg={showMsg} />}
        {currentPage === 'issues' && <IssuesPage issues={issues} showMsg={showMsg} />}
        {currentPage === 'analytics' && <AnalyticsDashboard events={events} tasks={tasks} />}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => setModal(null)}>
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl max-w-xl w-full border border-gray-100" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-[#424A9F] mb-6 uppercase italic border-b pb-2 flex items-center">
              <Zap size={20} className="mr-2 text-[#A3E635]" /> {modal.title}
            </h3>
            <div className="text-gray-700 text-sm italic whitespace-pre-wrap leading-relaxed font-mono bg-gray-50 p-6 rounded-2xl border border-gray-100 shadow-inner">
              {modal.content}
            </div>
            <div className="flex gap-2 mt-8">
              {modal.action && (
                <button onClick={modal.action} className="flex-1 bg-[#A3E635] text-[#424A9F] font-black py-3 rounded-xl hover:bg-[#8CD02F] uppercase text-xs italic shadow-md transition-all flex items-center justify-center">
                  <Clipboard size={14} className="mr-2" /> Copy Data
                </button>
              )}
              <button onClick={() => setModal(null)} className="flex-1 bg-gray-100 font-bold py-3 rounded-xl hover:bg-gray-200 uppercase text-xs italic">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavBtn({ active, onClick, label, icon }) {
  return (
    <button onClick={onClick} className={`px-6 py-2.5 rounded-xl font-black uppercase text-xs tracking-widest transition-all flex items-center ${active ? 'bg-[#A3E635] text-[#424A9F] shadow-lg scale-105' : 'bg-gray-100 text-gray-500'}`}>
      {icon && <span className="mr-2">{icon}</span>} {label}
    </button>
  );
}

/* --- ANALYTICS DASHBOARD --- */

function AnalyticsDashboard({ events, tasks }) {
  const stats = useMemo(() => {
    const data = TEAM_MEMBERS.reduce((acc, name) => {
      acc[name] = { events: 0, tasks: 0, hours: 0 };
      return acc;
    }, {});

    const parseHours = (str) => {
      if (!str) return 0;
      const match = str.match(/[\d.]+/);
      return match ? parseFloat(match[0]) : 0;
    };

    events.forEach(e => {
      if (data[e.selectPoc]) {
        data[e.selectPoc].events += 1;
        data[e.selectPoc].hours += parseHours(e.sessionSupportDuration);
      }
    });

    tasks.forEach(t => {
      if (data[t.assignee]) {
        data[t.assignee].tasks += 1;
        data[t.assignee].hours += parseHours(t.timeSpent);
      }
    });

    return data;
  }, [events, tasks]);

  const totalHours = Object.values(stats).reduce((acc, s) => acc + s.hours, 0);
  const maxHours = Math.max(...Object.values(stats).map(s => s.hours), 1);

  // SVG Pie Chart Calculation
  let cumulativePercent = 0;
  const pieSlices = TEAM_MEMBERS.map((name, i) => {
    const hours = stats[name].hours;
    const percent = totalHours > 0 ? (hours / totalHours) : 0;
    const [startX, startY] = getCoordinatesForPercent(cumulativePercent);
    cumulativePercent += percent;
    const [endX, endY] = getCoordinatesForPercent(cumulativePercent);
    const largeArcFlag = percent > 0.5 ? 1 : 0;
    const colors = ["#424A9F", "#A3E635", "#6366f1", "#f59e0b"];

    function getCoordinatesForPercent(percent) {
      const x = Math.cos(2 * Math.PI * percent);
      const y = Math.sin(2 * Math.PI * percent);
      return [x, y];
    }

    return { 
      path: `M 1 0 A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY} L 0 0`, 
      color: colors[i % colors.length],
      label: name,
      percent: (percent * 100).toFixed(0)
    };
  });

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100 grid md:grid-cols-2 gap-12">
        <div>
          <h2 className="text-2xl font-black text-[#424A9F] mb-8 uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8 flex items-center leading-none">
            <BarChart3 className="mr-3" /> Utilization
          </h2>
          <div className="space-y-8">
            {TEAM_MEMBERS.map(name => (
              <div key={name}>
                <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 mb-2 italic">
                  <span>{name}</span>
                  <span className="text-[#424A9F]">{stats[name].hours.toFixed(1)} Total Hours</span>
                </div>
                <div className="w-full bg-gray-100 h-4 rounded-full overflow-hidden shadow-inner border border-gray-200">
                  <div 
                    className="bg-[#424A9F] h-full transition-all duration-1000 border-r-4 border-[#A3E635]" 
                    style={{ width: `${(stats[name].hours / maxHours) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center">
          <h2 className="text-2xl font-black text-[#424A9F] mb-8 uppercase italic flex items-center self-start">
            <PieIcon className="mr-3" /> Distribution
          </h2>
          <div className="relative w-48 h-48 mb-8">
             <svg viewBox="-1 -1 2 2" style={{ transform: 'rotate(-90deg)' }} className="w-full h-full drop-shadow-xl">
                {totalHours > 0 ? pieSlices.map((slice, i) => (
                  <path key={i} d={slice.path} fill={slice.color} className="transition-all hover:opacity-80 cursor-help" />
                )) : <circle r="1" fill="#f3f4f6" />}
             </svg>
          </div>
          <div className="grid grid-cols-2 gap-4 w-full">
            {pieSlices.map((slice, i) => (
              <div key={i} className="flex items-center text-[10px] font-black uppercase italic text-slate-500">
                <div className="w-3 h-3 mr-2 rounded-sm" style={{ backgroundColor: slice.color }} />
                {slice.label}: {slice.percent}%
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100">
        <h2 className="text-2xl font-black text-[#424A9F] mb-8 uppercase italic flex items-center leading-none">
          <Flame className="mr-3 text-orange-500" /> Intensity Heatmap
        </h2>
        <div className="grid grid-cols-6 gap-4">
          <div className="col-span-1"></div>
          {["MON", "TUE", "WED", "THU", "FRI"].map(d => <div key={d} className="text-center font-black text-[10px] text-gray-300 tracking-widest">{d}</div>)}
          {TEAM_MEMBERS.map(name => (
            <React.Fragment key={name}>
              <div className="text-[9px] font-black text-[#424A9F] flex items-center italic">{name.split('.')[0]}</div>
              {[1, 2, 3, 4, 5].map(day => {
                const weight = (stats[name].events * 2 + stats[name].tasks);
                const intensity = weight > day * 2 ? "bg-[#424A9F] shadow-indigo-200" : (weight > 0 ? "bg-[#A3E635] shadow-lime-100" : "bg-gray-100");
                return <div key={day} className={`h-12 rounded-xl shadow-sm border border-gray-50 transition-all hover:scale-110 ${intensity}`} />
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --- SCHEDULE PAGE (WITH EDITING) --- */

function SchedulePage({ events, showMsg, fetchGemini, setModal }) {
  const [aiLoading, setAiLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const formRef = useRef();

  const handleAdd = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_events'), { ...data, timestamp: new Date().toISOString() });
      e.target.reset();
      showMsg("Operational entry synchronized.");
    } catch (err) { showMsg(err.message, true); }
  };

  const handleUpdate = async (id) => {
    const data = Object.fromEntries(new FormData(formRef.current));
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_events', id), data);
      setEditingId(null);
      formRef.current.reset();
      showMsg("Operational data updated.");
    } catch (err) { showMsg(err.message, true); }
  };

  const startEdit = (e) => {
    setEditingId(e.id);
    setTimeout(() => {
      if (formRef.current) {
        Object.keys(e).forEach(key => {
          if (formRef.current.elements[key]) formRef.current.elements[key].value = e[key];
        });
      }
    }, 10);
  };

  const handleAiExtract = async () => {
    const text = document.getElementById('ai-input').value;
    if (!text.trim()) return;
    setAiLoading(true);
    const result = await fetchGemini(`Extract event details from BEO text into JSON. 
      Keys: eventName, startDate, endDate, eventPoc, selectPoc, location, eventLocation, classification, sessionType, attendees, demo, selectResources, sessionDays, sessionSupportDuration. 
      Input text: ${text}`, true);
    if (result && formRef.current) {
      Object.keys(result).forEach(key => { if (formRef.current.elements[key]) formRef.current.elements[key].value = result[key]; });
      showMsg("AI Handshake: Form auto-populated.");
    }
    setAiLoading(false);
  };

  const openDetails = (e) => {
    const content = `Event Name: ${e.eventName || ''}
Start Date: ${e.startDate || ''}
End Date: ${e.endDate || ''}
Event POC: ${e.eventPoc || ''}
SELECT POC: ${e.selectPoc || ''}
Location: ${e.location || 'NYIH'}
Event Location: ${e.eventLocation || ''}
Classification: ${e.classification || ''}
Session Type: ${e.sessionType || ''}
Attendees: ${e.attendees || ''}
Demo: ${e.demo || ''}
SELECT Resources: ${e.selectResources || ''}
Session Days: ${e.sessionDays || ''}
Session Support Duration: ${e.sessionSupportDuration || ''}`;

    setModal({
      title: "Operational Data Intelligence",
      content: content,
      action: () => {
        navigator.clipboard.writeText(content);
        showMsg("Data copied for reporting.");
      }
    });
  };

  return (
    <div className="bg-white p-8 rounded-[2.5rem] shadow-xl grid md:grid-cols-2 gap-8 border border-gray-100">
      <div>
        <h2 className="text-xl font-black text-[#424A9F] mb-8 uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8">
          {editingId ? 'Edit Event Intel' : 'Intake Engine'}
        </h2>
        {!editingId && (
          <div className="p-5 bg-gray-50 rounded-[2rem] mb-8 border-2 border-dashed border-gray-200">
            <textarea id="ai-input" className="w-full h-24 p-4 rounded-2xl border-2 border-gray-200 bg-white resize-none outline-none focus:ring-2 focus:ring-[#A3E635] text-sm italic" placeholder="Paste BEO Stream for intelligence extraction..."></textarea>
            <button onClick={handleAiExtract} disabled={aiLoading} className="w-full mt-3 bg-[#A3E635] text-[#424A9F] font-black py-4 rounded-xl transition uppercase text-[10px] tracking-widest shadow-md flex items-center justify-center">
              <Zap size={14} className={`mr-2 ${aiLoading ? 'animate-spin text-[#424A9F]' : ''}`} />
              {aiLoading ? 'Analyzing...' : 'Execute AI Extract'}
            </button>
          </div>
        )}
        <form onSubmit={editingId ? (e) => { e.preventDefault(); handleUpdate(editingId); } : handleAdd} ref={formRef} className="space-y-4 font-bold text-sm italic">
          <div className="grid grid-cols-2 gap-4">
            <input name="eventName" placeholder="Event Name*" required className="p-4 border-2 rounded-2xl bg-gray-50 outline-none" />
            <input name="eventPoc" placeholder="Event Lead*" required className="p-4 border-2 rounded-2xl bg-gray-50 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-[9px] font-black uppercase text-gray-400">Start Date<input name="startDate" type="date" required className="w-full p-4 mt-1 border-2 rounded-2xl bg-gray-50 outline-none" /></div>
            <div className="text-[9px] font-black uppercase text-gray-400">End Date<input name="endDate" type="date" required className="w-full p-4 mt-1 border-2 rounded-2xl bg-gray-50 outline-none" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <select name="selectPoc" className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none">
                <option value="">SELECT Lead...</option>
                {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
             </select>
             <input name="location" defaultValue="NYIH" className="p-4 border-2 rounded-2xl bg-gray-50 outline-none" />
          </div>
          <input name="eventLocation" placeholder="Specific Room/Floor Designation" className="w-full p-4 border-2 rounded-2xl bg-gray-50 outline-none" />
          <div className="grid grid-cols-2 gap-4">
             <input name="classification" placeholder="Classification" className="p-4 border-2 rounded-2xl bg-gray-50 outline-none" />
             <input name="sessionType" placeholder="Session Type" className="p-4 border-2 rounded-2xl bg-gray-50 outline-none" />
          </div>
          <input name="attendees" placeholder="Attendees Count" className="w-full p-4 border-2 rounded-2xl bg-gray-50 outline-none" />
          <div className="grid grid-cols-2 gap-4">
             <input name="demo" placeholder="Demo Requirements" className="p-4 border-2 rounded-2xl bg-gray-50 outline-none" />
             <input name="selectResources" placeholder="SELECT Resources" className="p-4 border-2 rounded-2xl bg-gray-50 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
             <input name="sessionDays" placeholder="Session Days" className="p-4 border-2 rounded-2xl bg-gray-50 outline-none" />
             <select name="sessionSupportDuration" className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none">
                <option value="">Support Duration...</option>
                {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
             </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={`flex-1 ${editingId ? 'bg-[#A3E635] text-[#424A9F]' : 'bg-[#424A9F] text-white'} font-black py-4 rounded-2xl shadow-xl transition uppercase italic mt-4 hover:bg-opacity-90`}>
              {editingId ? 'Update Intel' : 'Commit Entry'}
            </button>
            {editingId && <button type="button" onClick={() => { setEditingId(null); formRef.current.reset(); }} className="flex-none px-6 bg-gray-100 font-black py-4 rounded-2xl shadow-xl transition uppercase italic mt-4 text-gray-400">Cancel</button>}
          </div>
        </form>
      </div>

      <div className="flex flex-col h-full">
        <h2 className="text-xl font-black text-[#424A9F] mb-6 uppercase italic leading-none">Operational Live Stream</h2>
        <div className="space-y-4 overflow-y-auto max-h-[75vh] pr-2 custom-scrollbar">
          {events.map(e => (
            <div key={e.id} className={`bg-white p-5 rounded-2xl shadow-md border-l-8 ${editingId === e.id ? 'border-[#A3E635] bg-lime-50/20' : 'border-[#424A9F]'} flex justify-between items-center group transition border border-gray-50 hover:bg-indigo-50/50`}>
              <div>
                <p className="font-black text-slate-800 uppercase text-xs italic leading-none mb-1">{e.eventName}</p>
                <p className="text-[10px] text-gray-400 font-bold uppercase mt-1 italic">{e.startDate} — {e.eventPoc}</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => startEdit(e)} className="text-[9px] text-[#424A9F] font-black uppercase hover:text-[#A3E635] transition-all flex items-center">
                    <Edit3 size={10} className="mr-1" /> Edit Intel
                  </button>
                  <button onClick={() => openDetails(e)} className="text-[9px] text-[#424A9F] font-black uppercase hover:text-[#A3E635] transition-all flex items-center">
                    <FileText size={10} className="mr-1" /> Details
                  </button>
                  <span className="text-[9px] font-black uppercase text-slate-400 italic">| {e.sessionSupportDuration || '0h'}</span>
                </div>
              </div>
              <button onClick={async () => { if(window.confirm("Archive entry?")) await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_events', e.id))}} className="text-gray-200 hover:text-red-500 transition p-2"><Trash2 size={16}/></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --- KANBAN PAGE (WITH DETAIL STRING) --- */

function KanbanPage({ tasks, showMsg }) {
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
    if (data.title) await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_tasks'), data);
    e.target.reset();
  };

  const updateTask = async (id, p) => { 
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', id), p); 
    setEditingId(null); 
  };

  const Col = ({ status, title, color }) => (
    <div className="bg-gray-100 p-6 rounded-[2.5rem] min-h-[500px] border-2 border-dashed border-gray-200 flex flex-col shadow-inner">
      <h3 className={`font-black text-[10px] tracking-[0.3em] text-center mb-8 uppercase italic border-b-2 pb-2 ${color} border-gray-200`}>{title}</h3>
      <div className="space-y-4 flex-grow overflow-y-auto">
        {tasks.filter(t => t.status === status).map(t => (
          <div key={t.id} className="bg-white p-5 rounded-2xl shadow-md border-b-4 border-slate-200 group transition hover:scale-105 border border-gray-50/50">
            {editingId === t.id ? (
               <div className="space-y-2">
                  <input id={`et-${t.id}`} defaultValue={t.title} className="w-full p-2 text-xs border rounded-lg italic font-bold outline-none" />
                  <textarea id={`edet-${t.id}`} defaultValue={t.details} placeholder="Task Intel..." className="w-full p-2 text-[10px] border rounded-lg italic outline-none min-h-[60px]" />
                  <div className="grid grid-cols-2 gap-2">
                    <select id={`ea-${t.id}`} defaultValue={t.assignee} className="w-full p-2 text-[10px] border rounded-lg italic outline-none">
                      <option value="">Assignee...</option>
                      {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select id={`edu-${t.id}`} defaultValue={t.timeSpent} className="w-full p-2 text-[10px] border rounded-lg italic outline-none">
                      <option value="">Time Spent...</option>
                      {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <input id={`ed-${t.id}`} type="date" defaultValue={t.dueDate} className="w-full p-2 text-[10px] border rounded-lg italic outline-none" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => updateTask(t.id, { 
                      title: document.getElementById(`et-${t.id}`).value, 
                      assignee: document.getElementById(`ea-${t.id}`).value,
                      dueDate: document.getElementById(`ed-${t.id}`).value,
                      timeSpent: document.getElementById(`edu-${t.id}`).value,
                      details: document.getElementById(`edet-${t.id}`).value
                    })} className="flex-1 bg-[#A3E635] text-[#424A9F] text-[10px] py-2 rounded-lg font-black uppercase italic shadow-sm">Save</button>
                    <button onClick={()=>setEditingId(null)} className="flex-1 bg-gray-100 text-gray-500 text-[10px] py-2 rounded-lg font-black uppercase italic">Cancel</button>
                  </div>
               </div>
            ) : (
              <>
                <p className="text-sm font-black text-slate-800 tracking-tight italic mb-2">"{t.title}"</p>
                {t.details && (
                  <p className="text-[10px] text-slate-500 italic mb-4 line-clamp-2 border-l-2 border-[#A3E635] pl-2">{t.details}</p>
                )}
                <div className="mt-2 space-y-1">
                  <div className="flex items-center text-[9px] font-bold text-[#424A9F] uppercase tracking-tighter italic">
                    <User size={10} className="mr-1.5 opacity-50" /> {t.assignee || 'Unassigned'}
                  </div>
                  <div className="flex items-center text-[9px] font-bold text-slate-400 uppercase tracking-tighter italic">
                    <Calendar size={10} className="mr-1.5 opacity-50" /> {t.dueDate || 'No Date'}
                  </div>
                  <div className="flex items-center text-[9px] font-bold text-[#A3E635] uppercase tracking-tighter italic">
                    <Clock size={10} className="mr-1.5 opacity-50" /> Spent: {t.timeSpent || '0h'}
                  </div>
                </div>
                <div className="mt-4 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-all">
                  <div className="flex space-x-1.5">
                    {status !== 'todo' && <button onClick={() => updateTask(t.id, { status: 'todo' })} className="p-1.5 bg-gray-50 rounded-lg hover:bg-[#424A9F] hover:text-white transition shadow-sm"><ChevronLeft size={10}/></button>}
                    {status !== 'complete' && <button onClick={() => updateTask(t.id, { status: status === 'todo' ? 'doing' : 'complete' })} className="p-1.5 bg-gray-50 rounded-lg hover:bg-[#424A9F] hover:text-white transition shadow-sm"><ChevronRight size={10}/></button>}
                  </div>
                  <div className="flex space-x-2 text-gray-300">
                    <button onClick={()=>setEditingId(t.id)} className="hover:text-blue-500 transition-colors p-1"><Edit3 size={12}/></button>
                    <button onClick={()=> { if(window.confirm("Delete task?")) deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', t.id))}} className="hover:text-red-500 transition-colors p-1"><Trash2 size={12}/></button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="bg-white p-10 rounded-[3.5rem] shadow-2xl border border-gray-100">
      <form onSubmit={handleAdd} className="flex flex-col gap-4 mb-12 max-w-4xl mx-auto bg-slate-50 p-6 rounded-[2rem] border-2 border-slate-200 shadow-inner">
        <input name="t" placeholder="Add Mission Objective..." required className="w-full p-4 bg-transparent font-black outline-none text-[#424A9F] italic text-sm border-b-2 border-slate-200" />
        <textarea name="det" placeholder="Task Intel / Details String..." className="w-full p-4 bg-transparent font-bold outline-none text-slate-500 italic text-xs border-b-2 border-slate-200 resize-none" rows="2"></textarea>
        <div className="grid md:grid-cols-4 gap-4">
          <select name="a" className="p-3 bg-white rounded-xl font-bold outline-none text-gray-500 text-xs border border-slate-200">
             <option value="">Assignee...</option>
             {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input name="d" type="date" className="p-3 bg-white rounded-xl font-bold outline-none text-gray-500 text-xs border border-slate-200" />
          <select name="du" className="p-3 bg-white rounded-xl font-bold outline-none text-gray-500 text-xs border border-slate-200">
             <option value="">Time Spent...</option>
             {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button type="submit" className="bg-[#424A9F] text-white py-3 rounded-xl font-black hover:bg-[#A3E635] hover:text-[#424A9F] transition shadow-lg italic uppercase text-xs">Push Task</button>
        </div>
      </form>
      <div className="grid md:grid-cols-3 gap-8"><Col status="todo" title="BACKLOG" color="text-slate-400" /><Col status="doing" title="ACTIVE" color="text-blue-500" /><Col status="complete" title="DELIVERED" color="text-[#A3E635]" /></div>
    </div>
  );
}

function IssuesPage({ issues, showMsg }) {
  const handleReport = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_issues'), { ...Object.fromEntries(fd.entries()), timestamp: new Date().toISOString() });
    e.target.reset();
    showMsg("Incident report dispatched.");
  };
  return (
    <div className="bg-white p-10 rounded-[3.5rem] shadow-2xl border border-gray-100 grid md:grid-cols-2 gap-12 animate-fade-in text-slate-900">
      <div>
        <h2 className="text-2xl font-black text-red-600 mb-8 uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8 leading-none">Log Blocker</h2>
        <form onSubmit={handleReport} className="space-y-6">
          <input name="title" placeholder="Summary of Tech Hurdle*" required className="w-full p-5 border-2 border-gray-100 rounded-3xl font-black bg-gray-50 focus:bg-white focus:border-red-500 transition outline-none text-sm italic" />
          <textarea name="desc" placeholder="Deep Technical State..." required rows="4" className="w-full p-5 border-2 border-gray-100 rounded-3xl font-bold bg-gray-50 focus:bg-white focus:border-red-500 transition outline-none resize-none text-sm italic"></textarea>
          <select name="urgency" className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-black text-slate-700 outline-none italic text-xs">
            <option>Low Tier</option><option selected>Medium Diagnostic</option><option>High Criticality</option><option>Urgent Blocker</option>
          </select>
          <button type="submit" className="w-full bg-red-600 text-white font-black py-5 rounded-3xl hover:bg-red-700 transition shadow-xl uppercase italic tracking-widest text-sm">Dispatch Diagnostic Protocol</button>
        </form>
      </div>
      <div className="flex flex-col h-full bg-slate-50 p-8 rounded-[3rem] border border-gray-200 shadow-inner">
        <h2 className="text-xl font-black text-slate-800 mb-8 uppercase italic border-b-2 border-slate-200 pb-2 tracking-tight leading-none">Intelligence Feed</h2>
        <div className="space-y-4 overflow-y-auto max-h-[550px] pr-2 custom-scrollbar">
          {issues.map(i => (
            <div key={i.id} className={`p-6 bg-white rounded-3xl shadow-md transition border-l-8 ${i.urgency?.includes('Urgent') ? 'border-red-600 bg-red-50/20' : 'border-yellow-400'}`}>
              <div className="flex justify-between items-start mb-4"><h3 className="font-black text-slate-800 uppercase text-xs tracking-tight italic leading-tight">"{i.title}"</h3><button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_issues', i.id))} className="text-slate-200 hover:text-red-500 transition p-1"><Trash2 size={12}/></button></div>
              <p className="text-[11px] text-slate-500 font-bold italic line-clamp-3 leading-relaxed">"${i.desc}"</p>
              <div className="flex justify-between items-center mt-6"><span className="px-3 py-1 rounded-full text-[8px] font-black uppercase bg-slate-800 text-white shadow-sm tracking-widest">{i.urgency}</span></div>
            </div>
          ))}
          {issues.length === 0 && <div className="text-center py-20 opacity-20 font-black uppercase text-[10px] tracking-widest leading-relaxed">Infrastructure Stable</div>}
        </div>
      </div>
    </div>
  );
}

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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-sans text-slate-900">
      <div className="w-full max-w-md bg-white p-10 rounded-[2.5rem] shadow-2xl border border-gray-100">
        <div className="flex justify-center mb-8 font-black"><div className="bg-[#A3E635] p-4 rounded-3xl text-[#424A9F] shadow-lg"><Layout size={32}/></div></div>
        <h1 className="text-3xl font-black text-center text-[#424A9F] mb-2 tracking-tighter uppercase italic">Accenture Hub</h1>
        <form onSubmit={authSubmit} className="space-y-4">
          <input name="email" type="email" placeholder="Corporate ID" required className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none focus:border-[#424A9F] bg-gray-50 font-bold" />
          <input name="password" type="password" placeholder="Key Phrase" required className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none focus:border-[#424A9F] bg-gray-50 font-bold" />
          <button type="submit" className={`w-full font-black py-4 rounded-2xl shadow-xl mt-4 ${isLogin ? 'bg-[#424A9F] text-white' : 'bg-[#A3E635] text-gray-900'}`}>{isLogin ? 'INITIATE LOGIN' : 'CREATE PROFILE'}</button>
        </form>
        <button onClick={() => setIsLogin(!isLogin)} className="w-full mt-8 text-xs font-black text-gray-400 hover:text-[#424A9F] uppercase tracking-widest">{isLogin ? "Register Access" : "Back to Login"}</button>
      </div>
    </div>
  );
}
