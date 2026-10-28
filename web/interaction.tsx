import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
type Activity = "draft" | "busy" | "write";
const RegisterContext = createContext<((id: string, value: Activity | null) => void) | null>(null);
const StateContext = createContext<{ dirty: boolean; busy: boolean; writing: boolean } | null>(
  null,
);
export function InteractionProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Record<string, Activity>>({});
  const register = useCallback((id: string, value: Activity | null) => {
    setActivities((previous) => {
      if (previous[id] === value || (value === null && !(id in previous))) return previous;
      const next = { ...previous };
      if (value === null) delete next[id];
      else next[id] = value;
      return next;
    });
  }, []);
  const state = useMemo(
    () => ({
      dirty: Object.values(activities).includes("draft"),
      busy: Object.values(activities).some((value) => value === "busy" || value === "write"),
      writing: Object.values(activities).includes("write"),
    }),
    [activities],
  );
  return (
    <RegisterContext.Provider value={register}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </RegisterContext.Provider>
  );
}
export function useActivity(active: boolean, kind: Activity) {
  const id = useId();
  const register = useContext(RegisterContext);
  if (!register) throw new Error("InteractionProvider is required.");
  useLayoutEffect(() => {
    register(id, active ? kind : null);
    return () => register(id, null);
  }, [id, active, kind, register]);
}
export function useInteractionState() {
  const state = useContext(StateContext);
  if (!state) throw new Error("InteractionProvider is required.");
  return state;
}
