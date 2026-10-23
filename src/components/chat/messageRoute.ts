import type { ResolvedRoute } from "../../lib/routes";
import type { MessageRoute } from "./types";

export const toMessageRoute = (
  route: Pick<ResolvedRoute, "locality" | "providerId" | "model">
): MessageRoute => ({
  model: route.model,
  providerId: route.providerId,
  locality: route.locality,
});
