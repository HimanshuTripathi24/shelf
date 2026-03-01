"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" } | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  // Supabase sends the user here with a session already set via the reset link
  // We just need to wait for the session to be established
  useEffect(() => {
    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // Also check if already in a valid session (page refresh case)
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setReady(true);
    });
  }, []);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setMessage({ text: "Passwords don't match.", type: "error" });
      return;
    }
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage({ text: error.message, type: "error" });
    } else {
      setMessage({ text: "✓ Password updated! Redirecting…", type: "success" });
      setTimeout(() => { router.push("/"); router.refresh(); }, 1500);
    }
    setLoading(false);
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
        .auth-form { display: flex; flex-direction: column; gap: 16px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-label { font-size: 11px; letter-spacing: 0.15em; color: rgba(255,255,255,0.4); text-transform: uppercase; }
        .form-input { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px 16px; color: #fff; font-size: 14px; font-family: 'Georgia', serif; outline: none; transition: border-color 0.2s; width: 100%; }
        .form-input:focus { border-color: rgba(200,169,110,0.5); }
        .form-input::placeholder { color: rgba(255,255,255,0.2); }
        .auth-submit { width: 100%; background: #c8a96e; color: #080808; border: none; border-radius: 8px; padding: 13px 20px; font-size: 13px; font-family: 'Georgia', serif; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; margin-top: 4px; }
        .auth-submit:hover { background: #dfc07e; }
        .auth-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .auth-message { border-radius: 8px; padding: 12px 16px; font-size: 13px; line-height: 1.5; margin-bottom: 16px; }
        .auth-message.error { background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.2); color: #f87171; }
        .auth-message.success { background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.2); color: #4ade80; }
        .auth-back { display: block; text-align: center; margin-top: 20px; font-size: 12px; color: rgba(255,255,255,0.25); text-decoration: none; letter-spacing: 0.08em; transition: color 0.2s; }
        .auth-back:hover { color: rgba(255,255,255,0.5); }
      `}</style>

      <div className="auth-page">
        <div className="auth-box">
          <Link href="/" className="auth-logo">
            <span className="auth-logo-icon">⬡</span>
            <span>SHELF</span>
          </Link>

          <h1 className="auth-title">New password</h1>
          <p className="auth-subtitle">Choose a new password for your account</p>

          {message && <div className={`auth-message ${message.type}`}>{message.text}</div>}

          {!ready && !message && (
            <p style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "13px" }}>Verifying reset link…</p>
          )}

          {ready && !message?.type.includes("success") && (
            <form className="auth-form" onSubmit={handleReset}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input className="form-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input className="form-input" type="password" placeholder="••••••••" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={6} />
              </div>
              <button className="auth-submit" type="submit" disabled={loading}>
                {loading ? "Updating…" : "Update Password →"}
              </button>
            </form>
          )}

          <Link href="/sign-in" className="auth-back">← Back to sign in</Link>
        </div>
      </div>
    </>
  );
}