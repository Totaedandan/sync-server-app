import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import iconv from "iconv-lite";

export interface ProductData {
  code: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  subcategory: string;
  barcode: string;
  price: number;
  stock: number;
  bec: string;
  image_url: string;
}

export interface EpuisesData {
  code: string;
}

function sanitizeString(str: string): string {
  return str
    .replace(/�/g, "") // Remove invalid characters
    .replace(/[^\x20-\x7E]/g, "") // Keep only printable ASCII for safety
    .trim();
}

function preprocessCSV(content: string): string {
  const lines = content.split("\n");
  return lines
    .map((line) => {
      const fields = line.split(";");
      return fields
        .map((field) => field.replace(/['"]/g, "")) // Remove quotes
        .join(";");
    })
    .join("\n");
}

export function parseNouveautesCSV(filePath: string): ProductData[] {
  const columns = ["001", "002", "024", "014", "004", "005", "008", "003", "006", "010", "022"];
  try {
    console.log(`Reading Nouveautes CSV file: ${filePath}`);
    const fileContent = readFileSync(filePath);
    const utf8Content = iconv.decode(fileContent, "win1252");
    const processedContent = preprocessCSV(utf8Content);

    if (processedContent.trim().length === 0) {
      throw new Error("Nouveautes CSV file is empty");
    }

    const records: ProductData[] = parse(processedContent, {
      columns,
      delimiter: ";",
      skip_empty_lines: true,
      skip_records_with_error: true,
      trim: true,
      ltrim: true,
      rtrim: true,
      on_record: (record, { lines, error }) => {
        if (error) {
          console.warn(`Skipped line ${lines}: ${error.message}`);
          return null;
        }
        return record;
      },
      cast: (value: string, context: any) => {
        if (context.column === "003") return parseFloat(value) || 0; // Price
        if (context.column === "006") return parseInt(value) || 0; // Stock
        return sanitizeString(value);
      },
    }).map((record: any) => ({
      code: record["001"],
      title: record["002"],
      description: record["024"],
      brand: record["014"],
      category: record["004"],
      subcategory: record["005"],
      barcode: record["008"],
      price: record["003"],
      stock: record["006"],
      bec: record["010"],
      image_url: record["022"],
    }));

    console.log(`Parsed ${records.length} Nouveautes records`);
    return records;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to parse Nouveautes CSV ${filePath}:`, errorMessage);
    throw new Error(`Nouveautes CSV parsing failed: ${errorMessage}`);
  }
}

export function parseEpuisesCSV(filePath: string): EpuisesData[] {
  const columns = ["001", "002", "003", "004", "005", "006"];
  try {
    console.log(`Reading Epuises CSV file: ${filePath}`);
    const fileContent = readFileSync(filePath);
    const utf8Content = iconv.decode(fileContent, "win1252");
    const processedContent = preprocessCSV(utf8Content);

    if (processedContent.trim().length === 0) {
      throw new Error("Epuises CSV file is empty");
    }

    const records: EpuisesData[] = parse(processedContent, {
      columns,
      delimiter: ";",
      skip_empty_lines: true,
      skip_records_with_error: true,
      trim: true,
      ltrim: true,
      rtrim: true,
      on_record: (record, { lines, error }) => {
        if (error) {
          console.warn(`Skipped line ${lines}: ${error.message}`);
          return null;
        }
        return record;
      },
      cast: sanitizeString,
    }).map((record: any) => ({
      code: record["001"],
    }));

    console.log(`Parsed ${records.length} Epuises records`);
    return records;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to parse Epuises CSV ${filePath}:`, errorMessage);
    throw new Error(`Epuises CSV parsing failed: ${errorMessage}`);
  }
}