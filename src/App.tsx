import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./firebase";
import PublicPanel from "./pages/PublicPanel";
import AdminPanel from "./pages/AdminPanel";
import Login from "./pages/Login";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        {/* Public Route */}
        <Route path="/negocio/:businessId" element={<PublicPanel />} />
        
        {/* Admin Routes */}
        <Route 
          path="/admin" 
          element={user ? <AdminPanel /> : <Navigate to="/login" />} 
        />
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/admin" />} />
        
        {/* Default Redirect */}
        <Route path="/" element={<Navigate to="/admin" />} />
      </Routes>
    </Router>
  );
}
