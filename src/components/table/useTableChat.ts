import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceActive } from "../../hooks/useWorkspaceActive";
import { useContainerChat, type ContainerConversationItem } from "../../hooks/useContainerChat";
import type { NoteItem, SpaceItem } from "../../types/electron";
import { buildBoardContext, parseRefKey, pinSelection, type TableCardModel } from "./tableModel";
import type { Point } from "./tableGeometry";
import type { useTableBoard } from "./useTableBoard";
import { useTableRoute } from "./useTableRoute";

import { useTablePaintState, type TablePublication } from "./tablePublication";

const NO_NOTES: NoteItem[] = [];
interface Scope {
  keys: string[];
  context: string;
  at: Point;
}
interface Intent {
  scope: Scope;
  generation: number;
  destination: string;
  text: string | null;
  phase: "prepared" | "queued" | "sending" | "accepted";
}
interface Recovery {
  text: string;
  scope: Scope;
  reason: "sendFailed" | "invalidated";
}
interface Options {
  space: SpaceItem;
  cards: TableCardModel[];
  selection: string[];
  resultPoint: () => Point;
  board: ReturnType<typeof useTableBoard>;
  publication?: TablePublication;
}

/** Table owns unadmitted intent; the existing sender owns admitted requests. */
export function useTableChat({
  space,
  cards,
  selection,
  resultPoint,
  board,
  publication,
}: Options) {
  const workspaceActive = useWorkspaceActive();
  const { place, link, reload, read, readCards } = board;
  const destination = useTableRoute();
  const [askOpen, setAskOpen] = useState(false);
  const [pinned, setPinned] = useState<Scope | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [queued, setQueued] = useState<Intent | null>(null);
  const generation = useRef(0);
  const intent = useRef<Intent | null>(null);
  const mounted = useRef(true);
  const boardContext = useMemo(
    () =>
      buildBoardContext(
        space.name,
        cards.map((card) => card.entity)
      ),
    [space.name, cards]
  );
  const [, setConversations, conversations] = useTablePaintState<ContainerConversationItem[]>(
    [],
    publication
  );
  const conversationList = useMemo(
    () => ({
      read: () => conversations.current,
      set: setConversations,
    }),
    [conversations, setConversations]
  );
  const chat = useContainerChat({
    space,
    folder: null,
    notes: NO_NOTES,
    contextOverride: pinned?.context ?? boardContext,
    conversationList: publication ? conversationList : undefined,
    initializeIdleConversation: !!publication,
  });
  const latest = useRef({ chat, destination, workspaceActive });
  latest.current = { chat, destination, workspaceActive };
  const recover = useCallback((pending: Intent, text: string, reason: Recovery["reason"]) => {
    if (mounted.current) setRecovery({ text, scope: pending.scope, reason });
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
    const pending = intent.current;
    if (pending && pending.phase !== "accepted" && pending.phase !== "sending" && pending.text)
      recover(pending, pending.text, "invalidated");
    intent.current = null;
    setQueued(null);
    setPinned(null);
  }, [recover]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      intent.current = null;
    };
  }, []);
  // Includes readiness and authority revisions, even a same-host enterprise edit.
  const previousDestination = useRef(destination.destinationKey);
  if (previousDestination.current !== destination.destinationKey) {
    previousDestination.current = destination.destinationKey;
    invalidate();
  }
  const previousHost = useRef(space.id);
  if (previousHost.current !== space.id) {
    previousHost.current = space.id;
    invalidate();
  }

  const freeze = useCallback(
    (): Scope =>
      pinned ?? {
        keys: (readCards ? readCards() : cards).map((c) => c.key).slice(0, 12),
        context: buildBoardContext(
          space.name,
          (readCards ? readCards() : cards).map((c) => c.entity)
        ),
        at: { ...resultPoint() },
      },
    [pinned, cards, space.name, resultPoint, readCards]
  );
  const makeIntent = useCallback(
    (scope: Scope, text: string | null, phase: Intent["phase"]): Intent => ({
      scope,
      text,
      phase,
      generation: generation.current,
      destination: destination.destinationKey,
    }),
    [destination.destinationKey]
  );
  const placeAnswer = useCallback(
    async (id: number, scope: Scope) => {
      const target = { type: "chat" as const, id };
      if (!(await place([{ ...target, ...scope.at }]))) return;
      for (const key of scope.keys) {
        const source = parseRefKey(key);
        if (source && !(await link(source, target))) break;
      }
    },
    [place, link]
  );

  const submit = useCallback(
    async (text: string): Promise<boolean> => {
      const pending = intent.current ?? makeIntent(freeze(), text, "prepared");
      if (pending.phase === "sending") {
        recover(pending, text, "sendFailed");
        return false;
      }
      pending.text = text;
      const eligible = () =>
        mounted.current &&
        latest.current.workspaceActive &&
        pending.generation === generation.current &&
        latest.current.destination.canAdmit(pending.destination) &&
        latest.current.chat.canSend &&
        typeof latest.current.chat.sendMessage === "function";
      if (!eligible()) {
        recover(pending, text, "sendFailed");
        intent.current = null;
        return false;
      }
      pending.phase = "sending";
      intent.current = pending;
      try {
        const accepted = await latest.current.chat.sendMessage(text, {
          contextOverride: pending.scope.context,
          canAdmit: eligible,
          onAccepted: (id) => {
            pending.phase = "accepted";
            if (intent.current === pending) intent.current = null;
            if (mounted.current)
              setRecovery((held) =>
                held?.scope === pending.scope && held.text === text ? null : held
              );
            // The callback receives the saved user's owner, never the current picker id.
            void placeAnswer(id, pending.scope);
          },
        });
        if (!accepted) recover(pending, text, "sendFailed");
        return accepted;
      } catch {
        recover(pending, text, "sendFailed");
        return false;
      } finally {
        if (intent.current === pending) intent.current = null;
        await reload();
      }
    },
    [makeIntent, freeze, recover, placeAnswer, reload]
  );

  const start = (scope: Scope, text: string | null) => {
    invalidate();
    chat.startNewChat();
    setPinned(scope);
    setAskOpen(true);
    const pending = makeIntent(scope, text, text ? "queued" : "prepared");
    intent.current = pending;
    setQueued(text ? pending : null);
  };
  const startFromSelection = (text: string | null) => {
    if (!workspaceActive || !destination.canAdmit(destination.destinationKey)) return;
    const pin = pinSelection(
      space.name,
      (readCards ? readCards() : cards)
        .filter((c) => (read ? read().selection : selection).includes(c.key))
        .map((c) => c.entity)
    );
    if ("error" in pin) return;
    start({ ...pin, at: { ...resultPoint() } }, text);
  };
  useEffect(() => {
    if (!workspaceActive || !queued || queued !== intent.current || queued.phase !== "queued")
      return;
    // The reset has rendered; admit once or retain a visible manual recovery.
    setQueued(null);
    void submit(queued.text!);
  }, [workspaceActive, queued, submit]);
  const onQueue = () => {
    if (!workspaceActive) return;
    intent.current = makeIntent(freeze(), null, "prepared");
  };
  const newChat = () => {
    invalidate();
    chat.startNewChat();
  };
  const switchConversation = async (id: number) => {
    invalidate();
    setAskOpen(true);
    try {
      await chat.switchConversation(id);
    } catch {
      /* A failed read must not dispatch work. */
    }
  };
  const cancel = () => {
    invalidate();
    chat.cancelStream();
  };
  const retry = () => {
    if (
      workspaceActive &&
      recovery &&
      destination.canAdmit(destination.destinationKey) &&
      chat.canSend
    )
      start(recovery.scope, recovery.text);
  };
  const queueKey = `table|${space.id}|${generation.current}|${chat.conversationGeneration}|${chat.activeConversationId ?? "new"}|${destination.destinationKey}`;
  return {
    chat,
    route: destination.route,
    ready: workspaceActive && destination.canAdmit(destination.destinationKey),
    askOpen,
    setAskOpen,
    pinned,
    recovery,
    retry,
    submit,
    onQueue,
    newChat,
    switchConversation,
    startFromSelection,
    cancel,
    invalidate,
    queueKey,
  };
}
