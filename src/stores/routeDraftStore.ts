import { create } from "zustand";
import { INFERENCE_SCOPES } from "../config/inferenceScopes";
import { ROUTE_ENTERPRISE_KEYS, type SettingsPatch } from "../lib/providerSwitchPlans";
import {
  planPatch,
  planRouteChange,
  type ApplyBlocker,
  type PlanContext,
  type RoutePlan,
  type RouteTarget,
} from "../lib/routePlanner";
import type { RouteCopy, RouteId } from "../lib/routes";
import { refreshRouteFacts, useRouteFactsStore } from "./routeFactsStore";
import { getSealed } from "./sealedStore";
import { flushRoutePatchSaves, flushSecretSaves, useSettingsStore } from "./settingsStore";

// The single place that changes where a task runs (SET-R3 B). Each request
// is planned (routePlanner.ts). Results that stay on this device, or keep
// the same recipient and payload, apply at once with Undo. Anything that
// adds an off-device recipient or payload waits as the one draft until Apply.

export type RouteDraft =
  | { routeId: RouteId; kind: "target"; target: RouteTarget; setup?: SettingsPatch }
  | { routeId: RouteId; kind: "patch"; patch: SettingsPatch };

interface RouteDraftState {
  draft: RouteDraft | null;
  // Ephemeral UI owner lifetime, independent of request tickets and contents.
  // New stages advance it; exact existing-owner refinements retain it.
  draftIdentity: number;
  // R2-8, the session epoch. Only the user's Discard and Settings closing
  // (endSettingsSession) bump it, so every request still waiting, on any
  // route, settles to "superseded". Internal draft drops never bump it.
  requestEpoch: number;
  // R2-8, one request epoch per route. A request or an Undo bumps only the
  // routes it is about, so a newer intent supersedes an older request on the
  // same route and leaves requests on other routes alone.
  routeEpochs: Partial<Record<RouteId, number>>;
  stage: (draft: RouteDraft, owner?: RouteDraft) => void;
  discard: () => void;
}

export const useRouteDraftStore = create<RouteDraftState>()((set) => ({
  draft: null,
  draftIdentity: 0,
  requestEpoch: 0,
  routeEpochs: {},
  stage: (draft, owner) =>
    set((s) => ({
      draft,
      draftIdentity:
        owner && s.draft === owner && draft.routeId === owner.routeId
          ? s.draftIdentity
          : s.draftIdentity + 1,
    })),
  // The user's Discard (and Settings closing): drop the draft and cancel every
  // request still waiting, on every route, so none can recreate a draft or
  // commit. The draft is the session's only pending change, so discarding it
  // is the end of that change, whichever route a waiting request is for.
  discard: () => set((s) => ({ draft: null, requestEpoch: s.requestEpoch + 1 })),
}));

export interface RouteChangeOutcome {
  applied: boolean;
  blocker: ApplyBlocker | null;
  plan: RoutePlan;
  undo?: () => Promise<RouteChangeOutcome | "staged" | "superseded" | "save-failed">;
}

// "superseded": while this one settled, Settings closed or the draft was
// discarded, or a newer request/Undo began on the same route. If main has
// already ACKed a transaction, its committed tuple remains reflected, while
// the newer draft is preserved and callers suppress success copy.
export type RouteRequestResult = RouteChangeOutcome | "staged" | "superseded" | "save-failed";
type RouteCommitResult = RouteChangeOutcome | "superseded" | "save-failed";

// Non-secret provider setup the staged editor may add to a target draft
// (BRIEF item 2; Task 6's ROUTE_ENTERPRISE_KEYS).
export const DRAFT_SETUP_KEYS: ReadonlySet<string> = new Set<string>(ROUTE_ENTERPRISE_KEYS);

// R2-8. A request holds its route's epoch and the session epoch it began in.
interface RequestTicket {
  routeId: RouteId;
  route: number;
  session: number;
  // Undo owns every affected route; ordinary requests own only routeId.
  routes?: Partial<Record<RouteId, number>>;
}

// Bumps the epoch of each route: the newest intent for those routes.
function bumpRoutes(ids: Iterable<RouteId>): void {
  const routeEpochs = { ...useRouteDraftStore.getState().routeEpochs };
  for (const id of new Set(ids)) routeEpochs[id] = (routeEpochs[id] ?? 0) + 1;
  useRouteDraftStore.setState({ routeEpochs });
}

// A request takes a ticket at call time: it bumps its own route's epoch only.
function takeTicket(routeId: RouteId): RequestTicket {
  bumpRoutes([routeId]);
  return peekTicket(routeId);
}

// Apply's ticket: the current epochs, without bumping anything.
function peekTicket(routeId: RouteId, routes?: Iterable<RouteId>): RequestTicket {
  const s = useRouteDraftStore.getState();
  return {
    routeId,
    route: s.routeEpochs[routeId] ?? 0,
    session: s.requestEpoch,
    ...(routes
      ? { routes: Object.fromEntries([...routes].map((id) => [id, s.routeEpochs[id] ?? 0])) }
      : {}),
  };
}

// Settles only if no Discard or close (session) and no newer request or Undo
// on an owned route happened since the ticket was taken.
function isCurrent(ticket: RequestTicket): boolean {
  const s = useRouteDraftStore.getState();
  return (
    s.requestEpoch === ticket.session &&
    (s.routeEpochs[ticket.routeId] ?? 0) === ticket.route &&
    Object.entries(ticket.routes ?? {}).every(
      ([id, epoch]) => (s.routeEpochs[id as RouteId] ?? 0) === epoch
    )
  );
}

// Readiness facts confirmed by main, and the single sealed authority (I14).
export function currentPlanContext(copy: RouteCopy): PlanContext {
  return { facts: useRouteFactsStore.getState().facts, copy, sealed: getSealed() };
}

// A target plus its staged setup is planned as one patch, so the review
// lists every route either changes, and Apply and Undo cover both. The
// target is resolved against the state with the setup applied, so Task 6's
// providerPatch fits a remembered or default Bedrock model to the staged
// region (an explicit target.model is kept verbatim). planPatch then adds
// the coupled model updates of other routes on the same provider.
function planTarget(
  id: RouteId,
  target: RouteTarget,
  setup: SettingsPatch | undefined,
  copy: RouteCopy
): RoutePlan {
  const state = useSettingsStore.getState();
  const ctx = currentPlanContext(copy);
  if (!setup || Object.keys(setup).length === 0) return planRouteChange(state, ctx, id, target);
  const targetPatch = planRouteChange(
    { ...state, ...setup } as typeof state,
    ctx,
    id,
    target
  ).patch;
  return planPatch(state, ctx, id, { ...setup, ...targetPatch } as SettingsPatch);
}

// What a draft would commit against the live state right now. The Apply bar
// renders this; Apply re-runs it at click time.
export function planDraft(draft: RouteDraft, copy: RouteCopy): RoutePlan {
  return draft.kind === "target"
    ? planTarget(draft.routeId, draft.target, draft.setup, copy)
    : planPatch(useSettingsStore.getState(), currentPlanContext(copy), draft.routeId, draft.patch);
}

const LLM_MODE_KEYS: ReadonlySet<string> = new Set(
  Object.values(INFERENCE_SCOPES).map((def) => def.storeKeys.mode as string)
);

// Internal: a settled change supersedes its route's draft. Not the user's
// Discard, so it does not cancel a newer request still waiting.
function clearDraftFor(routeId: RouteId, expectedDraft: RouteDraft | null): void {
  const current = useRouteDraftStore.getState().draft;
  if (current === expectedDraft && current?.routeId === routeId) {
    useRouteDraftStore.setState({ draft: null });
  }
}

// A newer draft for this route owns the row and blocks an older queued
// commit. A draft on another route remains independent and is preserved.
function mayCommitForDraft(routeId: RouteId, expectedDraft: RouteDraft | null): boolean {
  const current = useRouteDraftStore.getState().draft;
  return current === expectedDraft || current?.routeId !== routeId;
}

// A main ACK is durable even if the user started another request while it
// was pending. applyRoutePatch materializes that acknowledged tuple; this
// wrapper only suppresses stale success and protects a newer draft. Apply
// additionally requires exact draft identity at queue admission.
async function commit(
  plan: RoutePlan,
  copy: RouteCopy,
  ticket: RequestTicket,
  expectedDraft: RouteDraft | null,
  requireDraftOwner = false
): Promise<RouteCommitResult> {
  const ownsDraft = () =>
    requireDraftOwner
      ? useRouteDraftStore.getState().draft === expectedDraft
      : mayCommitForDraft(plan.routeId, expectedDraft);
  try {
    await useSettingsStore.getState().applyRoutePatch(plan.patch, {
      expectedEnterprise: plan.enterpriseBase,
      canCommit: () => isCurrent(ticket) && ownsDraft(),
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "ENTERPRISE_ROUTE_CONFLICT") {
      // The refused CAS carries canonical fields, but no complete facts. Read
      // main's atomic local metadata so the retained draft can be reviewed again.
      await refreshRouteFacts(["enterprise"]).catch(() => {});
    }
    if (
      code === "ROUTE_PATCH_SUPERSEDED" ||
      code === "ENTERPRISE_ROUTE_SUPERSEDED" ||
      !isCurrent(ticket) ||
      !ownsDraft()
    )
      return "superseded";
    return "save-failed";
  }
  // Like InferenceConfigEditor.tsx:115-117: a scope moving to a server frees
  // the local llama-server.
  const toServer = Object.entries(plan.patch).some(
    ([key, value]) => LLM_MODE_KEYS.has(key) && value === "self-hosted"
  );
  if (toServer) window.electronAPI?.llamaServerStop?.()?.catch(() => {});
  // Main keeps the dictation overlay out of its own screenshots while screen
  // context is on (DictationAgentSettings.tsx:61 did this before the switch
  // went through the planner). Here it follows every commit: instant, Apply, Undo.
  if (typeof plan.patch.voiceAgentScreenContext === "boolean") {
    window.electronAPI
      ?.setScreenContextEnabled?.(plan.patch.voiceAgentScreenContext)
      ?.catch(() => {});
  }
  if (!isCurrent(ticket) || !ownsDraft()) return "superseded";
  clearDraftFor(plan.routeId, expectedDraft);
  return { applied: true, blocker: null, plan, undo: () => undo(plan, copy) };
}

// Undo re-plans the prior raw values against the live state. Back onto the
// device, or to the same recipient, is instant. Anything that would send
// data somewhere new is staged for review, never applied by Undo itself.
// Undo still works from a toast after Settings closes. It is the newest
// intent for every route it moves, so it bumps those routes' epochs (never
// the session epoch). An enterprise Undo awaits main's ACK; if a newer
// intent begins while it waits, the durable ACK is reflected but success
// copy and draft clearing are suppressed.
async function undo(
  plan: RoutePlan,
  copy: RouteCopy
): Promise<RouteChangeOutcome | "staged" | "superseded" | "save-failed"> {
  const routes = new Set([plan.routeId, ...plan.changes.map((change) => change.id)]);
  bumpRoutes(routes);
  const ticket = peekTicket(plan.routeId, routes);
  const expectedDraft = useRouteDraftStore.getState().draft;
  // An earlier enterprise Apply may still own the route queue. Wait for its
  // durable ACK before deriving Undo, so the reverse patch is planned from
  // the configuration that actually committed. A newer intent for any
  // affected route or session close prevents Undo from starting IPC.
  await flushRoutePatchSaves();
  if (!isCurrent(ticket) || !mayCommitForDraft(plan.routeId, expectedDraft)) return "superseded";
  const reverse = planPatch(
    useSettingsStore.getState(),
    currentPlanContext(copy),
    plan.routeId,
    plan.undoPatch
  );
  if (reverse.kind === "noop") return { applied: false, blocker: null, plan: reverse };
  if (reverse.kind === "instant") return commit(reverse, copy, ticket, expectedDraft);
  useRouteDraftStore
    .getState()
    .stage({ routeId: plan.routeId, kind: "patch", patch: plan.undoPatch });
  return "staged";
}

// A key typed a moment ago must be saved and acknowledged by main, and
// main's presence for it read back, before a plan reads key readiness (I3).
// credentials.list is a local IPC read; it never touches the network.
async function readyToPlan(): Promise<void> {
  await flushRoutePatchSaves();
  await flushSecretSaves();
  await refreshRouteFacts(["credentials"]);
}

// Shared by both request paths: noop drops the route's draft, instant
// commits with Undo, staged becomes the single draft.
async function settle(
  plan: RoutePlan,
  draft: RouteDraft,
  copy: RouteCopy,
  ticket: RequestTicket,
  expectedDraft: RouteDraft | null,
  refinement = false
): Promise<RouteRequestResult> {
  if (plan.kind === "noop") {
    // Re-selecting where the task already runs changes nothing and cancels its draft.
    clearDraftFor(plan.routeId, expectedDraft);
    return { applied: false, blocker: null, plan };
  }
  if (plan.kind === "instant") return commit(plan, copy, ticket, expectedDraft);
  useRouteDraftStore.getState().stage(draft, refinement ? (expectedDraft ?? undefined) : undefined);
  return "staged";
}

function providerOf(target: RouteTarget): string {
  return target.mode === "providers" ? target.provider : target.mode;
}

export function requestRouteChange(
  id: RouteId,
  target: RouteTarget,
  copy: RouteCopy
): Promise<RouteRequestResult> {
  return requestTarget(id, target, copy);
}

// One planning/admission path for new targets and explicit target refinements.
// Setup may replace the contents while retaining this owner lifetime; a new
// owner cannot inherit the earlier editor's unsent text or pending refinement.
async function requestTarget(
  id: RouteId,
  target: RouteTarget,
  copy: RouteCopy,
  refinementIdentity?: number
): Promise<RouteRequestResult> {
  const ticket = takeTicket(id);
  const ownsRefinement = () =>
    refinementIdentity === undefined ||
    (useRouteDraftStore.getState().draftIdentity === refinementIdentity &&
      !!useRouteDraftStore.getState().draft);
  try {
    await readyToPlan();
  } catch {
    return isCurrent(ticket) && ownsRefinement() ? "save-failed" : "superseded";
  }
  if (!isCurrent(ticket) || !ownsRefinement()) return "superseded"; // R2-8
  // A model pick in the staged editor keeps the setup typed for the same
  // provider; a different provider starts without it.
  const prior = useRouteDraftStore.getState().draft;
  const setup =
    prior &&
    prior.routeId === id &&
    prior.kind === "target" &&
    providerOf(prior.target) === providerOf(target)
      ? prior.setup
      : undefined;
  const plan = planTarget(id, target, setup, copy);
  const draft: RouteDraft = setup
    ? { routeId: id, kind: "target", target, setup }
    : { routeId: id, kind: "target", target };
  const draftOwner = useRouteDraftStore.getState().draft;
  return settle(plan, draft, copy, ticket, draftOwner, refinementIdentity !== undefined);
}

// Setup for an existing pending change keeps the entire reviewed intent. A
// screenshot route without an override edits its actual assistant recipient;
// configuring it must not silently opt into the separate vision override.
export async function requestDraftTarget(
  id: RouteId,
  target: RouteTarget,
  copy: RouteCopy,
  editRouteId: RouteId = id
): Promise<RouteRequestResult> {
  const owned = useRouteDraftStore.getState().draft;
  if (!owned || owned.routeId !== id) return "superseded";
  if (owned.kind === "target" && editRouteId === id)
    return requestTarget(id, target, copy, useRouteDraftStore.getState().draftIdentity);
  const ticket = takeTicket(id);
  try {
    await readyToPlan();
  } catch {
    return isCurrent(ticket) && useRouteDraftStore.getState().draft === owned
      ? "save-failed"
      : "superseded";
  }
  if (!isCurrent(ticket) || useRouteDraftStore.getState().draft !== owned) return "superseded";
  const state = useSettingsStore.getState();
  const pending = planDraft(owned, copy);
  // A coupled setup panel is admitted only for a route this live plan changes.
  if (editRouteId !== id && !pending.changes.some((change) => change.id === editRouteId))
    return "superseded";
  const prospective = { ...state, ...pending.patch } as typeof state;
  const recipientRoute =
    editRouteId === "assistantVision" && !prospective.useDictationAgentVisionModel
      ? "voiceAssistant"
      : editRouteId;
  const ctx = currentPlanContext(copy);
  const targetPatch = planRouteChange(prospective, ctx, recipientRoute, target).patch;
  const patch = {
    ...(owned.kind === "patch" ? owned.patch : pending.patch),
    ...targetPatch,
  } as SettingsPatch;
  const plan = planPatch(state, ctx, id, patch);
  return settle(plan, { routeId: id, kind: "patch", patch }, copy, ticket, owned, true);
}

// Raw route keys that are not a destination: the enable switches, Corti's
// region and tenant, providerSearch:<scope> and the enterprise fields of a
// route that is already active (Task 9). Turning a route on toward an
// off-device recipient, adding a payload part or changing a host is staged;
// turning a route off is instant.
export async function requestRoutePatch(
  id: RouteId,
  patch: SettingsPatch,
  copy: RouteCopy
): Promise<RouteRequestResult> {
  const ticket = takeTicket(id);
  try {
    await readyToPlan();
  } catch {
    return isCurrent(ticket) ? "save-failed" : "superseded";
  }
  if (!isCurrent(ticket)) return "superseded"; // R2-8
  const plan = planPatch(useSettingsStore.getState(), currentPlanContext(copy), id, patch);
  const draftOwner = useRouteDraftStore.getState().draft;
  return settle(plan, { routeId: id, kind: "patch", patch }, copy, ticket, draftOwner);
}

// The staged editor's provider setup (R2-9, R2-1): enterprise region,
// endpoint, project, location and Vertex source. It joins either draft kind,
// writes nothing and tells main nothing. It takes no ticket: target picks
// re-read same-provider setup; a pending patch setup edit preserves this newer
// draft and supersedes an operation that captured the previous draft identity.
export function stageDraftSetup(id: RouteId, patch: SettingsPatch): RouteDraft | null {
  for (const key of Object.keys(patch)) {
    if (!DRAFT_SETUP_KEYS.has(key)) throw new Error(`${key} is not draft setup`);
  }
  const draft = useRouteDraftStore.getState().draft;
  if (!draft || draft.routeId !== id) return null;
  const next: RouteDraft =
    draft.kind === "patch"
      ? { ...draft, patch: { ...draft.patch, ...patch } as SettingsPatch }
      : { ...draft, setup: { ...(draft.setup ?? {}), ...patch } as SettingsPatch };
  useRouteDraftStore.getState().stage(next, draft);
  return next;
}

export async function applyDraft(
  copy: RouteCopy
): Promise<RouteChangeOutcome | null | "save-failed"> {
  const draft = useRouteDraftStore.getState().draft;
  if (!draft) return null;
  // Apply bumps nothing (a Discard, a close or a newer request on the draft's
  // route cancels it, not the other way round).
  const ticket = peekTicket(draft.routeId);
  try {
    await readyToPlan();
  } catch {
    return isCurrent(ticket) && useRouteDraftStore.getState().draft === draft
      ? "save-failed"
      : null;
  }
  // The user applied this draft. If Settings closed, the draft was discarded
  // or replaced, or a newer request on its route began while saves finished,
  // apply nothing. A request on another route that staged meanwhile replaced
  // the single draft, so the identity check catches it.
  if (!isCurrent(ticket) || useRouteDraftStore.getState().draft !== draft) return null;
  const plan = planDraft(draft, copy); // live state, at click time
  if (plan.kind === "noop") {
    useRouteDraftStore.setState({ draft: null });
    return { applied: false, blocker: null, plan };
  }
  // Task 6 blocks every changed, enabled, off-device route that is not ready (R2-9).
  if (plan.blocker) return { applied: false, blocker: plan.blocker, plan }; // draft kept
  const result = await commit(plan, copy, ticket, draft, true);
  return result === "superseded" ? null : result;
}

// R2-8: the Settings session ends (SettingsModal close, Task 8). The draft is
// dropped and the session epoch moves, so every request still waiting, on any
// route, settles to "superseded". A toast's Undo remains available after
// Settings closes, but awaits its main ACK and reports persistence failure.
export function endSettingsSession(): void {
  useRouteDraftStore.getState().discard();
}

// Closing Settings ends the session without applying anything.
export function withDraftDiscard(onOpenChange: (open: boolean) => void): (open: boolean) => void {
  return (open) => {
    if (!open) endSettingsSession();
    onOpenChange(open);
  };
}
