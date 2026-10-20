import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SpaceItem } from "../../types/electron";
import type { TableEntityRef } from "../../types/table";
import { OverviewAskSection } from "../notes/overview/OverviewAskSection";
import { RouteDestinationChip, RouteStateChip } from "../settings/routing/RouteChips";
import { Button } from "../ui/button";
import { TableCanvas } from "./TableCanvas";
import { TableInbox } from "./TableInbox";
import { TableSelectionBar } from "./TableSelectionBar";
import { fitViewport, screenToWorld, snapToGrid, zoomAt, type Point } from "./tableGeometry";
import {
  buildGroupedNote,
  parseRefKey,
  placementsFor,
  type CardSize,
  type TableSizing,
} from "./tableModel";
import { useTableBoard } from "./useTableBoard";
import { useTableChat } from "./useTableChat";
import { TableDictationDetail } from "./TableDictationDetail";

export default function TableView({
  space,
  onOpenNote,
  viewSwitch,
}: {
  space: SpaceItem;
  onOpenNote: (noteId: number) => void;
  viewSwitch: ReactNode;
}) {
  const { t } = useTranslation();
  const board = useTableBoard(space.id);
  const { state, cards, edges, dispatch, place, hide, setViewport } = board;
  const stateRef = useRef(state);
  stateRef.current = state;
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const canvasSize = useRef({ width: 1200, height: 800 });

  const belowSelection = (): Point => {
    const rects = cards.filter((c) => state.selection.includes(c.key)).map((c) => c.rect);
    if (!rects.length)
      return screenToWorld(
        { x: canvasSize.current.width / 2, y: canvasSize.current.height / 2 },
        state.viewport
      );
    const cx = rects.reduce((sum, r) => sum + r.x + r.w / 2, 0) / rects.length;
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    return { x: snapToGrid(cx - 140), y: snapToGrid(bottom + 40) };
  };

  const tableChat = useTableChat({
    space,
    cards,
    selection: state.selection,
    resultPoint: belowSelection,
    board,
  });
  const {
    chat,
    route: chatRoute,
    askOpen,
    setAskOpen,
    pinned,
    switchConversation,
    invalidate,
  } = tableChat;

  const group = async () => {
    if (busy) return;
    // Freeze source content, refs and result geometry before the first save await.
    const sources = cards.filter((c) => state.selection.includes(c.key)).map((c) => c.entity);
    const at = { ...belowSelection() };
    const host = space.id;
    setBusy(true);
    setActionFailed(false);
    try {
      const { title, content } = buildGroupedNote(sources, {
        title: t("table.groupedNote.title"),
        untitled: t("table.card.untitled"),
        kind: {
          note: t("table.kind.note"),
          meeting: t("table.kind.meeting"),
          dictation: t("table.kind.dictation"),
          chat: t("table.kind.chat"),
        },
      });
      const saved = await window.electronAPI?.saveNote?.(
        title,
        content,
        "personal",
        null,
        null,
        null,
        host
      );
      if (!saved?.success || !saved.note) {
        if (alive.current) setActionFailed(true);
        await board.reload();
        return;
      }
      const target: TableEntityRef = { type: "note", id: saved.note.id };
      if (!(await place([{ ...target, ...at }]))) return;
      for (const source of sources) if (!(await board.link(source.ref, target))) break;
    } catch {
      if (alive.current) setActionFailed(true);
      await board.reload();
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const open = useCallback(
    (key: string) => {
      const ref = parseRefKey(key);
      if (!ref) return;
      if (ref.type === "chat") {
        void switchConversation(ref.id);
        return;
      }
      invalidate();
      if (ref.type === "note") onOpenNote(ref.id);
      else setExpanded(ref.id);
    },
    [switchConversation, invalidate, onOpenNote]
  );

  const placeFromInbox = useCallback(
    (key: string, world?: Point) => {
      const ref = parseRefKey(key);
      if (!ref) return;
      const at =
        world ??
        screenToWorld(
          { x: canvasSize.current.width / 2, y: canvasSize.current.height / 2 },
          stateRef.current.viewport
        );
      void place([{ ...ref, x: snapToGrid(at.x), y: snapToGrid(at.y) }]);
    },
    [place]
  );

  // Stable handlers: the canvas re-renders on every pointer frame, and a new
  // function identity would reconnect every card's ResizeObserver.
  const onMove = useCallback(
    (positions: Record<string, Point>) => dispatch({ type: "moved", positions }),
    [dispatch]
  );
  const onDrop = useCallback(
    (positions: Record<string, Point>) =>
      void place(placementsFor(stateRef.current, Object.keys(positions), positions)),
    [place]
  );
  const onResizeCard = useCallback(
    (key: string, size: CardSize, commit: boolean) => {
      dispatch({ type: "resized", key, size });
      if (commit) {
        const current = stateRef.current;
        void place(placementsFor({ ...current, sizes: { ...current.sizes, [key]: size } }, [key]));
      }
    },
    [dispatch, place]
  );
  const onResizeCancel = useCallback(
    (key: string, sizing: TableSizing) => {
      dispatch({ type: "sizeRestored", key, sizing });
    },
    [dispatch]
  );
  const onClickCard = useCallback(
    (key: string, additive: boolean) => dispatch({ type: "clickCard", key, additive }),
    [dispatch]
  );
  const onSelect = useCallback((keys: string[]) => dispatch({ type: "select", keys }), [dispatch]);
  const onFocus = useCallback((key: string | null) => dispatch({ type: "focus", key }), [dispatch]);
  const onRemove = useCallback((keys: string[]) => void hide(keys), [hide]);
  const onNudge = useCallback(
    (keys: string[], dx: number, dy: number) => {
      const current = stateRef.current;
      const positions = Object.fromEntries(
        cards
          .filter((c) => keys.includes(c.key))
          .map((c) => [c.key, { x: c.rect.x + dx, y: c.rect.y + dy }])
      );
      void place(placementsFor(current, keys, positions));
    },
    [cards, place]
  );
  const onMeasure = useCallback(
    (key: string, h: number) => dispatch({ type: "measured", key, h }),
    [dispatch]
  );
  const onResize = useCallback((size: { width: number; height: number }) => {
    canvasSize.current = size;
  }, []);

  const routeChip = tableChat.ready ? (
    <RouteDestinationChip route={chatRoute} />
  ) : (
    <RouteStateChip
      state={chatRoute.state.status === "ready" ? { status: "unknown" } : chatRoute.state}
    />
  );

  const status =
    board.status === "full"
      ? t("table.status.full")
      : board.status === "saveFailed" || actionFailed
        ? t("table.status.saveFailed")
        : state.board?.truncated
          ? t("table.status.truncated")
          : "";

  return (
    <div className="table-view">
      <div role="toolbar" aria-label={t("table.view.label")} className="table-toolbar">
        {viewSwitch}
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("table.zoomOut")}
          onClick={() =>
            setViewport(
              zoomAt(state.viewport, 1 / 1.2, {
                x: canvasSize.current.width / 2,
                y: canvasSize.current.height / 2,
              }),
              true
            )
          }
        >
          −
        </Button>
        <span className="table-toolbar__zoom">
          {t("table.zoomLevel", { percent: Math.round(state.viewport.scale * 100) })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("table.zoomIn")}
          onClick={() =>
            setViewport(
              zoomAt(state.viewport, 1.2, {
                x: canvasSize.current.width / 2,
                y: canvasSize.current.height / 2,
              }),
              true
            )
          }
        >
          +
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            invalidate();
            setViewport(
              fitViewport(
                cards.map((c) => c.rect),
                canvasSize.current
              ),
              true
            );
          }}
        >
          {t("table.resetView")}
        </Button>
        <span className="table-toolbar__hint">{t("table.hint")}</span>
        <span className="ms-auto table-toolbar__route">{routeChip}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={askOpen}
          onClick={() => {
            if (askOpen) invalidate();
            setAskOpen(!askOpen);
          }}
        >
          {t(askOpen ? "table.ask.close" : "table.ask.open")}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="table-status">
        {status}
      </p>
      <div className="table-body">
        <TableInbox entities={state.board?.inbox ?? []} onPlace={placeFromInbox} />
        <TableCanvas
          cards={cards}
          edges={edges}
          viewport={state.viewport}
          selection={state.selection}
          focused={state.focused}
          expanded={null}
          label={t("table.canvasLabel", { space: space.name })}
          onViewport={board.setViewport}
          onMove={onMove}
          onDrop={onDrop}
          onClickCard={onClickCard}
          onSelect={onSelect}
          onFocus={onFocus}
          onOpen={open}
          onRemove={onRemove}
          onNudge={onNudge}
          onMeasure={onMeasure}
          onDropRef={placeFromInbox}
          onResize={onResize}
          onResizeCard={onResizeCard}
          onResizeCancel={onResizeCancel}
          gestureScope={space.id}
        />
        {expanded !== null && (
          <TableDictationDetail key={expanded} id={expanded} onClose={() => setExpanded(null)} />
        )}
        {askOpen && (
          <aside className="table-ask" aria-label={t("table.ask.open")}>
            <div className="table-ask__head">
              {routeChip}
              <p className="table-ask__scope">
                {pinned
                  ? t("table.ask.pinned", { count: pinned.keys.length })
                  : t("table.ask.wholeTable")}
              </p>
            </div>
            {tableChat.recovery && (
              <div className="table-ask__recovery" role="status">
                <p>{t(`table.ask.${tableChat.recovery.reason}`)}</p>
                <p className="table-ask__words">{tableChat.recovery.text}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!tableChat.ready || !chat.canSend}
                  onClick={tableChat.retry}
                >
                  {t("table.ask.retry")}
                </Button>
              </div>
            )}
            <OverviewAskSection
              messages={chat.messages}
              agentState={chat.agentState}
              onTextSubmit={tableChat.submit}
              queueKey={tableChat.queueKey}
              onQueue={tableChat.onQueue}
              submitDisabled={!tableChat.ready}
              onCancel={tableChat.cancel}
              conversations={chat.conversations}
              activeConversationId={chat.activeConversationId}
              onSwitchConversation={tableChat.switchConversation}
              onNewChat={tableChat.newChat}
              onOpenNote={(id) => {
                invalidate();
                onOpenNote(id);
              }}
            />
          </aside>
        )}
      </div>
      {state.selection.length > 0 && (
        <TableSelectionBar
          count={state.selection.length}
          busy={busy || !chat.canSend}
          route={
            !tableChat.ready && chatRoute.state.status === "ready"
              ? { ...chatRoute, state: { status: "unknown" } }
              : chatRoute
          }
          onSummarise={() => tableChat.startFromSelection(t("table.selection.summarisePrompt"))}
          onAsk={() => tableChat.startFromSelection(null)}
          onGroup={() => void group()}
          onRemove={() => void hide(state.selection)}
        />
      )}
    </div>
  );
}
