import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogIn, Store } from 'lucide-react';
import { motion } from 'motion/react';

const LoginPage: React.FC = () => {
  const { login, user } = useAuth();
  const [error, setError] = React.useState<string | null>(null);
  const navigate = useNavigate();

  React.useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  const handleLogin = async () => {
    setError(null);
    try {
      await login();
      navigate('/dashboard');
    } catch (error: any) {
      console.error('Login failed:', error);
      setError(error.message || 'Error al iniciar sesión');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-[#141414] border border-[#222] rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-16 h-16 bg-[#222] rounded-2xl flex items-center justify-center mb-6 border border-[#333]">
            <Store className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Royalty QR</h1>
          <p className="text-gray-400">La plataforma de fidelización para tu negocio</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-6">
          <button
            onClick={handleLogin}
            className="w-full bg-white text-black font-semibold py-4 rounded-xl flex items-center justify-center gap-3 hover:bg-gray-200 transition-all active:scale-[0.98]"
          >
            <LogIn className="w-5 h-5" />
            Continuar con Google
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#222]"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#141414] px-2 text-gray-500">Acceso Seguro</span>
            </div>
          </div>

          <p className="text-center text-xs text-gray-500 leading-relaxed">
            Al continuar, aceptas nuestros términos de servicio y política de privacidad.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
