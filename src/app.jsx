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

/**
 * ROBUST ENVIRONMENT VARIABLE HELPER
 * This checks for the VITE_ prefix shown in your Vercel screenshot.
 * It also checks REACT_APP_ as a fallback for standard React builds.
 */
const getEnv = (key) => {
  const env = typeof process !== 'undefined' ? process.env : {};
  // Safe check for Vite's import.meta
  let meta = {};
  try { meta = import.meta.env || {}; } catch (e) {}
  
  return env[`VITE_${key}`] || env[`REACT_APP_${key}`] || 
         meta[`VITE_${key}`] || meta[`REACT_APP_${key}`] || "";
};

const firebaseConfig = {
  apiKey: getEnv("FIREBASE_API_KEY"),
  authDomain: getEnv("FIREBASE_AUTH_DOMAIN"),
  projectId: getEnv("FIREBASE_PROJECT_ID"),
  storageBucket: getEnv("FIREBASE_STORAGE_BUCKET") || `${getEnv("FIREBASE_PROJECT_ID")}.appspot.com`,
  messagingSenderId: getEnv("FIREBASE_MESSAGING_SENDER_ID"),
  appId: getEnv("FIREBASE_APP_ID")
};

const GEMINI_API_KEY = getEnv("GEMINI_API_KEY");

// Initialize Firebase safely
let auth, db;
const isConfigured = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;

if (isConfigured) {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  auth = getAuth(app);
  db = getFirestore(app);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('schedule');
  const [showRegister, setShowRegister] = useState(false);
  const [message, setMessage] = useState({ text: '', isError: false });
  const [aiEnabled, setAiEnabled] = useState(true);
  const [modal, setModal] = useState(null);

  // Global Data States
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [issues, setIssues] = useState([]);

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

  // Real-time Data Listeners
  useEffect(() => {
    if (!user || !isConfigured) return;

    const unsubEvents = onSnapshot(query(collection(db, 'shared_events'), orderBy('startDate')), (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubTasks = onSnapshot(collection(db, 'shared_tasks'), (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubIssues = onSnapshot(query(collection(db, 'shared_issues'), orderBy('timestamp', 'desc')), (snap) => {
      setIssues(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubEvents();
      unsubTasks();
      unsubIssues();
    };
  }, [user]);

  const showMsg = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage({ text: '', isError: false }), 5000);
  };

  const fetchGemini = async (prompt) => {
    if (!aiEnabled || !GEMINI_API_KEY) return "AI Service Unavailable - Check API Key";
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (e) {
      return "AI Error occurred. Verify Gemini API key in Vercel.";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#424A9F] mb-4"></div>
        <p className="text-[#424A9F] font-bold uppercase tracking-widest text-[10px]">Initializing Accenture Hub...</p>
      </div>
    );
  }

  // Configuration Check UI
  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-2xl text-center border-t-8 border-red-500">
          <i className="fas fa-shield-alt text-red-500 text-5xl mb-4"></i>
          <h1 className="text-2xl font-black text-[#424A9F] mb-2 uppercase italic tracking-tighter">Setup Required</h1>
          <p className="text-gray-600 mb-6 text-sm">Environment variables (VITE_FIREBASE_API_KEY) were not detected by the build.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100">
        <div className="w-full max-w-md bg-white p-10 rounded-[2.5rem] shadow-2xl border border-gray-100">
          <div className="flex justify-center mb-8 font-black">
            <div className="bg-[#A3E635] p-4 rounded-3xl text-[#424A9F] shadow-lg">
              <i className="fas fa-project-diagram fa-2x"></i>
            </div>
          </div>
          <h1 className="text-3xl font-black text-center text-[#424A9F] mb-6 uppercase italic tracking-tighter">Accenture Hub</h1>
          {!showRegister ? (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              try { await signInWithEmailAndPassword(auth, e.target.email.value, e.target.password.value); }
              catch (err) { showMsg(err.message, true); }
            }}>
              <input name="email" type="email" placeholder="Corporate ID" required className="w-full p-4 rounded-2xl border-2 border-gray-100 focus:ring-2 focus:ring-[#A3E635] outline-none font-bold bg-gray-50" />
              <input name="password" type="password" placeholder="Key Phrase" required className="w-full p-4 rounded-2xl border-2 border-gray-100 focus:ring-2 focus:ring-[#A3E635] outline-none font-bold bg-gray-50" />
              <button type="submit" className="w-full bg-[#424A9F] text-white font-black py-4 rounded-2xl shadow-xl hover:bg-[#343D84] transition uppercase italic">Initiate Login</button>
              <p className="text-center text-xs text-gray-400 mt-6 font-bold uppercase">
                New profile? <button type="button" onClick={() => setShowRegister(true)} className="text-[#424A9F] hover:underline">Register here</button>
              </p>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              try { await createUserWithEmailAndPassword(auth, e.target.email.value, e.target.password.value); }
              catch (err) { showMsg(err.message, true); }
            }}>
              <input name="email" type="email" placeholder="Corporate ID" required className="w-full p-4 rounded-2xl border-2 border-gray-100 focus:ring-2 focus:ring-[#A3E635] outline-none font-bold bg-gray-50" />
              <input name="password" type="password" placeholder="Key Phrase" required className="w-full p-4 rounded-2xl border-2 border-gray-100 focus:ring-2 focus:ring-[#A3E635] outline-none font-bold bg-gray-50" />
              <button type="submit" className="w-full bg-[#A3E635] text-gray-900 font-black py-4 rounded-2xl shadow-xl hover:bg-[#8CD02F] transition uppercase italic">Create Profile</button>
              <p className="text-center text-xs text-gray-400 mt-6 font-bold uppercase">
                Existing user? <button type="button" onClick={() => setShowRegister(false)} className="text-[#424A9F] hover:underline">Login here</button>
              </p>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 flex flex-col items-center">
      {/* Exact Header Layout from out_index.html */}
      <div className="w-full max-w-6xl bg-white p-6 rounded-[2rem] shadow-xl mb-6 border border-gray-50">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl font-black text-[#424A9F] uppercase italic tracking-tighter">Accenture Hub</h1>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">AI Status</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
                <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#A3E635]"></div>
              </label>
            </div>
            <button onClick={() => signOut(auth)} className="bg-gray-100 text-gray-500 font-bold px-4 py-2 rounded-xl hover:bg-red-50 hover:text-red-500 transition text-[10px] uppercase tracking-widest">Logout</button>
          </div>
        </div>
        <p className="text-center text-gray-400 font-bold uppercase text-[10px] tracking-[0.3em] mb-6">High Performance. Delivered.</p>
        <div className="flex justify-center mb-4 space-x-2">
          <TabBtn active={currentPage === 'schedule'} onClick={() => setCurrentPage('schedule')} label="Meetings & Events" />
          <TabBtn active={currentPage === 'kanban'} onClick={() => setCurrentPage('kanban')} label="Task Board" />
          <TabBtn active={currentPage === 'issues'} onClick={() => setCurrentPage('issues')} label="Tech Issues" />
        </div>
      </div>

      {message.text && (
        <div className={`w-full max-w-6xl p-4 mb-4 rounded-xl shadow-lg border-l-4 transition-all ${message.isError ? 'bg-red-50 border-red-500 text-red-700' : 'bg-blue-50 border-[#A3E635] text-blue-700'}`}>
          <p className="font-bold text-sm leading-relaxed tracking-tight italic">{message.text}</p>
        </div>
      )}

      <div className="w-full max-w-6xl flex-grow animate-in fade-in duration-500">
        {currentPage === 'schedule' && <SchedulePage events={events} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} />}
        {currentPage === 'kanban' && <KanbanPage tasks={tasks} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} />}
        {currentPage === 'issues' && <IssuesPage issues={issues} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} />}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => setModal(null)}>
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl max-w-xl w-full border border-gray-100" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-[#424A9F] mb-6 uppercase italic tracking-widest border-b-2 border-gray-50 pb-2">{modal.title}</h3>
            <div className="text-gray-700 max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed italic">{modal.content}</div>
            <div className="flex justify-end mt-8 space-x-2">
              {modal.action && <button onClick={() => { modal.action(); showMsg("Copied to clipboard"); }} className="bg-[#A3E635] text-gray-900 font-bold px-6 py-3 rounded-xl hover:bg-[#8CD02F] shadow-lg transition uppercase tracking-tighter text-xs italic">Copy Result</button>}
              <button onClick={() => setModal(null)} className="bg-gray-100 font-bold px-6 py-3 rounded-xl hover:bg-gray-200 text-gray-600 transition uppercase tracking-tighter text-xs italic">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label }) {
  return (
    <button onClick={onClick} className={`px-6 py-2.5 rounded-xl font-black uppercase text-xs tracking-widest transition-all ${active ? 'bg-[#A3E635] text-gray-900 shadow-lg scale-105' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
      {label}
    </button>
  );
}

/* --- SUB-COMPONENTS --- */

function SchedulePage({ events, showMsg, fetchGemini, setModal }) {
  const handleAdd = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await addDoc(collection(db, 'shared_events'), { ...data, timestamp: new Date().toISOString() });
      e.target.reset();
      showMsg("Event operational data synchronized.");
    } catch (err) { showMsg(err.message, true); }
  };

  const handleAiExtract = async () => {
    const text = document.getElementById('ai-input').value;
    if (!text.trim()) return;
    const result = await fetchGemini(`Strategic Extraction: Identify core event details and lead POCs from this BEO text. Provide technical requirements in a clean list: ${text}`);
    setModal({ title: "AI Deployment Intelligence", content: result, action: () => navigator.clipboard.writeText(result) });
  };

  return (
    <div className="bg-white p-8 rounded-[2rem] shadow-xl grid md:grid-cols-2 gap-8 border border-gray-100">
      <div>
        <h2 className="text-xl font-black text-[#424A9F] mb-8 uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8">Intake Engine</h2>
        <div className="p-5 bg-gray-50 rounded-[2rem] mb-8 border-2 border-dashed border-gray-200 shadow-inner">
          <textarea id="ai-input" className="w-full h-24 p-4 rounded-2xl border-2 border-gray-200 bg-white resize-none outline-none focus:ring-2 focus:ring-[#A3E635] text-sm italic font-medium" placeholder="Paste BEO Stream for high-performance AI Extraction..."></textarea>
          <button onClick={handleAiExtract} className="w-full mt-3 bg-[#A3E635] text-gray-900 font-black py-4 rounded-xl hover:bg-[#8CD02F] transition flex items-center justify-center uppercase tracking-widest text-[10px]">AI Extraction Process</button>
        </div>
        <form onSubmit={handleAdd} className="space-y-4 font-bold">
          <input name="eventName" placeholder="Event Designation*" required className="p-4 w-full border-2 border-gray-100 rounded-2xl bg-gray-50 focus:bg-white outline-none text-sm italic" />
          <input name="eventPoc" placeholder="Event Lead / POC*" required className="p-4 w-full border-2 border-gray-100 rounded-2xl bg-gray-50 focus:bg-white outline-none text-sm italic" />
          <div className="grid grid-cols-2 gap-4">
            <div className="text-[9px] font-black uppercase text-gray-400 ml-2 italic">Start Date<input name="startDate" type="date" required className="w-full p-4 mt-1 border-2 border-gray-100 rounded-2xl bg-gray-50 text-slate-800" /></div>
            <div className="text-[9px] font-black uppercase text-gray-400 ml-2 italic">End Date<input name="endDate" type="date" required className="w-full p-4 mt-1 border-2 border-gray-100 rounded-2xl bg-gray-50 text-slate-800" /></div>
          </div>
          <button type="submit" className="w-full bg-[#424A9F] text-white font-black py-4 rounded-2xl shadow-xl hover:bg-[#343D84] transition uppercase italic tracking-widest mt-4">Commit to Hub Schedule</button>
        </form>
      </div>
      <div className="flex flex-col h-full">
        <h2 className="text-xl font-black text-[#424A9F] mb-6 uppercase italic tracking-tighter">Live Operations</h2>
        <div className="space-y-4 overflow-y-auto max-h-[65vh] pr-2">
          {events.map(e => (
            <div key={e.id} className="bg-white p-5 rounded-2xl shadow-md border-l-8 border-[#424A9F] flex justify-between items-center group hover:bg-indigo-50 transition border border-gray-50">
              <div>
                <p className="font-black text-slate-800 uppercase text-xs tracking-tight italic">{e.eventName}</p>
                <p className="text-[10px] text-gray-400 font-bold uppercase mt-1 italic">{e.startDate} — {e.eventPoc}</p>
              </div>
              <button onClick={() => deleteDoc(doc(db, 'shared_events', e.id))} className="text-gray-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition p-2"><i className="fas fa-trash-alt"></i></button>
            </div>
          ))}
          {events.length === 0 && <p className="text-center py-20 opacity-20 italic">No operations active</p>}
        </div>
      </div>
    </div>
  );
}

function KanbanPage({ tasks, showMsg, fetchGemini, setModal }) {
  const add = async (e) => {
    e.preventDefault();
    const val = e.target.t.value.trim();
    if (!val) return;
    await addDoc(collection(db, 'shared_tasks'), { text: val, status: 'todo', timestamp: new Date().toISOString() });
    e.target.reset();
  };

  const move = async (id, s) => { await updateDoc(doc(db, 'shared_tasks', id), { status: s }); };

  const getAiSummary = async () => {
    const list = tasks.map(t => `${t.status}: ${t.text}`).join(', ');
    const res = await fetchGemini(`Strategic Assessment: Provide an overview of mission progress based on these tasks: ${list}. Identify the bottleneck.`);
    setModal({ title: "Mission Trajectory Intelligence", content: res });
  };

  const Col = ({ status, title, color }) => (
    <div className="bg-gray-100 p-6 rounded-[2.5rem] min-h-[450px] border-2 border-dashed border-gray-200 flex flex-col">
      <h3 className={`font-black text-[10px] tracking-[0.3em] text-center mb-8 uppercase italic border-b-2 pb-2 ${color}`}>{title}</h3>
      <div className="space-y-4 flex-grow">
        {tasks.filter(t => t.status === status).map(t => (
          <div key={t.id} className="bg-white p-5 rounded-2xl shadow-md border-b-4 border-slate-200 group transition hover:scale-105 animate-fade-in">
            <p className="text-sm font-black text-slate-800 leading-tight italic tracking-tight">"{t.text}"</p>
            <div className="mt-6 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex space-x-1.5">
                {status !== 'todo' && <button onClick={() => move(t.id, 'todo')} className="p-2 bg-gray-50 rounded-xl hover:bg-[#424A9F] hover:text-white transition shadow-sm"><i className="fas fa-chevron-left text-[8px]"></i></button>}
                {status !== 'complete' && <button onClick={() => move(t.id, status === 'todo' ? 'doing' : 'complete')} className="p-2 bg-gray-50 rounded-xl hover:bg-[#424A9F] hover:text-white transition shadow-sm"><i className="fas fa-chevron-right text-[8px]"></i></button>}
              </div>
              <button onClick={() => deleteDoc(doc(db, 'shared_tasks', t.id))} className="text-red-100 hover:text-red-500 transition p-1"><i className="fas fa-trash-alt text-[10px]"></i></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="bg-white p-10 rounded-[3.5rem] shadow-2xl border border-gray-100">
      <div className="flex justify-between items-center mb-12 max-w-2xl mx-auto">
        <form onSubmit={add} className="flex gap-4 flex-grow bg-gray-50 p-2 rounded-2xl shadow-inner mr-4 border border-gray-100">
          <input name="t" placeholder="Log high-impact objective..." className="flex-grow p-4 bg-transparent font-black outline-none text-[#424A9F] italic text-sm" />
          <button type="submit" className="bg-[#424A9F] text-white px-10 py-4 rounded-xl font-black hover:bg-[#A3E635] hover:text-gray-900 transition shadow-lg italic uppercase text-xs">Push</button>
        </form>
        <button onClick={getAiSummary} className="bg-[#A3E635] text-gray-900 font-black p-4 rounded-2xl shadow-lg hover:scale-110 transition border border-[#A3E635]"><i className="fas fa-bolt"></i></button>
      </div>
      <div className="grid md:grid-cols-3 gap-8">
        <Col status="todo" title="BACKLOG" color="text-slate-400 border-slate-300" />
        <Col status="doing" title="ACTIVE" color="text-blue-500 border-blue-400" />
        <Col status="complete" title="DELIVERED" color="text-[#A3E635] border-[#A3E635]" />
      </div>
    </div>
  );
}

function IssuesPage({ issues, showMsg, fetchGemini, setModal }) {
  const handleReport = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await addDoc(collection(db, 'shared_issues'), { ...Object.fromEntries(fd.entries()), timestamp: new Date().toISOString() });
    e.target.reset();
    showMsg("Incident reported to intelligence stream.");
  };

  const diagnose = async (i) => {
    const res = await fetchGemini(`Technical Diagnostic: Blocker "${i.title}" described as "${i.desc}". Provide 3 corrective actions for our tech team.`);
    setModal({ title: "Incident Diagnostic Protocol", content: res });
  };

  return (
    <div className="bg-white p-10 rounded-[3.5rem] shadow-2xl border border-gray-100 grid md:grid-cols-2 gap-12 animate-fade-in text-slate-900">
      <div>
        <h2 className="text-2xl font-black text-red-600 mb-8 flex items-center uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8 tracking-tighter">Log Technical Blocker</h2>
        <form onSubmit={handleReport} className="space-y-6">
          <input name="title" placeholder="Summary of Technical Hurdle*" required className="w-full p-5 border-2 border-gray-100 rounded-3xl font-black bg-gray-50 focus:bg-white focus:border-red-500 transition outline-none text-sm italic" />
          <textarea name="desc" placeholder="Diagnostic Details / Environment Info..." required rows="4" className="w-full p-5 border-2 border-gray-100 rounded-3xl font-bold bg-gray-50 focus:bg-white focus:border-red-500 transition outline-none resize-none text-sm italic"></textarea>
          <select name="urgency" className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-black text-slate-700 outline-none focus:border-red-500 italic text-xs">
            <option>Low Tier</option><option selected>Medium Diagnostic</option><option>High Criticality</option><option>Urgent Blocker</option>
          </select>
          <button type="submit" className="w-full bg-red-600 text-white font-black py-5 rounded-3xl hover:bg-red-700 transition shadow-xl uppercase italic tracking-widest text-sm">Dispatch Diagnostic Protocol</button>
        </form>
      </div>
      <div className="flex flex-col h-full bg-slate-50 p-8 rounded-[3rem] border border-gray-200 shadow-inner">
        <h2 className="text-xl font-black text-slate-800 mb-8 uppercase italic border-b-2 border-slate-200 pb-2 tracking-tight">Intelligence Diagnostic Feed</h2>
        <div className="space-y-4 overflow-y-auto max-h-[550px] pr-2">
          {issues.map(i => (
            <div key={i.id} className={`p-6 bg-white rounded-3xl shadow-md transition border-l-8 animate-fade-in ${i.urgency.includes('Urgent') ? 'border-red-600 bg-red-50/20' : 'border-yellow-400'}`}>
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-black text-slate-800 uppercase text-xs tracking-tight italic">"{i.title}"</h3>
                <button onClick={() => deleteDoc(doc(db, 'shared_issues', i.id))} className="text-slate-200 hover:text-red-500 transition p-1"><i className="fas fa-trash-alt text-[10px]"></i></button>
              </div>
              <p className="text-[11px] text-slate-500 font-bold italic line-clamp-3 mb-6">"${i.desc}"</p>
              <div className="flex justify-between items-center mt-auto">
                <span className="px-3 py-1 rounded-full text-[8px] font-black uppercase bg-slate-800 text-white shadow-sm tracking-widest">{i.urgency}</span>
                <button onClick={() => diagnose(i)} className="text-[#424A9F] text-[9px] font-black uppercase flex items-center hover:text-[#A3E635] transition italic">Strategic Link <i className="fas fa-arrow-right ml-1.5 text-[8px]"></i></button>
              </div>
            </div>
          ))}
          {issues.length === 0 && <div className="text-center py-20 opacity-20 font-black uppercase text-[10px] tracking-widest italic leading-relaxed">Infrastructure Stable</div>}
        </div>
      </div>
    </div>
  );
}
