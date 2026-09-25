import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import NeuCard from '../components/ui/NeuCard';
import NeuInput from '../components/ui/NeuInput';
import NeuButton from '../components/ui/NeuButton';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <NeuCard className="w-full max-w-sm p-8">
        <h1 className="text-center text-xl font-semibold text-text-primary">Vortex Outreach</h1>
        <p className="mt-1 text-center text-sm text-text-secondary">Sign in to start dialing</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <NeuInput
            type="email"
            required
            autoFocus
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full"
          />
          <NeuInput
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full"
          />
          {error && <p className="text-sm text-action-hangup">{error}</p>}
          <NeuButton type="submit" disabled={submitting} className="w-full text-center">
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-text-secondary/30 border-t-text-primary"
                />
                Signing in…
              </span>
            ) : (
              'Sign in'
            )}
          </NeuButton>
        </form>
      </NeuCard>
    </div>
  );
}
