import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, setDoc, updateDoc, increment, collection, addDoc, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";
import { Business, Customer } from "../types";
import { Phone, Gift, CheckCircle2, AlertCircle, Clock, ArrowRight } from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../lib/utils";

export default function PublicPanel() {
  const { businessId } = useParams<{ businessId: string }>();
  const [business, setBusiness] = useState<Business | null>(null);
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (businessId) {
      fetchBusiness();
    }
  }, [businessId]);

  const fetchBusiness = async () => {
    try {
      const docRef = doc(db, "businesses", businessId!);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setBusiness({ id: docSnap.id, ...docSnap.data() } as Business);
      }
    } catch (err) {
      console.error("Error fetching business:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleIdentify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || phone.length < 8) {
      setMessage({ type: "error", text: "Please enter a valid phone number." });
      return;
    }

    setRegistering(true);
    setMessage(null);

    try {
      const customerRef = doc(db, "businesses", businessId!, "customers", phone);
      const customerSnap = await getDoc(customerRef);

      let currentCustomer: Customer;

      if (customerSnap.exists()) {
        currentCustomer = { id: customerSnap.id, ...customerSnap.data() } as Customer;
        
        // Check Cooldown
        if (currentCustomer.lastPurchaseAt) {
          const lastPurchase = new Date(currentCustomer.lastPurchaseAt);
          const hoursDiff = differenceInHours(new Date(), lastPurchase);
          const cooldown = business?.cooldownHours || 2;

          if (hoursDiff < cooldown) {
            setCustomer(currentCustomer);
            setMessage({ 
              type: "info", 
              text: `Please wait ${cooldown - hoursDiff} more hours before your next stamp.` 
            });
            setRegistering(false);
            return;
          }
        }
      } else {
        // Create New Customer
        currentCustomer = {
          id: phone,
          phone,
          couponsCount: 0,
          businessId: businessId!,
        };
        await setDoc(customerRef, currentCustomer);
      }

      // Register Purchase
      const now = new Date().toISOString();
      await updateDoc(customerRef, {
        couponsCount: increment(1),
        lastPurchaseAt: now,
      });

      // Add to Purchase History
      await addDoc(collection(db, "businesses", businessId!, "purchases"), {
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
      setMessage({ type: "success", text: "Stamp added successfully!" });

      // Notify Admin (Server-side)
      if (business?.notificationsEnabled) {
        notifyAdmin(updatedCustomer);
      }

    } catch (err) {
      console.error("Error registering purchase:", err);
      setMessage({ type: "error", text: "Something went wrong. Please try again." });
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
          type: isRewardReached ? "Reward Reached" : "Purchase Registered",
          data: {
            customer: cust.phone,
            coupons: cust.couponsCount,
            business: business?.name,
          },
          config: {
            email: business?.ownerEmail,
            telegram: !!business?.telegramChatId,
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
        <div className="text-center max-w-md">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">Business Not Found</h1>
          <p className="text-gray-600 mt-2">The link you followed seems to be invalid or the business no longer exists.</p>
        </div>
      </div>
    );
  }

  const progress = customer ? (customer.couponsCount / business.couponsNeeded) * 100 : 0;
  const isRewardReady = customer && customer.couponsCount >= business.couponsNeeded;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 sm:px-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100"
      >
        {/* Header */}
        <div className="bg-orange-600 p-8 text-center text-white">
          <h1 className="text-3xl font-bold tracking-tight">{business.name}</h1>
          <p className="mt-2 text-orange-100 font-medium">{business.rewardDescription}</p>
        </div>

        <div className="p-8">
          {!customer ? (
            <form onSubmit={handleIdentify} className="space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Welcome!</h2>
                <p className="text-gray-500 text-sm mt-1">Enter your phone to get your stamp.</p>
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Phone className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone Number"
                  className="block w-full pl-12 pr-4 py-4 border-gray-200 border rounded-2xl focus:ring-orange-500 focus:border-orange-500 text-lg font-medium transition-all"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={registering}
                className="w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-2xl shadow-sm text-lg font-bold text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 transition-all disabled:opacity-50"
              >
                {registering ? (
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                ) : (
                  <>
                    Get My Stamp
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-8">
              {/* Progress Section */}
              <div className="text-center">
                <div className="inline-flex items-center justify-center p-4 bg-orange-50 rounded-full mb-4">
                  <Gift className="h-8 w-8 text-orange-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">
                  {customer.couponsCount} of {business.couponsNeeded}
                </h2>
                <p className="text-gray-500 text-sm mt-1">Stamps accumulated</p>
              </div>

              {/* Progress Bar */}
              <div className="relative pt-1">
                <div className="overflow-hidden h-4 mb-4 text-xs flex rounded-full bg-orange-100">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(progress, 100)}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-orange-600"
                  ></motion.div>
                </div>
              </div>

              {/* Reward Status */}
              <AnimatePresence>
                {isRewardReady ? (
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-green-50 border border-green-200 p-6 rounded-3xl text-center"
                  >
                    <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
                    <h3 className="text-xl font-bold text-green-800">Reward Ready!</h3>
                    <p className="text-green-700 mt-1">Show this screen to the staff to claim your reward.</p>
                  </motion.div>
                ) : (
                  <div className="bg-gray-50 p-6 rounded-3xl text-center border border-gray-100">
                    <p className="text-gray-600">
                      You need <span className="font-bold text-orange-600">{business.couponsNeeded - customer.couponsCount}</span> more stamps for your <span className="font-medium">{business.rewardDescription}</span>.
                    </p>
                  </div>
                )}
              </AnimatePresence>

              {/* Last Stamp Info */}
              {customer.lastPurchaseAt && (
                <div className="flex items-center justify-center text-gray-400 text-xs space-x-2">
                  <Clock className="h-3 w-3" />
                  <span>Last stamp: {formatDistanceToNow(new Date(customer.lastPurchaseAt))} ago</span>
                </div>
              )}

              <button
                onClick={() => {
                  setCustomer(null);
                  setPhone("");
                  setMessage(null);
                }}
                className="w-full py-3 text-gray-500 font-medium hover:text-gray-700 transition-colors"
              >
                Use another number
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
                  "mt-6 p-4 rounded-2xl flex items-start space-x-3",
                  message.type === "success" ? "bg-green-50 text-green-800 border border-green-100" : 
                  message.type === "error" ? "bg-red-50 text-red-800 border border-red-100" : 
                  "bg-blue-50 text-blue-800 border border-blue-100"
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
      <footer className="mt-10 text-center text-gray-400 text-sm">
        <p>© {new Date().getFullYear()} Fideliza Rewards</p>
      </footer>
    </div>
  );
}
