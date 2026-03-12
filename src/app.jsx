import React, { useState, useEffect, useRef } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut 
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
  ArrowRight, 
  LogOut, 
  User, 
  Search,
  Clipboard
} from 'lucide-react';

/**
 * ENVIRONMENT CONFIGURATION
 * Direct literal access for process.env is required for react-scripts to 
 * correctly inject keys during the build process.
 */
const getEnv = (key) => {
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key];
    }
    const metaEnv = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : null;
    if (metaEnv && metaEnv[key]) {
      return metaEnv[key];
    }
  } catch (e) {}
  return "";
};

const firebaseConfig = {
  apiKey: getEnv("VITE_FIREBASE_API_KEY") || getEnv("REACT_APP_FIREBASE_API_KEY"),
  authDomain: getEnv("VITE_FIREBASE_AUTH_DOMAIN") || getEnv("REACT_APP_FIREBASE_AUTH_DOMAIN"),
  projectId: getEnv("VITE_FIREBASE_PROJECT_ID") || getEnv("REACT_APP_FIREBASE_PROJECT_ID"),
  storageBucket: getEnv("VITE_FIREBASE_STORAGE_BUCKET") || getEnv("REACT_APP_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: getEnv("VITE_FIREBASE_MESSAGING_SENDER_ID") || getEnv("REACT_APP_FIREBASE_MESSAGING_SENDER_ID"),
  appId: getEnv("VITE_FIREBASE_APP_ID") || getEnv("REACT_APP_FIREBASE_APP_ID")
};

const GEMINI_API_KEY = getEnv("VITE_GEMINI_API_KEY") || getEnv("REACT_APP_GEMINI_API_KEY");
const appId = typeof __app_id !== 'undefined' ? __app_id : 'accenture-hub-v1';

// Initialize Firebase services safely
let auth = null;
let db = null;
const isConfigured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

if (isConfigured) {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  auth = getAuth(app);
  db = getFirestore(app);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('schedule');
  const [message, setMessage] = useState({ text: '', isError: false });
  const [aiEnabled, setAiEnabled] = useState(true);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const showMsg = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage({ text: '', isError: false }), 5000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#424A9F]"></div>
        <p className="mt-4 text-sm font-bold text-gray-500 uppercase tracking-widest leading-none italic">Synchronizing Hub...</p>
      </div>
    );
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-sans text-slate-900">
        <div className="max-w-md bg-white p-10 rounded-3xl shadow-2xl text-center border-t-8 border-[#424A9F]">
          <AlertCircle size={48} className="mx-auto text-red-500 mb-4" />
          <h1 className="text-2xl font-black mb-2 uppercase tracking-tighter italic">Configuration Error</h1>
          <p className="text-gray-600 mb-6 text-sm font-medium">Environment variables not detected. Please verify your Vercel Project Settings and trigger a new deployment.</p>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage showMsg={showMsg} />;

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-800 flex flex-col items-center p-4">
      <div className="w-full max-w-5xl bg-white p-6 rounded-2xl shadow-2xl mb-6">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl font-black text-[#424A9F] tracking-tighter uppercase italic leading-none">Accenture Hub</h1>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">AI Status</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
                <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#A3E635]"></div>
              </label>
            </div>
            <button onClick={() => signOut(auth)} className="bg-gray-100 text-gray-500 font-bold px-4 py-2 rounded-lg hover:bg-gray-200 transition text-[10px] flex items-center shadow-sm uppercase tracking-widest">
              <LogOut size={12} className="mr-2" /> EXIT
            </button>
          </div>
        </div>
        <p className="text-center text-gray-400 mb-6 font-bold uppercase text-[10px] tracking-[0.3em]">High Performance. Delivered.</p>
        <div className="flex justify-center mb-4 space-x-2">
          <TabButton active={currentPage === 'schedule'} onClick={() => setCurrentPage('schedule')} label="Meetings" />
          <TabButton active={currentPage === 'kanban'} onClick={() => setCurrentPage('kanban')} label="Task Board" />
          <TabButton active={currentPage === 'issues'} onClick={() => setCurrentPage('issues')} label="Tech Feed" />
        </div>
      </div>

      {message.text && (
        <div className={`w-full max-w-5xl p-4 mb-4 rounded-xl shadow-lg border-l-4 transition-all ${message.isError ? 'bg-red-50 border-red-500 text-red-700' : 'bg-blue-50 border-[#A3E635] text-blue-700'}`}>
          <p className="flex items-center font-bold text-sm italic">
            {message.isError ? <AlertCircle size={18} className="mr-2"/> : <CheckCircle2 size={18} className="mr-2 text-[#A3E635]"/>}
            {message.text}
          </p>
        </div>
      )}

      <div className="w-full max-w-5xl flex-grow mb-12">
        {currentPage === 'schedule' && <SchedulePage user={user} showMsg={showMsg} aiEnabled={aiEnabled} />}
        {currentPage === 'kanban' && <KanbanPage user={user} showMsg={showMsg} />}
        {currentPage === 'issues' && <IssuesPage user={user} showMsg={showMsg} />}
      </div>
    </div>
  );
}

const TabButton = ({ active, onClick, label }) => (
  <button onClick={onClick} className={`px-6 py-2.5 rounded-xl font-black uppercase text-xs tracking-widest transition-all ${active ? 'bg-[#A3E635] text-gray-900 shadow-lg scale-105' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'}`}>
    {label}
  </button>
);

function AuthPage({ showMsg }) {
  const [isLogin, setIsLogin] = useState(true);
  const formRef = useRef();
  const handleAuth = async (e) => {
    e.preventDefault();
    const data = new FormData(formRef.current);
    const email = data.get('email');
    const password = data.get('password');
    try {
      if (isLogin) await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) { showMsg(err.message, true); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-sans text-slate-900">
      <div className="w-full max-w-md bg-white p-10 rounded-[2.5rem] shadow-2xl border border-gray-100">
        <div className="flex justify-center mb-8"><div className="bg-[#A3E635] p-4 rounded-3xl text-[#424A9F] shadow-xl"><Layout size={40}/></div></div>
        <h1 className="text-3xl font-black text-center text-[#424A9F] mb-2 tracking-tighter uppercase italic">Accenture Hub</h1>
        <p className="text-center text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-10">Operations Center</p>
        <form ref={formRef} onSubmit={handleAuth} className="space-y-4">
          <input name="email" type="email" placeholder="Corporate ID" required className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none focus:border-[#424A9F] bg-gray-50 font-bold" />
          <input name="password" type="password" placeholder="Key Phrase" required className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none focus:border-[#424A9F] bg-gray-50 font-bold" />
          <button type="submit" className={`w-full font-black py-4 rounded-2xl transition shadow-xl mt-4 ${isLogin ? 'bg-[#424A9F] text-white' : 'bg-[#A3E635] text-gray-900'}`}>
            {isLogin ? 'INITIATE LOGIN' : 'CREATE ACCOUNT'}
          </button>
        </form>
        <button onClick={() => setIsLogin(!isLogin)} className="w-full mt-8 text-xs font-black text-gray-400 hover:text-[#424A9F] uppercase tracking-widest">{isLogin ? "Register Access" : "Return to Login"}</button>
      </div>
    </div>
  );
}

function SchedulePage({ user, showMsg, aiEnabled }) {
  const [events, setEvents] = useState([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [modalData, setModalData] = useState(null);

  useEffect(() => {
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'shared_events');
    return onSnapshot(query(q, orderBy('timestamp', 'desc')), (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_events'), { ...data, timestamp: new Date().toISOString() });
    e.target.reset();
    showMsg('Dashboard synchronized.');
  };

  return (
    <div className="grid md:grid-cols-2 gap-8 text-slate-900">
      <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-gray-100">
        <h2 className="text-xl font-black text-[#424A9F] mb-6 tracking-tighter uppercase italic leading-none underline decoration-[#A3E635] decoration-4 underline-offset-8">Intake Engine</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <input name="eventName" placeholder="Event Name*" required className="w-full p-3 border-2 rounded-xl bg-gray-50 focus:bg-white outline-none focus:border-[#424A9F] font-bold italic" />
          <input name="eventPoc" placeholder="Event Lead*" required className="w-full p-3 border-2 rounded-xl bg-gray-50 focus:bg-white outline-none focus:border-[#424A9F] font-bold italic" />
          <div className="grid grid-cols-2 gap-3 text-slate-400 font-black uppercase text-[9px] tracking-widest">
            <div>Start Date<input name="startDate" type="date" required className="w-full p-3 mt-1 border-2 rounded-xl text-slate-800 italic" /></div>
            <div>End Date<input name="endDate" type="date" required className="w-full p-3 mt-1 border-2 rounded-xl text-slate-800 italic" /></div>
          </div>
          <input name="eventLocation" placeholder="Location Detail" className="w-full p-3 border-2 rounded-xl bg-gray-50 italic" />
          <button type="submit" className="w-full bg-[#424A9F] text-white font-black py-4 rounded-2xl shadow-lg uppercase tracking-widest italic mt-4 hover:bg-[#343D84]">COMMIT TO STREAM</button>
        </form>
      </div>

      <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-gray-100 flex flex-col h-full min-h-[500px]">
        <h2 className="text-xl font-black text-[#424A9F] mb-6 tracking-tighter uppercase italic leading-none">Operational Feed</h2>
        <div className="space-y-4 overflow-y-auto max-h-[600px] pr-2 custom-scrollbar">
          {events.map(ev => (
            <div key={ev.id} className="bg-gray-50 p-5 rounded-2xl border-l-8 border-[#424A9F] flex justify-between items-center group shadow-sm border border-gray-100">
              <div>
                <h4 className="font-black text-slate-800 uppercase text-xs italic tracking-tight">{ev.eventName}</h4>
                <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase leading-none">{ev.startDate} — {ev.eventLocation || 'NYIH'}</p>
                <p className="text-[9px] text-[#424A9F] font-black uppercase italic mt-2 tracking-tighter flex items-center"><User size={10} className="mr-1"/> Lead: {ev.eventPoc}</p>
              </div>
              <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_events', ev.id))} className="text-gray-200 hover:text-red-500 transition opacity-0 group-hover:opacity-100"><Trash2 size={16}/></button>
            </div>
          ))}
          {events.length === 0 && <div className="text-center py-20 opacity-20 font-black uppercase text-[10px] tracking-[0.3em]">Stream Clear</div>}
        </div>
      </div>
    </div>
  );
}

function KanbanPage({ user, showMsg }) {
  const [tasks, setTasks] = useState([]);
  useEffect(() => {
    return onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'shared_tasks'), (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const moveTask = async (id, status) => {
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', id), { status });
  };

  const Column = ({ status, title, color }) => (
    <div className="bg-gray-100 p-6 rounded-3xl min-h-[450px] shadow-inner border-2 border-dashed border-gray-200 flex flex-col">
      <h3 className={`font-black text-[10px] tracking-[0.3em] mb-8 text-center uppercase italic border-b-2 pb-2 ${color} border-gray-200`}>{title}</h3>
      <div className="space-y-4 flex-grow">
        {tasks.filter(t => t.status === status).map(t => (
          <div key={t.id} className="bg-white p-5 rounded-2xl shadow-md border-b-4 border-slate-200 group transition hover:scale-105 border border-gray-50/50">
            <p className="text-sm font-black text-slate-800 leading-tight italic tracking-tight italic">"{t.text}"</p>
            <div className="mt-6 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex space-x-1">
                {status !== 'todo' && <button onClick={() => moveTask(t.id, 'todo')} className="p-1.5 bg-gray-50 rounded-lg hover:bg-[#424A9F] hover:text-white transition shadow-sm"><ChevronLeft size={12}/></button>}
                {status !== 'complete' && <button onClick={() => moveTask(t.id, status === 'todo' ? 'doing' : 'complete')} className="p-1.5 bg-gray-50 rounded-lg hover:bg-[#424A9F] hover:text-white transition shadow-sm"><ChevronRight size={12}/></button>}
              </div>
              <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', t.id))} className="text-red-100 hover:text-red-500 transition p-1"><Trash2 size={14}/></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100">
      <form onSubmit={async (e) => {
          e.preventDefault();
          const val = e.target.t.value.trim();
          if (!val) return;
          await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_tasks'), { text: val, status: 'todo', timestamp: new Date().toISOString() });
          e.target.reset();
          showMsg('Objective Pushed.');
      }} className="flex gap-4 mb-12 max-w-2xl mx-auto bg-slate-50 p-2 rounded-2xl border-2 border-slate-200 shadow-inner">
        <input name="t" placeholder="Log high-performance objective..." className="flex-grow p-3 bg-transparent font-black outline-none text-[#424A9F] italic text-sm" />
        <button type="submit" className="bg-[#424A9F] text-white px-10 py-3 rounded-xl font-black hover:bg-[#A3E635] hover:text-gray-900 transition shadow-lg italic uppercase text-xs tracking-widest">PUSH</button>
      </form>
      <div className="grid md:grid-cols-3 gap-8">
        <Column status="todo" title="BACKLOG" color="text-slate-400" />
        <Column status="doing" title="ACTIVE" color="text-blue-500" />
        <Column status="complete" title="DELIVERED" color="text-[#A3E635]" />
      </div>
    </div>
  );
}

function IssuesPage({ user, showMsg }) {
  const [issues, setIssues] = useState([]);
  useEffect(() => {
    return onSnapshot(query(collection(db, 'artifacts', appId, 'public', 'data', 'shared_issues'), orderBy('timestamp', 'desc')), (snap) => {
      setIssues(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const handleReport = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_issues'), { ...data, timestamp: new Date().toISOString() });
    e.target.reset();
    showMsg('Incident logged.');
  };

  return (
    <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100 grid md:grid-cols-2 gap-12 text-slate-900">
      <div>
        <h2 className="text-2xl font-black text-red-600 mb-8 uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8 tracking-tighter leading-none">Log Blocker</h2>
        <form onSubmit={handleReport} className="space-y-6">
          <input name="title" placeholder="Summary of hurdle*" required className="w-full p-5 border-2 border-gray-100 rounded-3xl font-black bg-gray-50 focus:bg-white focus:border-red-500 transition outline-none text-sm italic" />
          <textarea name="desc" placeholder="Diagnostic Details..." required rows="4" className="w-full p-5 border-2 border-gray-100 rounded-3xl font-bold bg-gray-50 focus:bg-white focus:border-red-500 transition outline-none resize-none text-sm italic"></textarea>
          <select name="urgency" className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-black text-slate-700 outline-none italic text-xs">
            <option>Low Tier</option><option selected>Medium Diagnostic</option><option>High Criticality</option><option>Urgent Blocker</option>
          </select>
          <button type="submit" className="w-full bg-red-600 text-white font-black py-5 rounded-3xl hover:bg-red-700 transition shadow-xl uppercase italic tracking-widest text-sm">DISPATCH ALERT</button>
        </form>
      </div>
      <div className="flex flex-col h-full bg-slate-50 p-8 rounded-[3rem] border border-gray-200 shadow-inner">
        <h2 className="text-xl font-black text-slate-800 mb-8 uppercase italic border-b-2 border-slate-200 pb-2 tracking-tight leading-none">Intelligence Feed</h2>
        <div className="space-y-4 overflow-y-auto max-h-[550px] pr-2 custom-scrollbar">
          {issues.map(i => (
            <div key={i.id} className={`p-6 bg-white rounded-3xl shadow-md transition border-l-8 ${i.urgency?.includes('Urgent') ? 'border-red-600 bg-red-50/20' : 'border-yellow-400'}`}>
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-black text-slate-800 uppercase text-[10px] tracking-tight italic leading-tight">"{i.title}"</h3>
                <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_issues', i.id))} className="text-slate-200 hover:text-red-500 transition p-1"><Trash2 size={12}/></button>
              </div>
              <p className="text-[11px] text-slate-500 font-bold italic line-clamp-3 mb-6 leading-relaxed">"${i.desc}"</p>
              <div className="flex justify-between items-center mt-auto">
                <span className="px-3 py-1 rounded-full text-[8px] font-black uppercase bg-slate-800 text-white shadow-sm tracking-widest">{i.urgency}</span>
                <button onClick={() => showMsg('Bridge Handshake Initiated...')} className="text-[#424A9F] text-[9px] font-black uppercase flex items-center hover:text-[#A3E635] transition italic">ServiceNow Link <ArrowRight size={10} className="ml-1.5"/></button>
              </div>
            </div>
          ))}
          {issues.length === 0 && <div className="text-center py-20 opacity-20 font-black uppercase text-[10px] tracking-widest italic">Stable</div>}
        </div>
      </div>
    </div>
  );
}
