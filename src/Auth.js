import { useState } from 'react';
import supabase from './supabaseClient';

function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    setError('');
    setMessage('');
    
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else {
        setMessage('Check your email to confirm your account!');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      }
    }
  };

  return (
    <div className="auth-container">
      <h2>{isSignUp ? 'Create Account' : 'Sign In'}</h2>
      {error && <p className="auth-error">{error}</p>}
      {message && <p className="auth-message">{message}</p>}
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        className="auth-input"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        className="auth-input"
      />
      <button onClick={handleSubmit} className="auth-button">
        {isSignUp ? 'Sign Up' : 'Sign In'}
      </button>
      <p className="auth-switch" onClick={() => setIsSignUp(!isSignUp)}>
        {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
      </p>
    </div>
  );
}

export default Auth;