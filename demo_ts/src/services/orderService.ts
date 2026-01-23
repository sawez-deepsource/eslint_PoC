import { Order, OrderID, UserID, ApiResponse } from "../types";
import { getOrderById, saveOrder, getUserById } from "../db";
import { delay } from "../utils";

export async function createOrder(
  id: OrderID,
  userId: UserID,
  amount: number,
): Promise<ApiResponse<Order>> {
  const user = await getUserById(userId);
  if (!user) {
    return {
      success: false,
      error: { code: "USER_NOT_FOUND", message: "User does not exist" },
    };
  }

  const order: Order = {
    id,
    userId,
    amount,
    status: "pending",
    createdAt: new Date(),
  };

  await saveOrder(order);
  return { success: true, data: order };
}

export async function processOrder(id: OrderID): Promise<ApiResponse<Order>> {
  const order = await getOrderById(id);

  if (!order) {
    return {
      success: false,
      error: { code: "ORDER_NOT_FOUND", message: "Order not found" },
    };
  }

  if (order.amount <= 0) {
    return {
      success: false,
      error: { code: "INVALID_AMOUNT", message: "Amount must be positive" },
    };
  }

  if (order.status === "pending") {
    order.status = "paid";
  } else if (order.status === "paid") {
    return {
      success: false,
      error: { code: "ALREADY_PAID", message: "Order already paid" },
    };
  } else if (order.status === "cancelled") {
    return {
      success: false,
      error: { code: "CANCELLED", message: "Order cancelled" },
    };
  } else {
    // Exhaustiveness check
    return {
      success: false,
      error: { code: "UNKNOWN", message: "Unknown status" },
    };
  }

  // no-misused-promises
  setTimeout(async () => {
    await delay(100);
  }, 0);

  await saveOrder(order);
  return { success: true, data: order };
}
