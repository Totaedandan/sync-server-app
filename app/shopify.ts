import { Session } from "@shopify/shopify-api";
import { ProductData, EpuisesData } from "~/csv";

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

interface ProductQueryResponse {
  products: {
    edges: Array<{
      node: {
        id: string;
        variants: {
          edges: Array<{
            node: {
              barcode: string;
              inventoryItem: { id: string };
            };
          }>;
        };
      };
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

interface ProductMutationResponse {
  [key: string]: {
    product: {
      id: string;
      variants: {
        edges: Array<{
          node: {
            inventoryItem: { id: string };
          };
        }>;
      };
    };
    userErrors: Array<{ field: string; message: string }>;
  };
}

interface ProductDeleteResponse {
  productDelete: {
    deletedProductId: string;
    userErrors: Array<{ field: string; message: string }>;
  };
}

interface InventoryMutationResponse {
  inventoryAdjustQuantities: {
    userErrors: Array<{ field: string; message: string }>;
  };
}

function sanitizeString(str: string): string {
  return str
    .replace(/�/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .substring(0, 255);
}

function validateProduct(product: ProductData): boolean {
  if (!product.title || product.title.trim() === "") {
    console.error(`Invalid product: Missing title`);
    return false;
  }
  if (!product.barcode || product.barcode.trim() === "") {
    console.error(`Invalid product: ${product.title} - Missing barcode`);
    return false;
  }
  if (isNaN(product.price) || product.price < 0) {
    console.error(`Invalid product: ${product.title} - Invalid price: ${product.price}`);
    return false;
  }
  if (isNaN(product.stock) || product.stock < 0) {
    console.error(`Invalid product: ${product.title} - Invalid stock: ${product.stock}`);
    return false;
  }
  return true;
}

async function shopifyGraphQL<T>(session: Session, query: string, variables: any = {}): Promise<GraphQLResponse<T>> {
  const shopifyGraphQLUrl = `https://${session.shop}/admin/api/2024-04/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": session.accessToken!,
  };

  const maxRetries = 3;
  for (let retry = 0; retry <= maxRetries; retry++) {
    const response = await fetch(shopifyGraphQLUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });

    const json = (await response.json()) as GraphQLResponse<T>;
    if (response.status === 429 || (json.errors?.some((e) => e.message.includes("Throttled")))) {
      const waitTime = 500 * (retry + 1);
      console.log(`GraphQL rate limit hit, retrying in ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      continue;
    }

    if (!response.ok || json.errors) {
      console.error("GraphQL error:", JSON.stringify(json.errors || response.statusText, null, 2));
      throw new Error(`GraphQL request failed: ${JSON.stringify(json.errors || response.statusText)}`);
    }

    return json;
  }
  throw new Error("GraphQL request failed after max retries due to rate limiting");
}

async function fetchExistingProducts(session: Session, codes: string[]): Promise<Map<string, any>> {
  console.log("Fetching existing products from Shopify...");
  const existingProducts = new Map<string, any>();
  const batchSize = 250;

  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    const query = `
      query ($queryString: String!, $after: String) {
        products(first: 250, query: $queryString, after: $after) {
          edges {
            node {
              id
              variants(first: 1) {
                edges {
                  node {
                    barcode
                    inventoryItem {
                      id
                    }
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;
    let hasNextPage = true;
    let endCursor: string | null = null;

    while (hasNextPage) {
      const queryString = `variants.barcode:${batch.map((code) => `"${code}"`).join(" OR ")}`;
      const variables: { queryString: string; after: string | null } = { queryString, after: endCursor };
      const result: GraphQLResponse<ProductQueryResponse> = await shopifyGraphQL<ProductQueryResponse>(session, query, variables);
      const products = result.data.products.edges;

      for (const edge of products) {
        const product = edge.node;
        const barcode = product.variants.edges[0]?.node.barcode;
        if (barcode) {
          existingProducts.set(barcode, {
            id: product.id,
            inventoryItemId: product.variants.edges[0].node.inventoryItem.id,
          });
        }
      }

      hasNextPage = result.data.products.pageInfo.hasNextPage;
      endCursor = result.data.products.pageInfo.endCursor;
    }

    console.log(`Fetched batch ${i / batchSize + 1}/${Math.ceil(codes.length / batchSize)} of existing products`);
  }

  console.log(`Total existing products fetched: ${existingProducts.size}`);
  return existingProducts;
}

async function createOrUpdateProductBatch(
  session: Session,
  products: ProductData[],
  existingProducts: Map<string, any>,
  failedProducts: string[]
): Promise<void> {
  const mutations: string[] = [];
  const variables: Record<string, any> = {};

  products.forEach((product, index) => {
    const sanitizedProduct = {
      ...product,
      title: sanitizeString(product.title),
      description: sanitizeString(product.description || ""),
    };

    const input = {
      title: sanitizedProduct.title,
      descriptionHtml: sanitizedProduct.description,
      vendor: sanitizedProduct.brand || "Unknown",
      productType: sanitizedProduct.category || "Unknown",
      tags: [sanitizedProduct.subcategory || ""].filter(Boolean),
      variants: [
        {
          barcode: sanitizedProduct.barcode,
          price: sanitizedProduct.price,
        },
      ],
    };

    const existingProduct = existingProducts.get(sanitizedProduct.barcode);
    if (existingProduct) {
      mutations.push(`
        update${index}: productUpdate(input: { id: "${existingProduct.id}", title: "${input.title}", descriptionHtml: "${input.descriptionHtml}", vendor: "${input.vendor}", productType: "${input.productType}", tags: [${input.tags.map((tag: string) => `"${tag}"`).join(", ")}], variants: [{ barcode: "${input.variants[0].barcode}", price: "${input.variants[0].price}" }] }) {
          product {
            id
            variants(first: 1) {
              edges {
                node {
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      `);
      variables[`inventoryItemId${index}`] = existingProduct.inventoryItemId;
    } else {
      mutations.push(`
        create${index}: productCreate(input: { title: "${input.title}", descriptionHtml: "${input.descriptionHtml}", vendor: "${input.vendor}", productType: "${input.productType}", tags: [${input.tags.map((tag: string) => `"${tag}"`).join(", ")}], variants: [{ barcode: "${input.variants[0].barcode}", price: "${input.variants[0].price}" }] }) {
          product {
            id
            variants(first: 1) {
              edges {
                node {
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      `);
    }
  });

  if (mutations.length === 0) {
    console.log("No products to create or update in this batch");
    return;
  }

  const query = `mutation { ${mutations.join("\n")} }`;
  const result = await shopifyGraphQL<ProductMutationResponse>(session, query, variables);

  for (let index = 0; index < products.length; index++) {
    const product = products[index];
    const key = existingProducts.get(product.barcode) ? `update${index}` : `create${index}`;
    const mutationResult = result.data[key];
    if (mutationResult.userErrors.length > 0) {
      console.error(`Failed to ${existingProducts.has(product.barcode) ? "update" : "create"} product ${product.title}:`, mutationResult.userErrors);
      failedProducts.push(`Failed to ${existingProducts.has(product.barcode) ? "update" : "create"} product ${product.title}: ${JSON.stringify(mutationResult.userErrors)}`);
    } else {
      console.log(`Successfully ${existingProducts.has(product.barcode) ? "updated" : "created"} product: ${product.title}`);
      const inventoryItemId = mutationResult.product.variants.edges[0].node.inventoryItem.id;
      variables[`inventoryItemId${index}`] = inventoryItemId;

      const productImageUrl = product.image_url?.trim();
      if (productImageUrl && !existingProducts.has(product.barcode)) {
        try {
          const uploadResponse = await fetch(`https://${session.shop}/admin/api/2024-04/products/${mutationResult.product.id.split("/").pop()}/images.json`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": session.accessToken!,
            },
            body: JSON.stringify({
              image: {
                src: productImageUrl,
              },
            }),
          });

          if (!uploadResponse.ok) {
            throw new Error(`Failed to upload image: ${await uploadResponse.text()}`);
          }
          console.log(`✅ Image uploaded for ${product.title}`);
        } catch (err) {
          console.error(`❌ Error uploading image for ${product.title}:`, err);
          failedProducts.push(`Image upload failed for ${product.title}: ${String(err)}`);
        }
      }
    }
  }

  const inventoryAdjustments = products.map((product, index) => ({
    inventoryItemId: variables[`inventoryItemId${index}`],
    availableDelta: Math.floor(product.stock),
  }));

  const inventoryMutation = `
    mutation ($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors {
          field
          message
        }
      }
    }
  `;

  const inventoryResult = await shopifyGraphQL<InventoryMutationResponse>(session, inventoryMutation, {
    input: {
      reason: "correction",
      name: "available",
      changes: inventoryAdjustments.map((adj) => ({
        inventoryItemId: adj.inventoryItemId,
        delta: adj.availableDelta,
        locationId: "gid://shopify/Location/105222275414",
      })),
    },
  });

  if (inventoryResult.data.inventoryAdjustQuantities.userErrors.length > 0) {
    console.error("Failed to update inventory:", inventoryResult.data.inventoryAdjustQuantities.userErrors);
    products.forEach((product) => {
      failedProducts.push(`Failed to update inventory for ${product.title}: ${JSON.stringify(inventoryResult.data.inventoryAdjustQuantities.userErrors)}`);
    });
  } else {
    console.log(`Successfully updated inventory for ${products.length} products`);
  }
}

async function setEpuisesStock(
  session: Session,
  epuises: EpuisesData[],
  existingProducts: Map<string, any>,
  failedProducts: string[]
): Promise<void> {
  console.log("Processing Epuises products...");
  const inventoryAdjustments: { inventoryItemId: string; availableDelta: number }[] = [];

  epuises.forEach((product) => {
    const existingProduct = existingProducts.get(product.code);
    if (existingProduct) {
      inventoryAdjustments.push({
        inventoryItemId: existingProduct.inventoryItemId,
        availableDelta: 0,
      });
      console.log(`Prepared stock to 0 for Epuises product: ${product.code}`);
    } else {
      console.log(`Epuises product ${product.code} not found in Shopify, skipping...`);
      failedProducts.push(`Epuises product not found: ${product.code}`);
    }
  });

  if (inventoryAdjustments.length === 0) {
    console.log("No Epuises products to update stock for");
    return;
  }

  const inventoryMutation = `
    mutation ($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors {
          field
          message
        }
      }
    }
  `;

  const inventoryResult = await shopifyGraphQL<InventoryMutationResponse>(session, inventoryMutation, {
    input: {
      reason: "correction",
      name: "available",
      changes: inventoryAdjustments.map((adj) => ({
        inventoryItemId: adj.inventoryItemId,
        delta: adj.availableDelta,
        locationId: "gid://shopify/Location/105222275414",
      })),
    },
  });

  if (inventoryResult.data.inventoryAdjustQuantities.userErrors.length > 0) {
    console.error("Failed to update Epuises inventory:", inventoryResult.data.inventoryAdjustQuantities.userErrors);
    epuises.forEach((product) => {
      failedProducts.push(`Failed to update Epuises inventory for ${product.code}: ${JSON.stringify(inventoryResult.data.inventoryAdjustQuantities.userErrors)}`);
    });
  } else {
    console.log(`Successfully set stock to 0 for ${inventoryAdjustments.length} Epuises products`);
  }
}

async function deleteEpuisesProducts(
  session: Session,
  epuises: EpuisesData[],
  existingProducts: Map<string, any>,
  failedProducts: string[]
): Promise<void> {
  console.log("Deleting Epuises products...");
  const mutations: string[] = [];

  epuises.forEach((product, index) => {
    const existingProduct = existingProducts.get(product.code);
    if (existingProduct) {
      mutations.push(`
        delete${index}: productDelete(input: { id: "${existingProduct.id}" }) {
          deletedProductId
          userErrors {
            field
            message
          }
        }
      `);
    } else {
      console.log(`Epuises product ${product.code} not found in Shopify, skipping...`);
      failedProducts.push(`Epuises product not found: ${product.code}`);
    }
  });

  if (mutations.length === 0) {
    console.log("No Epuises products to delete");
    return;
  }

  const query = `mutation { ${mutations.join("\n")} }`;
  const result = await shopifyGraphQL<any>(session, query);

  epuises.forEach((product, index) => {
    const existingProduct = existingProducts.get(product.code);
    if (existingProduct) {
      const mutationResult = result.data[`delete${index}`];
      if (mutationResult.userErrors.length > 0) {
        console.error(`Failed to delete product ${product.code}:`, mutationResult.userErrors);
        failedProducts.push(`Failed to delete product ${product.code}: ${JSON.stringify(mutationResult.userErrors)}`);
      } else {
        console.log(`Deleted product ${product.code}`);
      }
    }
  });
}

export async function syncProductsWithShopify(
  session: Session,
  nouveautes: ProductData[],
  epuises: EpuisesData[],
  progressCallback: (increment: number) => void
): Promise<void> {
  console.log("Starting Shopify sync with GraphQL...");
  const batchSize = 50;
  const failedProducts: string[] = [];

  const allCodes = [...nouveautes, ...epuises].map((p) => p.code);
  const existingProducts = await fetchExistingProducts(session, allCodes);
  progressCallback(10);

  for (let i = 0; i < nouveautes.length; i += batchSize) {
    const batch = nouveautes.slice(i, i + batchSize);
    const validBatch = batch.filter((product) => {
      if (!validateProduct(product)) {
        failedProducts.push(`Validation failed for ${product.title}`);
        return false;
      }
      return true;
    });

    await createOrUpdateProductBatch(session, validBatch, existingProducts, failedProducts);
    console.log(`Processed Nouveautes batch ${i / batchSize + 1}/${Math.ceil(nouveautes.length / batchSize)}`);
    progressCallback((80 / Math.ceil(nouveautes.length / batchSize)) * validBatch.length);
  }

  // Choose Epuises handling based on environment variable
  const shouldDeleteEpuises = process.env.SHOPIFY_DELETE_EPUISÉS === "true";
  if (shouldDeleteEpuises) {
    await deleteEpuisesProducts(session, epuises, existingProducts, failedProducts);
  } else {
    await setEpuisesStock(session, epuises, existingProducts, failedProducts);
  }
  console.log(`Processed Epuises products`);
  progressCallback(10);

  console.log("Shopify sync completed");
  if (failedProducts.length > 0) {
    console.error(`Failed to sync ${failedProducts.length} products`);
    failedProducts.forEach((error) => console.error(error));
  }
}