import type { Context, Config } from "@netlify/functions";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = Netlify.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "کلید OpenAI روی Netlify تنظیم نشده است." }, 500);
  try {
    const body = await req.json() as { studentName?: string; taskTitle?: string; rubric?: string; image?: string };
    if (!body.image?.startsWith("data:image/")) return json({ error: "تصویر معتبر ارسال نشده است." }, 400);
    if ((body.image.length * 0.75) > 12_000_000) return json({ error: "حجم تصویر زیاد است. یک عکس واضح‌تر یا کم‌حجم‌تر بفرست." }, 413);

    const system = `تو یک دستیار دقیق تصحیح تکالیف دبستان فارسی‌زبان هستی. هدف، کمک به معلم است نه جایگزینی قضاوت او.
تصویر می‌تواند شامل دست‌خط فارسی، اعداد، عملیات ریاضی، جدول یا چند سؤال باشد. تا جای ممکن متن و پاسخ‌ها را از روی تصویر بخوان.
برای سؤال‌های باز، برابری معنایی را ملاک قرار بده و به تفاوت‌های جزئی جمله‌بندی سخت نگیر. برای ریاضی، اگر پاسخ قابل خواندن است، محاسبه را مستقل بررسی کن.
اگر دست‌خط، تصویر یا پاسخ مبهم است، هرگز حدس قطعی نزن؛ status را review بگذار و confidence را پایین بیاور.
پاسخ فقط و فقط JSON معتبر باشد و هیچ Markdown یا توضیح بیرون JSON نده.
ساختار: {studentName:string, overallStatus:'good'|'review'|'bad', answers:[{question:string,status:'correct'|'incorrect'|'incomplete'|'review',confidence:number,feedback:string}], teacherNote:string}. confidence عددی بین 0 و 1 است. اگر نتوانستی سؤال‌ها را تفکیک کنی، یک مورد review با توضیح روشن ایجاد کن.`;
    const user = `دانش‌آموز: ${body.studentName || "نامشخص"}\nعنوان تکلیف: ${body.taskTitle || "نامشخص"}\nمعیار/پاسخ مورد انتظار معلم: ${body.rubric || "ارزیابی بر اساس محتوای قابل مشاهده و دانش پایه انجام شود."}\nتصویر تکلیف را بررسی کن.`;

    const apiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        input: [{ role: "system", content: [{ type: "input_text", text: system }] }, { role: "user", content: [{ type: "input_text", text: user }, { type: "input_image", image_url: body.image, detail: "high" }] }],
        max_output_tokens: 4000
      })
    });
    const raw = await apiRes.text();
    if (!apiRes.ok) {
      let message = "خطا از سرویس هوش مصنوعی.";
      try { const e = JSON.parse(raw); message = e?.error?.message || message; } catch {}
      return json({ error: message }, apiRes.status);
    }
    const parsed = JSON.parse(raw);
    const outputText = parsed.output_text || parsed.output?.flatMap((o: any) => o.content || []).map((c: any) => c.text || "").join("") || "";
    const clean = outputText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const result = JSON.parse(clean);
    return json(result);
  } catch (error) {
    console.error("check-homework error", error);
    return json({ error: "بررسی تکلیف انجام نشد. لطفاً تصویر واضح‌تری بفرست و دوباره تلاش کن." }, 500);
  }
};

export const config: Config = { path: "/api/check-homework" };
