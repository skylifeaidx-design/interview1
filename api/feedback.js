const DATABASE_ID = process.env.NOTION_DATABASE_ID || "396f46a3-8038-8168-8be6-e9f6423c71c0";
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

function truncate(value, max = 1800) {
  return String(value || "").trim().slice(0, max);
}

function title(content) {
  return { title: [{ type: "text", text: { content: truncate(content || "상담사 의견", 120) } }] };
}

function richText(content) {
  const text = truncate(content);
  return text ? { rich_text: [{ type: "text", text: { content: text } }] } : { rich_text: [] };
}

function select(name) {
  return name ? { select: { name: truncate(name, 80) } } : { select: null };
}

function multiSelect(values) {
  const items = Array.isArray(values) ? values : [];
  return { multi_select: items.filter(Boolean).map((name) => ({ name: truncate(name, 80) })) };
}

function number(value) {
  const parsed = Number(value);
  return { number: Number.isFinite(parsed) ? parsed : null };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "POST 요청만 지원합니다." });
  }

  const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  if (!token) {
    return res.status(500).json({ message: "서버 환경변수 NOTION_TOKEN이 설정되지 않았습니다." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  if (!truncate(body.title) || !truncate(body.suggestion)) {
    return res.status(400).json({ message: "의견 제목과 제안 내용은 필수입니다." });
  }

  const notionPayload = {
    parent: { database_id: DATABASE_ID },
    properties: {
      "의견 제목": title(body.title),
      "제출자": richText(body.author),
      "센터": select(body.center),
      "역할": select(body.role),
      "관련 업무": multiSelect(body.workTypes),
      "의견 유형": select(body.type),
      "우선순위": select(body.priority),
      "불편도": number(body.painScore),
      "현재 문제": richText(body.problem),
      "제안 내용": richText(body.suggestion),
      "기대 효과": richText(body.impact),
      "연락 가능": { checkbox: Boolean(body.contactable) },
      "페이지 버전": richText(body.pageVersion),
      "제출일": { date: { start: new Date().toISOString() } },
      "상태": select("신규"),
    },
  };

  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.replace(/^Bearer\s+/i, "")}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(notionPayload),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return res.status(response.status).json({ message: result.message || "Notion 저장에 실패했습니다.", detail: result });
  }

  return res.status(200).json({ ok: true, id: result.id, url: result.url });
};
