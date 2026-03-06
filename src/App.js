import React, { useState } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import Signup from './components/Signup';
import FacultyDashboard from './components/FacultyDashboard';
import StudentDashboard from './components/StudentDashboard';

function AppContent() {
  const { currentUser, userRole } = useAuth();
  const [showSignup, setShowSignup] = useState(false);

  if (!currentUser) {
    return (
      <div>
        {showSignup ? (
          <div>
            <Signup onToggleToLogin={() => setShowSignup(false)} />
          </div>
        ) : (
          <div>
            <Login onToggleToSignup={() => setShowSignup(true)} />
          </div>
        )}
      </div>
    );
  }

  if (userRole === 'Faculty') {
    return <FacultyDashboard />;
  }

  if (userRole === 'Student') {
    return <StudentDashboard />;
  }

  return (
    <div className="container">
      <div className="text-center" style={{ marginTop: '100px' }}>
        <h2>Loading...</h2>
        <p>Please wait while we load your dashboard.</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}

export default App;
