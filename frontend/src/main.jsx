import { StrictMode } from 'react'
import { createRoot }  from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider }  from '@/contexts/AuthContext'
import App from './App'
import './index.css'

// Aplica tema salvo ou preferência do sistema
const saved = sessionStorage.getItem('bia-theme')
const dark  = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
