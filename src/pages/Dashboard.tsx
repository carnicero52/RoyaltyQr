import React, { useEffect, useState } from 'react';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Plus, Store, ChevronRight, LogOut, Settings, User, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

interface Business {
  id: string;
  name: string;
  rewardDescription: string;
  logoUrl?: string;
}

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBusinessName, setNewBusinessName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    const fetchBusinesses = async () => {
      try {
        const q = query(
          collection(db, 'businesses'),
          where('ownerUid', '==', user.uid)
        );
        const snapshot = await getDocs(q);
        const list = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Business[];
        setBusinesses(list);
        setError(null);
      } catch (err: any) {
        console.error('Error fetching businesses:', err);
        setError(`Error al cargar negocios: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchBusinesses();
  }, [user, navigate]);

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newBusinessName.trim()) return;

    setCreating(true);
    setError(null);
    try {
      console.log("Attempting to create business:", newBusinessName);
      const docRef = await addDoc(collection(db, 'businesses'), {
        name: newBusinessName,
        ownerUid: user.uid,
        ownerEmail: user.email,
        rewardDescription: 'Café Gratis', // Default
        couponsNeeded: 10,
        cooldownHours: 2,
        notificationsEnabled: true,
        createdAt: serverTimestamp(),
        currency: 'USD',
        themeColor: '#ea580c',
        darkModeEnabled: false,
        timezone: 'America/Caracas',
        slogan: '¡Fideliza a tus clientes!',
        description: 'Programa de recompensas para clientes frecuentes.'
      });
      console.log("Business created successfully with ID:", docRef.id);
      navigate(`/admin/${docRef.id}`);
    } catch (err: any) {
      console.error('Error creating business:', err);
      // Log the full error object for debugging
      console.log("Full error object:", JSON.stringify(err, null, 2));
      setError(`Error al crear negocio: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-[#222] bg-[#0a0a0a]/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
              <Store className="w-6 h-6 text-black" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Mis Negocios</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[#141414] border border-[#222] rounded-full">
              <User className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-300">{user?.email}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2.5 hover:bg-[#141414] rounded-xl transition-colors text-gray-400 hover:text-white"
              title="Cerrar Sesión"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {error && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Debug Info - Only visible for the developer email */}
        {auth.currentUser?.email === 'marcorodolfo40@gmail.com' && (
          <div className="mb-8 p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-400 text-xs font-mono flex flex-col gap-1">
            <p className="font-bold mb-1">Debug Info:</p>
            <p>User UID: {auth.currentUser?.uid}</p>
            <p>Project ID: {db.app.options.projectId}</p>
            <p>Database ID: {(db as any)._databaseId?.database || '(default)'}</p>
            <p>Auth Ready: {auth.currentUser ? 'Yes' : 'No'}</p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Create New Card */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="group relative h-48 bg-[#141414] border-2 border-dashed border-[#222] rounded-2xl flex flex-col items-center justify-center gap-4 hover:border-white/20 hover:bg-[#1a1a1a] transition-all"
          >
            <div className="w-12 h-12 bg-[#222] rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              <Plus className="w-6 h-6 text-white" />
            </div>
            <span className="font-medium text-gray-400 group-hover:text-white">Nuevo Negocio</span>
          </button>

          {/* Business Cards */}
          {businesses.map((biz) => (
            <motion.div
              key={biz.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ y: -4 }}
              onClick={() => navigate(`/admin/${biz.id}`)}
              className="group relative h-48 bg-[#141414] border border-[#222] rounded-2xl p-6 flex flex-col justify-between cursor-pointer hover:border-white/20 transition-all shadow-lg"
            >
              <div className="flex justify-between items-start">
                <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                  {biz.logoUrl ? (
                    <img src={biz.logoUrl} alt={biz.name} className="w-full h-full object-cover rounded-xl" referrerPolicy="no-referrer" />
                  ) : (
                    <Store className="w-6 h-6 text-white/40" />
                  )}
                </div>
                <div className="p-2 bg-white/5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight className="w-4 h-4 text-white" />
                </div>
              </div>
              
              <div>
                <h3 className="text-xl font-bold mb-1 group-hover:text-white transition-colors">{biz.name}</h3>
                <p className="text-sm text-gray-500">{biz.rewardDescription}</p>
              </div>

              <div className="absolute top-4 right-4 flex gap-2">
                {/* Status indicator or other meta */}
              </div>
            </motion.div>
          ))}
        </div>

        {businesses.length === 0 && !loading && (
          <div className="mt-20 text-center">
            <p className="text-gray-500 text-lg">Aún no tienes negocios registrados.</p>
            <p className="text-gray-600 text-sm mt-2">Crea tu primer negocio para empezar a fidelizar clientes.</p>
          </div>
        )}
      </main>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#141414] border border-[#222] rounded-3xl p-8 shadow-2xl"
            >
              <h2 className="text-2xl font-bold mb-6">Crear Nuevo Negocio</h2>
              <form onSubmit={handleCreateBusiness}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Nombre del Negocio
                    </label>
                    <input
                      autoFocus
                      type="text"
                      value={newBusinessName}
                      onChange={(e) => setNewBusinessName(e.target.value)}
                      placeholder="Ej: Café Central"
                      className="w-full bg-[#0a0a0a] border border-[#222] rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-white/10 transition-all"
                      required
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-8">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-[#222] font-medium hover:bg-[#1a1a1a] transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="flex-1 bg-white text-black px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition-colors disabled:opacity-50"
                  >
                    {creating ? 'Creando...' : 'Crear'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dashboard;
