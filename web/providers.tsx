import { useActivity, useInteractionState } from "./interaction";
import { useCallback, useEffect, useState, useRef, type FormEvent } from "react";
import { Trash2, RefreshCw, Check } from "lucide-react";
import type { SavedKey, SerpQuota, Workspace } from "../src/shared/model";
import { providerKeySchema } from "../src/shared/model";
import { searchBudget } from "../src/shared/budget";
import { api, ApiError } from "./api";
import { Alert, Choice, Field, Emoji, PendingLabel, useConfirm, useDraftWarning } from "./ui";

export function useQuota(keys: SavedKey[], active: boolean, running: boolean) {
  const [quota, setQuota] = useState<SerpQuota | null>(null);
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const requestSerial = useRef(0);
  const signature = keys.map((key) => key.id).join(",");
  const load = useCallback(
    async (refresh = true) => {
      const request = ++requestSerial.current;
      if (!signature) {
        setQuota(null);
        setFailure("");
        setLoading(false);
        return;
      }
      setLoading(true);
      setQuota(null);
      try {
        const result = await api<SerpQuota>(
          "/api/serpapi/quota" + (refresh ? "?refresh=true" : ""),
        );
        if (request !== requestSerial.current) return;
        setQuota(result);
        setFailure("");
      } catch (error) {
        if (request === requestSerial.current) {
          setQuota(null);
          setFailure(error instanceof Error ? error.message : "Quota could not be loaded.");
        }
      } finally {
        if (request === requestSerial.current) setLoading(false);
      }
    },
    [signature],
  );
  useEffect(() => {
    if (!signature || (active && !running)) void load();
    return () => {
      requestSerial.current++;
      setLoading(false);
    };
  }, [signature, active, running, load]);
  return { quota, failure, loading, load };
}
export function ProviderSettings({
  workspace,
  reload,
  active,
}: {
  workspace: Workspace;
  reload: () => Promise<void>;
  active: boolean;
}) {
  const [openaiKey, setOpenaiKey] = useState("");
  const [serpapiKey, setSerpapiKey] = useState("");
  const [editOpenai, setEditOpenai] = useState(false);
  const [modelRevision, setModelRevision] = useState(0);
  const modelRequest = useRef(0);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const confirm = useConfirm();
  const interaction = useInteractionState();
  const {
    quota,
    loading: quotaLoading,
    failure: quotaFailure,
    load: loadQuota,
  } = useQuota(workspace.connections.serpapiKeys, active, workspace.running);
  useDraftWarning(Boolean(openaiKey || serpapiKey));
  useActivity(Boolean(busy), "write");
  useActivity(quotaLoading, "busy");
  const loadModels = useCallback(
    async (refresh = false) => {
      const request = ++modelRequest.current;
      if (!workspace.connections.openai) {
        setModels([]);
        setModelsError("");
        setModelsLoading(false);
        return;
      }
      setModelsLoading(true);
      try {
        const result = await api<{ models: string[] }>(
          "/api/openai/models" + (refresh ? "?refresh=true" : ""),
        );
        if (request !== modelRequest.current) return;
        setModels(result.models);
        setModelsError("");
      } catch (error) {
        if (request !== modelRequest.current) return;
        setModelsError(error instanceof Error ? error.message : "Models could not be loaded.");
        setModels([]);
      } finally {
        if (request === modelRequest.current) setModelsLoading(false);
      }
    },
    [workspace.connections.openai, workspace.connections.openaiLastFour, modelRevision],
  );
  useEffect(() => {
    if (active) void loadModels();
    return () => {
      modelRequest.current++;
    };
  }, [active, loadModels]);
  const connect = async (event: FormEvent, provider: "openai" | "serpapi") => {
    event.preventDefault();
    if (busy || workspace.running || interaction.writing) return;
    const key = provider === "openai" ? openaiKey : serpapiKey;
    const parsed = providerKeySchema.safeParse({ key });
    if (!parsed.success) {
      setErrors((v) => ({ ...v, [provider]: parsed.error.issues[0]!.message }));
      document.getElementById(provider + "-key")?.focus();
      return;
    }
    if (
      !(await confirm({
        title:
          provider === "openai" && workspace.connections.openai
            ? "Replace OpenAI key?"
            : "Connect API key?",
        description: `Connect the ${provider === "openai" ? "OpenAI" : "SerpApi"} key ending ${parsed.data.key.slice(-4)}? Its ${provider === "openai" ? "available models" : "account quota"} will be checked.`,
        action: "Connect key",
        emoji: "🔑",
      }))
    )
      return;
    setBusy(provider);
    setFailure("");
    setErrors((v) => ({ ...v, [provider]: "" }));
    try {
      await api(
        provider === "openai" ? "/api/openai/key" : "/api/serpapi/keys",
        provider === "openai" ? "PUT" : "POST",
        parsed.data,
      );
      if (provider === "openai") {
        setOpenaiKey("");
        setEditOpenai(false);
      } else {
        setSerpapiKey("");
      }
      await reload();
      if (provider === "openai") setModelRevision((value) => value + 1);
    } catch (error) {
      if (error instanceof ApiError && error.fields.key)
        setErrors((v) => ({ ...v, [provider]: error.fields.key! }));
      else setFailure(error instanceof Error ? error.message : "The key could not be connected.");
    } finally {
      setBusy("");
    }
  };
  const selectModel = async (model: string) => {
    if (
      busy ||
      workspace.running ||
      interaction.writing ||
      !model ||
      model === workspace.connections.model
    )
      return;
    if (
      !(await confirm({
        title: "Change OpenAI model?",
        emoji: "🤖",
        description: "Use this model for future job matching. It will use your OpenAI account.",
        details: [{ label: "Model", value: model }],
        action: "Use model",
      }))
    )
      return;
    setBusy("model");
    setModelsError("");
    try {
      await api("/api/openai/model", "PUT", { model });
      await reload();
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : "The model could not be saved.");
    } finally {
      setBusy("");
    }
  };
  const remove = async (provider: "openai" | "serpapi", key?: SavedKey) => {
    if (
      busy ||
      workspace.running ||
      interaction.writing ||
      !(await confirm({
        title: "Remove API key?",
        description: `Remove the ${provider === "openai" ? "OpenAI" : "SerpApi"} key ending ${key?.lastFour ?? workspace.connections.openaiLastFour}? ${provider === "openai" || workspace.connections.serpapiKeys.length === 1 ? "Scheduled searches will be disabled." : "The search budget will be recalculated."}`,
        action: "Remove key",
        destructive: true,
      }))
    )
      return;
    setBusy(provider);
    setFailure("");
    try {
      await api(
        provider === "openai" ? "/api/openai/key" : "/api/serpapi/keys/" + key!.id,
        "DELETE",
        {},
      );
      await reload();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The key could not be removed.");
    } finally {
      setBusy("");
    }
  };
  const budget = searchBudget(quota, workspace.preferences);
  const locked = Boolean(busy) || workspace.running || interaction.writing;
  return (
    <section className="connections-section" aria-label="Provider connections">
      {failure && <Alert>{failure}</Alert>}
      <div className="provider-section">
        <div className="provider-heading">
          <h2>
            <Emoji>🤖</Emoji>OpenAI
          </h2>
          {workspace.connections.openai && (
            <span className="connection-state">
              <Check />
              Key saved
            </span>
          )}
        </div>
        {workspace.connections.openai && !editOpenai ? (
          <div className="saved-key">
            <code>•••• {workspace.connections.openaiLastFour}</code>
            <div>
              <button id="change-openai-key" disabled={locked} onClick={() => setEditOpenai(true)}>
                Change key
              </button>
              <button
                className="icon-button ghost danger-text"
                disabled={locked}
                aria-label="Remove OpenAI key"
                onClick={() => void remove("openai")}
              >
                <Trash2 />
              </button>
            </div>
          </div>
        ) : (
          <form
            className="connect-form"
            noValidate
            onSubmit={(event) => void connect(event, "openai")}
          >
            <Field id="openai-key" label="OpenAI API key (required)" error={errors.openai}>
              <input
                type="password"
                autoComplete="new-password"
                value={openaiKey}
                onBlur={() => {
                  if (openaiKey) {
                    const checked = providerKeySchema.safeParse({ key: openaiKey });
                    setErrors((value) => ({
                      ...value,
                      openai: checked.success ? "" : checked.error.issues[0]!.message,
                    }));
                  }
                }}
                maxLength={500}
                disabled={locked}
                onChange={(event) => {
                  setOpenaiKey(event.target.value);
                  setErrors((v) => ({ ...v, openai: "" }));
                }}
              />
            </Field>
            <div className="connect-actions">
              <button
                className="primary"
                disabled={locked || !providerKeySchema.safeParse({ key: openaiKey }).success}
              >
                <PendingLabel pending={busy === "openai"} idle="Connect" busy="Connecting…" />
              </button>
              {(editOpenai || openaiKey) && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setOpenaiKey("");
                    setEditOpenai(false);
                    requestAnimationFrame(() =>
                      document
                        .getElementById(
                          workspace.connections.openai ? "change-openai-key" : "openai-key",
                        )
                        ?.focus(),
                    );
                    setErrors((v) => ({ ...v, openai: "" }));
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
        <Field id="openai-model" label="Model (required)">
          <Choice
            value={workspace.connections.model}
            onChange={(value) => void selectModel(value)}
            label="OpenAI model"
            aria-busy={modelsLoading}
            placeholder={
              !workspace.connections.openai
                ? "Connect an API key first"
                : modelsLoading
                  ? "Loading models…"
                  : "Choose a model"
            }
            disabled={
              !workspace.connections.openai || modelsLoading || locked || models.length === 0
            }
            options={models.map((value) => ({ value, label: value }))}
          />
        </Field>
        {modelsError && (
          <Alert retrying={modelsLoading} onRetry={() => void loadModels(true)}>
            {modelsError}
          </Alert>
        )}
      </div>
      <div className="provider-section">
        <div className="provider-heading">
          <h2>
            <Emoji>🔑</Emoji>SerpApi keys
          </h2>
          {workspace.connections.serpapiKeys.length > 0 && (
            <button
              className="ghost"
              disabled={quotaLoading || locked}
              onClick={() => void loadQuota()}
            >
              <RefreshCw />
              Refresh quota
            </button>
          )}
        </div>
        {workspace.connections.serpapiKeys.length > 0 && (
          <div className="saved-keys">
            {workspace.connections.serpapiKeys.map((key) => {
              const state = quota?.keys.find((item) => item.id === key.id);
              const account = quota?.accounts.find((item) => item.id === state?.accountId);
              return (
                <div className="saved-key" key={key.id}>
                  <div>
                    <code>•••• {key.lastFour}</code>
                    {account && (
                      <span className="key-quota">
                        {account.remaining.toLocaleString()} searches left · {account.plan}
                      </span>
                    )}
                    {quotaLoading && (
                      <span className="key-quota" role="status">
                        Checking quota…
                      </span>
                    )}
                    {state?.error && (
                      <span className="key-error" role="status">
                        {state.error}
                      </span>
                    )}
                  </div>
                  <button
                    className="icon-button ghost danger-text"
                    disabled={locked}
                    aria-label={"Remove SerpApi key ending " + key.lastFour}
                    onClick={() => void remove("serpapi", key)}
                  >
                    <Trash2 />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {quotaFailure && (
          <Alert retrying={quotaLoading} onRetry={() => void loadQuota()}>
            {quotaFailure}
          </Alert>
        )}
        {quota?.complete && (
          <div className="quota-summary">
            <span>
              <strong>{budget.remaining!.toLocaleString()}</strong> searches remaining
            </span>
            {budget.dailyTarget !== null ? (
              <span>
                <strong>{budget.dailyTarget.toLocaleString()}</strong> / day target
              </span>
            ) : (
              <span>No renewal date reported</span>
            )}
          </div>
        )}
        {workspace.connections.serpapiKeys.length < 10 && (
          <form
            className="connect-form"
            noValidate
            onSubmit={(event) => void connect(event, "serpapi")}
          >
            <Field id="serpapi-key" label="SerpApi key (required)" error={errors.serpapi}>
              <input
                type="password"
                autoComplete="new-password"
                value={serpapiKey}
                onBlur={() => {
                  if (serpapiKey) {
                    const checked = providerKeySchema.safeParse({ key: serpapiKey });
                    setErrors((value) => ({
                      ...value,
                      serpapi: checked.success ? "" : checked.error.issues[0]!.message,
                    }));
                  }
                }}
                maxLength={500}
                disabled={locked}
                onChange={(event) => {
                  setSerpapiKey(event.target.value);
                  setErrors((v) => ({ ...v, serpapi: "" }));
                }}
              />
            </Field>
            <div className="connect-actions">
              <button
                className="primary"
                disabled={locked || !providerKeySchema.safeParse({ key: serpapiKey }).success}
              >
                <PendingLabel pending={busy === "serpapi"} idle="Add key" busy="Connecting…" />
              </button>
              {serpapiKey && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setSerpapiKey("");
                    requestAnimationFrame(() => document.getElementById("serpapi-key")?.focus());
                    setErrors((v) => ({ ...v, serpapi: "" }));
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
