# Shopify Sync Products wioth CGN Server App

## Overview
This is a Shopify app built with Remix for synchronizing products between CSV files and a Shopify store. The app provides a user interface to trigger product updates and tracks progress with a custom progress bar. It includes detailed logging for debugging and integrates with Shopify's GraphQL and REST APIs.


### Features

· Synchronizes Nouveautes (new products) and Epuises (out-of-stock products) from CSV files.
· Displays a dynamic progress bar during synchronization.
· Logs detailed steps (e.g., product creation, inventory updates) for monitoring.
· Supports configurable handling of Epuises products (set stock to 0 or delete).


### Prerequisites

·Node.js (latest LTS version recommended)
·Shopify CLI
·Shopify API credentials (stored in .env)
·Access to the repository: https://github.com/Totaedandan/sync-server-app.git


### Installation
Clone the repository:

```shell
git clone https://github.com/Totaedandan/sync-server-app.git
cd sync-server-app
```

Clean build (recommended):

```shell
npm cache clean --force
rm -rf node_modules package-lock.json
rm -rf .vite
rm -rf build
```

Install dependencies:

```shell
npm install
```

Set up environment variables in a .env file:

```shell
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SHOPIFY_APP_URL=http://localhost:5173
SHOPIFY_DELETE_EPUISÉS=true|false (optional, defaults to false)
```

Run the app:

```shell
shopify app dev
```

Open http://localhost:5173 in your browser.
Click "Faire mise à jour" to start the sync.


### Usage

· Place CSV files (StockNouveautesCgn075257.csv and StockEpuisesCgn075257.csv) in the temp directory.
· The app will parse these files and sync products with Shopify.
· Monitor progress via the UI and console logs.


### Notes

· fps.ts Issue: The fps.ts file is currently not functional due to server-side issues. As a temporary workaround, zip files with the same names are provided in the repository. Once the server is repaired, fps.ts will work as intended by replacing the zip files with the restored server functionality.

·Ensure shopify.app.toml is configured with the correct redirect_urls and scopes for your Shopify app.


### Troubleshooting

· App Fails to Start: Verify .env contains valid SHOPIFY_API_KEY, SHOPIFY_API_SECRET, and SHOPIFY_APP_URL.
· Progress Bar Not Updating: Check console logs for backend errors.
· CSV Parsing Issues: Ensure CSV files are in the temp directory and have the correct format.
· Authentication Errors: Use a GitHub Personal Access Token (PAT) for HTTPS pushes or set up SSH keys.


### Contributing

1. Fork the repository.
2. Create a feature branch: git checkout -b feature/your-feature.
3. Commit changes: git commit -m "feat: add your feature".
4. Push to the branch: git push origin feature/your-feature.
5. Open a Pull Request.
