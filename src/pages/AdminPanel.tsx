import { useState, useEffect, useRef } from "react";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, deleteDoc, addDoc, where, onSnapshot, increment } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Business, Customer, Purchase, Reminder, Staff } from "../types";
import { 
  Settings, Users, QrCode, BarChart3, LogOut, Save, Plus, Search, 
  Edit2, Trash2, Download, FileText, Mail, Send, Bell, Gift,
  CheckCircle2, AlertCircle, TrendingUp, UserPlus, History, X, PlusCircle,
  CreditCard, Megaphone, Calendar, MessageSquare, Clock, User, Check,
  Palette, Moon, Sun
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line 
} from "recharts";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../lib/utils";

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState<"overview" | "config" | "customers" | "qr" | "stats" | "billing" | "marketing" | "rewards" | "staff">("overview");
  const [business, setBusiness] = useState<Business | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isEditingCustomer, setIsEditingCustomer] = useState<Customer | null>(null);
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [customerHistory, setCustomerHistory] = useState<Purchase[]>([]);
  const [isAddingPurchase, setIsAddingPurchase] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [reminderForm, setReminderForm] = useState({
    subject: "",
    message: "",
    scheduledAt: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    type: "marketing" as "billing" | "marketing"
  });

  const qrRef = useRef<HTMLDivElement>(null);

  const exportToCSV = (data: any[], fileName: string) => {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(","),
      ...data.map(row => headers.map(header => JSON.stringify(row[header] || "")).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${fileName}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generateReceiptPDF = (purchase: Purchase, customer: Customer) => {
    const doc = new jsPDF();
    const businessName = business?.name || "Mi Negocio";
    
    doc.setFontSize(20);
    doc.text(businessName, 105, 20, { align: "center" });
    
    doc.setFontSize(12);
    doc.text("RECIBO DE PAGO", 105, 30, { align: "center" });
    
    doc.line(20, 35, 190, 35);
    
    doc.text(`Fecha: ${format(new Date(purchase.timestamp), "dd/MM/yyyy HH:mm")}`, 20, 45);
    doc.text(`Cliente: ${customer.name || customer.phone}`, 20, 55);
    doc.text(`Teléfono: ${customer.phone}`, 20, 65);
    
    doc.line(20, 70, 190, 70);
    
    doc.setFontSize(14);
    doc.text("Detalle:", 20, 80);
    doc.text(`Monto: ${business?.currency || "$"} ${purchase.amount?.toLocaleString()}`, 20, 90);
    doc.text(`Método: ${purchase.paymentMethod}`, 20, 100);
    if (purchase.notes) {
      doc.text(`Notas: ${purchase.notes}`, 20, 110);
    }
    
    doc.setFontSize(10);
    doc.text("¡Gracias por su preferencia!", 105, 150, { align: "center" });
    
    doc.save(`recibo-${purchase.id}.pdf`);
  };

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    // Real-time Business Config
    const unsubBusiness = onSnapshot(doc(db, "businesses", uid), async (docSnap) => {
      if (docSnap.exists()) {
        setBusiness({ id: docSnap.id, ...docSnap.data() } as Business);
      } else {
        // Create default business if it doesn't exist
        const defaultBusiness: Business = {
          id: uid,
          name: "Mi Negocio",
          rewardDescription: "Café Gratis",
          couponsNeeded: 10,
          cooldownHours: 2,
          notificationsEnabled: false,
          ownerEmail: auth.currentUser?.email || "",
          themeColor: "#ea580c", // Default orange-600
          darkModeEnabled: false,
        };
        await setDoc(doc(db, "businesses", uid), defaultBusiness);
        setBusiness(defaultBusiness);
      }
      setLoading(false);
    });

    // Real-time Customers
    const unsubCustomers = onSnapshot(collection(db, "businesses", uid, "customers"), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer));
      setCustomers(list);
    });

    // Real-time Purchases
    const qPurchases = query(collection(db, "businesses", uid, "purchases"), orderBy("timestamp", "desc"));
    const unsubPurchases = onSnapshot(qPurchases, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Purchase));
      setPurchases(list);
    });

    // Real-time Reminders
    const qReminders = query(collection(db, "businesses", uid, "reminders"), orderBy("scheduledAt", "desc"));
    const unsubReminders = onSnapshot(qReminders, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reminder));
      setReminders(list);
    });

    // Real-time Staff
    const unsubStaff = onSnapshot(collection(db, "businesses", uid, "staff"), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Staff));
      setStaff(list);
    });

    return () => {
      unsubBusiness();
      unsubCustomers();
      unsubPurchases();
      unsubReminders();
      unsubStaff();
    };
  }, []);

  useEffect(() => {
    if (business) {
      if (business.themeColor) {
        document.documentElement.style.setProperty('--primary-color', business.themeColor);
      }
      if (business.darkModeEnabled) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [business]);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const handleFirestoreError = (error: unknown, operationType: string, path: string | null) => {
    const errInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    setStatus({ message: "Error de permisos o conexión con la base de datos.", type: 'error' });
    throw new Error(JSON.stringify(errInfo));
  };

  const handleScheduleReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    setSaving(true);
    try {
      const scheduledDate = new Date(reminderForm.scheduledAt);
      const reminderData: Omit<Reminder, 'id'> = {
        businessId: business.id,
        ...reminderForm,
        scheduledAt: scheduledDate.toISOString(),
        customerIds: selectedCustomers,
        status: "pending"
      };
      const path = `businesses/${business.id}/reminders`;
      try {
        await addDoc(collection(db, "businesses", business.id, "reminders"), reminderData);
      } catch (err) {
        handleFirestoreError(err, 'create', path);
      }
      setStatus({ message: "¡Recordatorio programado con éxito!", type: 'success' });
      setReminderForm({
        subject: "",
        message: "",
        scheduledAt: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        type: "marketing"
      });
      setSelectedCustomers([]);
    } catch (err) {
      console.error("Error scheduling reminder:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleSendNow = async () => {
    if (!business) return;
    if (selectedCustomers.length === 0) {
      setStatus({ message: "Selecciona al menos un cliente.", type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const targetCustomers = customers.filter(c => selectedCustomers.includes(c.id));
      const config = {
        email: business.ownerEmail,
        telegram: !!business.telegramChatId,
        telegramToken: business.telegramToken,
        telegramChatId: business.telegramChatId,
        whatsapp: !!business.whatsappEnabled,
        whatsappPhone: business.whatsappPhone,
        whatsappApiKey: business.whatsappApiKey,
        gmailUser: business.gmailUser,
        gmailAppPass: business.gmailAppPass,
      };

      let anySuccess = false;
      let errors: string[] = [];

      for (const cust of targetCustomers) {
        try {
          console.log(`[Notification] Sending to ${cust.name || cust.phone}...`);
          const response = await fetch(`${window.location.origin}/api/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: reminderForm.type === "billing" ? "Recordatorio de Cobro" : "Campaña de Marketing",
              message: reminderForm.message,
              subject: reminderForm.subject,
              config,
              toEmail: cust.email,
              toPhone: cust.phone,
            }),
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server returned ${response.status}: ${errorText}`);
          }

          const data = await response.json();
          if (data.success && data.results) {
            Object.entries(data.results).forEach(([method, res]: [string, any]) => {
              if (res) {
                if (res.success) {
                  anySuccess = true;
                } else {
                  errors.push(`${cust.name || cust.phone} (${method}): ${res.error}`);
                }
              }
            });
          } else if (!data.success) {
            errors.push(`${cust.name || cust.phone}: ${data.error || "Error de servidor"}`);
          }
        } catch (err: any) {
          console.error(`[Notification] Fetch Error for ${cust.name || cust.phone}:`, err);
          errors.push(`${cust.name || cust.phone}: Error de red (${err.message})`);
        }
      }

      // Also save to history
      const statusMessage = errors.length > 0 ? [...new Set(errors)].join(", ") : undefined;
      const reminderData: Omit<Reminder, 'id'> = {
        businessId: business.id,
        ...reminderForm,
        scheduledAt: new Date().toISOString(),
        customerIds: selectedCustomers,
        status: anySuccess ? "sent" : "failed",
        statusMessage: statusMessage
      };
      await addDoc(collection(db, "businesses", business.id, "reminders"), reminderData);

      if (anySuccess) {
        setStatus({ 
          message: errors.length > 0 
            ? `Enviado con algunos errores: ${statusMessage}` 
            : "¡Notificaciones enviadas con éxito!", 
          type: errors.length > 0 ? 'warning' : 'success' 
        });
      } else {
        setStatus({ 
          message: `Error al enviar: ${statusMessage || "No se pudo enviar por ningún medio"}`, 
          type: 'error' 
        });
      }

      if (anySuccess) {
        setReminderForm({
          subject: "",
          message: "",
          scheduledAt: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
          type: "marketing"
        });
        setSelectedCustomers([]);
      }
    } catch (err) {
      console.error("Error sending notifications:", err);
      setStatus({ message: "Error al enviar notificaciones.", type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setSaving(true);
    try {
      const url = `${window.location.origin}/api/health`;
      console.log("Testing connection to:", url);
      const response = await fetch(url);
      const text = await response.text();
      
      if (response.ok) {
        try {
          const data = JSON.parse(text);
          alert(`Conexión exitosa. Servidor activo (Project: ${data.projectId})`);
        } catch (e) {
          alert(`Conexión exitosa (texto): ${text.substring(0, 100)}`);
        }
      } else {
        let errorMsg = "Unknown error";
        try {
          const errorData = JSON.parse(text);
          errorMsg = errorData.error || errorMsg;
        } catch (e) {
          errorMsg = text || errorMsg;
        }
        alert(`Error de conexión: ${response.status} - ${errorMsg.substring(0, 200)}`);
      }
    } catch (err: any) {
      alert(`Error de red: ${err.message}\nVerifica que el servidor esté corriendo.`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "businesses", business.id), { ...business });
      alert("¡Configuración guardada con éxito!");
    } catch (err) {
      console.error("Error saving config:", err);
      alert("Failed to save configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const phone = formData.get("phone") as string;
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const notes = formData.get("notes") as string;
    const referredBy = formData.get("referredBy") as string;

    if (!phone || phone.length < 8) {
      alert("Por favor ingrese un número de teléfono válido.");
      return;
    }

    if (customers.some(c => c.phone === phone)) {
      alert("Ya existe un cliente con este número de teléfono.");
      return;
    }

    try {
      const newCust: Customer = {
        id: phone,
        phone,
        name,
        email,
        notes,
        status: 'active',
        couponsCount: 0,
        totalSpent: 0,
        businessId: business!.id,
        level: 'bronze',
        referredBy: referredBy || undefined,
        referralCount: 0
      };
      await setDoc(doc(db, "businesses", business!.id, "customers", phone), newCust);
      
      // Si fue referido, dar un bono al referente
      if (referredBy) {
        const referrerRef = doc(db, "businesses", business!.id, "customers", referredBy);
        const referrerSnap = await getDoc(referrerRef);
        if (referrerSnap.exists()) {
          await updateDoc(referrerRef, {
            referralCount: increment(1),
            couponsCount: increment(1) // Sello de regalo por referir
          });
        }
      }

      setSearchTerm("");
      setIsAddingCustomer(false);
    } catch (err) {
      console.error("Error adding customer:", err);
    }
  };

  const handleUpdateCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isEditingCustomer) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const notes = formData.get("notes") as string;
    const status = formData.get("status") as 'active' | 'inactive';
    const couponsCount = parseInt(formData.get("couponsCount") as string);

    try {
      const updated = { ...isEditingCustomer, name, email, notes, status, couponsCount };
      await updateDoc(doc(db, "businesses", business!.id, "customers", isEditingCustomer.id), updated);
      setIsEditingCustomer(null);
    } catch (err) {
      console.error("Error updating customer:", err);
    }
  };

  const handleAddPurchase = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAddingPurchase || !business) return;
    const formData = new FormData(e.currentTarget);
    const amount = parseFloat(formData.get("amount") as string) || 0;
    const paymentMethod = formData.get("paymentMethod") as string;
    const notes = formData.get("notes") as string;

    try {
      const now = new Date().toISOString();
      const customerRef = doc(db, "businesses", business.id, "customers", isAddingPurchase);
      const customerSnap = await getDoc(customerRef);
      const customerData = customerSnap.data() as Customer;
      
      // Calculate coupons based on level
      let couponsToAdd = 1;
      if (customerData.level === 'silver') couponsToAdd = business.levels?.silver.multiplier || 1.5;
      if (customerData.level === 'gold') couponsToAdd = business.levels?.gold.multiplier || 2;

      const newTotalSpent = (customerData.totalSpent || 0) + amount;
      
      // Determine new level
      let newLevel = customerData.level || 'bronze';
      if (business.levels) {
        if (newTotalSpent >= business.levels.gold.minSpent) newLevel = 'gold';
        else if (newTotalSpent >= business.levels.silver.minSpent) newLevel = 'silver';
      }

      // Update Customer
      await updateDoc(customerRef, {
        couponsCount: increment(couponsToAdd),
        totalSpent: increment(amount),
        lastPurchaseAt: now,
        level: newLevel
      });

      // Record Purchase
      await addDoc(collection(db, "businesses", business.id, "purchases"), {
        customerId: isAddingPurchase,
        businessId: business.id,
        amount,
        paymentMethod,
        notes,
        timestamp: now,
        staffId: auth.currentUser?.uid
      });

      setIsAddingPurchase(null);
      alert("Sello y cobro registrado con éxito!");
    } catch (err) {
      console.error("Error adding purchase:", err);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this customer?")) return;
    try {
      await deleteDoc(doc(db, "businesses", business!.id, "customers", id));
    } catch (err) {
      console.error("Error deleting customer:", err);
    }
  };

  const fetchCustomerHistory = async (customerId: string) => {
    const q = query(
      collection(db, "businesses", business!.id, "purchases"),
      where("customerId", "==", customerId),
      orderBy("timestamp", "desc")
    );
    const snap = await getDocs(q);
    setCustomerHistory(snap.docs.map(d => ({ id: d.id, ...d.data() } as Purchase)));
    setShowHistory(customerId);
  };

  const sendBulkNotification = async (type: string, message: string, targetCustomers: Customer[]) => {
    if (!business) return;
    setSaving(true);
    try {
      for (const cust of targetCustomers) {
        await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            data: {
              message,
              customer: cust.name || cust.phone,
              business: business.name,
            },
            config: {
              email: cust.email,
              telegram: !!business.telegramChatId, // This would normally be the customer's telegram, but we'll use the business one for demo
            }
          }),
        });
      }
      alert("¡Notificaciones enviadas con éxito!");
    } catch (err) {
      console.error("Error sending bulk notifications:", err);
      alert("Failed to send some notifications.");
    } finally {
      setSaving(false);
    }
  };
  const downloadQR = () => {
    const svg = qrRef.current?.querySelector("svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL("image/png");
      const downloadLink = document.createElement("a");
      downloadLink.download = "business-qr.png";
      downloadLink.href = pngFile;
      downloadLink.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  const filteredCustomers = customers.filter(c => 
    c.phone.includes(searchTerm) || 
    (c.name && c.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (c.email && c.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const stats = {
    totalCustomers: customers.length,
    totalPurchases: purchases.length,
    rewardsReached: customers.filter(c => c.couponsCount >= (business?.couponsNeeded || 10)).length,
    avgPurchases: customers.length ? (purchases.length / customers.length).toFixed(1) : 0,
  };

  const chartData = purchases.reduce((acc: any[], p) => {
    const date = format(new Date(p.timestamp), "dd MMM", { locale: es });
    const existing = acc.find(a => a.date === date);
    if (existing) existing.count++;
    else acc.push({ date, count: 1 });
    return acc;
  }, []).reverse().slice(-7);

  const pieData = [
    { name: "En Progreso", value: customers.length - stats.rewardsReached },
    { name: "Premio Alcanzado", value: stats.rewardsReached },
  ];

  const COLORS = ["#f97316", "#22c55e"];

  return (
    <div className={cn(
      "min-h-screen flex transition-colors duration-300",
      business?.darkModeEnabled ? "bg-slate-950 text-white" : "bg-gray-50 text-gray-900"
    )}>
      {/* Sidebar */}
      <aside className={cn(
        "w-64 border-r hidden md:flex flex-col transition-colors duration-300",
        business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-200"
      )}>
          <div className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 bg-orange-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-orange-200 overflow-hidden">
                {business?.logoUrl ? (
                  <img src={business.logoUrl} alt="Logo" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <CheckCircle2 className="h-6 w-6" />
                )}
              </div>
              <div>
                <h1 className={cn("text-lg font-bold tracking-tight leading-tight", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{business?.name || "Fideliza"}</h1>
                {business?.slogan && <p className="text-[9px] text-gray-400 uppercase font-bold tracking-widest truncate w-32">{business.slogan}</p>}
              </div>
            </div>
          </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          <button
            onClick={() => setActiveTab("overview")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "overview" ? "bg-orange-50 text-orange-600" : (business?.darkModeEnabled ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-50")
            )}
          >
            <TrendingUp className="h-5 w-5" />
            <span className="font-medium">Resumen</span>
          </button>
          <button
            onClick={() => setActiveTab("config")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "config" ? "bg-orange-50 text-orange-600" : (business?.darkModeEnabled ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-50")
            )}
          >
            <Settings className="h-5 w-5" />
            <span className="font-medium">Negocio</span>
          </button>
          <button
            onClick={() => setActiveTab("rewards")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "rewards" ? "bg-orange-50 text-orange-600" : (business?.darkModeEnabled ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-50")
            )}
          >
            <Gift className="h-5 w-5" />
            <span className="font-medium">Recompensas</span>
          </button>
          <button
            onClick={() => setActiveTab("customers")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "customers" ? "bg-orange-50 text-orange-600" : (business?.darkModeEnabled ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-50")
            )}
          >
            <Users className="h-5 w-5" />
            <span className="font-medium">Clientes</span>
          </button>
          <button
            onClick={() => setActiveTab("qr")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "qr" ? "bg-orange-50 text-orange-600" : (business?.darkModeEnabled ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-50")
            )}
          >
            <QrCode className="h-5 w-5" />
            <span className="font-medium">Gestión QR</span>
          </button>
          <button
            onClick={() => setActiveTab("stats")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "stats" ? "bg-orange-50 text-orange-600" : (business?.darkModeEnabled ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-50")
            )}
          >
            <BarChart3 className="h-5 w-5" />
            <span className="font-medium">Estadísticas</span>
          </button>
          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Comunicaciones</p>
          </div>
          <button
            onClick={() => setActiveTab("billing")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "billing" ? "bg-orange-50 text-orange-600" : (business?.darkModeEnabled ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-50")
            )}
          >
            <CreditCard className="h-5 w-5" />
            <span className="font-medium">Cobranzas</span>
          </button>
          <button
            onClick={() => setActiveTab("marketing")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "marketing" ? "bg-orange-50 text-orange-600" : (business?.darkModeEnabled ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-50")
            )}
          >
            <Megaphone className="h-5 w-5" />
            <span className="font-medium">Marketing</span>
          </button>
          <button
            onClick={() => setActiveTab("staff")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "staff" ? "bg-orange-50 text-orange-600" : (business?.darkModeEnabled ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-50")
            )}
          >
            <Users className="h-5 w-5" />
            <span className="font-medium">Equipo</span>
          </button>
        </nav>

        <div className="p-4 border-t border-gray-100">
          <button
            onClick={() => {
              const newMode = !business?.darkModeEnabled;
              setBusiness(business ? { ...business, darkModeEnabled: newMode } : null);
            }}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-gray-500 hover:bg-gray-50 transition-all mb-2"
          >
            {business?.darkModeEnabled ? <Sun className="h-5 w-5 text-yellow-500" /> : <Moon className="h-5 w-5" />}
            <span className="font-medium">{business?.darkModeEnabled ? "Modo Claro" : "Modo Oscuro"}</span>
          </button>
          <button
            onClick={() => auth.signOut()}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 transition-all"
          >
            <LogOut className="h-5 w-5" />
            <span className="font-medium">Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile Header */}
        <header className="md:hidden bg-white border-b border-gray-200 p-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="h-6 w-6 text-orange-600" />
            <span className="text-lg font-bold">Fideliza</span>
          </div>
          <div className="flex space-x-2">
             <button onClick={() => setActiveTab("overview")} className={cn("p-2 rounded-lg", activeTab === "overview" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><TrendingUp className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("config")} className={cn("p-2 rounded-lg", activeTab === "config" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><Settings className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("customers")} className={cn("p-2 rounded-lg", activeTab === "customers" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><Users className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("qr")} className={cn("p-2 rounded-lg", activeTab === "qr" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><QrCode className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("stats")} className={cn("p-2 rounded-lg", activeTab === "stats" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><BarChart3 className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("billing")} className={cn("p-2 rounded-lg", activeTab === "billing" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><CreditCard className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("marketing")} className={cn("p-2 rounded-lg", activeTab === "marketing" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><Megaphone className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("staff")} className={cn("p-2 rounded-lg", activeTab === "staff" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><Users className="h-5 w-5" /></button>
             <button onClick={() => auth.signOut()} className="p-2 rounded-lg text-red-400"><LogOut className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="p-6 md:p-10 max-w-6xl mx-auto">
          {/* Overview / Dashboard Tab */}
          {activeTab === "overview" && business && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>¡Hola, {business.name}!</h1>
                  <p className={cn("mt-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Aquí tienes un resumen de lo que está pasando hoy.</p>
                </div>
                <div className="hidden md:block">
                  <p className={cn("text-sm font-medium", business?.darkModeEnabled ? "text-slate-500" : "text-gray-400")}>
                    {format(new Date(), "EEEE, d 'de' MMMM", { locale: es })}
                  </p>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className={cn(
                  "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-blue-50 rounded-2xl text-blue-600"><Users className="h-6 w-6" /></div>
                  </div>
                  <p className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{stats.totalCustomers}</p>
                  <p className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Clientes Totales</p>
                </div>
                <div className={cn(
                  "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-orange-50 rounded-2xl text-orange-600"><TrendingUp className="h-6 w-6" /></div>
                  </div>
                  <p className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{stats.totalPurchases}</p>
                  <p className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Ventas Registradas</p>
                </div>
                <div className={cn(
                  "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-green-50 rounded-2xl text-green-600"><Gift className="h-6 w-6" /></div>
                  </div>
                  <p className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{stats.rewardsReached}</p>
                  <p className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Premios por Entregar</p>
                </div>
                <div className={cn(
                  "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-purple-50 rounded-2xl text-purple-600"><CreditCard className="h-6 w-6" /></div>
                  </div>
                  <p className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                    {business.currency || "$"} {purchases.reduce((sum, p) => sum + (p.amount || 0), 0).toLocaleString()}
                  </p>
                  <p className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Recaudación Total</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Recent Activity */}
                <div className={cn(
                  "lg:col-span-2 p-8 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className={cn("text-xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Actividad Reciente</h2>
                    <button onClick={() => setActiveTab("billing")} className="text-sm text-orange-600 font-bold hover:underline">Ver todo</button>
                  </div>
                  <div className="space-y-4">
                    {purchases.slice(0, 5).map((purchase) => {
                      const customer = customers.find(c => c.id === purchase.customerId);
                      return (
                        <div key={purchase.id} className={cn(
                          "flex items-center justify-between p-4 rounded-2xl border transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800/50 border-slate-800" : "bg-gray-50 border-gray-100"
                        )}>
                          <div className="flex items-center space-x-4">
                            <div className="h-10 w-10 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold">
                              {(customer?.name || customer?.phone || "?")[0].toUpperCase()}
                            </div>
                            <div>
                              <p className={cn("font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                                {customer?.name || customer?.phone}
                              </p>
                              <p className="text-xs text-gray-500">{format(new Date(purchase.timestamp), "d 'de' MMM, HH:mm", { locale: es })}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-orange-600">+{business.currency || "$"} {purchase.amount?.toLocaleString()}</p>
                            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">{purchase.paymentMethod}</p>
                          </div>
                        </div>
                      );
                    })}
                    {purchases.length === 0 && (
                      <div className="text-center py-10 text-gray-400">
                        <History className="h-10 w-10 mx-auto mb-2 opacity-20" />
                        <p>No hay actividad registrada aún.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Actions & Reminders */}
                <div className="space-y-8">
                  <div className={cn(
                    "p-8 rounded-3xl border shadow-sm transition-colors duration-300",
                    business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                  )}>
                    <h2 className={cn("text-xl font-bold mb-6", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Acciones Rápidas</h2>
                    <div className="grid grid-cols-1 gap-3">
                      <button 
                        onClick={() => setActiveTab("qr")}
                        className="flex items-center space-x-3 p-4 rounded-2xl bg-orange-600 text-white font-bold hover:bg-orange-700 transition-all"
                      >
                        <QrCode className="h-5 w-5" />
                        <span>Escanear / Ver QR</span>
                      </button>
                      <button 
                        onClick={() => setActiveTab("customers")}
                        className={cn(
                          "flex items-center space-x-3 p-4 rounded-2xl border font-bold transition-all",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white hover:bg-slate-700" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                        )}
                      >
                        <UserPlus className="h-5 w-5" />
                        <span>Nuevo Cliente</span>
                      </button>
                      <button 
                        onClick={() => setActiveTab("marketing")}
                        className={cn(
                          "flex items-center space-x-3 p-4 rounded-2xl border font-bold transition-all",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white hover:bg-slate-700" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                        )}
                      >
                        <Megaphone className="h-5 w-5" />
                        <span>Crear Campaña</span>
                      </button>
                    </div>
                  </div>

                  <div className={cn(
                    "p-8 rounded-3xl border shadow-sm transition-colors duration-300",
                    business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                  )}>
                    <h2 className={cn("text-xl font-bold mb-6", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Próximos Envíos</h2>
                    <div className="space-y-4">
                      {reminders.filter(r => r.status === 'pending').slice(0, 3).map(reminder => (
                        <div key={reminder.id} className="flex items-start space-x-3">
                          <div className="mt-1 h-2 w-2 rounded-full bg-orange-500 animate-pulse"></div>
                          <div>
                            <p className={cn("text-sm font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{reminder.subject}</p>
                            <p className="text-xs text-gray-500">{format(new Date(reminder.scheduledAt), "d 'de' MMM, HH:mm", { locale: es })}</p>
                          </div>
                        </div>
                      ))}
                      {reminders.filter(r => r.status === 'pending').length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-4 italic">No hay envíos programados.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Configuration Tab */}
          {activeTab === "config" && business && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Perfil del Negocio</h1>
                  <p className={cn("mt-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Configura la identidad de tu marca.</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={handleTestConnection}
                    disabled={saving}
                    className="flex items-center space-x-2 bg-slate-100 text-slate-600 px-6 py-3 rounded-2xl font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
                  >
                    <Clock className="h-5 w-5" />
                    <span>Probar Conexión</span>
                  </button>
                  <button
                    onClick={handleSaveConfig}
                    disabled={saving}
                    className="flex items-center space-x-2 bg-orange-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-orange-700 transition-all disabled:opacity-50"
                  >
                    {saving ? <div className="animate-spin h-5 w-5 border-b-2 border-white rounded-full"></div> : <><Save className="h-5 w-5" /><span>Guardar Cambios</span></>}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className={cn(
                  "p-8 rounded-3xl shadow-sm border space-y-6 transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <h2 className={cn("text-xl font-bold flex items-center space-x-2", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                    <Settings className="h-5 w-5 text-orange-600" />
                    <span>Información General</span>
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Nombre del Negocio</label>
                      <input
                        type="text"
                        value={business.name}
                        onChange={e => setBusiness({ ...business, name: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border focus:ring-orange-500 focus:border-orange-500 transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                        placeholder="Ej: Café Central"
                      />
                    </div>
                    <div>
                      <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Eslogan / Frase corta</label>
                      <input
                        type="text"
                        value={business.slogan || ""}
                        onChange={e => setBusiness({ ...business, slogan: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border focus:ring-orange-500 focus:border-orange-500 transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                        placeholder="Ej: El mejor café de la ciudad"
                      />
                    </div>
                    <div>
                      <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Descripción del Negocio</label>
                      <textarea
                        value={business.description || ""}
                        onChange={e => setBusiness({ ...business, description: e.target.value })}
                        rows={3}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border focus:ring-orange-500 focus:border-orange-500 transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                        placeholder="Cuéntale a tus clientes sobre tu negocio..."
                      />
                    </div>
                    <div>
                      <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>URL del Logo</label>
                      <input
                        type="text"
                        value={business.logoUrl || ""}
                        onChange={e => setBusiness({ ...business, logoUrl: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border focus:ring-orange-500 focus:border-orange-500 transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                        placeholder="https://ejemplo.com/logo.png"
                      />
                    </div>
                    <div>
                      <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Moneda</label>
                      <input
                        type="text"
                        value={business.currency || "USD"}
                        onChange={e => setBusiness({ ...business, currency: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border focus:ring-orange-500 focus:border-orange-500 transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                        placeholder="USD, ARS, EUR..."
                      />
                    </div>
                  </div>
                </div>

                <div className={cn(
                  "p-8 rounded-3xl shadow-sm border space-y-6 transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <h2 className={cn("text-xl font-bold flex items-center space-x-2", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                    <Bell className="h-5 w-5 text-orange-600" />
                    <span>Notificaciones y Contacto</span>
                  </h2>
                  <div className="space-y-4">
                    <div className={cn(
                      "flex items-center justify-between p-4 rounded-2xl transition-colors duration-300",
                      business?.darkModeEnabled ? "bg-slate-800" : "bg-gray-50"
                    )}>
                      <div>
                        <p className={cn("font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Notificaciones de Actividad</p>
                        <p className={cn("text-xs", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Alertas por nuevos sellos y premios.</p>
                      </div>
                      <button
                        onClick={() => setBusiness({ ...business, notificationsEnabled: !business.notificationsEnabled })}
                        className={cn(
                          "w-12 h-6 rounded-full transition-all relative",
                          business.notificationsEnabled ? "bg-orange-600" : "bg-gray-300"
                        )}
                      >
                        <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", business.notificationsEnabled ? "right-1" : "left-1")}></div>
                      </button>
                    </div>
                    <div>
                      <label className={cn("block text-sm font-medium mb-1 flex items-center space-x-2", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>
                        <Mail className="h-4 w-4" />
                        <span>Email de Administrador</span>
                      </label>
                      <input
                        type="email"
                        value={business.ownerEmail}
                        onChange={e => setBusiness({ ...business, ownerEmail: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border focus:ring-orange-500 focus:border-orange-500 transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                      />
                    </div>
                    <div>
                      <label className={cn("block text-sm font-medium mb-1 flex items-center space-x-2", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>
                        <Mail className="h-4 w-4" />
                        <span>Gmail para Envíos (Opcional)</span>
                      </label>
                      <input
                        type="email"
                        value={business.gmailUser || ""}
                        onChange={e => setBusiness({ ...business, gmailUser: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border focus:ring-orange-500 focus:border-orange-500 transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                        placeholder="tu-email@gmail.com"
                      />
                    </div>
                    <div>
                      <label className={cn("block text-sm font-medium mb-1 flex items-center space-x-2", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>
                        <Settings className="h-4 w-4" />
                        <span>Contraseña de Aplicación Gmail</span>
                      </label>
                      <input
                        type="password"
                        value={business.gmailAppPass || ""}
                        onChange={e => setBusiness({ ...business, gmailAppPass: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border focus:ring-orange-500 focus:border-orange-500 transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                        placeholder="Contraseña de 16 caracteres"
                      />
                      <p className="text-[10px] text-gray-400 mt-1">
                        * Necesitas generar una "Contraseña de aplicación" en tu cuenta de Google.
                      </p>
                    </div>
                    <div>
                      <label className={cn("block text-sm font-medium mb-1 flex items-center space-x-2", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>
                        <Send className="h-4 w-4" />
                        <span>Telegram Chat ID</span>
                      </label>
                      <input
                        type="text"
                        value={business.telegramChatId}
                        onChange={e => setBusiness({ ...business, telegramChatId: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border focus:ring-orange-500 focus:border-orange-500 transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                        placeholder="ID de chat para alertas"
                      />
                    </div>
                    <div>
                      <label className={cn("block text-sm font-medium mb-1 flex items-center space-x-2", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>
                        <Bell className="h-4 w-4" />
                        <span>Telegram Bot Token</span>
                      </label>
                      <input
                        type="password"
                        value={business.telegramToken || ""}
                        onChange={e => setBusiness({ ...business, telegramToken: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border focus:ring-orange-500 focus:border-orange-500 transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                        placeholder="Token de tu Bot de Telegram"
                      />
                    </div>

                    <div className={cn(
                      "flex items-center justify-between p-4 rounded-2xl transition-colors duration-300",
                      business?.darkModeEnabled ? "bg-slate-800" : "bg-gray-50"
                    )}>
                      <div>
                        <p className={cn("font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>WhatsApp (CallMeBot)</p>
                        <p className={cn("text-xs", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Recibe alertas vía WhatsApp.</p>
                      </div>
                      <button
                        onClick={() => setBusiness({ ...business, whatsappEnabled: !business.whatsappEnabled })}
                        className={cn(
                          "w-12 h-6 rounded-full transition-all relative",
                          business.whatsappEnabled ? "bg-green-500" : "bg-gray-300"
                        )}
                      >
                        <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", business.whatsappEnabled ? "right-1" : "left-1")}></div>
                      </button>
                    </div>

                    {business.whatsappEnabled && (
                      <div className="space-y-4 pt-2">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Número de WhatsApp</label>
                          <input
                            type="text"
                            value={business.whatsappPhone || ""}
                            onChange={e => setBusiness({ ...business, whatsappPhone: e.target.value })}
                            className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500"
                            placeholder="+34600000000"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">API Key de CallMeBot</label>
                          <input
                            type="text"
                            value={business.whatsappApiKey || ""}
                            onChange={e => setBusiness({ ...business, whatsappApiKey: e.target.value })}
                            className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500"
                            placeholder="Tu API Key"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className={cn(
                  "p-8 rounded-3xl shadow-sm border space-y-6 md:col-span-2 transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <h2 className={cn("text-xl font-bold flex items-center space-x-2", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                    <TrendingUp className="h-5 w-5 text-orange-600" />
                    <span>Niveles de Fidelidad (Gamificación)</span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className={cn(
                      "p-6 rounded-2xl space-y-4 border transition-colors duration-300",
                      business?.darkModeEnabled ? "bg-slate-800 border-slate-700" : "bg-gray-50 border-gray-100"
                    )}>
                      <div className={cn("flex items-center space-x-2", business?.darkModeEnabled ? "text-slate-400" : "text-gray-400")}>
                        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs", business?.darkModeEnabled ? "bg-slate-700" : "bg-gray-200")}>B</div>
                        <span className="font-bold">Nivel Bronce (Base)</span>
                      </div>
                      <p className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Nivel inicial para todos los clientes nuevos.</p>
                    </div>
                    
                    <div className={cn(
                      "p-6 rounded-2xl space-y-4 border transition-colors duration-300",
                      business?.darkModeEnabled ? "bg-orange-950/20 border-orange-900/30" : "bg-orange-50 border-orange-100"
                    )}>
                      <div className="flex items-center space-x-2 text-orange-600">
                        <div className="w-8 h-8 rounded-full bg-orange-200 flex items-center justify-center font-bold text-xs">S</div>
                        <span className="font-bold">Nivel Plata</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className={cn("block text-xs font-medium mb-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Gasto Mínimo ({business.currency})</label>
                          <input
                            type="number"
                            value={business.levels?.silver.minSpent || 500}
                            onChange={e => setBusiness({ 
                              ...business, 
                              levels: { 
                                silver: { minSpent: parseFloat(e.target.value), multiplier: business.levels?.silver.multiplier || 1.5 },
                                gold: business.levels?.gold || { minSpent: 1500, multiplier: 2 }
                              } 
                            })}
                            className={cn(
                              "w-full px-3 py-2 rounded-lg border text-sm transition-colors duration-300",
                              business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                            )}
                          />
                        </div>
                        <div>
                          <label className={cn("block text-xs font-medium mb-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Multiplicador Sellos</label>
                          <input
                            type="number"
                            step="0.1"
                            value={business.levels?.silver.multiplier || 1.5}
                            onChange={e => setBusiness({ 
                              ...business, 
                              levels: { 
                                silver: { minSpent: business.levels?.silver.minSpent || 500, multiplier: parseFloat(e.target.value) },
                                gold: business.levels?.gold || { minSpent: 1500, multiplier: 2 }
                              } 
                            })}
                            className={cn(
                              "w-full px-3 py-2 rounded-lg border text-sm transition-colors duration-300",
                              business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                            )}
                          />
                        </div>
                      </div>
                    </div>

                    <div className={cn(
                      "p-6 rounded-2xl space-y-4 border transition-colors duration-300",
                      business?.darkModeEnabled ? "bg-yellow-950/20 border-yellow-900/30" : "bg-yellow-50 border-yellow-100"
                    )}>
                      <div className="flex items-center space-x-2 text-yellow-600">
                        <div className="w-8 h-8 rounded-full bg-yellow-200 flex items-center justify-center font-bold text-xs">G</div>
                        <span className="font-bold">Nivel Oro</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className={cn("block text-xs font-medium mb-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Gasto Mínimo ({business.currency})</label>
                          <input
                            type="number"
                            value={business.levels?.gold.minSpent || 1500}
                            onChange={e => setBusiness({ 
                              ...business, 
                              levels: { 
                                silver: business.levels?.silver || { minSpent: 500, multiplier: 1.5 },
                                gold: { minSpent: parseFloat(e.target.value), multiplier: business.levels?.gold.multiplier || 2 }
                              } 
                            })}
                            className={cn(
                              "w-full px-3 py-2 rounded-lg border text-sm transition-colors duration-300",
                              business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                            )}
                          />
                        </div>
                        <div>
                          <label className={cn("block text-xs font-medium mb-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Multiplicador Sellos</label>
                          <input
                            type="number"
                            step="0.1"
                            value={business.levels?.gold.multiplier || 2}
                            onChange={e => setBusiness({ 
                              ...business, 
                              levels: { 
                                silver: business.levels?.silver || { minSpent: 500, multiplier: 1.5 },
                                gold: { minSpent: business.levels?.gold.minSpent || 1500, multiplier: parseFloat(e.target.value) }
                              } 
                            })}
                            className={cn(
                              "w-full px-3 py-2 rounded-lg border text-sm transition-colors duration-300",
                              business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={cn(
                  "p-8 rounded-3xl shadow-sm border space-y-6 md:col-span-2 transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <h2 className={cn("text-xl font-bold flex items-center space-x-2", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                    <Palette className="h-5 w-5 text-orange-600" />
                    <span>Apariencia y Estilo</span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <label className={cn("block text-sm font-medium", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Color de Marca Principal</label>
                      <div className="flex items-center space-x-4">
                        <input 
                          type="color" 
                          value={business.themeColor || "#ea580c"}
                          onChange={(e) => setBusiness({ ...business, themeColor: e.target.value })}
                          className={cn(
                            "h-12 w-20 rounded-lg cursor-pointer border-2 transition-colors duration-300",
                            business?.darkModeEnabled ? "border-slate-700" : "border-gray-100"
                          )}
                        />
                        <div className="flex-1">
                          <input 
                            type="text" 
                            value={business.themeColor || "#ea580c"}
                            onChange={(e) => setBusiness({ ...business, themeColor: e.target.value })}
                            className={cn(
                              "w-full px-4 py-2 rounded-xl border font-mono text-sm transition-colors duration-300",
                              business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                            )}
                          />
                        </div>
                      </div>
                      <p className={cn("text-xs", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Este color se aplicará a los botones y elementos destacados en el panel público.</p>
                    </div>

                    <div className={cn(
                      "flex items-center justify-between p-6 rounded-2xl border transition-colors duration-300",
                      business?.darkModeEnabled ? "bg-slate-800 border-slate-700" : "bg-gray-50 border-gray-100"
                    )}>
                      <div className="flex items-center space-x-3">
                        <div className={cn(
                          "p-3 rounded-xl",
                          business.darkModeEnabled ? "bg-gray-800 text-yellow-400" : "bg-white text-gray-400 shadow-sm"
                        )}>
                          {business.darkModeEnabled ? <Moon className="h-6 w-6" /> : <Sun className="h-6 w-6" />}
                        </div>
                        <div>
                          <p className={cn("font-bold", business.darkModeEnabled ? "text-white" : "text-gray-900")}>Modo Nocturno por Defecto</p>
                          <p className="text-xs text-gray-500">Activa el tema oscuro para tus clientes.</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setBusiness({ ...business, darkModeEnabled: !business.darkModeEnabled })}
                        className={cn(
                          "w-14 h-7 rounded-full transition-all relative",
                          business.darkModeEnabled ? "bg-orange-600" : "bg-gray-300"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-5 h-5 bg-white rounded-full transition-all shadow-sm",
                          business.darkModeEnabled ? "right-1" : "left-1"
                        )}></div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Rewards Tab */}
          {activeTab === "rewards" && business && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Configuración de Recompensas</h1>
                  <p className={cn("mt-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Define qué ganan tus clientes y cómo.</p>
                </div>
                <button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="flex items-center space-x-2 bg-orange-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-orange-700 transition-all disabled:opacity-50"
                >
                  {saving ? <div className="animate-spin h-5 w-5 border-b-2 border-white rounded-full"></div> : <><Save className="h-5 w-5" /><span>Guardar Cambios</span></>}
                </button>
              </div>

              <div className={cn(
                "p-8 rounded-3xl shadow-sm border max-w-2xl transition-colors duration-300",
                business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
              )}>
                <div className="space-y-6">
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Título del Premio</label>
                    <input
                      type="text"
                      value={business.rewardDescription}
                      onChange={e => setBusiness({ ...business, rewardDescription: e.target.value })}
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                      placeholder="Ej: Café Gratis"
                    />
                  </div>
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Descripción del Negocio</label>
                    <textarea
                      value={business.description || ""}
                      onChange={e => setBusiness({ ...business, description: e.target.value })}
                      rows={2}
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                      placeholder="Breve descripción de tu negocio..."
                    />
                  </div>
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Descripción Detallada del Premio</label>
                    <textarea
                      value={business.rewardLongDescription || ""}
                      onChange={e => setBusiness({ ...business, rewardLongDescription: e.target.value })}
                      rows={3}
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                      placeholder="Explica detalladamente en qué consiste el premio..."
                    />
                  </div>
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>URL de la Imagen del Premio</label>
                    <input
                      type="text"
                      value={business.rewardImageUrl || ""}
                      onChange={e => setBusiness({ ...business, rewardImageUrl: e.target.value })}
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                      placeholder="https://ejemplo.com/premio.jpg"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Sellos Necesarios</label>
                      <input
                        type="number"
                        value={business.couponsNeeded}
                        onChange={e => setBusiness({ ...business, couponsNeeded: parseInt(e.target.value) })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                      />
                    </div>
                    <div>
                      <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Tiempo de Espera (Horas)</label>
                      <input
                        type="number"
                        value={business.cooldownHours}
                        onChange={e => setBusiness({ ...business, cooldownHours: parseInt(e.target.value) })}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Customers Tab */}
          {activeTab === "customers" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Clientes</h1>
                  <p className={cn("mt-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Gestiona tu base de clientes y su progreso.</p>
                </div>
                <div className="flex space-x-2">
                  <button onClick={() => exportToCSV(customers, "clientes")} className={cn(
                    "flex items-center space-x-2 border px-4 py-2 rounded-xl transition-all font-medium",
                    business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                  )}><Download className="h-4 w-4" /><span>CSV</span></button>
                  <button onClick={() => setIsAddingCustomer(true)} className="flex items-center space-x-2 bg-orange-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-orange-700 transition-all"><Plus className="h-4 w-4" /><span>Añadir Cliente</span></button>
                </div>
              </div>

              <div className={cn(
                "rounded-3xl shadow-sm border overflow-hidden transition-colors duration-300",
                business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
              )}>
                <div className={cn("p-6 border-b transition-colors duration-300", business?.darkModeEnabled ? "bg-slate-800/50 border-slate-800" : "bg-gray-50/50 border-gray-100")}>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Buscar por nombre, teléfono o email..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className={cn(
                        "w-full pl-12 pr-4 py-3 rounded-2xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className={cn(
                        "text-xs uppercase tracking-wider font-bold transition-colors duration-300",
                        business?.darkModeEnabled ? "bg-slate-800 text-slate-500" : "bg-gray-50 text-gray-500"
                      )}>
                        <th className="px-6 py-4">Cliente</th>
                        <th className="px-6 py-4">Progreso</th>
                        <th className="px-6 py-4">Último Sello</th>
                        <th className="px-6 py-4 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className={cn("divide-y transition-colors duration-300", business?.darkModeEnabled ? "divide-slate-800" : "divide-gray-100")}>
                      {filteredCustomers.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center">
                            <div className="flex flex-col items-center justify-center text-gray-400">
                              <Search className="h-10 w-10 mb-2 opacity-20" />
                              <p className="font-medium">No se encontraron clientes</p>
                              {searchTerm && (
                                <button 
                                  onClick={() => setSearchTerm("")}
                                  className="mt-2 text-sm text-orange-600 hover:underline"
                                >
                                  Limpiar búsqueda
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredCustomers.map(c => (
                          <tr key={c.id} className={cn("transition-all", business?.darkModeEnabled ? "hover:bg-slate-800/50" : "hover:bg-gray-50/50")}>
                            <td className="px-6 py-4">
                              <div className="flex items-center space-x-3">
                                <div className={cn(
                                  "h-10 w-10 rounded-full flex items-center justify-center font-bold text-xs",
                                  c.level === 'gold' ? "bg-yellow-100 text-yellow-600" :
                                  c.level === 'silver' ? "bg-gray-100 text-gray-600" :
                                  "bg-orange-100 text-orange-600"
                                )}>
                                  {c.level === 'gold' ? 'G' : c.level === 'silver' ? 'S' : 'B'}
                                </div>
                                <div>
                                  <p className={cn("font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{c.name || "Cliente sin nombre"}</p>
                                  <p className="text-xs text-gray-500">{c.phone}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center space-x-2">
                                <div className={cn("flex-1 h-2 rounded-full overflow-hidden", business?.darkModeEnabled ? "bg-slate-800" : "bg-gray-100")}>
                                  <div className="h-full bg-orange-500" style={{ width: `${(c.couponsCount / (business?.couponsNeeded || 10)) * 100}%` }}></div>
                                </div>
                                <span className={cn("text-sm font-bold", business?.darkModeEnabled ? "text-slate-400" : "text-gray-700")}>{c.couponsCount}/{business?.couponsNeeded}</span>
                              </div>
                            </td>
                            <td className={cn("px-6 py-4 text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>
                              {c.lastPurchaseAt ? format(new Date(c.lastPurchaseAt), "dd MMM, HH:mm", { locale: es }) : "Nunca"}
                            </td>
                            <td className="px-6 py-4 text-right space-x-2">
                              <button onClick={() => setIsAddingPurchase(c.id)} className={cn("p-2 transition-all", business?.darkModeEnabled ? "text-slate-400 hover:text-green-400" : "text-gray-400 hover:text-green-600")} title="Registrar Venta/Sello"><PlusCircle className="h-5 w-5" /></button>
                              <button onClick={() => fetchCustomerHistory(c.id)} className={cn("p-2 transition-all", business?.darkModeEnabled ? "text-slate-400 hover:text-blue-400" : "text-gray-400 hover:text-blue-600")}><History className="h-5 w-5" /></button>
                              <button onClick={() => setIsEditingCustomer(c)} className={cn("p-2 transition-all", business?.darkModeEnabled ? "text-slate-400 hover:text-orange-400" : "text-gray-400 hover:text-orange-600")}><Edit2 className="h-5 w-5" /></button>
                              <button onClick={() => handleDeleteCustomer(c.id)} className={cn("p-2 transition-all", business?.darkModeEnabled ? "text-slate-400 hover:text-red-400" : "text-gray-400 hover:text-red-600")}><Trash2 className="h-5 w-5" /></button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* QR Tab */}
          {activeTab === "qr" && business && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center space-y-8">
              <div className="text-center">
                <h1 className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Código QR</h1>
                <p className={cn("mt-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Imprime este código QR para que tus clientes lo escaneen.</p>
              </div>

              <div className={cn(
                "p-12 rounded-[3rem] shadow-2xl border flex flex-col items-center space-y-8 transition-colors duration-300",
                business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
              )}>
                <div ref={qrRef} className="p-6 bg-white rounded-3xl border-4 border-orange-500 shadow-inner">
                  <QRCodeSVG 
                    value={`${window.location.origin}/negocio/${business.id}`} 
                    size={256}
                    level="H"
                    includeMargin={true}
                  />
                </div>
                <div className="text-center">
                  <p className={cn("text-lg font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{business.name}</p>
                  <p className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>¡Escanea para obtener recompensas!</p>
                </div>
                <button
                  onClick={downloadQR}
                  className="flex items-center space-x-2 bg-orange-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200"
                >
                  <Download className="h-6 w-6" />
                  <span>Descargar Código QR</span>
                </button>
              </div>

              <div className={cn("max-w-md text-center text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>
                <p>Consejo: Coloca este código QR cerca de tu caja registradora o en las mesas donde los clientes puedan verlo fácilmente.</p>
              </div>
            </motion.div>
          )}

          {/* Stats Tab */}
          {activeTab === "stats" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <h1 className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Estadísticas</h1>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className={cn(
                  "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-blue-50 rounded-2xl text-blue-600"><Users className="h-6 w-6" /></div>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">Total</span>
                  </div>
                  <p className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{stats.totalCustomers}</p>
                  <p className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Clientes</p>
                </div>
                <div className={cn(
                  "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-orange-50 rounded-2xl text-orange-600"><TrendingUp className="h-6 w-6" /></div>
                    <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-lg">+12%</span>
                  </div>
                  <p className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{stats.totalPurchases}</p>
                  <p className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Sellos Totales</p>
                </div>
                <div className={cn(
                  "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-green-50 rounded-2xl text-green-600"><Gift className="h-6 w-6" /></div>
                    <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-lg">Listos</span>
                  </div>
                  <p className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{stats.rewardsReached}</p>
                  <p className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Premios Alcanzados</p>
                </div>
                <div className={cn(
                  "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-purple-50 rounded-2xl text-purple-600"><TrendingUp className="h-6 w-6" /></div>
                    <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded-lg">Prom</span>
                  </div>
                  <p className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{stats.avgPurchases}</p>
                  <p className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Sellos por Cliente</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className={cn(
                  "p-8 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <h2 className={cn("text-xl font-bold mb-6", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Actividad de Sellos (Últimos 7 Días)</h2>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={business?.darkModeEnabled ? "#334155" : "#e2e8f0"} />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: business?.darkModeEnabled ? "#94a3b8" : "#64748b" }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: business?.darkModeEnabled ? "#94a3b8" : "#64748b" }} />
                        <Tooltip 
                          contentStyle={{ 
                            borderRadius: '16px', 
                            border: 'none', 
                            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                            backgroundColor: business?.darkModeEnabled ? '#1e293b' : '#ffffff',
                            color: business?.darkModeEnabled ? '#ffffff' : '#000000'
                          }} 
                        />
                        <Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className={cn(
                  "p-8 rounded-3xl border shadow-sm transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <h2 className={cn("text-xl font-bold mb-6", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Progreso de Clientes</h2>
                  <div className="h-64 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ 
                            borderRadius: '16px', 
                            border: 'none', 
                            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                            backgroundColor: business?.darkModeEnabled ? '#1e293b' : '#ffffff',
                            color: business?.darkModeEnabled ? '#ffffff' : '#000000'
                          }} 
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-col space-y-2 ml-4">
                      {pieData.map((entry, index) => (
                        <div key={entry.name} className="flex items-center space-x-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index] }}></div>
                          <span className={cn("text-xs", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>{entry.name}: {entry.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Billing Tab */}
          {activeTab === "billing" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Cobranzas</h1>
                  <p className={cn("mt-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Historial de ventas y cobros realizados.</p>
                </div>
                <div className={cn(
                  "p-4 rounded-2xl border shadow-sm flex items-center space-x-4 transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase font-bold">Total Recaudado</p>
                    <p className="text-2xl font-bold text-orange-600">{business?.currency || "$"} {purchases.reduce((sum, p) => sum + (p.amount || 0), 0).toLocaleString()}</p>
                  </div>
                  <button 
                    onClick={() => exportToCSV(purchases, "cobranzas")}
                    className="p-3 bg-orange-50 rounded-xl text-orange-600 hover:bg-orange-100 transition-all"
                    title="Exportar CSV"
                  >
                    <Download className="h-6 w-6" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className={cn(
                  "md:col-span-2 rounded-3xl shadow-sm border overflow-hidden transition-colors duration-300",
                  business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                )}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className={cn(
                          "text-xs uppercase tracking-wider font-bold transition-colors duration-300",
                          business?.darkModeEnabled ? "bg-slate-800 text-slate-400" : "bg-gray-50 text-gray-500"
                        )}>
                          <th className="px-6 py-4">Fecha</th>
                          <th className="px-6 py-4">Cliente</th>
                          <th className="px-6 py-4">Monto</th>
                          <th className="px-6 py-4">Método</th>
                          <th className="px-6 py-4">Notas</th>
                          <th className="px-6 py-4 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className={cn(
                        "divide-y transition-colors duration-300",
                        business?.darkModeEnabled ? "divide-slate-800" : "divide-gray-100"
                      )}>
                        {purchases.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-gray-400">No hay registros de cobranzas aún.</td>
                          </tr>
                        ) : (
                          purchases.map(p => {
                            const cust = customers.find(c => c.id === p.customerId);
                            return (
                              <tr key={p.id} className={cn(
                                "transition-all",
                                business?.darkModeEnabled ? "hover:bg-slate-800/50" : "hover:bg-gray-50/50"
                              )}>
                                <td className={cn("px-6 py-4 text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-600")}>
                                  {format(new Date(p.timestamp), "dd/MM/yyyy HH:mm")}
                                </td>
                                <td className="px-6 py-4">
                                  <p className={cn("font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{cust?.name || "Cliente"}</p>
                                  <p className="text-xs text-gray-500">{p.customerId}</p>
                                </td>
                                <td className={cn("px-6 py-4 font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                                  {business?.currency || "$"} {p.amount?.toLocaleString() || "0"}
                                </td>
                                <td className="px-6 py-4">
                                  <span className={cn(
                                    "px-3 py-1 rounded-full text-xs font-medium transition-colors duration-300",
                                    business?.darkModeEnabled ? "bg-slate-800 text-slate-300" : "bg-gray-100 text-gray-600"
                                  )}>
                                    {p.paymentMethod || "N/A"}
                                  </span>
                                </td>
                                <td className={cn("px-6 py-4 text-sm italic", business?.darkModeEnabled ? "text-slate-500" : "text-gray-500")}>
                                  {p.notes || "-"}
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <button 
                                    onClick={() => cust && generateReceiptPDF(p, cust)} 
                                    className="p-2 text-gray-400 hover:text-orange-600 transition-all" 
                                    title="Descargar Recibo PDF"
                                  >
                                    <FileText className="h-5 w-5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className={cn(
                    "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                    business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                  )}>
                    <h3 className={cn("font-bold mb-4", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Acciones Rápidas</h3>
                    <button
                      onClick={() => {
                        setActiveTab("marketing");
                        setReminderForm({
                          ...reminderForm,
                          type: "billing",
                          subject: "Recordatorio de Pago Pendiente",
                          message: "Hola, te recordamos que tienes un pago pendiente en nuestro negocio. ¡Gracias!"
                        });
                      }}
                      className="w-full flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-sm"
                    >
                      <Bell className="h-4 w-4" />
                      <span>Programar Recordatorio de Pago</span>
                    </button>
                  </div>

                  <div className={cn(
                    "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                    business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                  )}>
                    <h3 className={cn("font-bold mb-4", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Estadísticas de Cobro</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Pagos Pendientes</span>
                        <span className="font-bold text-red-500">5</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className={cn("text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Recordatorios Enviados (Mes)</span>
                        <span className={cn("font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>42</span>
                      </div>
                    </div>
                  </div>

                  <div className={cn(
                    "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                    business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                  )}>
                    <h3 className={cn("font-bold mb-4", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Actividad Reciente</h3>
                    <div className="space-y-4">
                      <div className={cn(
                        "flex items-start space-x-3 p-3 rounded-2xl transition-colors duration-300",
                        business?.darkModeEnabled ? "bg-slate-800" : "bg-gray-50"
                      )}>
                        <div className="p-2 bg-blue-100 rounded-lg text-blue-600"><Mail className="h-4 w-4" /></div>
                        <div className="flex-1">
                          <p className={cn("text-sm font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Recordatorio Masivo Enviado</p>
                          <p className="text-xs text-gray-500">A 15 clientes vía Email</p>
                          <p className="text-[10px] text-gray-400 mt-1">Hace 2 días</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Marketing Tab */}
          {activeTab === "marketing" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Marketing & Notificaciones</h1>
                  <p className={cn("mt-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Crea campañas y programa recordatorios para tus clientes.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                  {/* Email-like Reminder Form */}
                  <div className={cn(
                    "p-8 rounded-3xl shadow-sm border transition-colors duration-300",
                    business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                  )}>
                    <h2 className={cn("text-xl font-bold mb-6 flex items-center space-x-2", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                      <Mail className="h-5 w-5 text-orange-600" />
                      <span>Nuevo Recordatorio / Campaña</span>
                    </h2>
                    
                    <form onSubmit={handleScheduleReminder} className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Tipo de Notificación</label>
                          <select
                            value={reminderForm.type}
                            onChange={e => setReminderForm({ ...reminderForm, type: e.target.value as any })}
                            className={cn(
                              "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                              business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                            )}
                          >
                            <option value="marketing">Marketing / Promoción</option>
                            <option value="billing">Cobranza / Recordatorio de Pago</option>
                          </select>
                        </div>
                        <div>
                          <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Programar para</label>
                          <div className="relative">
                            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                            <input
                              type="datetime-local"
                              value={reminderForm.scheduledAt}
                              onChange={e => setReminderForm({ ...reminderForm, scheduledAt: e.target.value })}
                              className={cn(
                                "w-full pl-12 pr-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                                business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                              )}
                              required
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Seleccionar Clientes</label>
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2 mb-2">
                            <button
                              type="button"
                              onClick={() => setSelectedCustomers(customers.map(c => c.id))}
                              className={cn(
                                "text-xs px-3 py-1 rounded-full transition-colors",
                                business?.darkModeEnabled ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-600"
                              )}
                            >
                              Seleccionar Todos ({customers.length})
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedCustomers([])}
                              className={cn(
                                "text-xs px-3 py-1 rounded-full transition-colors",
                                business?.darkModeEnabled ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-600"
                              )}
                            >
                              Desmarcar Todos
                            </button>
                          </div>
                          <div className={cn(
                            "max-h-40 overflow-y-auto border rounded-xl p-4 space-y-2 transition-colors duration-300",
                            business?.darkModeEnabled ? "bg-slate-800/50 border-slate-700" : "bg-gray-50/50 border-gray-100"
                          )}>
                            {customers.map(customer => (
                              <label key={customer.id} className={cn(
                                "flex items-center space-x-3 cursor-pointer p-2 rounded-lg transition-colors",
                                business?.darkModeEnabled ? "hover:bg-slate-800" : "hover:bg-white"
                              )}>
                                <input
                                  type="checkbox"
                                  checked={selectedCustomers.includes(customer.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedCustomers([...selectedCustomers, customer.id]);
                                    } else {
                                      setSelectedCustomers(selectedCustomers.filter(id => id !== customer.id));
                                    }
                                  }}
                                  className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className={cn("text-sm font-medium truncate", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{customer.name}</p>
                                  <p className="text-xs text-gray-500 truncate">{customer.email || customer.phone || "Sin contacto"}</p>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className={cn(
                        "space-y-4 p-6 rounded-2xl border transition-colors duration-300",
                        business?.darkModeEnabled ? "bg-slate-800/50 border-slate-700" : "bg-gray-50 border-gray-100"
                      )}>
                        <div>
                          <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Asunto (Para Email)</label>
                          <input
                            type="text"
                            value={reminderForm.subject}
                            onChange={e => setReminderForm({ ...reminderForm, subject: e.target.value })}
                            className={cn(
                              "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                              business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                            )}
                            placeholder="Ej: ¡Nueva promoción disponible!"
                            required
                          />
                        </div>
                        <div>
                          <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Mensaje (Email, Telegram, WhatsApp)</label>
                          <textarea
                            value={reminderForm.message}
                            onChange={e => setReminderForm({ ...reminderForm, message: e.target.value })}
                            rows={5}
                            className={cn(
                              "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                              business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                            )}
                            placeholder="Escribe el contenido de tu mensaje aquí..."
                            required
                          ></textarea>
                        </div>
                      </div>

                      <div className="flex flex-col md:flex-row gap-4">
                        <button
                          type="submit"
                          disabled={saving || selectedCustomers.length === 0}
                          className="flex-1 flex items-center justify-center space-x-2 bg-orange-600 text-white px-6 py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all disabled:opacity-50 shadow-lg shadow-orange-100"
                        >
                          {saving ? (
                            <div className="animate-spin h-5 w-5 border-b-2 border-white rounded-full"></div>
                          ) : (
                            <>
                              <Clock className="h-5 w-5" />
                              <span>Programar Envío ({selectedCustomers.length})</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={handleSendNow}
                          disabled={saving || selectedCustomers.length === 0}
                          className={cn(
                            "flex-1 flex items-center justify-center space-x-2 px-6 py-4 rounded-2xl font-bold transition-all disabled:opacity-50 shadow-lg",
                            business?.darkModeEnabled ? "bg-slate-800 text-white hover:bg-slate-700 shadow-slate-900" : "bg-white text-gray-900 hover:bg-gray-50 shadow-gray-200 border border-gray-100"
                          )}
                        >
                          {saving ? (
                            <div className="animate-spin h-5 w-5 border-b-2 border-orange-600 rounded-full"></div>
                          ) : (
                            <>
                              <Send className="h-5 w-5 text-orange-600" />
                              <span>Enviar Ahora ({selectedCustomers.length})</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Reminders History */}
                  <div className={cn(
                    "rounded-3xl shadow-sm border overflow-hidden transition-colors duration-300",
                    business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                  )}>
                    <div className={cn("p-6 border-b flex items-center justify-between", business?.darkModeEnabled ? "border-slate-800" : "border-gray-100")}>
                      <h2 className={cn("text-xl font-bold flex items-center space-x-2", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                        <History className="h-5 w-5 text-orange-600" />
                        <span>Historial de Notificaciones</span>
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className={business?.darkModeEnabled ? "bg-slate-800/50" : "bg-gray-50/50"}>
                          <tr>
                            <th className={cn("px-6 py-4 text-left text-xs font-bold uppercase tracking-wider", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Programado</th>
                            <th className={cn("px-6 py-4 text-left text-xs font-bold uppercase tracking-wider", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Tipo</th>
                            <th className={cn("px-6 py-4 text-left text-xs font-bold uppercase tracking-wider", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Asunto</th>
                            <th className={cn("px-6 py-4 text-left text-xs font-bold uppercase tracking-wider", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Destinatarios</th>
                            <th className={cn("px-6 py-4 text-left text-xs font-bold uppercase tracking-wider", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Estado</th>
                          </tr>
                        </thead>
                        <tbody className={cn("divide-y", business?.darkModeEnabled ? "divide-slate-800" : "divide-gray-100")}>
                          {reminders.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-gray-400">No hay notificaciones programadas aún.</td>
                            </tr>
                          ) : (
                            reminders.map(reminder => (
                              <tr key={reminder.id} className={cn("transition-all", business?.darkModeEnabled ? "hover:bg-slate-800/50" : "hover:bg-gray-50/50")}>
                                <td className={cn("px-6 py-4 whitespace-nowrap text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-600")}>
                                  {format(new Date(reminder.scheduledAt), "dd/MM/yyyy HH:mm")}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span className={cn(
                                    "px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                                    reminder.type === "marketing" ? "bg-purple-100 text-purple-600" : "bg-blue-100 text-blue-600"
                                  )}>
                                    {reminder.type === "marketing" ? "Marketing" : "Cobranza"}
                                  </span>
                                </td>
                                <td className={cn("px-6 py-4 text-sm font-medium max-w-xs truncate", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                                  {reminder.subject}
                                </td>
                                <td className={cn("px-6 py-4 whitespace-nowrap text-sm", business?.darkModeEnabled ? "text-slate-400" : "text-gray-600")}>
                                  {reminder.customerIds.length} clientes
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="flex flex-col">
                                    <span className={cn(
                                      "flex items-center space-x-1 text-xs font-medium",
                                      reminder.status === "sent" ? "text-green-600" : 
                                      reminder.status === "failed" ? "text-red-600" : "text-orange-600"
                                    )}>
                                      {reminder.status === "sent" ? <CheckCircle2 className="h-3 w-3" /> : 
                                       reminder.status === "failed" ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                                      <span>{reminder.status === "sent" ? "Enviado" : reminder.status === "failed" ? "Fallido" : "Pendiente"}</span>
                                    </span>
                                    {reminder.statusMessage && (
                                      <span className="text-[10px] text-gray-400 truncate max-w-[150px]" title={reminder.statusMessage}>
                                        {reminder.statusMessage}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="space-y-8">
                  <div className={cn(
                    "p-6 rounded-3xl border shadow-sm transition-colors duration-300",
                    business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
                  )}>
                    <h3 className={cn("font-bold mb-4", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Próximas Fechas Especiales</h3>
                    <div className="space-y-4">
                      <div className={cn(
                        "p-4 rounded-2xl border transition-colors duration-300",
                        business?.darkModeEnabled ? "bg-orange-900/20 border-orange-900/30" : "bg-orange-50 border-orange-100"
                      )}>
                        <p className="text-xs font-bold text-orange-600 uppercase mb-1">Próximo Domingo</p>
                        <p className={cn("font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Día de la Madre</p>
                        <p className="text-xs text-gray-500 mt-1">Ideal para una campaña de 2x1.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "staff" && business && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className={cn("text-3xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Gestión de Equipo</h1>
                  <p className={cn("mt-1", business?.darkModeEnabled ? "text-slate-400" : "text-gray-500")}>Administra los accesos de tus empleados.</p>
                </div>
                <button
                  onClick={async () => {
                    const email = prompt("Email del empleado:");
                    const name = prompt("Nombre del empleado:");
                    if (email && name) {
                      await addDoc(collection(db, "businesses", business.id, "staff"), {
                        email,
                        name,
                        role: 'staff',
                        businessId: business.id
                      });
                    }
                  }}
                  className="flex items-center space-x-2 bg-orange-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200"
                >
                  <Plus className="h-5 w-5" />
                  <span>Añadir Empleado</span>
                </button>
              </div>

              <div className={cn(
                "rounded-3xl shadow-sm border overflow-hidden transition-colors duration-300",
                business?.darkModeEnabled ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
              )}>
                <table className="w-full text-left">
                  <thead>
                    <tr className={cn(
                      "text-xs uppercase tracking-wider font-bold transition-colors duration-300",
                      business?.darkModeEnabled ? "bg-slate-800 text-slate-400" : "bg-gray-50 text-gray-500"
                    )}>
                      <th className="px-6 py-4">Nombre</th>
                      <th className="px-6 py-4">Email</th>
                      <th className="px-6 py-4">Rol</th>
                      <th className="px-6 py-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className={cn("divide-y", business?.darkModeEnabled ? "divide-slate-800" : "divide-gray-100")}>
                    {staff.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-gray-400">No hay empleados registrados.</td>
                      </tr>
                    ) : (
                      staff.map(s => (
                        <tr key={s.id} className={cn("transition-all", business?.darkModeEnabled ? "hover:bg-slate-800/50" : "hover:bg-gray-50/50")}>
                          <td className={cn("px-6 py-4 font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{s.name}</td>
                          <td className={cn("px-6 py-4", business?.darkModeEnabled ? "text-slate-400" : "text-gray-600")}>{s.email}</td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-xs font-bold",
                              s.role === 'admin' ? "bg-purple-100 text-purple-600" : "bg-blue-100 text-blue-600"
                            )}>
                              {s.role === 'admin' ? 'Administrador' : 'Vendedor'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={async () => {
                                if (window.confirm("¿Eliminar empleado?")) {
                                  await deleteDoc(doc(db, "businesses", business.id, "staff", s.id));
                                }
                              }}
                              className="p-2 text-gray-400 hover:text-red-600 transition-all"
                            >
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {(isAddingCustomer || isEditingCustomer) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className={cn(
              "rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden transition-colors duration-300",
              business?.darkModeEnabled ? "bg-slate-900" : "bg-white"
            )}>
              <div className={cn("p-8 border-b flex justify-between items-center transition-colors duration-300", business?.darkModeEnabled ? "border-slate-800" : "border-gray-100")}>
                <h2 className={cn("text-2xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{isAddingCustomer ? "Añadir Cliente" : "Editar Cliente"}</h2>
                <button onClick={() => { setIsAddingCustomer(false); setIsEditingCustomer(null); }} className={cn("p-2 rounded-full transition-all", business?.darkModeEnabled ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-100 text-gray-400")}><X className="h-6 w-6" /></button>
              </div>
              <form onSubmit={isAddingCustomer ? handleAddCustomer : handleUpdateCustomer} className="p-8 space-y-6">
                <div className="space-y-4">
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Número de Teléfono</label>
                    <input
                      type="tel"
                      name="phone"
                      defaultValue={isEditingCustomer?.phone}
                      disabled={!!isEditingCustomer}
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white disabled:bg-slate-950" : "bg-white border-gray-200 text-gray-900 disabled:bg-gray-50"
                      )}
                      required
                    />
                  </div>
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Nombre Completo</label>
                    <input
                      type="text"
                      name="name"
                      defaultValue={isEditingCustomer?.name}
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                    />
                  </div>
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Email (Opcional)</label>
                    <input
                      type="email"
                      name="email"
                      defaultValue={isEditingCustomer?.email}
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                    />
                  </div>
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Notas del Cliente</label>
                    <textarea
                      name="notes"
                      defaultValue={isEditingCustomer?.notes}
                      placeholder="Preferencias, alergias, etc."
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                    />
                  </div>
                  {isAddingCustomer && (
                    <div>
                      <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Referido por (Teléfono)</label>
                      <input
                        type="tel"
                        name="referredBy"
                        placeholder="Teléfono del cliente que lo recomendó"
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                      />
                    </div>
                  )}
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Estado</label>
                    <select
                      name="status"
                      defaultValue={isEditingCustomer?.status || 'active'}
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                    >
                      <option value="active">Activo</option>
                      <option value="inactive">Inactivo</option>
                    </select>
                  </div>
                  {!isAddingCustomer && (
                    <div>
                      <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Cantidad de Sellos</label>
                      <input
                        type="number"
                        name="couponsCount"
                        defaultValue={isEditingCustomer?.couponsCount}
                        className={cn(
                          "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                          business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                        )}
                      />
                    </div>
                  )}
                </div>
                <button type="submit" className="w-full bg-orange-600 text-white py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200">
                  {isAddingCustomer ? "Añadir Cliente" : "Guardar Cambios"}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}

        {isAddingPurchase && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className={cn(
              "rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden transition-colors duration-300",
              business?.darkModeEnabled ? "bg-slate-900" : "bg-white"
            )}>
              <div className={cn("p-8 border-b flex justify-between items-center transition-colors duration-300", business?.darkModeEnabled ? "border-slate-800" : "border-gray-100")}>
                <h2 className={cn("text-2xl font-bold", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>Registrar Venta</h2>
                <button onClick={() => setIsAddingPurchase(null)} className={cn("p-2 rounded-full transition-all", business?.darkModeEnabled ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-100 text-gray-400")}><X className="h-6 w-6" /></button>
              </div>
              <form onSubmit={handleAddPurchase} className="p-8 space-y-6">
                <div className="space-y-4">
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Monto de la Venta ({business?.currency || "$"})</label>
                    <input
                      type="number"
                      step="0.01"
                      name="amount"
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                      required
                    />
                  </div>
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Método de Pago</label>
                    <select
                      name="paymentMethod"
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                    >
                      <option value="Efectivo">Efectivo</option>
                      <option value="Tarjeta">Tarjeta</option>
                      <option value="Transferencia">Transferencia</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label className={cn("block text-sm font-medium mb-1", business?.darkModeEnabled ? "text-slate-300" : "text-gray-700")}>Notas de la Venta</label>
                    <textarea
                      name="notes"
                      placeholder="Detalles de la compra..."
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border transition-all focus:ring-2 focus:ring-orange-500 outline-none",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
                      )}
                    />
                  </div>
                </div>
                <button type="submit" className="w-full bg-orange-600 text-white py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200">
                  Registrar Venta y Sello
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}

        {showHistory && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className={cn(
              "rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden transition-colors duration-300",
              business?.darkModeEnabled ? "bg-slate-900" : "bg-white"
            )}>
              <div className={cn("p-8 border-b flex justify-between items-center transition-colors duration-300", business?.darkModeEnabled ? "border-slate-800" : "border-gray-100")}>
                <h2 className={cn("text-2xl font-bold flex items-center space-x-2", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>
                  <History className="h-6 w-6 text-orange-600" />
                  <span>Historial de Compras</span>
                </h2>
                <button onClick={() => setShowHistory(null)} className={cn("p-2 rounded-full transition-all", business?.darkModeEnabled ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-100 text-gray-400")}><X className="h-6 w-6" /></button>
              </div>
              <div className="p-8 max-h-[60vh] overflow-y-auto">
                {customerHistory.length > 0 ? (
                  <div className="space-y-4">
                    {customerHistory.map((p, i) => (
                      <div key={p.id} className={cn(
                        "flex items-center justify-between p-4 rounded-2xl border transition-colors duration-300",
                        business?.darkModeEnabled ? "bg-slate-800 border-slate-700" : "bg-gray-50 border-gray-100"
                      )}>
                        <div className="flex items-center space-x-3">
                          <div className="h-8 w-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-xs font-bold">{customerHistory.length - i}</div>
                          <p className={cn("font-medium", business?.darkModeEnabled ? "text-white" : "text-gray-900")}>{format(new Date(p.timestamp), "PPPP", { locale: es })}</p>
                        </div>
                        <p className="text-xs text-gray-500">{format(new Date(p.timestamp), "HH:mm:ss")}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10">
                    <History className="h-12 w-12 text-gray-200 mx-auto mb-3" />
                    <p className="text-gray-500">No se encontró historial de compras.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}

        {status && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={cn(
              "fixed bottom-8 right-8 z-[100] p-4 rounded-2xl shadow-2xl flex items-center space-x-3 border backdrop-blur-md max-w-md",
              status.type === 'success' ? "bg-green-50/90 border-green-200 text-green-800" :
              status.type === 'warning' ? "bg-amber-50/90 border-amber-200 text-amber-800" :
              "bg-red-50/90 border-red-200 text-red-800"
            )}
          >
            {status.type === 'success' ? <CheckCircle2 className="h-6 w-6 text-green-600" /> :
             status.type === 'warning' ? <AlertCircle className="h-6 w-6 text-amber-600" /> :
             <AlertCircle className="h-6 w-6 text-red-600" />}
            <p className="font-bold text-sm flex-1">{status.message}</p>
            <button onClick={() => setStatus(null)} className="p-1 hover:bg-black/5 rounded-full transition-colors">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
