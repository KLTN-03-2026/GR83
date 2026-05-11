import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import { AppProvider } from './context/AppContext';
import globalStyles from './styles.css?inline';

if (typeof document !== 'undefined' && !document.getElementById('smartride-global-styles')) {
  const globalStyleTag = document.createElement('style');
  globalStyleTag.id = 'smartride-global-styles';
  globalStyleTag.textContent = globalStyles;
  document.head.appendChild(globalStyleTag);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
