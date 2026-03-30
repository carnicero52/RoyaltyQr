// Diagnostic route directly in the API entry point
export default async function handler(req: any, res: any) {
  console.log(`[Vercel/API] Request received: ${req.method} ${req.url}`);
  
  try {
    // Diagnostic route
    if (req.url === "/api/test") {
      const fs = await import("fs");
      const path = await import("path");
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      const configExists = fs.existsSync(configPath);
      
      return res.json({ 
        message: "API entry point reached", 
        time: new Date().toISOString(),
        vercel: !!process.env.VERCEL,
        cwd: process.cwd(),
        configExists,
        env: {
          hasFirebaseKey: !!(process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY),
          hasProjectId: !!(process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID),
          hasDbId: !!(process.env.VITE_FIREBASE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID),
          nodeEnv: process.env.NODE_ENV
        }
      });
    }

    // Dynamic import to catch top-level errors in server.ts
    console.log("[Vercel/API] Importing server.ts...");
    let serverModule;
    try {
      serverModule = await import("./server");
    } catch (importError: any) {
      console.error("[Vercel/API] Failed to import server.ts:", importError);
      return res.status(500).json({
        error: "Failed to load server logic",
        message: importError.message,
        stack: importError.stack,
        path: "./server"
      });
    }

    const app = serverModule.default;
    if (!app) {
      console.error("[Vercel/API] server.ts does not have a default export");
      return res.status(500).json({
        error: "Invalid server configuration",
        message: "The server module does not export a default Express app."
      });
    }

    console.log("[Vercel/API] server.ts imported successfully");
    
    // Pass to Express app
    return app(req, res);
  } catch (error: any) {
    console.error("[Vercel/API] Fatal error in API entry point:", error);
    res.status(500).json({ 
      error: `Internal Server Error: ${error.message}`, 
      message: error.message,
      stack: error.stack,
      hint: "Check if all dependencies are correctly installed and environment variables are set."
    });
  }
}
