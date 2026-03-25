"use client";

import { useState } from "react";
import { Chrome, Mail, UserRound, Zap } from "lucide-react";

// ── Login page ─────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0d0d0f]">

      {/* ── Looping video background ─────────────────────────────────────────── */}
      <video
        src="/bg.mp4"
        autoPlay
        muted
        loop
        playsInline
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.18]"
        style={{ willChange: "transform" }}
      />

      {/* ── Chromatic aberration accent blobs ────────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ mixBlendMode: "screen" }}
      >
        {/* red channel — top-left offset */}
        <div
          className="absolute h-[420px] w-[420px] rounded-full"
          style={{
            top: "8%",
            left: "12%",
            background: "radial-gradient(circle, rgba(220,38,38,0.28) 0%, transparent 70%)",
            filter: "blur(72px)",
            transform: "translate(-6px, 4px)",
          }}
        />
        {/* blue channel — bottom-right offset */}
        <div
          className="absolute h-[480px] w-[480px] rounded-full"
          style={{
            bottom: "6%",
            right: "8%",
            background: "radial-gradient(circle, rgba(99,102,241,0.30) 0%, transparent 70%)",
            filter: "blur(88px)",
            transform: "translate(6px, -4px)",
          }}
        />
        {/* purple center glow */}
        <div
          className="absolute h-[600px] w-[600px] rounded-full"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "radial-gradient(circle, rgba(124,58,237,0.14) 0%, transparent 65%)",
            filter: "blur(60px)",
          }}
        />
      </div>

      {/* ── SVG fractalNoise grain overlay ───────────────────────────────────── */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.08]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <filter id="grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.75"
            numOctaves="4"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>

      {/* ── Glassmorphic card ─────────────────────────────────────────────────── */}
      <div
        className="relative z-10 w-full max-w-xs rounded-2xl border border-white/10 px-7 py-8"
        style={{
          background: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          animation: "login-up 0.38s cubic-bezier(0.22,1,0.36,1) both",
        }}
      >
        {/* Logo mark */}
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600/80 shadow-lg shadow-purple-900/40">
            <Zap size={16} className="text-white" fill="currentColor" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-white/90">Synapse</span>
        </div>

        <h1 className="mb-1 text-[22px] font-bold leading-tight text-white">
          Sign in
        </h1>
        <p className="mb-6 text-[13px] text-white/40">
          Share and sync your recipes across devices.
        </p>

        {!emailMode ? (
          <div className="flex flex-col gap-3">
            {/* Google */}
            <button
              className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/6 px-4 py-3 text-[13px] font-medium text-white/85 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-white/20 hover:bg-white/10 active:scale-[0.98]"
              onClick={() => {/* wire Supabase Google OAuth */}}
            >
              <Chrome size={15} className="shrink-0 text-white/60" />
              Continue with Google
            </button>

            {/* Email */}
            <button
              className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/6 px-4 py-3 text-[13px] font-medium text-white/85 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-white/20 hover:bg-white/10 active:scale-[0.98]"
              onClick={() => setEmailMode(true)}
            >
              <Mail size={15} className="shrink-0 text-white/60" />
              Continue with Email
            </button>

            <div className="my-1 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/8" />
              <span className="text-[10px] text-white/25">or</span>
              <div className="h-px flex-1 bg-white/8" />
            </div>

            {/* Guest */}
            <button
              className="flex w-full items-center gap-3 rounded-xl border border-white/6 bg-transparent px-4 py-3 text-[13px] font-medium text-white/40 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-white/12 hover:text-white/60 active:scale-[0.98]"
              onClick={() => {/* wire guest / anonymous session */}}
            >
              <UserRound size={15} className="shrink-0" />
              Browse as Guest
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/6 px-4 py-3 text-[13px] text-white placeholder-white/25 outline-none ring-0 transition-all duration-200 focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20"
            />
            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 text-[13px] font-semibold text-white transition-all duration-300 ease-out hover:scale-[1.02] hover:bg-purple-500 active:scale-[0.98]"
              onClick={() => {/* send magic link */}}
            >
              Send Magic Link
            </button>
            <button
              onClick={() => setEmailMode(false)}
              className="text-center text-[11px] text-white/30 transition-colors hover:text-white/55"
            >
              ← Back
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-[10px] leading-relaxed text-white/20">
          By continuing you agree to our{" "}
          <span className="text-white/40 underline underline-offset-2 hover:text-white/60 cursor-pointer">Terms</span>
          {" & "}
          <span className="text-white/40 underline underline-offset-2 hover:text-white/60 cursor-pointer">Privacy</span>
          .
        </p>
      </div>

      {/* ── Keyframe injection ────────────────────────────────────────────────── */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes login-up {
          from { opacity: 0; transform: translateY(18px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
      ` }} />
    </div>
  );
}
