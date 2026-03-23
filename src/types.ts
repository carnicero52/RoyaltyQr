export interface Business {
  id: string;
  name: string;
  rewardDescription: string;
  couponsNeeded: number;
  cooldownHours: number;
  ownerEmail?: string;
  telegramChatId?: string;
  notificationsEnabled: boolean;
  billingNotificationsEnabled?: boolean;
  marketingNotificationsEnabled?: boolean;
}

export interface Customer {
  id: string; // Phone number
  phone: string;
  name?: string;
  email?: string;
  couponsCount: number;
  lastPurchaseAt?: string;
  businessId: string;
}

export interface Purchase {
  id: string;
  customerId: string;
  businessId: string;
  timestamp: string;
}
