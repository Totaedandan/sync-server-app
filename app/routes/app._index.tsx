import { json, redirect } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { useState, useEffect } from "react";
import { parseNouveautesCSV, parseEpuisesCSV, ProductData, EpuisesData } from "~/csv";
import { syncProductsWithShopify } from "~/shopify";
import { authenticate } from "~/shopify.server";
import { join } from "path";
import { existsSync, readdirSync } from "fs";
import {
  AppProvider,
  Page,
  Card,
  Button,
  ProgressBar,
  Text,
  Frame,
  Layout,
} from "@shopify/polaris";

// Minimal i18n configuration
const i18n = {
  Polaris: {
    Frame: {
      skipToContent: "Skip to content",
    },
  },
};

// Frontend Component
export default function Index() {
  const actionData = useActionData<{
    progress: number;
    error?: string;
    success?: boolean;
    message?: string;
    failedProducts?: string[];
  }>();
  const [progress, setProgress] = useState(0);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (actionData?.progress) {
      setProgress(actionData.progress);
      if (actionData.progress === 100) {
        setShowModal(false);
      }
    }
    if (actionData?.error) {
      setShowModal(false);
      alert(`Error: ${actionData.error}`);
    }
    if (actionData?.success !== undefined) {
      setShowModal(false);
      alert(actionData.message);
    }
  }, [actionData]);

  const handleSync = () => {
    setShowModal(true);
    setProgress(0);
  };

  return (
    <AppProvider i18n={i18n}>
      <Frame>
        <Page title="CGN Product Synchronization">
          <Layout>
            <Layout.Section>
              <Card>
                <div style={{ padding: '1rem', textAlign: 'center' }}>
                  <Form method="post">
                    <Button
                      variant="primary"
                      onClick={handleSync}
                      submit
                      size="large"
                      fullWidth
                    >
                      Faire mise à jour
                    </Button>
                  </Form>
                </div>
              </Card>
            </Layout.Section>
            {showModal && (
              <Layout.Section>
                <Card>
                  <div style={{ padding: '1rem', textAlign: 'center' }}>
                    <Text variant="headingMd" as="h2">
                      Mise à jour en cours...
                    </Text>
                  </div>
                  <div style={{ padding: '1rem', textAlign: 'center' }}>
                    <ProgressBar
                      progress={progress}
                      size="large"
                      animated
                    />
                    <Text variant="bodyMd" as="p" alignment="center">
                      {progress}%
                    </Text>
                  </div>
                </Card>
              </Layout.Section>
            )}
          </Layout>
        </Page>
      </Frame>
    </AppProvider>
  );
}

// Loader to handle authentication
export async function loader({ request }: { request: Request }) {
  const { session } = await authenticate.admin(request);
  if (!session) {
    throw redirect("/auth/login");
  }
  return json({});
}

// Backend Action
export async function action({ request }: { request: Request }) {
  const { session } = await authenticate.admin(request);
  if (!session) {
    throw redirect("/auth/login");
  }

  console.log(`Starting product sync process at ${new Date().toISOString()}`);
  let progress = 0;
  const updateProgress = (increment: number) => {
    progress = Math.min(progress + increment, 100);
    return progress;
  };

  try {
    // Use existing CSV files in temp directory
    const tempDir = join(process.cwd(), "temp");
    console.log(`Scanning ${tempDir} for CSV files...`);
    const files = readdirSync(tempDir);
    const nouveautesCSV = files.find((f) => f.startsWith("StockNouveautesCgn") && f.endsWith(".csv"));
    const epuisesCSV = files.find((f) => f.startsWith("StockEpuisesCgn") && f.endsWith(".csv"));

    if (!nouveautesCSV || !epuisesCSV) {
      throw new Error("CSV files not found");
    }

    const nouveautesFile = join(tempDir, nouveautesCSV);
    const epuisesFile = join(tempDir, epuisesCSV);

    // Verify files exist
    if (!existsSync(nouveautesFile)) {
      throw new Error(`Nouveautes CSV file not found at ${nouveautesFile}`);
    }
    if (!existsSync(epuisesFile)) {
      throw new Error(`Epuises CSV file not found at ${epuisesFile}`);
    }

    console.log("Using existing Nouveautes CSV:", nouveautesFile);
    console.log("Using existing Epuises CSV:", epuisesFile);
    updateProgress(20); // Mimics FTP complete progress from other project

    // Parse CSVs
    console.log("Parsing Nouveautes CSV...");
    const nouveautes: ProductData[] = parseNouveautesCSV(nouveautesFile);
    console.log(`Parsed ${nouveautes.length} Nouveautes products`);
    const validNouveautes = nouveautes.filter((p) => p.code && p.title);
    console.log(`Valid Nouveautes products: ${validNouveautes.length} / ${nouveautes.length}`);
    updateProgress(20);

    console.log("Parsing Epuises CSV...");
    const epuises: EpuisesData[] = parseEpuisesCSV(epuisesFile);
    console.log(`Parsed ${epuises.length} Epuises products`);
    const validEpuises = epuises.filter((p) => p.code);
    console.log(`Valid Epuises products: ${validEpuises.length} / ${epuises.length}`);
    updateProgress(10);

    // Sync with Shopify
    console.log("Syncing products with Shopify...");
    const failedProducts: string[] = [];
    await syncProductsWithShopify(session, validNouveautes, validEpuises, updateProgress);
    updateProgress(100 - progress); // Ensure progress reaches 100%

    const resultMessage = `Successfully synced ${validNouveautes.length} Nouveautes and ${validEpuises.length} Epuises products${failedProducts.length > 0 ? ` with ${failedProducts.length} failures` : ""}`;
    console.log(resultMessage);
    return json({
      progress,
      success: failedProducts.length === 0,
      message: resultMessage,
      failedProducts,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Sync failed:", errorMessage);
    return json(
      {
        progress,
        success: false,
        message: `Failed to sync products: ${errorMessage}`,
        failedProducts: [],
      },
      { status: 500 }
    );
  }
}