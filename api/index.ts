// Diagnostic route directly in the API entry point
export default async function handler(req: any, res: any) {
  console.log(`[Vercel/API] Request received: ${req.method} ${req.url}`);
  
  try {
    // Diagnostic route
    if (req.url === "/api/test") {
      return res.json({ 
        message: "API entry point reached", 
        time: new Date().toISOString(),
        vercel: !!process.env.VERCEL,
        env: {
          hasFirebaseKey: !!process.env.VITE_FIREBASE_API_KEY,
          nodeEnv: process.env.NODE_ENV
        }
      });
    }

    // Dynamic import to catch top-level errors in server.ts
    console.log("[Vercel/API] Importing server.ts...");
    const { default: app } = await import("../server");
    console.log("[Vercel/API] server.ts imported successfully");
    
    // Pass to Express app
    return app(req, res);
  } catch (error: any) {
    console.error("[Vercel/API] Fatal error in API entry point:", error);
    res.status(500).json({ 
      error: "Internal Server Error during initialization", 
      message: error.message,
      stack: error.stack,
      hint: "Check if all dependencies are correctly installed and environment variables are set."
    });
  }
}
