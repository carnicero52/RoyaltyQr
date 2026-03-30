import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, setDoc, updateDoc, increment, collection, addDoc, query, where, getDocs, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { Business, Customer } from "../types";
import { Phone, Gift, CheckCircle2, AlertCircle, Clock, ArrowRight, Moon, Sun } from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { es } from "date-fns/locale";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../lib/utils";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";

export default function PublicPanel() {
  const { businessId } = useParams<{ businessId: string }>();
  const navigate = useNavigate();
  const [business, setBusiness] = useState<Business | null>(null);
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    if (!businessId) return;

    const unsubscribe = onSnapshot(doc(db, "businesses", businessId), (snapshot) => {
      if (snapshot.exists()) {
        setBusiness({ id: snapshot.id, ...snapshot.data() } as Business);
      }
      setLoading(false);
    }, (err) => {
      console.error("Error fetching business:", err);
      handleFirestoreError(err, OperationType.GET, `businesses/${businessId}`);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [businessId]);

  useEffect(() => {
    if (!businessId || !customer?.id) return;

    const unsubscribe = onSnapshot(doc(db, "businesses", businessId, "customers", customer.id), (snapshot) => {
      if (snapshot.exists()) {
        setCustomer({ id: snapshot.id, ...snapshot.data() } as Customer);
      }
    });

    return () => unsubscribe();
  }, [businessId, customer?.id]);

  useEffect(() => {
    if (business) {
      setDarkMode(business.darkModeEnabled || false);
      if (business.themeColor) {
        document.documentElement.style.setProperty('--primary-color', business.themeColor);
      }
    }
  }, [business]);

  const handleIdentify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || phone.length < 8) {
      setMessage({ type: "error", text: "Por favor, ingresa un número de teléfono válido." });
      return;
    }

    setRegistering(true);
    setMessage(null);

    try {
      const customerRef = doc(db, "businesses", businessId!, "customers", phone);
      const customerSnap = await getDoc(customerRef);

      if (!customerSnap.exists()) {
        setMessage({ 
          type: "error", 
          text: "Cliente no encontrado. Por favor, diríjase al negocio y regístrese." 
        });
        setRegistering(false);
        return;
      }

      const currentCustomer = { id: customerSnap.id, ...customerSnap.data() } as Customer;
      
      // Check Cooldown
      if (currentCustomer.lastPurchaseAt) {
        const lastPurchase = new Date(currentCustomer.lastPurchaseAt);
        const hoursDiff = differenceInHours(new Date(), lastPurchase);
        const cooldown = business?.cooldownHours || 2;

        if (hoursDiff < cooldown) {
          setCustomer(currentCustomer);
          setMessage({ 
            type: "info", 
            text: `Por favor, espera ${cooldown - hoursDiff} horas más antes de tu próximo sello.` 
          });
          setRegistering(false);
          return;
        }
      }

      // Register Purchase
      const now = new Date().toISOString();
      const path = `businesses/${businessId}/customers/${phone}`;
      await updateDoc(customerRef, {
        couponsCount: increment(1),
        lastPurchaseAt: now,
      });

      // Add to Purchase History
      const purchasePath = `businesses/${businessId}/purchases`;
      await addDoc(collection(db, businessId!, "purchases"), {
        customerId: phone,
        businessId: businessId!,
        timestamp: now,
      });

      // Update Local State
      const updatedCustomer = {
        ...currentCustomer,
        couponsCount: currentCustomer.couponsCount + 1,
        lastPurchaseAt: now,
      };
      setCustomer(updatedCustomer);
      setMessage({ type: "success", text: "¡Sello añadido con éxito!" });

      // Notify Admin (Server-side)
      if (business?.notificationsEnabled) {
        notifyAdmin(updatedCustomer);
      }

    } catch (err) {
      console.error("Error registering purchase:", err);
      handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}`);
    } finally {
      setRegistering(false);
    }
  };

  const notifyAdmin = async (cust: Customer) => {
    try {
      const isRewardReached = cust.couponsCount >= (business?.couponsNeeded || 10);
      await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: isRewardReached ? "Premio Alcanzado" : "Compra Registrada",
          data: {
            customer: cust.phone,
            coupons: cust.couponsCount,
            business: business?.name,
          },
          config: {
            email: business?.ownerEmail,
            telegram: !!business?.telegramChatId,
            telegramToken: business?.telegramToken,
            telegramChatId: business?.telegramChatId,
            whatsapp: !!business?.whatsappEnabled,
            whatsappPhone: business?.whatsappPhone,
            whatsappApiKey: business?.whatsappApiKey,
            gmailUser: business?.gmailUser,
            gmailAppPass: business?.gmailAppPass,
          }
        }),
      });
    } catch (err) {
      console.error("Notification failed:", err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-md bg-white p-8 rounded-[2rem] shadow-xl border border-gray-100">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">NEGOCIO NO ENCONTRADO</h1>
          <p className="text-gray-600 mt-2">El enlace que seguiste parece ser inválido o el negocio ya no existe.</p>
          <div className="mt-6 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[10px] text-slate-400 font-mono break-all">ID: {businessId}</p>
          </div>
          <button 
            onClick={() => navigate("/")}
            className="mt-8 w-full bg-orange-600 text-white py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200"
          >
            Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  const progress = customer ? (customer.couponsCount / business.couponsNeeded) * 100 : 0;
  const isRewardReady = customer && customer.couponsCount >= business.couponsNeeded;

  return (
    <div className={cn(
      "min-h-screen flex flex-col items-center py-10 px-4 sm:px-6 transition-colors duration-300",
      darkMode ? "bg-slate-950 text-slate-100" : "bg-gray-50 text-gray-900"
    )}>
      {/* Theme Toggle */}
      <button
        onClick={() => setDarkMode(!darkMode)}
        className={cn(
          "fixed top-4 right-4 p-3 rounded-full shadow-lg z-50 transition-all",
          darkMode ? "bg-slate-800 text-yellow-400" : "bg-white text-slate-600"
        )}
      >
        {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "w-full max-w-md rounded-3xl shadow-xl overflow-hidden border transition-all",
          darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
        )}
      >
        {/* Header */}
        <div className="bg-primary p-8 text-center text-white relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <div className="absolute -top-10 -left-10 w-40 h-40 bg-white rounded-full blur-3xl"></div>
            <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white rounded-full blur-3xl"></div>
          </div>
          
          <div className="relative z-10 flex flex-col items-center">
            {business.logoUrl && (
              <div className="h-20 w-20 bg-white rounded-2xl p-1 shadow-xl mb-4 overflow-hidden">
                <img src={business.logoUrl} alt={business.name} className="h-full w-full object-contain rounded-xl" referrerPolicy="no-referrer" />
              </div>
            )}
            <h1 className="text-3xl font-bold tracking-tight">{business.name}</h1>
            {business.slogan && <p className="text-white/80 text-xs uppercase font-bold tracking-widest mt-1">{business.slogan}</p>}
            <p className="mt-3 text-white font-medium bg-white/20 px-4 py-1 rounded-full inline-block">{business.rewardDescription}</p>
            {customer?.level && (
              <div className={cn(
                "mt-3 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-sm",
                customer.level === 'gold' ? "bg-gradient-to-r from-yellow-400 to-yellow-600 text-white" :
                customer.level === 'silver' ? "bg-gradient-to-r from-gray-300 to-gray-500 text-white" :
                "bg-black/20 text-white border border-white/20"
              )}>
                Cliente {customer.level}
              </div>
            )}
          </div>
        </div>

        <div className="p-8">
          {!customer ? (
            <form onSubmit={handleIdentify} className="space-y-6">
              <div className="text-center mb-6">
                <h2 className={cn("text-xl font-semibold", darkMode ? "text-white" : "text-gray-900")}>¡Bienvenido!</h2>
                <p className={cn("text-sm mt-1", darkMode ? "text-slate-400" : "text-gray-500")}>Ingresa tu teléfono para obtener tu sello.</p>
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Phone className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Número de teléfono"
                  className={cn(
                    "block w-full pl-12 pr-4 py-4 border rounded-2xl text-lg font-medium transition-all focus:ring-2 focus:ring-primary outline-none",
                    darkMode ? "bg-slate-800 border-slate-700 text-white placeholder:text-slate-500" : "bg-white border-gray-200 text-gray-900"
                  )}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={registering}
                className="w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-2xl shadow-sm text-lg font-bold text-white bg-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all disabled:opacity-50"
              >
                {registering ? (
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                ) : (
                  <>
                    Obtener mi sello
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-8">
              {/* Progress Section */}
              <div className="text-center">
                <div className={cn("inline-flex items-center justify-center p-4 rounded-full mb-4", darkMode ? "bg-primary/20" : "bg-primary/10")}>
                  <Gift className="h-8 w-8 text-primary" />
                </div>
                <h2 className={cn("text-2xl font-bold", darkMode ? "text-white" : "text-gray-900")}>
                  {customer.couponsCount} de {business.couponsNeeded}
                </h2>
                <p className={cn("text-sm mt-1", darkMode ? "text-slate-400" : "text-gray-500")}>Sellos acumulados</p>
              </div>

              {/* Progress Bar */}
              <div className="relative pt-1">
                <div className={cn("overflow-hidden h-4 mb-4 text-xs flex rounded-full", darkMode ? "bg-slate-800" : "bg-primary/10")}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(progress, 100)}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-primary"
                  ></motion.div>
                </div>
              </div>

              {/* Reward Status */}
              <AnimatePresence>
                {isRewardReady ? (
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={cn(
                      "border p-6 rounded-3xl text-center",
                      darkMode ? "bg-green-900/20 border-green-800 text-green-400" : "bg-green-50 border-green-200 text-green-800"
                    )}
                  >
                    <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
                    <h3 className="text-xl font-bold">¡Premio listo!</h3>
                    <p className="mt-1 opacity-80">Muestra esta pantalla al personal para canjear tu premio.</p>
                  </motion.div>
                ) : (
                  <div className="space-y-4">
                    {business.rewardImageUrl && (
                      <div className={cn("w-full h-48 rounded-2xl overflow-hidden border shadow-inner", darkMode ? "border-slate-800" : "border-gray-100")}>
                        <img src={business.rewardImageUrl} alt="Premio" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                    )}
                    <div className={cn("p-6 rounded-3xl text-center border", darkMode ? "bg-slate-800 border-slate-700" : "bg-gray-50 border-gray-100")}>
                      <p className={darkMode ? "text-slate-300" : "text-gray-600"}>
                        Necesitas <span className="font-bold text-primary">{business.couponsNeeded - customer.couponsCount}</span> sellos más para tu <span className="font-medium">{business.rewardDescription}</span>.
                      </p>
                      {business.rewardLongDescription && (
                        <p className={cn("text-xs mt-3 italic", darkMode ? "text-slate-500" : "text-gray-400")}>
                          {business.rewardLongDescription}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </AnimatePresence>

              {/* Last Stamp Info */}
              {customer.lastPurchaseAt && (
                <div className="flex items-center justify-center text-slate-500 text-xs space-x-2">
                  <Clock className="h-3 w-3" />
                  <span>Último sello: hace {formatDistanceToNow(new Date(customer.lastPurchaseAt), { addSuffix: true, locale: es })}</span>
                </div>
              )}

              <button
                onClick={() => {
                  setCustomer(null);
                  setPhone("");
                  setMessage(null);
                }}
                className={cn("w-full py-3 font-medium transition-colors", darkMode ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-700")}
              >
                Usar otro número
              </button>
            </div>
          )}

          {/* Messages */}
          <AnimatePresence>
            {message && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={cn(
                  "mt-6 p-4 rounded-2xl flex items-start space-x-3 border",
                  message.type === "success" ? (darkMode ? "bg-green-900/20 text-green-400 border-green-800" : "bg-green-50 text-green-800 border-green-100") : 
                  message.type === "error" ? (darkMode ? "bg-red-900/20 text-red-400 border-red-800" : "bg-red-50 text-red-800 border-red-100") : 
                  (darkMode ? "bg-blue-900/20 text-blue-400 border-blue-800" : "bg-blue-50 text-blue-800 border-blue-100")
                )}
              >
                {message.type === "success" ? <CheckCircle2 className="h-5 w-5 mt-0.5" /> : <AlertCircle className="h-5 w-5 mt-0.5" />}
                <p className="text-sm font-medium">{message.text}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Footer */}
      <footer className="mt-10 text-center text-slate-500 text-sm">
        <p>© {new Date().getFullYear()} Fideliza Recompensas</p>
      </footer>
    </div>
  );
}
