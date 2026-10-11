import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  addToCartFn,
  getCartFn,
  removeCartLineFn,
  updateCartLineFn,
  type CartResponse,
} from "~/lib/cart.functions";
import type { CartView } from "~/server/storefront";

export const CART_QUERY_KEY = ["shop", "cart"] as const;

// The shopper's cart, shared by the BuyBox and the drawer. Every change answers with the whole
// cart, which replaces the cached one.
export function useCart() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const fetchCart = useServerFn(getCartFn);
  const add = useServerFn(addToCartFn);
  const update = useServerFn(updateCartLineFn);
  const remove = useServerFn(removeCartLineFn);

  const cart = useQuery({
    queryKey: CART_QUERY_KEY,
    queryFn: async () => {
      const response = await fetchCart();
      return response.ok ? response.cart : null;
    },
    staleTime: 30_000,
  });

  function settle(response: CartResponse) {
    if (response.ok) {
      setError(null);
      queryClient.setQueryData<CartView | null>(CART_QUERY_KEY, response.cart);
      return true;
    }
    setError(response.message);
    return false;
  }

  const mutation = useMutation({
    mutationFn: async (
      change:
        | { kind: "add"; cr: string; product: string; color: string; size: string; quantity: number }
        | { kind: "update"; lineId: string; quantity: number }
        | { kind: "remove"; lineId: string },
    ) => {
      if (change.kind === "add") {
        const { kind: _, ...data } = change;
        return settle(await add({ data }));
      }
      if (change.kind === "update") return settle(await update({ data: { lineId: change.lineId, quantity: change.quantity } }));
      return settle(await remove({ data: { lineId: change.lineId } }));
    },
    onError: () => setError("The cart didn't respond. Try again in a moment."),
  });

  return {
    cart: cart.data ?? null,
    error,
    busy: mutation.isPending,
    addLine: (line: { cr: string; product: string; color: string; size: string; quantity: number }) =>
      mutation.mutateAsync({ kind: "add", ...line }),
    setQuantity: (lineId: string, quantity: number) => mutation.mutateAsync({ kind: "update", lineId, quantity }),
    removeLine: (lineId: string) => mutation.mutateAsync({ kind: "remove", lineId }),
  };
}
