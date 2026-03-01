"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" } | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setMessage({ text: error.message, type: "error" });
      } else {
        // Show check-your-email message instead of switching to sign in
        setMessage({
          text: "✉ Check your email for a confirmation link. Once confirmed, come back and sign in.",
          type: "success",
        });
        setPassword("");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Friendly message for unconfirmed email
        if (error.message.toLowerCase().includes("email not confirmed")) {
          setMessage({ text: "Please confirm your email before signing in. Check your inbox for the confirmation link.", type: "error" });
        } else {
          setMessage({ text: error.message, type: "error" });
        }
      } else {
        router.push("/");
        router.refresh();
      }
    }
    setLoading(false);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) {
      setMessage({ text: error.message, type: "error" });
    } else {
      setMessage({ text: "✉ Password reset link sent! Check your email.", type: "success" });
    }
    setLoading(false);
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setMessage({ text: error.message, type: "error" }); setGoogleLoading(false); }
  }

  function switchMode(next: "signin" | "signup" | "forgot") {
    setMode(next);
    setMessage(null);
    setPassword("");
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080808; color: #e8e8e8; font-family: 'Georgia', serif; min-height: 100vh; }
        .auth-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: radial-gradient(ellipse 80% 80% at 50% 0%, #1a0d2e33, transparent), #080808; }
        .auth-box { width: 100%; max-width: 420px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 40px; }
        .auth-logo { display: flex; align-items: center; gap: 8px; text-decoration: none; color: #fff; font-size: 20px; font-weight: 700; letter-spacing: 0.3em; justify-content: center; margin-bottom: 32px; }
        .auth-logo-icon { color: #c8a96e; font-size: 24px; }
        .auth-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; text-align: center; margin-bottom: 6px; }
        .auth-subtitle { font-size: 13px; color: rgba(255,255,255,0.35); text-align: center; letter-spacing: 0.05em; margin-bottom: 32px; }
        .google-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 12px; background: #fff; color: #1a1a1a; border: none; border-radius: 8px; padding: 13px 20px; font-size: 14px; font-family: 'Georgia', serif; font-weight: 700; cursor: pointer; transition: all 0.2s; margin-bottom: 24px; }
        .google-btn:hover { background: #f0f0f0; transform: translateY(-1px); }
        .google-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .google-icon { width: 20px; height: 20px; flex-shrink: 0; }
        .auth-divider { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
        .auth-divider-line { flex: 1; height: 1px; background: rgba(255,255,255,0.08); }
        .auth-divider-text { font-size: 11px; color: rgba(255,255,255,0.25); letter-spacing: 0.15em; text-transform: uppercase; }
        .auth-form { display: flex; flex-direction: column; gap: 16px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-label { font-size: 11px; letter-spacing: 0.15em; color: rgba(255,255,255,0.4); text-transform: uppercase; }
        .form-input { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px 16px; color: #fff; font-size: 14px; font-family: 'Georgia', serif; outline: none; transition: border-color 0.2s; width: 100%; }
        .form-input:focus { border-color: rgba(200,169,110,0.5); }
        .form-input::placeholder { color: rgba(255,255,255,0.2); }
        .auth-submit { width: 100%; background: #c8a96e; color: #080808; border: none; border-radius: 8px; padding: 13px 20px; font-size: 13px; font-family: 'Georgia', serif; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; margin-top: 4px; }
        .auth-submit:hover { background: #dfc07e; transform: translateY(-1px); }
        .auth-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .auth-message { border-radius: 8px; padding: 12px 16px; font-size: 13px; line-height: 1.5; margin-bottom: 16px; }
        .auth-message.error { background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.2); color: #f87171; }
        .auth-message.success { background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.2); color: #4ade80; }
        .auth-toggle { text-align: center; margin-top: 24px; font-size: 13px; color: rgba(255,255,255,0.35); }
        .auth-toggle button { background: none; border: none; color: #c8a96e; cursor: pointer; font-family: 'Georgia', serif; font-size: 13px; text-decoration: underline; margin-left: 4px; }
        .auth-back { display: block; text-align: center; margin-top: 20px; font-size: 12px; color: rgba(255,255,255,0.25); text-decoration: none; letter-spacing: 0.08em; transition: color 0.2s; }
        .auth-back:hover { color: rgba(255,255,255,0.5); }
      `}</style>

      <div className="auth-page">
        <div className="auth-box">
          <Link href="/" className="auth-logo">
            <span className="auth-logo-icon">⬡</span>
            <span>SHELF</span>
          </Link>

          <h1 className="auth-title">
            {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create account" : "Reset password"}
          </h1>
          <p className="auth-subtitle">
            {mode === "signin" ? "Sign in to sync your reading progress"
              : mode === "signup" ? "Join to track and sync your novels"
              : "Enter your email and we'll send a reset link"}
          </p>

          {message && <div className={`auth-message ${message.type}`}>{message.text}</div>}

          {/* Google button — not shown on forgot password */}
          {mode !== "forgot" && (
            <>
              <button className="google-btn" onClick={handleGoogle} disabled={googleLoading}>
                <svg className="google-icon" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {googleLoading ? "Redirecting..." : "Continue with Google"}
              </button>
              <div className="auth-divider">
                <div className="auth-divider-line" />
                <span className="auth-divider-text">or</span>
                <div className="auth-divider-line" />
              </div>
            </>
          )}

          {/* Email/password form */}
          {mode !== "forgot" && (
            <form className="auth-form" onSubmit={handleEmailAuth}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div className="form-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="form-label">Password</label>
                  {mode === "signin" && (
                    <button type="button" onClick={() => switchMode("forgot")} style={{ background: "none", border: "none", color: "rgba(200,169,110,0.7)", fontSize: "11px", cursor: "pointer", fontFamily: "'Georgia', serif", letterSpacing: "0.06em" }}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <input className="form-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
              </div>
              <button className="auth-submit" type="submit" disabled={loading}>
                {loading ? "Please wait..." : mode === "signin" ? "Sign In →" : "Create Account →"}
              </button>
            </form>
          )}

          {/* Forgot password form */}
          {mode === "forgot" && (
            <form className="auth-form" onSubmit={handleForgotPassword}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <button className="auth-submit" type="submit" disabled={loading}>
                {loading ? "Sending..." : "Send Reset Link →"}
              </button>
            </form>
          )}

          <p className="auth-toggle">
            {mode === "signin" && (<>Don't have an account?<button onClick={() => switchMode("signup")}>Sign up</button></>)}
            {mode === "signup" && (<>Already have an account?<button onClick={() => switchMode("signin")}>Sign in</button></>)}
            {mode === "forgot" && (<>Remember your password?<button onClick={() => switchMode("signin")}>Sign in</button></>)}
          </p>

          <Link href="/" className="auth-back">← Back to home</Link>
        </div>
      </div>
    </>
  );
}