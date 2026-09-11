import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

// ลงทะเบียน Service Worker เพื่อเปิดการทำงานเป็น Progressive Web App (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL || '/'}sw.js`
    navigator.serviceWorker.register(swUrl, { scope: import.meta.env.BASE_URL || '/' })
      .then((reg) => console.log('PWA Service Worker registered:', reg.scope))
      .catch((err) => console.error('PWA Service Worker registration failed:', err));
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
