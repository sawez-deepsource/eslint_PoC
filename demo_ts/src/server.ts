import { handleCreateUser } from "./controllers/userController";
import { handleCreateOrder } from "./controllers/orderController";

export async function runDemo() {
  await handleCreateUser({
    body: { id: "u1", name: "Alice", email: null },
  } as any);
  await handleCreateOrder({
    body: { id: "o1", userId: "u1", amount: 100 },
  } as any);
}
