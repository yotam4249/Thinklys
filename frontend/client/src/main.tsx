import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadTokensFromStorage } from './services/api.ts';
import { Provider } from 'react-redux';
import { store } from './store/store.ts';

loadTokensFromStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
    <App />
    </Provider>
  </StrictMode>,
)
