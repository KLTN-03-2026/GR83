import dotenv from 'dotenv';

dotenv.config({ path: './backend/.env' });

async function verifyDatabaseStorage(getSqlServerPool) {
  const pool = await getSqlServerPool();

  const tableResult = await pool.request().query(`
    SELECT name
    FROM sys.tables
    WHERE name IN ('ChatbotConversation', 'ChatbotMessage')
    ORDER BY name;
  `);

  const countResult = await pool.request().query(`
    SELECT
      (SELECT COUNT(1) FROM dbo.ChatbotConversation) AS conversations,
      (SELECT COUNT(1) FROM dbo.ChatbotMessage) AS messages;
  `);

  return {
    tables: (tableResult.recordset ?? []).map((row) => row.name),
    counts: countResult.recordset?.[0] ?? { conversations: 0, messages: 0 },
  };
}

async function verifyAssistantResponse(askAssistantChat) {
  const response = await askAssistantChat({
    accountId: 'TK0001',
    roleCode: 'Q2',
    message: 'Hôm nay tôi nên chuẩn bị gì khi đi xe máy đường xa?',
  });

  return {
    success: Boolean(response?.success),
    provider: response?.assistantMessage?.provider ?? response?.responseMeta?.provider ?? null,
    model: response?.assistantMessage?.model ?? response?.responseMeta?.model ?? null,
    preview: String(response?.assistantMessage?.text ?? '').slice(0, 220),
  };
}

(async () => {
  const [{ getSqlServerPool }, { askAssistantChat }] = await Promise.all([
    import('../src/services/database.service.js'),
    import('../src/services/assistantChat.service.js'),
  ]);

  const envCheck = {
    hasGeminiApiKey: Boolean(String(process.env.GEMINI_API_KEY ?? '').trim()),
    geminiModel: String(process.env.GEMINI_MODEL ?? '').trim() || null,
    geminiTimeoutMs: String(process.env.GEMINI_TIMEOUT_MS ?? '').trim() || null,
  };

  const storageCheck = await verifyDatabaseStorage(getSqlServerPool);
  const assistantCheck = await verifyAssistantResponse(askAssistantChat);

  console.log(JSON.stringify({ envCheck, storageCheck, assistantCheck }, null, 2));
})().catch((error) => {
  console.error('VERIFY_ASSISTANT_CHAT_FAILED');
  console.error(error?.message || error);
  process.exit(1);
});
