import React, { useState } from "react";
import { Lock, Mail, ArrowRight, ShieldCheck, UserCheck, Building2 } from "lucide-react";
import { api } from "../api";
import { User } from "../types";

interface LoginModalProps {
  onLoginSuccess: (user: User) => void;
  onCancel?: () => void;
  canCancel?: boolean;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  onLoginSuccess,
  onCancel,
  canCancel = false,
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Por favor ingresa tu correo o usuario");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.login({ email, password });
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (userEmail: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.login({ email: userEmail, password: "password" });
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || "Error al iniciar sesión rápida");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-md w-full p-8 text-slate-800 relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 pb-5 border-b border-slate-100">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0 shadow-sm">
            <Building2 className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              InfraTrack ERP
            </h2>
            <p className="text-xs text-slate-500">
              Control de Obras, Presupuestos y Certificaciones
            </p>
          </div>
          {canCancel && onCancel && (
            <button
              onClick={onCancel}
              className="ml-auto text-slate-400 hover:text-slate-700 text-lg font-bold p-1 rounded-lg cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
            {error}
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block mb-1.5">
              Usuario o Correo Electrónico
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                id="login-email-input"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ej. ana.urbina@obra.local"
                className="w-full bg-white border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-xl pl-10 pr-3 py-2.5 text-xs text-slate-900 placeholder-slate-400 outline-none transition shadow-xs"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                id="login-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-white border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-xl pl-10 pr-3 py-2.5 text-xs text-slate-900 placeholder-slate-400 outline-none transition shadow-xs"
              />
            </div>
          </div>

          <button
            id="btn-submit-login"
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-xs font-bold transition shadow-md shadow-blue-600/20 disabled:opacity-50 mt-2 cursor-pointer"
          >
            {loading ? "Verificando credenciales..." : "Iniciar Sesión en el Sistema"}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Quick Demo Access */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2.5 text-center">
            O selecciona un perfil de obra autorizado
          </span>

          <div className="space-y-2">
            <button
              onClick={() => handleQuickLogin("ana.urbina@obra.local")}
              className="w-full text-left p-3 rounded-xl bg-white hover:bg-blue-50/60 border border-slate-200 hover:border-blue-300 transition flex items-center gap-3 group cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
                AU
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 group-hover:text-blue-700 transition truncate">
                  Ana Urbina
                </p>
                <span className="text-[11px] text-slate-500 block truncate">
                  Jefa de Obra & Administradora
                </span>
              </div>
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            </button>

            <button
              onClick={() => handleQuickLogin("cbenitez@obra.local")}
              className="w-full text-left p-3 rounded-xl bg-white hover:bg-blue-50/60 border border-slate-200 hover:border-blue-300 transition flex items-center gap-3 group cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
                CB
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 group-hover:text-blue-700 transition truncate">
                  Ing. Carlos Benítez
                </p>
                <span className="text-[11px] text-slate-500 block truncate">
                  Jefe de Frente de Obra
                </span>
              </div>
              <UserCheck className="w-4 h-4 text-blue-600 shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
