import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ReplayPage } from './ReplayPage';
import { parseRoute } from './lib/route';
import './styles.css';

const route = parseRoute();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {route.name === 'replay' ? <ReplayPage matchRef={route.id} /> : <App />}
  </React.StrictMode>,
);
