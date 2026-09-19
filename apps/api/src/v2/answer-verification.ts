/**
 * 答案验证层：客观题用确定性规则核对，主观题明确标记为需要评分量表或人工确认。
 *
 * 目的不是替模型解题，而是保证“能自动验证的必须验证过”，
 * 无法验证的要如实标出来，不能当作已验证答案使用。
 */

export type VerificationStatus = "verified" | "failed" | "not_applicable" | "unverified";

export type VerificationResult = {
  status: VerificationStatus;
  method: string | null;
  verifiedAnswer: unknown;
  errors: string[];
};

const OBJECTIVE_FORMATS = ["single_choice", "multiple_choice", "true_false", "fill_blank", "calculation"];

function isPlainObject(value: unknown) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[。．.]+$/, "");
}

function normalizeExpression(value: unknown) {
  return String(value ?? "")
    .replace(/[×✕xX]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[－—–]/g, "-")
    .replace(/[＋]/g, "+")
    .replace(/\s+/g, "");
}

function isNumberToken(token: string) {
  return /^-?\d/.test(token);
}

/**
 * 仅支持四则运算、乘方和括号的安全求值，不执行任意代码。
 * 表达式里出现字母或未知符号时返回 null，交由调用方标记为未验证。
 */
export function evaluateArithmetic(input: string): number | null {
  const expression = normalizeExpression(input);
  if (!expression || /[^0-9+\-*/^().]/.test(expression)) return null;
  const tokens = expression.match(/\d+(?:\.\d+)?|[+\-*/^()]/g);
  if (!tokens || tokens.join("") !== expression) return null;

  const output: string[] = [];
  const operators: string[] = [];
  const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
  let expectOperand = true;
  let negateNext = false;

  for (const token of tokens) {
    if (/^\d/.test(token)) {
      output.push(String(negateNext ? -Number(token) : Number(token)));
      negateNext = false;
      expectOperand = false;
      continue;
    }
    if (token === "(") {
      operators.push(token);
      expectOperand = true;
      continue;
    }
    if (token === ")") {
      while (operators.length && operators[operators.length - 1] !== "(") output.push(operators.pop() as string);
      if (!operators.length) return null;
      operators.pop();
      expectOperand = false;
      continue;
    }
    // 一元负号：-3 或 (-3)。这里把负号并入后面的数字，避免 RPN 顺序错乱。
    if (token === "-" && expectOperand) {
      negateNext = !negateNext;
      continue;
    }
    if (negateNext) return null;
    if (!precedence[token]) return null;
    while (
      operators.length
      && precedence[operators[operators.length - 1]]
      && precedence[operators[operators.length - 1]] >= precedence[token]
    ) {
      output.push(operators.pop() as string);
    }
    operators.push(token);
    expectOperand = true;
  }

  while (operators.length) {
    const operator = operators.pop() as string;
    if (operator === "(") return null;
    output.push(operator);
  }

  const stack: number[] = [];
  for (const token of output) {
    if (isNumberToken(token)) {
      stack.push(Number(token));
      continue;
    }
    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) return null;
    if (token === "+") stack.push(left + right);
    else if (token === "-") stack.push(left - right);
    else if (token === "*") stack.push(left * right);
    else if (token === "/") stack.push(right === 0 ? Number.NaN : left / right);
    else stack.push(left ** right);
  }
  const value = stack.pop();
  if (value === undefined || stack.length || !Number.isFinite(value)) return null;
  return value;
}

function optionKeys(options: unknown) {
  if (Array.isArray(options)) {
    return options
      .map((item, index) => {
        if (isPlainObject(item)) {
          const record = item as Record<string, unknown>;
          return String(record.key ?? record.value ?? record.label ?? String.fromCharCode(65 + index));
        }
        return String(item);
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (isPlainObject(options)) return Object.keys(options as Record<string, unknown>);
  return [];
}

function asArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

/**
 * 验证一道题的答案。返回值直接写入题目的 verification* 字段。
 */
export function verifyQuestionAnswer(question: {
  format?: string | null;
  answer?: unknown;
  options?: unknown;
  scoringRubric?: unknown;
}): VerificationResult {
  const format = String(question.format || "short_answer");
  const answer = question.answer;
  const empty = answer === null || answer === undefined || answer === "" || (Array.isArray(answer) && !answer.length);

  if (format === "short_answer" || format === "essay") {
    const hasRubric = Boolean(question.scoringRubric) && Object.keys((question.scoringRubric as object) || {}).length > 0;
    return {
      status: "not_applicable",
      method: "manual_review",
      verifiedAnswer: null,
      errors: hasRubric ? [] : ["主观题缺少评分量表，需要补充评分标准后再使用"],
    };
  }

  if (!OBJECTIVE_FORMATS.includes(format)) {
    return { status: "unverified", method: null, verifiedAnswer: null, errors: [`不支持的题目类型：${format}`] };
  }

  if (empty) {
    return { status: "failed", method: "answer_presence", verifiedAnswer: null, errors: ["题目缺少标准答案"] };
  }

  if (format === "single_choice" || format === "multiple_choice" || format === "true_false") {
    const keys = optionKeys(question.options);
    const answers = asArray(answer).map((item) => String(isPlainObject(item) ? (item as Record<string, unknown>).key ?? item : item).trim());
    const errors: string[] = [];
    if (format === "multiple_choice" && answers.length < 2) errors.push("多选题标准答案应包含两个及以上选项");
    if (format !== "multiple_choice" && answers.length !== 1) errors.push("单选题标准答案应只有一个选项");

    if (format === "true_false") {
      const flag = normalizeText(answers[0]);
      if (!["true", "false", "对", "错", "正确", "错误", "t", "f"].includes(flag)) errors.push("判断题答案应为对或错");
    } else if (keys.length) {
      const normalizedKeys = keys.map((item) => normalizeText(item));
      for (const item of answers) {
        if (!normalizedKeys.includes(normalizeText(item))) errors.push(`标准答案「${item}」不在选项中`);
      }
    } else {
      errors.push("选择题缺少选项，无法核对答案");
    }

    return {
      status: errors.length ? "failed" : "verified",
      method: "option_match",
      verifiedAnswer: format === "multiple_choice" ? answers : answers[0],
      errors,
    };
  }

  if (format === "fill_blank") {
    const answers = asArray(answer).map((item) => normalizeText(item));
    const errors = answers.some((item) => !item) ? ["填空题答案不能为空"] : [];
    return {
      status: errors.length ? "failed" : "verified",
      method: "normalized_text",
      verifiedAnswer: answers,
      errors,
    };
  }

  // calculation：先用确定性计算核对，无法解析时明确标记为未验证。
  const answers = asArray(answer).map((item) => normalizeExpression(item));
  const values = answers.map((item) => evaluateArithmetic(item));
  if (values.some((value) => value === null)) {
    return {
      status: "unverified",
      method: "numeric_expression",
      verifiedAnswer: null,
      errors: ["标准答案包含无法用四则运算核对的内容，需要人工或符号计算确认"],
    };
  }
  return { status: "verified", method: "numeric_expression", verifiedAnswer: values, errors: [] };
}

export function verifyQuestionAnswers(
  questions: Array<{ format?: string | null; answer?: unknown; options?: unknown; scoringRubric?: unknown }>,
) {
  return questions.map((question) => verifyQuestionAnswer(question));
}
