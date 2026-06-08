import { ThinklysApiError, ThinklysClient } from "./thinklysClient.js";

function header(label: string): void {
  console.log(`\n=== ${label} ===`);
}

function pretty(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const client = new ThinklysClient();

  header("listDocuments");
  const documents = await client.listDocuments();
  pretty(documents);

  header('search("test", 3)');
  const searchResults = await client.search("test", 3);
  pretty(searchResults);

  const firstDoc = documents[0];
  if (firstDoc) {
    header(`getSection("${firstDoc.document_id}", "introduction")`);
    const section = await client.getSection(firstDoc.document_id, "introduction");
    pretty(section);

    header(`getChunks("${firstDoc.document_id}", 10)`);
    const chunks = await client.getChunks(firstDoc.document_id, 10);
    pretty(chunks);
  } else {
    header("getSection / getChunks");
    console.log("Skipped: listDocuments returned no documents for this user.");
  }
}

main().catch((err: unknown) => {
  console.error("\n[test-fetch] FAILED");
  if (err instanceof ThinklysApiError) {
    console.error(`status=${err.status} message=${err.message}`);
    console.error("body:");
    console.error(JSON.stringify(err.body, null, 2));
  } else if (err instanceof Error) {
    console.error(err.stack ?? err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
