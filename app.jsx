import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Users, Briefcase, ChevronLeft, ChevronRight, Search, Zap, Trash2, BookOpen, ExternalLink, RefreshCw, XCircle } from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, addDoc, collection, onSnapshot, query, where, getDocs, writeBatch, deleteDoc, updateDoc, setDoc } from 'firebase/firestore';

// Import the functions you need from the SDKs you need
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCBuOzD3V96thT2TIiC3n8DdvpfChGYjEo",
  authDomain: "schedule-fef69.firebaseapp.com",
  projectId: "schedule-fef69",
  storageBucket: "schedule-fef69.firebasestorage.app",
  messagingSenderId: "565438351947",
  appId: "1:565438351947:web:b787c417351d16a19cdbce"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY"; // <- Replace with your Google AI Studio API Key


// --- INITIALIZE FIREBASE (Global Scope) ---
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);


// --- UTILITY FETCH FUNCTION (FOR GEMINI ONLY) ---
async function fetchGemini(prompt, isJson = false) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY") {
        return "AI Error: Gemini API Key is missing or invalid. Please update the app.jsx file.";
    }

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        // Use tools property for grounding, not available for 2.5-flash
        generationConfig: isJson ? {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    eventName: { type: "STRING" },
                    startDate: { type: "STRING" },
                    endDate: { type: "STRING" },
                    eventPoc: { type: "STRING" },
                    selectPoc: { type: "STRING" },
                    location: { type: "STRING" },
                    eventLocation: { type: "STRING" },
                    classification: { type: "STRING" },
                    sessionType: { type: "STRING" },
                    attendees: { type: "STRING" },
                    demo: { type: "STRING" },
                    selectResources: { type: "STRING" },
                },
            },
        } : {}
    };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        
        if (!response.ok || result.error) {
             throw new Error(result.error?.message || `HTTP ${response.status} failed.`);
        }

        const generatedText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (isJson) {
            return JSON.parse(generatedText || '{}');
        } else {
            return generatedText;
        }
    } catch (error) {
        console.error("Gemini API Error:", error);
        return `AI Error: ${error.message}`;
    }
}

// --- SHARED UTILITY COMPONENTS ---

const InputField = ({ name, label, type, value, onChange, required = false, rows = 1 }) => (
    <div>
        <label className="block text-sm font-medium mb-1 text-gray-700">{label}:</label>
        {rows > 1 ? (
             <textarea
                name={name}
                value={value}
                onChange={onChange}
                rows={rows}
                className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-[#A3E635]"
                required={required}
            />
        ) : (
            <input
                type={type}
                name={name}
                value={value}
                onChange={onChange}
                className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]"
                required={required}
            />
        )}
    </div>
);

const SelectField = ({ name, label, value, onChange, options }) => (
    <div>
        <label className="block text-sm font-medium mb-1 text-gray-700">{label}:</label>
        <select
            name={name}
            value={value}
            onChange={onChange}
            className="w-full p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]"
        >
            {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
    </div>
);

const CheckboxGroup = ({ name, label, options, selected, onChange }) => (
    <div>
        <label className="block text-sm font-medium mb-2 text-gray-700">{label}:</label>
        <div className="grid grid-cols-2 gap-2 bg-gray-100 p-3 rounded-lg">
            {options.map(option => (
                <label key={option} className="flex items-center space-x-2 text-sm text-gray-700">
                    <input
                        type="checkbox"
                        name={name}
                        value={option}
                        checked={selected.includes(option)}
                        onChange={onChange}
                        className="text-[#424A9F] focus:ring-[#A3E635]"
                    />
                    <span>{option}</span>
                </label>
            ))}
        </div>
    </div>
);

const EventListView = ({ events, handleDeleteEvent, handleExtractForServiceNow, searchQuery, setSearchQuery }) => {
    // Ensure filteredEvents logic is robust
    const filteredEvents = events.filter(event => 
        (event.eventName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (event.eventPOC || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (event.attendees || '').toLowerCase().includes(searchQuery.toLowerCase())
    ).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    return (
        <div className="space-y-4">
            <div className="flex items-center relative">
                <Search className="w-5 h-5 absolute left-3 text-gray-400" />
                <input
                    type="text"
                    placeholder="Search events by Name, POC, or Attendee..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full p-2 pl-10 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]"
                />
            </div>
            
            {filteredEvents.length > 0 ? (
                filteredEvents.map((event) => (
                    <div key={event.id} className="bg-white p-4 rounded-xl shadow-md flex justify-between items-start border-l-4 border-[#424A9F]">
                        <div>
                            <h3 className="text-lg font-semibold mb-1">{event.eventName}</h3>
                            <p className="text-sm"><strong>Date:</strong> {event.startDate} - {event.endDate}</p>
                            <p className="text-sm"><strong>Location:</strong> {event.eventLocation || event.location}</p>
                            <p className="text-sm"><strong>POC:</strong> {event.eventPOC}</p>
                            <p className="text-sm"><strong>Resources:</strong> {(event.demoResources || []).join(', ')}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={() => handleExtractForServiceNow(event)}
                                className="bg-[#A3E635] text-gray-900 px-3 py-1 rounded-lg text-xs font-bold hover:bg-[#8CD02F] transition-colors duration-300 flex items-center"
                            >
                                <ExternalLink className="w-3 h-3 mr-1" /> Export
                            </button>
                            <button
                                onClick={() => handleDeleteEvent(event.id)}
                                className="bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-red-600 transition-colors duration-300 flex items-center"
                            >
                                <Trash2 className="w-3 h-3 mr-1" /> Delete
                            </button>
                        </div>
                    </div>
                ))
            ) : (
                <p className="text-center text-gray-500 pt-8">No matching events found.</p>
            )}
        </div>
    );
};

const ServiceNowModal = ({ formattedOutput, copyToClipboard, setShowOutput }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-lg w-full">
            <h3 className="text-xl font-bold text-[#424A9F] mb-4">ServiceNow Data</h3>
            <p className="text-gray-600 text-sm mb-2">
                Copy the text below to paste into ServiceNow.
            </p>
            <textarea
                readOnly
                value={formattedOutput}
                className="w-full h-64 p-4 rounded-lg border-2 border-gray-300 bg-gray-50 text-gray-900 resize-none font-mono text-sm"
                onClick={(e) => e.target.select()}
            ></textarea>
            <div className="flex justify-end gap-2 mt-4">
                <button
                    onClick={copyToClipboard}
                    className="bg-[#A3E635] text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-[#8CD02F] transition-colors duration-300"
                >
                    Copy to Clipboard
                </button>
                <button
                    onClick={() => setShowOutput(false)}
                    className="bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors duration-300"
                >
                    Close
                </button>
            </div>
        </div>
    </div>
);

const CalendarView = ({ currentDate, setCurrentDate, events, handleDayClick, selectedDayEvents }) => {
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    const getDaysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const getStartDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

    const renderCalendarDays = () => {
        const days = [];
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDay = getStartDayOfMonth(currentDate);
        const daysInMonth = getDaysInMonth(currentDate);

        // Blank days at start of month
        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`empty-${i}`}></div>);
        }

        // Days of the month
        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = day === currentDay && month === currentMonth && year === currentYear;
            const dayDate = new Date(year, month, day);
            dayDate.setHours(0, 0, 0, 0);

            const isEventDay = events.some(event => {
                const eventStartDate = new Date(event.startDate);
                const eventEndDate = new Date(event.endDate);
                eventStartDate.setHours(0, 0, 0, 0);
                eventEndDate.setHours(0, 0, 0, 0);
                return dayDate >= eventStartDate && dayDate <= eventEndDate;
            });

            days.push(
                <div 
                    key={day}
                    onClick={() => handleDayClick(day)}
                    className={`p-2 rounded-lg cursor-pointer transition-all duration-200 border border-gray-200 shadow-sm ${
                        isToday ? 'bg-[#424A9F] text-white font-bold' : isEventDay ? 'bg-[#A3E635]/50 text-gray-900 hover:bg-[#A3E635]' : 'hover:bg-gray-200'
                    }`}
                >
                    {day}
                </div>
            );
        }
        return days;
    };

    return (
        <div className="bg-white p-4 rounded-xl shadow-md border border-gray-200">
            <div className="flex justify-between items-center mb-4">
                <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}
                    className="p-2 rounded-full hover:bg-gray-200 transition-colors">
                    <ChevronLeft className="h-6 w-6 text-gray-600" />
                </button>
                <h3 className="text-xl font-bold text-[#424A9F]">{monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}</h3>
                <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}
                    className="p-2 rounded-full hover:bg-gray-200 transition-colors">
                    <ChevronRight className="h-6 w-6 text-gray-600" />
                </button>
            </div>
            
            <div className="grid grid-cols-7 gap-1 text-center font-semibold text-sm mb-2">
                {daysOfWeek.map(day => <div key={day} className="text-gray-500 p-2">{day}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
                {renderCalendarDays()}
            </div>

            {selectedDayEvents.length > 0 && (
                <div className="mt-4 p-4 bg-white rounded-lg shadow-md border border-gray-200">
                    <h4 className="font-bold text-[#424A9F] mb-2">Events on Selected Day:</h4>
                    <ul className="list-disc list-inside space-y-1">
                        {selectedDayEvents.map(event => (
                            <li key={event.id} className="text-sm">
                                <span className="font-semibold">{event.eventName}</span> from {event.startDate} to {event.endDate}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};


// --- SCHEDULE PAGE COMPONENT ---
function SchedulePage({ showMessage }) {
    const [formData, setFormData] = useState({
        eventName: '', startDate: '', endDate: '', eventPoc: '', selectPoc: '', location: 'NYIH',
        eventLocation: '', classification: 'Unclassified', sessionType: 'Client Meeting', attendees: '', 
        demoResources: [], sessionDays: '', sessionSupportDuration: '',
    });
    const [pdfText, setPdfText] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [events, setEvents] = useState([]);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [summary, setSummary] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [view, setView] = useState('list'); 
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDayEvents, setSelectedDayEvents] = useState([]);
    const [showOutput, setShowOutput] = useState(false);
    const [formattedOutput, setFormattedOutput] = useState('');
    const resourceOptions = ["Surface Hubs", "Proto", "Spot", "Hypervsn", "GenAI", "Vestaboard", "Loaner Laptop", "Clicker", "Teams Call", "Vu AI", "Other"];

    // Function to fetch events (using GraphQL query)
    const fetchEvents = async () => {
        const query = `
            query {
                events {
                    id
                    eventName
                    startDate
                    endDate
                    eventPoc
                    selectPoc
                    location
                    eventLocation
                    classification
                    sessionType
                    attendees
                    demoResources
                }
            }
        `;
        try {
            const result = await robustFetch('/api/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query }),
            });
            setEvents(result?.data?.events ?? []);
            // showMessage('Events loaded successfully!');
        } catch (error) {
            console.error('Error fetching events:', error);
            showMessage('Failed to load events. Check API connection.');
        }
    };

    // Handle form input changes
    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        if (type === 'checkbox') {
            setFormData(prev => {
                const currentResources = prev.demoResources || [];
                if (checked) {
                    return { ...prev, demoResources: [...currentResources, value] };
                } else {
                    return { ...prev, demoResources: currentResources.filter(r => r !== value) };
                }
            });
        } else {
            setFormData((prev) => ({ ...prev, [name]: value }));
        }
    };

    // Add event using GraphQL Mutation
    const handleFormSubmit = async (e) => {
        e.preventDefault();
        
        const newId = crypto.randomUUID(); 

        // Sanitize string values for GraphQL interpolation
        const safeFormData = {};
        for (const [key, value] of Object.entries(formData)) {
            if (typeof value === 'string') {
                // Basic sanitization: escape quotes
                safeFormData[key] = value.replace(/"/g, '\\"');
            } else {
                safeFormData[key] = value;
            }
        }

        const mutation = `
            mutation {
                createEvent(
                    id: "${newId}"
                    eventName: "${safeFormData.eventName}"
                    startDate: "${safeFormData.startDate}"
                    endDate: "${safeFormData.endDate}"
                    eventPoc: "${safeFormData.eventPoc}"
                    selectPoc: "${safeFormData.selectPoc}"
                    location: "${safeFormData.location}"
                    eventLocation: "${safeFormData.eventLocation}"
                    classification: "${safeFormData.classification}"
                    sessionType: "${safeFormData.sessionType}"
                    attendees: "${safeFormData.attendees}"
                    demoResources: ["${safeFormData.demoResources.join('","')}"]
                ) {
                    id
                }
            }
        `;

        try {
            await robustFetch('/api/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: mutation }),
            });
            
            // Clear form and message on success
            setFormData(prev => ({ ...prev, eventName: '', startDate: '', endDate: '' }));
            showMessage('Event added successfully!');
            fetchEvents(); // Refresh list
        } catch (error) {
            console.error('GraphQL Mutation Error:', error);
            showMessage(`Failed to add event: ${error.message}`);
        }
    };

    // Handle AI analysis of pasted PDF text (FIXED: Defined function and uses GEMINI_API_KEY)
    const handleAnalyzePDF = async () => {
        const pdfText = document.getElementById('pdfText').value;
        if (!pdfText.trim()) return;
        setIsProcessing(true);

        const prompt = `
            You are an expert AI assistant that extracts structured data from event reports.
            Carefully extract the following information from the text provided below.
            Be precise. The data must be returned as a single JSON object.
            
            The following is the report text:
            ${pdfText}
        `;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        eventName: { type: "STRING" },
                        startDate: { type: "STRING" },
                        endDate: { type: "STRING" },
                        eventPoc: { type: "STRING" },
                        selectPoc: { type: "STRING" },
                        location: { type: "STRING" },
                        eventLocation: { type: "STRING" },
                        classification: { type: "STRING" },
                        sessionType: { type: "STRING" },
                        attendees: { type: "STRING" },
                        demo: { type: "STRING" },
                        selectResources: { type: "STRING" },
                        sessionDays: { type: "STRING" },
                        sessionSupportDuration: { type: "STRING" },
                    },
                },
            },
        };

        try {
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
            const result = await robustFetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const extractedData = result; // Response is already parsed JSON from robustFetch
            
            // Update the form state with the extracted data
            setFormData((prev) => ({
                ...prev,
                eventName: extractedData.eventName || prev.eventName,
                startDate: extractedData.startDate || prev.startDate,
                endDate: extractedData.endDate || prev.endDate,
                // Apply other extracted fields similarly...
            }));
            showMessage('Data extracted successfully! Review and save.');
        } catch (error) {
            console.error('AI call failed: ', error);
            showMessage(`Failed to extract data: ${error.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    // Generate a summary (FIXED: Defined function and uses GEMINI_API_KEY)
    const handleGenerateSummary = async () => {
        setIsSummarizing(true);
        setSummary('');

        const eventList = events.map(e => (
            `Event Name: ${e.eventName}, Date: ${e.startDate}, Location: ${e.eventLocation || e.location}, POC: ${e.eventPoc}`
        )).join('; ');

        const prompt = `
            Please provide a concise and professional summary of the team's upcoming events based on the following list. 
            Organize the summary by key details like event name, date, location, and POC. 
            Events:
            ${eventList || 'None'}
        `;

        const payload = { contents: [{ parts: [{ text: prompt }] }] };

        try {
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
            const result = await robustFetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const generatedText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (generatedText) {
                setSummary(generatedText);
                showMessage('Summary generated successfully!');
            } else {
                showMessage('Failed to generate summary. Please try again.');
            }
        } catch (error) {
            console.error('AI call failed: ', error);
            showMessage(`Failed to generate summary: ${error.message}`);
        } finally {
            setIsSummarizing(false);
        }
    };
    
    // Delete event using GraphQL Mutation (FIXED: Defined function)
    const handleDeleteEvent = async (id) => {
        const mutation = `
            mutation {
                deleteEvent(id: "${id}") {
                    id
                }
            }
        `;
        try {
            await robustFetch('/api/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: mutation }),
            });
            showMessage("Event deleted successfully!");
            fetchEvents();
        } catch (error) {
            console.error("GraphQL Delete Error:", error);
            showMessage(`Failed to delete event: ${error.message}`);
        }
    };

    // Clean up old events (FIXED: Defined function - needs GraphQL implementation for DELETE)
    const handleCleanupEvents = async () => {
        showMessage('Cleanup functionality is pending GraphQL mutation implementation.');
    };

    useEffect(() => {
        fetchEvents();
        const intervalId = setInterval(fetchEvents, 30000);
        return () => clearInterval(intervalId);
    }, []);
    
    // NEW FUNCTION: Extract for ServiceNow (Defined here, needed for the button in EventListView)
    const handleExtractForServiceNow = (event) => {
        const output = `Event Name: ${event.eventName || ''}
Start Date: ${event.startDate || ''}
End Date: ${event.endDate || ''}
Event POC: ${event.eventPoc || ''}
Location: ${event.eventLocation || event.location || ''}
Classification: ${event.classification || ''}
Session Type: ${event.sessionType || ''}
Attendees: ${event.attendees || ''}
Resources: ${(event.demoResources || []).join(', ')}`;

        setFormattedOutput(output);
        setShowOutput(true);
    };

    const filteredEvents = events.filter(event => 
        (event.eventName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (event.eventPoc || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (event.attendees || '').toLowerCase().includes(searchQuery.toLowerCase())
    ).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    
    // UI for the Schedule Page
    return (
        <div className="bg-white p-6 rounded-2xl shadow-xl grid md:grid-cols-2 gap-8 relative">
            
            {/* Event Form (Left Side) */}
            <div className="space-y-4">
                <h2 className="text-2xl font-bold text-[#424A9F]">Add Event & AI Extraction</h2>

                {/* AI PDF Extraction */}
                <div className="p-4 bg-gray-50 rounded-xl shadow-inner border border-gray-200">
                    <label className="block text-sm font-medium mb-1 text-gray-700">
                        Paste Report Text for AI Extraction:
                    </label>
                    <textarea
                        id="pdfText"
                        className="w-full h-32 p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-[#A3E635]"
                        value={pdfText}
                        onChange={(e) => setPdfText(e.target.value)}
                        placeholder="Paste your PDF report text here..."
                    ></textarea>
                    <button
                        onClick={handleAnalyzePDF}
                        disabled={isProcessing || !pdfText.trim()}
                        className="mt-2 w-full bg-[#A3E635] text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-[#8CD02F] transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {isProcessing ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : <Zap className="w-5 h-5 mr-2" />}
                        {isProcessing ? 'Extracting...' : 'Extract Data with AI'}
                    </button>
                </div>
                
                {/* Manual/Extracted Form */}
                <form onSubmit={handleFormSubmit} className="space-y-4 p-4 border border-gray-200 rounded-xl">
                    <div className="grid grid-cols-2 gap-4">
                        <InputField name="eventName" label="Event Name" type="text" value={formData.eventName} onChange={handleInputChange} required />
                        <InputField name="eventPoc" label="Event POC" type="text" value={formData.eventPoc} onChange={handleInputChange} required />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <InputField name="startDate" label="Start Date" type="date" value={formData.startDate} onChange={handleInputChange} required />
                        <InputField name="endDate" label="End Date" type="date" value={formData.endDate} onChange={handleInputChange} required />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <SelectField name="sessionType" label="Session Type" value={formData.sessionType} onChange={handleInputChange} options={["Client Meeting", "Internal Meeting", "Tech Innovation Meeting", "Demo", "CIC Meeting"]} />
                        <SelectField name="classification" label="Classification" value={formData.classification} onChange={handleInputChange} options={["Unclassified", "Confidential", "Secret"]} />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <InputField name="location" label="Location (e.g., NYIH)" type="text" value={formData.location} onChange={handleInputChange} />
                        <InputField name="eventLocation" label="Room/Event Location" type="text" value={formData.eventLocation} onChange={handleInputChange} />
                    </div>

                    <InputField name="attendees" label="Attendees (comma-separated)" type="text" value={formData.attendees} onChange={handleInputChange} />

                    <CheckboxGroup name="demoResources" label="Demo Resources" options={resourceOptions} selected={formData.demoResources} onChange={handleInputChange} />

                    <button
                        type="submit"
                        className="w-full bg-[#424A9F] text-white font-bold py-3 rounded-lg hover:bg-[#343D84] transition-colors duration-300"
                    >
                        <Calendar className="w-5 h-5 inline mr-2" /> Add Event to Schedule
                    </button>
                </form>
            </div>
            
            {/* Events List & Calendar (Right Side) */}
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-[#424A9F]">Upcoming Events ({events.length})</h2>
                    <button
                        onClick={fetchEvents}
                        className="text-gray-500 hover:text-[#424A9F] transition-colors duration-200"
                        title="Refresh Events"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>
                </div>
                

                <div className="flex justify-between items-center border-b pb-3">
                    <div className="flex gap-2">
                        <button
                            onClick={() => setView('list')}
                            className={`px-4 py-2 rounded-lg transition-colors duration-300 font-bold text-sm ${view === 'list' ? 'bg-[#424A9F] text-white' : 'bg-gray-200 text-gray-700'}`}
                        >
                            List
                        </button>
                        <button
                            onClick={() => setView('calendar')}
                            className={`px-4 py-2 rounded-lg transition-colors duration-300 font-bold text-sm ${view === 'calendar' ? 'bg-[#424A9F] text-white' : 'bg-gray-200 text-gray-700'}`}
                        >
                            Calendar
                        </button>
                    </div>
                    <button
                        onClick={handleGenerateSummary}
                        disabled={isSummarizing || events.length === 0}
                        className="bg-[#A3E635] text-gray-900 font-bold py-2 px-3 rounded-lg hover:bg-[#8CD02F] transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center text-sm"
                    >
                        <Zap className="w-4 h-4 mr-1" />
                        {isSummarizing ? 'Generating...' : 'AI Summary'}
                    </button>
                </div>

                {summary && (
                    <div className="bg-gray-100 p-4 rounded-lg shadow-inner whitespace-pre-wrap">
                        <h4 className="font-bold text-[#424A9F] mb-2">Summary:</h4>
                        <p className="font-mono text-sm">{summary}</p>
                    </div>
                )}
                
                {view === 'list' ? (
                    <EventListView 
                        events={filteredEvents} 
                        handleDeleteEvent={handleDeleteEvent} 
                        handleExtractForServiceNow={handleExtractForServiceNow} 
                        searchQuery={searchQuery} 
                        setSearchQuery={setSearchQuery} 
                    />
                ) : (
                    <CalendarView 
                        currentDate={currentDate} 
                        setCurrentDate={setCurrentDate} 
                        events={events}
                        handleDayClick={handleDayClick}
                        selectedDayEvents={selectedDayEvents}
                    />
                )}
            </div>
            
            {/* ServiceNow Output Modal */}
            {showOutput && (
                <ServiceNowModal formattedOutput={formattedOutput} copyToClipboard={copyToClipboard} setShowOutput={setShowOutput} />
            )}
        </div>
    );
}

// --- KANBAN PAGE COMPONENT ---
function KanbanPage({ showMessage }) {
    const [tasks, setTasks] = useState([]);
    const [newTaskText, setNewTaskText] = useState('');
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [summary, setSummary] = useState('');
    const [editingTaskId, setEditingTaskId] = useState(null);
    const [editedTaskText, setEditedTaskText] = useState('');
    const [editedTaskSteps, setEditedTaskSteps] = useState('');

    // Fetch tasks
    const fetchTasks = async () => {
        const query = `query { projects { id title status description assignee } }`;
        try {
            const result = await robustFetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
            setTasks(result?.data?.projects ?? []);
        } catch (error) {
            console.error('Error fetching tasks:', error);
            showMessage('Failed to load tasks.');
        }
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    // Add task
    const handleAddTask = async (e) => {
        e.preventDefault();
        if (!newTaskText.trim()) return;
        const newId = crypto.randomUUID();
        // Sanitize text for GraphQL
        const safeTitle = newTaskText.replace(/"/g, '\\"');
        const mutation = `mutation { createProject(id: "${newId}", title: "${safeTitle}", status: "todo") { id } }`;

        try {
            await robustFetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: mutation }) });
            setNewTaskText('');
            showMessage('Task added successfully!');
            fetchTasks();
        } catch (error) {
            showMessage(`Failed to add task: ${error.message}`);
        }
    };

    // Move task status
    const handleMoveTask = async (id, newStatus) => {
        const mutation = `mutation { updateProject(id: "${id}", status: "${newStatus}") { id } }`;
        try {
            await robustFetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: mutation }) });
            fetchTasks();
        } catch (error) {
            showMessage(`Failed to move task: ${error.message}`);
        }
    };
    
    // Delete task
    const handleDeleteTask = async (id) => {
        const mutation = `mutation { deleteProject(id: "${id}") { id } }`;
        try {
            await robustFetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: mutation }) });
            showMessage('Task deleted.');
            fetchTasks();
        } catch (error) {
            showMessage(`Failed to delete task: ${error.message}`);
        }
    };

    // Save edited task details (Steps)
    const handleSaveTaskDetails = async () => {
        if (!editingTaskId) return;
        const safeSteps = editedTaskSteps.replace(/"/g, '\\"');
        const mutation = `mutation { updateProject(id: "${editingTaskId}", description: "${editedTaskText.replace(/"/g, '\\"')}", steps: "${safeSteps}") { id } }`;

        try {
            await robustFetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: mutation }) });
            setEditingTaskId(null);
            showMessage('Task details updated!');
            fetchTasks();
        } catch (error) {
            showMessage(`Failed to save details: ${error.message}`);
        }
    };

    // Generate summary
    const handleGenerateProjectSummary = async () => {
        setIsSummarizing(true);
        setSummary('');
        
        const todoTasks = tasks.filter(t => t.status === 'todo').map(t => t.title).join(', ');
        const doingTasks = tasks.filter(t => t.status === 'doing').map(t => t.title).join(', ');
        const completeTasks = tasks.filter(t => t.status === 'complete').map(t => t.title).join(', ');

        const prompt = `Provide a professional summary of the team's project progress. Tasks: To Do: ${todoTasks}; Doing: ${doingTasks}; Completed: ${completeTasks}.`;
        const payload = { contents: [{ parts: [{ text: prompt }] }] };

        try {
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
            const result = await robustFetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const generatedText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (generatedText) {
                setSummary(generatedText);
            }
        } catch (error) {
            showMessage(`AI Summary failed: ${error.message}`);
        } finally {
            setIsSummarizing(false);
        }
    };

    const KanbanColumn = ({ status, title }) => {
        const columnTasks = tasks.filter(t => t.status === status);
        
        const handleDrop = (e) => {
            e.preventDefault();
            const taskId = e.dataTransfer.getData("taskId");
            handleMoveTask(taskId, status);
        };

        const handleDragOver = (e) => { e.preventDefault(); };
        const handleDragStart = (e, taskId) => { e.dataTransfer.setData("taskId", taskId); };

        return (
            <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className="bg-gray-100 p-4 rounded-xl shadow-inner flex flex-col w-full min-h-[300px]"
            >
                <h3 className="text-xl font-bold mb-4 text-center text-[#424A9F]">{title} ({columnTasks.length})</h3>
                <div className="flex-grow space-y-3">
                    {columnTasks.map(task => (
                        <div
                            key={task.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, task.id)}
                            className="bg-white p-3 rounded-xl shadow-md cursor-grab active:cursor-grabbing transform hover:scale-105 transition-transform duration-200 flex justify-between items-center border-l-4 border-purple-500"
                        >
                            <p className="text-gray-900">{task.title}</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        setEditingTaskId(task.id);
                                        setEditedTaskText(task.title);
                                        setEditedTaskSteps(task.description); // Use description field for steps placeholder
                                    }}
                                    className="text-gray-400 hover:text-blue-500 transition-colors"
                                    title="Edit steps"
                                >
                                    <BookOpen className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => handleDeleteTask(task.id)}
                                    className="text-gray-400 hover:text-red-500 transition-colors"
                                    title="Delete task"
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-xl">
            <h2 className="text-2xl font-bold text-[#424A9F] mb-4">Project Task Board</h2>
            
            <form onSubmit={handleAddTask} className="flex gap-2 mb-6">
                <input
                    type="text"
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    placeholder="Add a new task title..."
                    className="flex-grow p-2 rounded-lg border-2 border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#A3E635]"
                />
                <button
                    type="submit"
                    className="bg-[#424A9F] text-white font-bold py-2 px-4 rounded-lg hover:bg-[#343D84] transition-colors duration-300"
                >
                    Add Task
                </button>
            </form>

            {/* Kanban Board Columns */}
            <div className="grid md:grid-cols-3 gap-6">
                <KanbanColumn status="todo" title="To Do" />
                <KanbanColumn status="doing" title="In Progress" />
                <KanbanColumn status="complete" title="Done" />
            </div>
            
            <div className="mt-6 p-4 bg-gray-50 rounded-xl shadow-inner flex flex-col gap-2">
                <h3 className="text-xl font-bold text-[#424A9F]">AI Summary & Cleanup</h3>
                <button
                    onClick={handleGenerateProjectSummary}
                    disabled={isSummarizing || tasks.length === 0}
                    className="w-full bg-[#A3E635] text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-[#8CD02F] transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                    <Zap className="w-4 h-4 mr-1" />
                    {isSummarizing ? 'Generating...' : 'AI Project Summary'}
                </button>
                {summary && <div className="bg-white p-4 mt-2 rounded-lg shadow-md whitespace-pre-wrap">{summary}</div>}
            </div>

            {/* Task Edit Modal */}
            {editingTaskId && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-lg w-full">
                        <h3 className="text-xl font-bold text-[#424A9F] mb-4">Edit Task: {editedTaskText}</h3>
                        <InputField 
                            name="steps" 
                            label="Task Steps / Notes" 
                            type="textarea" 
                            value={editedTaskSteps} 
                            onChange={(e) => setEditedTaskSteps(e.target.value)} 
                            rows={5}
                        />
                        <div className="flex justify-end gap-2 mt-4">
                            <button
                                type="button"
                                onClick={() => setEditingTaskId(null)}
                                className="bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors duration-300"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveTaskDetails}
                                className="bg-[#A3E635] text-gray-900 font-bold py-2 px-4 rounded-lg hover:bg-[#8CD02F] transition-colors duration-300"
                            >
                                Save Details
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// --- TECH ISSUES PAGE COMPONENT ---
function TechIssuesPage({ showMessage }) {
    const [issues, setIssues] = useState([]);
    const [newIssue, setNewIssue] = useState({ issueTitle: '', issueDescription: '', urgency: 'Medium', stepsTaken: '', contactPerson: '' });

    // Fetch issues
    const fetchIssues = async () => {
        const query = `query { issues { id issueTitle issueDescription urgency stepsTaken contactPerson } }`;
        try {
            const result = await robustFetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
            setIssues(result?.data?.issues ?? []);
        } catch (error) {
            showMessage('Failed to load issues.');
        }
    };

    useEffect(() => {
        fetchIssues();
    }, []);

    const handleIssueChange = (e) => {
        setNewIssue(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleAddIssue = async (e) => {
        e.preventDefault();
        if (!newIssue.issueTitle || !newIssue.issueDescription) return;
        const newId = crypto.randomUUID();
        
        const mutation = `
            mutation {
                createIssue(
                    id: "${newId}"
                    issueTitle: "${newIssue.issueTitle.replace(/"/g, '\\"')}"
                    issueDescription: "${newIssue.issueDescription.replace(/"/g, '\\"')}"
                    urgency: "${newIssue.urgency}"
                    stepsTaken: "${newIssue.stepsTaken.replace(/"/g, '\\"')}"
                    contactPerson: "${newIssue.contactPerson.replace(/"/g, '\\"')}"
                ) {
                    id
                }
            }
        `;

        try {
            await robustFetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: mutation }) });
            setNewIssue({ issueTitle: '', issueDescription: '', urgency: 'Medium', stepsTaken: '', contactPerson: '' });
            showMessage('Issue logged successfully!');
            fetchIssues();
        } catch (error) {
            showMessage(`Failed to log issue: ${error.message}`);
        }
    };
    
    const handleDeleteIssue = async (id) => {
        const mutation = `mutation { deleteIssue(id: "${id}") { id } }`;
        try {
            await robustFetch('/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: mutation }) });
            showMessage('Issue deleted.');
            fetchIssues();
        } catch (error) {
            showMessage(`Failed to delete issue: ${error.message}`);
        }
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-xl grid md:grid-cols-2 gap-6">
            <div>
                <h2 className="text-2xl font-bold text-red-600 mb-4 flex items-center">
                    <XCircle className="w-6 h-6 mr-2" /> Log New Tech Issue
                </h2>
                <form onSubmit={handleAddIssue} className="space-y-4">
                    <InputField name="issueTitle" label="Issue Title" type="text" value={newIssue.issueTitle} onChange={handleIssueChange} required />
                    <InputField name="issueDescription" label="Description" type="textarea" value={newIssue.issueDescription} onChange={handleIssueChange} rows={3} required />
                    <InputField name="stepsTaken" label="Steps Taken" type="textarea" value={newIssue.stepsTaken} onChange={handleIssueChange} rows={2} />
                    <InputField name="contactPerson" label="Contact Person" type="text" value={newIssue.contactPerson} onChange={handleIssueChange} />
                    <SelectField name="urgency" label="Urgency Level" value={newIssue.urgency} onChange={handleIssueChange} options={["Low", "Medium", "High", "Urgent"]} />
                    <button type="submit" className="w-full bg-red-600 text-white font-bold py-2 rounded-lg hover:bg-red-700 transition-colors">Log Issue</button>
                </form>
            </div>
            
            <div>
                <h2 className="text-2xl font-bold text-red-600 mb-4">Active Issues ({issues.length})</h2>
                <div className="space-y-3">
                    {issues.map(issue => (
                        <div key={issue.id} className={`bg-gray-50 p-4 rounded-xl shadow-md border-l-4 ${issue.urgency === 'Urgent' ? 'border-red-600' : 'border-yellow-500'}`}>
                            <h3 className="font-semibold">{issue.issueTitle}</h3>
                            <p className="text-sm text-gray-600">{issue.issueDescription}</p>
                            <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200">
                                <span className="text-xs font-medium bg-gray-200 px-2 py-1 rounded">{issue.urgency}</span>
                                <button onClick={() => handleDeleteIssue(issue.id)} className="text-red-500 hover:text-red-700">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// --- MAIN APP COMPONENT ---
export default function App() {
    const [currentPage, setCurrentPage] = useState('schedule');
    const [message, setMessage] = useState(null); 

    const showMessage = (msg) => {
        setMessage(msg);
        setTimeout(() => setMessage(null), 5000);
    };

    const renderPage = () => {
        const props = { showMessage };
        switch (currentPage) {
            case 'schedule':
                return <SchedulePage {...props} />;
            case 'kanban':
                return <KanbanPage {...props} />;
            case 'issues':
                return <TechIssuesPage {...props} />;
            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen p-4 bg-gray-50 text-gray-800 flex flex-col items-center font-sans">
            {/* Header and navigation */}
            <div className="w-full max-w-5xl bg-white p-6 rounded-2xl shadow-xl mb-6">
                <h1 className="text-4xl font-extrabold text-[#424A9F] mb-2">
                    Accenture Project Hub
                </h1>
                <p className="text-center text-gray-600 mb-4">
                    Welcome to your team's central command center.
                </p>
                <div className="flex justify-center mb-4 space-x-2">
                    <NavButton title="Meetings & Events" pageName="schedule" currentPage={currentPage} setCurrentPage={setCurrentPage} />
                    <NavButton title="Task Board" pageName="kanban" currentPage={currentPage} setCurrentPage={setCurrentPage} />
                    <NavButton title="Tech Issues" pageName="issues" currentPage={currentPage} setCurrentPage={setCurrentPage} />
                </div>
            </div>

            {/* Message Area */}
            {message && (
                <div className="w-full max-w-5xl bg-blue-100 border-l-4 border-[#A3E635] text-blue-700 p-4 mb-4 rounded-lg shadow-md" role="alert">
                    <p>{message}</p>
                </div>
            )}

            {/* Conditional rendering of pages */}
            <div className="w-full max-w-5xl flex-grow">
                {renderPage()}
            </div>
        </div>
    );
}

const NavButton = ({ title, pageName, currentPage, setCurrentPage }) => (
    <button
        onClick={() => setCurrentPage(pageName)}
        className={`px-4 py-2 rounded-lg transition-all duration-300 font-semibold ${
            currentPage === pageName
                ? 'bg-[#A3E635] text-gray-900 shadow-lg'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
        }`}
    >
        {title}
    </button>
);
