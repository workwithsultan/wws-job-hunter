import { z } from "zod";
import { assessmentSchema, withAssessmentOutput } from "../shared/assessment.js";

const modelSchema = z.object({
  id: z.string().min(1).max(150),
  architecture: z.object({
    input_modalities: z.array(z.string()),
    output_modalities: z.array(z.string()),
  }),
  supported_parameters: z.array(z.string()).nullish(),
});
export function isAssessmentModel(value: unknown): boolean {
  const result = modelSchema.safeParse(value);
  return (
    result.success &&
    result.data.architecture.input_modalities.includes("text") &&
    result.data.architecture.output_modalities.includes("text") &&
    Boolean(result.data.supported_parameters?.includes("structured_outputs")) &&
    Boolean(result.data.supported_parameters?.includes("response_format"))
  );
}
const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable(),
        message: z.object({ content: z.string().nullable(), refusal: z.string().nullish() }),
      }),
    )
    .min(1),
});
export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
  }
}
export class AssessmentOutputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AssessmentOutputError";
  }
}
function requestError(status: number, expired = false): OpenRouterError {
  const message =
    status === 401
      ? expired
        ? "The OpenRouter key has expired. Replace it in Settings → Connections."
        : "OpenRouter rejected this key (401). Check or replace it in Settings → Connections."
      : status === 402
        ? "OpenRouter credits or the key spending limit are insufficient. Check your OpenRouter account."
        : status === 403
          ? "OpenRouter denied this request. Check key permissions and account policies."
          : status === 429
            ? "OpenRouter is rate limiting requests. Wait before trying again."
            : status === 400 || status === 404
              ? "OpenRouter could not use the selected model or requested structured output. Refresh models in Settings."
              : "OpenRouter is unavailable or the model provider failed. Try again later.";
  return new OpenRouterError(message, status);
}

export class OpenRouterClient {
  constructor(
    private readonly key: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  private async json(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.key) throw new OpenRouterError("Save an OpenRouter API key first.");
    signal?.throwIfAborted();
    const cancellation = AbortSignal.any([
      AbortSignal.timeout(body === undefined ? 15000 : 60000),
      ...(signal ? [signal] : []),
    ]);
    let response: Response;
    try {
      response = await this.request("https://openrouter.ai/api/v1" + path, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: {
          Authorization: "Bearer " + this.key,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: cancellation,
      });
    } catch {
      signal?.throwIfAborted();
      throw new OpenRouterError(
        "OpenRouter could not be reached or timed out. Check your connection and try again.",
      );
    }
    if (!response.ok) {
      let expired = false;
      if (response.status === 401) {
        try {
          const error = z
            .object({ error: z.object({ message: z.string() }) })
            .safeParse(await response.json());
          expired =
            error.success && /\b(?:api )?key (?:has )?expired\b/i.test(error.data.error.message);
        } catch {
          /* Keep the authentication error explicit without exposing upstream content. */
        }
      }
      throw requestError(response.status, expired);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new OpenRouterError("OpenRouter returned an unreadable response. Try again later.");
    }
    const error = z.object({ error: z.object({ code: z.number().optional() }) }).safeParse(value);
    if (error.success) throw requestError(error.data.error.code ?? 502);
    return value;
  }
  async models(): Promise<string[]> {
    const key = z
      .object({ data: z.object({ is_management_key: z.boolean().optional() }) })
      .safeParse(await this.json("/key"));
    if (!key.success)
      throw new OpenRouterError("OpenRouter key verification returned an invalid response.");
    const catalog = z
      .object({ data: z.array(z.unknown()) })
      .safeParse(await this.json("/models/user"));
    if (!catalog.success)
      throw new OpenRouterError("OpenRouter returned an invalid model catalog.");
    const ids = catalog.data.data
      .filter(isAssessmentModel)
      .map((value) => modelSchema.parse(value).id);
    const models = [...new Set(ids)].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    if (!models.length)
      throw new OpenRouterError(
        "No text models with structured output are available under your OpenRouter account settings.",
      );
    return models;
  }
  async assess(
    model: string,
    prompt: string,
    job: { title: string; url: string; description: string; details?: Record<string, unknown> },
    signal: AbortSignal,
  ): Promise<z.infer<typeof assessmentSchema>> {
    const value = await this.json(
      "/chat/completions",
      {
        model,
        messages: [
          {
            role: "system",
            content: withAssessmentOutput(prompt),
          },
          { role: "user", content: JSON.stringify(job) },
        ],
        stream: false,
        max_tokens: 2048,
        provider: { require_parameters: true, data_collection: "deny", allow_fallbacks: false },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "job_match",
            strict: true,
            schema: z.toJSONSchema(assessmentSchema),
          },
        },
      },
      signal,
    );
    const response = completionSchema.safeParse(value);
    if (!response.success)
      throw new AssessmentOutputError(
        "invalid_envelope",
        "The AI response did not contain a valid completion.",
      );
    const choice = response.data.choices[0]!;
    if (choice.message.refusal)
      throw new AssessmentOutputError(
        "model_refusal",
        "The model declined to assess this posting.",
      );
    if (choice.finish_reason === "length")
      throw new AssessmentOutputError(
        "output_truncated",
        "The model stopped before finishing its response.",
      );
    if (choice.finish_reason !== "stop")
      throw new AssessmentOutputError("incomplete_output", "The model did not finish normally.");
    if (!choice.message.content)
      throw new AssessmentOutputError("empty_output", "The model returned no assessment text.");
    let output: unknown;
    try {
      output = JSON.parse(choice.message.content);
    } catch {
      throw new AssessmentOutputError("invalid_json", "The model response was not valid JSON.");
    }
    const parsed = assessmentSchema.safeParse(output);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      const known = field === "verdict" || field === "score" || field === "reason";
      throw new AssessmentOutputError(
        known ? `invalid_${field}` : "invalid_schema",
        known
          ? `The AI ${field} did not meet the required format.`
          : "The AI output contained missing, unexpected or invalid fields.",
      );
    }
    if (parsed.data.verdict === "match" ? parsed.data.score === 0 : parsed.data.score !== 0)
      throw new AssessmentOutputError(
        "inconsistent_verdict_score",
        "The AI verdict and score contradicted each other.",
      );
    return parsed.data;
  }
}
