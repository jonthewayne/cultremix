import { insertAtBottomIfLoaded, useMutation } from "convex/react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { OptimisticLocalStore } from "convex/browser";
import type { Id } from "../../../convex/_generated/dataModel";
import { errorMessage } from "~/lib/imagePrep";

// Hearting and dismissing, shown the moment they're tapped: every loaded list (the batches, the
// favorites tray, a linked batch) changes right away and the server catches up.

type TileView = FunctionReturnType<typeof api.studio.sessionBatches>["page"][number]["tiles"][number];

function patchTile(store: OptimisticLocalStore, id: Id<"generations">, patch: (tile: TileView) => TileView) {
  const touch = <T extends { generationId: Id<"generations"> }>(tiles: Array<T>) =>
    tiles.some((tile) => tile.generationId === id)
      ? tiles.map((tile) => (tile.generationId === id ? (patch(tile as unknown as TileView) as unknown as T) : tile))
      : null;
  for (const { args, value } of store.getAllQueries(api.studio.sessionBatches)) {
    if (!value) continue;
    const page = value.page.map((batch) => {
      const tiles = touch(batch.tiles);
      return tiles ? { ...batch, tiles } : batch;
    });
    if (page.some((batch, i) => batch !== value.page[i])) store.setQuery(api.studio.sessionBatches, args, { ...value, page });
  }
  for (const { args, value } of store.getAllQueries(api.studio.designBatch)) {
    const tiles = value ? touch(value.tiles) : null;
    if (value && tiles) store.setQuery(api.studio.designBatch, args, { ...value, tiles });
  }
  for (const { args, value } of store.getAllQueries(api.studio.sessionFavorites)) {
    const page = value ? touch(value.page) : null;
    if (value && page) store.setQuery(api.studio.sessionFavorites, args, { ...value, page });
  }
}

function dropFavorite(store: OptimisticLocalStore, id: Id<"generations">) {
  for (const { args, value } of store.getAllQueries(api.studio.sessionFavorites)) {
    if (value?.page.some((tile) => tile.generationId === id)) {
      store.setQuery(api.studio.sessionFavorites, args, { ...value, page: value.page.filter((tile) => tile.generationId !== id) });
    }
  }
}

function findTile(store: OptimisticLocalStore, id: Id<"generations">): TileView | undefined {
  for (const { value } of store.getAllQueries(api.studio.sessionBatches)) {
    for (const batch of value?.page ?? []) {
      const tile = batch.tiles.find((t) => t.generationId === id);
      if (tile) return tile;
    }
  }
  for (const { value } of store.getAllQueries(api.studio.designBatch)) {
    const tile = value?.tiles.find((t) => t.generationId === id);
    if (tile) return tile;
  }
  return undefined;
}

export function useDesignActions(sessionId: string | undefined) {
  const toggleFavorite = useMutation(api.studio.toggleFavorite);
  const setRejectedMutation = useMutation(api.studio.setRejected);
  const favorite = useMemo(() => toggleFavorite.withOptimisticUpdate((store, args) => {
    if (args.favorite === undefined) return;
    const on = args.favorite;
    const already = findTile(store, args.generationId)?.favorite === true;
    patchTile(store, args.generationId, (tile) => ({ ...tile, favorite: on, rejected: on ? false : tile.rejected }));
    if (!on) {
      dropFavorite(store, args.generationId);
      return;
    }
    // A new favorite joins the end of the tray (favorites are in the order they were hearted).
    const tile = findTile(store, args.generationId);
    if (!already && tile && sessionId) {
      insertAtBottomIfLoaded({
        paginatedQuery: api.studio.sessionFavorites,
        argsToMatch: { sessionId },
        localQueryStore: store,
        item: { ...tile, favorite: true, rejected: false },
      });
    }
  }), [toggleFavorite, sessionId]);
  const reject = useMemo(() => setRejectedMutation.withOptimisticUpdate((store, args) => {
    patchTile(store, args.generationId, (tile) =>
      args.rejected ? { ...tile, rejected: true, favorite: false } : { ...tile, rejected: false },
    );
    if (args.rejected) dropFavorite(store, args.generationId);
  }), [setRejectedMutation]);

  const setFavorite = useCallback(
    (generationId: Id<"generations">, on: boolean) => {
      favorite({ generationId, favorite: on }).catch((err: unknown) => toast.error(errorMessage(err)));
    },
    [favorite],
  );
  // Dismissing a favorite unhearts it, so Undo hearts it again (it joins the end of the tray).
  const setRejected = useCallback(
    (generationId: Id<"generations">, rejected: boolean, wasFavorite = false) => {
      reject({ generationId, rejected }).catch((err: unknown) => toast.error(errorMessage(err)));
      if (!rejected) return;
      toast("Dismissed", {
        action: {
          label: "Undo",
          onClick: () => {
            const undo = wasFavorite ? favorite({ generationId, favorite: true }) : reject({ generationId, rejected: false });
            undo.catch((err: unknown) => toast.error(errorMessage(err)));
          },
        },
      });
    },
    [reject, favorite],
  );
  return { setFavorite, setRejected };
}
