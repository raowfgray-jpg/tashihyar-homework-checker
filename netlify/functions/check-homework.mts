import type { Context, Config } from "@netlify/functions";

type CheckRequest = {
  studentName?: string;
  taskTitle?: string;
  rubric?: string;
  image?: string;
};

type AnswerResult = {
  question: string;
  status: "correct" | "incorrect" | "incomplete" | "review";
  confidence: number;
  feedback: string;
};

type CheckResult = {
  studentName: string;
  overallStatus: "good" | "review" | "bad";
  answers: AnswerResult[];
  teacherNote: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const cleanJson = (text: string) => {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
};

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return json(
      {
        error: "Method not allowed",
      },
      405
    );
  }

  const apiKey = Netlify.env.get("OPENAI_API_KEY");

  if (!apiKey) {
    return json(
      {
        error: "کلید OPENAI_API_KEY در محیط Netlify تنظیم نشده است.",
      },
      500
    );
  }

  try {
    const body = (await req.json()) as CheckRequest;

    if (!body.image || !body.image.startsWith("data:image/")) {
      return json(
        {
          error: "تصویر معتبر ارسال نشده است.",
        },
        400
      );
    }

    // جلوگیری از ارسال تصویرهای بسیار بزرگ
    const estimatedBytes = body.image.length * 0.75;

    if (estimatedBytes > 12_000_000) {
      return json(
        {
          error:
            "حجم تصویر زیاد است. لطفاً عکس واضح‌تر و کم‌حجم‌تری ارسال کنید.",
        },
        413
      );
    }

    const systemPrompt = `
تو «تصحیح‌یار» هستی؛ یک دستیار هوشمند برای کمک به معلم دبستان در بررسی تکالیف دانش‌آموزان فارسی‌زبان.

وظیفه تو:
1. تصویر تکلیف را با دقت بررسی کن.
2. تا جای ممکن دست‌خط فارسی را بخوان.
3. اعداد، عملیات ریاضی، کلمات و جمله‌های فارسی را تشخیص بده.
4. سؤال‌ها و پاسخ‌های دانش‌آموز را از هم تفکیک کن.
5. پاسخ‌ها را با معیار یا پاسخ مورد انتظار معلم مقایسه کن.
6. برای ریاضی، محاسبه را مستقل بررسی کن.
7. در سؤال‌های تشریحی، مفهوم و معنای پاسخ را بررسی کن و فقط به تطابق کلمه‌به‌کلمه اکتفا نکن.
8. اگر پاسخ ناقص است، incomplete ثبت کن.
9. اگر پاسخ اشتباه است، incorrect ثبت کن.
10. اگر پاسخ درست است، correct ثبت کن.
11. اگر تصویر، دست‌خط یا پاسخ مبهم است، هرگز حدس قطعی نزن و status را review قرار بده.
12. confidence عددی بین 0 و 1 باشد.
13. هرچه اطمینان کمتر است، confidence پایین‌تر باشد.
14. نتیجه نهایی باید به معلم کمک کند فقط موارد مشکوک را دوباره بررسی کند.

قواعد مهم:
- دانش‌آموز را به خاطر تفاوت جزئی در جمله‌بندی، در صورتی که مفهوم درست باشد، غلط نکن.
- در ریاضی، نتیجه عددی و عملیات را دقیق بررسی کن.
- اگر بخشی از تصویر خوانا نیست، آن بخش را review کن.
- هرگز برای متن ناخوانا حدس قطعی نزن.
- اگر نمی‌توانی سؤال‌ها را به‌طور قابل اعتماد تفکیک کنی، یک مورد review ایجاد کن.
- اگر پاسخ‌ها به‌وضوح درست هستند، overallStatus را good قرار بده.
- اگر تعدادی پاسخ نیاز به بررسی معلم دارند، overallStatus را review قرار بده.
- اگر چند پاسخ با اطمینان بالا اشتباه یا ناقص هستند، overallStatus را bad قرار بده.

پاسخ فقط باید JSON معتبر باشد.
هیچ Markdown، توضیح اضافه یا متن خارج از JSON ننویس.

ساختار دقیق پاسخ:

{
  "studentName": "string",
  "overallStatus": "good | review | bad",
  "answers": [
    {
      "question": "string",
      "status": "correct | incorrect | incomplete | review",
      "confidence": 0.0,
      "feedback": "string"
    }
  ],
  "teacherNote": "string"
}
`;

    const userPrompt = `
دانش‌آموز:
${body.studentName || "نامشخص"}

عنوان تکلیف:
${body.taskTitle || "نامشخص"}

معیار یا پاسخ مورد انتظار معلم:
${body.rubric || "معیار مشخصی ارائه نشده است. بر اساس محتوای قابل مشاهده و دانش پایه دبستان ارزیابی کن."}

اکنون تصویر تکلیف دانش‌آموز را بررسی کن و نتیجه را طبق ساختار JSON تعیین‌شده برگردان.
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-5.6-sol",

          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: systemPrompt,
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: userPrompt,
                },
                {
                  type: "input_image",
                  image_url: body.image,
                  detail: "high",
                },
              ],
            },
          ],

          max_output_tokens: 4000,
        }),
      }
    );

    const raw = await response.text();

    if (!response.ok) {
      let message = "خطا در ارتباط با سرویس هوش مصنوعی.";

      try {
        const errorData = JSON.parse(raw);

        if (errorData?.error?.message) {
          message = errorData.error.message;
        }
      } catch {
        // Ignore JSON parsing error
      }

      console.error("OpenAI API error:", raw);

      return json(
        {
          error: message,
        },
        response.status
      );
    }

    let apiData: any;

    try {
      apiData = JSON.parse(raw);
    } catch {
      return json(
        {
          error: "پاسخ نامعتبر از سرویس هوش مصنوعی دریافت شد.",
        },
        502
      );
    }

    let outputText = "";

    if (typeof apiData.output_text === "string") {
      outputText = apiData.output_text;
    } else if (Array.isArray(apiData.output)) {
      outputText = apiData.output
        .flatMap((item: any) =>
          Array.isArray(item?.content) ? item.content : []
        )
        .map((content: any) => content?.text || "")
        .filter(Boolean)
        .join("");
    }

    if (!outputText.trim()) {
      return json(
        {
          error:
            "مدل پاسخی برای بررسی تکلیف برنگرداند. لطفاً دوباره تلاش کنید.",
        },
        502
      );
    }

    const cleaned = cleanJson(outputText);

    let result: CheckResult;

    try {
      result = JSON.parse(cleaned);
    } catch {
      console.error("Invalid model JSON:", outputText);

      return json(
        {
          error:
            "پاسخ هوش مصنوعی قابل پردازش نبود. لطفاً دوباره تلاش کنید.",
        },
        502
      );
    }

    // اعتبارسنجی حداقلی خروجی مدل
    if (
      !result ||
      typeof result !== "object" ||
      !Array.isArray(result.answers)
    ) {
      return json(
        {
          error: "ساختار نتیجه تصحیح معتبر نیست.",
        },
        502
      );
    }

    return json({
      studentName:
        typeof result.studentName === "string"
          ? result.studentName
          : body.studentName || "نامشخص",

      overallStatus:
        result.overallStatus === "good" ||
        result.overallStatus === "bad" ||
        result.overallStatus === "review"
          ? result.overallStatus
          : "review",

      answers: result.answers.map((answer: any) => ({
        question:
          typeof answer.question === "string"
            ? answer.question
            : "سؤال نامشخص",

        status:
          answer.status === "correct" ||
          answer.status === "incorrect" ||
          answer.status === "incomplete" ||
          answer.status === "review"
            ? answer.status
            : "review",

        confidence:
          typeof answer.confidence === "number"
            ? Math.max(0, Math.min(1, answer.confidence))
            : 0,

        feedback:
          typeof answer.feedback === "string"
            ? answer.feedback
            : "",
      })),

      teacherNote:
        typeof result.teacherNote === "string"
          ? result.teacherNote
          : "",
    });
  } catch (error) {
    console.error("check-homework error:", error);

    return json(
      {
        error:
          "بررسی تکلیف انجام نشد. لطفاً تصویر واضح‌تری بفرست و دوباره تلاش کن.",
      },
      500
    );
  }
};

export const config: Config = {
  path: "/api/check-homework",
};
