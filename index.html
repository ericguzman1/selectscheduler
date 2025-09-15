import { useEffect, useState, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, addDoc, collection, onSnapshot, query, where, getDocs, writeBatch, deleteDoc, updateDoc } from 'firebase/firestore';

// Global Firebase and App config
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const GEMINI_API_KEY = ""; // Your Gemini API Key

function App() {
  const [currentPage, setCurrentPage] = useState('schedule');
  const [auth, setAuth] = useState(null);
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  // Initialize Firebase and handle auth state
  useEffect(() => {
    const app = initializeApp(firebaseConfig);
    const authInstance = getAuth(app);
    const dbInstance = getFirestore(app);
    setAuth(authInstance);
    setDb(dbInstance);

    const unsubscribe = onAuthStateChanged(authInstance, (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        setUserId(crypto.randomUUID());
      }
      setIsAuthReady(true);
      setLoading(false);
    });

    if (initialAuthToken) {
      signInWithCustomToken(authInstance, initialAuthToken).catch(console.error);
    } else {
      signInAnonymously(authInstance).catch(console.error);
    }

    return () => unsubscribe();
  }, []);

  const showMessage = (msg) => {
    setMessage(msg);
    setTimeout(() => {
      setMessage('');
    }, 5000);
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'schedule':
        return <SchedulePage userId={userId} db={db} showMessage={showMessage} />;
      case 'kanban':
        return <KanbanPage userId={userId} db={db} showMessage={showMessage} />;
      case 'issues':
        return <TechIssuesPage userId={userId} db={db} showMessage={showMessage} />;
      default:
        return null;
    }
  };

  if (loading || !isAuthReady) {
    return (
      <div className="min-h-screen p-4 flex flex-col items-center justify-center text-gray-800">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
        <p className="mt-4 text-lg font-semibold">Loading app...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 flex flex-col items-center text-gray-800">
      <div className="w-full max-w-5xl bg-white p-6 rounded-2xl shadow-2xl mb-6">
        <h1 className="text-4xl font-extrabold text-center text-[#424A9F] mb-2">Accenture Project Hub</h1>
        <p className="text-center text-gray-600 mb-4">Welcome to your team's central command center.</p>
        <div className="flex justify-center mb-4">
          <button
            onClick={() => setCurrentPage('schedule')}
            className={`nav-btn px-4 py-2 mx-2 rounded-lg font-semibold transition-all duration-300 ${
              currentPage === 'schedule' ? 'bg-[#A3E635] text-gray-900 shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Meetings & Events
          </button>
          <button
            onClick={() => setCurrentPage('kanban')}
            className={`nav-btn px-4 py-2 mx-2 rounded-lg font-semibold transition-all duration-300 ${
              currentPage === 'kanban' ? 'bg-[#A3E635] text-gray-900 shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Task Board
          </button>
          <button
            onClick={() => setCurrentPage('issues')}
            className={`nav-btn px-4 py-2 mx-2 rounded-lg font-semibold transition-all duration-300 ${
              currentPage === 'issues' ? 'bg-[#A3E635] text-gray-900 shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Tech Issues
          </button>
        </div>
      </div>

      <div className="w-full max-w-5xl flex-grow">
        {renderPage()}
      </div>

      {message && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-blue-100 border-l-4 border-[#A3E635] text-blue-700 p-4 rounded-lg shadow-lg z-50">
          {message}
        </div>
      )}
    </div>
  );
}

function SchedulePage({ userId, db, showMessage }) {
  const [events, setEvents] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState('');
  const [view, setView] = useState('list');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    if (!db || !userId) return;
    const eventsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/events`);
    const unsubscribe = onSnapshot(eventsCollectionRef, (snapshot) => {
      const fetchedEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setEvents(fetchedEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
    }, (error) => {
      console.error("Error fetching events: ", error);
      showMessage("Failed to load events.");
    });
    return () => unsubscribe();
  }, [db, userId, showMessage]);

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!db) return;
    const formData = Object.fromEntries(new FormData(e.target));
    try {
      const eventsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/events`);
      await addDoc(eventsCollectionRef, { ...formData, timestamp: new Date() });
      e.target.reset();
      showMessage('Event added successfully!');
    } catch (error) {
      console.error('Error adding event: ', error);
      showMessage('Failed to add event.');
    }
  };

  const handleAnalyzePDF = async () => {
    const pdfText = formRef.current.querySelector('#pdfText').value;
    if (!pdfText.trim()) return;

    setIsLoading(true);
    const prompt = `You are an expert AI assistant that extracts structured data from event reports. Carefully extract the following information from the text provided below. Be precise. The data must be returned as a single JSON object. Specifically, check for mentions of 'SELECT' and note if 'SELECT POC' is involved. Identify if the meeting location is 'tank', 'interchange', or 'vision room'. Also, indicate if 'leadership' is mentioned in the attendees list. The following is the report text: ${pdfText}`;
    
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            eventName: { "type": "STRING" }, startDate: { "type": "STRING" }, endDate: { "type": "STRING" }, eventPOC: { "type": "STRING" }, selectPOC: { "type": "STRING" }, location: { "type": "STRING" }, eventLocation: { "type": "STRING" }, classification: { "type": "STRING" }, sessionType: { "type": "STRING" }, attendees: { "type": "STRING" }, demo: { "type": "STRING" }, selectResources: { "type": "STRING" }, sessionDays: { "type": "STRING" }, sessionSupportDuration: { "type": "STRING" },
          },
        },
      },
    };

    let retries = 0;
    const maxRetries = 3;
    while (retries < maxRetries) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        const extractedData = JSON.parse(jsonText);
        
        for (const key in extractedData) {
          if (formRef.current.elements[key]) {
            formRef.current.elements[key].value = extractedData[key];
          }
        }
        showMessage('Data extracted successfully!');
        break;
      } catch (error) {
        console.error('API call failed: ', error);
        retries++;
        if (retries < maxRetries) {
          await new Promise(res => setTimeout(res, Math.pow(2, retries) * 1000));
        } else {
          showMessage('Failed to extract data after multiple retries.');
        }
      }
    }
    setIsLoading(false);
  };

  const handleGenerateSummary = async () => {
    setIsLoading(true);
    const eventList = events.map(e => (`Event Name: ${e.eventName}, Date: ${e.startDate}, Location: ${e.eventLocation || e.location}, POC: ${e.eventPOC}`)).join('; ');
    const prompt = `Please provide a concise and professional summary of the team's upcoming events based on the following list. Organize the summary by key details like event name, date, location, and POC. Do not add extra commentary, just the summary. Events: ${eventList || 'None'}`;
    
    const payload = { contents: [{ parts: [{ text: prompt }] }] };

    let retries = 0;
    const maxRetries = 3;
    while (retries < maxRetries) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        const generatedText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (generatedText) {
          setModalContent(generatedText);
          setIsModalOpen(true);
          showMessage('Summary generated successfully!');
          break;
        } else {
          showMessage('Failed to generate summary. Please try again.');
          break;
        }
      } catch (error) {
        console.error('API call failed: ', error);
        retries++;
        if (retries < maxRetries) {
          await new Promise(res => setTimeout(res, Math.pow(2, retries) * 1000));
        } else {
          showMessage('Failed to generate summary after multiple retries.');
        }
      }
    }
    setIsLoading(false);
  };

  const handleCleanup = async () => {
    if (!db) return;
    showMessage('Cleaning up old events...');
    try {
      const eventsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/events`);
      const q = query(eventsCollectionRef);
      const querySnapshot = await getDocs(q);
      const batch = writeBatch(db);
      
      let cleanedUpCount = 0;
      querySnapshot.docs.forEach(doc => {
        const eventDate = new Date(doc.data().endDate);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        if (eventDate < thirtyDaysAgo) {
          batch.delete(doc.ref);
          cleanedUpCount++;
        }
      });
      await batch.commit();
      showMessage(`Cleaned up ${cleanedUpCount} old events.`);
    } catch (error) {
      console.error("Error cleaning up events: ", error);
      showMessage("Failed to clean up events.");
    }
  };

  const handleDeleteEvent = async (id) => {
    if (!db) return;
    try {
      const eventDocRef = doc(db, `artifacts/${appId}/users/${userId}/events`, id);
      await deleteDoc(eventDocRef);
      showMessage("Event deleted successfully!");
    } catch (error) {
      console.error("Error deleting event: ", error);
      showMessage("Failed to delete event.");
    }
  };

  const handleExtractForServiceNow = (event) => {
    const output = `Event Name: ${event.eventName || ''}\nStart Date: ${event.startDate || ''}\nEnd Date: ${event.endDate || ''}\nEvent POC: ${event.eventPOC || ''}\nSELECT POC: ${event.selectPOC || ''}\nLocation: ${event.location || ''}\nEvent Location: ${event.eventLocation || ''}\nClassification: ${event.classification || ''}\nSession Type: ${event.sessionType || ''}\nAttendees: ${event.attendees || ''}\nDemo: ${event.demo || ''}\nSELECT Resources: ${event.selectResources || ''}\nSession Days: ${event.sessionDays || ''}\nSession Support Duration: ${event.sessionSupportDuration || ''}`;
    setModalContent(output);
    setIsModalOpen(true);
  };

  const renderCalendar = () => {
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDay = new Date(year, month, 1).getDay();

    const selectedDayEvents = events.filter(event => {
      const eventDate = new Date(event.startDate);
      return eventDate.getFullYear() === year && eventDate.getMonth() === month && eventDate.getDate() === currentDate.getDate();
    });

    return (
      <div className="bg-gray-50 p-4 rounded-xl shadow-inner">
        <div className="flex justify-between items-center mb-4">
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600 hover:text-[#424A9F]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h3 className="text-xl font-bold text-[#424A9F]">{monthNames[month]} {year}</h3>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600 hover:text-[#424A9F]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center font-semibold text-sm">
          {daysOfWeek.map(day => <div key={day} className="text-gray-500">{day}</div>)}
          {Array.from({ length: startDay }).map((_, i) => <div key={`empty-${i}`}></div>)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const isEventDay = events.some(event => {
              const eventDate = new Date(event.startDate);
              return eventDate.getFullYear() === year && eventDate.getMonth() === month && eventDate.getDate() === day;
            });
            return (
              <div
                key={day}
                onClick={() => setCurrentDate(new Date(year, month, day))}
                className={`p-2 rounded-lg cursor-pointer transition-all duration-200 ${isEventDay ? 'bg-[#A3E635] text-gray-900 font-bold shadow-md hover:bg-[#8CD02F]' : 'hover:bg-gray-200'}`}
              >
                {day}
              </div>
            );
          })}
        </div>
        {selectedDayEvents.length > 0 && (
          <div className="mt-4 p-4 bg-white rounded-lg shadow-inner border border-gray-200">
            <h4 className="font-bold text-[#424A9F] mb-2">Events on {currentDate.toDateString()}</h4>
            <ul className="list-disc list-inside space-y-1">
              {selectedDayEvents.map(event => (
                <li key={event.id} className="text-sm">
                  <span className="font-semibold">{event.eventName}</span> at {event.eventLocation || event.location} with {event.eventPOC}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const renderListView = () => {
    return (
      <div className="space-y-4">
        <input type="text" id="scheduleSearch" placeholder="Search events..." className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" />
        {events.length > 0 ? (
          events.map(event => (
            <div key={event.id} className="bg-gray-50 p-4 rounded-xl shadow-md flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold mb-1">{event.eventName}</h3>
                <p className="text-sm"><strong>Date:</strong> {event.startDate} - {event.endDate}</p>
                <p className="text-sm"><strong>Location:</strong> {event.eventLocation || event.location}</p>
                <p className="text-sm"><strong>POC:</strong> {event.eventPOC}</p>
                <p className="text-sm"><strong>Attendees:</strong> {event.attendees}</p>
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={() => handleExtractForServiceNow(event)} className="bg-[#A3E635] text-gray-900 px-3 py-1 rounded-lg text-xs font-bold hover:bg-[#8CD02F] transition-colors duration-300">Export</button>
                <button onClick={() => handleDeleteEvent(event.id)} className="bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-red-600 transition-colors duration-300">Delete</button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-center text-gray-500">No events scheduled yet. Add one above!</p>
        )}
      </div>
    );
  };

  return (
    <div className="grid md:grid-cols-2 gap-6 relative">
      <div>
        <h2 className="text-2xl font-bold text-[#424A9F] mb-4">Add a New Event</h2>
        <div className="p-4 bg-gray-50 rounded-xl shadow-inner mb-4">
          <label className="block text-sm font-medium mb-1">Paste Report Text for AI Extraction:</label>
          <textarea id="pdfText" className="w-full h-32 p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-[#A3E635]" placeholder="Paste your PDF report text here..."></textarea>
          <button onClick={handleAnalyzePDF} className="mt-2 w-full bg-[#A3E635] text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-[#8CD02F] transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed" disabled={isLoading}>{isLoading ? 'Extracting...' : 'Extract Data with AI'}</button>
        </div>
        
        <form onSubmit={handleFormSubmit} ref={formRef} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Event Name:</label><input type="text" name="eventName" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">Start Date:</label><input type="date" name="startDate" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">End Date:</label><input type="date" name="endDate" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">Event POC:</label><input type="text" name="eventPOC" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">SELECT POC:</label><input type="text" name="selectPOC" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">Location:</label><input type="text" name="location" defaultValue="NYIH" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">Event Location:</label><input type="text" name="eventLocation" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">Classification:</label><input type="text" name="classification" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">Session Type:</label><input type="text" name="sessionType" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">Attendees:</label><input type="text" name="attendees" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">Demo:</label><input type="text" name="demo" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">SELECT Resources:</label><input type="text" name="selectResources" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">Session Days:</label><input type="text" name="sessionDays" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
            <div><label className="block text-sm font-medium mb-1">Session Support Duration:</label><input type="text" name="sessionSupportDuration" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
          </div>
          <button type="submit" className="w-full bg-[#424A9F] text-white font-bold py-2 px-4 rounded-lg hover:bg-[#343D84] transition-colors duration-300">Add Event</button>
        </form>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-[#424A9F] mb-4">Upcoming Events</h2>
        <div className="flex justify-between items-center mb-4">
          <div className="flex gap-2">
            <button onClick={() => setView('list')} className={`px-4 py-2 rounded-lg font-bold transition-colors duration-300 ${view === 'list' ? 'bg-[#424A9F] text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>List View</button>
            <button onClick={() => setView('calendar')} className={`px-4 py-2 rounded-lg font-bold transition-colors duration-300 ${view === 'calendar' ? 'bg-[#424A9F] text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>Calendar View</button>
          </div>
          <div className="flex gap-2">
            <button onClick={handleGenerateSummary} className="bg-[#A3E635] text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-[#8CD02F] transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed" disabled={isLoading}>
              {isLoading ? 'Generating...' : 'Generate Summary'}
            </button>
            <button onClick={handleCleanup} className="bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors duration-300">Clean Up</button>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-2xl">
          {view === 'list' ? renderListView() : renderCalendar()}
        </div>
      </div>
      
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-lg w-full">
            <h3 className="text-xl font-bold text-[#424A9F] mb-4">ServiceNow Data / AI Summary</h3>
            <p className="text-gray-600 text-sm mb-2">Copy the text below to paste into ServiceNow or send to a lead.</p>
            <textarea readOnly value={modalContent} className="w-full h-64 p-4 rounded-lg border-2 border-gray-300 bg-gray-50 text-gray-900 resize-none font-mono text-sm" onClick={(e) => e.target.select()}></textarea>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => copyToClipboard(modalContent)} className="bg-[#A3E635] text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-[#8CD02F] transition-colors duration-300">Copy to Clipboard</button>
              <button onClick={() => setIsModalOpen(false)} className="bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors duration-300">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KanbanPage({ userId, db, showMessage }) {
  const [tasks, setTasks] = useState([]);
  const [newTaskText, setNewTaskText] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!db || !userId) return;
    const tasksCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/tasks`);
    const unsubscribe = onSnapshot(tasksCollectionRef, (snapshot) => {
      setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching tasks: ", error);
      showMessage("Failed to load tasks.");
    });
    return () => unsubscribe();
  }, [db, userId, showMessage]);

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!newTaskText.trim() || !db) return;
    try {
      const tasksCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/tasks`);
      await addDoc(tasksCollectionRef, { text: newTaskText, status: 'todo', timestamp: new Date(), steps: '' });
      setNewTaskText('');
      showMessage('Task added successfully!');
    } catch (error) {
      console.error("Error adding task: ", error);
      showMessage("Failed to add task.");
    }
  };

  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = async (e, status) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    const taskToUpdate = tasks.find(t => t.id === taskId);
    if (!taskToUpdate || taskToUpdate.status === status) return;
    try {
      const taskDocRef = doc(db, `artifacts/${appId}/users/${userId}/tasks`, taskId);
      await updateDoc(taskDocRef, { status: status });
      showMessage(`Task moved to ${status}.`);
    } catch (error) {
      console.error("Error updating task status: ", error);
      showMessage("Failed to move task.");
    }
  };

  const handleGenerateSummary = async () => {
    setIsLoading(true);
    const todoTasks = tasks.filter(t => t.status === 'todo').map(t => t.text).join(', ');
    const doingTasks = tasks.filter(t => t.status === 'doing').map(t => t.text).join(', ');
    const completedTasks = tasks.filter(t => t.status === 'complete').map(t => t.text).join(', ');
    
    const prompt = `Please provide a concise and professional summary of the team's progress on the following tasks. Organize the summary by status: 'Needs to be Done', 'Doing', and 'Completed'. Do not add extra commentary, just the summary. Tasks: Needs to be Done: ${todoTasks || 'None'} Doing: ${doingTasks || 'None'} Completed: ${completedTasks || 'None'}`;
    
    const payload = { contents: [{ parts: [{ text: prompt }] }] };

    let retries = 0;
    const maxRetries = 3;
    while (retries < maxRetries) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        const generatedText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (generatedText) {
          showMessage(generatedText);
          break;
        } else {
          showMessage('Failed to generate summary. Please try again.');
          break;
        }
      } catch (error) {
        console.error('API call failed: ', error);
        retries++;
        if (retries < maxRetries) {
          await new Promise(res => setTimeout(res, Math.pow(2, retries) * 1000));
        } else {
          showMessage('Failed to generate summary after multiple retries.');
        }
      }
    }
    setIsLoading(false);
  };

  const handleCleanup = async () => {
    if (!db) return;
    showMessage('Cleaning up completed tasks...');
    try {
      const tasksCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/tasks`);
      const q = query(tasksCollectionRef, where('status', '==', 'complete'));
      const querySnapshot = await getDocs(q);
      const batch = writeBatch(db);

      if (querySnapshot.docs.length === 0) {
        showMessage('No completed tasks to clean up.');
        return;
      }
      
      querySnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      showMessage(`Cleaned up ${querySnapshot.docs.length} completed tasks.`);
    } catch (error) {
      console.error("Error cleaning up tasks: ", error);
      showMessage("Failed to clean up tasks.");
    }
  };

  const openEditModal = (task) => {
    setEditingTask(task);
    setIsModalOpen(true);
  };

  const handleSaveSteps = async () => {
    if (!db || !editingTask) return;
    try {
      const taskDocRef = doc(db, `artifacts/${appId}/users/${userId}/tasks`, editingTask.id);
      await updateDoc(taskDocRef, { steps: editingTask.steps });
      setIsModalOpen(false);
      showMessage('Task steps updated!');
    } catch (error) {
      console.error("Error updating task steps: ", error);
      showMessage("Failed to update task steps.");
    }
  };

  const handleDeleteTask = async (id) => {
    if (!db) return;
    try {
      const taskDocRef = doc(db, `artifacts/${appId}/users/${userId}/tasks`, id);
      await deleteDoc(taskDocRef);
      showMessage("Task deleted successfully!");
    } catch (error) {
      console.error("Error deleting task: ", error);
      showMessage("Failed to delete task.");
    }
  };

  const renderTasks = (status) => {
    return tasks
      .filter(t => t.status === status)
      .map(task => (
        <div
          key={task.id}
          draggable
          onDragStart={(e) => e.dataTransfer.setData("taskId", task.id)}
          className="bg-white p-3 rounded-xl shadow-md cursor-grab active:cursor-grabbing transform hover:scale-105 transition-transform duration-200 flex justify-between items-center"
        >
          <p className="text-gray-900">{task.text}</p>
          <div className="flex gap-2">
            <button onClick={() => openEditModal(task)} className="text-gray-400 hover:text-blue-500 transition-colors" title="Edit steps">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zm-7.56 10.975a2 2 0 102.828 2.828l1.414-1.414-2.828-2.828-1.414 1.414z" /><path fillRule="evenodd" d="M12.414 5.242l1.414 1.414-8.086 8.086-1.414-1.414 8.086-8.086z" clipRule="evenodd" /></svg>
            </button>
            <button onClick={() => copyToClipboard(`Task: ${task.text || ''}\n\nSteps:\n${task.steps || 'No steps documented.'}`)} className="text-gray-400 hover:text-green-500 transition-colors" title="Export steps">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 01-1-1V4a1 1 0 011-1h6l2 2h4a1 1 0 011 1v10a1 1 0 01-1 1H3zm11-2H4V5h10v10z" clipRule="evenodd" /></svg>
            </button>
            <button onClick={() => handleDeleteTask(task.id)} className="text-gray-400 hover:text-red-500 transition-colors" title="Delete task">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm6 0a1 1 0 11-2 0v6a1 1 0 112 0V8z" clipRule="evenodd" /></svg>
            </button>
          </div>
        </div>
      ));
  };

  return (
    <>
      <h2 className="text-2xl font-bold text-[#424A9F] mb-4">Task Board</h2>
      <form onSubmit={handleAddTask} className="flex gap-2 mb-6">
        <input
          type="text"
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          placeholder="Add a new task..."
          className="flex-grow p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]"
        />
        <button type="submit" className="bg-[#424A9F] text-white font-bold py-2 px-4 rounded-lg hover:bg-[#343D84] transition-colors duration-300">Add Task</button>
      </form>
      <div className="grid md:grid-cols-3 gap-6">
        <div onDrop={(e) => handleDrop(e, 'todo')} onDragOver={handleDragOver} className="bg-gray-100 p-4 rounded-xl shadow-inner flex flex-col w-full min-h-[300px] space-y-2">
          <h3 className="text-xl font-bold mb-4 text-center text-[#424A9F]">Needs to be Done ({tasks.filter(t => t.status === 'todo').length})</h3>
          {renderTasks('todo')}
        </div>
        <div onDrop={(e) => handleDrop(e, 'doing')} onDragOver={handleDragOver} className="bg-gray-100 p-4 rounded-xl shadow-inner flex flex-col w-full min-h-[300px] space-y-2">
          <h3 className="text-xl font-bold mb-4 text-center text-[#424A9F]">Doing ({tasks.filter(t => t.status === 'doing').length})</h3>
          {renderTasks('doing')}
        </div>
        <div onDrop={(e) => handleDrop(e, 'complete')} onDragOver={handleDragOver} className="bg-gray-100 p-4 rounded-xl shadow-inner flex flex-col w-full min-h-[300px] space-y-2">
          <h3 className="text-xl font-bold mb-4 text-center text-[#424A9F]">Complete ({tasks.filter(t => t.status === 'complete').length})</h3>
          {renderTasks('complete')}
        </div>
      </div>
      <div className="mt-6 p-4 bg-gray-50 rounded-xl shadow-inner flex flex-col gap-2">
        <h3 className="text-xl font-bold text-[#424A9F]">AI Summary & Cleanup</h3>
        <button onClick={handleGenerateSummary} className="w-full bg-[#A3E635] text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-[#8CD02F] transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed" disabled={isLoading}>{isLoading ? 'Generating...' : 'Generate Summary'}</button>
        <button onClick={handleCleanup} className="w-full bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors duration-300">Clean Up Completed Tasks</button>
      </div>
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-lg w-full">
            <h3 className="text-xl font-bold text-[#424A9F] mb-4">Edit Task Steps</h3>
            <textarea
              value={editingTask?.steps || ''}
              onChange={(e) => setEditingTask({ ...editingTask, steps: e.target.value })}
              className="w-full h-48 p-2 rounded-lg border-2 border-gray-300 bg-gray-50 text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-[#A3E635]"
              placeholder="Document the steps taken to complete this task..."
            ></textarea>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setIsModalOpen(false)} className="bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors duration-300">Cancel</button>
              <button onClick={handleSaveSteps} className="bg-[#A3E635] text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-[#8CD02F] transition-colors duration-300">Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TechIssuesPage({ userId, db, showMessage }) {
  const [issues, setIssues] = useState([]);
  const formRef = useRef(null);

  useEffect(() => {
    if (!db || !userId) return;
    const issuesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/issues`);
    const unsubscribe = onSnapshot(issuesCollectionRef, (snapshot) => {
      setIssues(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching issues: ", error);
      showMessage("Failed to load issues.");
    });
    return () => unsubscribe();
  }, [db, userId, showMessage]);

  const handleLogIssue = async (e) => {
    e.preventDefault();
    if (!db) return;
    const formData = Object.fromEntries(new FormData(e.target));
    try {
      const issuesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/issues`);
      await addDoc(issuesCollectionRef, { ...formData, timestamp: new Date() });
      e.target.reset();
      showMessage('Issue logged successfully!');
    } catch (error) {
      console.error('Error logging issue: ', error);
      showMessage('Failed to log issue.');
    }
  };

  const handlePingTeam = (issue) => {
    showMessage(`🚨 Urgent Alert: New tech issue logged by your team! Issue: "${issue.issueTitle}". Urgency: ${issue.urgency}. Contact: ${issue.contactPerson}. Please check the Tech Issues page for details.`);
  };

  const handleDeleteIssue = async (id) => {
    if (!db) return;
    try {
      const issueDocRef = doc(db, `artifacts/${appId}/users/${userId}/issues`, id);
      await deleteDoc(issueDocRef);
      showMessage("Issue deleted successfully!");
    } catch (error) {
      console.error("Error deleting issue: ", error);
      showMessage("Failed to delete issue.");
    }
  };

  const handleExportForServiceNow = (issue) => {
    const output = `Issue: ${issue.issueTitle}\n\nDescription:\n${issue.issueDescription}\n\nUrgency: ${issue.urgency}\n\nSteps Taken:\n${issue.stepsTaken}\n\nContact Person: ${issue.contactPerson}`;
    copyToClipboard(output);
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <h2 className="text-2xl font-bold text-[#424A9F] mb-4">Log a New Tech Issue</h2>
        <form onSubmit={handleLogIssue} ref={formRef} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Issue Title:</label><input type="text" name="issueTitle" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" required /></div>
          <div><label className="block text-sm font-medium mb-1">Issue Description:</label><textarea name="issueDescription" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-[#A3E635]" rows="4" required></textarea></div>
          <div><label className="block text-sm font-medium mb-1">Urgency:</label><select name="urgency" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]"><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></div>
          <div><label className="block text-sm font-medium mb-1">Steps Taken:</label><textarea name="stepsTaken" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-[#A3E635]" rows="2"></textarea></div>
          <div><label className="block text-sm font-medium mb-1">Contact Person:</label><input type="text" name="contactPerson" className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]" /></div>
          <button type="submit" className="w-full bg-[#424A9F] text-white font-bold py-2 px-4 rounded-lg hover:bg-[#343D84] transition-colors duration-300">Log Issue</button>
        </form>
      </div>
      <div>
        <h2 className="text-2xl font-bold text-[#424A9F] mb-4">Logged Tech Issues</h2>
        <div className="space-y-4">
          {issues.length > 0 ? (
            issues.map(issue => (
              <div key={issue.id} className="bg-gray-50 p-4 rounded-xl shadow-md flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-semibold mb-1">{issue.issueTitle}</h3>
                  <p className="text-sm"><strong>Urgency:</strong> {issue.urgency}</p>
                  <p className="text-sm"><strong>Contact:</strong> {issue.contactPerson}</p>
                  <p className="text-sm mt-2">{issue.issueDescription}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <button onClick={() => handlePingTeam(issue)} className="bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-red-600 transition-colors duration-300">Ping Team</button>
                  <button onClick={() => handleExportForServiceNow(issue)} className="bg-[#A3E635] text-gray-900 px-3 py-1 rounded-lg text-xs font-bold hover:bg-[#8CD02F] transition-colors duration-300">Export</button>
                  <button onClick={() => handleDeleteIssue(issue.id)} className="bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-red-600 transition-colors duration-300">Delete</button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-gray-500">No tech issues logged yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
