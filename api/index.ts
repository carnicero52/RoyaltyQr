import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Diagnostic route directly in the API entry point
export default async function handler(req: any, res: any) {
  console.log(`[Vercel/API] Request received: ${req.method} ${req.url}`);
  
  try {
    // Diagnostic route
    if (req.url === "/api/test") {
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

    // Dynamic import to catch top-level errors in _server.ts
    console.log("[Vercel/API] Importing _server.ts...");
    let serverModule;
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      
      try {
        console.log("[Vercel/API] CWD files:", fs.readdirSync(process.cwd()));
        console.log("[Vercel/API] api/ files:", fs.readdirSync(path.join(process.cwd(), "api")));
      } catch (e) {}

      let serverPath = path.join(process.cwd(), "server.ts");
      console.log("[Vercel/API] CWD path:", serverPath, "Exists:", fs.existsSync(serverPath));
      
      if (!fs.existsSync(serverPath)) {
        const jsPath = serverPath.replace(".ts", ".js");
        if (fs.existsSync(jsPath)) {
          serverPath = jsPath;
          console.log("[Vercel/API] Using .js path:", serverPath);
        } else {
          serverPath = path.join(__dirname, "..", "server.ts");
          console.log("[Vercel/API] __dirname path:", serverPath, "Exists:", fs.existsSync(serverPath));
          if (!fs.existsSync(serverPath)) {
            const jsDirnamePath = serverPath.replace(".ts", ".js");
            if (fs.existsSync(jsDirnamePath)) {
              serverPath = jsDirnamePath;
              console.log("[Vercel/API] Using __dirname .js path:", serverPath);
            }
          }
        }
      }

      try {
        // Try absolute path first
        serverModule = await import(serverPath);
      } catch (tsError: any) {
        console.log("[Vercel/API] Failed to import absolute path, trying relative...");
        try {
          serverModule = await import("../server");
        } catch (jsError: any) {
          console.log("[Vercel/API] All import attempts failed.");
          throw new Error(`Failed to import server module: TS Error: ${tsError.message}, JS Error: ${jsError.message}`);
        }
      }
    } catch (importError: any) {
      console.error("[Vercel/API] Failed to import _server.ts:", importError);
      return res.status(500).json({
        error: "Failed to load server logic",
        message: importError.message,
        stack: importError.stack,
        path: "../server",
        cwd: process.cwd()
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
