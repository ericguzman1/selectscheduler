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
 * ROBUST CONFIGURATION HELPER
 * This checks for REACT_APP_ (Create React App) and VITE_ (Vite) 
 * prefixes to ensure compatibility with your Vercel settings.
 */
const getEnv = (key) => {
  // Check process.env (Standard)
  const proc = typeof process !== 'undefined' ? process.env : {};
  // Check import.meta.env (Vite) - wrapped in try/catch for safe evaluation
  let meta = {};
  try { meta = import.meta.env || {}; } catch (e) {}

  return proc[`REACT_APP_${key}`] || proc[`VITE_${key}`] || 
         meta[`VITE_${key}`] || meta[`REACT_APP_${key}`] || "";
};

const firebaseConfig = {
  apiKey: getEnv("FIREBASE_API_KEY"),
  authDomain: getEnv("FIREBASE_AUTH_DOMAIN"),
  projectId: getEnv("FIREBASE_PROJECT_ID"),
  storageBucket: getEnv("FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: getEnv("FIREBASE_MESSAGING_SENDER_ID"),
  appId: getEnv("FIREBASE_APP_ID")
};

const GEMINI_API_KEY = getEnv("GEMINI_API_KEY");

// Initialize Firebase safely
let app;
let auth;
let db;

// Only initialize if we have at least an API Key and Project ID
const isConfigured = firebaseConfig.apiKey && firebaseConfig.projectId;

if (isConfigured) {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
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

  // Firestore Real-time Listeners
  useEffect(() => {
    if (!user || !isConfigured) return;

    const unsubEvents = onSnapshot(query(collection(db, 'shared_events'), orderBy('startDate')), (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Firestore Event Error:", err));

    const unsubTasks = onSnapshot(collection(db, 'shared_tasks'), (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Firestore Task Error:", err));

    const unsubIssues = onSnapshot(query(collection(db, 'shared_issues'), orderBy('timestamp')), (snap) => {
      setIssues(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Firestore Issue Error:", err));

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

  const handleGemini = async (prompt) => {
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
      return "AI Error occurred. Please verify your Gemini API key in Vercel settings.";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#424A9F] mb-4"></div>
        <p className="text-[#424A9F] font-bold uppercase tracking-widest text-xs">Initializing Hub...</p>
      </div>
    );
  }

  // Configuration Guard UI
  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-2xl text-center border-t-8 border-red-500">
          <i className="fas fa-shield-alt text-red-500 text-5xl mb-4"></i>
          <h1 className="text-2xl font-black text-[#424A9F] mb-2 uppercase">Configuration Error</h1>
          <p className="text-gray-600 mb-6 text-sm">Environment variables were not detected. Please verify your Vercel settings and ensure the keys start with <strong>VITE_</strong> or <strong>REACT_APP_</strong>.</p>
          <div className="text-left bg-gray-50 p-4 rounded-xl font-mono text-[10px] text-gray-400">
             VITE_FIREBASE_API_KEY: {firebaseConfig.apiKey ? "✅ Detected" : "❌ Missing"}<br/>
             VITE_FIREBASE_PROJECT_ID: {firebaseConfig.projectId ? "✅ Detected" : "❌ Missing"}
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
          <div className="flex justify-center mb-6">
            <div className="bg-[#A3E635] p-4 rounded-3xl text-[#424A9F] shadow-lg">
              <i className="fas fa-project-diagram fa-2x"></i>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-center text-[#424A9F] mb-6 uppercase italic tracking-tighter">Accenture Hub</h1>
          {!showRegister ? (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              try { await signInWithEmailAndPassword(auth, e.target.email.value, e.target.password.value); }
              catch (err) { showMsg(err.message, true); }
            }}>
              <input name="email" type="email" placeholder="Corporate Email" required className="w-full p-4 rounded-xl border-2 border-gray-100 focus:ring-2 focus:ring-[#A3E635] outline-none font-bold" />
              <input name="password" type="password" placeholder="Password" required className="w-full p-4 rounded-xl border-2 border-gray-100 focus:ring-2 focus:ring-[#A3E635] outline-none font-bold" />
              <button type="submit" className="w-full bg-[#424A9F] text-white font-black py-4 rounded-xl shadow-xl hover:bg-[#343D84] transition uppercase italic">Initiate Login</button>
              <p className="text-center text-sm text-gray-500 mt-4">
                Don't have an account? <button type="button" onClick={() => setShowRegister(true)} className="font-semibold text-[#424A9F] hover:underline">Register here</button>
              </p>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              try { await createUserWithEmailAndPassword(auth, e.target.email.value, e.target.password.value); }
              catch (err) { showMsg(err.message, true); }
            }}>
              <input name="email" type="email" placeholder="Email" required className="w-full p-4 rounded-xl border-2 border-gray-100 focus:ring-2 focus:ring-[#A3E635] outline-none font-bold" />
              <input name="password" type="password" placeholder="Password" required className="w-full p-4 rounded-xl border-2 border-gray-100 focus:ring-2 focus:ring-[#A3E635] outline-none font-bold" />
              <button type="submit" className="w-full bg-[#A3E635] text-gray-900 font-black py-4 rounded-xl shadow-xl hover:bg-[#8CD02F] transition uppercase italic">Create Profile</button>
              <p className="text-center text-sm text-gray-500 mt-4">
                Already have an account? <button type="button" onClick={() => setShowRegister(false)} className="font-semibold text-[#424A9F] hover:underline">Login here</button>
              </p>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 flex flex-col items-center">
      {/* App Header */}
      <div className="w-full max-w-6xl bg-white p-6 rounded-2xl shadow-xl mb-6 border border-gray-50">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl font-extrabold text-[#424A9F] uppercase italic tracking-tighter">Accenture Hub</h1>
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
          <button onClick={() => setCurrentPage('schedule')} className={`px-6 py-2.5 rounded-xl font-black uppercase text-xs tracking-widest transition-all ${currentPage === 'schedule' ? 'bg-[#A3E635] text-gray-900 shadow-lg scale-105' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Meetings</button>
          <button onClick={() => setCurrentPage('kanban')} className={`px-6 py-2.5 rounded-xl font-black uppercase text-xs tracking-widest transition-all ${currentPage === 'kanban' ? 'bg-[#A3E635] text-gray-900 shadow-lg scale-105' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Task Board</button>
          <button onClick={() => setCurrentPage('issues')} className={`px-6 py-2.5 rounded-xl font-black uppercase text-xs tracking-widest transition-all ${currentPage === 'issues' ? 'bg-[#A3E635] text-gray-900 shadow-lg scale-105' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Tech Feed</button>
        </div>
      </div>

      {message.text && (
        <div className={`w-full max-w-6xl p-4 mb-4 rounded-xl shadow-lg border-l-4 ${message.isError ? 'bg-red-50 border-red-500 text-red-700' : 'bg-blue-50 border-[#A3E635] text-blue-700'}`}>
          <p className="font-bold text-sm"><i className={`fas ${message.isError ? 'fa-exclamation-circle' : 'fa-check-circle'} mr-2`}></i>{message.text}</p>
        </div>
      )}

      <div className="w-full max-w-6xl flex-grow">
        {currentPage === 'schedule' && <SchedulePage events={events} showMsg={showMsg} handleGemini={handleGemini} setModal={setModal} />}
        {currentPage === 'kanban' && <KanbanPage tasks={tasks} showMsg={showMsg} handleGemini={handleGemini} setModal={setModal} />}
        {currentPage === 'issues' && <IssuesPage issues={issues} showMsg={showMsg} handleGemini={handleGemini} setModal={setModal} />}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => setModal(null)}>
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl max-w-xl w-full border border-gray-100" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-[#424A9F] mb-6 uppercase italic tracking-widest border-b-2 border-gray-50 pb-2">{modal.title}</h3>
            <div className="text-gray-700 max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed italic">{modal.content}</div>
            <div className="flex justify-end mt-8 space-x-2">
              {modal.action && <button onClick={() => { modal.action(); showMsg("Data copied to clipboard"); }} className="bg-[#A3E635] text-gray-900 font-bold px-6 py-3 rounded-xl hover:bg-[#8CD02F] shadow-lg transition uppercase tracking-tighter text-xs">Copy Result</button>}
              <button onClick={() => setModal(null)} className="bg-gray-100 font-bold px-6 py-3 rounded-xl hover:bg-gray-200 text-gray-600 transition uppercase tracking-tighter text-xs">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- COMPONENTS --- */

function SchedulePage({ events, showMsg, handleGemini, setModal }) {
  const [aiLoading, setAiLoading] = useState(false);
  const resourceOptions = ["Surface Hubs", "Proto", "Spot", "Hypervsn", "GenAI", "Vestaboard", "Loaner Laptop", "Clicker", "Teams Call", "Vu AI", "Other"];

  const handleAdd = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.demo = Array.from(e.target.querySelectorAll('input[name="demo"]:checked')).map(cb => cb.value);
    try {
      await addDoc(collection(db, 'shared_events'), { ...data, timestamp: new Date().toISOString() });
      e.target.reset();
      showMsg("Event successfully synchronized.");
    } catch (err) { showMsg(err.message, true); }
  };

  const handleAiExtract = async () => {
    const text = document.getElementById('ai-input').value;
    if (!text.trim()) return;
    setAiLoading(true);
    const summary = await handleGemini(`Identify high-priority events and SELECT lead POCs from this BEO text, providing technical requirements in a clean list format: ${text}`);
    setModal({ title: "AI Extraction Intelligence", content: summary, action: () => navigator.clipboard.writeText(summary) });
    setAiLoading(false);
  };

  const generateSummary = async () => {
    if (events.length === 0) return;
    setAiLoading(true);
    const list = events.map(e => `${e.eventName} (${e.startDate})`).join(', ');
    const summary = await handleGemini(`Provide a high-performance executive team summary of these upcoming operations: ${list}. Highlight potential resource overlaps.`);
    setModal({ title: "Operational Intelligence Summary", content: summary });
    setAiLoading(false);
  };

  return (
    <div className="bg-white p-8 rounded-[2rem] shadow-xl grid md:grid-cols-2 gap-8 border border-gray-100 animate-fade-in">
      <div>
        <h2 className="text-xl font-black text-[#424A9F] mb-8 uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8 tracking-tighter">Intake Engine</h2>
        <div className="p-5 bg-gray-50 rounded-[2rem] mb-8 border-2 border-dashed border-gray-200 shadow-inner">
          <textarea id="ai-input" className="w-full h-24 p-3 rounded-2xl border-2 border-gray-200 bg-white resize-none outline-none focus:ring-2 focus:ring-[#A3E635] text-sm italic" placeholder="Paste BEO Text for high-performance AI Extraction..."></textarea>
          <button onClick={handleAiExtract} disabled={aiLoading} className="w-full mt-3 bg-[#A3E635] text-gray-900 font-black py-3 rounded-xl hover:bg-[#8CD02F] transition flex items-center justify-center uppercase tracking-widest text-[10px]">
            <i className={`fas fa-bolt mr-2 ${aiLoading ? 'fa-spin' : ''}`}></i> {aiLoading ? 'Analyzing Stream...' : 'AI Extraction Process'}
          </button>
        </div>
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <input name="eventName" placeholder="Event Designation*" required className="p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 focus:bg-white outline-none font-bold text-sm" />
            <input name="eventPoc" placeholder="Event Lead / POC*" required className="p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 focus:bg-white outline-none font-bold text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-[9px] font-black uppercase text-gray-400 ml-2 italic">Initiation Date<input name="startDate" type="date" required className="w-full p-4 mt-1 border-2 border-gray-100 rounded-2xl bg-gray-50 text-slate-800" /></div>
            <div className="text-[9px] font-black uppercase text-gray-400 ml-2 italic">Conclusion Date<input name="endDate" type="date" required className="w-full p-4 mt-1 border-2 border-gray-100 rounded-2xl bg-gray-50 text-slate-800" /></div>
          </div>
          <input name="eventLocation" placeholder="Specific Hub Room / Location" className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 focus:bg-white outline-none font-bold text-sm" />
          <details className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
            <summary className="font-black text-[10px] uppercase text-gray-500 cursor-pointer tracking-widest italic">Inventory / Resource Allocation</summary>
            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-gray-200">
              {resourceOptions.map(r => (
                <label key={r} className="flex items-center space-x-2 text-[10px] font-bold text-gray-600 italic uppercase"><input type="checkbox" name="demo" value={r} className="rounded border-gray-300 text-[#424A9F]" /><span>{r}</span></label>
              ))}
            </div>
          </details>
          <button type="submit" className="w-full bg-[#424A9F] text-white font-black py-4 rounded-2xl shadow-xl hover:bg-[#343D84] transition uppercase italic tracking-widest mt-4">Commit to Shared Schedule</button>
        </form>
      </div>
      <div className="flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-black text-[#424A9F] uppercase italic tracking-tighter">Operational View</h2>
          <button onClick={generateSummary} className="bg-[#A3E635] text-gray-900 text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest hover:scale-105 transition shadow-sm">AI Intel Sum</button>
        </div>
        <div className="space-y-4 overflow-y-auto max-h-[65vh] pr-2 custom-scrollbar">
          {events.length > 0 ? events.map(e => (
            <div key={e.id} className="bg-white p-5 rounded-2xl shadow-md border-l-8 border-[#424A9F] flex justify-between items-center group hover:bg-indigo-50 transition border border-gray-50">
              <div>
                <p className="font-black text-slate-800 uppercase text-xs tracking-tight">{e.eventName}</p>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-1 italic">{e.startDate} — {e.eventLocation || 'NYIH'}</p>
                <div className="flex items-center text-[9px] text-[#424A9F] font-black uppercase mt-2 opacity-60">
                   <i className="fas fa-user-tie mr-1.5"></i> {e.eventPoc}
                </div>
              </div>
              <button onClick={() => deleteDoc(doc(db, 'shared_events', e.id))} className="text-gray-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition p-2"><i className="fas fa-trash-alt"></i></button>
            </div>
          )) : (
            <div className="flex flex-col items-center justify-center py-20 opacity-20">
               <i className="fas fa-stream fa-3x text-gray-400 mb-4"></i>
               <p className="text-center font-black uppercase text-[10px] tracking-[0.3em] italic">Operational Stream Idle</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KanbanPage({ tasks, showMsg, handleGemini, setModal }) {
  const add = async (e) => {
    e.preventDefault();
    const val = e.target.t.value.trim();
    if (!val) return;
    await addDoc(collection(db, 'shared_tasks'), { title: val, status: 'todo', timestamp: new Date().toISOString() });
    e.target.reset();
  };

  const move = async (id, status) => {
    await updateDoc(doc(db, 'shared_tasks', id), { status });
  };

  const getAiKanbanSummary = async () => {
    const list = tasks.map(t => `${t.status}: ${t.title}`).join(', ');
    const summary = await handleGemini(`Provide a strategic overview of project trajectory based on these task statuses: ${list}. Identify the current bottleneck.`);
    setModal({ title: "Project Trajectory Analysis", content: summary });
  };

  const Col = ({ status, title, color }) => (
    <div className="bg-gray-100 p-6 rounded-[2rem] min-h-[450px] border-2 border-dashed border-gray-200 shadow-inner flex flex-col">
      <h3 className={`font-black text-[10px] tracking-[0.3em] text-center mb-8 uppercase italic border-b-2 pb-2 ${color}`}>{title}</h3>
      <div className="space-y-4 flex-grow">
        {tasks.filter(t => t.status === status).map(t => (
          <div key={t.id} className="bg-white p-5 rounded-2xl shadow-md border-b-4 border-slate-200 group transition hover:scale-[1.03] animate-fade-in border-r border-t border-gray-50">
            <p className="text-sm font-black text-slate-800 leading-tight italic tracking-tight">"{t.title}"</p>
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
    <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100 animate-fade-in">
      <div className="flex justify-between items-center mb-12 max-w-2xl mx-auto">
        <form onSubmit={add} className="flex gap-4 flex-grow bg-gray-50 p-2 rounded-2xl shadow-inner mr-4 border border-gray-100">
          <input name="t" placeholder="Log mission-critical objective..." className="flex-grow p-4 bg-transparent font-black outline-none text-[#424A9F] italic text-sm" />
          <button type="submit" className="bg-[#424A9F] text-white px-10 py-4 rounded-xl font-black uppercase text-xs tracking-widest hover:bg-[#A3E635] hover:text-gray-900 transition shadow-lg italic">Push</button>
        </form>
        <button onClick={getAiKanbanSummary} className="bg-[#A3E635] text-gray-900 font-black p-4 rounded-2xl shadow-lg hover:scale-110 transition border border-[#A3E635]"><i className="fas fa-bolt"></i></button>
      </div>
      <div className="grid md:grid-cols-3 gap-8">
        <Col status="todo" title="Objective Queue" color="text-slate-400 border-slate-300" />
        <Col status="doing" title="Live Deployment" color="text-blue-500 border-blue-400" />
        <Col status="complete" title="Delivered Value" color="text-[#A3E635] border-[#A3E635]" />
      </div>
    </div>
  );
}

function IssuesPage({ issues, showMsg, handleGemini, setModal }) {
  const report = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await addDoc(collection(db, 'shared_issues'), { ...Object.fromEntries(fd.entries()), timestamp: new Date().toISOString() });
    e.target.reset();
    showMsg("Incident report dispatched to diagnostic feed.");
  };

  const diagnose = async (i) => {
    const advice = await handleGemini(`Strategic Diagnostic Request: Incident "${i.issueTitle}" described as "${i.issueDescription}". Provide 3 corrective actions for our tech team.`);
    setModal({ title: "Incident Diagnostic Protocol", content: advice });
  };

  return (
    <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100 grid md:grid-cols-2 gap-12 animate-fade-in text-slate-900">
      <div>
        <h2 className="text-2xl font-black text-red-600 mb-8 flex items-center uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8 tracking-tighter">Log Technical Blocker</h2>
        <form onSubmit={report} className="space-y-6">
          <input name="issueTitle" placeholder="Summary of Technical Hurdle*" required className="w-full p-5 border-2 border-gray-100 rounded-3xl font-black bg-gray-50 focus:bg-white focus:border-red-500 transition outline-none text-sm italic" />
          <textarea name="issueDescription" placeholder="Deep Diagnostic Details / Environment Info..." required rows="4" className="w-full p-5 border-2 border-gray-100 rounded-3xl font-bold bg-gray-50 focus:bg-white focus:border-red-500 transition outline-none resize-none text-sm italic"></textarea>
          <div className="flex flex-col space-y-1">
             <label className="text-[9px] font-black uppercase text-gray-400 ml-3 tracking-widest italic">Criticality Tier</label>
             <select name="urgency" className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-black text-slate-700 outline-none focus:border-red-500 italic text-xs">
                <option>Low Priority</option><option selected>Medium Diagnostic</option><option>High Criticality</option><option>Urgent Blocker</option>
             </select>
          </div>
          <button type="submit" className="w-full bg-red-600 text-white font-black py-5 rounded-3xl hover:bg-red-700 transition shadow-xl uppercase italic tracking-widest text-sm shadow-red-100">Dispatch Diagnostic Alert</button>
        </form>
      </div>
      <div className="flex flex-col h-full bg-slate-50 p-8 rounded-[2.5rem] border border-gray-200 shadow-inner">
        <h2 className="text-xl font-black text-slate-800 mb-8 uppercase italic border-b-2 border-slate-200 pb-2 tracking-tight">Intelligence Diagnostic Feed</h2>
        <div className="space-y-4 overflow-y-auto max-h-[550px] pr-2 custom-scrollbar">
          {issues.map(i => (
            <div key={i.id} className={`p-6 bg-white rounded-3xl shadow-md transition border-l-8 animate-fade-in ${i.urgency.includes('Urgent') || i.urgency.includes('High') ? 'border-red-600 bg-red-50/30' : 'border-yellow-400'}`}>
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-black text-slate-800 uppercase text-xs tracking-tight italic leading-tight">"{i.issueTitle}"</h3>
                <button onClick={() => deleteDoc(doc(db, 'shared_issues', i.id))} className="text-slate-200 hover:text-red-500 transition p-1"><i className="fas fa-trash-alt text-[10px]"></i></button>
              </div>
              <p className="text-[11px] text-slate-500 font-bold italic line-clamp-3 mb-6 leading-relaxed">"${i.issueDescription}"</p>
              <div className="flex justify-between items-center mt-auto">
                <span className="px-3 py-1 rounded-full text-[8px] font-black uppercase bg-slate-800 text-white shadow-sm tracking-widest">{i.urgency}</span>
                <button onClick={() => diagnose(i)} className="text-[#424A9F] text-[10px] font-black uppercase flex items-center hover:text-[#A3E635] transition italic tracking-tighter">Strategic Link <i className="fas fa-arrow-right ml-1.5 text-[8px]"></i></button>
              </div>
            </div>
          ))}
          {issues.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 opacity-20">
               <i className="fas fa-check-double fa-3x text-gray-400 mb-4"></i>
               <p className="text-center font-black uppercase text-[10px] tracking-[0.3em] italic">Infrastructure Nominal</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
