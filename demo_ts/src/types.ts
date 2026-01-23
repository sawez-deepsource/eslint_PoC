export type UserID = string & { readonly brand: unique symbol };
export type OrderID = string & { readonly brand: unique symbol };

export interface User {
  id: UserID;
  name: string;
  email: string | null;
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

export interface Order {
  id: OrderID;
  userId: UserID;
  amount: number;
  status: "pending" | "paid" | "cancelled";
  createdAt: Date;
  notes?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export type Maybe<T> = T | null | undefined;

export function assertNever(x: never): never {
  throw new Error("Unexpected object: " + x);
}
