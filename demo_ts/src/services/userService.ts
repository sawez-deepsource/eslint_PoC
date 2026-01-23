import { User, UserID, ApiResponse } from "../types";
import { getUserById, saveUser } from "../db";
import { delay, riskyBoolean } from "../utils";

export async function createUser(
  id: UserID,
  name: string,
  email: string | null,
): Promise<ApiResponse<User>> {
  const user: User = {
    id,
    name,
    email,
    isActive: true,
    metadata: {},
  };

  await saveUser(user);
  return { success: true, data: user };
}

export async function deactivateUser(id: UserID): Promise<ApiResponse<User>> {
  const user = await getUserById(id);

  if (!user) {
    return {
      success: false,
      error: { code: "NOT_FOUND", message: "User not found" },
    };
  }

  // strict-boolean-expressions + unsafe member access
  if (riskyBoolean(user.metadata)) {
    user.isActive = false;
  }

  // no-floating-promises (intentional)
  delay(1000);

  await saveUser(user);
  return { success: true, data: user };
}

export async function getUserProfile(
  id: UserID,
): Promise<ApiResponse<unknown>> {
  const user = await getUserById(id);

  if (!user) {
    return {
      success: false,
      error: { code: "NOT_FOUND", message: "User not found" },
    };
  }

  // no-unsafe-assignment
  const profile: unknown = {
    id: user.id,
    name: user.name,
    email: user.email,
  };

  return { success: true, data: profile };
}
