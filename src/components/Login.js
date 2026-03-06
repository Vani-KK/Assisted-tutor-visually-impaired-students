import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Threads from './background';

function Login({ onToggleToSignup }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const { login, resetPassword } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      setError('');
      setLoading(true);
      await login(email, password);
    } catch (error) {
      setError('Failed to log in');
      console.error(error);
    }

    setLoading(false);
  }

  async function handlePasswordReset(e) {
    e.preventDefault();
    
    if (!resetEmail || resetEmail.trim() === '') {
      setResetMessage('Please enter your email address.');
      setResetSuccess(false);
      return;
    }

    try {
      setResetMessage('');
      setResetSuccess(false);
      await resetPassword(resetEmail);
      setResetSuccess(true);
      setResetMessage('Password reset email sent! Check your inbox.');
    } catch (error) {
      setResetSuccess(false);
      if (error.code === 'auth/user-not-found') {
        setResetMessage('No account found with this email address.');
      } else if (error.code === 'auth/invalid-email') {
        setResetMessage('Invalid email address.');
      } else {
        setResetMessage('Failed to send reset email. Please try again.');
      }
      console.error(error);
    }
  }

  return (
    <div className="login-container">
      <div className="animated-background">
        <Threads 
          color={[0.2, 0.8, 0.4]} 
          amplitude={0.5} 
          distance={0.3} 
          enableMouseInteraction={true}
        />
      </div>
      <div className="login-panels content-above-background">
        {/* Left Panel - Login Form */}
        <div className="login-form-panel">
          <div className="brand-logo">
            <div>
              <span className="brand-name">Assisted Tutor for Visually Impaired</span>
            </div>
          </div>

          <h1 className="login-title">Hello!</h1>
          <p className="login-subtitle">
            To log in to your account, please enter your email address and password.
          </p>

          {error && (
            <div style={{ 
              backgroundColor: '#fed7d7', 
              color: '#c53030', 
              padding: '12px', 
              borderRadius: '12px', 
              marginBottom: '20px',
              fontSize: '14px'
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <input
              type="email"
              className="modern-input"
              placeholder="Your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              className="modern-input"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            
            <a 
              href="#" 
              className="forgot-password"
              onClick={(e) => {
                e.preventDefault();
                setShowForgotPassword(true);
                setResetMessage('');
                setResetEmail('');
                setResetSuccess(false);
              }}
            >
              Forgot password?
            </a>

            <button
              disabled={loading}
              className="modern-button"
              type="submit"
            >
              {loading ? 'Signing in...' : 'Next Step'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>
              Don't have an account?{' '}
              <a 
                href="#" 
                onClick={(e) => {
                  e.preventDefault();
                  if (onToggleToSignup) {
                    onToggleToSignup();
                  }
                }}
                style={{
                  color: '#22c55e',
                  textDecoration: 'underline',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Sign up here
              </a>
            </p>
          </div>

        </div>

        {/* Forgot Password Modal */}
        {showForgotPassword && (
          <div 
            className="modal-overlay"
            onClick={() => {
              setShowForgotPassword(false);
              setResetMessage('');
              setResetSuccess(false);
            }}
          >
            <div 
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
              style={{ padding: '32px' }}
            >
              <h2 style={{ 
                fontSize: '24px', 
                fontWeight: '600', 
                marginBottom: '12px',
                color: '#1a202c'
              }}>
                Reset Password
              </h2>
              <p style={{ 
                color: '#6b7280', 
                fontSize: '14px', 
                marginBottom: '24px'
              }}>
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <form onSubmit={handlePasswordReset}>
                <input
                  type="email"
                  className="modern-input"
                  placeholder="Your email address"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  style={{ marginBottom: '16px' }}
                />

                {resetMessage && (
                  <div style={{ 
                    backgroundColor: resetSuccess ? '#d1fae5' : '#fed7d7', 
                    color: resetSuccess ? '#065f46' : '#c53030', 
                    padding: '12px', 
                    borderRadius: '12px', 
                    marginBottom: '16px',
                    fontSize: '14px'
                  }}>
                    {resetMessage}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="submit"
                    className="modern-button"
                    style={{ flex: 1 }}
                  >
                    Send Reset Email
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setResetMessage('');
                      setResetSuccess(false);
                    }}
                    style={{
                      flex: 1,
                      padding: '14px 24px',
                      borderRadius: '12px',
                      border: '2px solid #e5e7eb',
                      background: 'white',
                      color: '#6b7280',
                      fontSize: '16px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseOver={(e) => {
                      e.target.style.backgroundColor = '#f9fafb';
                      e.target.style.borderColor = '#d1d5db';
                    }}
                    onMouseOut={(e) => {
                      e.target.style.backgroundColor = 'white';
                      e.target.style.borderColor = '#e5e7eb';
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Right Panel - Image */}
        <div className="login-image-panel">
          <img 
            src="/blind.jpg" 
            alt="Assisted Tutor for Visually Impaired" 
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: '75% center',
              borderTopLeftRadius: '0px',
              borderTopRightRadius: '20px',
              borderBottomLeftRadius: '0px',
              borderBottomRightRadius: '20px'
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default Login;
