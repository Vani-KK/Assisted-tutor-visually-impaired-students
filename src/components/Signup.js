import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Threads from './background';

function Signup({ onToggleToLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('Student');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();

    if (password !== confirmPassword) {
      return setError('Passwords do not match');
    }

    try {
      setError('');
      setLoading(true);
      await signup(email, password, role);
    } catch (error) {
      setError('Failed to create an account');
      console.error(error);
    }

    setLoading(false);
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
        {/* Left Panel - Signup Form */}
        <div className="login-form-panel">
          <div className="brand-logo">
            <div>
              <span className="brand-name">Assisted Tutor for Visually Impaired</span>
            </div>
          </div>

          <h1 className="login-title">Create Account</h1>
          <p className="login-subtitle">
            Join our platform by creating your account. Fill in the information below to get started.
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
            <input
              type="password"
              className="modern-input"
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <select
              className="modern-input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
              style={{ cursor: 'pointer' }}
            >
              <option value="Student">Student</option>
              <option value="Faculty">Faculty</option>
            </select>

            <button
              disabled={loading}
              className="modern-button"
              type="submit"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>
              Already have an account?{' '}
              <a 
                href="#" 
                onClick={(e) => {
                  e.preventDefault();
                  if (onToggleToLogin) {
                    onToggleToLogin();
                  }
                }}
                style={{
                  color: '#22c55e',
                  textDecoration: 'underline',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Login in here
              </a>
            </p>
          </div>

        </div>

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

export default Signup;
