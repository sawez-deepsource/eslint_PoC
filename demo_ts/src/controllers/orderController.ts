import { OrderID, UserID, ApiResponse } from "../types";
import { createOrder, processOrder } from "../services/orderService";

export async function handleCreateOrder(
  req: any,
): Promise<ApiResponse<unknown>> {
  const { id, userId, amount } = req.body;
  return createOrder(id as OrderID, userId as UserID, Number(amount));
}

export async function handleProcessOrder(
  req: any,
): Promise<ApiResponse<unknown>> {
  const { id } = req.params;
  const result = await processOrder(id as OrderID);

  // no-misused-promises (intentional)
  Promise.resolve(result).then(() => {});

  return result;
}
