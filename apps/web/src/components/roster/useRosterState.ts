import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FIXTURE_BOTS, FIXTURE_GROUPS } from "../../fixtures/roster";
import { type RosterBot, type RosterGroup } from "../../lib/roster";
import { createBotSession, evictSession } from "../../lib/session";

const STORAGE_KEY = "pi-do.roster.v4";

type BotOverlay = Partial<Omit<RosterBot, "id">>;

interface PersistedRoster {
  overlay: Record<string, BotOverlay>;
  order: string[];
  hidden: string[];
  groups: RosterGroup[];
  activeId: string | null;
  railCollapsed: boolean;
}

function emptyRoster(): PersistedRoster {
  return {
    overlay: {},
    order: [],
    hidden: [],
    groups: [...FIXTURE_GROUPS],
    activeId: null,
    railCollapsed: false,
  };
}

function readStoredRoster(): PersistedRoster {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyRoster();
    const parsed = JSON.parse(raw) as Partial<PersistedRoster>;
    return {
      overlay:
        parsed.overlay !== null &&
        typeof parsed.overlay === "object" &&
        !Array.isArray(parsed.overlay)
          ? parsed.overlay
          : {},
      order: Array.isArray(parsed.order)
        ? parsed.order.filter((id): id is string => typeof id === "string")
        : [],
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((id): id is string => typeof id === "string")
        : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [...FIXTURE_GROUPS],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      railCollapsed: parsed.railCollapsed === true,
    };
  } catch {
    return emptyRoster();
  }
}

function toBot(bot: RosterBot, overlay: BotOverlay | undefined): RosterBot {
  return { ...bot, ...overlay, id: bot.id };
}

export interface RosterApi {
  bots: RosterBot[];
  groups: RosterGroup[];
  activeId: string | null;
  railCollapsed: boolean;
  setActive: (id: string | null) => void;
  toggleRail: () => void;
  addBot: (name: string, extra?: Partial<RosterBot>) => Promise<RosterBot>;
  addGroup: (name: string, memberIds: string[]) => Promise<RosterGroup>;
  deleteBot: (id: string) => void;
  deleteGroup: (id: string) => void;
  renameGroup: (id: string, name: string) => void;
  setItemPinned: (id: string, pinned: boolean) => void;
  setActivity: (id: string, preview: string, presence: RosterBot["presence"]) => void;
  updateBot: (id: string, patch: Partial<RosterBot>) => void;
  reorderItem: (dragId: string, targetId: string | null) => void;
}

export function useRosterState(): RosterApi {
  const [state, setState] = useState<PersistedRoster>(readStoredRoster);
  const [sessions, setSessions] = useState<RosterBot[]>(() => [...FIXTURE_BOTS]);
  const sessionsRef = useRef<RosterBot[]>(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      return;
    }
  }, [state]);

  const bots = useMemo(() => {
    const hidden = new Set(state.hidden);
    const visible = sessions.filter((session) => !hidden.has(session.id));
    const byId = new Map(visible.map((session) => [session.id, session]));
    const ordered: RosterBot[] = [];
    for (const id of state.order) {
      const session = byId.get(id);
      if (session === undefined) continue;
      ordered.push(session);
      byId.delete(id);
    }
    for (const session of visible) {
      if (byId.delete(session.id)) ordered.push(session);
    }
    return ordered.map((session) => toBot(session, state.overlay[session.id]));
  }, [sessions, state.hidden, state.order, state.overlay]);

  const activeId = useMemo(() => {
    if (state.activeId === null) return null;
    if (bots.some((bot) => bot.id === state.activeId)) return state.activeId;
    if (state.groups.some((group) => group.id === state.activeId)) return state.activeId;
    return null;
  }, [state.activeId, bots, state.groups]);

  const setActive = useCallback((id: string | null) => {
    setState((prev) => {
      const entry = id === null ? undefined : prev.overlay[id];
      const base = id === null ? undefined : sessionsRef.current.find((bot) => bot.id === id);
      const unread = typeof entry?.unread === "number" ? entry.unread : (base?.unread ?? 0);
      const overlay =
        unread > 0 ? { ...prev.overlay, [id as string]: { ...entry, unread: 0 } } : prev.overlay;
      if (prev.activeId === id && overlay === prev.overlay) return prev;
      return { ...prev, activeId: id, overlay };
    });
  }, []);

  const toggleRail = useCallback(() => {
    setState((prev) => ({ ...prev, railCollapsed: !prev.railCollapsed }));
  }, []);

  const addBot = useCallback(
    async (name: string, extra?: Partial<RosterBot>) => {
      const persona = extra?.persona?.trim() ?? "";
      const instructions = extra?.instructions?.trim() ?? "";
      const backstory = [persona, instructions].filter((part) => part.length > 0).join("\n\n");
      const handle = await createBotSession(name, backstory.length > 0 ? backstory : null);
      const created: RosterBot = {
        id: handle.sessionId,
        name,
        preview: "",
        updatedAt: Date.now(),
        presence: "idle",
        unread: 0,
        pinned: false,
      };
      sessionsRef.current = [...sessionsRef.current, created];
      setSessions(sessionsRef.current);
      const { id: _drop, ...rest } = extra ?? {};
      const overlayEntry: BotOverlay = {
        ...rest,
        preview: extra?.preview ?? "Say hello to your new bot",
        updatedAt: Date.now(),
        presence: extra?.presence ?? "idle",
        unread: 0,
        pinned: extra?.pinned ?? false,
        modelId: extra?.modelId ?? "default",
        voiceEnabled: extra?.voiceEnabled ?? false,
        memory: extra?.memory ?? [],
        sandbox: extra?.sandbox ?? "none",
        toolOverrides: extra?.toolOverrides ?? {},
        usageCap: extra?.usageCap ?? 0,
        channels: extra?.channels ?? {},
      };
      setState((prev) => ({
        ...prev,
        overlay: { ...prev.overlay, [handle.sessionId]: overlayEntry },
        order: [...prev.order, handle.sessionId],
        activeId: handle.sessionId,
      }));
      return toBot(created, overlayEntry);
    },
    [],
  );

  const addGroup = useCallback((name: string, memberIds: string[]) => {
    const group: RosterGroup = {
      id: crypto.randomUUID(),
      name,
      memberIds,
      updatedAt: Date.now(),
    };
    setState((prev) => ({ ...prev, groups: [...prev.groups, group], activeId: group.id }));
    return Promise.resolve(group);
  }, []);

  const renameGroup = useCallback((id: string, name: string) => {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((group) => (group.id === id ? { ...group, name } : group)),
    }));
  }, []);

  const deleteBot = useCallback((id: string) => {
    evictSession(id);
    setState((prev) => ({
      ...prev,
      hidden: prev.hidden.includes(id) ? prev.hidden : [...prev.hidden, id],
      order: prev.order.filter((sid) => sid !== id),
      activeId: prev.activeId === id ? null : prev.activeId,
    }));
  }, []);

  const deleteGroup = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.filter((group) => group.id !== id),
      activeId: prev.activeId === id ? null : prev.activeId,
    }));
  }, []);

  const setActivity = useCallback(
    (id: string, preview: string, presence: RosterBot["presence"]) => {
      setState((prev) => {
        const entry = prev.overlay[id];
        if (entry !== undefined && entry.preview === preview && entry.presence === presence)
          return prev;
        const updatedAt =
          entry !== undefined && entry.presence === presence ? entry.updatedAt : Date.now();
        return {
          ...prev,
          overlay: {
            ...prev.overlay,
            [id]: { ...entry, preview, presence, updatedAt },
          },
        };
      });
    },
    [],
  );

  const setItemPinned = useCallback((id: string, pinned: boolean) => {
    setState((prev) => ({
      ...prev,
      overlay: { ...prev.overlay, [id]: { ...prev.overlay[id], pinned } },
    }));
  }, []);

  const updateBot = useCallback((id: string, patch: Partial<RosterBot>) => {
    const { id: _drop, ...rest } = patch;
    setState((prev) => ({
      ...prev,
      overlay: { ...prev.overlay, [id]: { ...prev.overlay[id], ...rest } },
    }));
  }, []);

  const reorderItem = useCallback((dragId: string, targetId: string | null) => {
    setState((prev) => {
      if (targetId !== null && dragId === targetId) return prev;
      const hidden = new Set(prev.hidden);
      const visible = sessionsRef.current.filter((session) => !hidden.has(session.id));
      const byId = new Map(visible.map((session) => [session.id, session]));
      const ids: string[] = [];
      for (const id of prev.order) {
        if (byId.delete(id)) ids.push(id);
      }
      for (const session of visible) {
        if (byId.delete(session.id)) ids.push(session.id);
      }
      const dragBot = ids.includes(dragId);
      const dragGroup = !dragBot && prev.groups.some((group) => group.id === dragId);
      if (!dragBot && !dragGroup) return prev;
      let order = prev.order;
      if (dragBot) {
        const without = ids.filter((id) => id !== dragId);
        const targetIndex = targetId === null ? -1 : without.indexOf(targetId);
        order =
          targetId === null
            ? [...without, dragId]
            : targetIndex < 0
              ? [...without, dragId]
              : [...without.slice(0, targetIndex), dragId, ...without.slice(targetIndex)];
      }
      let groups = prev.groups;
      if (dragGroup) {
        const without = prev.groups.filter((group) => group.id !== dragId);
        const targetIndex =
          targetId === null ? -1 : without.findIndex((group) => group.id === targetId);
        const group = prev.groups.find((candidate) => candidate.id === dragId);
        if (group !== undefined) {
          groups =
            targetId === null
              ? [...without, group]
              : targetIndex < 0
                ? [...without, group]
                : [...without.slice(0, targetIndex), group, ...without.slice(targetIndex)];
        }
      }
      return { ...prev, order, groups };
    });
  }, []);

  return useMemo(
    () => ({
      bots,
      groups: state.groups,
      activeId,
      railCollapsed: state.railCollapsed,
      setActive,
      toggleRail,
      addBot,
      addGroup,
      deleteBot,
      deleteGroup,
      renameGroup,
      setItemPinned,
      setActivity,
      updateBot,
      reorderItem,
    }),
    [
      bots,
      state.groups,
      activeId,
      state.railCollapsed,
      setActive,
      toggleRail,
      addBot,
      addGroup,
      deleteBot,
      deleteGroup,
      renameGroup,
      setItemPinned,
      setActivity,
      updateBot,
      reorderItem,
    ],
  );
}
