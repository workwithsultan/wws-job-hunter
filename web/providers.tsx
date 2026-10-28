import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, RefreshCw, Check } from "lucide-react";
import type { SavedKey, SerpQuota, Workspace } from "../src/shared/model";
import { providerKeySchema } from "../src/shared/model";
import { searchBudget } from "../src/shared/budget";
import { api, ApiError } from "./api";
import { Alert, Choice, Field, useConfirm, useDraftWarning } from "./ui";

export function useQuota(keys: SavedKey[], active: boolean, running: boolean) {
  const [quota, setQuota] = useState<SerpQuota | null>(null);
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const signature = keys.map((key) => key.id).join(",");
  const load = useCallback(
    async (refresh = true) => {
      if (!signature) {
        setQuota(null);
        setFailure("");
        return;
      }
      setLoading(true);
      try {
        setQuota(await api<SerpQuota>("/api/serpapi/quota" + (refresh ? "?refresh=true" : "")));
        setFailure("");
      } catch (error) {
        setFailure(error instanceof Error ? error.message : "Quota could not be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [signature],
  );
  useEffect(() => {
    if (!signature) {
      setQuota(null);
      return;
    }
    if (active && !running) void load();
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
  const [addSerp, setAddSerp] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const confirm = useConfirm();
  const {
    quota,
    loading: quotaLoading,
    failure: quotaFailure,
    load: loadQuota,
  } = useQuota(workspace.connections.serpapiKeys, active, workspace.running);
  useDraftWarning(Boolean(openaiKey || serpapiKey));
  const loadModels = useCallback(
    async (refresh = false) => {
      if (!workspace.connections.openai) {
        setModels([]);
        setModelsError("");
        return;
      }
      setModelsLoading(true);
      try {
        const result = await api<{ models: string[] }>(
          "/api/openai/models" + (refresh ? "?refresh=true" : ""),
        );
        setModels(result.models);
        setModelsError("");
      } catch (error) {
        setModelsError(error instanceof Error ? error.message : "Models could not be loaded.");
        setModels([]);
      } finally {
        setModelsLoading(false);
      }
    },
    [workspace.connections.openai, workspace.connections.openaiLastFour],
  );
  useEffect(() => {
    if (active) void loadModels();
  }, [active, loadModels]);
  const connect = async (event: FormEvent, provider: "openai" | "serpapi") => {
    event.preventDefault();
    if (busy || workspace.running) return;
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
        setAddSerp(false);
      }
      await reload();
      if (provider === "openai") await loadModels(true);
    } catch (error) {
      if (error instanceof ApiError && error.fields.key)
        setErrors((v) => ({ ...v, [provider]: error.fields.key! }));
      else setFailure(error instanceof Error ? error.message : "The key could not be connected.");
    } finally {
      setBusy("");
    }
  };
  const selectModel = async (model: string) => {
    if (busy || !model || model === workspace.connections.model) return;
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
  const locked = Boolean(busy) || workspace.running;
  return (
    <section className="connections-section" aria-label="Provider connections">
      {failure && <Alert>{failure}</Alert>}
      <div className="provider-section">
        <div className="provider-heading">
          <h2>OpenAI</h2>
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
              <button disabled={locked} onClick={() => setEditOpenai(true)}>
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
                {busy === "openai" ? "Connecting…" : "Connect"}
              </button>
              {editOpenai && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setOpenaiKey("");
                    setEditOpenai(false);
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
        {modelsError && <Alert onRetry={() => void loadModels(true)}>{modelsError}</Alert>}
      </div>
      <div className="provider-section">
        <div className="provider-heading">
          <h2>SerpApi</h2>
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
        {quotaFailure && <Alert onRetry={() => void loadQuota()}>{quotaFailure}</Alert>}
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
        {!workspace.connections.serpapi || addSerp ? (
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
                {busy === "serpapi" ? "Connecting…" : "Connect"}
              </button>
              {workspace.connections.serpapi && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setSerpapiKey("");
                    setAddSerp(false);
                    setErrors((v) => ({ ...v, serpapi: "" }));
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        ) : (
          <button
            className="align-start"
            disabled={locked || workspace.connections.serpapiKeys.length >= 10}
            onClick={() => setAddSerp(true)}
          >
            <Plus />
            Add key
          </button>
        )}
      </div>
    </section>
  );
}
