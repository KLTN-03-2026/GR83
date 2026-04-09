import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import { AppProvider } from './context/AppContext';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
