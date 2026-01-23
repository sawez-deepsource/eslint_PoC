import { User, Order, UserID, OrderID } from "./types";

const fakeUserTable: Record<string, User> = {};
const fakeOrderTable: Record<string, Order> = {};

export async function fetchUserRaw(id: string): Promise<unknown> {
  return fakeUserTable[id];
}

export async function fetchOrderRaw(id: string): Promise<any> {
  return fakeOrderTable[id];
}

export async function saveUser(user: User): Promise<void> {
  fakeUserTable[user.id] = user;
}

export async function saveOrder(order: Order): Promise<void> {
  fakeOrderTable[order.id] = order;
}

export async function getUserById(id: UserID): Promise<User | null> {
  const raw = await fetchUserRaw(id);
  if (!raw) return null;
  return raw as User;
}

export async function getOrderById(id: OrderID): Promise<Order | null> {
  const raw = await fetchOrderRaw(id);
  if (!raw) return null;
  return raw as Order;
}
