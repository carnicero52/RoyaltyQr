import { useState, useEffect, useRef } from "react";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, deleteDoc, addDoc, where } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Business, Customer, Purchase } from "../types";
import { 
  Settings, Users, QrCode, BarChart3, LogOut, Save, Plus, Search, 
  Edit2, Trash2, Download, FileText, Mail, Send, Bell, Gift,
  CheckCircle2, AlertCircle, TrendingUp, UserPlus, History, X,
  CreditCard, Megaphone, Calendar, MessageSquare
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line 
} from "recharts";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { format } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../lib/utils";

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState<"config" | "customers" | "qr" | "stats" | "billing" | "marketing">("config");
  const [business, setBusiness] = useState<Business | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isEditingCustomer, setIsEditingCustomer] = useState<Customer | null>(null);
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [customerHistory, setCustomerHistory] = useState<Purchase[]>([]);

  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      // Fetch Business
      const businessDoc = await getDoc(doc(db, "businesses", uid));
      if (businessDoc.exists()) {
        setBusiness({ id: businessDoc.id, ...businessDoc.data() } as Business);
      } else {
        // Create default business
        const defaultBusiness: Business = {
          id: uid,
          name: "My Business",
          rewardDescription: "Free Coffee",
          couponsNeeded: 10,
          cooldownHours: 2,
          notificationsEnabled: false,
          ownerEmail: auth.currentUser?.email || "",
        };
        await setDoc(doc(db, "businesses", uid), defaultBusiness);
        setBusiness(defaultBusiness);
      }

      // Fetch Customers
      const customersSnap = await getDocs(collection(db, "businesses", uid, "customers"));
      const customersList = customersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Customer));
      setCustomers(customersList);

      // Fetch Purchases
      const purchasesSnap = await getDocs(query(collection(db, "businesses", uid, "purchases"), orderBy("timestamp", "desc")));
      const purchasesList = purchasesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Purchase));
      setPurchases(purchasesList);

    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "businesses", business.id), { ...business });
      alert("Configuration saved successfully!");
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

    if (!phone) return;

    try {
      const newCust: Customer = {
        id: phone,
        phone,
        name,
        email,
        couponsCount: 0,
        businessId: business!.id,
      };
      await setDoc(doc(db, "businesses", business!.id, "customers", phone), newCust);
      setCustomers([...customers, newCust]);
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
    const couponsCount = parseInt(formData.get("couponsCount") as string);

    try {
      const updated = { ...isEditingCustomer, name, email, couponsCount };
      await updateDoc(doc(db, "businesses", business!.id, "customers", isEditingCustomer.id), updated);
      setCustomers(customers.map(c => c.id === isEditingCustomer.id ? updated : c));
      setIsEditingCustomer(null);
    } catch (err) {
      console.error("Error updating customer:", err);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this customer?")) return;
    try {
      await deleteDoc(doc(db, "businesses", business!.id, "customers", id));
      setCustomers(customers.filter(c => c.id !== id));
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
      alert("Notifications sent successfully!");
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

  const exportToCSV = () => {
    const headers = ["Phone", "Name", "Email", "Coupons", "Last Purchase"];
    const rows = customers.map(c => [
      c.phone,
      c.name || "",
      c.email || "",
      c.couponsCount,
      c.lastPurchaseAt ? format(new Date(c.lastPurchaseAt), "yyyy-MM-dd HH:mm") : ""
    ]);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "customers.csv";
    link.click();
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.text("Customer List - Fideliza", 14, 15);
    (doc as any).autoTable({
      startY: 20,
      head: [["Phone", "Name", "Email", "Coupons", "Last Purchase"]],
      body: customers.map(c => [
        c.phone,
        c.name || "",
        c.email || "",
        c.couponsCount,
        c.lastPurchaseAt ? format(new Date(c.lastPurchaseAt), "yyyy-MM-dd HH:mm") : ""
      ]),
    });
    doc.save("customers.pdf");
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
    const date = format(new Date(p.timestamp), "MMM dd");
    const existing = acc.find(a => a.date === date);
    if (existing) existing.count++;
    else acc.push({ date, count: 1 });
    return acc;
  }, []).reverse().slice(-7);

  const pieData = [
    { name: "Progressing", value: customers.length - stats.rewardsReached },
    { name: "Reward Reached", value: stats.rewardsReached },
  ];

  const COLORS = ["#f97316", "#22c55e"];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 hidden md:flex flex-col">
        <div className="p-6">
          <div className="flex items-center space-x-3">
            <div className="bg-orange-600 p-2 rounded-xl">
              <CheckCircle2 className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">Fideliza</span>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          <button
            onClick={() => setActiveTab("config")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "config" ? "bg-orange-50 text-orange-600" : "text-gray-500 hover:bg-gray-50"
            )}
          >
            <Settings className="h-5 w-5" />
            <span className="font-medium">Configuration</span>
          </button>
          <button
            onClick={() => setActiveTab("customers")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "customers" ? "bg-orange-50 text-orange-600" : "text-gray-500 hover:bg-gray-50"
            )}
          >
            <Users className="h-5 w-5" />
            <span className="font-medium">Customers</span>
          </button>
          <button
            onClick={() => setActiveTab("qr")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "qr" ? "bg-orange-50 text-orange-600" : "text-gray-500 hover:bg-gray-50"
            )}
          >
            <QrCode className="h-5 w-5" />
            <span className="font-medium">QR Management</span>
          </button>
          <button
            onClick={() => setActiveTab("stats")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "stats" ? "bg-orange-50 text-orange-600" : "text-gray-500 hover:bg-gray-50"
            )}
          >
            <BarChart3 className="h-5 w-5" />
            <span className="font-medium">Statistics</span>
          </button>
          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Communications</p>
          </div>
          <button
            onClick={() => setActiveTab("billing")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "billing" ? "bg-orange-50 text-orange-600" : "text-gray-500 hover:bg-gray-50"
            )}
          >
            <CreditCard className="h-5 w-5" />
            <span className="font-medium">Cobranzas</span>
          </button>
          <button
            onClick={() => setActiveTab("marketing")}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all",
              activeTab === "marketing" ? "bg-orange-50 text-orange-600" : "text-gray-500 hover:bg-gray-50"
            )}
          >
            <Megaphone className="h-5 w-5" />
            <span className="font-medium">Marketing</span>
          </button>
        </nav>

        <div className="p-4 border-t border-gray-100">
          <button
            onClick={() => auth.signOut()}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 transition-all"
          >
            <LogOut className="h-5 w-5" />
            <span className="font-medium">Log Out</span>
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
             <button onClick={() => setActiveTab("config")} className={cn("p-2 rounded-lg", activeTab === "config" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><Settings className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("customers")} className={cn("p-2 rounded-lg", activeTab === "customers" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><Users className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("qr")} className={cn("p-2 rounded-lg", activeTab === "qr" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><QrCode className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("stats")} className={cn("p-2 rounded-lg", activeTab === "stats" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><BarChart3 className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("billing")} className={cn("p-2 rounded-lg", activeTab === "billing" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><CreditCard className="h-5 w-5" /></button>
             <button onClick={() => setActiveTab("marketing")} className={cn("p-2 rounded-lg", activeTab === "marketing" ? "bg-orange-50 text-orange-600" : "text-gray-400")}><Megaphone className="h-5 w-5" /></button>
             <button onClick={() => auth.signOut()} className="p-2 rounded-lg text-red-400"><LogOut className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="p-6 md:p-10 max-w-6xl mx-auto">
          {/* Configuration Tab */}
          {activeTab === "config" && business && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">Program Configuration</h1>
                  <p className="text-gray-500 mt-1">Customize your loyalty program rules.</p>
                </div>
                <button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="flex items-center space-x-2 bg-orange-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-orange-700 transition-all disabled:opacity-50"
                >
                  {saving ? <div className="animate-spin h-5 w-5 border-b-2 border-white rounded-full"></div> : <><Save className="h-5 w-5" /><span>Save Changes</span></>}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 space-y-6">
                  <h2 className="text-xl font-bold flex items-center space-x-2"><Gift className="h-5 w-5 text-orange-600" /><span>Reward Details</span></h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
                      <input
                        type="text"
                        value={business.name}
                        onChange={e => setBusiness({ ...business, name: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reward Description</label>
                      <input
                        type="text"
                        value={business.rewardDescription}
                        onChange={e => setBusiness({ ...business, rewardDescription: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Coupons Needed</label>
                        <input
                          type="number"
                          value={business.couponsNeeded}
                          onChange={e => setBusiness({ ...business, couponsNeeded: parseInt(e.target.value) })}
                          className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Cooldown (Hours)</label>
                        <input
                          type="number"
                          value={business.cooldownHours}
                          onChange={e => setBusiness({ ...business, cooldownHours: parseInt(e.target.value) })}
                          className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 space-y-6">
                  <h2 className="text-xl font-bold flex items-center space-x-2"><Bell className="h-5 w-5 text-orange-600" /><span>Notifications</span></h2>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                      <div>
                        <p className="font-bold text-gray-900">Enable Notifications</p>
                        <p className="text-xs text-gray-500">Receive alerts for new stamps and rewards.</p>
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
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                      <div>
                        <p className="font-bold text-gray-900">Billing Alerts</p>
                        <p className="text-xs text-gray-500">Automated payment reminders.</p>
                      </div>
                      <button
                        onClick={() => setBusiness({ ...business, billingNotificationsEnabled: !business.billingNotificationsEnabled })}
                        className={cn(
                          "w-12 h-6 rounded-full transition-all relative",
                          business.billingNotificationsEnabled ? "bg-orange-600" : "bg-gray-300"
                        )}
                      >
                        <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", business.billingNotificationsEnabled ? "right-1" : "left-1")}></div>
                      </button>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                      <div>
                        <p className="font-bold text-gray-900">Marketing Alerts</p>
                        <p className="text-xs text-gray-500">Promotions and special dates.</p>
                      </div>
                      <button
                        onClick={() => setBusiness({ ...business, marketingNotificationsEnabled: !business.marketingNotificationsEnabled })}
                        className={cn(
                          "w-12 h-6 rounded-full transition-all relative",
                          business.marketingNotificationsEnabled ? "bg-orange-600" : "bg-gray-300"
                        )}
                      >
                        <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", business.marketingNotificationsEnabled ? "right-1" : "left-1")}></div>
                      </button>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center space-x-2"><Mail className="h-4 w-4" /><span>Admin Email (Gmail)</span></label>
                      <input
                        type="email"
                        value={business.ownerEmail}
                        onChange={e => setBusiness({ ...business, ownerEmail: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500"
                        placeholder="your-email@gmail.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center space-x-2"><Send className="h-4 w-4" /><span>Telegram Chat ID</span></label>
                      <input
                        type="text"
                        value={business.telegramChatId}
                        onChange={e => setBusiness({ ...business, telegramChatId: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500"
                        placeholder="Chat ID"
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
                  <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
                  <p className="text-gray-500 mt-1">Manage your customer base and their progress.</p>
                </div>
                <div className="flex space-x-2">
                  <button onClick={exportToCSV} className="flex items-center space-x-2 bg-white border border-gray-200 px-4 py-2 rounded-xl text-gray-700 hover:bg-gray-50 transition-all font-medium"><Download className="h-4 w-4" /><span>CSV</span></button>
                  <button onClick={exportToPDF} className="flex items-center space-x-2 bg-white border border-gray-200 px-4 py-2 rounded-xl text-gray-700 hover:bg-gray-50 transition-all font-medium"><FileText className="h-4 w-4" /><span>PDF</span></button>
                  <button onClick={() => setIsAddingCustomer(true)} className="flex items-center space-x-2 bg-orange-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-orange-700 transition-all"><Plus className="h-4 w-4" /><span>Add Customer</span></button>
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search by name, phone or email..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 rounded-2xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500 bg-white"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider font-bold">
                        <th className="px-6 py-4">Customer</th>
                        <th className="px-6 py-4">Progress</th>
                        <th className="px-6 py-4">Last Stamp</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredCustomers.map(c => (
                        <tr key={c.id} className="hover:bg-gray-50/50 transition-all">
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-3">
                              <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                                {c.name ? c.name[0].toUpperCase() : "?"}
                              </div>
                              <div>
                                <p className="font-bold text-gray-900">{c.name || "Unnamed Customer"}</p>
                                <p className="text-xs text-gray-500">{c.phone}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-2">
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-orange-500" style={{ width: `${(c.couponsCount / (business?.couponsNeeded || 10)) * 100}%` }}></div>
                              </div>
                              <span className="text-sm font-bold text-gray-700">{c.couponsCount}/{business?.couponsNeeded}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {c.lastPurchaseAt ? format(new Date(c.lastPurchaseAt), "MMM dd, HH:mm") : "Never"}
                          </td>
                          <td className="px-6 py-4 text-right space-x-2">
                            <button onClick={() => fetchCustomerHistory(c.id)} className="p-2 text-gray-400 hover:text-blue-600 transition-all"><History className="h-5 w-5" /></button>
                            <button onClick={() => setIsEditingCustomer(c)} className="p-2 text-gray-400 hover:text-orange-600 transition-all"><Edit2 className="h-5 w-5" /></button>
                            <button onClick={() => handleDeleteCustomer(c.id)} className="p-2 text-gray-400 hover:text-red-600 transition-all"><Trash2 className="h-5 w-5" /></button>
                          </td>
                        </tr>
                      ))}
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
                <h1 className="text-3xl font-bold text-gray-900">QR Code</h1>
                <p className="text-gray-500 mt-1">Print this QR code for your customers to scan.</p>
              </div>

              <div className="bg-white p-12 rounded-[3rem] shadow-2xl border border-gray-100 flex flex-col items-center space-y-8">
                <div ref={qrRef} className="p-6 bg-white rounded-3xl border-4 border-orange-500 shadow-inner">
                  <QRCodeSVG 
                    value={`${window.location.origin}/negocio/${business.id}`} 
                    size={256}
                    level="H"
                    includeMargin={true}
                  />
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">{business.name}</p>
                  <p className="text-gray-500 text-sm">Scan to get rewards!</p>
                </div>
                <button
                  onClick={downloadQR}
                  className="flex items-center space-x-2 bg-orange-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200"
                >
                  <Download className="h-6 w-6" />
                  <span>Download QR Code</span>
                </button>
              </div>

              <div className="max-w-md text-center text-gray-500 text-sm">
                <p>Tip: Place this QR code near your cash register or on tables where customers can easily see it.</p>
              </div>
            </motion.div>
          )}

          {/* Stats Tab */}
          {activeTab === "stats" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <h1 className="text-3xl font-bold text-gray-900">Statistics</h1>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-blue-50 rounded-2xl text-blue-600"><Users className="h-6 w-6" /></div>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">Total</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{stats.totalCustomers}</p>
                  <p className="text-sm text-gray-500">Customers</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-orange-50 rounded-2xl text-orange-600"><TrendingUp className="h-6 w-6" /></div>
                    <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-lg">+12%</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{stats.totalPurchases}</p>
                  <p className="text-sm text-gray-500">Total Stamps</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-green-50 rounded-2xl text-green-600"><Gift className="h-6 w-6" /></div>
                    <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-lg">Ready</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{stats.rewardsReached}</p>
                  <p className="text-sm text-gray-500">Rewards Reached</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-purple-50 rounded-2xl text-purple-600"><TrendingUp className="h-6 w-6" /></div>
                    <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded-lg">Avg</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{stats.avgPurchases}</p>
                  <p className="text-sm text-gray-500">Stamps per Customer</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
                  <h2 className="text-xl font-bold mb-6">Stamp Activity (Last 7 Days)</h2>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} />
                        <YAxis axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                        <Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
                  <h2 className="text-xl font-bold mb-6">Customer Progress</h2>
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
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-col space-y-2 ml-4">
                      {pieData.map((entry, index) => (
                        <div key={entry.name} className="flex items-center space-x-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index] }}></div>
                          <span className="text-xs text-gray-500">{entry.name}: {entry.value}</span>
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
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Cobranzas</h1>
                <p className="text-gray-500 mt-1">Manage payment reminders and collections.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-2 space-y-6">
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                    <h2 className="text-xl font-bold mb-6 flex items-center space-x-2"><CreditCard className="h-5 w-5 text-orange-600" /><span>Send Payment Reminder</span></h2>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.currentTarget);
                      const message = formData.get("message") as string;
                      sendBulkNotification("Cobranza", message, customers.filter(c => c.email));
                    }} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Message Template</label>
                        <textarea
                          name="message"
                          rows={4}
                          className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500"
                          placeholder="Estimado cliente, le recordamos que tiene un pago pendiente..."
                          required
                        ></textarea>
                      </div>
                      <button
                        type="submit"
                        disabled={saving}
                        className="w-full bg-orange-600 text-white py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200 flex items-center justify-center space-x-2"
                      >
                        <Send className="h-5 w-5" />
                        <span>Send to {customers.filter(c => c.email).length} Customers</span>
                      </button>
                    </form>
                  </div>

                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                    <h2 className="text-xl font-bold mb-6">Recent Billing Activity</h2>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-blue-100 rounded-lg text-blue-600"><Mail className="h-4 w-4" /></div>
                          <div>
                            <p className="font-bold text-gray-900">Bulk Reminder Sent</p>
                            <p className="text-xs text-gray-500">To 15 customers via Email</p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-400">2 days ago</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                    <h3 className="font-bold text-gray-900 mb-4">Billing Stats</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">Pending Payments</span>
                        <span className="font-bold text-red-500">5</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">Reminders Sent (Mo)</span>
                        <span className="font-bold text-gray-900">42</span>
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
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Marketing & Promociones</h1>
                <p className="text-gray-500 mt-1">Announce special dates and new rewards.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-2 space-y-6">
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                    <h2 className="text-xl font-bold mb-6 flex items-center space-x-2"><Megaphone className="h-5 w-5 text-orange-600" /><span>New Campaign</span></h2>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.currentTarget);
                      const message = formData.get("message") as string;
                      sendBulkNotification("Promoción", message, customers.filter(c => c.email));
                    }} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Message</label>
                        <textarea
                          name="message"
                          rows={4}
                          className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500"
                          placeholder="¡Feliz Día del Padre! Hoy tenemos 2x1 en todos nuestros productos..."
                          required
                        ></textarea>
                      </div>
                      <button
                        type="submit"
                        disabled={saving}
                        className="w-full bg-orange-600 text-white py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200 flex items-center justify-center space-x-2"
                      >
                        <Send className="h-5 w-5" />
                        <span>Blast to {customers.filter(c => c.email).length} Customers</span>
                      </button>
                    </form>
                  </div>

                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                    <h2 className="text-xl font-bold mb-6">Upcoming Special Dates</h2>
                    <div className="space-y-4">
                      {[
                        { date: "May 10", event: "Mother's Day", status: "Scheduled" },
                        { date: "Jun 15", event: "Father's Day", status: "Draft" },
                      ].map((d, i) => (
                        <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-orange-100 rounded-lg text-orange-600"><Calendar className="h-4 w-4" /></div>
                            <div>
                              <p className="font-bold text-gray-900">{d.event}</p>
                              <p className="text-xs text-gray-500">{d.date}</p>
                            </div>
                          </div>
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-1 rounded-lg uppercase tracking-wider",
                            d.status === "Scheduled" ? "bg-green-100 text-green-600" : "bg-gray-200 text-gray-600"
                          )}>{d.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                    <h3 className="font-bold text-gray-900 mb-4">Quick Templates</h3>
                    <div className="space-y-2">
                      <button className="w-full text-left p-3 text-sm text-gray-600 hover:bg-gray-50 rounded-xl transition-all border border-transparent hover:border-gray-200">🎂 Birthday Special</button>
                      <button className="w-full text-left p-3 text-sm text-gray-600 hover:bg-gray-50 rounded-xl transition-all border border-transparent hover:border-gray-200">🎄 Christmas Promo</button>
                      <button className="w-full text-left p-3 text-sm text-gray-600 hover:bg-gray-50 rounded-xl transition-all border border-transparent hover:border-gray-200">⚡ Flash Sale</button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {(isAddingCustomer || isEditingCustomer) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden">
              <div className="p-8 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-2xl font-bold">{isAddingCustomer ? "Add Customer" : "Edit Customer"}</h2>
                <button onClick={() => { setIsAddingCustomer(false); setIsEditingCustomer(null); }} className="p-2 hover:bg-gray-100 rounded-full transition-all"><X className="h-6 w-6" /></button>
              </div>
              <form onSubmit={isAddingCustomer ? handleAddCustomer : handleUpdateCustomer} className="p-8 space-y-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                    <input type="tel" name="phone" defaultValue={isEditingCustomer?.phone} disabled={!!isEditingCustomer} className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500 disabled:bg-gray-50" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <input type="text" name="name" defaultValue={isEditingCustomer?.name} className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email (Optional)</label>
                    <input type="email" name="email" defaultValue={isEditingCustomer?.email} className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500" />
                  </div>
                  {!isAddingCustomer && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Coupons Count</label>
                      <input type="number" name="couponsCount" defaultValue={isEditingCustomer?.couponsCount} className="w-full px-4 py-3 rounded-xl border-gray-200 border focus:ring-orange-500 focus:border-orange-500" />
                    </div>
                  )}
                </div>
                <button type="submit" className="w-full bg-orange-600 text-white py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200">
                  {isAddingCustomer ? "Add Customer" : "Save Changes"}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}

        {showHistory && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden">
              <div className="p-8 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-2xl font-bold flex items-center space-x-2"><History className="h-6 w-6 text-orange-600" /><span>Purchase History</span></h2>
                <button onClick={() => setShowHistory(null)} className="p-2 hover:bg-gray-100 rounded-full transition-all"><X className="h-6 w-6" /></button>
              </div>
              <div className="p-8 max-h-[60vh] overflow-y-auto">
                {customerHistory.length > 0 ? (
                  <div className="space-y-4">
                    {customerHistory.map((p, i) => (
                      <div key={p.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <div className="flex items-center space-x-3">
                          <div className="h-8 w-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-xs font-bold">{customerHistory.length - i}</div>
                          <p className="font-medium text-gray-900">{format(new Date(p.timestamp), "PPPP")}</p>
                        </div>
                        <p className="text-xs text-gray-500">{format(new Date(p.timestamp), "HH:mm:ss")}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10">
                    <History className="h-12 w-12 text-gray-200 mx-auto mb-3" />
                    <p className="text-gray-500">No purchase history found.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
