import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

// DEV: 暴露 interactionLog 到全局，方便调试
if (process.env.NODE_ENV === 'development') {
  import('./interaction').then(({ interactionLog }) => {
    (window as any).interactionLog = interactionLog;
    console.log('[DEV] interactionLog exposed to window.interactionLog');
  });
}

const rootElement = document.getElementById('root');

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} else {
  console.error('Root element #root not found');
}

