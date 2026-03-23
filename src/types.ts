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
  telegramChatId?: string;
  notificationsEnabled: boolean;
  billingNotificationsEnabled?: boolean;
  marketingNotificationsEnabled?: boolean;
  whatsappEnabled?: boolean;
  whatsappPhone?: string;
  whatsappApiKey?: string;
  currency?: string;
}

export interface Reminder {
  id: string;
  businessId: string;
  customerId?: string; // Optional for individual, null for batch
  customerIds?: string[]; // For batch
  type: 'billing' | 'marketing';
  subject: string;
  message: string;
  scheduledAt: string;
  status: 'pending' | 'sent' | 'failed';
}

export interface Customer {
  id: string; // Phone number
  phone: string;
  name?: string;
  email?: string;
  notes?: string;
  status?: 'active' | 'inactive';
  couponsCount: number;
  totalSpent?: number;
  lastPurchaseAt?: string;
  businessId: string;
}

export interface Purchase {
  id: string;
  customerId: string;
  businessId: string;
  amount?: number;
  paymentMethod?: string;
  notes?: string;
  timestamp: string;
}
