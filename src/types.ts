export interface Business {
  id: string;
  name: string;
  slogan?: string;
  description?: string;
  rewardLongDescription?: string;
  logoUrl?: string;
  rewardDescription: string;
  rewardImageUrl?: string;
  couponsNeeded: number;
  cooldownHours: number;
  ownerEmail?: string;
  ownerUid?: string;
  telegramChatId?: string;
  telegramToken?: string;
  notificationsEnabled: boolean;
  billingNotificationsEnabled?: boolean;
  marketingNotificationsEnabled?: boolean;
  whatsappEnabled?: boolean;
  whatsappPhone?: string;
  whatsappApiKey?: string;
  gmailUser?: string;
  gmailAppPass?: string;
  currency?: string;
  themeColor?: string;
  darkModeEnabled?: boolean;
  timezone?: string; // e.g., 'America/Caracas'
  notifyEmail?: boolean;
  notifyTelegram?: boolean;
  notifyWhatsapp?: boolean;
  notifySummary?: boolean;
  // New: Loyalty Levels Config
  levels?: {
    silver: { minSpent: number; multiplier: number };
    gold: { minSpent: number; multiplier: number };
  };
}

export interface Staff {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'staff';
  businessId: string;
}

export interface Reminder {
  id: string;
  businessId: string;
  customerId?: string;
  customerIds?: string[];
  type: 'billing' | 'marketing';
  subject: string;
  message: string;
  scheduledAt: string;
  status: 'pending' | 'sent' | 'failed';
  statusMessage?: string;
}

export interface Customer {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  notes?: string;
  status?: 'active' | 'inactive';
  couponsCount: number;
  totalSpent?: number;
  lastPurchaseAt?: string;
  businessId: string;
  // New: Loyalty & Referrals
  level?: 'bronze' | 'silver' | 'gold';
  referredBy?: string;
  referralCount?: number;
  telegramChatId?: string;
  callmebotApiKey?: string;
}

export interface Purchase {
  id: string;
  customerId: string;
  businessId: string;
  amount?: number;
  paymentMethod?: string;
  notes?: string;
  timestamp: string;
  staffId?: string; // Who registered the purchase
}
