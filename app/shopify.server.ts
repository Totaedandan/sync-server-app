import { shopifyApi, LATEST_API_VERSION, BillingInterval, Session } from "@shopify/shopify-api";
import { restResources } from "@shopify/shopify-api/rest/admin/2024-04";
import { AppDistribution, DeliveryMethod, shopifyApp } from "@shopify/shopify-app-remix/server";

// Custom in-memory session storage implementation
class CustomMemorySessionStorage {
  private store: Map<string, Session> = new Map();

  async storeSession(session: Session): Promise<boolean> {
    try {
      this.store.set(session.id, session);
      return true;
    } catch (error) {
      console.error("Failed to store session:", error);
      return false;
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    try {
      return this.store.get(id);
    } catch (error) {
      console.error(`Failed to load session ${id}:`, error);
      return undefined;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      this.store.delete(id);
      return true;
    } catch (error) {
      console.error(`Failed to delete session ${id}:`, error);
      return false;
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    try {
      ids.forEach((id) => this.store.delete(id));
      return true;
    } catch (error) {
      console.error("Failed to delete sessions:", error);
      return false;
    }
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    try {
      const sessions = Array.from(this.store.values()).filter((session) => session.shop === shop);
      return sessions;
    } catch (error) {
      console.error(`Failed to find sessions for shop ${shop}:`, error);
      return [];
    }
  }
}

// Initialize Shopify app
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  scopes: ["write_products", "read_products"],
  apiVersion: LATEST_API_VERSION,
  appUrl: process.env.SHOPIFY_APP_URL || "https://1a0f-173-244-158-46.ngrok-free.app",
  sessionStorage: new CustomMemorySessionStorage(),
  distribution: AppDistribution.AppStore,
  restResources,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
  },
  billing: undefined, // Add billing configuration if needed
});

export default shopify;
export const apiVersion = LATEST_API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;