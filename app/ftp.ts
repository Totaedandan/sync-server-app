import { Client } from "basic-ftp";
import { createWriteStream, createReadStream, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { Extract } from "unzipper";

// Validate environment variables
const requiredEnvVars = ["FTP_HOST", "FTP_USER", "FTP_PASSWORD"];
requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} environment variable is not set`);
  }
});

interface DownloadResult {
  nouveautesFile: string;
  epuisesFile: string;
}

async function withRetry<T>(operation: () => Promise<T>, maxRetries: number = 2, delayMs: number = 1000): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.warn(`Attempt ${attempt} failed: ${error}. Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Max retries reached");
}

export async function downloadAndProcessFiles(): Promise<DownloadResult> {
  const client = new Client();
  client.ftp.verbose = true;

  const tempDir = join(process.cwd(), "temp");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const nouveautesZip = join(tempDir, "StockNouveautesCgn.zip");
  const epuisesZip = join(tempDir, "StockEpuisesCgn.zip");

  try {
    console.log("Connecting to FTP server...");
    await withRetry(() =>
      client.access({
        host: process.env.FTP_HOST!,
        user: process.env.FTP_USER!,
        password: process.env.FTP_PASSWORD!,
        secure: false,
      })
    );

    console.log("Downloading StockNouveautesCgn.zip...");
    await withRetry(() => client.downloadTo(createWriteStream(nouveautesZip), "StockNouveautesCgn.zip"));
    console.log("Downloaded StockNouveautesCgn.zip successfully");

    console.log("Downloading StockEpuisesCgn.zip...");
    await withRetry(() => client.downloadTo(createWriteStream(epuisesZip), "StockEpuisesCgn.zip"));
    console.log("Downloaded StockEpuisesCgn.zip successfully");

    console.log(`Extracting ${nouveautesZip} to ${tempDir}...`);
    await new Promise<void>((resolve, reject) => {
      createReadStream(nouveautesZip)
        .pipe(Extract({ path: tempDir }))
        .on("close", () => {
          console.log(`Extracted ${nouveautesZip} to ${tempDir}`);
          resolve();
        })
        .on("error", (err: Error) => {
          console.error(`Error extracting ${nouveautesZip}:`, err.message);
          reject(err);
        });
    });

    console.log(`Extracting ${epuisesZip} to ${tempDir}...`);
    await new Promise<void>((resolve, reject) => {
      createReadStream(epuisesZip)
        .pipe(Extract({ path: tempDir }))
        .on("close", () => {
          console.log(`Extracted ${epuisesZip} to ${tempDir}`);
          resolve();
        })
        .on("error", (err: Error) => {
          console.error(`Error extracting ${epuisesZip}:`, err.message);
          reject(err);
        });
    });

    console.log(`Scanning ${tempDir} for CSV files...`);
    const filesInDir = readdirSync(tempDir);
    const nouveautesCsv = filesInDir.find((file) => file.startsWith("StockNouveautesCgn") && file.endsWith(".csv"));
    const epuisesCsv = filesInDir.find((file) => file.startsWith("StockEpuisesCgn") && file.endsWith(".csv"));

    if (!nouveautesCsv) {
      throw new Error("Nouveautes CSV not found in temp directory");
    }
    if (!epuisesCsv) {
      throw new Error("Epuises CSV not found in temp directory");
    }

    const nouveautesCsvPath = join(tempDir, nouveautesCsv);
    const epuisesCsvPath = join(tempDir, epuisesCsv);
    console.log(`Found Nouveautes CSV: ${nouveautesCsvPath}`);
    console.log(`Found Epuises CSV: ${epuisesCsvPath}`);

    return {
      nouveautesFile: nouveautesCsvPath,
      epuisesFile: epuisesCsvPath,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("FTP download or extraction failed:", errorMessage);
    throw new Error(`Failed to download or process files: ${errorMessage}`);
  } finally {
    client.close();
    console.log(`Files retained in ${tempDir} for debugging`);
  }
}