import { useActivity, useInteractionState } from "./interaction";
import { useCallback, useEffect, useState, useRef, type FormEvent } from "react";
import { Trash2, RefreshCw, Check } from "lucide-react";
import type { SavedKey, SerpQuota, Workspace } from "../src/shared/model";
import { providerKeySchema } from "../src/shared/model";
import { searchBudget } from "../src/shared/budget";
import { api, ApiError } from "./api";
import { Alert, Choice, Field, Emoji, PendingLabel, useConfirm, useDraftWarning } from "./ui";

export function useQuota(keys: SavedKey[], active: boolean, running: boolean) {
  const [snapshot, setSnapshot] = useState<{ signature: string; quota: SerpQuota } | null>(null);
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const requestSerial = useRef(0);
  const signature = keys.map((key) => key.id).join(",");
  const load = useCallback(
    async (refresh = true) => {
      const request = ++requestSerial.current;
      if (!signature) {
        setSnapshot(null);
        setFailure("");
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await api<SerpQuota>(
          "/api/serpapi/quota" + (refresh ? "?refresh=true" : ""),
        );
        if (request !== requestSerial.current) return;
        setSnapshot({ signature, quota: result });
        setFailure("");
      } catch (error) {
        if (request === requestSerial.current) {
          setSnapshot(null);
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
  const quota = snapshot?.signature === signature ? snapshot.quota : null;
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
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [serpapiKey, setSerpapiKey] = useState("");
  const [editOpenrouter, setEditOpenrouter] = useState(false);
  const [modelRevision, setModelRevision] = useState(0);
  const modelRequest = useRef(0);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{
    provider: "openrouter" | "serpapi";
    message: string;
  } | null>(null);
  const confirm = useConfirm();
  const interaction = useInteractionState();
  const {
    quota,
    loading: quotaLoading,
    failure: quotaFailure,
    load: loadQuota,
  } = useQuota(workspace.connections.serpapiKeys, active, workspace.running);
  useDraftWarning(Boolean(openrouterKey || serpapiKey));
  useActivity(Boolean(busy), "write");
  useActivity(quotaLoading, "busy");
  const loadModels = useCallback(
    async (refresh = false) => {
      const request = ++modelRequest.current;
      if (!workspace.connections.openrouter) {
        setModels([]);
        setModelsError("");
        setModelsLoading(false);
        return;
      }
      setModelsLoading(true);
      try {
        const result = await api<{ models: string[] }>(
          "/api/openrouter/models" + (refresh ? "?refresh=true" : ""),
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
    [workspace.connections.openrouter, workspace.connections.openrouterLastFour, modelRevision],
  );
  useEffect(() => {
    if (active) void loadModels();
    return () => {
      modelRequest.current++;
    };
  }, [active, loadModels]);
  const connect = async (event: FormEvent, provider: "openrouter" | "serpapi") => {
    event.preventDefault();
    if (busy || workspace.running || interaction.writing) return;
    const key = provider === "openrouter" ? openrouterKey : serpapiKey;
    const parsed = providerKeySchema.safeParse({ key });
    if (!parsed.success) {
      setErrors((v) => ({ ...v, [provider]: parsed.error.issues[0]!.message }));
      document.getElementById(provider + "-key")?.focus();
      return;
    }
    if (
      !(await confirm({
        title:
          provider === "openrouter" && workspace.connections.openrouter
            ? "Replace OpenRouter key?"
            : "Connect API key?",
        description: `Connect the ${provider === "openrouter" ? "OpenRouter" : "SerpApi"} key ending ${parsed.data.key.slice(-4)}? Its ${provider === "openrouter" ? "available models" : "account quota"} will be checked.`,
        action: "Connect key",
        emoji: "🔑",
      }))
    )
      return;
    setBusy(provider);
    setFailure(null);
    setErrors((v) => ({ ...v, [provider]: "" }));
    try {
      await api(
        provider === "openrouter" ? "/api/openrouter/key" : "/api/serpapi/keys",
        provider === "openrouter" ? "PUT" : "POST",
        parsed.data,
      );
      if (provider === "openrouter") {
        setOpenrouterKey("");
        setEditOpenrouter(false);
      } else {
        setSerpapiKey("");
      }
      await reload();
      if (provider === "openrouter") setModelRevision((value) => value + 1);
    } catch (error) {
      if (error instanceof ApiError && error.fields.key)
        setErrors((v) => ({ ...v, [provider]: error.fields.key! }));
      else
        setFailure({
          provider,
          message: error instanceof Error ? error.message : "The key could not be connected.",
        });
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
        title: "Change OpenRouter model?",
        emoji: "🤖",
        description: "Use this model for future job matching. It will use your OpenRouter account.",
        details: [{ label: "Model", value: model }],
        action: "Use model",
      }))
    )
      return;
    setBusy("model");
    setModelsError("");
    try {
      await api("/api/openrouter/model", "PUT", { model });
      await reload();
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : "The model could not be saved.");
    } finally {
      setBusy("");
    }
  };
  const remove = async (provider: "openrouter" | "serpapi", key?: SavedKey) => {
    if (
      busy ||
      workspace.running ||
      interaction.writing ||
      !(await confirm({
        title: "Remove API key?",
        description: `Remove the ${provider === "openrouter" ? "OpenRouter" : "SerpApi"} key ending ${key?.lastFour ?? workspace.connections.openrouterLastFour}? ${provider === "openrouter" || workspace.connections.serpapiKeys.length === 1 ? "Connect this provider again before running another search." : "The search budget will be recalculated."}`,
        action: "Remove key",
        destructive: true,
      }))
    )
      return;
    setBusy(provider);
    setFailure(null);
    try {
      await api(
        provider === "openrouter" ? "/api/openrouter/key" : "/api/serpapi/keys/" + key!.id,
        "DELETE",
        {},
      );
      await reload();
    } catch (error) {
      setFailure({
        provider,
        message: error instanceof Error ? error.message : "The key could not be removed.",
      });
    } finally {
      setBusy("");
    }
  };
  const budget = searchBudget(quota, workspace.preferences);
  const locked = Boolean(busy) || workspace.running || interaction.writing;
  return (
    <>
      <section
        className="provider-section provider-openrouter"
        aria-labelledby="openrouter-heading"
      >
        {failure?.provider === "openrouter" && <Alert>{failure.message}</Alert>}
        <div className="provider-heading">
          <h2 id="openrouter-heading">
            <Emoji>🤖</Emoji>OpenRouter
          </h2>
          {workspace.connections.openrouter && (
            <span className="connection-state">
              <Check />
              Key saved
            </span>
          )}
        </div>
        {workspace.connections.openrouter && !editOpenrouter ? (
          <div className="saved-key">
            <code>•••• {workspace.connections.openrouterLastFour}</code>
            <div>
              <button
                id="change-openrouter-key"
                disabled={locked}
                onClick={() => setEditOpenrouter(true)}
              >
                Change key
              </button>
              <button
                className="icon-button ghost danger-text"
                disabled={locked}
                aria-label="Remove OpenRouter key"
                onClick={() => void remove("openrouter")}
              >
                <Trash2 />
              </button>
            </div>
          </div>
        ) : (
          <form
            className="connect-form"
            noValidate
            onSubmit={(event) => void connect(event, "openrouter")}
          >
            <Field
              id="openrouter-key"
              label="OpenRouter API key (required)"
              error={errors.openrouter}
            >
              <input
                type="password"
                autoComplete="new-password"
                value={openrouterKey}
                onBlur={() => {
                  if (openrouterKey) {
                    const checked = providerKeySchema.safeParse({ key: openrouterKey });
                    setErrors((value) => ({
                      ...value,
                      openrouter: checked.success ? "" : checked.error.issues[0]!.message,
                    }));
                  }
                }}
                maxLength={500}
                disabled={locked}
                onChange={(event) => {
                  setOpenrouterKey(event.target.value);
                  setErrors((v) => ({ ...v, openrouter: "" }));
                }}
              />
            </Field>
            <div className="connect-actions">
              <button
                className="primary"
                disabled={locked || !providerKeySchema.safeParse({ key: openrouterKey }).success}
              >
                <PendingLabel pending={busy === "openrouter"} idle="Connect" busy="Connecting…" />
              </button>
              {(editOpenrouter || openrouterKey) && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setOpenrouterKey("");
                    setEditOpenrouter(false);
                    requestAnimationFrame(() =>
                      document
                        .getElementById(
                          workspace.connections.openrouter
                            ? "change-openrouter-key"
                            : "openrouter-key",
                        )
                        ?.focus(),
                    );
                    setErrors((v) => ({ ...v, openrouter: "" }));
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
        <Field id="openrouter-model" label="Model (required)">
          <Choice
            value={workspace.connections.model}
            onChange={(value) => void selectModel(value)}
            label="OpenRouter model"
            aria-busy={modelsLoading}
            placeholder={
              !workspace.connections.openrouter
                ? "Connect an API key first"
                : modelsLoading
                  ? "Loading models…"
                  : "Choose a model"
            }
            disabled={
              !workspace.connections.openrouter || modelsLoading || locked || models.length === 0
            }
            options={models.map((value) => ({ value, label: value }))}
          />
        </Field>
        {modelsError && (
          <Alert retrying={modelsLoading} onRetry={() => void loadModels(true)}>
            {modelsError}
          </Alert>
        )}
      </section>
      <section className="provider-section provider-serpapi" aria-labelledby="serpapi-heading">
        {failure?.provider === "serpapi" && <Alert>{failure.message}</Alert>}
        <div className="provider-heading">
          <h2 id="serpapi-heading">
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
                        {account.remaining.toLocaleString()} requests left · {account.plan}
                      </span>
                    )}
                    {quotaLoading && !account && (
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
              <strong>{budget.remaining!.toLocaleString()}</strong> requests remaining
            </span>
            {budget.dailyTarget !== null ? (
              <span>
                <strong>{budget.dailyTarget.toLocaleString()}</strong> requests / day target
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
            <Field
              id="serpapi-key"
              label={
                workspace.connections.serpapiKeys.length
                  ? "Additional SerpApi key (optional)"
                  : "SerpApi key (required)"
              }
              error={errors.serpapi}
            >
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
      </section>
    </>
  );
}
