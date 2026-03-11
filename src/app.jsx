import React, { useState, useEffect, useRef } from 'react';
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

/**
 * CONFIGURATION
 * Direct literals for Vercel injection + Canvas environment fallback.
 */
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
  const [showRegister, setShowRegister] = useState(false);
  const [message, setMessage] = useState({ text: '', isError: false });
  const [aiEnabled, setAiEnabled] = useState(true);
  const [modal, setModal] = useState(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);

  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [issues, setIssues] = useState([]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else if (!auth.currentUser) {
          try { await signInAnonymously(auth); } catch (e) { console.warn("Manual sign-in required."); }
        }
      } catch (err) { console.error("Auth init failed:", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const path = (col) => collection(db, 'artifacts', appId, 'public', 'data', col);

    const unsubEvents = onSnapshot(query(path('shared_events'), orderBy('timestamp', 'desc')), (s) => setEvents(s.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => console.error(e));
    const unsubTasks = onSnapshot(query(path('shared_tasks'), orderBy('timestamp', 'desc')), (s) => setTasks(s.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => console.error(e));
    const unsubIssues = onSnapshot(query(path('shared_issues'), orderBy('timestamp', 'desc')), (s) => setIssues(s.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => console.error(e));

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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: isJson ? { responseMimeType: "application/json" } : {} })
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return isJson ? JSON.parse(text) : text;
    } catch (e) { return isJson ? {} : "AI Connection Failure."; }
  };

  const generateLeadBriefing = async () => {
    setIsBriefingLoading(true);
    const context = `Events: ${events.slice(0,2).map(e=>e.eventName).join(', ')}; Tasks: ${tasks.filter(t=>t.status==='doing').map(t=>t.title).join(', ')}; Blockers: ${issues.filter(i=>i.urgency==='Urgent').map(i=>i.title).join(', ')}`;
    const briefing = await fetchGemini(`Summarize status in exactly TWO short professional bullet points for leadership. Context: ${context}`);
    setModal({ title: "Leadership Intelligence Brief", content: briefing, action: () => { navigator.clipboard.writeText(briefing); showMsg("Copied briefing."); } });
    setIsBriefingLoading(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-100"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-[#424A9F]"></div></div>;

  if (!user) return <AuthPage showMsg={showMsg} />;

  return (
    <div className="min-h-screen bg-gray-100 p-4 flex flex-col items-center font-sans text-slate-900">
      <div className="w-full max-w-6xl bg-white p-6 rounded-[2rem] shadow-xl mb-6 border border-gray-50">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-4xl font-black text-[#424A9F] uppercase italic tracking-tighter leading-none">Accenture Hub</h1>
          <div className="flex items-center space-x-4">
            <button onClick={generateLeadBriefing} disabled={isBriefingLoading} className="bg-[#424A9F] text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#343D84] transition shadow-lg disabled:opacity-50">
              <i className={`fas fa-bolt mr-2 text-[#A3E635] ${isBriefingLoading ? 'animate-spin' : ''}`}></i>
              {isBriefingLoading ? 'Syncing...' : 'Lead Update'}
            </button>
            <button onClick={() => signOut(auth)} className="bg-gray-100 text-gray-400 font-bold px-4 py-2 rounded-xl hover:text-red-500 transition text-[10px] uppercase tracking-widest">Logout</button>
          </div>
        </div>
        <div className="flex justify-center mt-4 space-x-2">
          <button onClick={() => setCurrentPage('schedule')} className={`px-6 py-2.5 rounded-xl font-black uppercase text-xs transition-all ${currentPage === 'schedule' ? 'bg-[#A3E635] text-[#424A9F] shadow-lg scale-105' : 'bg-gray-100 text-gray-500'}`}>Meetings</button>
          <button onClick={() => setCurrentPage('kanban')} className={`px-6 py-2.5 rounded-xl font-black uppercase text-xs transition-all ${currentPage === 'kanban' ? 'bg-[#A3E635] text-[#424A9F] shadow-lg scale-105' : 'bg-gray-100 text-gray-500'}`}>Task Board</button>
          <button onClick={() => setCurrentPage('issues')} className={`px-6 py-2.5 rounded-xl font-black uppercase text-xs transition-all ${currentPage === 'issues' ? 'bg-[#A3E635] text-[#424A9F] shadow-lg scale-105' : 'bg-gray-100 text-gray-500'}`}>Tech Feed</button>
        </div>
      </div>

      {message.text && (
        <div className={`w-full max-w-6xl p-4 mb-4 rounded-xl shadow-lg border-l-4 transition-all ${message.isError ? 'bg-red-50 border-red-500 text-red-700' : 'bg-blue-50 border-[#A3E635] text-blue-700'}`}>
          <p className="font-bold text-sm leading-relaxed tracking-tight italic">{message.text}</p>
        </div>
      )}

      <div className="w-full max-w-6xl flex-grow">
        {currentPage === 'schedule' && <SchedulePage events={events} showMsg={showMsg} fetchGemini={fetchGemini} setModal={setModal} />}
        {currentPage === 'kanban' && <KanbanPage tasks={tasks} showMsg={showMsg} />}
        {currentPage === 'issues' && <IssuesPage issues={issues} showMsg={showMsg} />}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => setModal(null)}>
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl max-w-xl w-full border border-gray-100" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-[#424A9F] mb-6 uppercase italic border-b pb-2">{modal.title}</h3>
            <div className="text-gray-700 text-sm italic whitespace-pre-wrap leading-relaxed">{modal.content}</div>
            <div className="flex gap-2 mt-8">
              {modal.action && <button onClick={modal.action} className="flex-1 bg-[#A3E635] text-[#424A9F] font-black py-3 rounded-xl hover:bg-[#8CD02F] uppercase text-xs italic">Copy Update</button>}
              <button onClick={() => setModal(null)} className="flex-1 bg-gray-100 font-bold py-3 rounded-xl hover:bg-gray-200 uppercase text-xs italic">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SchedulePage({ events, showMsg, fetchGemini, setModal }) {
  const [aiLoading, setAiLoading] = useState(false);
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

  const handleAiExtract = async () => {
    const text = document.getElementById('ai-input').value;
    if (!text.trim()) return;
    setAiLoading(true);
    const result = await fetchGemini(`Extract event details from BEO text into JSON. 
      Keys: eventName, startDate, endDate, eventPoc, selectPoc, location, eventLocation, classification, sessionType, attendees, demo, selectResources, sessionDays, sessionSupportDuration. 
      Input text: ${text}`, true);
    if (result && formRef.current) {
      Object.keys(result).forEach(key => { if (formRef.current.elements[key]) formRef.current.elements[key].value = result[key]; });
      showMsg("AI populated the Hub form.");
    }
    setAiLoading(false);
  };

  return (
    <div className="bg-white p-8 rounded-[2.5rem] shadow-xl grid md:grid-cols-2 gap-8 border border-gray-100">
      <div>
        <h2 className="text-xl font-black text-[#424A9F] mb-8 uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8">Intake Engine</h2>
        <div className="p-5 bg-gray-50 rounded-[2rem] mb-8 border-2 border-dashed border-gray-200">
          <textarea id="ai-input" className="w-full h-24 p-4 rounded-2xl border-2 border-gray-200 bg-white resize-none outline-none focus:ring-2 focus:ring-[#A3E635] text-sm italic" placeholder="Paste BEO for extraction..."></textarea>
          <button onClick={handleAiExtract} disabled={aiLoading} className="w-full mt-3 bg-[#A3E635] text-[#424A9F] font-black py-4 rounded-xl transition uppercase text-[10px] tracking-widest shadow-md">
            {aiLoading ? 'ANALYZING...' : 'EXECUTE AI EXTRACT'}
          </button>
        </div>
        <form onSubmit={handleAdd} ref={formRef} className="space-y-4 font-bold text-sm italic">
          <div className="grid grid-cols-2 gap-4">
            <input name="eventName" placeholder="Event Name*" required className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
            <input name="eventPoc" placeholder="Event Lead*" required className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-[9px] font-black uppercase text-gray-400">Start Date<input name="startDate" type="date" required className="w-full p-4 mt-1 border-2 rounded-2xl bg-gray-50 outline-none" /></div>
            <div className="text-[9px] font-black uppercase text-gray-400">End Date<input name="endDate" type="date" required className="w-full p-4 mt-1 border-2 rounded-2xl bg-gray-50 outline-none" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <input name="selectPoc" placeholder="SELECT Lead" className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
             <input name="location" defaultValue="NYIH" className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
          </div>
          <input name="eventLocation" placeholder="Specific Room/Floor Designation" className="w-full p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
          <div className="grid grid-cols-2 gap-4">
             <input name="classification" placeholder="Classification" className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
             <input name="sessionType" placeholder="Session Type" className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
          </div>
          <input name="attendees" placeholder="Attendees Count" className="w-full p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
          <div className="grid grid-cols-2 gap-4">
             <input name="demo" placeholder="Demo Requirements" className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
             <input name="selectResources" placeholder="SELECT Resources" className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
             <input name="sessionDays" placeholder="Session Days" className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
             <input name="sessionSupportDuration" placeholder="Support Duration" className="p-4 border-2 rounded-2xl bg-gray-50 focus:bg-white outline-none" />
          </div>
          <button type="submit" className="w-full bg-[#424A9F] text-white font-black py-4 rounded-2xl shadow-xl transition uppercase italic mt-4">Commit to Dashboard</button>
        </form>
      </div>
      <div className="flex flex-col h-full">
        <h2 className="text-xl font-black text-[#424A9F] mb-6 uppercase italic">Operational Live Stream</h2>
        <div className="space-y-4 overflow-y-auto max-h-[75vh] pr-2 custom-scrollbar">
          {events.map(e => (
            <div key={e.id} className="bg-white p-5 rounded-2xl shadow-md border-l-8 border-[#424A9F] flex justify-between items-center group transition border border-gray-50 hover:bg-indigo-50/50">
              <div>
                <p className="font-black text-slate-800 uppercase text-xs italic leading-none mb-1">{e.eventName}</p>
                <p className="text-[10px] text-gray-400 font-bold uppercase mt-1 italic">{e.startDate} — {e.eventPoc}</p>
                <button onClick={() => setModal({ title: "Intelligence Overview", content: `Room: ${e.eventLocation}\nType: ${e.sessionType}\nAttendees: ${e.attendees}\nResources: ${e.selectResources}\nDuration: ${e.sessionSupportDuration}` })} className="text-[9px] text-[#424A9F] font-black uppercase mt-2 hover:text-[#A3E635] transition-all">Details</button>
              </div>
              <button onClick={async () => await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_events', e.id))} className="text-gray-200 hover:text-red-500 transition p-2"><i className="fas fa-trash-alt"></i></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KanbanPage({ tasks, showMsg }) {
  const [editingId, setEditingId] = useState(null);
  const handleAdd = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { title: fd.get('t'), assignee: fd.get('a'), status: 'todo', timestamp: new Date().toISOString() };
    if (data.title) await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shared_tasks'), data);
    e.target.reset();
  };
  const updateTask = async (id, p) => { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', id), p); setEditingId(null); };
  const Col = ({ status, title, color }) => (
    <div className="bg-gray-100 p-6 rounded-[2.5rem] min-h-[500px] border-2 border-dashed border-gray-200 flex flex-col shadow-inner">
      <h3 className={`font-black text-[10px] tracking-[0.3em] text-center mb-8 uppercase italic border-b-2 pb-2 ${color} border-gray-200`}>{title}</h3>
      <div className="space-y-4 flex-grow overflow-y-auto">
        {tasks.filter(t => t.status === status).map(t => (
          <div key={t.id} className="bg-white p-5 rounded-2xl shadow-md border-b-4 border-slate-200 group transition hover:scale-105 border border-gray-50/50">
            {editingId === t.id ? (
               <div className="space-y-2">
                  <input id={`et-${t.id}`} defaultValue={t.title} className="w-full p-2 text-xs border rounded-lg italic font-bold" />
                  <input id={`ea-${t.id}`} defaultValue={t.assignee} className="w-full p-2 text-xs border rounded-lg italic" />
                  <div className="flex gap-2"><button onClick={() => updateTask(t.id, { title: document.getElementById(`et-${t.id}`).value, assignee: document.getElementById(`ea-${t.id}`).value })} className="flex-1 bg-green-500 text-white text-[10px] py-1 rounded font-black uppercase">Save</button><button onClick={()=>setEditingId(null)} className="flex-1 bg-gray-200 text-gray-500 text-[10px] py-1 rounded font-black">X</button></div>
               </div>
            ) : (
              <>
                <p className="text-sm font-black text-slate-800 tracking-tight italic">"{t.title}"</p>
                <div className="flex items-center text-[10px] font-bold text-[#424A9F] uppercase tracking-tighter italic mt-2"><i className="fas fa-user-circle mr-1.5 opacity-50"></i> {t.assignee || 'Unassigned'}</div>
                <div className="mt-4 flex justify-between items-center opacity-0 group-hover:opacity-100 transition">
                  <div className="flex space-x-1.5">
                    {status !== 'todo' && <button onClick={() => updateTask(t.id, { status: 'todo' })} className="p-1.5 bg-gray-50 rounded-lg hover:bg-[#424A9F] hover:text-white transition shadow-sm"><i className="fas fa-chevron-left text-[8px]"></i></button>}
                    {status !== 'complete' && <button onClick={() => updateTask(t.id, { status: status === 'todo' ? 'doing' : 'complete' })} className="p-1.5 bg-gray-50 rounded-lg hover:bg-[#424A9F] hover:text-white transition shadow-sm"><i className="fas fa-chevron-right text-[8px]"></i></button>}
                  </div>
                  <div className="flex space-x-2"><button onClick={()=>setEditingId(t.id)} className="text-blue-300 hover:text-blue-500"><i className="fas fa-edit text-[10px]"></i></button><button onClick={()=>deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_tasks', t.id))} className="text-red-100 hover:text-red-500 transition"><i className="fas fa-trash-alt text-[10px]"></i></button></div>
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
      <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-4 mb-12 max-w-3xl mx-auto bg-slate-50 p-2 rounded-2xl border-2 border-slate-200 shadow-inner">
        <input name="t" placeholder="Add Mission Objective..." className="flex-grow p-4 bg-transparent font-black outline-none text-[#424A9F] italic text-sm" />
        <input name="a" placeholder="Assign Team Member..." className="md:w-48 p-4 bg-transparent font-bold outline-none text-gray-500 italic text-sm border-l-2 border-slate-200" />
        <button type="submit" className="bg-[#424A9F] text-white px-10 py-4 rounded-xl font-black hover:bg-[#A3E635] hover:text-[#424A9F] transition shadow-lg italic uppercase text-xs">Push</button>
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
        <h2 className="text-2xl font-black text-red-600 mb-8 uppercase italic underline decoration-[#A3E635] decoration-4 underline-offset-8 tracking-tighter leading-none">Log Blocker</h2>
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
              <div className="flex justify-between items-start mb-4"><h3 className="font-black text-slate-800 uppercase text-xs tracking-tight italic">"{i.title}"</h3><button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shared_issues', i.id))} className="text-slate-200 hover:text-red-500 transition p-1"><i className="fas fa-trash-alt text-[10px]"></i></button></div>
              <p className="text-[11px] text-slate-500 font-bold italic line-clamp-3 leading-relaxed">"${i.desc}"</p>
              <div className="flex justify-between items-center mt-6"><span className="px-3 py-1 rounded-full text-[8px] font-black uppercase bg-slate-800 text-white shadow-sm tracking-widest">{i.urgency}</span></div>
            </div>
          ))}
          {issues.length === 0 && <div className="text-center py-20 opacity-20 font-black uppercase text-[10px] tracking-widest italic">Stable</div>}
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
        <div className="flex justify-center mb-8 font-black"><div className="bg-[#A3E635] p-4 rounded-3xl text-[#424A9F] shadow-lg"><i className="fas fa-project-diagram fa-2x"></i></div></div>
        <h1 className="text-3xl font-black text-center text-[#424A9F] mb-6 uppercase italic tracking-tighter">Accenture Hub</h1>
        <form onSubmit={authSubmit} className="space-y-4">
          <input name="email" type="email" placeholder="Corporate ID" required className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none focus:border-[#424A9F] bg-gray-50 font-bold" />
          <input name="password" type="password" placeholder="Key Phrase" required className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none focus:border-[#424A9F] bg-gray-50 font-bold" />
          <button type="submit" className={`w-full font-black py-4 rounded-2xl shadow-xl mt-4 ${isLogin ? 'bg-[#424A9F] text-white' : 'bg-[#A3E635] text-gray-900'}`}>{isLogin ? 'INITIATE LOGIN' : 'CREATE PROFILE'}</button>
        </form>
        <button onClick={() => setIsLogin(!isLogin)} className="w-full mt-8 text-xs font-black text-gray-400 hover:text-[#424A9F] uppercase tracking-widest">{isLogin ? "Register Hub Access" : "Back to Login"}</button>
      </div>
    </div>
  );
}
