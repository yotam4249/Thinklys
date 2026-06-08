import { ThinklysApiError, ThinklysClient } from "../data/thinklysClient.js";
import {
  ToolError,
  searchDocuments,
  listDocuments,
  getDocumentSection,
  summarizeDocument,
} from "./index.js";

function header(label: string): void {
  console.log(`\n=== ${label} ===`);
}

function compact(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) return String(value);
  if (json.length <= 800) return json;
  return `${json.slice(0, 800)}…[truncated ${json.length - 800} chars]`;
}

async function main(): Promise<void> {
  const client = new ThinklysClient();
  const ctx = { client };

  header("list_documents");
  const listed = await listDocuments({}, ctx);
  console.log(`documents=${listed.documents.length}`);
  console.log(compact(listed));

  header('search_documents { query: "test", top_k: 3 }');
  const searched = await searchDocuments({ query: "test", top_k: 3 }, ctx);
  console.log(`results=${searched.results.length}`);
  console.log(compact(searched));

  const firstDoc = listed.documents[0];
  if (firstDoc) {
    header(`get_document_section (no query) { document_id: "${firstDoc.document_id}" }`);
    const noQuery = await getDocumentSection(
      { document_id: firstDoc.document_id },
      ctx,
    );
    console.log(`results=${noQuery.results.length}`);
    console.log(compact(noQuery));

    header(`get_document_section (with query) { document_id, query: "introduction" }`);
    const withQuery = await getDocumentSection(
      { document_id: firstDoc.document_id, query: "introduction" },
      ctx,
    );
    console.log(`results=${withQuery.results.length}`);
    console.log(compact(withQuery));

    header(`summarize_document { document_id: "${firstDoc.document_id}" }`);
    const summarized = await summarizeDocument(
      { document_id: firstDoc.document_id },
      ctx,
    );
    console.log(
      `chunks=${summarized.chunks.length} text_len=${summarized.concatenated_text.length}`,
    );
    console.log(compact({ document_id: summarized.document_id, chunks: summarized.chunks.length }));
  } else {
    header("get_document_section / summarize_document");
    console.log("Skipped: list_documents returned no documents for this user.");
  }
}

main().catch((err: unknown) => {
  console.error("\n[test-tools] FAILED");
  if (err instanceof ToolError) {
    console.error(`tool error code=${err.code} message=${err.message}`);
  } else if (err instanceof ThinklysApiError) {
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
