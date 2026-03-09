import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app.jsx';

// This is the entry point that connects your React code to the HTML page
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
