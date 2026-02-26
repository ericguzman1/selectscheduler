import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
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
 * CONFIGURATION
 * Note: Standard React (react-scripts) requires REACT_APP_ prefix.
 * If you are using Vite, use VITE_ prefix. 
 * I have set these up to check for both based on your screenshot.
 */
const getEnv = (key) => process.env[`REACT_APP_${key}`] || process.env[`VITE_${key}`] || "";

const firebaseConfig = {
  apiKey: getEnv("FIREBASE_API_KEY"),
  authDomain: getEnv("FIREBASE_AUTH_DOMAIN"),
  projectId: getEnv("FIREBASE_PROJECT_ID"),
  storageBucket: getEnv("FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: getEnv("FIREBASE_MESSAGING_SENDER_ID"),
  appId: getEnv("FIREBASE_APP_ID")
};

const GEMINI_API_KEY = getEnv("GEMINI_API_KEY");

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Real-time Listeners
  useEffect(() => {
    if (!user) return;

    const unsubEvents = onSnapshot(query(collection(db, 'shared_events'), orderBy('startDate')), (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubTasks = onSnapshot(collection(db, 'shared_tasks'), (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubIssues = onSnapshot(query(collection(db, 'shared_issues'), orderBy('timestamp')), (snap) => {
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

  const handleGemini = async (prompt) => {
    if (!aiEnabled || !GEMINI_API_KEY) return "AI Service Unavailable";
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (e) {
      return "AI Error occurred.";
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-100"><i className="fas fa-circle-notch fa-spin text-3xl text-[#424A9F]"></i></div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl">
          <h1 className="text-3xl font-bold text-center text-[#424A9F] mb-6">Accenture Project Hub</h1>
          {!showRegister ? (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              try { await signInWithEmailAndPassword(auth, e.target.email.value, e.target.password.value); }
              catch (err) { showMsg(err.message, true); }
            }}>
              <input name="email" type="email" placeholder="Email" required className="w-full p-3 rounded-lg border-2 border-gray-300 focus:ring-2 focus:ring-[#A3E635] outline-none" />
              <input name="password" type="password" placeholder="Password" required className="w-full p-3 rounded-lg border-2 border-gray-300 focus:ring-2 focus:ring-[#A3E635] outline-none" />
              <button type="submit" className="w-full bg-[#424A9F] text-white font-bold py-3 rounded-lg hover:bg-[#343D84]">Login</button>
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
              <input name="email" type="email" placeholder="Email" required className="w-full p-3 rounded-lg border-2 border-gray-300 focus:ring-2 focus:ring-[#A3E635] outline-none" />
              <input name="password" type="password" placeholder="Password" required className="w-full p-3 rounded-lg border-2 border-gray-300 focus:ring-2 focus:ring-[#A3E635] outline-none" />
              <button type="submit" className="w-full bg-[#A3E635] text-gray-900 font-bold py-3 rounded-lg hover:bg-[#8CD02F]">Register</button>
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
      <div className="w-full max-w-6xl bg-white p-6 rounded-2xl shadow-xl mb-6">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl font-extrabold text-[#424A9F]">Accenture Project Hub</h1>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-600">AI Features</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
                <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#A3E635]"></div>
              </label>
            </div>
            <button onClick={() => signOut(auth)} className="bg-gray-200 text-gray-700 font-semibold px-4 py-2 rounded-lg hover:bg-gray-300">Logout</button>
          </div>
        </div>
        <p className="text-center text-gray-600 mb-4 italic">Welcome to your team's central command center.</p>
        <div className="flex justify-center mb-4 space-x-2">
          <button onClick={() => setCurrentPage('schedule')} className={`px-4 py-2 rounded-lg font-semibold transition-all ${currentPage === 'schedule' ? 'bg-[#A3E635] text-gray-900 shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Meetings & Events</button>
          <button onClick={() => setCurrentPage('kanban')} className={`px-4 py-2 rounded-lg font-semibold transition-all ${currentPage === 'kanban' ? 'bg-[#A3E635] text-gray-900 shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Task Board</button>
          <button onClick={() => setCurrentPage('issues')} className={`px-4 py-2 rounded-lg font-semibold transition-all ${currentPage === 'issues' ? 'bg-[#A3E635] text-gray-900 shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Tech Issues</button>
        </div>
      </div>

      {message.text && (
        <div className={`w-full max-w-6xl p-4 mb-4 rounded-lg shadow-md border-l-4 ${message.isError ? 'bg-red-100 border-red-500 text-red-700' : 'bg-blue-100 border-[#A3E635] text-blue-700'}`}>
          <p className="font-bold text-sm"><i className={`fas ${message.isError ? 'fa-exclamation-circle' : 'fa-check-circle'} mr-2`}></i>{message.text}</p>
        </div>
      )}

      <div className="w-full max-w-6xl flex-grow">
        {currentPage === 'schedule' && <SchedulePage events={events} showMsg={showMsg} handleGemini={handleGemini} setModal={setModal} />}
        {currentPage === 'kanban' && <KanbanPage tasks={tasks} showMsg={showMsg} handleGemini={handleGemini} setModal={setModal} />}
        {currentPage === 'issues' && <IssuesPage issues={issues} showMsg={showMsg} handleGemini={handleGemini} setModal={setModal} />}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setModal(null)}>
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-[#424A9F] mb-4 uppercase italic tracking-widest">{modal.title}</h3>
            <div className="text-gray-700 max-h-[60vh] overflow-y-auto whitespace-pre-wrap">{modal.content}</div>
            <div className="flex justify-end mt-6 space-x-2">
              {modal.action && <button onClick={modal.action} className="bg-[#A3E635] text-gray-900 font-bold px-4 py-2 rounded-lg hover:bg-[#8CD02F]">Copy</button>}
              <button onClick={() => setModal(null)} className="bg-gray-200 font-bold px-4 py-2 rounded-lg hover:bg-gray-300">Close</button>
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
      showMsg("Event synchronized.");
    } catch (err) { showMsg(err.message, true); }
  };

  const handleAiExtract = async (e) => {
    const text = document.getElementById('ai-input').value;
    if (!text.trim()) return;
    setAiLoading(true);
    const summary = await handleGemini(`Identify high-priority events and SELECT lead POCs from this BEO text: ${text}`);
    setModal({ title: "AI Extraction Data", content: summary, action: () => navigator.clipboard.writeText(summary) });
    setAiLoading(false);
  };

  const generateSummary = async () => {
    if (events.length === 0) return;
    setAiLoading(true);
    const list = events.map(e => `${e.eventName} (${e.startDate})`).join(', ');
    const summary = await handleGemini(`Provide a concise professional team summary of these events: ${list}`);
    setModal({ title: "Operational Summary", content: summary });
    setAiLoading(false);
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-xl grid md:grid-cols-2 gap-8">
      <div>
        <h2 className="text-2xl font-bold text-[#424A9F] mb-4 uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8">Intake Engine</h2>
        <div className="p-4 bg-gray-50 rounded-xl mb-6 border-2 border-dashed border-gray-200">
          <textarea id="ai-input" className="w-full h-24 p-2 rounded-lg border-2 border-gray-300 resize-none outline-none focus:ring-2 focus:ring-[#A3E635]" placeholder="Paste BEO Text for AI Extraction..."></textarea>
          <button onClick={handleAiExtract} disabled={aiLoading} className="w-full mt-2 bg-[#A3E635] text-gray-900 font-bold py-2 rounded-lg hover:bg-[#8CD02F] transition flex items-center justify-center">
            <i className={`fas fa-bolt mr-2 ${aiLoading ? 'fa-spin' : ''}`}></i> {aiLoading ? 'Analyzing...' : 'AI Extract Data'}
          </button>
        </div>
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <input name="eventName" placeholder="Event Name*" required className="p-2 border-2 rounded-lg" />
            <input name="eventPoc" placeholder="Event POC*" required className="p-2 border-2 rounded-lg" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <input name="startDate" type="date" required className="p-2 border-2 rounded-lg" />
            <input name="endDate" type="date" required className="p-2 border-2 rounded-lg" />
          </div>
          <input name="eventLocation" placeholder="Specific Room/Location" className="w-full p-2 border-2 rounded-lg" />
          <details className="bg-gray-100 p-3 rounded-lg">
            <summary className="font-bold text-sm text-gray-700 cursor-pointer">Demo Resources</summary>
            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t">
              {resourceOptions.map(r => (
                <label key={r} className="flex items-center space-x-2 text-xs"><input type="checkbox" name="demo" value={r} className="rounded" /><span>{r}</span></label>
              ))}
            </div>
          </details>
          <button type="submit" className="w-full bg-[#424A9F] text-white font-bold py-3 rounded-lg hover:bg-[#343D84] uppercase italic tracking-widest transition">Commit to Schedule</button>
        </form>
      </div>
      <div className="flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-[#424A9F] uppercase italic">Operational Stream</h2>
          <button onClick={generateSummary} className="bg-[#A3E635] text-xs font-bold px-3 py-1 rounded-lg uppercase tracking-tighter">AI Summary</button>
        </div>
        <div className="space-y-3 overflow-y-auto max-h-[60vh] pr-2 custom-scrollbar">
          {events.length > 0 ? events.map(e => (
            <div key={e.id} className="bg-white p-4 rounded-xl shadow-md border-l-4 border-[#424A9F] flex justify-between items-center group">
              <div>
                <p className="font-bold text-sm uppercase tracking-tight">{e.eventName}</p>
                <p className="text-[10px] text-gray-400 font-bold uppercase">{e.startDate} | {e.eventLocation || 'NYIH'}</p>
              </div>
              <button onClick={() => deleteDoc(doc(db, 'shared_events', e.id))} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><i className="fas fa-trash-alt"></i></button>
            </div>
          )) : <p className="text-center text-gray-400 py-20 italic">Stream Idle</p>}
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
    await addDoc(collection(db, 'shared_tasks'), { title: val, status: 'todo' });
    e.target.reset();
  };

  const move = async (id, status) => {
    await updateDoc(doc(db, 'shared_tasks', id), { status });
  };

  const getAiKanbanSummary = async () => {
    const list = tasks.map(t => t.title).join(', ');
    const summary = await handleGemini(`Summarize the current project progress based on these tasks: ${list}`);
    setModal({ title: "Project Intelligence Report", content: summary });
  };

  const Col = ({ status, title, color }) => (
    <div className="bg-gray-100 p-4 rounded-2xl min-h-[400px] border-2 border-dashed border-gray-200">
      <h3 className={`font-black text-[10px] tracking-widest text-center mb-6 uppercase italic border-b-2 pb-2 ${color}`}>{title}</h3>
      <div className="space-y-3">
        {tasks.filter(t => t.status === status).map(t => (
          <div key={t.id} className="bg-white p-4 rounded-xl shadow-md border-b-4 border-slate-200 group transition hover:scale-[1.02]">
            <p className="text-sm font-bold text-slate-800 leading-tight italic">"{t.title}"</p>
            <div className="mt-4 flex justify-between items-center opacity-0 group-hover:opacity-100 transition">
              <div className="flex space-x-1">
                {status !== 'todo' && <button onClick={() => move(t.id, 'todo')} className="p-1 text-slate-300 hover:text-[#424A9F]"><i className="fas fa-chevron-left text-[8px]"></i></button>}
                {status !== 'complete' && <button onClick={() => move(t.id, status === 'todo' ? 'doing' : 'complete')} className="p-1 text-slate-300 hover:text-[#424A9F]"><i className="fas fa-chevron-right text-[8px]"></i></button>}
              </div>
              <button onClick={() => deleteDoc(doc(db, 'shared_tasks', t.id))} className="text-red-100 hover:text-red-500"><i className="fas fa-trash-alt text-[10px]"></i></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100">
      <div className="flex justify-between items-center mb-10 max-w-2xl mx-auto">
        <form onSubmit={add} className="flex gap-4 flex-grow bg-gray-50 p-2 rounded-2xl shadow-inner mr-4">
          <input name="t" placeholder="Add mission-critical objective..." className="flex-grow p-3 bg-transparent font-bold outline-none text-[#424A9F]" />
          <button type="submit" className="bg-[#424A9F] text-white px-8 py-3 rounded-xl font-black uppercase text-xs hover:bg-[#A3E635] hover:text-gray-900 transition">Push</button>
        </form>
        <button onClick={getAiKanbanSummary} className="bg-[#A3E635] text-gray-900 font-bold p-3 rounded-2xl shadow-lg hover:scale-105 transition"><i className="fas fa-bolt"></i></button>
      </div>
      <div className="grid md:grid-cols-3 gap-6">
        <Col status="todo" title="Backlog" color="text-slate-400 border-slate-300" />
        <Col status="doing" title="Active" color="text-blue-500 border-blue-400" />
        <Col status="complete" title="Delivered" color="text-[#A3E635] border-[#A3E635]" />
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
    showMsg("Incident dispatched.");
  };

  const diagnose = async (i) => {
    const advice = await handleGemini(`Diagnose this tech blocker: ${i.issueTitle} - ${i.issueDescription}. Provide 3 short diagnostic steps.`);
    setModal({ title: "AI Diagnostic Analysis", content: advice });
  };

  return (
    <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100 grid md:grid-cols-2 gap-12">
      <div>
        <h2 className="text-2xl font-black text-red-600 mb-8 flex items-center uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8 tracking-tighter">Log Blocker</h2>
        <form onSubmit={report} className="space-y-6">
          <input name="issueTitle" placeholder="Summary of blocker*" required className="w-full p-4 border-2 border-gray-100 rounded-2xl font-bold bg-gray-50 focus:bg-white focus:border-red-500 transition outline-none" />
          <textarea name="issueDescription" placeholder="Diagnostic details..." required rows="4" className="w-full p-4 border-2 border-gray-100 rounded-2xl font-medium bg-gray-50 focus:bg-white focus:border-red-500 transition outline-none resize-none"></textarea>
          <select name="urgency" className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-black text-slate-700 outline-none">
            <option>Low</option><option selected>Medium</option><option>High</option><option>Urgent</option>
          </select>
          <button type="submit" className="w-full bg-red-600 text-white font-black py-4 rounded-2xl hover:bg-red-700 transition shadow-xl uppercase italic tracking-widest">Dispatch Alert</button>
        </form>
      </div>
      <div className="flex flex-col h-full bg-slate-50 p-8 rounded-[2rem] border border-gray-200">
        <h2 className="text-xl font-black text-slate-800 mb-6 uppercase italic border-b-2 border-slate-200 pb-2">Intelligence Feed</h2>
        <div className="space-y-4 overflow-y-auto max-h-[500px] pr-2 custom-scrollbar">
          {issues.map(i => (
            <div key={i.id} className={`p-6 bg-white rounded-2xl shadow-md transition border-l-8 ${i.urgency === 'Urgent' ? 'border-red-600' : 'border-yellow-400'}`}>
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-black text-slate-800 uppercase text-[10px] tracking-tight italic leading-tight">{i.issueTitle}</h3>
                <button onClick={() => deleteDoc(doc(db, 'shared_issues', i.id))} className="text-slate-200 hover:text-red-500 transition p-1"><i className="fas fa-trash-alt text-[10px]"></i></button>
              </div>
              <p className="text-[11px] text-slate-500 font-bold italic line-clamp-3 mb-6">"{i.issueDescription}"</p>
              <div className="flex justify-between items-center mt-auto">
                <span className="px-3 py-1 rounded-full text-[8px] font-black uppercase bg-slate-800 text-white shadow-sm">{i.urgency}</span>
                <button onClick={() => diagnose(i)} className="text-[#424A9F] text-[9px] font-black uppercase flex items-center hover:text-[#A3E635] transition italic">ServiceNow Link <i className="fas fa-arrow-right ml-1 text-[8px]"></i></button>
              </div>
            </div>
          ))}
          {issues.length === 0 && <div className="text-center py-20 opacity-20 italic uppercase font-black text-xs tracking-widest">Systems Stable</div>}
        </div>
      </div>
    </div>
  );
}
