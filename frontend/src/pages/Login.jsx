import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Panel from '../components/ui/Panel';
import Field from '../components/ui/Field';
import Button from '../components/ui/Button';
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Panel className="w-full max-w-sm p-8">
        <h1 className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tracking-[-0.01em] text-foreground">VORTEX ONE</span>
          <span className="font-mono text-xs font-medium uppercase tracking-label text-muted-foreground">Outreach</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Log in to start dialing.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label htmlFor="login-email" className="label -mb-2 block">
            Email
          </label>
          <Field
            id="login-email"
            type="email"
            required
            autoFocus
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? 'true' : undefined}
            className={`w-full ${error ? 'border-2 border-primary' : ''}`}
          />
          <label htmlFor="login-password" className="label -mb-2 block">
            Password
          </label>
          <Field
            id="login-password"
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? 'true' : undefined}
            className={`w-full ${error ? 'border-2 border-primary' : ''}`}
          />
          {error && (
            <p role="alert" className="text-sm text-signal">
              <span className="label mr-2 text-signal">Error</span>
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={submitting} className="w-full">
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
                />
                Logging in…
              </span>
            ) : (
              'Log in →'
            )}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
